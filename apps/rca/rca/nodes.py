"""
LangGraph node functions for the RCA engine.

Each function takes RCAState and returns a partial state update.
"""

from __future__ import annotations

import json
import os
from typing import Any

import anthropic
from neo4j import GraphDatabase

from .state import RCAState, Hypothesis, RootCause

_anthropic = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
_MODEL = "claude-sonnet-4-6"

_neo4j_driver = None


def get_neo4j():
    global _neo4j_driver
    if _neo4j_driver is None:
        _neo4j_driver = GraphDatabase.driver(
            os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
            auth=(
                os.environ.get("NEO4J_USER", "neo4j"),
                os.environ.get("NEO4J_PASSWORD", "causal_dev_password"),
            ),
        )
    return _neo4j_driver


# ── Node 1: gatherEvidence ────────────────────────────────────────
def gather_evidence(state: RCAState) -> dict[str, Any]:
    """
    Query Neo4j for all ancestors of the incident node.
    Returns the TraceGraph (nodes + edges).
    """
    incident_id = state["incident_node_id"]
    org_id = state["org_id"]

    driver = get_neo4j()
    with driver.session() as session:
        result = session.run(
            """
            MATCH (root:CausalNode {id: $id, orgId: $orgId})
            OPTIONAL MATCH path = (ancestor:CausalNode {orgId: $orgId})-[*1..6]->(root)
            WITH root,
                 collect(DISTINCT ancestor) AS ancestors,
                 collect(DISTINCT relationships(path)) AS rel_lists
            RETURN root,
                   ancestors,
                   [r IN apoc.coll.flatten(rel_lists) | {
                     id: r.id,
                     sourceId: startNode(r).id,
                     targetId: endNode(r).id,
                     type: type(r),
                     weight: r.weight,
                     linkStrategy: r.linkStrategy,
                     isSuggested: r.isSuggested
                   }] AS edges
            """,
            id=incident_id,
            orgId=org_id,
        )

        record = result.single()
        if not record:
            return {"trace_graph": {"nodes": [], "edges": []}, "error": f"Node {incident_id} not found"}

        def neo4j_to_dict(node) -> dict:
            d = dict(node.items())
            if "payloadJson" in d:
                try:
                    d["payload"] = json.loads(d.pop("payloadJson"))
                except Exception:
                    d["payload"] = {}
            d.pop("payloadText", None)
            return d

        root_node = neo4j_to_dict(record["root"])
        ancestor_nodes = [neo4j_to_dict(n) for n in record["ancestors"] if n is not None]
        edges = [dict(e) for e in (record["edges"] or [])]

        all_nodes = [root_node] + ancestor_nodes

    return {
        "trace_graph": {"nodes": all_nodes, "edges": edges},
        "error": None,
    }


# ── Node 2: scoreHypotheses ───────────────────────────────────────
def score_hypotheses(state: RCAState) -> dict[str, Any]:
    """
    Rank root cause candidates by causal weight.
    Routes to human review if top confidence < 0.5.
    """
    trace_graph = state["trace_graph"]
    nodes = trace_graph.get("nodes", [])
    edges = trace_graph.get("edges", [])

    if not nodes:
        return {
            "hypotheses": [],
            "requires_human_review": True,
        }

    # Build adjacency
    outgoing: dict[str, list[dict]] = {}
    for edge in edges:
        src = edge.get("sourceId", "")
        if src not in outgoing:
            outgoing[src] = []
        outgoing[src].append(edge)

    node_map = {n["id"]: n for n in nodes}

    # Find candidate root cause nodes (REASONING, SPEC, INTENT layers)
    # that are NOT the root incident node
    incident_id = state["incident_node_id"]
    candidates: list[Hypothesis] = []

    for node in nodes:
        if node["id"] == incident_id:
            continue
        if node.get("layer") not in ("REASONING", "SPEC", "INTENT", "CODE"):
            continue

        # Compute cumulative probability along path to incident
        # (simplified: product of outgoing edge weights)
        out_edges = outgoing.get(node["id"], [])
        if not out_edges:
            # Leaf node with no outgoing path to incident
            continue

        # Find the edge with highest weight to traverse
        best_edge = max(out_edges, key=lambda e: float(e.get("weight", 0)))
        base_prob = float(best_edge.get("weight", 0.5))

        # Penalize if suggested (not confirmed)
        if best_edge.get("isSuggested"):
            base_prob *= 0.7

        # Bonus for REASONING layer (closest to agent decision)
        layer = node.get("layer", "")
        if layer == "REASONING":
            base_prob = min(0.99, base_prob * 1.1)
        elif layer == "SPEC":
            base_prob = min(0.99, base_prob * 1.0)

        candidates.append(
            Hypothesis(
                node_id=node["id"],
                layer=layer,
                probability=round(base_prob, 4),
                evidence_edge_ids=[best_edge.get("id", "")],
            )
        )

    # Sort by probability descending
    candidates.sort(key=lambda c: c["probability"], reverse=True)

    top_probability = candidates[0]["probability"] if candidates else 0.0
    requires_human_review = top_probability < 0.5

    return {
        "hypotheses": candidates[:5],  # top 5 candidates
        "requires_human_review": requires_human_review,
    }


# ── Node 3: humanReview (interrupt node) ─────────────────────────
def human_review(state: RCAState) -> dict[str, Any]:
    """
    When confidence is too low, interrupt for human confirmation.
    In LangGraph this node will trigger a __interrupt__ that surfaces
    to the UI for the engineer to confirm/reject hypotheses.
    This node is only reached when requires_human_review = True.
    """
    # The actual interrupt is handled by LangGraph's interrupt mechanism.
    # This node just marks that we've gone through human review.
    return {"requires_human_review": False}


# ── Node 4: explainRootCause ──────────────────────────────────────
def explain_root_cause(state: RCAState) -> dict[str, Any]:
    """
    Call Claude to generate a plain-English explanation of the root cause.
    """
    hypotheses = state.get("hypotheses", [])
    trace_graph = state["trace_graph"]
    nodes = trace_graph.get("nodes", [])

    if not hypotheses:
        return {
            "root_causes": [],
            "explanation": "Insufficient data to determine root cause.",
        }

    top = hypotheses[0]
    node_map = {n["id"]: n for n in nodes}
    root_cause_node = node_map.get(top["node_id"], {})
    incident_node = node_map.get(state["incident_node_id"], {})

    # Build context for Claude
    causal_chain_summary = _summarize_causal_chain(nodes, trace_graph.get("edges", []), state["incident_node_id"])

    prompt = f"""You are analyzing a production incident to identify its root cause.

INCIDENT:
{json.dumps(incident_node.get("payload", {}), indent=2)}

ROOT CAUSE CANDIDATE ({root_cause_node.get("layer", "unknown")} layer, {round(top["probability"] * 100)}% confidence):
{json.dumps(root_cause_node.get("payload", {}), indent=2)}

CAUSAL CHAIN:
{causal_chain_summary}

Write a clear, plain-English explanation of why this incident happened. Be specific about:
1. What decision the agent made (if applicable)
2. What information it had or was missing
3. How that decision led to the incident

The explanation should be understandable by someone who hasn't seen the code.
Keep it to 3-5 sentences."""

    response = _anthropic.messages.create(
        model=_MODEL,
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )
    explanation = response.content[0].text if response.content else ""

    return {"explanation": explanation}


# ── Node 5: generateCounterfactual ───────────────────────────────
def generate_counterfactual(state: RCAState) -> dict[str, Any]:
    """
    Generate: "If X had been Y, the incident would not have occurred."
    """
    hypotheses = state.get("hypotheses", [])
    trace_graph = state["trace_graph"]
    nodes = trace_graph.get("nodes", [])
    explanation = state.get("explanation", "")

    if not hypotheses:
        return {"counterfactual": ""}

    top = hypotheses[0]
    node_map = {n["id"]: n for n in nodes}
    root_cause_node = node_map.get(top["node_id"], {})

    prompt = f"""Based on this root cause analysis, generate a single counterfactual statement.

ROOT CAUSE EXPLANATION:
{explanation}

ROOT CAUSE NODE ({root_cause_node.get("layer")}):
{json.dumps(root_cause_node.get("payload", {}), indent=2)}

Complete this sentence: "If [specific change], this incident would not have occurred."

Be concrete and actionable. The counterfactual should describe a specific change to the spec,
the agent's context, or the code that would have prevented the incident.
Output only the counterfactual sentence, nothing else."""

    response = _anthropic.messages.create(
        model=_MODEL,
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    counterfactual = response.content[0].text.strip() if response.content else ""

    return {"counterfactual": counterfactual}


# ── Node 6: formatOutput ─────────────────────────────────────────
def format_output(state: RCAState) -> dict[str, Any]:
    """
    Assemble the final RootCause list from all gathered information.
    """
    hypotheses = state.get("hypotheses", [])
    explanation = state.get("explanation", "")
    counterfactual = state.get("counterfactual", "")

    root_causes: list[RootCause] = []
    for i, hyp in enumerate(hypotheses):
        root_causes.append(
            RootCause(
                nodeId=hyp["node_id"],
                layer=hyp["layer"],
                probability=hyp["probability"],
                explanation=explanation if i == 0 else f"Secondary factor (probability: {hyp['probability']:.0%})",
                counterfactual=counterfactual if i == 0 else "",
                evidenceEdgeIds=hyp["evidence_edge_ids"],
                interventionPoint=_get_intervention_point(hyp["layer"]),
            )
        )

    return {"root_causes": root_causes}


# ── Helpers ───────────────────────────────────────────────────────
def _summarize_causal_chain(nodes: list[dict], edges: list[dict], root_id: str) -> str:
    """Build a readable summary of the causal chain."""
    node_map = {n["id"]: n for n in nodes}
    layer_order = ["INTENT", "SPEC", "REASONING", "CODE", "EXECUTION", "INCIDENT"]

    # Sort nodes by layer order
    sorted_nodes = sorted(
        nodes,
        key=lambda n: layer_order.index(n.get("layer", "INCIDENT")) if n.get("layer") in layer_order else 99,
    )

    lines = []
    for node in sorted_nodes:
        layer = node.get("layer", "?")
        payload = node.get("payload", {})
        title = (
            payload.get("title")
            or payload.get("commitMessage", "")[:60]
            or payload.get("summary", "")[:60]
            or payload.get("externalId", "")
            or node.get("id", "")[:8]
        )
        lines.append(f"  [{layer}] {title}")

    return "\n".join(lines)


def _get_intervention_point(layer: str) -> str:
    return {
        "INTENT": "Clarify the intent document",
        "SPEC": "Add explicit constraints to the spec",
        "REASONING": "Improve agent context or add a CLAUDE.md rule",
        "CODE": "Add code review or test coverage",
        "EXECUTION": "Add runtime guardrails or circuit breakers",
    }.get(layer, "Review and improve the root cause artifact")
