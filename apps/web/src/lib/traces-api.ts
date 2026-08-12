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

/** Writes are best-effort too: null on any failure, never a thrown render. */
async function post<T>(path: string, body: unknown, timeout = TIMEOUT): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
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

/** The finding id for a trace. `GET /traces/:id` does not carry it, and the
 *  promote endpoint is keyed on it — without this the one-click path has no id
 *  to send. Null when the trace has no finding, or when the API is unreachable. */
export async function fetchFindingId(traceId: string): Promise<string | null> {
  try {
    const findings = await fetchFindings(200);
    const match = findings.find((f) => f["traceId"] === traceId);
    return (match?.["findingId"] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

// ── Datasets & evals ────────────────────────────────────────────────
export interface LiveCaseAssertion {
  id: string;
  kind:
    | "must_not_raise"
    | "must_contain"
    | "must_not_contain"
    | "must_call_tool"
    | "must_confirm"
    | "latency_under_ms"
    | "cost_under_usd"
    | "no_unsourced_number";
  description: string;
  target: string;
}

export interface LiveDatasetItem {
  id: string;
  datasetId: string;
  traceId: string | null;
  findingId: string | null;
  title: string | null;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  spanSignature: string | null;
  assertions: LiveCaseAssertion[];
  tags: string[];
  severity: "critical" | "high" | "medium";
  difficulty: "regression" | "edge-case" | "adversarial";
  notes: string | null;
  createdAt: string;
}

export interface LiveDataset {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  createdAt: string;
}

export interface LiveDatasetDetail extends LiveDataset {
  items: LiveDatasetItem[];
  lastRun: {
    id: string;
    name: string | null;
    status: string;
    total: number;
    passed: number;
    failed: number;
    score: number;
    startedAt: string;
    finishedAt: string | null;
  } | null;
}

export interface LiveAssertionResult {
  id: string;
  passed: boolean;
  detail: string;
}

export interface LiveEvalResult {
  id: string;
  datasetItemId: string | null;
  passed: boolean;
  score: number;
  /** The evidence the judge scored on, as stored — not prose. */
  actual: Record<string, unknown> | null;
  reason: string | null;
  assertionResults: LiveAssertionResult[];
  latencyMs: number | null;
  /** Null when the harness measured no cost; rendering it as $0 would claim a measurement. */
  costUsd: number | null;
  delta: "fixed" | "regressed" | "unchanged";
  spanSignature?: string | null;
  title?: string | null;
  notes?: string | null;
  traceId?: string | null;
  findingId?: string | null;
  createdAt?: string;
}

export interface LiveEvalRun {
  id: string;
  datasetId: string;
  datasetName?: string | null;
  name: string | null;
  status: string;
  model: string | null;
  judgeModel: string | null;
  release: string | null;
  commit: string | null;
  costUsd: number | null;
  total: number;
  passed: number;
  failed: number;
  score: number;
  startedAt: string;
  finishedAt: string | null;
  /** Only `GET /evals/:id` carries the per-case results; the list omits them. */
  results?: LiveEvalResult[];
}

export interface LivePromoteResult {
  item: LiveDatasetItem;
  dataset: LiveDataset;
  /** false when this finding had already been promoted into the dataset. */
  created: boolean;
}

export async function fetchDatasets(): Promise<LiveDataset[]> {
  const data = await get<{ datasets: LiveDataset[] }>("/api/v1/datasets");
  return data.datasets ?? [];
}

export async function fetchDataset(id: string): Promise<LiveDatasetDetail | null> {
  try {
    return await get<LiveDatasetDetail>(`/api/v1/datasets/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function fetchEvalRuns(datasetId?: string): Promise<LiveEvalRun[]> {
  const query = datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : "";
  const data = await get<{ runs: LiveEvalRun[] }>(`/api/v1/evals${query}`);
  return data.runs ?? [];
}

export async function fetchEvalRun(id: string): Promise<LiveEvalRun | null> {
  try {
    return await get<LiveEvalRun>(`/api/v1/evals/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/** THE ONE-CLICK PATH: promote a production finding to a golden case. Null when
 *  the call failed, so a dead API can never look like a filed case. */
export async function promoteFinding(findingId: string, datasetId?: string | null): Promise<LivePromoteResult | null> {
  return post<LivePromoteResult>(`/api/v1/findings/${encodeURIComponent(findingId)}/promote`, {
    datasetId: datasetId ?? null,
  });
}

export async function runEval(
  datasetId: string,
  opts?: { name?: string | null; release?: string | null; commit?: string | null }
): Promise<LiveEvalRun | null> {
  // A run judges every case in the set — well past the read timeout.
  return post<LiveEvalRun>(`/api/v1/datasets/${encodeURIComponent(datasetId)}/evals`, opts ?? {}, 120000);
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
