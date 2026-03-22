"""
Session management for Causal SDK.

Manages the .causal-session file and in-memory session state.
One session = one agent run = one REASONING node.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

try:
    from uuidv7 import uuidv7
except ImportError:
    import uuid
    def uuidv7() -> str:
        return str(uuid.uuid4())

from .models import CreateNode, ContextSnapshot


SESSION_FILE = ".causal-session"


class CausalSession:
    def __init__(
        self,
        org_id: str,
        repo_id: str,
        model_id: str = "unknown",
        agent_id: str | None = None,
    ):
        self.session_id = uuidv7()
        self.org_id = org_id
        self.repo_id = repo_id
        self.model_id = model_id
        self.agent_id = agent_id
        self.started_at = int(time.time() * 1000)
        self.snapshot_ids: list[str] = []
        self.tools_called: list[str] = []
        self.files_modified: list[str] = []
        self.spec_ids: list[str] = []
        self._node_id: str | None = None

    def write_session_file(self, path: str = SESSION_FILE) -> None:
        """Write session ID to .causal-session for git hook to pick up."""
        Path(path).write_text(self.session_id)

    @staticmethod
    def read_session_file(path: str = SESSION_FILE) -> str | None:
        try:
            return Path(path).read_text().strip() or None
        except FileNotFoundError:
            return None

    @staticmethod
    def clear_session_file(path: str = SESSION_FILE) -> None:
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:
            pass

    def to_create_node(self) -> CreateNode:
        return CreateNode(
            layer="REASONING",
            kind="agent_session",
            timestamp=self.started_at,
            agentId=self.agent_id,
            modelVersion=self.model_id,
            sessionId=self.session_id,
            contextSnapId=None,
            payload={
                "sessionId": self.session_id,
                "modelId": self.model_id,
                "toolsCalled": self.tools_called,
                "filesModified": self.files_modified,
                "specIds": self.spec_ids,
                "snapshotIds": self.snapshot_ids,
                "source": "causal_sdk",
            },
            orgId=self.org_id,
            repoId=self.repo_id,
        )

    def build_snapshot(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]],
        tools_available: list[dict[str, Any]] | None = None,
        decision_type: str = "tool_call",
        token_count: int | None = None,
    ) -> ContextSnapshot:
        snapshot_id = uuidv7()
        head_commit = _get_git_head()

        snapshot_data = {
            "snapshotId": snapshot_id,
            "nodeId": self._node_id or self.session_id,
            "timestamp": int(time.time() * 1000),
            "modelId": self.model_id,
            "systemPrompt": system_prompt,
            "messages": messages,
            "toolsAvailable": tools_available or [],
            "repoState": {
                "headCommit": head_commit,
                "openFiles": self.files_modified[:],
            },
            "contentHash": "",  # Will be computed
            "decisionType": decision_type,
            "tokenCount": token_count,
        }

        # Compute SHA256
        content_hash = hashlib.sha256(
            json.dumps(snapshot_data, sort_keys=True).encode()
        ).hexdigest()
        snapshot_data["contentHash"] = content_hash

        return ContextSnapshot(**snapshot_data)

    def declare_spec(self, spec_id: str, confidence: float = 0.99) -> None:
        """Equivalent of causal_link() — declare what spec this session implements."""
        if spec_id not in self.spec_ids:
            self.spec_ids.append(spec_id)

    def to_dict(self) -> dict[str, Any]:
        """Serialize session state to a dict for persistence or resumption."""
        return {
            "session_id": self.session_id,
            "org_id": self.org_id,
            "repo_id": self.repo_id,
            "model_id": self.model_id,
            "agent_id": self.agent_id,
            "started_at": self.started_at,
            "snapshot_ids": self.snapshot_ids[:],
            "tools_called": self.tools_called[:],
            "files_modified": self.files_modified[:],
            "spec_ids": self.spec_ids[:],
            "node_id": self._node_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CausalSession":
        """Restore a session from a serialized dict."""
        session = cls.__new__(cls)
        session.session_id = data["session_id"]
        session.org_id = data["org_id"]
        session.repo_id = data["repo_id"]
        session.model_id = data.get("model_id", "unknown")
        session.agent_id = data.get("agent_id")
        session.started_at = data["started_at"]
        session.snapshot_ids = data.get("snapshot_ids", [])
        session.tools_called = data.get("tools_called", [])
        session.files_modified = data.get("files_modified", [])
        session.spec_ids = data.get("spec_ids", [])
        session._node_id = data.get("node_id")
        return session


def _get_git_head() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        return "unknown"
