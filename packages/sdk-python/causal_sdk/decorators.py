"""
@trace decorator — wraps any async function to auto-capture a REASONING node.

Usage:
    from causal_sdk import trace, CausalClient

    client = CausalClient(api_key="...")

    @trace(client=client, spec_id="LIN-447")
    async def my_agent_function(prompt: str) -> str:
        ...
"""

from __future__ import annotations

import functools
import time
from typing import Any, Callable

from .client import CausalClient
from .session import CausalSession


def trace(
    client: CausalClient,
    spec_id: str | None = None,
    model_id: str = "unknown",
    agent_id: str | None = None,
    capture_snapshot: bool = False,
):
    """
    Decorator factory. Wraps an async function to auto-create a REASONING node.

    The REASONING node is created on function start, updated on completion.
    If the function raises, the session is still recorded with error info.
    """
    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            session = CausalSession(
                org_id=client.org_id,
                repo_id=client.repo_id,
                model_id=model_id,
                agent_id=agent_id or fn.__name__,
            )
            session.write_session_file()

            if spec_id:
                session.declare_spec(spec_id)

            # Create REASONING node immediately
            node = await client.create_node(session.to_create_node())
            session._node_id = node.id

            error_info = None
            try:
                result = await fn(*args, **kwargs)
                return result
            except Exception as e:
                error_info = str(e)
                raise
            finally:
                # Update the node with completion info
                try:
                    completed_payload = {
                        **session.to_create_node().payload,
                        "completedAt": int(time.time() * 1000),
                        "error": error_info,
                    }
                    # Fire-and-forget update (create a new node version)
                    await client.create_node(
                        session.to_create_node().__class__(
                            **{**session.to_create_node().model_dump(), "payload": completed_payload}
                        )
                    )
                except Exception:
                    pass
                CausalSession.clear_session_file()

        return wrapper
    return decorator
