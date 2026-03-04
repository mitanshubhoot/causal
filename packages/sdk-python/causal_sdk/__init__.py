"""
Causal SDK — automatic provenance capture for AI agent engineering teams.

Quick start:
    from causal_sdk import CausalClient, trace

    client = CausalClient(api_key="causal_...")

    @trace(client=client, spec_id="LIN-447")
    async def my_agent(prompt: str) -> str:
        ...
"""

from .client import CausalClient
from .session import CausalSession
from .decorators import trace
from .models import CausalNode, CausalEdge, ContextSnapshot, CreateNode, CreateEdge

__version__ = "0.1.0"
__all__ = [
    "CausalClient",
    "CausalSession",
    "trace",
    "CausalNode",
    "CausalEdge",
    "ContextSnapshot",
    "CreateNode",
    "CreateEdge",
]
