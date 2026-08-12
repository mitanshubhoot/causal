/**
 * Observability demo data — the "live incident" product surface.
 *
 * Client-side only, so the deployed demo always works with no backend. Each
 * incident carries: a distributed trace of an agent run (LLM calls, tool calls,
 * HTTP/DB spans), the detector (LLM-as-judge) finding that fired, the root-cause
 * analysis tied to a commit, and the auto-generated fix PR. Keyed by the
 * INCIDENT node id used in the /incidents/[id] route.
 */

export type SpanKind = "agent" | "llm" | "tool" | "http" | "db" | "function";
export type SpanStatus = "ok" | "error" | "warn";

export interface DemoSpan {
  id: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  startMs: number; // offset from trace start
  durationMs: number;
  status: SpanStatus;
  attributes: { label: string; value: string }[];
  // prompt in/out for LLM & agent spans (shown in the span detail like a real APM)
  io?: { input?: string; output?: string };
  // git correlation (only on the spans that map to source)
  git?: { file: string; line: number; commit: string };
  code?: { lang: string; startLine: number; lines: { n: number; text: string; marked?: boolean }[] };
  error?: string;
}

export interface TraceRow {
  id: string; // incident id (route key) or a decorative id
  name: string;
  timestamp: string;
  status: SpanStatus;
  selectable: boolean;
}

export type DetectorType = "hallucination" | "tool_failure" | "intent_drift" | "safety";

export interface DetectorFinding {
  detector: DetectorType;
  title: string;
  severity: "critical" | "high" | "medium";
  confidence: number;
  summary: string;
  triggeredSpanId: string;
  alertedVia: ("slack" | "email")[];
  judgeModel: string;
}

export interface DemoRootCause {
  summary: string;
  commit: string;
  commitMessage: string;
  author: string;
  file: string;
  line: number;
  explanation: string;
  counterfactual: string;
  confidence: number;
  hopsUpstream: number;
}

export type DiffLineKind = "add" | "del" | "ctx" | "meta";

export interface FixPR {
  number: number;
  title: string;
  branch: string;
  base: string;
  status: "open" | "verified";
  filesChanged: number;
  additions: number;
  deletions: number;
  description: string;
  file: string;
  diff: { kind: DiffLineKind; text: string }[];
  checks: { name: string; status: "pass" | "fail" | "pending" }[];
}

export interface ObservabilityDemo {
  incidentId: string;
  service: string;
  environment: string;
  traceId: string;
  externalId: string;
  title: string;
  severity: "P1" | "P2" | "P3" | "OK";
  startedAt: string; // ISO-ish display string
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  spans: DemoSpan[];
  // healthy traces omit finding/rootCause/fixPr
  finding?: DetectorFinding;
  rootCause?: DemoRootCause;
  fixPr?: FixPR;
}

/** An incident always has a finding, root cause, and fix PR. */
export type IncidentDemo = ObservabilityDemo & {
  finding: DetectorFinding;
  rootCause: DemoRootCause;
  fixPr: FixPR;
};

// Incident node ids (match mock-data.ts) ─────────────────────────────
const I1 = "01937000-0001-7000-8000-000000000006";
const I2 = "01937000-0002-7000-8000-000000000006";
const I3 = "01937000-0003-7000-8000-000000000006";
const I4 = "01937000-0004-7000-8000-000000000006";

// ── Incident 4 (featured): coding agent removed a live rollout flag ──
const DEMO_I4: IncidentDemo = {
  incidentId: I4,
  service: "storefront-checkout",
  environment: "production",
  traceId: "4b91f0ac4d2e7a10",
  externalId: "PD-8890",
  title: "Checkout 500s after rollout-flag removal",
  severity: "P1",
  startedAt: "14:32:07 UTC",
  model: "claude-sonnet-4-5",
  tokensIn: 12400,
  tokensOut: 2180,
  cost: 0.1841,
  spans: [
    {
      id: "s0",
      parentId: null,
      name: "checkout-assistant.run",
      kind: "agent",
      startMs: 0,
      durationMs: 2140,
      status: "error",
      attributes: [
        { label: "session", value: "sess-code-4471" },
        { label: "user", value: "cust_92f1" },
        { label: "turns", value: "3" },
      ],
      io: {
        input: "Complete checkout for cart cust_92f1 (2 items, $148.00). Apply the staged rollout and place the order.",
        output: "Failed after 3 turns — rollout resolution raised AttributeError; order not placed. Returned 500 to the client.",
      },
    },
    {
      id: "s1",
      parentId: "s0",
      name: "llm.plan_checkout",
      kind: "llm",
      startMs: 40,
      durationMs: 610,
      status: "ok",
      attributes: [
        { label: "model", value: "claude-sonnet-4-5" },
        { label: "input_tokens", value: "1,204" },
        { label: "output_tokens", value: "188" },
        { label: "cost", value: "$0.014" },
      ],
      io: {
        input: "System: You are the checkout assistant.\nUser: Place the order for cart cust_92f1 using the current rollout configuration.",
        output: "Plan: (1) load cart, (2) resolve rollout flag for the user's bucket, (3) submit order to /api/checkout.",
      },
    },
    {
      id: "s2",
      parentId: "s0",
      name: "tool.get_cart",
      kind: "tool",
      startMs: 670,
      durationMs: 120,
      status: "ok",
      attributes: [
        { label: "items", value: "2" },
        { label: "total", value: "$148.00" },
      ],
    },
    {
      id: "s3",
      parentId: "s0",
      name: "tool.resolve_rollout_flag",
      kind: "tool",
      startMs: 800,
      durationMs: 22,
      status: "error",
      error: "AttributeError: module 'flags' has no attribute 'checkout_v2_enabled'",
      git: { file: "services/checkout/flags.py", line: 42, commit: "b91f0ac4" },
      code: {
        lang: "python",
        startLine: 39,
        lines: [
          { n: 39, text: "def resolve_rollout(user_id: str) -> bool:" },
          { n: 40, text: "    # gate checkout on the staged rollout" },
          { n: 41, text: "    bucket = _bucket_for(user_id)" },
          { n: 42, text: "    return flags.checkout_v2_enabled(bucket)", marked: true },
          { n: 43, text: "" },
        ],
      },
      attributes: [
        { label: "flag", value: "checkout_v2_enabled" },
        { label: "exception", value: "AttributeError" },
      ],
    },
    {
      id: "s4",
      parentId: "s0",
      name: "llm.recover",
      kind: "llm",
      startMs: 830,
      durationMs: 720,
      status: "warn",
      attributes: [
        { label: "model", value: "claude-sonnet-4-5" },
        { label: "retries", value: "2" },
        { label: "output_tokens", value: "96" },
      ],
      io: {
        input: "The rollout resolver raised AttributeError: module 'flags' has no attribute 'checkout_v2_enabled'. Retry or fail?",
        output: "Retried twice; the attribute is still missing. Unable to recover — surfacing the error to the caller.",
      },
    },
    {
      id: "s5",
      parentId: "s0",
      name: "POST /api/checkout",
      kind: "http",
      startMs: 1560,
      durationMs: 560,
      status: "error",
      error: "500 Internal Server Error",
      attributes: [
        { label: "status", value: "500" },
        { label: "route", value: "/api/checkout" },
        { label: "latency", value: "560ms" },
      ],
    },
  ],
  finding: {
    detector: "tool_failure",
    title: "Tool failure — unhandled exception on the critical path",
    severity: "critical",
    confidence: 0.96,
    summary:
      "resolve_rollout_flag raised AttributeError on 34% of checkout traffic. The rollout guard references flags.checkout_v2_enabled, which no longer exists after commit b91f0ac4. Downstream POST /api/checkout returns 500.",
    triggeredSpanId: "s3",
    alertedVia: ["slack", "email"],
    judgeModel: "claude-haiku-4-5",
  },
  rootCause: {
    summary: "Rollout guard references a feature flag deleted to keep a diff small",
    commit: "b91f0ac4",
    commitMessage: "refactor(checkout): simplify flag resolution",
    author: "coding-agent (sess-code-4471)",
    file: "services/checkout/flags.py",
    line: 42,
    confidence: 0.96,
    hopsUpstream: 3,
    explanation:
      "Commit b91f0ac4 removed the checkout_v2_enabled flag definition while leaving its call site in resolve_rollout(). The agent's session notes state it “skipped the rollout check to keep the diff small.” CI stayed green because the flag service is mocked in tests, so the missing attribute only surfaced in production.",
    counterfactual:
      "If the rollout guard had defaulted to the legacy path when the flag is undefined, checkout would have stayed healthy and the incident would not have occurred.",
  },
  fixPr: {
    number: 2213,
    title: "fix(checkout): restore rollout guard with safe default",
    branch: "causal/fix-PD-8890",
    base: "main",
    status: "verified",
    filesChanged: 1,
    additions: 6,
    deletions: 1,
    description:
      "resolve_rollout() called flags.checkout_v2_enabled, removed in b91f0ac4. Restore a defined resolver that falls back to the legacy path when the flag is absent, so a missing flag degrades safely instead of 500ing checkout.",
    file: "services/checkout/flags.py",
    diff: [
      { kind: "meta", text: "@@ -39,5 +39,10 @@ def resolve_rollout(user_id: str) -> bool:" },
      { kind: "ctx", text: " def resolve_rollout(user_id: str) -> bool:" },
      { kind: "ctx", text: "     # gate checkout on the staged rollout" },
      { kind: "ctx", text: "     bucket = _bucket_for(user_id)" },
      { kind: "del", text: "    return flags.checkout_v2_enabled(bucket)" },
      { kind: "add", text: "    flag = getattr(flags, \"checkout_v2_enabled\", None)" },
      { kind: "add", text: "    if flag is None:" },
      { kind: "add", text: "        # flag undefined — degrade to the legacy checkout path" },
      { kind: "add", text: "        return False" },
      { kind: "add", text: "    return flag(bucket)" },
    ],
    checks: [
      { name: "unit", status: "pass" },
      { name: "integration", status: "pass" },
      { name: "causal-replay", status: "pass" },
    ],
  },
};

// ── Incident 1: healthcare voice bot booked the wrong day ────────────
const DEMO_I1: IncidentDemo = {
  incidentId: I1,
  service: "healthcare-voice-bot",
  environment: "production",
  traceId: "1a2b3c4d5e6f7a80",
  externalId: "SEN-4471",
  title: "Appointment booked for the wrong day",
  severity: "P2",
  startedAt: "09:14:52 UTC",
  model: "claude-sonnet-4-5",
  tokensIn: 8200,
  tokensOut: 1440,
  cost: 0.1122,
  spans: [
    { id: "s0", parentId: null, name: "voice-scheduler.run", kind: "agent", startMs: 0, durationMs: 1830, status: "warn",
      attributes: [{ label: "session", value: "sess-voice-2231" }, { label: "channel", value: "phone" }],
      io: { input: "Caller: I'd like to schedule a follow-up with Dr. Chen for next Tuesday at 2pm.", output: "Booked Thursday 2:00pm with Dr. Chen. (Confirmation skipped under latency SLA.)" } },
    { id: "s1", parentId: "s0", name: "asr.transcribe", kind: "tool", startMs: 30, durationMs: 410, status: "warn",
      error: "Low ASR confidence (0.61) on date token",
      git: { file: "agents/voice/asr.py", line: 88, commit: "7c1d9e2a" },
      attributes: [{ label: "confidence", value: "0.61" }, { label: "heard", value: "“Thursday”" }, { label: "said", value: "“Tuesday”" }] },
    { id: "s2", parentId: "s0", name: "llm.plan_booking", kind: "llm", startMs: 450, durationMs: 690, status: "ok",
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "output_tokens", value: "142" }],
      io: { input: "Transcribed request: schedule with Dr. Chen. ASR date token confidence 0.61.", output: "Plan: book the requested slot. Confirmation optional if latency budget is tight." } },
    { id: "s3", parentId: "s0", name: "tool.book_appointment", kind: "tool", startMs: 1150, durationMs: 300, status: "error",
      error: "Booked Thursday 2pm — confirmation step skipped",
      git: { file: "agents/voice/booking.py", line: 54, commit: "7c1d9e2a" },
      code: { lang: "python", startLine: 51, lines: [
        { n: 51, text: "def book(slot: Slot) -> Booking:" },
        { n: 52, text: "    # SLA: skip confirm when latency budget is tight" },
        { n: 53, text: "    if latency_budget_ms() < 500:" },
        { n: 54, text: "        return _commit(slot)  # no confirmation", marked: true },
        { n: 55, text: "    return _confirm_then_commit(slot)" },
      ] },
      attributes: [{ label: "day", value: "Thursday" }, { label: "confirmed", value: "false" }] },
  ],
  finding: {
    detector: "intent_drift", title: "Intent drift — output diverged from user request", severity: "high", confidence: 0.88,
    summary: "The patient requested Tuesday; the agent booked Thursday. ASR confidence was 0.61 and the confirmation step was skipped to meet the latency SLA, so the low-confidence date was never verified.",
    triggeredSpanId: "s3", alertedVia: ["slack"], judgeModel: "claude-haiku-4-5",
  },
  rootCause: {
    summary: "Confirmation skipped under latency SLA let a low-confidence ASR date commit", commit: "7c1d9e2a",
    commitMessage: "perf(voice): skip confirm under latency budget", author: "voice-team", file: "agents/voice/booking.py", line: 54,
    confidence: 0.88, hopsUpstream: 2,
    explanation: "The booking path skips confirmation whenever the latency budget is under 500ms. Combined with a 0.61-confidence ASR transcription of the date, the wrong day was committed without the patient verifying it.",
    counterfactual: "If confirmation were required whenever ASR confidence < 0.8 regardless of latency budget, the wrong-day booking would have been caught.",
  },
  fixPr: {
    number: 1188, title: "fix(voice): always confirm low-confidence dates", branch: "causal/fix-SEN-4471", base: "main",
    status: "verified", filesChanged: 1, additions: 4, deletions: 1,
    description: "Require explicit confirmation whenever ASR confidence for a date/time token is below 0.8, independent of the latency budget.",
    file: "agents/voice/booking.py",
    diff: [
      { kind: "meta", text: "@@ -52,4 +52,7 @@ def book(slot: Slot) -> Booking:" },
      { kind: "ctx", text: "     # SLA: skip confirm when latency budget is tight" },
      { kind: "del", text: "    if latency_budget_ms() < 500:" },
      { kind: "add", text: "    if latency_budget_ms() < 500 and slot.asr_confidence >= 0.8:" },
      { kind: "ctx", text: "        return _commit(slot)" },
      { kind: "add", text: "    return _confirm_then_commit(slot)" },
    ],
    checks: [{ name: "unit", status: "pass" }, { name: "causal-replay", status: "pass" }],
  },
};

// ── Incident 2: stock agent KeyError ────────────────────────────────
const DEMO_I2: IncidentDemo = {
  incidentId: I2,
  service: "stock-tool-agent",
  environment: "production",
  traceId: "2b3c4d5e6f7a8b90",
  externalId: "PD-7712",
  title: "Agent crashed on KeyError: 'change'",
  severity: "P1",
  startedAt: "16:41:03 UTC",
  model: "claude-sonnet-4-5",
  tokensIn: 4100,
  tokensOut: 520,
  cost: 0.0471,
  spans: [
    { id: "s0", parentId: null, name: "stock-agent.run", kind: "agent", startMs: 0, durationMs: 940, status: "error",
      attributes: [{ label: "session", value: "sess-stock-8890" }, { label: "symbol", value: "NVDA" }],
      io: { input: "What's NVDA doing today? Give me price and % change.", output: "Failed — the quote formatter raised KeyError: 'change'. Unable to return a quote." } },
    { id: "s1", parentId: "s0", name: "llm.plan", kind: "llm", startMs: 20, durationMs: 380, status: "ok",
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "output_tokens", value: "77" }],
      io: { input: "Fetch and format the latest NVDA quote for the user.", output: "Plan: call get_quote, then format price and percentage change." } },
    { id: "s2", parentId: "s0", name: "tool.get_quote", kind: "tool", startMs: 400, durationMs: 210, status: "ok",
      attributes: [{ label: "provider", value: "quotes-api" }, { label: "fields", value: "price, pct_change" }] },
    { id: "s3", parentId: "s0", name: "function.format_quote", kind: "function", startMs: 610, durationMs: 8, status: "error",
      error: "KeyError: 'change'",
      git: { file: "agents/stock/format.py", line: 27, commit: "3f9a1c05" },
      code: { lang: "python", startLine: 25, lines: [
        { n: 25, text: "def format_quote(q: dict) -> str:" },
        { n: 26, text: "    price = q[\"price\"]" },
        { n: 27, text: "    change = q[\"change\"]   # provider renamed -> pct_change", marked: true },
        { n: 28, text: "    return f\"{price} ({change}%)\"" },
      ] },
      attributes: [{ label: "key", value: "change" }, { label: "available", value: "price, pct_change" }] },
  ],
  finding: {
    detector: "tool_failure", title: "Tool failure — KeyError on renamed provider field", severity: "critical", confidence: 0.94,
    summary: "format_quote reads q['change'] via direct index. The quotes provider renamed the field to pct_change, so every call raises KeyError and crashes the agent run.",
    triggeredSpanId: "s3", alertedVia: ["slack", "email"], judgeModel: "claude-haiku-4-5",
  },
  rootCause: {
    summary: "Direct dict index on a provider field that was renamed", commit: "3f9a1c05",
    commitMessage: "feat(stock): add quote formatter", author: "stock-team", file: "agents/stock/format.py", line: 27,
    confidence: 0.94, hopsUpstream: 1,
    explanation: "The formatter accesses q['change'] with a hard index instead of a safe get. When the upstream provider renamed 'change' to 'pct_change', every quote crashed with KeyError.",
    counterfactual: "If the formatter used q.get('change') or q.get('pct_change') with a fallback, the rename would have degraded gracefully.",
  },
  fixPr: {
    number: 2044, title: "fix(stock): tolerate renamed quote field", branch: "causal/fix-PD-7712", base: "main",
    status: "verified", filesChanged: 1, additions: 2, deletions: 1,
    description: "Read the percentage-change field defensively, accepting both the legacy 'change' and the new 'pct_change' key.",
    file: "agents/stock/format.py",
    diff: [
      { kind: "meta", text: "@@ -26,3 +26,4 @@ def format_quote(q: dict) -> str:" },
      { kind: "ctx", text: "    price = q[\"price\"]" },
      { kind: "del", text: "    change = q[\"change\"]" },
      { kind: "add", text: "    change = q.get(\"change\", q.get(\"pct_change\", 0.0))" },
      { kind: "ctx", text: "    return f\"{price} ({change}%)\"" },
    ],
    checks: [{ name: "unit", status: "pass" }, { name: "causal-replay", status: "pass" }],
  },
};

// ── Incident 3: billing invoice to wrong customer ───────────────────
const DEMO_I3: IncidentDemo = {
  incidentId: I3,
  service: "billing-agent",
  environment: "production",
  traceId: "3c4d5e6f7a8b9c00",
  externalId: "PD-6510",
  title: "Invoice sent to the wrong customer",
  severity: "P3",
  startedAt: "11:07:41 UTC",
  model: "claude-sonnet-4-5",
  tokensIn: 3600,
  tokensOut: 610,
  cost: 0.0388,
  spans: [
    { id: "s0", parentId: null, name: "billing-agent.run", kind: "agent", startMs: 0, durationMs: 1260, status: "error",
      attributes: [{ label: "session", value: "sess-bill-3390" }, { label: "invoice", value: "$4,200.00" }],
      io: { input: "Generate and send the monthly invoice for order #55210 ($4,200.00).", output: "Invoice sent to cust_5522 — WRONG recipient (expected cust_5521)." } },
    { id: "s1", parentId: "s0", name: "llm.plan_invoice", kind: "llm", startMs: 20, durationMs: 420, status: "ok",
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "output_tokens", value: "110" }],
      io: { input: "Prepare the monthly invoice for order #55210 and send it to the customer.", output: "Plan: resolve the customer for the order, then render and send the invoice." } },
    { id: "s2", parentId: "s0", name: "db.lookup_customer", kind: "db", startMs: 440, durationMs: 60, status: "error",
      error: "Index-based lookup returned wrong customer",
      git: { file: "agents/billing/lookup.py", line: 33, commit: "5e2b7d18" },
      code: { lang: "python", startLine: 31, lines: [
        { n: 31, text: "def customer_for(order):" },
        { n: 32, text: "    rows = db.query(CUSTOMERS)" },
        { n: 33, text: "    return rows[order.index]   # order.index != row position", marked: true },
        { n: 34, text: "" },
      ] },
      attributes: [{ label: "expected", value: "cust_5521" }, { label: "returned", value: "cust_5522" }] },
  ],
  finding: {
    detector: "tool_failure", title: "Logic error — positional lookup returns wrong record", severity: "high", confidence: 0.83,
    summary: "customer_for() indexes the customer list by order.index, which is not the row position after filtering. The invoice was addressed to cust_5522 instead of cust_5521.",
    triggeredSpanId: "s2", alertedVia: ["email"], judgeModel: "claude-haiku-4-5",
  },
  rootCause: {
    summary: "Positional index used as a customer key", commit: "5e2b7d18",
    commitMessage: "feat(billing): resolve customer for order", author: "billing-team", file: "agents/billing/lookup.py", line: 33,
    confidence: 0.83, hopsUpstream: 1,
    explanation: "The lookup treats order.index as a row position into an unordered, filtered result set. When rows shift, the positional index resolves to the wrong customer.",
    counterfactual: "If the lookup queried by customer_id instead of positional index, the invoice would have reached the correct customer.",
  },
  fixPr: {
    number: 1990, title: "fix(billing): look up customer by id", branch: "causal/fix-PD-6510", base: "main",
    status: "verified", filesChanged: 1, additions: 2, deletions: 1,
    description: "Resolve the customer by explicit customer_id rather than a positional index into a filtered result set.",
    file: "agents/billing/lookup.py",
    diff: [
      { kind: "meta", text: "@@ -32,2 +32,3 @@ def customer_for(order):" },
      { kind: "del", text: "    rows = db.query(CUSTOMERS)" },
      { kind: "del", text: "    return rows[order.index]" },
      { kind: "add", text: "    return db.query(CUSTOMERS).filter(id=order.customer_id).one()" },
    ],
    checks: [{ name: "unit", status: "pass" }, { name: "causal-replay", status: "pass" }],
  },
};

// ── Healthy traces — successful runs, so the workspace reads real ────
function healthy(over: Partial<ObservabilityDemo> & Pick<ObservabilityDemo, "incidentId" | "service" | "traceId" | "startedAt" | "spans" | "tokensIn" | "tokensOut" | "cost">): ObservabilityDemo {
  return {
    environment: "production",
    externalId: "—",
    title: over.spans[0]?.name ?? over.service,
    severity: "OK",
    model: "claude-sonnet-4-5",
    ...over,
  };
}

const H_CHECKOUT = healthy({
  incidentId: "trace-ok-checkout-8821",
  service: "checkout-assistant",
  traceId: "a17c9f20b3e4d581",
  startedAt: "14:05:19 UTC",
  tokensIn: 9800, tokensOut: 1420, cost: 0.1502,
  spans: [
    { id: "s0", parentId: null, name: "checkout-assistant.run", kind: "agent", startMs: 0, durationMs: 1180, status: "ok",
      attributes: [{ label: "session", value: "sess-code-4460" }, { label: "user", value: "cust_71a2" }],
      io: { input: "Place the order for cart cust_71a2 (3 items, $212.40).", output: "Order placed. Confirmation #ORD-88231 sent to the customer." } },
    { id: "s1", parentId: "s0", name: "llm.plan_checkout", kind: "llm", startMs: 30, durationMs: 540, status: "ok",
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "output_tokens", value: "176" }] },
    { id: "s2", parentId: "s0", name: "tool.get_cart", kind: "tool", startMs: 580, durationMs: 110, status: "ok",
      attributes: [{ label: "items", value: "3" }, { label: "total", value: "$212.40" }] },
    { id: "s3", parentId: "s0", name: "tool.resolve_rollout_flag", kind: "tool", startMs: 700, durationMs: 18, status: "ok",
      attributes: [{ label: "flag", value: "checkout_v2_enabled" }, { label: "result", value: "true" }] },
    { id: "s4", parentId: "s0", name: "POST /api/checkout", kind: "http", startMs: 720, durationMs: 440, status: "ok",
      attributes: [{ label: "status", value: "200" }, { label: "latency", value: "440ms" }] },
  ],
});

const H_RESEARCH = healthy({
  incidentId: "trace-ok-research-4410",
  service: "research-pipeline",
  traceId: "bb65fe6dc2ba50d3",
  startedAt: "13:20:44 UTC",
  tokensIn: 41200, tokensOut: 8600, cost: 0.6120,
  spans: [
    { id: "s0", parentId: null, name: "research_pipeline.run", kind: "agent", startMs: 0, durationMs: 8200, status: "ok",
      attributes: [{ label: "session", value: "sess-rsrch-2201" }, { label: "steps", value: "3" }],
      io: { input: "Research the key features of OpenTelemetry for AI observability and summarize.", output: "Delivered a 3-section report: tracing model, semantic conventions, and agent spans." } },
    { id: "s1", parentId: "s0", name: "agent.researcher", kind: "agent", startMs: 40, durationMs: 3100, status: "ok",
      attributes: [{ label: "tool_calls", value: "4" }] },
    { id: "s2", parentId: "s1", name: "llm.gather", kind: "llm", startMs: 60, durationMs: 1400, status: "ok",
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "output_tokens", value: "620" }] },
    { id: "s3", parentId: "s0", name: "agent.analyst", kind: "agent", startMs: 3200, durationMs: 2400, status: "ok",
      attributes: [{ label: "tool_calls", value: "2" }] },
    { id: "s4", parentId: "s0", name: "agent.writer", kind: "agent", startMs: 5700, durationMs: 2400, status: "ok",
      attributes: [{ label: "words", value: "812" }] },
  ],
});

const H_SUPPORT = healthy({
  incidentId: "trace-ok-support-7735",
  service: "support-agent",
  traceId: "c93a4471de205b16",
  startedAt: "11:48:03 UTC",
  tokensIn: 6400, tokensOut: 980, cost: 0.0921,
  spans: [
    { id: "s0", parentId: null, name: "support-agent.run", kind: "agent", startMs: 0, durationMs: 940, status: "ok",
      attributes: [{ label: "session", value: "sess-supp-9930" }, { label: "ticket", value: "T-4821" }],
      io: { input: "Customer can't reset their password. Help them.", output: "Sent a reset link and confirmed the account email. Ticket resolved." } },
    { id: "s1", parentId: "s0", name: "llm.classify", kind: "llm", startMs: 30, durationMs: 360, status: "ok",
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "intent", value: "password_reset" }] },
    { id: "s2", parentId: "s0", name: "tool.send_reset_link", kind: "tool", startMs: 400, durationMs: 220, status: "ok",
      attributes: [{ label: "channel", value: "email" }, { label: "delivered", value: "true" }] },
    { id: "s3", parentId: "s0", name: "db.close_ticket", kind: "db", startMs: 630, durationMs: 40, status: "ok",
      attributes: [{ label: "ticket", value: "T-4821" }, { label: "status", value: "resolved" }] },
  ],
});

const H_STOCK = healthy({
  incidentId: "trace-ok-stock-1190",
  service: "stock-tool-agent",
  traceId: "d22b7e04a9c6f318",
  startedAt: "10:02:55 UTC",
  tokensIn: 3900, tokensOut: 540, cost: 0.0453,
  spans: [
    { id: "s0", parentId: null, name: "stock-agent.run", kind: "agent", startMs: 0, durationMs: 720, status: "ok",
      attributes: [{ label: "session", value: "sess-stock-8871" }, { label: "symbol", value: "AAPL" }],
      io: { input: "What's AAPL doing today?", output: "AAPL is at $228.51, up 1.2% on the day." } },
    { id: "s1", parentId: "s0", name: "llm.plan", kind: "llm", startMs: 20, durationMs: 300, status: "ok",
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "output_tokens", value: "64" }] },
    { id: "s2", parentId: "s0", name: "tool.get_quote", kind: "tool", startMs: 330, durationMs: 190, status: "ok",
      attributes: [{ label: "provider", value: "quotes-api" }, { label: "fields", value: "price, pct_change" }] },
    { id: "s3", parentId: "s0", name: "function.format_quote", kind: "function", startMs: 520, durationMs: 6, status: "ok",
      attributes: [{ label: "price", value: "$228.51" }, { label: "pct_change", value: "+1.2%" }] },
  ],
});

const INCIDENTS: IncidentDemo[] = [DEMO_I4, DEMO_I2, DEMO_I1, DEMO_I3];
const HEALTHY: ObservabilityDemo[] = [H_CHECKOUT, H_RESEARCH, H_SUPPORT, H_STOCK];

// A realistic feed ordered like a live workspace (newest first, incidents + healthy).
const TRACE_FEED: ObservabilityDemo[] = [DEMO_I2, DEMO_I4, H_CHECKOUT, H_RESEARCH, DEMO_I1, H_SUPPORT, H_STOCK, DEMO_I3];

const DEMOS: Record<string, ObservabilityDemo> = Object.fromEntries(
  [...INCIDENTS, ...HEALTHY].map((d) => [d.incidentId, d])
);

/** Returns the trace for an id (incident or healthy), defaulting to the featured incident. */
export function getObservabilityDemo(incidentId: string): ObservabilityDemo {
  return DEMOS[incidentId] ?? DEMO_I4;
}

/** Only the incidents (with findings) — for the detectors + dashboard views and the /incidents list. */
export function getAllDemos(): IncidentDemo[] {
  return INCIDENTS;
}

export function hasObservabilityDemo(incidentId: string): boolean {
  return incidentId in DEMOS;
}

/** Coherent rows for the traces list panel — every row opens the trace it names. */
export function getTraceList(): TraceRow[] {
  return TRACE_FEED.map((d) => ({
    id: d.incidentId,
    name: d.spans[0]?.name ?? d.service,
    timestamp: d.startedAt,
    status: d.spans[0]?.status ?? "ok",
    selectable: true,
  }));
}
