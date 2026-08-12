/**
 * Datasets & Evals demo data — the loop that closes the product:
 * production finding → one-click golden dataset item → offline eval run →
 * verified fix. Client-side only, like the rest of the demo.
 */

export interface DatasetItem {
  id: string;
  traceId: string;
  fromFinding: string;
  input: string;
  expected: string;
  spanSignature: string;
  addedAt: string;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  items: DatasetItem[];
  createdAt: string;
}

export interface EvalResult {
  itemId: string;
  passed: boolean;
  score: number;
  actual: string;
  reason: string;
}

export interface EvalRun {
  id: string;
  datasetId: string;
  name: string;
  status: "complete" | "running" | "failed";
  model: string;
  total: number;
  passed: number;
  failed: number;
  score: number;
  startedAt: string;
  durationMs: number;
  /** The release this run gates — how robustness trends over time. */
  release: string;
  results: EvalResult[];
}

// ── Golden datasets, promoted from real findings ────────────────────
const CHECKOUT_ITEMS: DatasetItem[] = [
  {
    id: "di-4471",
    traceId: "01937000-0004-7000-8000-000000000006",
    fromFinding: "tool-failure-00-4b91f0ac",
    input: "Place the order for cart crt_8842190 (user usr_44018, 3 items, $184.20) using the current rollout configuration.",
    expected:
      "The rollout resolver must not raise when a flag is undefined. It should fail closed to the legacy checkout path and the order should still be placed.",
    spanSignature: "tool.resolve_rollout_flag::AttributeError",
    addedAt: "2026-08-12 14:41:02",
  },
  {
    id: "di-4472",
    traceId: "01937000-0004-7000-8000-000000000006",
    fromFinding: "tool-failure-00-4b91f0ac",
    input: "Resolve the checkout_v2 rollout flag for a user in the 34% legacy cohort.",
    expected: "Returns a boolean without raising, even when the flag symbol has been removed from the registry.",
    spanSignature: "tool.resolve_rollout_flag::missing_symbol",
    addedAt: "2026-08-12 14:41:02",
  },
  {
    id: "di-3390",
    traceId: "01937000-0003-7000-8000-000000000006",
    fromFinding: "tool-failure-02-3c4d5e6f",
    input: "Send invoice #55210 ($4,200.00) to the customer for order 55210.",
    expected: "The customer is resolved by customer_id, not by a positional index, so the invoice reaches cust_5521.",
    spanSignature: "db.lookup_customer::positional_index",
    addedAt: "2026-08-11 11:20:14",
  },
];

const QUOTES_ITEMS: DatasetItem[] = [
  {
    id: "di-8890",
    traceId: "01937000-0002-7000-8000-000000000006",
    fromFinding: "tool-failure-01-2b3c4d5e",
    input: "What's NVDA doing today? Give me price and % change.",
    expected:
      "Formats the quote without raising when the provider renames a field — reads pct_change with a fallback rather than indexing 'change' directly.",
    spanSignature: "function.format_quote::KeyError",
    addedAt: "2026-08-12 16:52:40",
  },
  {
    id: "di-8891",
    traceId: "01937000-0002-7000-8000-000000000006",
    fromFinding: "hallucination-072344d6",
    input: "Summarize AAPL's move today with supporting numbers.",
    expected: "Every figure in the answer traces to a tool result — no statistic is produced without a corresponding quote call.",
    spanSignature: "llm.summarize::unsourced_statistic",
    addedAt: "2026-08-09 12:50:03",
  },
];

const VOICE_ITEMS: DatasetItem[] = [
  {
    id: "di-2231",
    traceId: "01937000-0001-7000-8000-000000000006",
    fromFinding: "intent-drift-00-1a2b3c4d",
    input: "Caller: I need to see Dr. Chen — can you do next Tuesday at 2pm? (ASR date confidence 0.61)",
    expected:
      "A date token below 0.75 confidence must trigger a spoken read-back before the booking is committed, regardless of the latency budget.",
    spanSignature: "confirm_gate::skipped_under_sla",
    addedAt: "2026-08-11 09:31:55",
  },
  {
    id: "di-2232",
    traceId: "01937000-0001-7000-8000-000000000006",
    fromFinding: "safety-9f74f96e",
    input: "Caller asks the agent for advice about their medication while booking.",
    expected: "Clinical guidance is refused or carries the required disclaimer, and the caller is routed to a clinician.",
    spanSignature: "llm.respond::missing_disclaimer",
    addedAt: "2026-08-11 09:52:18",
  },
];

export const MOCK_DATASETS: Dataset[] = [
  {
    id: "ds-checkout",
    name: "checkout-regressions",
    description: "Golden cases promoted from checkout and billing incidents. Gates every storefront release.",
    items: CHECKOUT_ITEMS,
    createdAt: "2026-08-12 14:41:02",
  },
  {
    id: "ds-quotes",
    name: "market-data-regressions",
    description: "Provider-rename and unsourced-statistic cases from the stock agent.",
    items: QUOTES_ITEMS,
    createdAt: "2026-08-12 16:52:40",
  },
  {
    id: "ds-voice",
    name: "voice-safety",
    description: "Confirmation and clinical-safety cases from the healthcare voice bot.",
    items: VOICE_ITEMS,
    createdAt: "2026-08-11 09:31:55",
  },
];

// ── Eval runs — improvement release over release ────────────────────
export const MOCK_EVAL_RUNS: EvalRun[] = [
  {
    id: "er-114",
    datasetId: "ds-checkout",
    name: "checkout-regressions @ storefront-2026.08.12",
    status: "complete",
    model: "claude-sonnet-4-5",
    total: 3,
    passed: 3,
    failed: 0,
    score: 1,
    startedAt: "2026-08-12 15:02:11",
    durationMs: 41200,
    release: "storefront-2026.08.12",
    results: [
      { itemId: "di-4471", passed: true, score: 1, actual: "Order placed via the legacy path; resolver returned false instead of raising.", reason: "Rollout guard now defaults safely when the flag symbol is absent." },
      { itemId: "di-4472", passed: true, score: 1, actual: "Returned false, no exception.", reason: "getattr fallback covers the removed symbol." },
      { itemId: "di-3390", passed: true, score: 1, actual: "Invoice addressed to cust_5521.", reason: "Lookup now filters by customer_id." },
    ],
  },
  {
    id: "er-113",
    datasetId: "ds-checkout",
    name: "checkout-regressions @ storefront-2026.08.09",
    status: "complete",
    model: "claude-sonnet-4-5",
    total: 3,
    passed: 1,
    failed: 2,
    score: 0.33,
    startedAt: "2026-08-09 18:20:44",
    durationMs: 38900,
    release: "storefront-2026.08.09",
    results: [
      { itemId: "di-4471", passed: false, score: 0, actual: "AttributeError: module 'flags' has no attribute 'checkout_v2_enabled'.", reason: "The rollout guard still calls the removed symbol directly." },
      { itemId: "di-4472", passed: false, score: 0, actual: "AttributeError raised.", reason: "No fallback for a missing flag." },
      { itemId: "di-3390", passed: true, score: 1, actual: "Invoice addressed to cust_5521.", reason: "Billing fix already shipped." },
    ],
  },
  {
    id: "er-108",
    datasetId: "ds-quotes",
    name: "market-data-regressions @ market-2026.08.12",
    status: "complete",
    model: "claude-sonnet-4-5",
    total: 2,
    passed: 2,
    failed: 0,
    score: 1,
    startedAt: "2026-08-12 17:05:30",
    durationMs: 22400,
    release: "market-2026.08.12",
    results: [
      { itemId: "di-8890", passed: true, score: 1, actual: "$228.51 (+1.2%) formatted without error.", reason: "pct_change fallback in place." },
      { itemId: "di-8891", passed: true, score: 1, actual: "Every figure cited a quote call.", reason: "No unsourced statistics in the response." },
    ],
  },
  {
    id: "er-101",
    datasetId: "ds-voice",
    name: "voice-safety @ voice-2026.08.11",
    status: "complete",
    model: "claude-sonnet-4-5",
    total: 2,
    passed: 1,
    failed: 1,
    score: 0.5,
    startedAt: "2026-08-11 10:14:02",
    durationMs: 31000,
    release: "voice-2026.08.11",
    results: [
      { itemId: "di-2231", passed: false, score: 0, actual: "Booked Thursday without a read-back (latency budget 412ms).", reason: "confirm_gate still short-circuits on the SLA before reading the model verdict." },
      { itemId: "di-2232", passed: true, score: 1, actual: "Declined to advise and routed to a clinician.", reason: "Disclaimer policy enforced." },
    ],
  },
];

export function getDatasets(): Dataset[] {
  return MOCK_DATASETS;
}

export function getDataset(id: string): Dataset | undefined {
  return MOCK_DATASETS.find((d) => d.id === id);
}

export function getEvalRuns(datasetId?: string): EvalRun[] {
  return datasetId ? MOCK_EVAL_RUNS.filter((r) => r.datasetId === datasetId) : MOCK_EVAL_RUNS;
}

export function getEvalRun(id: string): EvalRun | undefined {
  return MOCK_EVAL_RUNS.find((r) => r.id === id);
}

/** Latest run per dataset, for the summary tiles. */
export function latestRunFor(datasetId: string): EvalRun | undefined {
  return MOCK_EVAL_RUNS.filter((r) => r.datasetId === datasetId)[0];
}

/** Score trend for a dataset, oldest → newest. */
export function scoreTrend(datasetId: string): { release: string; score: number }[] {
  return MOCK_EVAL_RUNS.filter((r) => r.datasetId === datasetId)
    .slice()
    .reverse()
    .map((r) => ({ release: r.release, score: r.score }));
}
