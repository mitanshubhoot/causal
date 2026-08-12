/** Wire shapes returned by the Causal API (apps/api/src/routes/traces.ts). */

export type SpanKind =
  | "agent" | "llm" | "tool" | "http" | "db" | "function"
  | "skill" | "workflow" | "search" | "shell";

export type SpanStatus = "ok" | "warn" | "error";

export interface Span {
  id: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  startMs: number;
  durationMs: number;
  status: SpanStatus;
  attributes?: { label: string; value: string }[];
  io?: { input?: string; output?: string };
  git?: { file: string; line: number; commit: string };
  code?: { lang: string; startLine: number; lines: { n: number; text: string; marked?: boolean }[] };
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  error?: string;
}

export interface TraceFinding {
  detector: string;
  title: string;
  severity: string;
  confidence: number;
  summary: string;
  triggeredSpanId: string | null;
  judgeModel: string | null;
}

export interface TraceSummary {
  id: string;
  service: string;
  environment: string;
  name: string | null;
  status: SpanStatus;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  spanCount: number;
  startedAt: string;
}

export interface TraceDetail {
  traceId: string;
  service: string;
  environment: string;
  title: string | null;
  status: SpanStatus;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  repo?: string;
  gitRef?: string;
  user?: string;
  sessionId?: string;
  metadata?: { label: string; value: string }[];
  startedAt: string;
  spans: Span[];
  finding: TraceFinding | null;
}

export interface Detector {
  id: string;
  name: string;
  type: string;
  description: string | null;
  enabled: boolean;
  openFindings: number;
  totalFindings: number;
  totalRuns: number;
}

export interface Finding {
  findingId: string;
  traceId: string;
  detector: string;
  title: string;
  severity: string;
  confidence: number;
  summary: string;
  service: string | null;
  timestamp: string;
  resolved: boolean;
}

export interface AskResponse {
  answer: string;
  model: string;
  grounded: boolean;
}

export interface HealthResponse {
  status: string;
  services?: Record<string, { status: string; latencyMs?: number; error?: string }>;
  totalLatencyMs?: number;
}

export interface TracesListResponse {
  traces: TraceSummary[];
  count: number;
}

export interface DetectorsListResponse {
  detectors: Detector[];
  count: number;
}

export interface FindingsListResponse {
  findings: Finding[];
  count: number;
}
