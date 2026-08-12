"""
wrap_anthropic — instrument an Anthropic client so every model call emits a
Causal `llm` span carrying the model, the prompt/completion io, and tokens and
cost read off `usage.input_tokens` / `usage.output_tokens`.

Cache tiers are priced correctly: `cache_read_input_tokens` bill at 0.1x the
input rate and `cache_creation_input_tokens` at 1.25x, so a cache-heavy agent
does not show a fictional bill. `tokens_in` reports the *total* prompt size
(fresh + cache read + cache write), matching how the API bills you.

The client is accepted structurally (duck-typed), so `causal-sdk` never takes a
dependency on `anthropic` — `Anthropic`, `AsyncAnthropic`, `AnthropicBedrock`
and `AnthropicVertex` all work.

Usage:

    import anthropic
    from causal_sdk import CausalTracer
    from causal_sdk.integrations.anthropic import wrap_anthropic

    tracer = CausalTracer(service="research-agent")

    async def main() -> None:
        t = tracer.start_trace()
        root = t.span("research_agent.run", "agent")

        client = wrap_anthropic(anthropic.Anthropic(), t, parent=root)

        # one `llm` span, nested under the run's root span
        msg = client.messages.create(
            model="claude-opus-5",
            max_tokens=16000,
            messages=[{"role": "user", "content": "Summarise this incident."}],
        )

        root.end(status="ok")
        await t.flush()

Streaming (`messages.create(stream=True)`) is instrumented too: the span closes
when the stream finishes, errors, or the consumer breaks out of the loop.
"""

from __future__ import annotations

import functools
import inspect
from collections.abc import Mapping
from typing import Any, Callable

from ._tracing import (
    ModelPrice,
    SpanHandle,
    SpanTarget,
    TracedProxy,
    TracedStream,
    as_int,
    as_str,
    attrs,
    build_io,
    err_message,
    num,
    open_span,
    pick,
    pick_path,
    price_for,
    round_cost,
    stringify,
)

__all__ = ["wrap_anthropic"]

#: Anthropic bills cache reads at 0.1x and cache writes at 1.25x the input rate.
CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25


# ── prompt / completion rendering ─────────────────────────────────────


def _render_content(content: Any) -> str:
    """Render a content value: a string, or Anthropic's block list."""
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    if not isinstance(content, (list, tuple)):
        return stringify(content)

    lines: list[str] = []
    for block in content:
        block_type = pick(block, "type")
        if block_type == "text":
            lines.append(str(pick(block, "text") or ""))
        elif block_type == "thinking":
            lines.append(f"[thinking] {pick(block, 'thinking') or ''}")
        elif block_type == "redacted_thinking":
            lines.append("[thinking redacted]")
        elif block_type == "tool_use":
            name = pick(block, "name") or ""
            lines.append(f"[tool_use {name}] {stringify(pick(block, 'input'))}")
        elif block_type == "tool_result":
            lines.append(f"[tool_result] {_render_content(pick(block, 'content'))}")
        elif block_type in ("image", "document"):
            lines.append(f"[{block_type}]")
        else:
            lines.append(f"[{block_type or 'block'}]")
    return "\n".join(line for line in lines if line)


def _render_input(params: Mapping[str, Any]) -> str:
    """Flatten `system` + `messages` into a readable transcript."""
    lines: list[str] = []
    system = params.get("system")
    if system is not None:
        rendered = _render_content(system)
        if rendered:
            lines.append(f"system: {rendered}")
    messages = params.get("messages")
    if isinstance(messages, (list, tuple)):
        for message in messages:
            role = pick(message, "role") or "user"
            lines.append(f"{role}: {_render_content(pick(message, 'content'))}")
    elif messages is not None:
        lines.append(stringify(messages))
    return "\n".join(lines)


# ── usage ─────────────────────────────────────────────────────────────


class _Usage:
    """Anthropic splits the prompt across three billing tiers."""

    __slots__ = ("fresh", "output", "cache_read", "cache_write")

    def __init__(self, fresh: int, output: int, cache_read: int, cache_write: int) -> None:
        self.fresh = fresh
        self.output = output
        self.cache_read = cache_read
        self.cache_write = cache_write

    @property
    def tokens_in(self) -> int:
        """Total prompt tokens — what the API actually charged you for."""
        return self.fresh + self.cache_read + self.cache_write


def _read_usage(usage: Any) -> _Usage | None:
    fresh = num(pick(usage, "input_tokens"))
    output = num(pick(usage, "output_tokens"))
    cache_read = num(pick(usage, "cache_read_input_tokens"))
    cache_write = num(pick(usage, "cache_creation_input_tokens"))
    if fresh is None and output is None and cache_read is None and cache_write is None:
        return None
    return _Usage(as_int(fresh), as_int(output), as_int(cache_read), as_int(cache_write))


def _merge_usage(base: _Usage | None, patch: _Usage | None) -> _Usage | None:
    """Merge a streamed `message_delta` patch onto what `message_start` gave us."""
    if patch is None:
        return base
    if base is None:
        return patch
    return _Usage(
        patch.fresh or base.fresh,
        patch.output or base.output,
        patch.cache_read or base.cache_read,
        patch.cache_write or base.cache_write,
    )


def _cost_of(model: str | None, usage: _Usage, prices: Mapping[str, ModelPrice] | None) -> float:
    price = price_for(model, prices)
    prompt_cost = (
        usage.fresh * price.input
        + usage.cache_read * price.input * CACHE_READ_MULTIPLIER
        + usage.cache_write * price.input * CACHE_WRITE_MULTIPLIER
    )
    return round_cost((prompt_cost + usage.output * price.output) / 1_000_000)


# ── stream accumulation ───────────────────────────────────────────────


class _Accumulator:
    __slots__ = ("text", "usage", "model", "message_id", "stop_reason")

    def __init__(self) -> None:
        self.text = ""
        self.usage: _Usage | None = None
        self.model: str | None = None
        self.message_id: str | None = None
        self.stop_reason: str | None = None


def _on_stream_event(acc: _Accumulator, event: Any) -> None:
    """Accumulate one server-sent event off a `messages` stream."""
    event_type = as_str(pick(event, "type"))

    if event_type == "message_start":
        message = pick(event, "message")
        acc.model = as_str(pick(message, "model")) or acc.model
        acc.message_id = as_str(pick(message, "id")) or acc.message_id
        acc.usage = _merge_usage(acc.usage, _read_usage(pick(message, "usage")))
        return

    if event_type == "content_block_start":
        block = pick(event, "content_block")
        if pick(block, "type") == "tool_use":
            acc.text += f"\n[tool_use {pick(block, 'name') or ''}] "
        return

    if event_type == "content_block_delta":
        delta = pick(event, "delta")
        delta_type = pick(delta, "type")
        deltas = (
            ("text", "text_delta"),
            ("thinking", "thinking_delta"),
            ("partial_json", "input_json_delta"),
        )
        for key, kind in deltas:
            if delta_type == kind:
                value = pick(delta, key)
                if isinstance(value, str):
                    acc.text += value
                return
        return

    if event_type == "message_delta":
        acc.stop_reason = as_str(pick_path(event, "delta", "stop_reason")) or acc.stop_reason
        acc.usage = _merge_usage(acc.usage, _read_usage(pick(event, "usage")))


# ── the wrapper ───────────────────────────────────────────────────────


def _merge_params(args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if args and isinstance(args[0], Mapping):
        params.update(args[0])
    params.update(kwargs)
    return params


def _instrument(
    original: Callable[..., Any],
    target: SpanTarget,
    default_name: str,
    *,
    parent: Any,
    span_name: str | None,
    capture_io: bool,
    max_io_chars: int,
    prices: Mapping[str, ModelPrice] | None,
) -> Callable[..., Any]:
    is_async = inspect.iscoroutinefunction(original)

    def close(
        handle: SpanHandle,
        params: Mapping[str, Any],
        input_text: str,
        output_text: str,
        usage: _Usage | None,
        extra: Mapping[str, Any],
        error: BaseException | None = None,
    ) -> None:
        model = as_str(extra.get("model")) or as_str(params.get("model"))
        streaming = bool(params.get("stream"))
        payload: dict[str, Any] = {
            "status": "error" if error is not None else "ok",
            "attributes": attrs(
                {
                    "provider": "anthropic",
                    "model": model,
                    "stream": "true" if streaming else "false",
                    "max_tokens": params.get("max_tokens"),
                    "thinking": pick(params.get("thinking"), "type"),
                    "effort": pick(params.get("output_config"), "effort"),
                    "cache.read_tokens": usage.cache_read if usage and usage.cache_read else None,
                    "cache.write_tokens": (
                        usage.cache_write if usage and usage.cache_write else None
                    ),
                    **extra,
                }
            ),
        }
        io = build_io(input_text, output_text, capture_io=capture_io, max_io_chars=max_io_chars)
        if io:
            payload["io"] = io
        if usage is not None:
            payload["tokens_in"] = usage.tokens_in
            payload["tokens_out"] = usage.output
            payload["cost"] = _cost_of(model, usage, prices)
        if error is not None:
            payload["error"] = err_message(error)
        # A safety-classifier decline is a successful HTTP call that produced no
        # answer — surface it as a warn so detectors can see it, not a silent ok.
        if error is None and extra.get("stop_reason") == "refusal":
            payload["status"] = "warn"
        handle.end(**payload)
        handle.finish()

    def close_message(
        handle: SpanHandle, params: Mapping[str, Any], input_text: str, message: Any
    ) -> None:
        close(
            handle,
            params,
            input_text,
            _render_content(pick(message, "content")),
            _read_usage(pick(message, "usage")),
            {
                "model": as_str(pick(message, "model")),
                "message.id": as_str(pick(message, "id")),
                "stop_reason": as_str(pick(message, "stop_reason")),
                "stop_details.category": as_str(pick_path(message, "stop_details", "category")),
            },
        )

    def wrap_stream(
        handle: SpanHandle, params: Mapping[str, Any], input_text: str, stream: Any
    ) -> TracedStream:
        acc = _Accumulator()
        return TracedStream(
            stream,
            lambda event: _on_stream_event(acc, event),
            lambda error: close(
                handle,
                params,
                input_text,
                acc.text,
                acc.usage,
                {
                    "model": acc.model,
                    "message.id": acc.message_id,
                    "stop_reason": acc.stop_reason,
                },
                error,
            ),
        )

    if is_async:

        @functools.wraps(original)
        async def acall(*args: Any, **kwargs: Any) -> Any:
            params = _merge_params(args, kwargs)
            handle = open_span(target, span_name or default_name, "llm", parent=parent)
            input_text = _render_input(params)
            try:
                result = await original(*args, **kwargs)
            except BaseException as exc:
                close(handle, params, input_text, "", None, {}, exc)
                raise
            if params.get("stream"):
                return wrap_stream(handle, params, input_text, result)
            close_message(handle, params, input_text, result)
            return result

        return acall

    @functools.wraps(original)
    def call(*args: Any, **kwargs: Any) -> Any:
        params = _merge_params(args, kwargs)
        handle = open_span(target, span_name or default_name, "llm", parent=parent)
        input_text = _render_input(params)
        try:
            result = original(*args, **kwargs)
        except BaseException as exc:
            close(handle, params, input_text, "", None, {}, exc)
            raise
        if params.get("stream"):
            return wrap_stream(handle, params, input_text, result)
        close_message(handle, params, input_text, result)
        return result

    return call


def wrap_anthropic(
    client: Any,
    target: SpanTarget,
    *,
    parent: Any = None,
    span_name: str | None = None,
    capture_io: bool = True,
    max_io_chars: int = 4000,
    prices: Mapping[str, ModelPrice] | None = None,
) -> Any:
    """Wrap an Anthropic-shaped client so its model calls emit `llm` spans.

    `messages.create` and `beta.messages.create` are instrumented; both
    `Anthropic` and `AsyncAnthropic` are supported.

    `messages.stream(...)` returns a context manager rather than a plain
    stream, so it is left alone — instrument that path with
    `messages.create(stream=True)`, or open a span around the `with` block
    yourself.

    The original client is never mutated: a forwarding proxy is returned.

    Args:
        client: An `Anthropic` / `AsyncAnthropic` / Bedrock / Vertex instance.
        target: A `CausalTracer`, a live trace, or a parent span. Prefer a trace
            or span; a bare tracer opens and flushes a one-span trace per call.
        parent: Optional parent span to nest the emitted spans under.
        span_name: Override the span name (default: the provider method).
        capture_io: Record prompt/completion text in `span.io`. Default `True`.
        max_io_chars: Truncate each side of `span.io` to this many characters.
        prices: Extra per-1M-token prices, merged over the built-in table.

    Returns:
        A proxy that behaves exactly like `client`.
    """
    if client is None:
        return client

    options = {
        "parent": parent,
        "span_name": span_name,
        "capture_io": capture_io,
        "max_io_chars": max_io_chars,
        "prices": prices,
    }

    overrides: dict[str, Any] = {}

    messages = getattr(client, "messages", None)
    if messages is not None and callable(getattr(messages, "create", None)):
        overrides["messages"] = TracedProxy(
            messages,
            {
                "create": _instrument(
                    messages.create, target, "anthropic.messages.create", **options
                )
            },
        )

    beta_messages = getattr(getattr(client, "beta", None), "messages", None)
    if beta_messages is not None and callable(getattr(beta_messages, "create", None)):
        traced_beta_messages = TracedProxy(
            beta_messages,
            {
                "create": _instrument(
                    beta_messages.create, target, "anthropic.beta.messages.create", **options
                )
            },
        )
        overrides["beta"] = TracedProxy(client.beta, {"messages": traced_beta_messages})

    if not overrides:
        return client
    return TracedProxy(client, overrides)
