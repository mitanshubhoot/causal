"""
Causal SDK integrations — drop-in adapters that make an existing LLM client or
agent framework emit Causal spans without changing a call site.

Every adapter takes the same first-or-second argument: a `CausalTracer`, a live
trace, or a parent span. Prefer a trace or a span so model calls land inside the
run you are already tracing; a bare tracer opens and flushes a one-span trace
per call, which is only right for a script.

    from causal_sdk import CausalTracer
    from causal_sdk.integrations import wrap_openai

    tracer = CausalTracer(service="support-agent")
    t = tracer.start_trace()
    root = t.span("support_agent.run", "agent")

    client = wrap_openai(OpenAI(), t, parent=root)

Submodules are imported lazily, so `import causal_sdk.integrations` never pulls
in a framework the host application does not use. Framework adapters raise a
clear `ImportError` naming the pip extra when their dependency is missing.
"""

from __future__ import annotations

import importlib
from typing import Any

__all__ = [
    "CausalCrewAIListener",
    "CausalLangGraphCallback",
    "CausalLlamaIndexHandler",
    "attach_crewai",
    "attach_llamaindex",
    "wrap_anthropic",
    "wrap_openai",
]

#: exported name -> submodule that defines it
_EXPORTS: dict[str, str] = {
    "wrap_openai": "openai",
    "wrap_anthropic": "anthropic",
    "CausalCrewAIListener": "crewai",
    "attach_crewai": "crewai",
    "CausalLlamaIndexHandler": "llamaindex",
    "attach_llamaindex": "llamaindex",
    "CausalLangGraphCallback": "langgraph",
}


def __getattr__(name: str) -> Any:
    """PEP 562 lazy re-export — the submodule loads on first attribute access."""
    module_name = _EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = importlib.import_module(f".{module_name}", __name__)
    value = getattr(module, name)
    globals()[name] = value  # cache so the next access skips the import
    return value


def __dir__() -> list[str]:
    return sorted(__all__)
