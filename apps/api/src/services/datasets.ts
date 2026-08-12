import type { FastifyInstance } from "fastify";
import { getTrace } from "./traces.js";

/**
 * Golden datasets — the bridge between production findings and offline evals.
 *
 * A detector finding is a one-off observation. Promoting it into a dataset item
 * turns it into a permanent regression test: the input that broke us, the
 * behaviour we expected instead (taken from the RCA counterfactual when one
 * exists), and a stable signature of the failure mode so a later eval can
 * recognise the same failure if it ever comes back.
 */

// ── Views over the rows we read ──────────────────────────────────────
interface SpanView {
  id: string;
  parentId?: string | null;
  name: string;
  kind: string;
  status: string;
  error?: string | null;
  git?: { file: string; line: number; commit: string } | null;
  io?: { input?: string; output?: string } | null;
}
interface TraceView {
  traceId: string;
  service: string;
  title: string | null;
  repo?: string;
  spans: SpanView[];
}

/**
 * One assertion on a golden case — a named, machine-checkable expectation.
 *
 * `expected` prose says what "correct" means to a human; assertions are what
 * the harness can actually check, and what a failing verdict points at. A case
 * with no assertions still runs: it falls back to the signature-recurrence
 * check alone.
 */
export interface CaseAssertion {
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

export interface DatasetItem {
  id: string;
  datasetId: string;
  traceId: string | null;
  findingId: string | null;
  title: string | null;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  spanSignature: string | null;
  assertions: CaseAssertion[];
  tags: string[];
  severity: "critical" | "high" | "medium";
  difficulty: "regression" | "edge-case" | "adversarial";
  notes: string | null;
  createdAt: unknown;
}

export interface Dataset {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  createdAt: unknown;
}

export interface DatasetWithItems extends Dataset {
  items: DatasetItem[];
  lastRun: {
    id: string;
    name: string | null;
    status: string;
    total: number;
    passed: number;
    failed: number;
    score: number;
    startedAt: unknown;
    finishedAt: unknown;
  } | null;
}

/** porsager types json() narrowly; every service in this repo casts at the boundary. */
function json(sql: FastifyInstance["pg"], value: unknown) {
  return sql.json(value as Parameters<typeof sql.json>[0]);
}

function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── Failure-mode signatures ──────────────────────────────────────────

/** Lowercase, punctuation-free token so signatures are stable across restarts. */
function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/**
 * Classify an error message into a stable class. Messages carry ids, timestamps
 * and quantities that differ on every occurrence, so the raw string is useless
 * as an identity — but "TypeError", "http_429" or "econnreset" is the same on
 * every occurrence of the same bug.
 */
export function deriveErrorClass(error: string | null | undefined, fallback: string): string {
  const raw = (error ?? "").trim();
  if (!raw) return normalizeToken(fallback) || "unknown";

  // 1. A named exception type — the strongest signal.
  const named = raw.match(/\b([A-Z][A-Za-z0-9_]*(?:Error|Exception|Failure|Timeout|Fault))\b/);
  if (named?.[1]) return normalizeToken(named[1]);

  // 2. An HTTP status on the failing call.
  const http = raw.match(/\b(?:status(?:[ _-]?code)?[:= ]*)?([45]\d{2})\b/);
  if (http?.[1]) return `http_${http[1]}`;

  // 3. A libuv/errno code.
  const errno = raw.match(/\b(E[A-Z]{3,})\b/);
  if (errno?.[1]) return normalizeToken(errno[1]);

  // 4. Fall back to the message head with volatile parts scrubbed out.
  const scrubbed = raw
    .split(/[:\n]/)[0]!
    .replace(/\b[0-9a-f]{8,}\b/gi, "x")
    .replace(/\d+/g, "n");
  return normalizeToken(scrubbed) || (normalizeToken(fallback) || "unknown");
}

/**
 * A stable identity for one failure mode: `<kind>:<span-name>#<error-class>`.
 * Computed identically from a promoted item and from any live span, which is
 * what lets an eval detect "this exact failure is back" with no LLM at all.
 */
export function spanSignature(span: { name: string; kind: string; status: string; error?: string | null }): string {
  const cls = deriveErrorClass(span.error, span.status || "unknown");
  return `${normalizeToken(span.kind) || "span"}:${normalizeToken(span.name) || "span"}#${cls}`;
}

/**
 * A signature ending in `#ok` describes a span that returned successfully —
 * a hallucination or intent-drift case. Every healthy run reproduces it, so it
 * cannot be used as a regression check; those items need the LLM judge.
 */
export function isDiscriminatingSignature(signature: string | null | undefined): boolean {
  return !!signature && !signature.endsWith("#ok");
}

// ── Row mapping ──────────────────────────────────────────────────────
function mapItem(r: Record<string, unknown>): DatasetItem {
  return {
    id: r["id"] as string,
    datasetId: r["dataset_id"] as string,
    traceId: (r["trace_id"] as string | null) ?? null,
    findingId: (r["finding_id"] as string | null) ?? null,
    title: (r["title"] as string | null) ?? null,
    input: (r["input"] as Record<string, unknown>) ?? {},
    expected: (r["expected"] as Record<string, unknown>) ?? {},
    spanSignature: (r["span_signature"] as string | null) ?? null,
    // Columns added by 010. Coalesced here rather than assumed, so a row
    // written before the migration still maps cleanly.
    assertions: Array.isArray(r["assertions"]) ? (r["assertions"] as CaseAssertion[]) : [],
    tags: Array.isArray(r["tags"]) ? (r["tags"] as string[]) : [],
    severity: (r["severity"] as DatasetItem["severity"]) ?? "medium",
    difficulty: (r["difficulty"] as DatasetItem["difficulty"]) ?? "regression",
    notes: (r["notes"] as string | null) ?? null,
    createdAt: r["created_at"],
  };
}

// ── Datasets ─────────────────────────────────────────────────────────

/** All datasets for an org, newest first, with item + run counts. */
export async function listDatasets(fastify: FastifyInstance, orgId: string): Promise<Dataset[]> {
  const rows = (await fastify.pg`
    SELECT d.id, d.name, d.description, d.created_at,
           COUNT(i.id) AS item_count
    FROM datasets d
    LEFT JOIN dataset_items i ON i.dataset_id = d.id
    WHERE d.org_id = ${orgId}
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r["id"] as string,
    name: r["name"] as string,
    description: (r["description"] as string | null) ?? null,
    itemCount: Number(r["item_count"] ?? 0),
    createdAt: r["created_at"],
  }));
}

/**
 * Create a dataset. Upsert on (org_id, name) so the one-click promote path can
 * call this without racing itself — a second promote lands in the same dataset
 * instead of failing on the unique constraint.
 */
export async function createDataset(
  fastify: FastifyInstance,
  orgId: string,
  input: { name: string; description?: string | null }
): Promise<Dataset> {
  const name = input.name.trim().slice(0, 200);
  const description = clip(input.description ?? null, 2000);
  const rows = (await fastify.pg`
    INSERT INTO datasets (org_id, name, description)
    VALUES (${orgId}, ${name}, ${description})
    ON CONFLICT (org_id, name)
    DO UPDATE SET description = COALESCE(EXCLUDED.description, datasets.description)
    RETURNING id, name, description, created_at
  `) as Array<Record<string, unknown>>;
  const d = rows[0]!;
  return {
    id: d["id"] as string,
    name: d["name"] as string,
    description: (d["description"] as string | null) ?? null,
    itemCount: 0,
    createdAt: d["created_at"],
  };
}

/**
 * The dataset row and its TRUE item count, without loading the items.
 *
 * `listDatasets` counts with COUNT(*), so deriving the count from a capped item
 * list here made the two endpoints disagree about the size of the same dataset.
 */
export async function getDatasetMeta(fastify: FastifyInstance, orgId: string, id: string): Promise<Dataset | null> {
  const rows = (await fastify.pg`
    SELECT id, name, description, created_at,
           (SELECT COUNT(*) FROM dataset_items i
             WHERE i.dataset_id = datasets.id AND i.org_id = datasets.org_id) AS item_count
    FROM datasets
    WHERE id = ${id} AND org_id = ${orgId} LIMIT 1
  `) as Array<Record<string, unknown>>;
  const d = rows[0];
  if (!d) return null;
  return {
    id: d["id"] as string,
    name: d["name"] as string,
    description: (d["description"] as string | null) ?? null,
    itemCount: Number(d["item_count"] ?? 0),
    createdAt: d["created_at"],
  };
}

/** Page size for the unbounded item fetch — one round trip per 500 cases. */
const ITEM_PAGE = 500;

/**
 * EVERY golden case in a dataset, oldest first.
 *
 * `getDataset` caps its item list for the UI; an eval run must not inherit that
 * cap — a gate that drops the oldest, longest-standing regressions and then
 * reports `complete` is worse than no gate. Paged so one dataset cannot pull an
 * unbounded result set in a single statement, and ordered ascending so a case
 * promoted while a run is in flight lands after the cursor instead of shifting
 * the window under it.
 */
export async function listAllDatasetItems(
  fastify: FastifyInstance,
  orgId: string,
  datasetId: string
): Promise<DatasetItem[]> {
  const items: DatasetItem[] = [];
  for (let offset = 0; ; offset += ITEM_PAGE) {
    const rows = (await fastify.pg`
      SELECT id, dataset_id, trace_id, finding_id, title, input, expected, span_signature,
             assertions, tags, severity, difficulty, notes, created_at
      FROM dataset_items
      WHERE dataset_id = ${datasetId} AND org_id = ${orgId}
      ORDER BY created_at ASC, id ASC
      LIMIT ${ITEM_PAGE} OFFSET ${offset}
    `) as Array<Record<string, unknown>>;
    items.push(...rows.map(mapItem));
    if (rows.length < ITEM_PAGE) return items;
  }
}

/** One dataset with its golden items and its most recent eval run. */
export async function getDataset(fastify: FastifyInstance, orgId: string, id: string): Promise<DatasetWithItems | null> {
  const dataset = await getDatasetMeta(fastify, orgId, id);
  if (!dataset) return null;

  // Read path: the newest 500 cases are what the UI renders. `itemCount` above
  // still reports the real total, and an eval run reads every case through
  // listAllDatasetItems.
  const items = (await fastify.pg`
    SELECT id, dataset_id, trace_id, finding_id, title, input, expected, span_signature,
           assertions, tags, severity, difficulty, notes, created_at
    FROM dataset_items
    WHERE dataset_id = ${id} AND org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT 500
  `) as Array<Record<string, unknown>>;

  const runs = (await fastify.pg`
    SELECT id, name, status, total, passed, failed, score, started_at, finished_at
    FROM eval_runs
    WHERE dataset_id = ${id} AND org_id = ${orgId}
    ORDER BY started_at DESC
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  const r = runs[0];

  return {
    ...dataset,
    items: items.map(mapItem),
    lastRun: r
      ? {
          id: r["id"] as string,
          name: (r["name"] as string | null) ?? null,
          status: r["status"] as string,
          total: Number(r["total"]),
          passed: Number(r["passed"]),
          failed: Number(r["failed"]),
          score: Number(r["score"]),
          startedAt: r["started_at"],
          finishedAt: r["finished_at"],
        }
      : null,
  };
}

/** True when the dataset exists in this org (guards every write path). */
async function datasetExists(fastify: FastifyInstance, orgId: string, datasetId: string): Promise<boolean> {
  const rows = (await fastify.pg`
    SELECT 1 FROM datasets WHERE id = ${datasetId} AND org_id = ${orgId} LIMIT 1
  `) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

// ── Items ────────────────────────────────────────────────────────────

export interface AddItemInput {
  input: unknown;
  expected?: unknown;
  spanSignature?: string | null;
  title?: string | null;
  assertions?: unknown;
  tags?: string[] | null;
  severity?: DatasetItem["severity"] | null;
  difficulty?: DatasetItem["difficulty"] | null;
  notes?: string | null;
  traceId?: string | null;
  findingId?: string | null;
}

const ASSERTION_KINDS: ReadonlySet<string> = new Set([
  "must_not_raise", "must_contain", "must_not_contain", "must_call_tool",
  "must_confirm", "latency_under_ms", "cost_under_usd", "no_unsourced_number",
]);

/**
 * Coerce caller-supplied assertions into the stored shape.
 *
 * Silently DROPPING a malformed assertion would be the worst outcome: the case
 * would look checked while an expectation quietly went unenforced. Anything
 * unrecognisable is rejected by the route's schema before it reaches here; this
 * is the last line of defence for shape, ids and bounds.
 */
function normalizeAssertions(value: unknown): CaseAssertion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap((raw, i): CaseAssertion[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const a = raw as Record<string, unknown>;
    const kind = String(a["kind"] ?? "");
    if (!ASSERTION_KINDS.has(kind)) return [];
    const description = clip(String(a["description"] ?? ""), 500);
    const target = clip(String(a["target"] ?? ""), 500);
    if (!description || !target) return [];
    return [{
      id: clip(String(a["id"] ?? ""), 64) || `a${i + 1}`,
      kind: kind as CaseAssertion["kind"],
      description,
      target,
    }];
  });
}

/** Add a golden case by hand (the promote path below is the usual one). */
export async function addItem(
  fastify: FastifyInstance,
  orgId: string,
  datasetId: string,
  item: AddItemInput
): Promise<DatasetItem | null> {
  if (!(await datasetExists(fastify, orgId, datasetId))) return null;
  const sql = fastify.pg;
  const rows = (await sql`
    INSERT INTO dataset_items (
      dataset_id, org_id, trace_id, finding_id, title, input, expected, span_signature,
      assertions, tags, severity, difficulty, notes
    )
    VALUES (
      ${datasetId}, ${orgId}, ${item.traceId ?? null}, ${item.findingId ?? null},
      ${clip(item.title ?? null, 300)},
      ${json(sql, item.input ?? {})}, ${json(sql, item.expected ?? {})},
      ${clip(item.spanSignature ?? null, 300)},
      ${json(sql, normalizeAssertions(item.assertions))},
      ${(item.tags ?? []).slice(0, 20).map((t) => String(t).slice(0, 40))},
      ${item.severity ?? "medium"}, ${item.difficulty ?? "regression"},
      ${clip(item.notes ?? null, 2000)}
    )
    RETURNING id, dataset_id, trace_id, finding_id, title, input, expected, span_signature,
              assertions, tags, severity, difficulty, notes, created_at
  `) as Array<Record<string, unknown>>;
  return rows[0] ? mapItem(rows[0]) : null;
}

/** Remove a golden case. Scoped by org AND dataset so ids can't be guessed across tenants. */
export async function deleteItem(
  fastify: FastifyInstance,
  orgId: string,
  datasetId: string,
  itemId: string
): Promise<boolean> {
  const rows = (await fastify.pg`
    DELETE FROM dataset_items
    WHERE id = ${itemId} AND dataset_id = ${datasetId} AND org_id = ${orgId}
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

// ── The one-click path: finding → golden item ────────────────────────

interface FindingRow {
  id: string;
  trace_id: string;
  detector: string;
  title: string;
  severity: string;
  confidence: string | number;
  summary: string | null;
  triggered_span_id: string | null;
}

interface RcaRow {
  summary: string | null;
  explanation: string | null;
  counterfactual: string | null;
  file: string | null;
  line: number | null;
  commit_sha: string | null;
  fix_title: string | null;
}

const DETECTOR_LABEL: Record<string, string> = {
  hallucination: "a hallucination",
  tool_failure: "a tool failure",
  intent_drift: "intent drift",
  safety: "a safety violation",
};

/**
 * Turn the RCA counterfactual ("if X had happened, this wouldn't have") into a
 * forward-looking expectation ("X must happen"). Falls back to the finding's own
 * summary when RCA hasn't run — the item is still a valid regression test,
 * just with a weaker expectation.
 */
function deriveExpectation(
  finding: FindingRow,
  rca: RcaRow | null,
  span: SpanView | null,
  signature: string
): { expected: Record<string, unknown>; notes: string } {
  const label = DETECTOR_LABEL[finding.detector] ?? "a failure";
  const where = span ? `\`${span.name}\`` : "the failing step";
  const counterfactual = rca?.counterfactual?.trim() || null;

  const behaviour = counterfactual
    ? `${counterfactual} A correct run therefore completes this request without ${label}: ${where} must handle the input in the golden case and the run must finish clean.`
    : `The same request must complete without ${label}. ${where} must not fail the way it did in ${finding.trace_id}${
        span?.error ? ` ("${clip(span.error, 200)}")` : ""
      }.`;

  const expected: Record<string, unknown> = {
    behaviour,
    counterfactual,
    detector: finding.detector,
    severity: finding.severity,
    mustNotRecur: signature,
    source: counterfactual ? "rca_counterfactual" : "finding_summary",
    rootCause: rca?.summary ?? null,
    origin: rca?.file ? `${rca.file}${rca.line ? `:${rca.line}` : ""}` : span?.git ? `${span.git.file}:${span.git.line}` : null,
  };

  const notes = `Promoted from finding "${clip(finding.title, 200)}" (${finding.detector}, ${finding.severity}) on trace ${finding.trace_id}.`;
  return { expected, notes };
}

export interface PromoteResult {
  item: DatasetItem;
  dataset: Dataset;
  /** false when this finding had already been promoted into the dataset. */
  created: boolean;
}

/**
 * THE ONE-CLICK PATH. Read a finding + its trace, distil a golden case, and file
 * it in a dataset (creating a per-service dataset when the caller doesn't name
 * one). Idempotent: re-promoting the same finding refreshes the item in place
 * rather than duplicating it, so the button can be pressed twice safely.
 */
export async function promoteFinding(
  fastify: FastifyInstance,
  orgId: string,
  opts: { findingId: string; datasetId?: string | null }
): Promise<PromoteResult | null> {
  const sql = fastify.pg;

  const findingRows = (await sql`
    SELECT id, trace_id, detector, title, severity, confidence, summary, triggered_span_id
    FROM trace_findings
    WHERE id = ${opts.findingId} AND org_id = ${orgId}
    LIMIT 1
  `) as FindingRow[];
  const finding = findingRows[0];
  if (!finding) return null;

  const trace = (await getTrace(fastify, orgId, finding.trace_id)) as unknown as TraceView | null;
  const spans = trace?.spans ?? [];

  // The failing span: the one the detector pinned, else the earliest error, else
  // the earliest warning. Spans come back ordered by start_ms.
  const failing =
    spans.find((s) => s.id === finding.triggered_span_id) ??
    spans.find((s) => s.status === "error") ??
    spans.find((s) => s.status === "warn") ??
    spans[0] ??
    null;

  // The root span carries the request that started the run — that's the input a
  // replay would feed back in.
  const root = spans.find((s) => !s.parentId) ?? spans[0] ?? null;

  const signature = failing
    ? spanSignature(failing)
    : `trace:${normalizeToken(trace?.title ?? finding.detector)}#${normalizeToken(finding.detector)}`;

  // Latest RCA for this finding; fall back to the trace's most recent RCA run.
  let rcaRows = (await sql`
    SELECT summary, explanation, counterfactual, file, line, commit_sha, fix_title
    FROM rca_runs
    WHERE org_id = ${orgId} AND finding_id = ${finding.id}
    ORDER BY created_at DESC LIMIT 1
  `) as RcaRow[];
  if (rcaRows.length === 0) {
    // Only borrow an UNATTRIBUTED run from the same trace. A run attached to a
    // different finding root-causes a different failure, and its counterfactual
    // would describe the wrong correct behaviour.
    rcaRows = (await sql`
      SELECT summary, explanation, counterfactual, file, line, commit_sha, fix_title
      FROM rca_runs
      WHERE org_id = ${orgId} AND trace_id = ${finding.trace_id} AND finding_id IS NULL
      ORDER BY created_at DESC LIMIT 1
    `) as RcaRow[];
  }
  const rca = rcaRows[0] ?? null;

  const input: Record<string, unknown> = {
    traceId: finding.trace_id,
    service: trace?.service ?? null,
    request: clip(root?.io?.input ?? trace?.title ?? null, 4000),
    failingSpan: failing
      ? {
          id: failing.id,
          name: failing.name,
          kind: failing.kind,
          status: failing.status,
          error: clip(failing.error ?? null, 1000),
          input: clip(failing.io?.input ?? null, 2000),
          output: clip(failing.io?.output ?? null, 2000),
          origin: failing.git ? `${failing.git.file}:${failing.git.line}` : null,
        }
      : null,
    // The path through the run, so a judge can see the context the failure
    // happened in without loading the whole trace.
    context: spans.slice(0, 40).map((s) => ({
      name: s.name,
      kind: s.kind,
      status: s.status,
      ...(s.error ? { error: clip(s.error, 300) } : {}),
    })),
  };

  const { expected, notes } = deriveExpectation(finding, rca, failing, signature);

  // Target dataset: the caller's, or a per-service regression suite.
  let dataset: Dataset;
  if (opts.datasetId) {
    const existing = (await sql`
      SELECT id, name, description, created_at FROM datasets
      WHERE id = ${opts.datasetId} AND org_id = ${orgId} LIMIT 1
    `) as Array<Record<string, unknown>>;
    const d = existing[0];
    if (!d) return null;
    dataset = {
      id: d["id"] as string,
      name: d["name"] as string,
      description: (d["description"] as string | null) ?? null,
      itemCount: 0,
      createdAt: d["created_at"],
    };
  } else {
    const service = trace?.service ?? "agent";
    dataset = await createDataset(fastify, orgId, {
      name: `${service} regressions`,
      description: `Golden cases promoted from production findings in ${service}.`,
    });
  }

  const before = (await sql`
    SELECT id FROM dataset_items
    WHERE dataset_id = ${dataset.id} AND org_id = ${orgId} AND finding_id = ${finding.id}
    LIMIT 1
  `) as Array<{ id: string }>;

  // Idempotent on (dataset, finding) — see the partial unique index in 008.
  const rows = (await sql`
    INSERT INTO dataset_items (dataset_id, org_id, trace_id, finding_id, input, expected, span_signature, notes)
    VALUES (
      ${dataset.id}, ${orgId}, ${finding.trace_id}, ${finding.id},
      ${json(sql, input)}, ${json(sql, expected)}, ${signature}, ${notes}
    )
    ON CONFLICT (dataset_id, finding_id) WHERE finding_id IS NOT NULL
    DO UPDATE SET input = EXCLUDED.input, expected = EXCLUDED.expected,
                  span_signature = EXCLUDED.span_signature, notes = EXCLUDED.notes
    RETURNING id, dataset_id, trace_id, finding_id, input, expected, span_signature, notes, created_at
  `) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;

  return { item: mapItem(row), dataset, created: before.length === 0 };
}
