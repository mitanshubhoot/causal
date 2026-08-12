"""
Causal tracer — capture agent runs as traces of spans and ship them to the
Causal ingest endpoint (``POST /api/v1/traces``).

Mirrors the TypeScript tracer in ``@causal/sdk`` so both SDKs speak the same
wire format, and inherits its two hard rules:

* telemetry never breaks the host app — every export error is swallowed;
* no API key, no network — spans are still recorded, they are simply dropped.

Async context manager::

    from causal_sdk import CausalTracer

    tracer = CausalTracer(service="booking-agent", model="claude-sonnet-4")

    async with tracer.trace("booking_agent.run") as t:
        plan = t.span("llm.plan", "llm")
        answer = await call_model(prompt)
        plan.end(io={"input": prompt, "output": answer}, tokens_in=812, tokens_out=210)

        tool = plan.child("tool.search_flights", "tool")
        tool.end(status="warn", attributes={"results": 0})

Decorator — the same object also decorates async *and* sync functions::

    @tracer.trace("booking_agent.run")
    async def run(prompt: str) -> str:
        ...

Plain sync code::

    with tracer.trace_sync("nightly_reconcile") as t:
        t.span("db.query", "db").end()

Environment fallbacks: ``CAUSAL_API_KEY``, ``CAUSAL_API_URL``, ``CAUSAL_ORG_ID``,
``CAUSAL_SERVICE``, ``CAUSAL_ENVIRONMENT``, ``CAUSAL_MODEL``, ``CAUSAL_REPO``,
``CAUSAL_GIT_REF``, ``CAUSAL_USER``, ``CAUSAL_SESSION_ID``. Set
``CAUSAL_DISABLED=1`` to record spans without exporting them.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import json
import os
import secrets
import threading
import time
from collections.abc import Callable, Coroutine, Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from datetime import datetime, timezone
from types import TracebackType
from typing import Any, Literal, TypeVar, cast

import httpx

__all__ = [
    "CausalSpan",
    "CausalTrace",
    "CausalTracer",
    "SpanKind",
    "SpanStatus",
    "current_span",
    "current_trace",
    "get_default_tracer",
    "set_default_tracer",
]

SpanKind = Literal[
    "agent", "llm", "tool", "http", "db", "function",
    "skill", "workflow", "search", "shell",
]
SpanStatus = Literal["ok", "warn", "error"]

#: Kinds the ingest endpoint accepts. Anything else is coerced to ``function``
#: so a typo drops one label instead of the whole trace.
SPAN_KINDS: frozenset[str] = frozenset(
    {"agent", "llm", "tool", "http", "db", "function", "skill", "workflow", "search", "shell"}
)
SPAN_STATUSES: frozenset[str] = frozenset({"ok", "warn", "error"})

#: Hard cap on a single I/O string. Keeps a runaway prompt from turning a
#: trace export into a multi-megabyte POST.
MAX_IO_CHARS = 16_000

_DEFAULT_BASE_URL = "http://localhost:3001"
_USER_AGENT = "causal-sdk-python/0.1.0"
_TRUTHY = {"1", "true", "yes", "on"}

F = TypeVar("F", bound=Callable[..., Any])


# ── contextvars: the ambient trace/span used by @observe ──────────────
_current_trace: ContextVar[CausalTrace | None] = ContextVar("causal_current_trace", default=None)
_current_span: ContextVar[CausalSpan | None] = ContextVar("causal_current_span", default=None)


def current_trace() -> CausalTrace | None:
    """Return the trace enclosing the caller, or ``None`` outside a trace."""
    return _current_trace.get()


def current_span() -> CausalSpan | None:
    """Return the innermost open span, or ``None`` when nothing is open."""
    return _current_span.get()


def _reset_var(var: ContextVar[Any], token: Token[Any]) -> None:
    """Reset a ContextVar, tolerating a token minted in another context."""
    try:
        var.reset(token)
    except (ValueError, RuntimeError):
        var.set(None)


@contextmanager
def _use_span(span: CausalSpan) -> Iterator[CausalSpan]:
    """Make ``span`` the ambient parent for the duration of the block."""
    token = _current_span.set(span)
    try:
        yield span
    finally:
        _reset_var(_current_span, token)


# ── small helpers ─────────────────────────────────────────────────────
def _gen_id(length: int = 16) -> str:
    """Return a random lowercase-hex id of exactly ``length`` characters."""
    return secrets.token_hex((length + 1) // 2)[:length]


def _stringify(value: Any) -> str:
    """Best-effort string form of an attribute value. Never raises."""
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value, default=repr)
    except Exception:
        try:
            return repr(value)
        except Exception:
            return "<unrepresentable>"


def _truncate(text: str, limit: int = MAX_IO_CHARS) -> str:
    """Clip ``text`` to ``limit`` characters, noting how much was dropped."""
    if len(text) <= limit:
        return text
    return f"{text[:limit]}… [truncated {len(text) - limit} chars]"


def _describe_exception(exc: BaseException) -> str:
    """Render an exception the way the trace UI wants to show it."""
    message = str(exc).strip()
    return f"{type(exc).__name__}: {message}" if message else type(exc).__name__


def _coerce_kind(kind: str) -> str:
    """Map an arbitrary kind onto the accepted enum (unknown -> ``function``)."""
    return kind if kind in SPAN_KINDS else "function"


def _coerce_status(status: str) -> str:
    """Map an arbitrary status onto the accepted enum (unknown -> ``ok``)."""
    return status if status in SPAN_STATUSES else "ok"


def _normalize_pairs(
    value: Mapping[str, Any] | Sequence[Any] | None,
) -> list[dict[str, str]] | None:
    """Normalize attributes/metadata to the wire's ``[{label, value}]`` shape.

    Accepts a mapping (``{"model": "sonnet"}``), a list of ``{"label", "value"}``
    dicts, or a list of ``(label, value)`` pairs. Returns ``None`` when empty.
    """
    if value is None:
        return None
    pairs: list[dict[str, str]] = []
    if isinstance(value, Mapping):
        for label, item in value.items():
            pairs.append({"label": str(label), "value": _stringify(item)})
    elif isinstance(value, (str, bytes)):
        return None
    elif isinstance(value, Sequence):
        for entry in value:
            if isinstance(entry, Mapping):
                if "label" in entry:
                    pairs.append(
                        {"label": str(entry["label"]), "value": _stringify(entry.get("value"))}
                    )
                else:
                    for label, item in entry.items():
                        pairs.append({"label": str(label), "value": _stringify(item)})
            elif isinstance(entry, Sequence) and not isinstance(entry, (str, bytes)):
                entry_list = list(entry)
                if len(entry_list) == 2:
                    pairs.append(
                        {"label": str(entry_list[0]), "value": _stringify(entry_list[1])}
                    )
    else:
        return None
    return pairs or None


def _normalize_io(io: Mapping[str, Any] | None) -> dict[str, str] | None:
    """Keep only ``input``/``output``, stringified and length-capped.

    ``None`` members are dropped rather than sent as JSON ``null`` — the ingest
    schema treats those fields as optional strings and rejects nulls.
    """
    if io is None:
        return None
    out: dict[str, str] = {}
    for key in ("input", "output"):
        value = io.get(key)
        if value is None:
            continue
        out[key] = _truncate(value if isinstance(value, str) else _stringify(value))
    return out or None


def _normalize_git(git: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Normalize a git pointer to ``{file, line, commit}``; ``None`` if unusable."""
    if git is None:
        return None
    try:
        return {
            "file": str(git.get("file") or ""),
            "line": int(git.get("line") or 0),
            "commit": str(git.get("commit") or ""),
        }
    except (TypeError, ValueError):
        return None


def _non_negative_int(value: Any) -> int | None:
    """Coerce to a non-negative int, or ``None`` when that is impossible."""
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def _non_negative_float(value: Any) -> float | None:
    """Coerce to a non-negative float, or ``None`` when that is impossible."""
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return None


def _env(*names: str) -> str | None:
    """Return the first non-empty value among ``names`` in the environment."""
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def _run_blocking(coro: Coroutine[Any, Any, bool], timeout: float) -> bool:
    """Drive a coroutine to completion from sync code. Never raises.

    Outside an event loop this is a plain ``asyncio.run``. Inside one — someone
    called sync code from an async app — it runs on a private loop in a worker
    thread so the caller's loop is never re-entered.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        try:
            return asyncio.run(coro)
        except Exception:
            return False

    result = [False]

    def _worker() -> None:
        try:
            result[0] = asyncio.run(coro)
        except Exception:
            result[0] = False

    thread = threading.Thread(target=_worker, name="causal-flush", daemon=True)
    thread.start()
    thread.join(timeout)
    return result[0]


# ── recorded span ─────────────────────────────────────────────────────
@dataclass
class _RecordedSpan:
    """The mutable record behind a :class:`CausalSpan` (wire fields only)."""

    id: str
    parent_id: str | None
    name: str
    kind: str
    start_ms: int
    duration_ms: int = 0
    status: str = "ok"
    attributes: list[dict[str, str]] | None = None
    io: dict[str, str] | None = None
    git: dict[str, Any] | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost: float | None = None
    error: str | None = None

    def to_payload(self) -> dict[str, Any]:
        """Render this span in the ingest wire format (camelCase, no nulls)."""
        payload: dict[str, Any] = {
            "id": self.id,
            "parentId": self.parent_id,
            "name": self.name,
            "kind": self.kind,
            "startMs": self.start_ms,
            "durationMs": self.duration_ms,
            "status": self.status,
        }
        if self.attributes:
            payload["attributes"] = self.attributes
        if self.io:
            payload["io"] = self.io
        if self.git:
            payload["git"] = self.git
        if self.tokens_in is not None:
            payload["tokensIn"] = self.tokens_in
        if self.tokens_out is not None:
            payload["tokensOut"] = self.tokens_out
        if self.cost is not None:
            payload["cost"] = self.cost
        if self.error:
            payload["error"] = self.error
        return payload


class CausalSpan:
    """One timed operation inside a trace.

    Created by :meth:`CausalTrace.span` or :meth:`child`; closed with
    :meth:`end`. Closing twice is a no-op, so an explicit ``end()`` inside a
    decorated function always wins over the automatic one.
    """

    __slots__ = ("_ended", "_rec", "_started", "_trace")

    def __init__(self, rec: _RecordedSpan, trace: CausalTrace) -> None:
        self._rec = rec
        self._trace = trace
        self._started = time.perf_counter()
        self._ended = False

    @property
    def id(self) -> str:
        """The span id, unique within its trace."""
        return self._rec.id

    @property
    def name(self) -> str:
        """The span name as shown in the trace timeline."""
        return self._rec.name

    @property
    def parent_id(self) -> str | None:
        """Id of the enclosing span, or ``None`` for a root span."""
        return self._rec.parent_id

    @property
    def trace(self) -> CausalTrace:
        """The trace this span belongs to."""
        return self._trace

    @property
    def ended(self) -> bool:
        """Whether :meth:`end` has already been called."""
        return self._ended

    def child(self, name: str, kind: SpanKind | str = "function") -> CausalSpan:
        """Open a span nested under this one."""
        return self._trace.span(name, kind, self._rec.id)

    def end(
        self,
        status: SpanStatus | str = "ok",
        error: str | None = None,
        attributes: Mapping[str, Any] | Sequence[Any] | None = None,
        io: Mapping[str, Any] | None = None,
        git: Mapping[str, Any] | None = None,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        cost: float | None = None,
    ) -> None:
        """Close the span, recording its duration and outcome.

        Passing ``error`` implies ``status="error"`` unless you explicitly pass
        ``"warn"``. Token counts and cost are recorded per span and rolled up to
        the trace by the API on ingest. Never raises.
        """
        if self._ended:
            return
        self._ended = True
        rec = self._rec
        rec.duration_ms = max(0, int((time.perf_counter() - self._started) * 1000))
        rec.status = _coerce_status(str(status))
        if error:
            rec.error = _truncate(str(error), 4_000)
            if rec.status == "ok":
                rec.status = "error"
        if attributes is not None:
            rec.attributes = _normalize_pairs(attributes)
        if io is not None:
            rec.io = _normalize_io(io)
        if git is not None:
            rec.git = _normalize_git(git)
        if tokens_in is not None:
            rec.tokens_in = _non_negative_int(tokens_in)
        if tokens_out is not None:
            rec.tokens_out = _non_negative_int(tokens_out)
        if cost is not None:
            rec.cost = _non_negative_float(cost)

    def __repr__(self) -> str:
        state = "ended" if self._ended else "open"
        return f"<CausalSpan {self._rec.name!r} kind={self._rec.kind} {state}>"


class CausalTrace:
    """A single agent run: an ordered bag of spans plus its economics.

    ``tokens_in``/``tokens_out``/``cost`` are trace-level fallbacks. When spans
    carry their own numbers the API sums those instead, so setting both is safe.
    """

    def __init__(self, tracer: CausalTracer, trace_id: str | None = None) -> None:
        self.trace_id: str = trace_id or _gen_id(16)
        self.tokens_in: int = 0
        self.tokens_out: int = 0
        self.cost: float = 0.0
        self.root: CausalSpan | None = None
        self._tracer = tracer
        self._spans: list[_RecordedSpan] = []
        self._ids: set[str] = set()
        self._started_at = datetime.now(timezone.utc)
        self._start = time.perf_counter()
        self._lock = threading.Lock()

    @property
    def tracer(self) -> CausalTracer:
        """The tracer that will export this trace."""
        return self._tracer

    @property
    def span_count(self) -> int:
        """How many spans have been opened on this trace."""
        with self._lock:
            return len(self._spans)

    def span(
        self,
        name: str,
        kind: SpanKind | str = "function",
        parent_id: str | None = None,
    ) -> CausalSpan:
        """Open a span.

        Pass ``parent_id`` to nest it somewhere specific; by default it hangs
        off the trace's root span, which keeps the trace a single tree — the
        product rolls token/cost totals up per subtree, and a second parentless
        span would render as a second root.
        """
        if parent_id is None and self.root is not None:
            parent_id = self.root.id
        start_ms = max(0, int((time.perf_counter() - self._start) * 1000))
        with self._lock:
            span_id = _gen_id(8)
            while span_id in self._ids:
                span_id = _gen_id(8)
            self._ids.add(span_id)
            rec = _RecordedSpan(
                id=span_id,
                parent_id=parent_id,
                name=str(name) or "span",
                kind=_coerce_kind(str(kind)),
                start_ms=start_ms,
            )
            self._spans.append(rec)
        return CausalSpan(rec, self)

    def to_payload(self) -> dict[str, Any]:
        """Render the whole trace in the ingest wire format."""
        tracer = self._tracer
        with self._lock:
            spans = [rec.to_payload() for rec in self._spans]
        payload: dict[str, Any] = {
            "traceId": self.trace_id,
            "service": tracer.service,
            "environment": tracer.environment,
            "startedAt": self._started_at.isoformat(),
            "tokensIn": _non_negative_int(self.tokens_in) or 0,
            "tokensOut": _non_negative_int(self.tokens_out) or 0,
            "cost": _non_negative_float(self.cost) or 0.0,
            "spans": spans,
        }
        optional = (
            ("model", tracer.model),
            ("repo", tracer.repo),
            ("gitRef", tracer.git_ref),
            ("user", tracer.user),
            ("sessionId", tracer.session_id),
        )
        for key, value in optional:
            if value:
                payload[key] = value
        if tracer.metadata:
            payload["metadata"] = tracer.metadata
        return payload

    async def flush(self) -> bool:
        """Ship the trace to Causal. Returns ``True`` when it was accepted.

        Ingest is idempotent on ``traceId``, so re-flushing replaces the stored
        trace rather than duplicating it. Never raises.
        """
        return await self._tracer.export(self)

    def flush_sync(self) -> bool:
        """Blocking :meth:`flush`, for code that is not async. Never raises."""
        return self._tracer.export_sync(self)

    def __repr__(self) -> str:
        return f"<CausalTrace {self.trace_id} spans={self.span_count}>"


class CausalTracer:
    """Creates traces and exports them to the Causal ingest endpoint.

    One tracer per service is enough — it holds configuration only, so it is
    safe to share across tasks and threads.
    """

    def __init__(
        self,
        service: str,
        api_key: str | None = None,
        base_url: str | None = None,
        org_id: str | None = None,
        environment: str = "production",
        model: str | None = None,
        repo: str | None = None,
        git_ref: str | None = None,
        user: str | None = None,
        session_id: str | None = None,
        metadata: Mapping[str, Any] | Sequence[Any] | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.service: str = service or _env("CAUSAL_SERVICE") or "python-agent"
        self.environment: str = environment or _env("CAUSAL_ENVIRONMENT") or "production"
        self.model: str | None = model or _env("CAUSAL_MODEL")
        self.repo: str | None = repo or _env("CAUSAL_REPO", "CAUSAL_REPO_ID")
        self.git_ref: str | None = git_ref or _env("CAUSAL_GIT_REF")
        self.user: str | None = user or _env("CAUSAL_USER")
        self.session_id: str | None = session_id or _env("CAUSAL_SESSION_ID")
        self.metadata: list[dict[str, str]] | None = _normalize_pairs(metadata)
        self.api_key: str = api_key or os.environ.get("CAUSAL_API_KEY", "")
        self.base_url: str = (
            base_url or os.environ.get("CAUSAL_API_URL", _DEFAULT_BASE_URL)
        ).rstrip("/")
        self.org_id: str = org_id or os.environ.get("CAUSAL_ORG_ID", "default")
        self.timeout: float = timeout

    @property
    def enabled(self) -> bool:
        """Whether exports actually leave the process.

        False when there is no API key, or when ``CAUSAL_DISABLED`` is set —
        spans are still recorded so instrumentation stays exercised in tests.
        """
        if str(os.environ.get("CAUSAL_DISABLED", "")).lower() in _TRUTHY:
            return False
        return bool(self.api_key)

    def start_trace(self, trace_id: str | None = None) -> CausalTrace:
        """Create an empty trace. You own flushing it."""
        return CausalTrace(self, trace_id)

    def trace(
        self,
        name: str | Callable[..., Any],
        kind: SpanKind | str = "agent",
        trace_id: str | None = None,
    ) -> Any:
        """Run something as one traced run — opens a root span, flushes at the end.

        Usable three ways::

            async with tracer.trace("run") as t:      # async context manager
                ...

            @tracer.trace("run")                      # decorator (async or sync)
            async def run(): ...

            @tracer.trace                             # bare decorator
            def run(): ...

        The root span is closed as ``error`` if the block raises, and the
        exception is re-raised untouched.
        """
        if callable(name) and not isinstance(name, str):
            fn = name
            run = _TraceRun(self, getattr(fn, "__qualname__", None) or "run", kind, trace_id)
            return run(fn)
        return _TraceRun(self, str(name), kind, trace_id)

    @contextmanager
    def trace_sync(
        self,
        name: str,
        kind: SpanKind | str = "agent",
        trace_id: str | None = None,
    ) -> Iterator[CausalTrace]:
        """Blocking twin of :meth:`trace` for non-async code.

        ::

            with tracer.trace_sync("nightly_reconcile") as t:
                t.span("db.query", "db").end()

        The export happens on exit. Called from inside a running event loop it
        runs on a worker thread, so the loop is never re-entered.
        """
        run = _TraceRun(self, name, kind, trace_id)
        trace = run.begin()
        try:
            yield trace
        except BaseException as exc:
            run.finish(exc)
            raise
        else:
            run.finish(None)
        finally:
            run.release()
            trace.flush_sync()

    async def export(self, trace: CausalTrace) -> bool:
        """POST a trace to ``/api/v1/traces``. Never raises.

        Returns ``True`` when the API accepted it, ``False`` on any failure or
        when the tracer is disabled.
        """
        if not self.enabled:
            return False
        try:
            payload = trace.to_payload()
            async with httpx.AsyncClient(timeout=self.timeout, headers=self._headers()) as client:
                response = await client.post(f"{self.base_url}/api/v1/traces", json=payload)
            return 200 <= response.status_code < 300
        except Exception:
            # Telemetry must never break the host app.
            return False

    def export_sync(self, trace: CausalTrace) -> bool:
        """Blocking :meth:`export`, for code that is not async. Never raises."""
        if not self.enabled:
            return False
        return _run_blocking(self.export(trace), self.timeout + 5.0)

    def _headers(self) -> dict[str, str]:
        """Auth + identity headers for the ingest call."""
        headers = {
            "Content-Type": "application/json",
            "User-Agent": _USER_AGENT,
            "x-causal-org-id": self.org_id,
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def __repr__(self) -> str:
        return (
            f"<CausalTracer service={self.service!r} env={self.environment!r} "
            f"enabled={self.enabled}>"
        )


class _TraceRun:
    """Handle returned by :meth:`CausalTracer.trace`.

    The same object is an async context manager and a decorator; each decorated
    call gets its own fresh run.
    """

    __slots__ = ("_kind", "_name", "_root", "_tokens", "_trace", "_trace_id", "_tracer")

    def __init__(
        self,
        tracer: CausalTracer,
        name: str,
        kind: SpanKind | str = "agent",
        trace_id: str | None = None,
    ) -> None:
        self._tracer = tracer
        self._name = name
        self._kind = kind
        self._trace_id = trace_id
        self._trace: CausalTrace | None = None
        self._root: CausalSpan | None = None
        self._tokens: tuple[Token[Any], Token[Any]] | None = None

    # ── lifecycle (shared by the async and sync entry points) ─────────
    def begin(self) -> CausalTrace:
        """Start the trace, open its root span and make both ambient."""
        trace = self._tracer.start_trace(self._trace_id)
        root = trace.span(self._name, self._kind, None)
        trace.root = root
        self._trace, self._root = trace, root
        self._tokens = (_current_trace.set(trace), _current_span.set(root))
        return trace

    def finish(self, exc: BaseException | None) -> None:
        """Close the root span, marking it failed when the block raised."""
        if self._root is None:
            return
        if exc is None:
            self._root.end()
        else:
            self._root.end(status="error", error=_describe_exception(exc))

    def release(self) -> None:
        """Drop the ambient trace/span bindings."""
        if self._tokens is None:
            return
        trace_token, span_token = self._tokens
        self._tokens = None
        _reset_var(_current_span, span_token)
        _reset_var(_current_trace, trace_token)

    # ── async context manager ─────────────────────────────────────────
    async def __aenter__(self) -> CausalTrace:
        return self.begin()

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        self.finish(exc)
        trace = self._trace
        self.release()
        if trace is not None:
            await trace.flush()
        return False  # never swallow the caller's exception

    # ── decorator ─────────────────────────────────────────────────────
    def __call__(self, fn: F) -> F:
        """Wrap ``fn`` so every call becomes its own trace."""
        name = self._name or getattr(fn, "__qualname__", None) or "run"
        tracer, kind, trace_id = self._tracer, self._kind, self._trace_id

        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                async with _TraceRun(tracer, name, kind, trace_id):
                    return await fn(*args, **kwargs)

            return cast(F, async_wrapper)

        @functools.wraps(fn)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            with tracer.trace_sync(name, kind, trace_id):
                return fn(*args, **kwargs)

        return cast(F, sync_wrapper)


# ── process-wide default tracer (used by @observe) ────────────────────
_default_tracer: CausalTracer | None = None
_default_tracer_lock = threading.Lock()


def get_default_tracer() -> CausalTracer:
    """The tracer ``@observe`` falls back to when no trace is active.

    Configured from the environment on first use (``CAUSAL_SERVICE`` names the
    service); call :func:`set_default_tracer` to install your own.
    """
    global _default_tracer
    if _default_tracer is None:
        with _default_tracer_lock:
            if _default_tracer is None:
                _default_tracer = CausalTracer(service=_env("CAUSAL_SERVICE") or "python-agent")
    return _default_tracer


def set_default_tracer(tracer: CausalTracer | None) -> None:
    """Install (or clear, with ``None``) the process-wide default tracer."""
    global _default_tracer
    with _default_tracer_lock:
        _default_tracer = tracer
