"""
Causal SDK HTTP client — sends nodes, edges, and snapshots to the Causal API.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from .models import CausalNode, CausalEdge, CreateNode, CreateEdge


class CausalClient:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        org_id: str | None = None,
        repo_id: str | None = None,
        timeout: float = 10.0,
    ):
        self.api_key = api_key or os.environ.get("CAUSAL_API_KEY", "")
        self.base_url = (base_url or os.environ.get("CAUSAL_API_URL", "http://localhost:3001")).rstrip("/")
        self.org_id = org_id or os.environ.get("CAUSAL_ORG_ID", "default")
        self.repo_id = repo_id or os.environ.get("CAUSAL_REPO_ID", "")
        self._client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "causal-sdk-python/0.1.0",
            },
            timeout=timeout,
        )

    async def create_node(self, node: CreateNode) -> CausalNode:
        node_dict = node.model_dump()
        node_dict.setdefault("orgId", self.org_id)
        node_dict.setdefault("repoId", self.repo_id)
        resp = await self._client.post(f"{self.base_url}/api/v1/nodes", json=node_dict)
        resp.raise_for_status()
        return CausalNode(**resp.json())

    async def create_nodes_batch(self, nodes: list[CreateNode]) -> list[CausalNode]:
        batch = []
        for n in nodes:
            d = n.model_dump()
            d.setdefault("orgId", self.org_id)
            d.setdefault("repoId", self.repo_id)
            batch.append(d)
        resp = await self._client.post(f"{self.base_url}/api/v1/nodes/batch", json=batch)
        resp.raise_for_status()
        return [CausalNode(**n) for n in resp.json()["nodes"]]

    async def create_edge(self, edge: CreateEdge) -> CausalEdge:
        d = edge.model_dump()
        d.setdefault("orgId", self.org_id)
        resp = await self._client.post(f"{self.base_url}/api/v1/edges", json=d)
        resp.raise_for_status()
        return CausalEdge(**resp.json())

    async def upload_snapshot(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        resp = await self._client.post(
            f"{self.base_url}/api/v1/snapshots",
            content=json.dumps(snapshot),
        )
        resp.raise_for_status()
        return resp.json()

    async def get_node(self, node_id: str) -> CausalNode:
        resp = await self._client.get(f"{self.base_url}/api/v1/nodes/{node_id}")
        resp.raise_for_status()
        return CausalNode(**resp.json())

    async def get_trace(self, root_node_id: str, max_depth: int = 6) -> dict[str, Any]:
        resp = await self._client.post(
            f"{self.base_url}/api/v1/trace",
            json={"rootNodeId": root_node_id, "maxDepth": max_depth},
        )
        resp.raise_for_status()
        return resp.json()

    async def close(self):
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
