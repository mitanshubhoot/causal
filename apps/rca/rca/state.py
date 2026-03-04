"""
RCA State — the TypedDict passed between LangGraph nodes.
"""

from __future__ import annotations

from typing import Any, TypedDict


class Hypothesis(TypedDict):
    node_id: str
    layer: str
    probability: float
    evidence_edge_ids: list[str]


class RootCause(TypedDict):
    nodeId: str
    layer: str
    probability: float
    explanation: str
    counterfactual: str
    evidenceEdgeIds: list[str]
    interventionPoint: str


class RCAState(TypedDict):
    # Input
    incident_node_id: str
    org_id: str
    trace_id: str

    # Intermediate
    trace_graph: dict[str, Any]          # nodes + edges from Neo4j
    hypotheses: list[Hypothesis]         # ranked root cause candidates

    # Output
    root_causes: list[RootCause]
    explanation: str
    counterfactual: str
    requires_human_review: bool
    error: str | None
