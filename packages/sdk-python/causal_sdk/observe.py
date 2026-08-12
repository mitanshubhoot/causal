"""
``@observe`` — turn any function into a span on the ambient Causal trace.

Nesting is automatic: the decorator reads the current trace and span from
contextvars, so a decorated function called from another decorated function
becomes its child. Sync functions, async functions, generators and async
generators are all handled — the span covers the full iteration for generators.

    from causal_sdk import CausalTracer, observe

    @observe(kind="tool")
    def search_flights(origin: str, dest: str) -> list[dict]:
        ...

    @observe(kind="llm")
    async def plan(prompt: str) -> str:
        ...

    tracer = CausalTracer(service="booking-agent")

    async with tracer.trace("booking_agent.run"):
        await plan("book me a flight")     # nested under the root span

Outside a trace, ``@observe`` starts one with the default tracer and flushes it
when the outermost decorated call returns — so a lone decorated function is
still a complete, exportable trace. Point that fallback at your own tracer
with ``causal_sdk.tracer.set_default_tracer(...)``.

Like the rest of the SDK this never breaks the host app: capture failures are
swallowed and the wrapped function's return value and exceptions pass through
untouched.
"""

from __future__ import annotations

import functools
import inspect
import json
from collections.abc import AsyncIterator, Callable, Iterator, Mapping
from contextlib import asynccontextmanager, contextmanager
from typing import Any, TypeVar, cast

from .tracer import (
    CausalSpan,
    SpanKind,
    _describe_exception,
    _truncate,
    _use_span,
    current_span,
    current_trace,
    get_default_tracer,
)

__all__ = ["observe"]

#: I/O captured by ``@observe`` is a debugging aid, not an archive — keep it
#: small so instrumenting a hot path stays cheap.
MAX_CAPTURE_CHARS = 2_000

F = TypeVar("F", bound=Callable[..., Any])


def observe(
    name: str | Callable[..., Any] | None = None,
    kind: SpanKind | str = "function",
    capture_io: bool = True,
) -> Any:
    """Record every call to the decorated function as a span.

    Args:
        name: Span name. Defaults to the function's qualified name. May also be
            the function itself, so bare ``@observe`` works.
        kind: Span kind — ``llm``, ``tool``, ``http``, ``db``, ``agent``,
            ``function`` (default), ``skill``, ``workflow``, ``search``,
            ``shell``.
        capture_io: Record the arguments and return value on the span (clipped
            to :data:`MAX_CAPTURE_CHARS`). Turn off for sensitive payloads.

    Returns:
        The decorated function, or a decorator when called with arguments.
    """
    if callable(name) and not isinstance(name, str):
        return _decorate(name, None, kind, capture_io)

    def decorator(fn: F) -> F:
        return _decorate(fn, name, kind, capture_io)

    return decorator


# ── capture plumbing ──────────────────────────────────────────────────
class _Capture:
    """One observed call: the span it opened plus the I/O recorded around it."""

    __slots__ = ("input", "output", "span")

    def __init__(self, span: CausalSpan, span_input: str | None) -> None:
        self.span = span
        self.input = span_input
        self.output: str | None = None


def _close(capture: _Capture, exc: BaseException | None) -> None:
    """End the span, attaching captured I/O and the failure (if any).

    ``GeneratorExit`` is not a failure — it just means the consumer stopped
    iterating early — so it closes the span as ``ok``.
    """
    io: dict[str, str] = {}
    if capture.input:
        io["input"] = capture.input
    if capture.output is not None:
        io["output"] = capture.output
    if exc is None or isinstance(exc, GeneratorExit):
        capture.span.end(io=io or None)
    else:
        capture.span.end(status="error", error=_describe_exception(exc), io=io or None)


@contextmanager
def _sync_scope(name: str, kind: SpanKind | str, span_input: str | None) -> Iterator[_Capture]:
    """Open a span on the ambient trace, or own a whole trace if there is none."""
    trace = current_trace()
    if trace is None:
        with get_default_tracer().trace_sync(name, kind) as owned:
            capture = _Capture(owned.root or owned.span(name, kind), span_input)
            try:
                yield capture
            except BaseException as exc:
                _close(capture, exc)
                raise
            _close(capture, None)
        return

    parent = current_span() or trace.root
    span = trace.span(name, kind, parent.id if parent is not None else None)
    with _use_span(span):
        capture = _Capture(span, span_input)
        try:
            yield capture
        except BaseException as exc:
            _close(capture, exc)
            raise
        _close(capture, None)


@asynccontextmanager
async def _async_scope(
    name: str,
    kind: SpanKind | str,
    span_input: str | None,
) -> AsyncIterator[_Capture]:
    """Async twin of :func:`_sync_scope` — flushes an owned trace with ``await``."""
    trace = current_trace()
    if trace is None:
        async with get_default_tracer().trace(name, kind) as owned:
            capture = _Capture(owned.root or owned.span(name, kind), span_input)
            try:
                yield capture
            except BaseException as exc:
                _close(capture, exc)
                raise
            _close(capture, None)
        return

    parent = current_span() or trace.root
    span = trace.span(name, kind, parent.id if parent is not None else None)
    with _use_span(span):
        capture = _Capture(span, span_input)
        try:
            yield capture
        except BaseException as exc:
            _close(capture, exc)
            raise
        _close(capture, None)


def _format_value(value: Any) -> str:
    """Render a value for the span's I/O panel. Never raises."""
    if isinstance(value, str):
        return _truncate(value, MAX_CAPTURE_CHARS)
    try:
        return _truncate(json.dumps(value, default=repr), MAX_CAPTURE_CHARS)
    except Exception:
        try:
            return _truncate(repr(value), MAX_CAPTURE_CHARS)
        except Exception:
            return "<unrepresentable>"


def _format_call(args: tuple[Any, ...], kwargs: Mapping[str, Any]) -> str | None:
    """Render the call's arguments as ``a, b, key=value``. Never raises."""
    try:
        parts = [_format_value(arg) for arg in args]
        parts.extend(f"{key}={_format_value(value)}" for key, value in kwargs.items())
        return _truncate(", ".join(parts), MAX_CAPTURE_CHARS) or None
    except Exception:
        return None


def _decorate(fn: F, name: str | None, kind: SpanKind | str, capture_io: bool) -> F:
    """Build the right wrapper for whatever kind of callable ``fn`` is."""
    span_name = name or getattr(fn, "__qualname__", None) or getattr(fn, "__name__", "function")

    if inspect.isasyncgenfunction(fn):

        @functools.wraps(fn)
        async def async_gen_wrapper(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
            span_input = _format_call(args, kwargs) if capture_io else None
            async with _async_scope(span_name, kind, span_input) as capture:
                yielded = 0
                inner = fn(*args, **kwargs)
                try:
                    async for item in inner:
                        yielded += 1
                        yield item
                finally:
                    aclose = getattr(inner, "aclose", None)
                    if aclose is not None:
                        try:
                            await aclose()
                        except Exception:
                            pass
                if capture_io:
                    capture.output = f"<{yielded} items yielded>"

        return cast(F, async_gen_wrapper)

    if inspect.iscoroutinefunction(fn):

        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            span_input = _format_call(args, kwargs) if capture_io else None
            async with _async_scope(span_name, kind, span_input) as capture:
                result = await fn(*args, **kwargs)
                if capture_io:
                    capture.output = _format_value(result)
                return result

        return cast(F, async_wrapper)

    if inspect.isgeneratorfunction(fn):

        @functools.wraps(fn)
        def gen_wrapper(*args: Any, **kwargs: Any) -> Iterator[Any]:
            span_input = _format_call(args, kwargs) if capture_io else None
            with _sync_scope(span_name, kind, span_input) as capture:
                # `yield from` keeps send()/throw()/close() and the generator's
                # return value flowing through untouched.
                result = yield from fn(*args, **kwargs)
                if capture_io and result is not None:
                    capture.output = _format_value(result)
                return result

        return cast(F, gen_wrapper)

    @functools.wraps(fn)
    def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        span_input = _format_call(args, kwargs) if capture_io else None
        with _sync_scope(span_name, kind, span_input) as capture:
            result = fn(*args, **kwargs)
            if capture_io:
                capture.output = _format_value(result)
            return result

    return cast(F, sync_wrapper)
