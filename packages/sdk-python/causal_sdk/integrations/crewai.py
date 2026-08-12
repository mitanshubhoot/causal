"""
CausalCrewAIListener — turn a CrewAI run into a Causal trace.

Subscribes to CrewAI's event bus and emits one span per crew, task, agent
execution, tool call and LLM call, nested the way the run actually happened:

    crew.kickoff                     (agent)
      └─ task: research_topic        (agent)
           └─ agent: Senior Analyst  (agent)
                ├─ tool: SerperDevTool   (tool)
                └─ llm: gpt-4o-mini      (llm)

`crewai` is imported lazily inside `register()`, so importing this module never
drags CrewAI into a process that does not use it.

Usage:

    from crewai import Agent, Crew, Task
    from causal_sdk import CausalTracer
    from causal_sdk.integrations.crewai import attach_crewai

    tracer = CausalTracer(service="research-crew")

    async def main() -> None:
        t = tracer.start_trace()
        listener = attach_crewai(t)          # registers on CrewAI's event bus

        crew = Crew(agents=[analyst], tasks=[research_task])
        result = crew.kickoff(inputs={"topic": "post-incident review"})

        listener.close()                     # closes any span still open
        await t.flush()

Older CrewAI releases without the event bus can use the callback shims
instead — they capture tool calls and task output, but not the full tree:

    crew = Crew(
        agents=[...], tasks=[...],
        step_callback=listener.step_callback,
        task_callback=listener.task_callback,
    )

Note on economics: token counts reported by `CrewOutput.token_usage` land on
the root span as *attributes*, not as `tokens_in`/`tokens_out`. The ingest
endpoint sums span economics to produce the trace total, so recording the same
tokens on both the crew span and its LLM spans would double-count them.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Callable

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
    require,
    stringify,
    truncate,
)

__all__ = ["CausalCrewAIListener", "attach_crewai"]

#: CrewAI event class -> handler name. Missing classes are skipped, so the
#: listener works across CrewAI versions that ship different event sets.
_EVENT_HANDLERS: dict[str, str] = {
    "CrewKickoffStartedEvent": "_on_crew_started",
    "CrewKickoffCompletedEvent": "_on_crew_completed",
    "CrewKickoffFailedEvent": "_on_crew_failed",
    "TaskStartedEvent": "_on_task_started",
    "TaskCompletedEvent": "_on_task_completed",
    "TaskFailedEvent": "_on_task_failed",
    "AgentExecutionStartedEvent": "_on_agent_started",
    "AgentExecutionCompletedEvent": "_on_agent_completed",
    "AgentExecutionErrorEvent": "_on_agent_error",
    "ToolUsageStartedEvent": "_on_tool_started",
    "ToolUsageFinishedEvent": "_on_tool_finished",
    "ToolUsageErrorEvent": "_on_tool_error",
    "LLMCallStartedEvent": "_on_llm_started",
    "LLMCallCompletedEvent": "_on_llm_completed",
    "LLMCallFailedEvent": "_on_llm_failed",
}


def _identify(obj: Any, *attributes: str) -> str:
    """Best-effort stable key for a CrewAI object across two events."""
    for attribute in attributes:
        value = getattr(obj, attribute, None)
        if value is not None and not callable(value):
            text = str(value)
            if text:
                return text
    return str(id(obj)) if obj is not None else "-"


class CausalCrewAIListener:
    """Emits Causal spans for CrewAI crews, tasks, agents, tools and LLM calls.

    The listener is deliberately *not* a subclass of CrewAI's
    `BaseEventListener` — subclassing would require importing `crewai` at module
    import time. It implements the same `setup_listeners(bus)` contract, and
    `register()` wires it to the global bus.
    """

    def __init__(
        self,
        target: SpanTarget,
        *,
        parent: Any = None,
        capture_io: bool = True,
        max_io_chars: int = 4000,
        prices: Mapping[str, ModelPrice] | None = None,
        root_name: str = "crew.kickoff",
    ) -> None:
        self._target = target
        self._parent = parent
        self._capture_io = capture_io
        self._max_io_chars = max_io_chars
        self._prices = prices
        self._root_name = root_name

        self._root: SpanHandle | None = None
        self._root_input: str = ""
        self._stack: list[SpanHandle] = []
        self._by_key: dict[tuple[str, str], list[SpanHandle]] = {}
        # id(handle) -> (input text, attributes recorded at open time)
        self._pending: dict[int, tuple[str, dict[str, Any]]] = {}

    # ── registration ──────────────────────────────────────────────────

    def register(self) -> "CausalCrewAIListener":
        """Subscribe to CrewAI's global event bus. Returns `self`."""
        events = require("crewai.utilities.events", "crewai")
        bus = getattr(events, "crewai_event_bus", None)
        if bus is None:
            raise ImportError(
                "This CrewAI release has no 'crewai_event_bus'. Upgrade CrewAI "
                "(pip install -U crewai), or use the step_callback / task_callback shims."
            )
        self.setup_listeners(bus)
        return self

    def setup_listeners(self, crewai_event_bus: Any) -> None:
        """Bind handlers on the bus. Also the hook CrewAI itself calls."""
        events = require("crewai.utilities.events", "crewai")
        for class_name, handler_name in _EVENT_HANDLERS.items():
            event_class = getattr(events, class_name, None)
            if event_class is None:
                continue  # this CrewAI version does not emit that event
            handler = getattr(self, handler_name)
            crewai_event_bus.on(event_class)(self._guard(handler))

    @staticmethod
    def _guard(handler: Callable[[Any, Any], None]) -> Callable[..., None]:
        """Never let a telemetry handler break the crew."""

        def listener(source: Any = None, event: Any = None, **_: Any) -> None:
            try:
                handler(source, event)
            except Exception:
                pass

        return listener

    # ── span bookkeeping ──────────────────────────────────────────────

    def _anchor(self) -> Any:
        if self._stack:
            return self._stack[-1].span
        if self._root is not None and self._root.span is not None:
            return self._root.span
        return self._parent

    def _open(
        self,
        category: str,
        key: str,
        name: str,
        kind: str,
        *,
        input_text: str = "",
        attributes: Mapping[str, Any] | None = None,
    ) -> SpanHandle:
        handle = open_span(self._target, name, kind, parent=self._anchor())
        self._pending[id(handle)] = (input_text, dict(attributes or {}))
        self._stack.append(handle)
        self._by_key.setdefault((category, key), []).append(handle)
        return handle

    def _close(
        self,
        category: str,
        key: str,
        *,
        output_text: str = "",
        attributes: Mapping[str, Any] | None = None,
        error: Any = None,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        cost: float | None = None,
    ) -> None:
        handles = self._by_key.get((category, key))
        handle = handles.pop() if handles else None
        if handle is None:
            return
        try:
            self._stack.remove(handle)
        except ValueError:
            pass
        input_text, opened_attrs = self._pending.pop(id(handle), ("", {}))
        merged = {**opened_attrs, **dict(attributes or {})}

        payload: dict[str, Any] = {
            "status": "error" if error is not None else "ok",
            "attributes": attrs(merged),
        }
        io = build_io(
            input_text,
            output_text,
            capture_io=self._capture_io,
            max_io_chars=self._max_io_chars,
        )
        if io:
            payload["io"] = io
        if error is not None:
            payload["error"] = err_message(error)
        if tokens_in is not None:
            payload["tokens_in"] = tokens_in
        if tokens_out is not None:
            payload["tokens_out"] = tokens_out
        if cost is not None:
            payload["cost"] = cost
        handle.end(**payload)

    def close(self) -> None:
        """Close any span still open and flush a trace this listener created."""
        for handles in list(self._by_key.values()):
            while handles:
                handle = handles.pop()
                handle.end(status="ok")
        self._stack.clear()
        self._pending.clear()
        if self._root is not None:
            self._root.end(status="ok")
            self._root.finish()
            self._root = None

    # ── crew ──────────────────────────────────────────────────────────

    def _on_crew_started(self, source: Any, event: Any) -> None:
        if self._root is not None:
            return
        name = (
            as_str(pick(event, "crew_name"))
            or as_str(getattr(source, "name", None))
            or self._root_name
        )
        self._root = open_span(self._target, f"crew.kickoff: {name}", "agent", parent=self._parent)
        inputs = pick(event, "inputs")
        io = build_io(
            stringify(inputs) if inputs else "",
            "",
            capture_io=self._capture_io,
            max_io_chars=self._max_io_chars,
        )
        self._root_input = io.get("input", "") if io else ""

    def _on_crew_completed(self, source: Any, event: Any) -> None:
        output = pick(event, "output")
        usage = pick(output, "token_usage") or pick(event, "token_usage")
        # Token counts go on the root as attributes, never as span economics:
        # ingest sums span tokens, so duplicating them here would double-count.
        self._end_root(
            output_text=stringify(output) if output is not None else "",
            attributes={
                "crew.prompt_tokens": num(pick(usage, "prompt_tokens")),
                "crew.completion_tokens": num(pick(usage, "completion_tokens")),
                "crew.total_tokens": num(pick(usage, "total_tokens")),
                "crew.requests": num(pick(usage, "successful_requests")),
            },
        )

    def _on_crew_failed(self, source: Any, event: Any) -> None:
        self._end_root(error=pick(event, "error") or "crew kickoff failed")

    def _end_root(
        self,
        *,
        output_text: str = "",
        attributes: Mapping[str, Any] | None = None,
        error: Any = None,
    ) -> None:
        if self._root is None:
            return
        payload: dict[str, Any] = {
            "status": "error" if error is not None else "ok",
            "attributes": attrs(dict(attributes or {})),
        }
        io = build_io(
            self._root_input,
            output_text,
            capture_io=self._capture_io,
            max_io_chars=self._max_io_chars,
        )
        if io:
            payload["io"] = io
        if error is not None:
            payload["error"] = err_message(error)
        self._root.end(**payload)
        self._root.finish()
        self._root = None

    # ── tasks ─────────────────────────────────────────────────────────

    @staticmethod
    def _task_key(event: Any) -> str:
        return _identify(pick(event, "task"), "id", "key", "description")

    def _on_task_started(self, source: Any, event: Any) -> None:
        task = pick(event, "task")
        description = (
            as_str(pick(task, "description")) or as_str(pick(event, "task_name")) or "task"
        )
        self._open(
            "task",
            self._task_key(event),
            f"task: {truncate(description, 60)}",
            "agent",
            input_text=stringify(pick(task, "description")),
            attributes={
                "agent.role": as_str(pick(pick(task, "agent"), "role")),
                "expected_output": as_str(pick(task, "expected_output")),
            },
        )

    def _on_task_completed(self, source: Any, event: Any) -> None:
        output = pick(event, "output")
        self._close("task", self._task_key(event), output_text=stringify(output))

    def _on_task_failed(self, source: Any, event: Any) -> None:
        self._close("task", self._task_key(event), error=pick(event, "error") or "task failed")

    # ── agents ────────────────────────────────────────────────────────

    @staticmethod
    def _agent_key(event: Any) -> str:
        agent = pick(event, "agent")
        if agent is not None:
            return _identify(agent, "id", "key", "role")
        return as_str(pick(event, "agent_role")) or as_str(pick(event, "agent_key")) or "agent"

    def _on_agent_started(self, source: Any, event: Any) -> None:
        agent = pick(event, "agent")
        role = as_str(pick(agent, "role")) or as_str(pick(event, "agent_role")) or "agent"
        tools = pick(event, "tools") or pick(agent, "tools")
        self._open(
            "agent",
            self._agent_key(event),
            f"agent: {role}",
            "agent",
            input_text=stringify(pick(event, "task_prompt") or pick(event, "task")),
            attributes={
                "agent.role": role,
                "agent.goal": as_str(pick(agent, "goal")),
                "agent.llm": as_str(pick(pick(agent, "llm"), "model")),
                "agent.tools": len(tools) if isinstance(tools, (list, tuple)) else None,
            },
        )

    def _on_agent_completed(self, source: Any, event: Any) -> None:
        self._close("agent", self._agent_key(event), output_text=stringify(pick(event, "output")))

    def _on_agent_error(self, source: Any, event: Any) -> None:
        error = pick(event, "error") or "agent execution failed"
        self._close("agent", self._agent_key(event), error=error)

    # ── tools ─────────────────────────────────────────────────────────

    @staticmethod
    def _tool_key(event: Any) -> str:
        name = as_str(pick(event, "tool_name")) or "tool"
        owner = as_str(pick(event, "agent_key")) or as_str(pick(event, "agent_role")) or ""
        return f"{owner}:{name}"

    def _on_tool_started(self, source: Any, event: Any) -> None:
        name = as_str(pick(event, "tool_name")) or "tool"
        self._open(
            "tool",
            self._tool_key(event),
            f"tool: {name}",
            "tool",
            input_text=stringify(pick(event, "tool_args")),
            attributes={"tool.name": name, "agent.role": as_str(pick(event, "agent_role"))},
        )

    def _on_tool_finished(self, source: Any, event: Any) -> None:
        self._close(
            "tool",
            self._tool_key(event),
            output_text=stringify(pick(event, "output")),
            attributes={"tool.from_cache": pick(event, "from_cache")},
        )

    def _on_tool_error(self, source: Any, event: Any) -> None:
        self._close("tool", self._tool_key(event), error=pick(event, "error") or "tool failed")

    # ── llm calls ─────────────────────────────────────────────────────

    @staticmethod
    def _llm_key(event: Any) -> str:
        return as_str(pick(event, "agent_role")) or as_str(pick(event, "call_type")) or "llm"

    def _on_llm_started(self, source: Any, event: Any) -> None:
        model = as_str(pick(event, "model")) or as_str(pick(pick(event, "llm"), "model"))
        self._open(
            "llm",
            self._llm_key(event),
            f"llm: {model}" if model else "llm",
            "llm",
            input_text=stringify(pick(event, "messages") or pick(event, "prompt")),
            attributes={"provider": "crewai", "model": model},
        )

    def _on_llm_completed(self, source: Any, event: Any) -> None:
        usage = pick(event, "usage") or pick(event, "token_usage")
        model = as_str(pick(event, "model"))
        tokens_in = num(pick(usage, "prompt_tokens")) if usage is not None else None
        tokens_out = num(pick(usage, "completion_tokens")) if usage is not None else None
        cost = None
        if tokens_in is not None or tokens_out is not None:
            cost = estimate_cost(model, as_int(tokens_in), as_int(tokens_out), self._prices)
        self._close(
            "llm",
            self._llm_key(event),
            output_text=stringify(pick(event, "response")),
            attributes={"model": model, "call_type": as_str(pick(event, "call_type"))},
            tokens_in=as_int(tokens_in) if tokens_in is not None else None,
            tokens_out=as_int(tokens_out) if tokens_out is not None else None,
            cost=cost,
        )

    def _on_llm_failed(self, source: Any, event: Any) -> None:
        self._close("llm", self._llm_key(event), error=pick(event, "error") or "llm call failed")

    # ── legacy callbacks (CrewAI releases without the event bus) ───────

    def step_callback(self, step_output: Any) -> None:
        """Record one agent step as a `tool` span.

        Pass as `Crew(step_callback=listener.step_callback)`. Only useful on
        CrewAI releases that predate the event bus; the bus gives a full tree.
        """
        try:
            tool = as_str(pick(step_output, "tool"))
            if not tool:
                return
            handle = open_span(self._target, f"tool: {tool}", "tool", parent=self._anchor())
            payload: dict[str, Any] = {
                "status": "ok",
                "attributes": attrs({"tool.name": tool, "source": "step_callback"}),
            }
            io = build_io(
                stringify(pick(step_output, "tool_input")),
                stringify(pick(step_output, "result") or pick(step_output, "output")),
                capture_io=self._capture_io,
                max_io_chars=self._max_io_chars,
            )
            if io:
                payload["io"] = io
            handle.end(**payload)
        except Exception:
            pass

    def task_callback(self, task_output: Any) -> None:
        """Record one finished task as an `agent` span.

        Pass as `Crew(task_callback=listener.task_callback)`.
        """
        try:
            description = as_str(pick(task_output, "description")) or "task"
            handle = open_span(
                self._target,
                f"task: {truncate(description, 60)}",
                "agent",
                parent=self._anchor(),
            )
            payload: dict[str, Any] = {
                "status": "ok",
                "attributes": attrs(
                    {
                        "agent.role": as_str(pick(task_output, "agent")),
                        "source": "task_callback",
                    }
                ),
            }
            io = build_io(
                description,
                stringify(pick(task_output, "raw") or task_output),
                capture_io=self._capture_io,
                max_io_chars=self._max_io_chars,
            )
            if io:
                payload["io"] = io
            handle.end(**payload)
        except Exception:
            pass


def attach_crewai(
    target: SpanTarget,
    *,
    parent: Any = None,
    capture_io: bool = True,
    max_io_chars: int = 4000,
    prices: Mapping[str, ModelPrice] | None = None,
    root_name: str = "crew.kickoff",
) -> CausalCrewAIListener:
    """Build a `CausalCrewAIListener` and register it on CrewAI's event bus.

    Args:
        target: A `CausalTracer`, a live trace, or a parent span.
        parent: Optional parent span to nest the crew under.
        capture_io: Record prompts/outputs in `span.io`. Default `True`.
        max_io_chars: Truncate each side of `span.io` to this many characters.
        prices: Extra per-1M-token prices, merged over the built-in table.
        root_name: Fallback name for the root span when the crew is unnamed.

    Raises:
        ImportError: if `crewai` is not installed, naming the pip extra.
    """
    listener = CausalCrewAIListener(
        target,
        parent=parent,
        capture_io=capture_io,
        max_io_chars=max_io_chars,
        prices=prices,
        root_name=root_name,
    )
    return listener.register()
