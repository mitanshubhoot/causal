import type { CausalNode, TraceGraph, ReplayResult } from "@causal/types";
import {
  getMockIncidents,
  getMockTrace,
  getMockNode,
  getMockReplay,
  getMockPostMortem,
} from "./mock-data";

// Same-origin by default so next.config's /api/v1 rewrite proxies to
// CAUSAL_API_URL. NEVER default to localhost:3001 — on a deployed site that
// would fire fetches at the *visitor's* machine.
const API_BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "";
const API_KEY = process.env["NEXT_PUBLIC_CAUSAL_API_KEY"] ?? "";

// Demo mode serves mock data without ever hitting the API. Explicitly enabled
// with NEXT_PUBLIC_DEMO_MODE=1, and — as the deployed demo relies on — it
// defaults ON whenever no API URL is configured at all, so a cold/absent
// backend never shows a spinner or a network error.
const FORCE_DEMO =
  process.env["NEXT_PUBLIC_DEMO_MODE"] === "1" ||
  process.env["NEXT_PUBLIC_DEMO_MODE"] === "true" ||
  !process.env["NEXT_PUBLIC_API_URL"];

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

  runReplay: (body: { snapshotId?: string; rootNodeId?: string }) =>
    apiFetch<ReplayResult>(
      "/api/v1/replay",
      { method: "POST", body: JSON.stringify(body) },
      () => getMockReplay(body.rootNodeId ?? body.snapshotId ?? "")
    ),

  // Post-mortem — return a rich per-incident demo post-mortem so the page
  // renders instantly with a real document, not a skeleton.
  generatePostMortem: (body: { traceGraphId?: string; rootNodeId?: string }) =>
    apiFetch<{
      id: string;
      markdown: string;
      linearTicket: Record<string, unknown>;
      claudeMdRule: string;
    }>(
      "/api/v1/postmortem",
      { method: "POST", body: JSON.stringify(body) },
      () => getMockPostMortem(body.rootNodeId ?? "")
    ),

  // Edge confirmation
  confirmEdge: (edgeId: string, confirmed: boolean, userId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/v1/edges/${edgeId}/confirm`,
      { method: "POST", body: JSON.stringify({ confirmed, userId }) },
      () => ({ ok: true })
    ),
};
