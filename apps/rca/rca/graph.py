"""
RCA Engine — LangGraph StateGraph

Flow:
  gatherEvidence → scoreHypotheses → [humanReview?] → explainRootCause
                                   → generateCounterfactual → formatOutput

The humanReview branch fires when top hypothesis confidence < 0.5,
allowing engineers to confirm/reject candidates before the LLM
generates an explanation (preventing confident wrong explanations).
"""

from __future__ import annotations

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from .state import RCAState
from .nodes import (
    gather_evidence,
    score_hypotheses,
    human_review,
    explain_root_cause,
    generate_counterfactual,
    format_output,
)


def needs_human_review(state: RCAState) -> str:
    """Router: send to human review if confidence too low."""
    if state.get("requires_human_review", False):
        return "human_review"
    return "explain_root_cause"


def build_rca_graph() -> StateGraph:
    builder = StateGraph(RCAState)

    # ── Nodes ────────────────────────────────────────────────────
    builder.add_node("gatherEvidence", gather_evidence)
    builder.add_node("scoreHypotheses", score_hypotheses)
    builder.add_node("humanReview", human_review)
    builder.add_node("explainRootCause", explain_root_cause)
    builder.add_node("generateCounterfactual", generate_counterfactual)
    builder.add_node("formatOutput", format_output)

    # ── Edges ────────────────────────────────────────────────────
    builder.set_entry_point("gatherEvidence")
    builder.add_edge("gatherEvidence", "scoreHypotheses")

    # Conditional routing based on confidence
    builder.add_conditional_edges(
        "scoreHypotheses",
        needs_human_review,
        {
            "human_review": "humanReview",
            "explain_root_cause": "explainRootCause",
        },
    )

    # After human review, always proceed to explanation
    builder.add_edge("humanReview", "explainRootCause")
    builder.add_edge("explainRootCause", "generateCounterfactual")
    builder.add_edge("generateCounterfactual", "formatOutput")
    builder.add_edge("formatOutput", END)

    return builder


# ── Compiled graph (singleton) ────────────────────────────────────
_checkpointer = MemorySaver()
_graph_builder = build_rca_graph()

# Compile without interrupt for standard use
rca_graph = _graph_builder.compile()

# Compile with interrupt for human-in-the-loop use
rca_graph_with_review = _graph_builder.compile(
    checkpointer=_checkpointer,
    interrupt_before=["humanReview"],
)
