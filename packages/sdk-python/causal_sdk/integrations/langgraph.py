"""
CausalLangGraphCallback — automatic REASONING node capture from LangGraph apps.

Drop-in integration: add to any existing LangGraph app at compile time.

    from causal_sdk.integrations.langgraph import CausalLangGraphCallback

    app = graph.compile(
        checkpointer=MemorySaver(),
        callbacks=[CausalLangGraphCallback(
            client=CausalClient(api_key="..."),
            org_id="my-org",
            repo_id="my-repo",
        )]
    )

What it captures automatically:
- Session start  → creates REASONING node, writes .causal-session
- Node transition → captures ContextSnapshot at each state change
- Tool calls     → marks as decision point, triggers snapshot
- Session end    → marks REASONING node complete
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Union
from uuid import UUID

from ..__init__ import CausalClient
from ..session import CausalSession
from ..models import CreateEdge

try:
    from langchain_core.callbacks import AsyncCallbackHandler
    from langchain_core.outputs import LLMResult
    _LANGCHAIN_AVAILABLE = True
except ImportError:
    _LANGCHAIN_AVAILABLE = False
    # Stub for type checking
    class AsyncCallbackHandler:  # type: ignore
        pass


if _LANGCHAIN_AVAILABLE:
    class CausalLangGraphCallback(AsyncCallbackHandler):
        """
        LangChain/LangGraph async callback handler that captures Causal provenance.

        Compatible with LangGraph's StateGraph, as well as raw LangChain chains.
        """

        def __init__(
            self,
            client: CausalClient,
            model_id: str = "unknown",
            spec_id: str | None = None,
            capture_all_transitions: bool = False,
        ):
            self.client = client
            self.model_id = model_id
            self.spec_id = spec_id
            self.capture_all_transitions = capture_all_transitions
            self._session: CausalSession | None = None
            self._node_id: str | None = None
            self._current_run_id: str | None = None

        # ── LLM start ────────────────────────────────────────────
        async def on_llm_start(
            self,
            serialized: dict[str, Any],
            prompts: list[str],
            *,
            run_id: UUID,
            parent_run_id: UUID | None = None,
            **kwargs: Any,
        ) -> None:
            """Session starts when the first LLM call begins."""
            if self._session is not None:
                return  # Already have a session

            model_name = (
                serialized.get("kwargs", {}).get("model_name")
                or serialized.get("kwargs", {}).get("model")
                or self.model_id
            )

            self._session = CausalSession(
                org_id=self.client.org_id,
                repo_id=self.client.repo_id,
                model_id=model_name,
                agent_id=f"langgraph-{str(run_id)[:8]}",
            )
            self._session.write_session_file()

            if self.spec_id:
                self._session.declare_spec(self.spec_id)

            try:
                node = await self.client.create_node(self._session.to_create_node())
                self._session._node_id = node.id
                self._node_id = node.id
            except Exception as e:
                # Never fail the agent because of Causal
                print(f"[causal] Warning: Failed to create REASONING node: {e}")

        # ── Tool start (decision point) ───────────────────────────
        async def on_tool_start(
            self,
            serialized: dict[str, Any],
            input_str: str,
            *,
            run_id: UUID,
            parent_run_id: UUID | None = None,
            **kwargs: Any,
        ) -> None:
            tool_name = serialized.get("name", "unknown_tool")
            if self._session:
                self._session.tools_called.append(tool_name)

            # Special handling: causal_link tool
            if tool_name == "causal_link" and self._session:
                try:
                    import json
                    params = json.loads(input_str) if isinstance(input_str, str) else {}
                    spec_id = params.get("spec_id") or params.get("specId")
                    if spec_id:
                        self._session.declare_spec(spec_id)
                        # Create REASONED_FROM edge
                        if self._node_id:
                            await self.client.create_edge(CreateEdge(
                                sourceId=spec_id,
                                targetId=self._node_id,
                                type="REASONED_FROM",
                                weight=float(params.get("confidence", 0.99)),
                                linkStrategy="manual",
                                orgId=self.client.org_id,
                            ))
                except Exception:
                    pass

        # ── Chain end (LangGraph node transition) ─────────────────
        async def on_chain_end(
            self,
            outputs: dict[str, Any],
            *,
            run_id: UUID,
            parent_run_id: UUID | None = None,
            **kwargs: Any,
        ) -> None:
            """Called at each LangGraph node transition (state change)."""
            if self._session and self.capture_all_transitions and self._node_id:
                # Capture a lightweight snapshot of the outputs
                snapshot = self._session.build_snapshot(
                    system_prompt="LangGraph node transition",
                    messages=[{"role": "assistant", "content": str(outputs)[:2000]}],
                    decision_type="langgraph_node_transition",
                )
                try:
                    await self.client.upload_snapshot(snapshot.model_dump())
                    self._session.snapshot_ids.append(snapshot.snapshotId)
                except Exception:
                    pass

        # ── LLM end ───────────────────────────────────────────────
        async def on_llm_end(
            self,
            response: LLMResult,
            *,
            run_id: UUID,
            parent_run_id: UUID | None = None,
            **kwargs: Any,
        ) -> None:
            pass

        # ── Chain error ───────────────────────────────────────────
        async def on_chain_error(
            self,
            error: Union[Exception, KeyboardInterrupt],
            *,
            run_id: UUID,
            parent_run_id: UUID | None = None,
            **kwargs: Any,
        ) -> None:
            if self._session:
                CausalSession.clear_session_file()

        # ── Agent end (session complete) ──────────────────────────
        async def on_agent_finish(
            self,
            finish: Any,
            *,
            run_id: UUID,
            parent_run_id: UUID | None = None,
            **kwargs: Any,
        ) -> None:
            """Session ends when the agent finishes."""
            await self._finalize_session()

        async def _finalize_session(self) -> None:
            if not self._session:
                return
            try:
                completed_node = self._session.to_create_node()
                completed_node.payload["completedAt"] = int(time.time() * 1000)
                await self.client.create_node(completed_node)
            except Exception:
                pass
            finally:
                CausalSession.clear_session_file()
                self._session = None
                self._node_id = None

else:
    class CausalLangGraphCallback:  # type: ignore
        """Stub class when langchain-core is not installed."""
        def __init__(self, *args: Any, **kwargs: Any):
            raise ImportError(
                "langchain-core is required for CausalLangGraphCallback. "
                "Install it with: pip install 'causal-sdk[langgraph]'"
            )
