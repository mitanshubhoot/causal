"""
Shared plumbing for the Causal provider integrations: span targeting, model
pricing, usage extraction, safe stringification and lazy optional imports.

Nothing in this module imports a third-party SDK and nothing in it raises —
telemetry must never be the reason a host application fails. Every helper that
touches user data or the tracer swallows its own errors and degrades to a
no-op.

The tracer is accepted structurally: anything exposing `start_trace()`,
`span(name, kind)` or `child(name, kind)` works, which keeps the integrations
independent of the tracer's exact class.

Usage (from an integration module):

    from ._tracing import open_span, estimate_cost, build_io, attrs

    handle = open_span(target, "openai.chat.completions.create", "llm")
    handle.end(status="ok", tokens_in=1200, tokens_out=340, cost=0.014)
    handle.finish()   # flushes only if this handle created the trace
"""

from __future__ import annotations

import asyncio
import importlib
import inspect
import json
from collections.abc import Mapping
from typing import Any, Iterable, Protocol, runtime_checkable

__all__ = [
    "MODEL_PRICES",
    "ModelPrice",
    "SpanHandle",
    "SpanLike",
    "TraceLike",
    "TracerLike",
    "attrs",
    "build_io",
    "err_message",
    "estimate_cost",
    "num",
    "open_span",
    "pick",
    "pick_path",
    "price_for",
    "require",
    "round_cost",
    "stringify",
    "truncate",
]


# ── structural tracer contract ────────────────────────────────────────


@runtime_checkable
class SpanLike(Protocol):
    """A span opened by `CausalTracer`."""

    @property
    def id(self) -> str: ...

    def child(self, name: str, kind: str) -> "SpanLike": ...

    def end(self, **kwargs: Any) -> None: ...


@runtime_checkable
class TraceLike(Protocol):
    """A trace opened by `CausalTracer.start_trace()`."""

    def span(self, name: str, kind: str = "function") -> SpanLike: ...

    def flush(self) -> Any: ...


@runtime_checkable
class TracerLike(Protocol):
    """The tracer itself."""

    def start_trace(self) -> TraceLike: ...


# A tracer, a live trace, or a parent span — every wrapper accepts all three.
SpanTarget = Any


# ── pricing ───────────────────────────────────────────────────────────


class ModelPrice:
    """USD per 1,000,000 tokens."""

    __slots__ = ("input", "output")

    def __init__(self, input: float, output: float) -> None:  # noqa: A002 - mirrors the wire name
        self.input = input
        self.output = output

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"ModelPrice(input={self.input}, output={self.output})"


#: Per-1M-token list prices, USD. Deliberately small: enough to cost the models
#: teams actually ship, with a safe default of 0 for everything else so an
#: unknown model reports honest zero cost instead of a wrong number.
#:
#: Keys match by longest prefix, so dated snapshots resolve too
#: (``gpt-4o-2024-08-06`` -> ``gpt-4o``, ``claude-sonnet-4-5-20250929`` -> ``claude-sonnet-4-5``).
MODEL_PRICES: dict[str, ModelPrice] = {
    # ── OpenAI ────────────────────────────────────────────────────────
    "gpt-5": ModelPrice(1.25, 10.0),
    "gpt-5-mini": ModelPrice(0.25, 2.0),
    "gpt-5-nano": ModelPrice(0.05, 0.4),
    "gpt-4.1": ModelPrice(2.0, 8.0),
    "gpt-4.1-mini": ModelPrice(0.4, 1.6),
    "gpt-4.1-nano": ModelPrice(0.1, 0.4),
    "gpt-4o": ModelPrice(2.5, 10.0),
    "gpt-4o-mini": ModelPrice(0.15, 0.6),
    "gpt-4-turbo": ModelPrice(10.0, 30.0),
    "gpt-3.5-turbo": ModelPrice(0.5, 1.5),
    "o3": ModelPrice(2.0, 8.0),
    "o3-mini": ModelPrice(1.1, 4.4),
    "o4-mini": ModelPrice(1.1, 4.4),
    "text-embedding-3-small": ModelPrice(0.02, 0.0),
    "text-embedding-3-large": ModelPrice(0.13, 0.0),
    # ── Anthropic ─────────────────────────────────────────────────────
    "claude-fable-5": ModelPrice(10.0, 50.0),
    "claude-mythos-5": ModelPrice(10.0, 50.0),
    "claude-opus-5": ModelPrice(5.0, 25.0),
    "claude-opus-4-8": ModelPrice(5.0, 25.0),
    "claude-opus-4-7": ModelPrice(5.0, 25.0),
    "claude-opus-4-6": ModelPrice(5.0, 25.0),
    "claude-opus-4-5": ModelPrice(5.0, 25.0),
    "claude-opus-4-1": ModelPrice(15.0, 75.0),
    "claude-opus-4-0": ModelPrice(15.0, 75.0),
    "claude-sonnet-5": ModelPrice(3.0, 15.0),
    "claude-sonnet-4-6": ModelPrice(3.0, 15.0),
    "claude-sonnet-4-5": ModelPrice(3.0, 15.0),
    "claude-sonnet-4-0": ModelPrice(3.0, 15.0),
    "claude-haiku-4-5": ModelPrice(1.0, 5.0),
    # ── Google ────────────────────────────────────────────────────────
    "gemini-2.5-pro": ModelPrice(1.25, 10.0),
    "gemini-2.5-flash": ModelPrice(0.3, 2.5),
}

_ZERO_PRICE = ModelPrice(0.0, 0.0)

_REGION_PREFIXES = ("us.", "eu.", "apac.", "global.")


def _normalize_model(model: str) -> str:
    """Strip gateway/region decoration so the price table matches.

    ``openai/gpt-4o``, ``us.anthropic.claude-opus-5``,
    ``claude-opus-4-5@20251101`` and ``models/gemini-2.5-pro`` all normalise.
    """
    model_id = model.strip().lower()
    if "/" in model_id:
        model_id = model_id.rsplit("/", 1)[1]
    for prefix in _REGION_PREFIXES:
        if model_id.startswith(prefix):
            model_id = model_id[len(prefix) :]
            break
    if model_id.startswith("anthropic."):
        model_id = model_id[len("anthropic.") :]
    if "@" in model_id:
        model_id = model_id.split("@", 1)[0]
    return model_id


def price_for(model: str | None, prices: Mapping[str, ModelPrice] | None = None) -> ModelPrice:
    """Look up per-1M-token pricing. Unknown models price at 0 — never a guess."""
    if not model:
        return _ZERO_PRICE
    table: dict[str, ModelPrice] = dict(MODEL_PRICES)
    if prices:
        table.update(prices)
    model_id = _normalize_model(model)
    exact = table.get(model_id)
    if exact is not None:
        return exact
    best: ModelPrice | None = None
    best_len = 0
    for key, price in table.items():
        if len(key) > best_len and model_id.startswith(key):
            best, best_len = price, len(key)
    return best or _ZERO_PRICE


def round_cost(cost: float) -> float:
    """Round to 8dp so float noise never reaches the ingest endpoint."""
    if cost <= 0 or cost != cost or cost in (float("inf"), float("-inf")):
        return 0.0
    return round(cost, 8)


def estimate_cost(
    model: str | None,
    tokens_in: int,
    tokens_out: int,
    prices: Mapping[str, ModelPrice] | None = None,
) -> float:
    """Straight in/out cost. Providers with cache tiers compute their own."""
    price = price_for(model, prices)
    return round_cost((tokens_in * price.input + tokens_out * price.output) / 1_000_000)


# ── span targeting ────────────────────────────────────────────────────


class SpanHandle:
    """A span an integration owns, plus the flush it may owe.

    `end()` and `finish()` never raise: a mis-wired integration degrades to
    "no telemetry", never to "broken app".
    """

    __slots__ = ("span", "_owned_trace", "_ended")

    def __init__(self, span: Any = None, owned_trace: Any = None) -> None:
        self.span = span
        self._owned_trace = owned_trace
        self._ended = False

    @property
    def active(self) -> bool:
        return self.span is not None

    def child(self, name: str, kind: str) -> "SpanHandle":
        """Open a nested span under this one, inheriting trace ownership."""
        if self.span is None:
            return SpanHandle(None)
        try:
            return SpanHandle(self.span.child(name, kind))
        except Exception:
            return SpanHandle(None)

    def end(self, **kwargs: Any) -> None:
        """Close the span. Extra keyword arguments are forwarded to `span.end`."""
        if self.span is None or self._ended:
            return
        self._ended = True
        cleaned = {key: value for key, value in kwargs.items() if value is not None}
        try:
            self.span.end(**cleaned)
            return
        except TypeError:
            pass
        except Exception:
            return
        # Older tracers may not accept per-span economics. Retry without them,
        # folding the numbers into attributes so the data is not lost.
        keys = ("tokens_in", "tokens_out", "cost")
        economics = {key: cleaned.pop(key) for key in keys if key in cleaned}
        if economics:
            attributes = list(cleaned.get("attributes") or [])
            attributes.extend(
                {"label": key, "value": str(value)} for key, value in economics.items()
            )
            cleaned["attributes"] = attributes
        try:
            self.span.end(**cleaned)
        except Exception:
            return

    def finish(self) -> None:
        """Flush the trace, but only if this handle created it. Never raises."""
        if self._owned_trace is None:
            return
        _flush_trace(self._owned_trace)

    async def afinish(self) -> None:
        """Await the flush from async code. Never raises."""
        if self._owned_trace is None:
            return
        try:
            result = self._owned_trace.flush()
            if inspect.isawaitable(result):
                await result
        except Exception:
            return


def _flush_trace(trace: Any) -> None:
    """Flush a trace from sync code, whether or not a loop is running."""
    flush = getattr(trace, "flush", None)
    if flush is None:
        return
    try:
        result = flush()
    except Exception:
        return
    if not inspect.isawaitable(result):
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        try:
            asyncio.run(result)
        except Exception:
            pass
        return
    task = loop.create_task(result)
    task.add_done_callback(_swallow_task_error)


def _swallow_task_error(task: "asyncio.Task[Any]") -> None:
    try:
        if not task.cancelled():
            task.exception()
    except Exception:
        pass


def open_span(target: SpanTarget, name: str, kind: str = "llm", parent: Any = None) -> SpanHandle:
    """Open a span against whatever the caller handed us.

    * a span (has ``child``)        -> a child of that span
    * a trace (has ``span``)        -> a span on that trace
    * a tracer (has ``start_trace``) -> a fresh one-span trace, flushed on ``finish()``

    Returns an inert handle rather than raising when the target is unusable.
    """
    try:
        if parent is not None and hasattr(parent, "child"):
            return SpanHandle(parent.child(name, kind))
        if target is None:
            return SpanHandle(None)
        if hasattr(target, "child"):
            return SpanHandle(target.child(name, kind))
        if hasattr(target, "span"):
            return SpanHandle(target.span(name, kind))
        start_trace = getattr(target, "start_trace", None) or getattr(target, "startTrace", None)
        if callable(start_trace):
            trace = start_trace()
            return SpanHandle(trace.span(name, kind), owned_trace=trace)
    except Exception:
        pass
    return SpanHandle(None)


# ── value helpers ─────────────────────────────────────────────────────


def pick(value: Any, key: str) -> Any:
    """Read `key` off a mapping or an object without assuming which it is.

    Provider SDKs return pydantic models, dataclasses and plain dicts
    interchangeably; this papers over all three.
    """
    if value is None:
        return None
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def pick_path(value: Any, *keys: str) -> Any:
    """Read a nested path, short-circuiting on the first missing hop."""
    cursor = value
    for key in keys:
        cursor = pick(cursor, key)
        if cursor is None:
            return None
    return cursor


def num(value: Any) -> int | float | None:
    """Finite numbers only — bools, strings and NaN become `None`."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value != value or value in (float("inf"), float("-inf")):
        return None
    return value


def as_int(value: Any, default: int = 0) -> int:
    number = num(value)
    return int(number) if number is not None else default


def as_str(value: Any) -> str | None:
    """Non-empty strings only."""
    if isinstance(value, str) and value:
        return value
    return None


def _json_default(obj: Any) -> Any:
    for attribute in ("model_dump", "dict", "to_dict"):
        method = getattr(obj, attribute, None)
        if callable(method):
            try:
                return method()
            except Exception:
                continue
    return str(obj)


def stringify(value: Any) -> str:
    """JSON with pydantic/dataclass and circular-reference protection."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, default=_json_default, ensure_ascii=False)
    except Exception:
        try:
            return repr(value)
        except Exception:
            return "<unserializable>"


def truncate(text: str, max_chars: int) -> str:
    """Clip long prompts/completions so a trace payload stays sane."""
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}\n… [truncated {len(text) - max_chars} chars]"


def attrs(record: Mapping[str, Any]) -> list[dict[str, str]]:
    """Build the `{label, value}` attribute shape, dropping empty entries."""
    out: list[dict[str, str]] = []
    for label, value in record.items():
        if value is None or value == "":
            continue
        out.append({"label": label, "value": value if isinstance(value, str) else str(value)})
    return out


def build_io(
    input_text: str,
    output_text: str,
    *,
    capture_io: bool = True,
    max_io_chars: int = 4000,
) -> dict[str, str] | None:
    """Build the `io` payload honouring `capture_io` / `max_io_chars`."""
    if not capture_io:
        return None
    io: dict[str, str] = {}
    if input_text:
        io["input"] = truncate(input_text, max_io_chars)
    if output_text:
        io["output"] = truncate(output_text, max_io_chars)
    return io or None


def err_message(exc: BaseException | Any) -> str:
    """Human-readable message for anything that lands in an `except`."""
    if isinstance(exc, BaseException):
        detail = str(exc)
        return f"{type(exc).__name__}: {detail}" if detail else type(exc).__name__
    return stringify(exc) or "unknown error"


def join_lines(lines: Iterable[str]) -> str:
    return "\n".join(line for line in lines if line)


# ── attribute proxy ───────────────────────────────────────────────────


class TracedProxy:
    """Forward every attribute to `wrapped`, except the ones in `overrides`.

    Used to swap a single SDK method for an instrumented one without mutating
    the caller's client: an un-instrumented reference to the same client keeps
    working, and two tracers can wrap the same client independently.
    """

    __slots__ = ("_causal_wrapped", "_causal_overrides")

    def __init__(self, wrapped: Any, overrides: Mapping[str, Any]) -> None:
        object.__setattr__(self, "_causal_wrapped", wrapped)
        object.__setattr__(self, "_causal_overrides", dict(overrides))

    def __getattr__(self, name: str) -> Any:
        overrides = object.__getattribute__(self, "_causal_overrides")
        if name in overrides:
            return overrides[name]
        return getattr(object.__getattribute__(self, "_causal_wrapped"), name)

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(object.__getattribute__(self, "_causal_wrapped"), name, value)

    def __delattr__(self, name: str) -> None:
        delattr(object.__getattribute__(self, "_causal_wrapped"), name)

    def __dir__(self) -> list[str]:
        overrides = object.__getattribute__(self, "_causal_overrides")
        return sorted(set(dir(object.__getattribute__(self, "_causal_wrapped"))) | set(overrides))

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<causal-traced {object.__getattribute__(self, '_causal_wrapped')!r}>"

    # Context-manager passthrough — dunder lookups skip __getattr__.
    def __enter__(self) -> "TracedProxy":
        object.__getattribute__(self, "_causal_wrapped").__enter__()
        return self

    def __exit__(self, *exc_info: Any) -> Any:
        return object.__getattribute__(self, "_causal_wrapped").__exit__(*exc_info)

    async def __aenter__(self) -> "TracedProxy":
        await object.__getattribute__(self, "_causal_wrapped").__aenter__()
        return self

    async def __aexit__(self, *exc_info: Any) -> Any:
        return await object.__getattribute__(self, "_causal_wrapped").__aexit__(*exc_info)


class TracedStream:
    """Tee every chunk of a provider stream, closing the span exactly once.

    Wraps both sync (`Stream`) and async (`AsyncStream`) provider streams and
    forwards everything else — `.response`, `.close()`, `with` — untouched.
    """

    __slots__ = ("_stream", "_on_chunk", "_on_done", "_settled")

    def __init__(self, stream: Any, on_chunk: Any, on_done: Any) -> None:
        object.__setattr__(self, "_stream", stream)
        object.__setattr__(self, "_on_chunk", on_chunk)
        object.__setattr__(self, "_on_done", on_done)
        object.__setattr__(self, "_settled", False)

    def _chunk(self, chunk: Any) -> None:
        try:
            object.__getattribute__(self, "_on_chunk")(chunk)
        except Exception:
            pass  # a malformed chunk must not stop the stream

    def _done(self, error: BaseException | None = None) -> None:
        if object.__getattribute__(self, "_settled"):
            return
        object.__setattr__(self, "_settled", True)
        try:
            object.__getattribute__(self, "_on_done")(error)
        except Exception:
            pass  # never let bookkeeping break the stream

    def __iter__(self) -> Any:
        stream = object.__getattribute__(self, "_stream")
        try:
            for chunk in stream:
                self._chunk(chunk)
                yield chunk
        except GeneratorExit:
            # the consumer broke out of the loop — a clean stop, not a failure
            self._done(None)
            raise
        except BaseException as exc:
            self._done(exc)
            raise
        finally:
            self._done(None)

    async def __aiter__(self) -> Any:
        stream = object.__getattribute__(self, "_stream")
        try:
            async for chunk in stream:
                self._chunk(chunk)
                yield chunk
        except GeneratorExit:
            self._done(None)
            raise
        except BaseException as exc:
            self._done(exc)
            raise
        finally:
            self._done(None)

    def __getattr__(self, name: str) -> Any:
        return getattr(object.__getattribute__(self, "_stream"), name)

    def close(self) -> Any:
        """Explicit close — also the escape hatch for a partially read stream.

        Breaking out of an `async for` does not finalize the generator until the
        event loop's async-generator hook runs, which can be after the trace has
        flushed. Calling `close()` / `aclose()` (or using the stream as a context
        manager) closes the span deterministically.
        """
        self._done(None)
        stream_close = getattr(object.__getattribute__(self, "_stream"), "close", None)
        return stream_close() if callable(stream_close) else None

    async def aclose(self) -> Any:
        self._done(None)
        stream_aclose = getattr(object.__getattribute__(self, "_stream"), "aclose", None)
        if callable(stream_aclose):
            return await stream_aclose()
        stream_close = getattr(object.__getattribute__(self, "_stream"), "close", None)
        if callable(stream_close):
            result = stream_close()
            if inspect.isawaitable(result):
                return await result
            return result
        return None

    def __enter__(self) -> "TracedStream":
        object.__getattribute__(self, "_stream").__enter__()
        return self

    def __exit__(self, *exc_info: Any) -> Any:
        self._done(None)
        return object.__getattribute__(self, "_stream").__exit__(*exc_info)

    async def __aenter__(self) -> "TracedStream":
        await object.__getattribute__(self, "_stream").__aenter__()
        return self

    async def __aexit__(self, *exc_info: Any) -> Any:
        self._done(None)
        return await object.__getattribute__(self, "_stream").__aexit__(*exc_info)


# ── lazy optional imports ─────────────────────────────────────────────


def require(module: str, extra: str, *, pip_name: str | None = None) -> Any:
    """Import an optional dependency, with a clear message when it is missing.

    Integrations call this *inside* functions, never at module import time, so
    importing `causal_sdk.integrations` never drags in a framework the host
    application does not use.
    """
    try:
        return importlib.import_module(module)
    except ImportError as exc:
        package = pip_name or module.split(".")[0]
        raise ImportError(
            f"{module!r} is required for this Causal integration. "
            f"Install it with: pip install 'causal-sdk[{extra}]'  "
            f"(or directly: pip install {package})"
        ) from exc
