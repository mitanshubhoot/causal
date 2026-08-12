"""
wrap_openai — instrument an OpenAI client so every model call emits a Causal
`llm` span carrying the model, the prompt/completion io, and the tokens and
cost read straight off `response.usage`.

The client is accepted structurally (duck-typed), so `causal-sdk` never takes a
dependency on `openai` — the same wrapper works for `OpenAI`, `AsyncOpenAI`,
`AzureOpenAI` and anything else that speaks the OpenAI shape.

Usage:

    from openai import OpenAI
    from causal_sdk import CausalTracer
    from causal_sdk.integrations.openai import wrap_openai

    tracer = CausalTracer(service="support-agent")

    async def main() -> None:
        t = tracer.start_trace()
        root = t.span("support_agent.run", "agent")

        client = wrap_openai(OpenAI(), t, parent=root)

        # one `llm` span, nested under the run's root span
        res = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "Where is my order?"}],
        )

        root.end(status="ok")
        await t.flush()

Streaming works too. Pass ``stream_options={"include_usage": True}`` and the
span picks up tokens and cost from the final chunk; the span closes when the
loop ends, including on ``break`` or an exception.
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
    estimate_cost,
    num,
    open_span,
    pick,
    pick_path,
    stringify,
)

__all__ = ["wrap_openai"]


# ── prompt / completion rendering ─────────────────────────────────────


def _render_content(content: Any) -> str:
    """Render one message's `content`, which may be a string or a parts list."""
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    if not isinstance(content, (list, tuple)):
        return stringify(content)
    parts: list[str] = []
    for part in content:
        part_type = pick(part, "type")
        if part_type in ("text", "input_text", "output_text"):
            parts.append(str(pick(part, "text") or ""))
        elif part_type == "refusal":
            parts.append(f"[refusal] {pick(part, 'refusal') or ''}")
        else:
            parts.append(f"[{part_type or 'part'}]")
    return "".join(parts)


def _render_messages(messages: Any) -> str:
    """Flatten a chat `messages` list into a readable transcript."""
    if not isinstance(messages, (list, tuple)):
        return stringify(messages)
    lines: list[str] = []
    for message in messages:
        role = pick(message, "role") or "user"
        body = _render_content(pick(message, "content"))
        calls = pick(message, "tool_calls")
        lines.append(
            f"{role}: {body}\n[tool_calls] {stringify(calls)}" if calls else f"{role}: {body}"
        )
    return "\n".join(lines)


def _render_responses_input(params: Mapping[str, Any]) -> str:
    """Render whatever the Responses API was handed as `input`."""
    instructions = as_str(params.get("instructions"))
    value = params.get("input")
    if isinstance(value, str):
        rendered = value
    elif isinstance(value, (list, tuple)):
        lines = []
        for item in value:
            role = pick(item, "role")
            body = _render_content(pick(item, "content"))
            lines.append(f"{role}: {body}" if role else (body or stringify(item)))
        rendered = "\n".join(lines)
    else:
        rendered = stringify(value)
    return f"[instructions] {instructions}\n{rendered}" if instructions else rendered


def _render_responses_output(response: Any) -> str:
    """Pull the assistant text out of a Responses API response object."""
    convenience = pick(response, "output_text")
    if isinstance(convenience, str):
        return convenience
    output = pick(response, "output")
    if not isinstance(output, (list, tuple)):
        return stringify(output)
    lines: list[str] = []
    for item in output:
        item_type = pick(item, "type")
        if item_type == "message":
            lines.append(_render_content(pick(item, "content")))
        elif item_type == "function_call":
            name = pick(item, "name") or ""
            lines.append(f"[function_call {name}] {pick(item, 'arguments') or ''}")
        else:
            lines.append(f"[{item_type or 'item'}]")
    return "\n".join(line for line in lines if line)


def _render_chat_output(response: Any) -> str:
    choices = pick(response, "choices")
    first = choices[0] if isinstance(choices, (list, tuple)) and choices else None
    message = pick(first, "message")
    content = _render_content(pick(message, "content"))
    calls = pick(message, "tool_calls")
    if calls:
        return f"{content}\n[tool_calls] {stringify(calls)}" if content else stringify(calls)
    return content


# ── usage ─────────────────────────────────────────────────────────────


class _Usage:
    __slots__ = ("tokens_in", "tokens_out", "cached_tokens", "reasoning_tokens")

    def __init__(
        self,
        tokens_in: int,
        tokens_out: int,
        cached_tokens: int | None = None,
        reasoning_tokens: int | None = None,
    ) -> None:
        self.tokens_in = tokens_in
        self.tokens_out = tokens_out
        self.cached_tokens = cached_tokens
        self.reasoning_tokens = reasoning_tokens


def _read_chat_usage(usage: Any) -> _Usage | None:
    """Chat Completions reports `prompt_tokens` / `completion_tokens`."""
    tokens_in = num(pick(usage, "prompt_tokens"))
    tokens_out = num(pick(usage, "completion_tokens"))
    if tokens_in is None and tokens_out is None:
        return None
    return _Usage(
        as_int(tokens_in),
        as_int(tokens_out),
        cached_tokens=_optional_int(pick_path(usage, "prompt_tokens_details", "cached_tokens")),
        reasoning_tokens=_optional_int(
            pick_path(usage, "completion_tokens_details", "reasoning_tokens")
        ),
    )


def _read_responses_usage(usage: Any) -> _Usage | None:
    """The Responses API reports `input_tokens` / `output_tokens`."""
    tokens_in = num(pick(usage, "input_tokens"))
    tokens_out = num(pick(usage, "output_tokens"))
    if tokens_in is None and tokens_out is None:
        return None
    return _Usage(
        as_int(tokens_in),
        as_int(tokens_out),
        cached_tokens=_optional_int(pick_path(usage, "input_tokens_details", "cached_tokens")),
        reasoning_tokens=_optional_int(
            pick_path(usage, "output_tokens_details", "reasoning_tokens")
        ),
    )


def _optional_int(value: Any) -> int | None:
    number = num(value)
    return int(number) if number is not None else None


# ── stream accumulation ───────────────────────────────────────────────


class _Accumulator:
    __slots__ = ("text", "usage", "finish_reason", "model", "response_id")

    def __init__(self) -> None:
        self.text = ""
        self.usage: Any = None
        self.finish_reason: str | None = None
        self.model: str | None = None
        self.response_id: str | None = None


def _on_chat_chunk(acc: _Accumulator, chunk: Any) -> None:
    acc.model = as_str(pick(chunk, "model")) or acc.model
    acc.response_id = as_str(pick(chunk, "id")) or acc.response_id
    usage = pick(chunk, "usage")
    if usage is not None:
        acc.usage = usage

    choices = pick(chunk, "choices")
    if not isinstance(choices, (list, tuple)):
        return
    for choice in choices:
        delta = pick(choice, "delta")
        text = pick(delta, "content")
        if isinstance(text, str):
            acc.text += text
        calls = pick(delta, "tool_calls")
        if isinstance(calls, (list, tuple)):
            for call in calls:
                name = as_str(pick_path(call, "function", "name"))
                if name:
                    acc.text += f"\n[tool_call {name}] "
                arguments = pick_path(call, "function", "arguments")
                if isinstance(arguments, str):
                    acc.text += arguments
        finish = as_str(pick(choice, "finish_reason"))
        if finish:
            acc.finish_reason = finish


def _on_responses_event(acc: _Accumulator, event: Any) -> None:
    event_type = as_str(pick(event, "type")) or ""
    if event_type in ("response.output_text.delta", "response.function_call_arguments.delta"):
        delta = pick(event, "delta")
        if isinstance(delta, str):
            acc.text += delta
        return
    response = pick(event, "response")
    if response is None:
        return
    acc.model = as_str(pick(response, "model")) or acc.model
    acc.response_id = as_str(pick(response, "id")) or acc.response_id
    usage = pick(response, "usage")
    if usage is not None:
        acc.usage = usage
    acc.finish_reason = as_str(pick(response, "status")) or acc.finish_reason
    if not acc.text:
        acc.text = _render_responses_output(response)


# ── the wrapper ───────────────────────────────────────────────────────


class _Spec:
    """Per-endpoint rendering/usage strategy."""

    __slots__ = ("default_name", "render_input", "render_output", "read_usage", "on_chunk")

    def __init__(
        self,
        default_name: str,
        render_input: Callable[[Mapping[str, Any]], str],
        render_output: Callable[[Any], str],
        read_usage: Callable[[Any], _Usage | None],
        on_chunk: Callable[[_Accumulator, Any], None],
    ) -> None:
        self.default_name = default_name
        self.render_input = render_input
        self.render_output = render_output
        self.read_usage = read_usage
        self.on_chunk = on_chunk


def _merge_params(args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if args and isinstance(args[0], Mapping):
        params.update(args[0])
    params.update(kwargs)
    return params


def _instrument(
    original: Callable[..., Any],
    target: SpanTarget,
    spec: _Spec,
    *,
    parent: Any,
    span_name: str | None,
    capture_io: bool,
    max_io_chars: int,
    prices: Mapping[str, ModelPrice] | None,
) -> Callable[..., Any]:
    is_async = inspect.iscoroutinefunction(original)

    def start(params: Mapping[str, Any]) -> tuple[SpanHandle, str]:
        handle = open_span(target, span_name or spec.default_name, "llm", parent=parent)
        return handle, spec.render_input(params)

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
        payload: dict[str, Any] = {
            "status": "error" if error is not None else "ok",
            "attributes": attrs(
                {
                    "provider": "openai",
                    "model": model,
                    "stream": "true" if params.get("stream") else "false",
                    "temperature": params.get("temperature"),
                    "max_tokens": params.get("max_tokens") or params.get("max_output_tokens"),
                    "cache.read_tokens": usage.cached_tokens if usage else None,
                    "reasoning.tokens": usage.reasoning_tokens if usage else None,
                    **extra,
                }
            ),
        }
        io = build_io(input_text, output_text, capture_io=capture_io, max_io_chars=max_io_chars)
        if io:
            payload["io"] = io
        if usage is not None:
            payload["tokens_in"] = usage.tokens_in
            payload["tokens_out"] = usage.tokens_out
            payload["cost"] = estimate_cost(model, usage.tokens_in, usage.tokens_out, prices)
        if error is not None:
            payload["error"] = err_message(error)
        handle.end(**payload)
        handle.finish()

    def close_value(
        handle: SpanHandle, params: Mapping[str, Any], input_text: str, value: Any
    ) -> None:
        choices = pick(value, "choices")
        first = choices[0] if isinstance(choices, (list, tuple)) and choices else None
        close(
            handle,
            params,
            input_text,
            spec.render_output(value),
            spec.read_usage(pick(value, "usage")),
            {
                "model": as_str(pick(value, "model")),
                "response.id": as_str(pick(value, "id")),
                "finish_reason": as_str(pick(first, "finish_reason")),
            },
        )

    def wrap_stream(
        handle: SpanHandle, params: Mapping[str, Any], input_text: str, stream: Any
    ) -> TracedStream:
        acc = _Accumulator()
        return TracedStream(
            stream,
            lambda chunk: spec.on_chunk(acc, chunk),
            lambda error: close(
                handle,
                params,
                input_text,
                acc.text,
                spec.read_usage(acc.usage),
                {
                    "model": acc.model,
                    "response.id": acc.response_id,
                    "finish_reason": acc.finish_reason,
                },
                error,
            ),
        )

    if is_async:

        @functools.wraps(original)
        async def acreate(*args: Any, **kwargs: Any) -> Any:
            params = _merge_params(args, kwargs)
            handle, input_text = start(params)
            try:
                result = await original(*args, **kwargs)
            except BaseException as exc:
                close(handle, params, input_text, "", None, {}, exc)
                raise
            if params.get("stream"):
                return wrap_stream(handle, params, input_text, result)
            close_value(handle, params, input_text, result)
            return result

        return acreate

    @functools.wraps(original)
    def create(*args: Any, **kwargs: Any) -> Any:
        params = _merge_params(args, kwargs)
        handle, input_text = start(params)
        try:
            result = original(*args, **kwargs)
        except BaseException as exc:
            close(handle, params, input_text, "", None, {}, exc)
            raise
        if params.get("stream"):
            return wrap_stream(handle, params, input_text, result)
        close_value(handle, params, input_text, result)
        return result

    return create


_CHAT_SPEC = _Spec(
    "openai.chat.completions.create",
    lambda params: _render_messages(params.get("messages")),
    _render_chat_output,
    _read_chat_usage,
    _on_chat_chunk,
)

_RESPONSES_SPEC = _Spec(
    "openai.responses.create",
    _render_responses_input,
    _render_responses_output,
    _read_responses_usage,
    _on_responses_event,
)


def wrap_openai(
    client: Any,
    target: SpanTarget,
    *,
    parent: Any = None,
    span_name: str | None = None,
    capture_io: bool = True,
    max_io_chars: int = 4000,
    prices: Mapping[str, ModelPrice] | None = None,
) -> Any:
    """Wrap an OpenAI-shaped client so its model calls emit `llm` spans.

    Both `OpenAI` and `AsyncOpenAI` are supported — the wrapper inspects the
    underlying method and produces a matching sync or async callable.

    The original client is never mutated: a forwarding proxy is returned, so an
    un-instrumented reference to the same client keeps working and two tracers
    can wrap the same client independently.

    Args:
        client: An `OpenAI` / `AsyncOpenAI` / `AzureOpenAI` instance.
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

    completions = getattr(getattr(client, "chat", None), "completions", None)
    if completions is not None and callable(getattr(completions, "create", None)):
        traced_completions = TracedProxy(
            completions,
            {"create": _instrument(completions.create, target, _CHAT_SPEC, **options)},
        )
        overrides["chat"] = TracedProxy(client.chat, {"completions": traced_completions})

    responses = getattr(client, "responses", None)
    if responses is not None and callable(getattr(responses, "create", None)):
        overrides["responses"] = TracedProxy(
            responses,
            {"create": _instrument(responses.create, target, _RESPONSES_SPEC, **options)},
        )

    if not overrides:
        return client
    return TracedProxy(client, overrides)
