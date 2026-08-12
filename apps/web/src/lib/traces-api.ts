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
