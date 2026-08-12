"use client";

/**
 * Client for the live v2 observability API (`/api/v1/traces...`). Used only when
 * NEXT_PUBLIC_USE_LIVE_TRACES=1; otherwise the explorer stays on the mock so the
 * demo always works. All calls are best-effort — callers fall back to mock.
 */

const BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "";
const KEY = process.env["NEXT_PUBLIC_CAUSAL_API_KEY"] ?? "causal_demo_key_2026";
const TIMEOUT = 6000;

export const LIVE_TRACES = process.env["NEXT_PUBLIC_USE_LIVE_TRACES"] === "1" || process.env["NEXT_PUBLIC_USE_LIVE_TRACES"] === "true";

async function get<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${KEY}` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface LiveTraceRow {
  id: string;
  service: string;
  name: string | null;
  status: "ok" | "warn" | "error";
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  spanCount: number;
  startedAt: string;
}

export async function fetchTraceList(): Promise<LiveTraceRow[]> {
  const data = await get<{ traces: LiveTraceRow[] }>("/api/v1/traces");
  return data.traces ?? [];
}

export async function fetchTraceDetail(id: string): Promise<Record<string, unknown>> {
  return get<Record<string, unknown>>(`/api/v1/traces/${id}`);
}

export async function fetchRca(id: string): Promise<Record<string, unknown> | null> {
  try {
    return await get<Record<string, unknown>>(`/api/v1/traces/${id}/rca`);
  } catch {
    return null; // 404 = no RCA yet
  }
}

// ── Detectors ───────────────────────────────────────────────────────
export interface LiveDetector {
  id: string;
  name: string;
  type: "hallucination" | "tool_failure" | "intent_drift" | "safety";
  description: string;
  enabled: boolean;
  openFindings: number;
  totalFindings: number;
  totalRuns: number;
}

export async function fetchDetectors(): Promise<LiveDetector[]> {
  const data = await get<{ detectors: LiveDetector[] }>("/api/v1/detectors");
  return data.detectors ?? [];
}

export async function fetchDetector(name: string): Promise<Record<string, unknown> | null> {
  try {
    return await get<Record<string, unknown>>(`/api/v1/detectors/${encodeURIComponent(name)}`);
  } catch {
    return null;
  }
}

export async function fetchFindings(limit = 100): Promise<Array<Record<string, unknown>>> {
  const data = await get<{ findings: Array<Record<string, unknown>> }>(`/api/v1/findings?limit=${limit}`);
  return data.findings ?? [];
}

// ── Copilot ─────────────────────────────────────────────────────────
/** Ask a question about a trace. Returns null when the API is unreachable, so
 *  the caller can fall back to the scripted demo answer. */
export async function askCopilot(traceId: string, question: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000); // the model can take a while
  try {
    const res = await fetch(`${BASE}/api/v1/traces/${traceId}/ask`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ question }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { answer?: string };
    return data.answer ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
