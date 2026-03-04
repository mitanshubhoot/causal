"""Pydantic models mirroring @causal/types."""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


Layer = Literal["INTENT", "SPEC", "REASONING", "CODE", "EXECUTION", "INCIDENT"]
EdgeType = Literal[
    "SPECIFIED_BY", "REASONED_FROM", "PRODUCED",
    "DEPLOYED_AS", "CAUSED", "CONTRIBUTED_TO", "CONTRADICTS", "CORRECTED_BY",
]
LinkStrategy = Literal["session_id", "stack_trace", "time_window", "vector", "manual"]


class CausalNode(BaseModel):
    id: str
    layer: Layer
    kind: str
    timestamp: int
    agentId: str | None = None
    modelVersion: str | None = None
    sessionId: str | None = None
    contextSnapId: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    embedding: list[float] | None = None
    orgId: str
    repoId: str


class CreateNode(BaseModel):
    layer: Layer
    kind: str
    timestamp: int
    agentId: str | None = None
    modelVersion: str | None = None
    sessionId: str | None = None
    contextSnapId: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    orgId: str = ""
    repoId: str = ""
    id: str | None = None


class CausalEdge(BaseModel):
    id: str
    sourceId: str
    targetId: str
    type: EdgeType
    weight: float
    linkStrategy: LinkStrategy
    confirmedBy: str | None = None
    isSuggested: bool = False
    orgId: str
    createdAt: int


class CreateEdge(BaseModel):
    sourceId: str
    targetId: str
    type: EdgeType
    weight: float
    linkStrategy: LinkStrategy
    confirmedBy: str | None = None
    isSuggested: bool = False
    orgId: str = ""
    id: str | None = None


class ContextSnapshot(BaseModel):
    snapshotId: str
    nodeId: str
    timestamp: int
    modelId: str
    systemPrompt: str
    messages: list[dict[str, Any]]
    toolsAvailable: list[dict[str, Any]] = Field(default_factory=list)
    repoState: dict[str, Any] = Field(default_factory=dict)
    contentHash: str
    decisionType: str = "tool_call"
    tokenCount: int | None = None
