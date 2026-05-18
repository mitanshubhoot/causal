import type { CausalNode, TraceGraph, ReplayResult } from "@causal/types";
import {
  getMockIncidents,
  getMockTrace,
  getMockNode,
} from "./mock-data";

const API_BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
const API_KEY = process.env["NEXT_PUBLIC_CAUSAL_API_KEY"] ?? "";

// Demo mode forces all calls to use mock data without even hitting the API.
// Set NEXT_PUBLIC_DEMO_MODE=1 on Vercel to enable; defaults on when no API URL
// is configured at all.
const FORCE_DEMO =
  process.env["NEXT_PUBLIC_DEMO_MODE"] === "1" ||
  process.env["NEXT_PUBLIC_DEMO_MODE"] === "true";

// Timeout fetch — Vercel/Render cold-starts can hang; if the API doesn't
// respond within 5s we fall back to mock data so the UI is never blocked.
const API_TIMEOUT_MS = 5000;

async function apiFetchRaw<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        ...(init.headers ?? {}),
      },
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

// apiFetch with a mock fallback. If the API call fails for any reason
// (network error, timeout, non-2xx, missing config), the supplied
// fallback function is invoked and its result is returned.
async function apiFetch<T>(
  path: string,
  init: RequestInit,
  fallback: () => T
): Promise<T> {
  if (FORCE_DEMO) return fallback();
  try {
    return await apiFetchRaw<T>(path, init);
  } catch (err) {
    if (typeof window !== "undefined") {
      console.warn(`[api] ${path} failed, using mock fallback:`, err);
    }
    return fallback();
  }
}

export const api = {
  // Nodes
  getNode: (id: string) =>
    apiFetch<CausalNode>(
      `/api/v1/nodes/${id}`,
      {},
      () => {
        const node = getMockNode(id);
        if (!node) throw new Error(`Mock node ${id} not found`);
        return node;
      }
    ),

  getNodes: (layer?: string) =>
    apiFetch<{ nodes: unknown[]; count: number }>(
      `/api/v1/nodes${layer ? `?layer=${layer}` : ""}`,
      {},
      () => (layer === "INCIDENT" ? getMockIncidents() : { nodes: [], count: 0 })
    ),

  getAncestors: (id: string) =>
    apiFetch<{ nodes: CausalNode[]; edges: unknown[] }>(
      `/api/v1/nodes/${id}/ancestors`,
      {},
      () => {
        const tg = getMockTrace(id);
        return { nodes: tg.nodes, edges: tg.edges };
      }
    ),

  getIncidents: () =>
    apiFetch<{ nodes: unknown[]; count: number }>(
      `/api/v1/nodes?layer=INCIDENT`,
      {},
      () => getMockIncidents()
    ),

  // Trace
  getTrace: (rootNodeId: string) =>
    apiFetch<TraceGraph>(
      "/api/v1/trace",
      { method: "POST", body: JSON.stringify({ rootNodeId }) },
      () => getMockTrace(rootNodeId)
    ),

  getTraceById: (id: string) =>
    apiFetch<TraceGraph>(`/api/v1/trace/${id}`, {}, () => getMockTrace(id)),

  // Replay — no realistic mock for arbitrary replays; surface a clear error
  getSnapshot: (id: string) =>
    apiFetch<unknown>(`/api/v1/replay/snapshots/${id}`, {}, () => ({
      snapshotId: id,
      demo: true,
      message: "Snapshot replay requires a live API backend.",
    })),

  getFidelity: (snapshotId: string) =>
    apiFetch<unknown>(`/api/v1/replay/fidelity/${snapshotId}`, {}, () => ({
      snapshotId,
      demo: true,
      fidelityScore: 0.92,
    })),

  runReplay: (body: unknown) =>
    apiFetch<ReplayResult>(
      "/api/v1/replay",
      { method: "POST", body: JSON.stringify(body) },
      () => {
        throw new Error("Replay requires a live API backend.");
      }
    ),

  // Post-mortem — return a static demo post-mortem so the page renders
  generatePostMortem: (body: { traceGraphId?: string; rootNodeId?: string }) =>
    apiFetch<{
      id: string;
      markdown: string;
      linearTicket: Record<string, unknown>;
      claudeMdRule: string;
    }>(
      "/api/v1/postmortem",
      { method: "POST", body: JSON.stringify(body) },
      () => ({
        id: "demo-postmortem",
        markdown: buildDemoPostMortem(body.rootNodeId),
        linearTicket: {
          title: "Demo post-mortem ticket",
          description: "This is a demo post-mortem generated locally.",
        },
        claudeMdRule:
          "When implementing tool calls that look up data by key, use dictionary `.get()` with defaults instead of direct key access — gracefully handle missing fields.",
      })
    ),

  // Edge confirmation
  confirmEdge: (edgeId: string, confirmed: boolean, userId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/v1/edges/${edgeId}/confirm`,
      { method: "POST", body: JSON.stringify({ confirmed, userId }) },
      () => ({ ok: true })
    ),
};

function buildDemoPostMortem(rootNodeId?: string): string {
  const tg = rootNodeId ? getMockTrace(rootNodeId) : null;
  const title =
    tg && (tg.nodes.find((n) => n.layer === "INCIDENT")?.payload as Record<string, unknown> | undefined)?.["title"];
  return `# Post-Mortem — ${title ?? "Demo Incident"}

## Summary
${tg?.rootCauses[0]?.explanation ?? "Demo post-mortem. Connect a live API for AI-generated content."}

## Root Cause
${tg?.rootCauses[0]?.explanation ?? "n/a"}

## Counterfactual
${tg?.rootCauses[0]?.counterfactual ?? "n/a"}

## Action Items
- Add input validation for dictionary keys
- Add unit tests for missing-field paths
- Review tool implementations across the codebase for similar patterns
`;
}
