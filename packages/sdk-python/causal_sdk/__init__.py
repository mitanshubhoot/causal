"""
Causal SDK — tracing and automatic provenance capture for AI agent teams.

Trace an agent run:
    from causal_sdk import CausalTracer, observe

    tracer = CausalTracer(service="booking-agent")

    @observe(kind="llm")
    async def plan(prompt: str) -> str:
        ...

    async with tracer.trace("booking_agent.run") as t:
        await plan("book me a flight")     # nested automatically

Capture provenance (nodes/edges):
    from causal_sdk import CausalClient, trace

    client = CausalClient(api_key="causal_...")

    @trace(client=client, spec_id="LIN-447")
    async def my_agent(prompt: str) -> str:
        ...
"""

from .client import AsyncCausalClient, CausalClient
from .session import CausalSession
from .decorators import trace
from .models import CausalNode, CausalEdge, ContextSnapshot, CreateNode, CreateEdge
from .observe import observe
from .tracer import CausalSpan, CausalTrace, CausalTracer

__version__ = "0.1.0"
__all__ = [
    "AsyncCausalClient",
    "CausalClient",
    "CausalSession",
    "CausalSpan",
    "CausalTrace",
    "CausalTracer",
    "observe",
    "trace",
    "CausalNode",
    "CausalEdge",
    "ContextSnapshot",
    "CreateNode",
    "CreateEdge",
]
