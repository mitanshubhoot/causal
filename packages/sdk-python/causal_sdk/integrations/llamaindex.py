"""
CausalLlamaIndexHandler — turn a LlamaIndex query into a Causal trace.

Implements LlamaIndex's `BaseCallbackHandler` contract structurally (no import
of `llama_index` is needed to construct it) and emits one span per event, keyed
to the parent LlamaIndex reports, so a RAG query comes out shaped like the
pipeline that produced it:

    llamaindex.query                 (agent)   "What changed in the payments flow?"
      ├─ llamaindex.retrieve         (db)      12 nodes, top score 0.83
      └─ llamaindex.synthesize       (function)
           └─ llamaindex.llm         (llm)     gpt-4o-mini, 3.2k in / 210 out

`llama_index` is imported lazily inside `attach_llamaindex()`, so importing this
module never drags LlamaIndex into a process that does not use it.

Usage:

    from llama_index.core import VectorStoreIndex, Settings
    from llama_index.core.callbacks import CallbackManager
    from causal_sdk import CausalTracer
    from causal_sdk.integrations.llamaindex import CausalLlamaIndexHandler

    tracer = CausalTracer(service="docs-rag")

    async def main() -> None:
        t = tracer.start_trace()
        root = t.span("docs_rag.query", "agent")

        Settings.callback_manager = CallbackManager([CausalLlamaIndexHandler(t, parent=root)])

        engine = index.as_query_engine()
        answer = engine.query("What changed in the payments flow?")

        root.end(status="ok", io={"input": question, "output": str(answer)})
        await t.flush()

Or let the helper wire it into the global settings for you:

    from causal_sdk.integrations.llamaindex import attach_llamaindex
    handler = attach_llamaindex(t, parent=root)
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from ._tracing import (
    ModelPrice,
    SpanHandle,
    SpanTarget,
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
    require,
    stringify,
    truncate,
)

__all__ = ["CausalLlamaIndexHandler", "attach_llamaindex"]


#: LlamaIndex `CBEventType` value -> Causal span kind. Retrieval is a `db` span
#: because bad context is a top root cause and the product surfaces those
#: together; anything unmapped falls back to `function`.
_SPAN_KINDS: dict[str, str] = {
    "query": "agent",
    "retrieve": "db",
    "synthesize": "function",
    "llm": "llm",
    "embedding": "llm",
    "function_call": "tool",
    "agent_step": "agent",
    "sub_question": "agent",
    "reranking": "db",
    "templating": "function",
    "node_parsing": "function",
    "chunking": "function",
    "tree": "function",
    "exception": "function",
}


def _event_name(event_type: Any) -> str:
    """`CBEventType.RETRIEVE` and the bare string `"retrieve"` both work."""
    value = getattr(event_type, "value", event_type)
    return str(value) if value is not None else "event"


def _render_nodes(nodes: Any) -> tuple[str, int, float | None]:
    """Summarise retrieved nodes: readable text, count, and best score."""
    if not isinstance(nodes, (list, tuple)):
        return (stringify(nodes), 0, None)
    lines: list[str] = []
    best: float | None = None
    for index, node in enumerate(nodes):
        score = num(pick(node, "score"))
        if score is not None and (best is None or score > best):
            best = float(score)
        text = pick(node, "text")
        if text is None:
            get_content = getattr(node, "get_content", None)
            if callable(get_content):
                try:
                    text = get_content()
                except Exception:
                    text = None
        if text is None:
            text = pick_path(node, "node", "text")
        label = f"#{index + 1}"
        if score is not None:
            label += f" score={float(score):.4f}"
        lines.append(f"{label} {truncate(str(text or ''), 400)}")
    return ("\n".join(lines), len(nodes), best)


def _llm_usage(payload: Mapping[str, Any] | None) -> tuple[int | None, int | None, str | None]:
    """Dig token counts and the model id out of an LLM event payload.

    LlamaIndex hands back the provider's own response under `raw`, so this
    reads both the OpenAI shape (`prompt_tokens`) and the Anthropic shape
    (`input_tokens`).
    """
    if not payload:
        return (None, None, None)
    response = payload.get("response") or payload.get("completion")
    raw = pick(response, "raw")
    usage = (
        pick(raw, "usage")
        or pick(response, "usage")
        or pick_path(response, "additional_kwargs")
    )

    tokens_in = num(pick(usage, "prompt_tokens"))
    if tokens_in is None:
        tokens_in = num(pick(usage, "input_tokens"))
    tokens_out = num(pick(usage, "completion_tokens"))
    if tokens_out is None:
        tokens_out = num(pick(usage, "output_tokens"))

    model = as_str(pick(raw, "model")) or as_str(pick_path(payload.get("serialized"), "model"))
    return (
        as_int(tokens_in) if tokens_in is not None else None,
        as_int(tokens_out) if tokens_out is not None else None,
        model,
    )


def _render_llm_response(payload: Mapping[str, Any] | None) -> str:
    if not payload:
        return ""
    response = payload.get("response")
    if response is not None:
        message = pick(response, "message")
        content = pick(message, "content")
        if isinstance(content, str) and content:
            return content
        text = pick(response, "text")
        if isinstance(text, str) and text:
            return text
        return stringify(response)
    completion = payload.get("completion")
    return stringify(completion) if completion is not None else ""


def _render_llm_prompt(payload: Mapping[str, Any] | None) -> str:
    if not payload:
        return ""
    formatted = payload.get("formatted_prompt") or payload.get("prompt")
    if isinstance(formatted, str) and formatted:
        return formatted
    messages = payload.get("messages")
    if isinstance(messages, (list, tuple)):
        return "\n".join(
            f"{pick(m, 'role') or 'user'}: {pick(m, 'content') or ''}" for m in messages
        )
    return ""


class CausalLlamaIndexHandler:
    """A LlamaIndex callback handler that writes Causal spans.

    Duck-typed against `llama_index.core.callbacks.base_handler.BaseCallbackHandler`:
    `CallbackManager` only calls `start_trace`, `end_trace`, `on_event_start`
    and `on_event_end` and reads `event_starts_to_ignore` /
    `event_ends_to_ignore`, all of which this class provides — so no LlamaIndex
    import is required to build one.
    """

    def __init__(
        self,
        target: SpanTarget,
        *,
        parent: Any = None,
        capture_io: bool = True,
        max_io_chars: int = 4000,
        prices: Mapping[str, ModelPrice] | None = None,
        root_name: str = "llamaindex.trace",
        open_root: bool = False,
    ) -> None:
        """
        Args:
            target: A `CausalTracer`, a live trace, or a parent span.
            parent: Optional parent span to nest LlamaIndex spans under.
            capture_io: Record prompts/responses/nodes in `span.io`.
            max_io_chars: Truncate each side of `span.io` to this many characters.
            prices: Extra per-1M-token prices, merged over the built-in table.
            root_name: Name for the root span when `open_root` is set.
            open_root: Open one span per LlamaIndex trace to hold the query.
                Leave off when you already opened a root span yourself.
        """
        # Read by CallbackManager — every event type is traced.
        self.event_starts_to_ignore: list[Any] = []
        self.event_ends_to_ignore: list[Any] = []

        self._target = target
        self._parent = parent
        self._capture_io = capture_io
        self._max_io_chars = max_io_chars
        self._prices = prices
        self._root_name = root_name
        self._open_root = open_root

        self._spans: dict[str, SpanHandle] = {}
        self._inputs: dict[str, str] = {}
        self._root: SpanHandle | None = None
        self._depth = 0

    # ── trace lifecycle ───────────────────────────────────────────────

    def start_trace(self, trace_id: str | None = None) -> None:
        """LlamaIndex opens a trace (`query`, `index_construction`, …)."""
        self._depth += 1
        if not self._open_root or self._depth > 1 or self._root is not None:
            return
        name = f"{self._root_name}: {trace_id}" if trace_id else self._root_name
        self._root = open_span(self._target, name, "agent", parent=self._parent)

    def end_trace(self, trace_id: str | None = None, trace_map: Any = None) -> None:
        """LlamaIndex closes a trace. Nested traces do not close the root."""
        self._depth = max(0, self._depth - 1)
        if self._depth > 0:
            return
        for handle in list(self._spans.values()):
            handle.end(status="ok")
        self._spans.clear()
        self._inputs.clear()
        if self._root is not None:
            self._root.end(status="ok")
            self._root.finish()
            self._root = None

    # ── events ────────────────────────────────────────────────────────

    def on_event_start(
        self,
        event_type: Any,
        payload: Mapping[str, Any] | None = None,
        event_id: str = "",
        parent_id: str = "",
        **kwargs: Any,
    ) -> str:
        """Open a span for one LlamaIndex event. Returns the event id."""
        event_id = event_id or uuid.uuid4().hex
        try:
            name = _event_name(event_type)
            kind = _SPAN_KINDS.get(name, "function")
            anchor = self._anchor(parent_id)
            handle = open_span(self._target, f"llamaindex.{name}", kind, parent=anchor)
            self._spans[event_id] = handle
            self._inputs[event_id] = self._render_input(name, payload)
        except Exception:
            pass  # telemetry never breaks the query
        return event_id

    def on_event_end(
        self,
        event_type: Any,
        payload: Mapping[str, Any] | None = None,
        event_id: str = "",
        **kwargs: Any,
    ) -> None:
        """Close the span opened for `event_id`."""
        handle = self._spans.pop(event_id, None)
        input_text = self._inputs.pop(event_id, "")
        if handle is None:
            return
        try:
            name = _event_name(event_type)
            exception = payload.get("exception") if payload else None
            rendered = self._render_output(name, payload)
            output_text, attributes, tokens_in, tokens_out, model = rendered

            span_attrs: dict[str, Any] = {"framework": "llamaindex", "event": name, **attributes}
            end: dict[str, Any] = {
                "status": "error" if exception is not None else "ok",
                "attributes": attrs(span_attrs),
            }
            io = build_io(
                input_text,
                output_text,
                capture_io=self._capture_io,
                max_io_chars=self._max_io_chars,
            )
            if io:
                end["io"] = io
            if exception is not None:
                end["error"] = err_message(exception)
            if tokens_in is not None or tokens_out is not None:
                end["tokens_in"] = tokens_in or 0
                end["tokens_out"] = tokens_out or 0
                end["cost"] = estimate_cost(model, tokens_in or 0, tokens_out or 0, self._prices)
            handle.end(**end)
        except Exception:
            handle.end(status="ok")

    # ── internals ─────────────────────────────────────────────────────

    def _anchor(self, parent_id: str) -> Any:
        parent = self._spans.get(parent_id) if parent_id else None
        if parent is not None and parent.span is not None:
            return parent.span
        if self._root is not None and self._root.span is not None:
            return self._root.span
        return self._parent

    @staticmethod
    def _render_input(name: str, payload: Mapping[str, Any] | None) -> str:
        if not payload:
            return ""
        if name == "llm":
            return _render_llm_prompt(payload)
        if name == "function_call":
            return stringify(payload.get("function_call"))
        query = payload.get("query_str")
        if isinstance(query, str) and query:
            return query
        template = payload.get("template")
        if isinstance(template, str) and template:
            return template
        chunks = payload.get("chunks")
        if isinstance(chunks, (list, tuple)):
            return f"{len(chunks)} chunk(s)"
        return ""

    def _render_output(
        self, name: str, payload: Mapping[str, Any] | None
    ) -> tuple[str, dict[str, Any], int | None, int | None, str | None]:
        """Return (output text, extra attributes, tokens_in, tokens_out, model)."""
        if not payload:
            return ("", {}, None, None, None)

        if name == "retrieve":
            text, count, best = _render_nodes(payload.get("nodes"))
            return (text, {"retrieval.nodes": count, "retrieval.top_score": best}, None, None, None)

        if name == "llm":
            tokens_in, tokens_out, model = _llm_usage(payload)
            return (_render_llm_response(payload), {"model": model}, tokens_in, tokens_out, model)

        if name == "embedding":
            embeddings = payload.get("embeddings")
            count = len(embeddings) if isinstance(embeddings, (list, tuple)) else 0
            first = embeddings[0] if count else None
            dims = len(first) if isinstance(first, (list, tuple)) else None
            return (
                f"{count} embedding(s)",
                {"embedding.count": count, "embedding.dims": dims},
                None,
                None,
                None,
            )

        if name == "function_call":
            tool = payload.get("tool")
            return (
                stringify(payload.get("function_call_response")),
                {"tool.name": as_str(pick(tool, "name"))},
                None,
                None,
                None,
            )

        if name == "reranking":
            text, count, best = _render_nodes(payload.get("nodes"))
            return (text, {"reranking.nodes": count, "reranking.top_score": best}, None, None, None)

        response = payload.get("response")
        if response is not None:
            return (stringify(response), {}, None, None, None)
        return ("", {}, None, None, None)


def attach_llamaindex(
    target: SpanTarget,
    *,
    parent: Any = None,
    capture_io: bool = True,
    max_io_chars: int = 4000,
    prices: Mapping[str, ModelPrice] | None = None,
    root_name: str = "llamaindex.trace",
    open_root: bool = False,
) -> CausalLlamaIndexHandler:
    """Build a handler and install it on LlamaIndex's global callback manager.

    Existing handlers are preserved — the Causal handler is added alongside
    them, never in place of them.

    Raises:
        ImportError: if `llama-index` is not installed, naming the pip extra.
    """
    core = require("llama_index.core", "llamaindex", pip_name="llama-index")
    handler = CausalLlamaIndexHandler(
        target,
        parent=parent,
        capture_io=capture_io,
        max_io_chars=max_io_chars,
        prices=prices,
        root_name=root_name,
        open_root=open_root,
    )

    settings = getattr(core, "Settings", None)
    if settings is None:
        raise ImportError(
            "This LlamaIndex release has no 'Settings' object. Pass the handler "
            "to a CallbackManager yourself: CallbackManager([CausalLlamaIndexHandler(...)])"
        )

    manager = getattr(settings, "callback_manager", None)
    add_handler = getattr(manager, "add_handler", None)
    if callable(add_handler):
        add_handler(handler)
        return handler

    callbacks = require("llama_index.core.callbacks", "llamaindex", pip_name="llama-index")
    settings.callback_manager = callbacks.CallbackManager([handler])
    return handler
