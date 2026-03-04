"""
RCA Microservice — FastAPI server wrapping the LangGraph RCA engine.

Called by the Fastify API at POST /analyze.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from .graph import rca_graph, rca_graph_with_review
from .state import RCAState

# ── Request / Response schemas ────────────────────────────────────

class RCARequest(BaseModel):
    traceId: str
    rootNodeId: str
    orgId: str = "default"
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    enableHumanReview: bool = False


class RCAResponse(BaseModel):
    traceId: str
    rootCauses: list[dict[str, Any]]
    requiresHumanReview: bool = False
    threadId: str | None = None


class ReviewRequest(BaseModel):
    threadId: str
    confirmedHypotheses: list[str]  # list of confirmed node IDs


# ── App ───────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Causal RCA service starting on port {os.environ.get('RCA_PORT', 8001)}")
    yield
    print("Causal RCA service shutting down")


app = FastAPI(
    title="Causal RCA Engine",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "causal-rca"}


@app.post("/analyze", response_model=RCAResponse)
async def analyze(request: RCARequest):
    """
    Run the LangGraph RCA engine for a given incident node.

    If enableHumanReview=True and confidence is low, returns
    requiresHumanReview=True with a threadId for resumption.
    """
    initial_state = RCAState(
        incident_node_id=request.rootNodeId,
        org_id=request.orgId,
        trace_id=request.traceId,
        trace_graph={"nodes": request.nodes, "edges": request.edges},
        hypotheses=[],
        root_causes=[],
        explanation="",
        counterfactual="",
        requires_human_review=False,
        error=None,
    )

    if request.enableHumanReview:
        # Use the graph with interrupt capability
        thread_id = f"rca-{request.traceId}"
        config = {"configurable": {"thread_id": thread_id}}

        result = await rca_graph_with_review.ainvoke(initial_state, config=config)

        if result.get("requires_human_review"):
            return RCAResponse(
                traceId=request.traceId,
                rootCauses=[],
                requiresHumanReview=True,
                threadId=thread_id,
            )

        return RCAResponse(
            traceId=request.traceId,
            rootCauses=result.get("root_causes", []),
        )
    else:
        # Standard run — no interrupts
        result = await rca_graph.ainvoke(initial_state)

        if result.get("error"):
            raise HTTPException(status_code=422, detail=result["error"])

        return RCAResponse(
            traceId=request.traceId,
            rootCauses=result.get("root_causes", []),
        )


@app.post("/analyze/resume", response_model=RCAResponse)
async def resume_analysis(request: ReviewRequest):
    """
    Resume a paused RCA run after human review.
    The engineer has confirmed which hypotheses are valid.
    """
    config = {"configurable": {"thread_id": request.threadId}}

    # Update state with confirmed hypotheses
    current_state = rca_graph_with_review.get_state(config)
    current_hypotheses = current_state.values.get("hypotheses", [])

    # Filter to only confirmed hypotheses
    confirmed_hypotheses = [
        h for h in current_hypotheses
        if h["node_id"] in request.confirmedHypotheses
    ]

    # Update state and resume from explainRootCause
    rca_graph_with_review.update_state(
        config,
        {
            "hypotheses": confirmed_hypotheses,
            "requires_human_review": False,
        },
        as_node="humanReview",
    )

    result = await rca_graph_with_review.ainvoke(None, config=config)

    return RCAResponse(
        traceId=request.threadId.replace("rca-", ""),
        rootCauses=result.get("root_causes", []),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "rca.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("RCA_PORT", 8001)),
        reload=True,
    )
