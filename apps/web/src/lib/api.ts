import type { CausalNode, TraceGraph, ReplayResult } from "@causal/types";

const API_BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Nodes
  getNode: (id: string) => apiFetch<CausalNode>(`/api/v1/nodes/${id}`),
  getAncestors: (id: string) => apiFetch<{ nodes: CausalNode[]; edges: unknown[] }>(`/api/v1/nodes/${id}/ancestors`),

  // Trace
  getTrace: (rootNodeId: string) =>
    apiFetch<TraceGraph>("/api/v1/trace", {
      method: "POST",
      body: JSON.stringify({ rootNodeId }),
    }),
  getTraceById: (id: string) => apiFetch<TraceGraph>(`/api/v1/trace/${id}`),

  // Replay
  getSnapshot: (id: string) => apiFetch<unknown>(`/api/v1/replay/snapshots/${id}`),
  getFidelity: (snapshotId: string) => apiFetch<unknown>(`/api/v1/replay/fidelity/${snapshotId}`),
  runReplay: (body: unknown) =>
    apiFetch<ReplayResult>("/api/v1/replay", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Post-mortem
  generatePostMortem: (body: { traceGraphId?: string; rootNodeId?: string }) =>
    apiFetch<{ id: string; markdown: string; linearTicket: Record<string, unknown>; claudeMdRule: string }>(
      "/api/v1/postmortem",
      { method: "POST", body: JSON.stringify(body) }
    ),

  // Edge confirmation
  confirmEdge: (edgeId: string, confirmed: boolean, userId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/edges/${edgeId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmed, userId }),
    }),
};
