/**
 * Observability demo data — the "live incident" product surface.
 *
 * Client-side only, so the deployed demo always works with no backend. Each
 * incident carries: a distributed trace of an agent run (LLM calls, tool calls,
 * HTTP/DB spans), the detector (LLM-as-judge) finding that fired, the root-cause
 * analysis tied to a commit, and the auto-generated fix PR. Keyed by the
 * INCIDENT node id used in the /incidents/[id] route.
 */

export type SpanKind =
  | "agent" | "llm" | "tool" | "http" | "db" | "function"
  | "skill" | "workflow" | "search" | "shell";
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
  // per-span economics (LLM spans) — rolled up onto ancestors in the tree
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
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
  // trace-level context (shown as chips in the span detail)
  repo?: string;
  gitRef?: string;
  user?: string;
  sessionId?: string;
  metadata?: { label: string; value: string }[];
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
  tokensIn: 46000,
  tokensOut: 8900,
  cost: 0.51,
  repo: "acme/storefront",
  gitRef: "b91f0ac4",
  user: "usr_44018",
  sessionId: "tr_9f4c21ab7e",
  metadata: [
    { label: "incident", value: "INC-4417 (P1, 14:02 UTC)" },
    { label: "region", value: "us-east-1" },
    { label: "deploy", value: "web-api@2026.08.09-b91f0ac4" },
    { label: "cart", value: "crt_8842190 · $184.20" },
    { label: "traffic_share", value: "34% of checkout requests" },
  ],
  spans: [
    { id: "s0", parentId: null, name: "checkout-assistant.run", kind: "agent", startMs: 0, durationMs: 150000, status: "error", attributes: [{ label: "model", value: "claude-opus-5" }, { label: "effort", value: "xhigh" }, { label: "trace.id", value: "tr_9f4c21ab7e" }, { label: "deploy", value: "web-api@2026.08.09-b91f0ac4" }], io: { input: "POST /api/checkout is failing in production.\n\nIncident: INC-4417 (P1, opened 14:02 UTC)\nSymptom: 34% of checkout requests return 500\nFirst bad deploy: web-api@2026.08.09-b91f0ac4 (rolled out 13:47 UTC)\n\ncart_id=crt_8842190\nuser_id=usr_44018\nregion=us-east-1\n\nDiagnose the failure, resolve the checkout rollout flag, and complete the order if it is safe. Do not bypass the rollout gate.", output: "## Checkout failed — order crt_8842190 was NOT placed\n\n**Root cause:** commit b91f0ac4 (\"chore: prune dead flags\") deleted flags.checkout_v2_enabled but left the call site at services/checkout/flags.py:42. resolve_rollout(\"checkout_v2\") raises AttributeError on every request, so the resolver 500s and checkout fails closed.\n\n**Attempts:** 2 flag resolutions (both AttributeError), 1 checkout POST (500), retries exhausted.\n\n**Blast radius:** 34% of checkout traffic since 13:47 UTC — the cohort routed through the v2 gate.\n\n**Fix:** restore the flag in flags/registry.yaml or revert b91f0ac4. Not applied — it touches the rollout gate and needs a human approver. No payment was captured." }, error: "AttributeError: module 'services.checkout.flags' has no attribute 'checkout_v2_enabled' — 3 attempts exhausted, POST /api/checkout returning 500" },
    { id: "s1", parentId: "s0", name: "Agent", kind: "agent", startMs: 340, durationMs: 28200, status: "ok", attributes: [{ label: "subagent", value: "planner" }, { label: "tools", value: "get_cart, resolve_rollout_flag, checkout, emit_metrics" }, { label: "max_turns", value: "6" }], io: { input: "Spawn subagent `planner` for incident INC-4417.\n\nContext: POST /api/checkout is returning 500 for ~34% of requests in us-east-1 since 13:47 UTC. Cart under test: crt_8842190 (user usr_44018, 3 units, $184.20). First bad deploy: web-api@2026.08.09-b91f0ac4.\n\nBudget: 2 model turns, read-only tools only (tool.get_cart, tool.resolve_rollout_flag). No writes, no card authorization from this subagent.\n\nReturn: (a) a numbered plan to complete or safely abort the checkout, (b) an explicit call-out of which step gates the payment path, (c) the failure policy for that gating step. Do not execute steps past the gate — hand off once it is identified.", output: "planner returned a 4-step plan in 2 turns, inside the 2-turn budget.\n\nPlan: 1) get_cart(crt_8842190) 2) resolve_rollout_flag(\"checkout_v2\", usr_44018) 3) POST /api/checkout with the resolved variant 4) emit_metrics.\n\nGating step: #2. resolve_rollout_flag decides the v1/v2 branch, and every step downstream of it touches the payment path.\n\nCart validated through tool.get_cart -> db.query (pool checkout-ro, 3 rows): 3 units across 2 SKUs (HDW-2201 x1 @ 129.00, CBL-0417 x2 @ 27.60), subtotal $184.20, updated_at 2026-08-11T13:58:02Z — no price drift, no expired reservation.\n\nFailure policy the planner attached to step 2: fail closed, never default to a variant. Flag resolution was deliberately left to a dedicated subagent so a flag-lookup failure cannot be confused with a payment failure in the trace. Handing off to rollout_resolver." } },
    { id: "s2", parentId: "s1", name: "planner", kind: "agent", startMs: 420, durationMs: 28000, status: "ok", attributes: [{ label: "model", value: "claude-opus-5" }, { label: "turns", value: "2" }, { label: "plan.steps", value: "4" }], io: { input: "You are the planner for checkout-assistant.\n\nGoal: complete checkout for cart crt_8842190 (user usr_44018, us-east-1).\nConstraints:\n- Never authorize a card before the rollout gate resolves.\n- Retry transient failures at most twice, then fail closed.\n\nAvailable: tool.get_cart, tool.resolve_rollout_flag, POST /api/checkout, tool.emit_metrics", output: "Plan:\n1. get_cart(crt_8842190) — confirm line items and the $184.20 total are still valid.\n2. resolve_rollout_flag(\"checkout_v2\", usr_44018) — decides v1 vs v2 checkout path.\n3. POST /api/checkout with the resolved variant.\n4. emit_metrics(latency, variant, outcome).\n\nRisk note: step 2 gates everything downstream. If the resolver errors, do NOT default to a variant — that would silently route paying users onto an untested path. Fail closed and report." } },
    { id: "s3", parentId: "s2", name: "anthropic.messages.create", kind: "llm", startMs: 520, durationMs: 9840, status: "ok", tokensIn: 3120, tokensOut: 842, cost: 0.0406, attributes: [{ label: "model", value: "claude-opus-5" }, { label: "effort", value: "high" }, { label: "cache", value: "write 3,120 tok" }, { label: "stop_reason", value: "end_turn" }], io: { input: "system: You are the planner for checkout-assistant. Fail closed on any gate you cannot resolve.\n\nuser: Cart crt_8842190 (user usr_44018, us-east-1) is failing checkout. 34% of POST /api/checkout calls have returned 500 since 13:47 UTC. Produce a numbered plan before calling any tool.", output: "Before touching the payment path I want two facts: (a) the cart is still valid, (b) which checkout variant this user is on.\n\n1. get_cart(crt_8842190)\n2. resolve_rollout_flag(\"checkout_v2\", usr_44018)\n3. POST /api/checkout with the resolved variant\n4. emit_metrics\n\nStep 2 is the gate. A 500 rate that is 34% — not 100% — points at a per-user branch, which is exactly what a rollout flag is. I expect the failure to live there rather than in the payment service." } },
    { id: "s4", parentId: "s2", name: "tool.get_cart", kind: "tool", startMs: 10480, durationMs: 2960, status: "ok", attributes: [{ label: "cart_id", value: "crt_8842190" }, { label: "items", value: "3" }, { label: "subtotal_usd", value: "184.20" }, { label: "currency", value: "USD" }] },
    { id: "s5", parentId: "s4", name: "db.query", kind: "db", startMs: 10640, durationMs: 2610, status: "ok", attributes: [{ label: "db.system", value: "postgresql" }, { label: "db.statement", value: "SELECT c.id, c.user_id, i.sku, i.qty, i.unit_price FROM carts c JOIN cart_items i ON i.cart_id = c.id WHERE c.id = $1" }, { label: "rows", value: "3" }, { label: "pool", value: "checkout-ro" }] },
    { id: "s6", parentId: "s2", name: "anthropic.messages.create", kind: "llm", startMs: 13560, durationMs: 14700, status: "ok", tokensIn: 5480, tokensOut: 1150, cost: 0.0562, attributes: [{ label: "model", value: "claude-opus-5" }, { label: "effort", value: "high" }, { label: "cache", value: "read 3,010 tok" }, { label: "stop_reason", value: "tool_use" }], io: { input: "tool_result get_cart:\n{\"cart_id\":\"crt_8842190\",\"user_id\":\"usr_44018\",\"items\":[{\"sku\":\"HDW-2201\",\"qty\":1,\"unit_price\":129.00},{\"sku\":\"CBL-0417\",\"qty\":2,\"unit_price\":27.60}],\"subtotal\":184.20,\"updated_at\":\"2026-08-11T13:58:02Z\"}\n\nProceed with the plan.", output: "Cart is valid: 3 units across 2 SKUs, $184.20, last updated 4 minutes ago — no price drift, no expired reservation.\n\nNext: resolve the rollout flag. I'm delegating this to a sub-agent because the resolver has its own retry semantics and I don't want a flag lookup failure to be confused with a payment failure in the trace.\n\nCalling tool.resolve_rollout_flag(flag=\"checkout_v2\", user_id=\"usr_44018\", region=\"us-east-1\")." } },
    { id: "s7", parentId: "s0", name: "Agent", kind: "agent", startMs: 28900, durationMs: 28300, status: "error", attributes: [{ label: "subagent", value: "rollout_resolver" }, { label: "attempt", value: "1" }, { label: "outcome", value: "failed" }], io: { input: "Resolve rollout flag \"checkout_v2\" for user usr_44018, region us-east-1, against flag-service.us-east-1.\n\nThis is step #2 of the planner's checkout plan — the gate. The caller is holding a live cart (crt_8842190, $184.20) and will not authorize payment until you return.\n\nHard requirements:\n- Return exactly one of {\"variant\":\"v1\"}, {\"variant\":\"v2\"}, or {\"error\":...}.\n- Fail closed. Never synthesize or default a variant; a wrong variant charges a real card on an untested path.\n- If the resolver raises, capture the exception class, message, and source site verbatim — the caller needs to tell config drift (KeyError) apart from a removed symbol (AttributeError) apart from a service outage (timeout/5xx).\n\nBudget: 1 resolution attempt.", output: "FAILED — no variant returned.\n\nThe resolver raised AttributeError, not a timeout, not a 404, not a connection reset: module 'services.checkout.flags' has no attribute 'checkout_v2_enabled', raised at services/checkout/flags.py:42 in resolve_rollout. The subagent read the resolver source (flags.py:1-80) before calling the tool, so it could classify the exception rather than guess at it.\n\nClassification: the flag key is missing from the deployed module itself, which makes this a code defect in the artifact rather than a service outage — every request that reaches line 42 raises identically. That also explains 34% instead of 100%: only users bucketed into the v2 cohort reach line 42 at all.\n\nNo variant emitted, so the payment path stays closed. Escalating to a retry subagent for one more attempt with backoff, purely to establish whether the failure is deterministic across replicas or a single stale pod." }, error: "rollout_resolver terminated: unrecoverable AttributeError from services.checkout.flags" },
    { id: "s8", parentId: "s7", name: "rollout_resolver", kind: "agent", startMs: 29000, durationMs: 28000, status: "error", attributes: [{ label: "model", value: "claude-opus-5" }, { label: "flag", value: "checkout_v2" }, { label: "fail_mode", value: "closed" }, { label: "turns", value: "2" }], io: { input: "Resolve flag `checkout_v2` for user usr_44018 (region us-east-1, upstream flag-service.us-east-1).\n\nReturn strictly one of:\n  {\"variant\":\"v1\"} | {\"variant\":\"v2\"} | {\"error\": {...}}\n\nRules:\n- Never return a default or a guess. There is no safe fallback value here — the caller holds a live cart (crt_8842190, $184.20) and will authorize a card against whatever you return.\n- If the resolver raises, include the exception class, the message, and the source site (file:line) in the error object, and set \"variant\": null explicitly.\n- Read the resolver implementation before calling the tool, so you can interpret the failure mode instead of reporting it opaquely.\n\nTurn budget: 2. Fail mode: closed.", output: "{\"error\":\"AttributeError\",\"detail\":\"module 'services.checkout.flags' has no attribute 'checkout_v2_enabled'\",\"site\":\"services/checkout/flags.py:42\",\"frame\":\"resolve_rollout -> threshold = flags.checkout_v2_enabled.rollout_pct\",\"upstream\":\"flag-service.us-east-1\",\"http_status\":500,\"request_id\":\"req_7c1f0e93\",\"variant\":null}\n\nNo variant returned, per the never-default rule. Reasoning: I read flags.py:1-80 first, so I could classify the exception rather than treat it as generic upstream noise. An AttributeError on module attribute access is resolved at access time against the deployed module object — it is deterministic, not load-dependent, and no retry against the same artifact can change it.\n\nThe rollout gate is therefore unresolvable. Returning v1 would silently switch off an active experiment for the whole v2 cohort; returning v2 would route paying customers onto exactly the path the gate exists to protect. Both are guesses about cohort membership I have no evidence for. Failing closed and escalating." }, error: "AttributeError propagated from tool.resolve_rollout_flag after 1 attempt" },
    { id: "s9", parentId: "s8", name: "anthropic.messages.create", kind: "llm", startMs: 29120, durationMs: 7420, status: "ok", tokensIn: 4260, tokensOut: 590, cost: 0.0414, attributes: [{ label: "model", value: "claude-opus-5" }, { label: "effort", value: "medium" }, { label: "cache", value: "write 4,260 tok" }, { label: "stop_reason", value: "tool_use" }], io: { input: "system: You resolve rollout flags. Never invent a variant; a wrong variant charges a real card on an untested path.\n\nuser: Resolve checkout_v2 for usr_44018 (us-east-1). Flag service is flag-service.us-east-1.", output: "I'll read the resolver source first so I can interpret whatever error comes back, then call the tool once.\n\nThe flag is a percentage rollout, so the resolver hashes the user id into a bucket and compares it against the configured threshold. If the threshold lookup fails I need to see the exception type — a KeyError means config drift, an AttributeError means the flag was removed from code.\n\nCalling tool.resolve_rollout_flag(flag=\"checkout_v2\", user_id=\"usr_44018\")." } },
    { id: "s10", parentId: "s8", name: "tool.resolve_rollout_flag", kind: "tool", startMs: 36680, durationMs: 8460, status: "error", attributes: [{ label: "flag", value: "checkout_v2" }, { label: "resolver", value: "services.checkout.flags:resolve_rollout" }, { label: "attempt", value: "1" }, { label: "fail_mode", value: "closed" }], git: { file: "services/checkout/flags.py", line: 42, commit: "b91f0ac4" }, error: "AttributeError: module 'services.checkout.flags' has no attribute 'checkout_v2_enabled' (raised at services/checkout/flags.py:42 in resolve_rollout)" },
    { id: "s11", parentId: "s10", name: "Read", kind: "tool", startMs: 36820, durationMs: 640, status: "ok", attributes: [{ label: "file", value: "services/checkout/flags.py" }, { label: "range", value: "1-80" }, { label: "bytes", value: "2,140" }] },
    { id: "s12", parentId: "s10", name: "GET /internal/flags/resolve", kind: "http", startMs: 37600, durationMs: 7300, status: "error", attributes: [{ label: "http.method", value: "GET" }, { label: "http.status_code", value: "500" }, { label: "upstream", value: "flag-service.us-east-1" }, { label: "request_id", value: "req_7c1f0e93" }], error: "500 Internal Server Error — upstream resolver raised AttributeError: checkout_v2_enabled" },
    { id: "s13", parentId: "s8", name: "anthropic.messages.create", kind: "llm", startMs: 45300, durationMs: 11400, status: "ok", tokensIn: 6940, tokensOut: 940, cost: 0.0582, attributes: [{ label: "model", value: "claude-opus-5" }, { label: "effort", value: "xhigh" }, { label: "cache", value: "read 6,180 tok" }, { label: "stop_reason", value: "end_turn" }], io: { input: "tool_result resolve_rollout_flag (is_error=true):\nAttributeError: module 'services.checkout.flags' has no attribute 'checkout_v2_enabled'\n  File \"services/checkout/flags.py\", line 42, in resolve_rollout\n    threshold = flags.checkout_v2_enabled.rollout_pct\n\nInterpret and decide whether to retry.", output: "This is not a transient failure. An AttributeError on module attribute access is deterministic — the same code path will raise on every request until the module changes.\n\nWhat it tells me:\n- The symbol checkout_v2_enabled does not exist on the flags module at import time.\n- Line 42 still references it, so the call site outlived the definition.\n- A 34% error rate matches a percentage rollout: only bucketed users reach line 42.\n\nI will not return a variant. Returning v1 would silently disable an active experiment; returning v2 would route users onto an ungated path. Escalating." } },
    { id: "s14", parentId: "s0", name: "Agent", kind: "agent", startMs: 57600, durationMs: 39100, status: "error", attributes: [{ label: "subagent", value: "retry_checkout" }, { label: "attempt", value: "2" }, { label: "backoff", value: "400ms, 1.2s" }], io: { input: "Retry the rollout flag resolution for checkout_v2 / usr_44018 one final time before the incident is declared deterministic.\n\nWhy: attempt 1 (rollout_resolver) failed with AttributeError at services/checkout/flags.py:42. That reads like a code defect — but a single stale pod serving an older module image would produce the same signature from one replica, so we need evidence about replica variance before ruling out a transient.\n\nMethod: two upstream calls with jittered backoff (400ms, then 1.2s) so the requests are likely to land on different flag-service replicas. Capture both stack traces in full, including the local variable dump, and diff them against attempt 1.\n\nStop conditions: if all three traces match to the line, declare the failure deterministic and stop — do not spend a third attempt. If any replica returns a variant, return it immediately. Retry budget: 2, hard cap. Do not fall back to a default variant under any outcome.", output: "Both retries failed with the identical AttributeError and the identical stack frame (services/checkout/flags.py:42, in resolve_rollout).\n\nAttempt 2a (t+400ms, replica flag-service-7d9c-4kx2): 500\nAttempt 2b (t+1.2s, replica flag-service-7d9c-9mb1): 500\n\nTwo upstream calls, two 500s, two distinct replicas, 6.7s spent in backoff. Stack frames are byte-identical to attempt 1 down to the local variable dump, so there is no pod-level variance and the stale-image hypothesis is dead — the defect ships in the deployed artifact web-api@2026.08.09-b91f0ac4 itself.\n\nConfirmed deterministic: a third attempt cannot succeed and would only add latency to a request that is already failing. Retry budget exhausted, rollout gate marked unresolvable, failing closed with no variant. Handing off to error triage to locate the commit that removed the symbol." }, error: "retry_checkout exhausted 2 attempts, both AttributeError at services/checkout/flags.py:42" },
    { id: "s15", parentId: "s14", name: "retry_checkout", kind: "agent", startMs: 57700, durationMs: 38800, status: "error", attributes: [{ label: "model", value: "claude-opus-5" }, { label: "max_retries", value: "2" }, { label: "outcome", value: "exhausted" }, { label: "jitter", value: "full" }], io: { input: "Attempt 2 of 2 — same flag (checkout_v2), same user (usr_44018), same region (us-east-1).\n\nAttempt 1 returned AttributeError at services/checkout/flags.py:42. Your job is not to make the call succeed; it is to determine whether the failure is global or per-replica.\n\nProcedure:\n1. Issue two upstream calls to GET /internal/flags/resolve with full-jitter backoff (~400ms, then ~1.2s) so they are unlikely to be served by the same pod.\n2. Record the replica id for each call alongside the status code.\n3. Capture both stack traces verbatim and diff them against attempt 1 — compare frame order, line numbers, and the local variable dump, not just the exception message.\n4. Decide: identical across replicas => deterministic code defect, stop. Divergent => stale pod, report which replica is serving the old artifact.\n\nHard cap: 2 attempts, no third. Never return a default variant regardless of outcome.", output: "Attempt 2a (t+400ms, replica flag-service-7d9c-4kx2): 500, AttributeError, flags.py:42\nAttempt 2b (t+1.2s, replica flag-service-7d9c-9mb1): 500, AttributeError, flags.py:42\n\nStack frames are byte-identical across both replicas and against attempt 1, including the local variable dump (bucket computed, threshold unbound at the point of raise). Frame order, line number, and the failing expression `threshold = flags.checkout_v2_enabled.rollout_pct` all match exactly.\n\nConclusion: no pod-level variance. Both replicas are serving the same artifact and both lack the symbol, so this is not a stale-image or partial-rollout problem — the module shipped without `checkout_v2_enabled` while the consumer still dereferences it. Retrying a third time cannot succeed and only adds ~2s to a request that is already failing.\n\nRetry budget exhausted (2/2). Marking the rollout gate unresolvable and failing closed — no variant returned, no payment path entered." }, error: "2/2 attempts failed with identical AttributeError; retry budget exhausted" },
    { id: "s16", parentId: "s15", name: "anthropic.messages.create", kind: "llm", startMs: 57820, durationMs: 11240, status: "ok", tokensIn: 5310, tokensOut: 900, cost: 0.0557, attributes: [{ label: "model", value: "claude-opus-5" }, { label: "effort", value: "medium" }, { label: "cache", value: "write 5,310 tok" }, { label: "stop_reason", value: "tool_use" }], io: { input: "system: You are the retry agent. One more resolution attempt, then stop.\n\nuser: Previous attempt raised AttributeError at services/checkout/flags.py:42. Retry with backoff and compare stack traces.", output: "A retry here is cheap and buys one piece of evidence: whether the failure is per-pod or global. If a single stale pod is serving the old module, some replicas will succeed.\n\nPlan for this attempt:\n1. Call resolve_rollout_flag twice with 400ms and 1.2s jittered backoff so the requests land on different replicas.\n2. Diff the two stack traces against attempt 1.\n3. If all three match to the line, declare it deterministic and stop — further retries only add latency to a request that is already failing.\n\nCalling tool.resolve_rollout_flag now." } },
    { id: "s17", parentId: "s15", name: "tool.resolve_rollout_flag", kind: "tool", startMs: 69200, durationMs: 12300, status: "error", attributes: [{ label: "flag", value: "checkout_v2" }, { label: "attempt", value: "2" }, { label: "upstream_calls", value: "2" }, { label: "stack_match", value: "identical to attempt 1" }], git: { file: "services/checkout/flags.py", line: 42, commit: "b91f0ac4" }, error: "AttributeError: module 'services.checkout.flags' has no attribute 'checkout_v2_enabled' (raised at services/checkout/flags.py:42, 2/2 replicas)" },
    { id: "s18", parentId: "s17", name: "GET /internal/flags/resolve", kind: "http", startMs: 69340, durationMs: 5100, status: "error", attributes: [{ label: "http.status_code", value: "500" }, { label: "retry", value: "1 of 2" }, { label: "replica", value: "flag-service-7d9c-4kx2" }, { label: "backoff_ms", value: "400" }], error: "500 Internal Server Error — AttributeError: checkout_v2_enabled" },
    { id: "s19", parentId: "s17", name: "GET /internal/flags/resolve", kind: "http", startMs: 74600, durationMs: 6700, status: "error", attributes: [{ label: "http.status_code", value: "500" }, { label: "retry", value: "2 of 2" }, { label: "replica", value: "flag-service-7d9c-9mb1" }, { label: "backoff_ms", value: "1200" }], error: "500 Internal Server Error — AttributeError: checkout_v2_enabled (different replica, identical trace)" },
    { id: "s20", parentId: "s15", name: "anthropic.messages.create", kind: "llm", startMs: 81700, durationMs: 14600, status: "ok", tokensIn: 7180, tokensOut: 1210, cost: 0.0662, attributes: [{ label: "model", value: "claude-opus-5" }, { label: "effort", value: "high" }, { label: "cache", value: "read 6,940 tok" }, { label: "stop_reason", value: "end_turn" }], io: { input: "tool_result resolve_rollout_flag (is_error=true): 2/2 upstream calls returned 500 with identical AttributeError at flags.py:42, from two different replicas.\n\nDecide: retry again, fall back to a variant, or escalate?", output: "Escalate. Neither of the other two options is defensible:\n\n- Retry again: two distinct replicas produced byte-identical traces, so the defect is in the deployed artifact, not in a single pod's state. A third attempt adds ~2s of latency to an already-failing request and cannot change the outcome.\n- Fall back to a variant: the resolver never returned a value, so I have no evidence about which cohort this user belongs to. Defaulting to v1 silently kills an active experiment for 34% of traffic; defaulting to v2 routes paying customers through a path the gate exists to protect.\n\nHanding off to the error_triage skill to locate the commit that removed the symbol." } },
    { id: "s21", parentId: "s0", name: "Skill", kind: "skill", startMs: 97400, durationMs: 35400, status: "ok", attributes: [{ label: "skill", value: "error_triage" }, { label: "version", value: "2.4.0" }, { label: "scope", value: "services/checkout" }], io: { input: "Invoke skill `error_triage` (v2.4.0), scope services/checkout.\n\nSignal:\n  exception: AttributeError\n  module:    services.checkout.flags\n  symbol:    checkout_v2_enabled\n  site:      services/checkout/flags.py:42 (in resolve_rollout)\n  artifact:  acme/web-api @ web-api@2026.08.09-b91f0ac4\n  observed:  2 subagents, 3 upstream calls, 3 identical 500s across 2 replicas; failure confirmed deterministic\n\nQuestions to answer:\n1. Which commit removed the `checkout_v2_enabled` definition, who authored it, and when — authored vs deployed?\n2. Is the call site at line 42 still live, and when was it last touched relative to the deletion?\n3. Does the commit timeline line up with the incident window (first 500s ~13:49 UTC, INC-4417 opened 14:02 UTC)?\n4. Why did review and static analysis not catch the dangling reference?\n\nReturn evidence, not just a conclusion.", output: "error_triage completed, confidence high (steps: grep, git log -S, git blame, read, analyze).\n\nAnswer: the symbol was removed by b91f0ac4 (\"chore: prune dead flags\", author codegen-bot, authored 2026-08-09T13:41:18Z), which deleted `checkout_v2_enabled` from flags/registry.yaml and regenerated the flags module. The consumer at services/checkout/flags.py:42 was left untouched — git blame shows line 42 last modified by a1c7e02 (jkim, 2026-06-30), so the call site predates the deletion by roughly six weeks and was never updated alongside it. grep confirms exactly 1 remaining live reference in services/, at that line.\n\nTimeline matches the incident precisely: 13:41 UTC commit authored, 13:47 UTC deploy to us-east-1, 13:49 UTC first 500s, 14:02 UTC INC-4417 opened.\n\nWhy it escaped review: the reference is attribute access on a generated module (`flags.checkout_v2_enabled`), not an import, so the unused-symbol pass that justified the pruning never saw it and the diff read as a pure deletion.\n\nRemediation returned to the caller: revert b91f0ac4, or re-add checkout_v2_enabled with rollout_pct: 34 to flags/registry.yaml; follow-up is to teach the pruner to resolve generated-module attribute access, or have the generated module raise a typed MissingFlagError so this surfaces as a flag error rather than an AttributeError." } },
    { id: "s22", parentId: "s21", name: "error_triage", kind: "skill", startMs: 97500, durationMs: 35100, status: "ok", attributes: [{ label: "steps", value: "grep, git log, git blame, read, analyze" }, { label: "repo", value: "acme/web-api" }, { label: "confidence", value: "high" }], io: { input: "Locate the change that removed `services.checkout.flags.checkout_v2_enabled` and confirm whether the consuming call site still references it.\n\nRepo: acme/web-api, artifact web-api@2026.08.09-b91f0ac4, scope services/checkout.\nKnown failure: AttributeError at services/checkout/flags.py:42 in resolve_rollout, reproduced on 2/2 replicas with byte-identical stack traces.\n\nSteps and the evidence to return for each:\n1. grep the symbol across services/ — how many live references remain and in which files.\n2. git log -S on the symbol — the commits that introduced and removed it, oldest and newest touch.\n3. git blame -L 38,46 services/checkout/flags.py — who last modified line 42 and when, to establish whether the call site predates or postdates the deletion.\n4. read services/checkout/flags.py:30-60 — the exact expression that dereferences the symbol and the function that contains it.\n5. Analyze — state the root cause, explain why the error rate is 34% rather than 100%, and explain why the deletion passed review and static analysis.\n\nReturn a confidence rating with the finding.", output: "Finding: b91f0ac4 removed the `checkout_v2_enabled` definition from flags/registry.yaml and the generated flags module, but the consumer at services/checkout/flags.py:42 was not updated. Confidence: high.\n\nEvidence:\n- grep checkout_v2_enabled services/ -> 1 match in 1 file: services/checkout/flags.py:42\n- git log -S checkout_v2_enabled --oneline -n 5 -> b91f0ac4 \"chore: prune dead flags\" (removal); a1c7e02 \"feat(checkout): gate v2 behind percentage rollout\" (introduction)\n- git blame -L 38,46 services/checkout/flags.py -> line 42 attributed to a1c7e02 (jkim, 2026-06-30): `threshold = flags.checkout_v2_enabled.rollout_pct` — the call site predates the deletion by six weeks\n- read flags.py:38-46 -> resolve_rollout(name, user_id) computes `bucket = _bucket(user_id)`, then dereferences the missing symbol on the very next line, then returns \"v2\" if bucket < threshold else \"v1\"\n\nConclusion: dead-code pruning removed a symbol that was still live behind a percentage rollout. Static analysis missed it because the access is attribute-style on a generated module rather than an import, so the unused-symbol pass had nothing to bind. The 34% error rate is the live rollout percentage — line 42 is only reached after bucketing, so users outside the v2 cohort never touch the missing attribute and see no error at all." } },
    { id: "s23", parentId: "s22", name: "Grep", kind: "tool", startMs: 97640, durationMs: 1180, status: "ok", attributes: [{ label: "pattern", value: "checkout_v2_enabled" }, { label: "path", value: "services/" }, { label: "matches", value: "1" }, { label: "files", value: "1" }] },
    { id: "s24", parentId: "s22", name: "Bash", kind: "tool", startMs: 98960, durationMs: 2340, status: "ok", attributes: [{ label: "command", value: "git log -S checkout_v2_enabled --oneline -n 5" }, { label: "exit_code", value: "0" }, { label: "stdout_lines", value: "2" }] },
    { id: "s25", parentId: "s24", name: "git blame -L 38,46 services/checkout/flags.py", kind: "shell", startMs: 99100, durationMs: 1020, status: "ok", attributes: [{ label: "commit", value: "b91f0ac4" }, { label: "author", value: "codegen-bot" }, { label: "subject", value: "chore: prune dead flags" }, { label: "authored_at", value: "2026-08-09T13:41:18Z" }], git: { file: "services/checkout/flags.py", line: 42, commit: "b91f0ac4" } },
    { id: "s26", parentId: "s22", name: "Read", kind: "tool", startMs: 101440, durationMs: 520, status: "ok", attributes: [{ label: "file", value: "services/checkout/flags.py" }, { label: "range", value: "30-60" }, { label: "highlight", value: "line 42" }] },
    { id: "s27", parentId: "s22", name: "anthropic.messages.create", kind: "llm", startMs: 102100, durationMs: 30300, status: "ok", tokensIn: 9420, tokensOut: 2468, cost: 0.1088, attributes: [{ label: "model", value: "claude-opus-5" }, { label: "effort", value: "xhigh" }, { label: "cache", value: "read 8,900 tok" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Evidence bundle:\n\ngrep checkout_v2_enabled services/ -> services/checkout/flags.py:42\n\ngit log -S checkout_v2_enabled --oneline -n 5:\n  b91f0ac4 chore: prune dead flags\n  a1c7e02  feat(checkout): gate v2 behind percentage rollout\n\ngit blame -L 38,46 services/checkout/flags.py:\n  a1c7e02 (jkim 2026-06-30) 42) threshold = flags.checkout_v2_enabled.rollout_pct\n\nflags.py:38-46:\n  def resolve_rollout(name: str, user_id: str) -> str:\n      bucket = _bucket(user_id)\n      threshold = flags.checkout_v2_enabled.rollout_pct\n      return \"v2\" if bucket < threshold else \"v1\"\n\nProduce a root-cause writeup.", output: "## Root cause\n\nb91f0ac4 (\"chore: prune dead flags\", codegen-bot, 13:41 UTC) deleted the `checkout_v2_enabled` entry from flags/registry.yaml and regenerated the flags module. The consumer at services/checkout/flags.py:42 — written 6 weeks earlier in a1c7e02 — was not updated, so `resolve_rollout` now dereferences a symbol that no longer exists.\n\n## Why it escaped review\n\nThe reference is attribute access on a generated module (`flags.checkout_v2_enabled`), not an import. The unused-symbol pass that drove the pruning only tracks imports, so line 42 was invisible to it and the diff looked like a pure deletion.\n\n## Why 34% and not 100%\n\nLine 42 is only reached after `_bucket(user_id)` is computed, and the whole branch sits behind the v2 cohort check upstream. Users outside the cohort never touch it. 34% is the live rollout percentage as of the last registry snapshot.\n\n## Timeline\n\n13:41 commit authored · 13:47 deploy to us-east-1 · 13:49 first 500s · 14:02 INC-4417 opened\n\n## Remediation\n\n1. Revert b91f0ac4, or re-add checkout_v2_enabled with rollout_pct: 34 to flags/registry.yaml.\n2. Follow up: teach the pruner to resolve generated-module attribute access, or make the generated module raise a typed MissingFlagError so this fails as a flag error rather than an AttributeError." } },
    { id: "s28", parentId: "s0", name: "anthropic.messages.create", kind: "llm", startMs: 133400, durationMs: 6300, status: "ok", tokensIn: 4290, tokensOut: 800, cost: 0.0829, attributes: [{ label: "model", value: "claude-opus-5" }, { label: "speed", value: "fast" }, { label: "beta", value: "fast-mode-2026-02-01" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Triage is complete: b91f0ac4 removed flags.checkout_v2_enabled; the call site at services/checkout/flags.py:42 remains.\n\nDecide what to do now for the in-flight request (cart crt_8842190). Options: patch the call site, hard-code a variant, or fail the checkout. You have write access to the repo but no deploy permission.", output: "I can explain the AttributeError precisely, and that changes what I'm allowed to do about it.\n\nThe exception is raised at attribute-lookup time on a generated module, which means there is no fallback value to recover — `getattr(flags, \"checkout_v2_enabled\", None)` would return None and I'd still have to invent a rollout percentage. Any value I invent is a guess about which users are in the experiment.\n\nSo:\n- Patch the call site: no. A defensive getattr here converts a loud failure into a silent mis-routing of live payment traffic.\n- Hard-code a variant: no, same reason, and it hides the regression from the next deploy.\n- Fail the checkout: yes. The gate exists to prevent exactly this.\n\nI'll attempt the checkout once so the failure is recorded against a real request id, then report. The order will not be placed and no card will be authorized." } },
    { id: "s29", parentId: "s0", name: "POST /api/checkout", kind: "http", startMs: 140100, durationMs: 5100, status: "error", attributes: [{ label: "http.method", value: "POST" }, { label: "http.status_code", value: "500" }, { label: "request_id", value: "req_a02f4d17" }, { label: "error_rate_5m", value: "34%" }], error: "500 Internal Server Error — rollout gate unresolved (AttributeError: checkout_v2_enabled); order not created, no payment authorized" },
    { id: "s30", parentId: "s29", name: "db.query", kind: "db", startMs: 140300, durationMs: 1400, status: "warn", attributes: [{ label: "db.system", value: "postgresql" }, { label: "db.statement", value: "ROLLBACK" }, { label: "tx", value: "tx_5518f2a" }, { label: "note", value: "order row reverted before payment authorization" }] },
    { id: "s31", parentId: "s29", name: "GET /internal/flags/resolve", kind: "http", startMs: 141900, durationMs: 2900, status: "error", attributes: [{ label: "http.status_code", value: "500" }, { label: "upstream", value: "flag-service.us-east-1" }, { label: "caller", value: "checkout-api" }, { label: "request_id", value: "req_a02f4d18" }], error: "500 Internal Server Error — AttributeError: checkout_v2_enabled (third occurrence this trace)" },
    { id: "s32", parentId: "s0", name: "tool.emit_metrics", kind: "tool", startMs: 145500, durationMs: 2600, status: "ok", attributes: [{ label: "metric", value: "checkout.assistant.outcome" }, { label: "value", value: "failed_closed" }, { label: "tags", value: "incident:INC-4417,commit:b91f0ac4,region:us-east-1" }] },
    { id: "s33", parentId: "s32", name: "POST /api/metrics/increment", kind: "http", startMs: 145640, durationMs: 2280, status: "ok", attributes: [{ label: "http.method", value: "POST" }, { label: "http.status_code", value: "202" }, { label: "sink", value: "otel-collector.observability" }, { label: "series", value: "3" }] },
  ],
  finding: {
    detector: "tool_failure",
    title: "Tool failure — unhandled exception on the critical path",
    severity: "critical",
    confidence: 0.96,
    summary:
      "resolve_rollout_flag raised AttributeError on 34% of checkout traffic. The rollout guard references flags.checkout_v2_enabled, which no longer exists after commit b91f0ac4. Downstream POST /api/checkout returns 500.",
    triggeredSpanId: "s10",
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
  repo: "acme/voice-agents",
  gitRef: "7c1d9e2a",
  user: "patient_4471",
  sessionId: "sess-voice-2231",
  metadata: [
    { label: "channel", value: "phone" },
    { label: "asr_confidence", value: "0.61" },
    { label: "clinic", value: "Downtown Family Health" },
  ],
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
    { id: "s1a", parentId: "s1", name: "tool.vad_segment", kind: "tool", startMs: 40, durationMs: 90, status: "ok",
      attributes: [{ label: "segments", value: "3" }] },
    { id: "s1b", parentId: "s1", name: "llm.transcribe_correct", kind: "llm", startMs: 130, durationMs: 210, status: "warn",
      attributes: [{ label: "model", value: "claude-haiku-4-5" }, { label: "ambiguous", value: "Tuesday / Thursday" }],
      io: { input: "Low-confidence date token. Best guess?", output: "Ambiguous between Tuesday and Thursday; picking Thursday (0.61)." } },
    { id: "s4", parentId: "s0", name: "agent.confirm_gate", kind: "agent", startMs: 1140, durationMs: 20, status: "warn",
      attributes: [{ label: "latency_budget_ms", value: "420" }, { label: "decision", value: "skip confirmation" }],
      io: { input: "Latency budget is 420ms (< 500). Confirm the date with the patient?", output: "Skipping confirmation to meet the SLA." } },
    { id: "s5", parentId: "s0", name: "tts.speak", kind: "tool", startMs: 1460, durationMs: 340, status: "ok",
      attributes: [{ label: "text", value: "You're booked for Thursday at 2pm." }] },
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
  repo: "acme/market-agents",
  gitRef: "3f9a1c05",
  user: "trader_88",
  sessionId: "sess-stock-8890",
  metadata: [
    { label: "symbol", value: "NVDA" },
    { label: "provider", value: "quotes-api v3" },
    { label: "field_renamed", value: "change → pct_change" },
  ],
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
    { id: "s2a", parentId: "s2", name: "http.GET quotes-api/v3/NVDA", kind: "http", startMs: 410, durationMs: 160, status: "ok",
      attributes: [{ label: "status", value: "200" }, { label: "fields", value: "price, pct_change, volume" }] },
    { id: "s2b", parentId: "s2", name: "function.parse_quote", kind: "function", startMs: 570, durationMs: 6, status: "ok",
      attributes: [{ label: "keys", value: "price, pct_change, volume" }] },
    { id: "s4", parentId: "s0", name: "agent.handle_error", kind: "agent", startMs: 620, durationMs: 180, status: "error",
      error: "Propagated KeyError to the caller — no safe fallback",
      attributes: [{ label: "recovered", value: "false" }],
      io: { input: "format_quote raised KeyError: 'change'. Recover?", output: "No safe fallback for the renamed field — surfacing the error." } },
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
  repo: "acme/billing-agents",
  gitRef: "5e2b7d18",
  user: "acct_ops",
  sessionId: "sess-bill-3390",
  metadata: [
    { label: "invoice", value: "$4,200.00" },
    { label: "order", value: "#55210" },
    { label: "expected_customer", value: "cust_5521" },
  ],
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
    { id: "s1a", parentId: "s1", name: "tool.load_order", kind: "tool", startMs: 30, durationMs: 80, status: "ok",
      attributes: [{ label: "order", value: "#55210" }, { label: "amount", value: "$4,200.00" }] },
    { id: "s3", parentId: "s0", name: "tool.render_invoice", kind: "tool", startMs: 500, durationMs: 220, status: "ok",
      attributes: [{ label: "amount", value: "$4,200.00" }, { label: "customer", value: "cust_5522" }] },
    { id: "s4", parentId: "s0", name: "tool.send_invoice", kind: "http", startMs: 720, durationMs: 300, status: "error",
      error: "Invoice delivered to the wrong customer (cust_5522)",
      attributes: [{ label: "to", value: "cust_5522" }, { label: "expected", value: "cust_5521" }],
      io: { input: "Send invoice #55210 to the resolved customer.", output: "Sent to cust_5522 — wrong recipient." } },
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
    repo: `acme/${over.service}`,
    gitRef: "main",
    user: "example-user",
    sessionId: over.spans[0]?.attributes?.find((a) => a.label === "session")?.value ?? "session",
    metadata: [
      { label: "environment", value: "production" },
      { label: "outcome", value: "ok" },
    ],
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
  repo: "acme/research-agents",
  gitRef: "55f8385",
  user: "example-user",
  sessionId: "sess_01HQ7ZK4M2",
  metadata: [
    { label: "pipeline.version", value: "2.4.1" },
    { label: "subagents", value: "researcher, analyst, writer" },
    { label: "sources_kept", value: "17 of 34" },
    { label: "report", value: "reports/otel-ai-observability.md" },
  ],
  tokensIn: 98000, tokensOut: 18000, cost: 0.3365,
  spans: [
    { id: "s0", parentId: null, name: "research_pipeline", kind: "agent", startMs: 0, durationMs: 960000, status: "ok", attributes: [{ label: "pipeline.version", value: "2.4.1" }, { label: "subagents", value: "researcher, analyst, writer" }, { label: "trace.sampled", value: "true" }, { label: "env", value: "production" }], io: { input: "Research question: What are the key features of OpenTelemetry for AI observability?\n\n1. Survey the OTel GenAI semantic conventions (status, span/event names, required attributes).\n2. Identify which SDKs and vendors implement them today, with versions and dates.\n3. Quantify adoption across major LLM frameworks: gen_ai.* attribute, token, and cost coverage.\n4. Compare against proprietary tracing (LangSmith, Datadog LLM Obs) — gaps and overlaps.\n5. Produce a ~1200-word markdown report with a statistics table. Cite every claim.\n\nCoordinate the agents and present the final report.", output: "Final report delivered: reports/otel-ai-observability.md (1,284 words, 17 citations).\n\nHeadline findings:\n- gen_ai.* conventions are Development-status but stable enough that 6 of 8 surveyed frameworks emit the required attributes.\n- Token accounting is the best-implemented surface (7 of 8); cost is the worst (2 of 8).\n- Prompts/completions moved from span attributes to events in v1.27 — the single biggest migration cost.\n\n1 recoverable tool failure (Bash, ZeroDivisionError) — diagnosed, fixed, re-run. Status: ok." } },
    { id: "s1", parentId: "s0", name: "ClaudeAgent.query", kind: "agent", startMs: 1200, durationMs: 954600, status: "ok", attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "max_turns", value: "24" }, { label: "tools.enabled", value: "WebSearch, Bash, Read, Grep, Edit, Task, Skill" }, { label: "session.id", value: "sess_01HQ7ZK4M2" }], io: { input: "System: You are the orchestrator for research_pipeline. Delegate to subagents; never run web searches yourself.\n\nUser task (5 steps) attached.\n\nProcedure:\n- Produce an execution plan before dispatching anything.\n- Dispatch researcher -> analyst -> writer, passing each one the previous artifact.\n- Verify the writer's citations against the researcher's source list before returning.", output: "Plan executed in 3 phases (gather -> quantify -> synthesize).\n\n- researcher: 5 parallel web searches, 34 results, 17 sources kept after dedupe + tier/recency filtering\n- analyst: coverage matrix over 8 frameworks; 1 script failure diagnosed and recovered\n- writer: 1,284-word report, 17 inline citations, all resolved against the source list\n\nHanded the final markdown back to the caller and wrote reports/otel-ai-observability.md." } },
    { id: "s2", parentId: "s1", name: "anthropic.messages.create", kind: "llm", startMs: 2400, durationMs: 32000, status: "ok", tokensIn: 4200, tokensOut: 810, cost: 0.0177, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.2" }, { label: "cache_read_tokens", value: "2600" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Decompose this research task into an execution plan.\n\nFor each step decide:\n- does it need live web evidence, computation over collected data, or pure synthesis?\n- which subagent owns it?\n- what artifact must it produce?\n\nReturn a numbered plan. Do not start work.", output: "Plan:\n1. researcher — pull the GenAI semconv spec, changelog, and SDK release notes (live web). Artifact: sources.jsonl\n2. researcher — collect per-framework instrumentation claims for 8 frameworks. Artifact: claims table\n3. analyst — compute attribute / token / cost coverage with python. Artifact: coverage.csv\n4. analyst — diff OTel against LangSmith and Datadog field-by-field. Artifact: gap memo\n5. writer — 1,200-word markdown report with a stats table. Artifact: reports/otel-ai-observability.md" } },
    { id: "s3", parentId: "s1", name: "Skill", kind: "skill", startMs: 35000, durationMs: 96000, status: "ok", attributes: [{ label: "skill.name", value: "research-methodology" }, { label: "skill.version", value: "1.6.0" }, { label: "source", value: ".claude/skills/research-methodology/SKILL.md" }], io: { input: "Apply research-methodology to the 5-step plan.\n\nSet, before any retrieval happens:\n- source-quality tiers and what each tier may be cited for\n- the recency window\n- the citation format the writer must use\n- where statistics are allowed to come from", output: "Methodology locked:\n- Tier 1: spec text, CHANGELOGs, release notes, source code (accept without corroboration)\n- Tier 2: vendor docs and engineering blogs (need a Tier 1 corroborant for any numeric claim)\n- Tier 3: talks, forum posts (context only, never cited for statistics)\n- Recency window: 18 months; older sources must be labeled \"historical\"\n- Citation format: [n] with URL + retrieval date in the reference block\n- Any statistic in the report must trace to a row in coverage.csv" } },
    { id: "s3a", parentId: "s3", name: "Read", kind: "tool", startMs: 35400, durationMs: 1100, status: "ok", attributes: [{ label: "file.path", value: ".claude/skills/research-methodology/SKILL.md" }, { label: "lines", value: "212" }, { label: "bytes", value: "9418" }], io: { input: "Read .claude/skills/research-methodology/SKILL.md in full.\n\nThe orchestrator needs four things out of this file before any retrieval is allowed to start: the tier table, the recency rule, the citation format, and the statistic-provenance rule. Read the whole file rather than grepping — the tier table's footnotes carry the exceptions.", output: "212 lines / 9,418 bytes.\n\n## Source tiers\n| Tier | Kinds | May be cited for |\n|---|---|---|\n| 1 | spec text, CHANGELOG, release notes, source code | anything, including statistics |\n| 2 | vendor docs, engineering blogs | narrative claims; numerics only with a Tier 1 corroborant |\n| 3 | conference talks, forum posts | context only — never a statistic |\n\n## Recency\nDefault window 18 months. Outside it -> label \"historical\" and exclude from any adoption number.\n\n## Citation format\n`[n] <title> — <url> (retrieved <date>)`, references block at the end, numbered in first-use order.\n\n## Statistic provenance\nEvery number printed in a report must resolve to a row in the run's coverage artifact. Numbers quoted from prose sources are rejected at audit.\n\nFootnote (line 188): a rendered docs site is Tier 2 even when it documents a Tier 1 artifact — the docs lag the repo." } },
    { id: "s3b", parentId: "s3", name: "anthropic.messages.create", kind: "llm", startMs: 37200, durationMs: 44000, status: "ok", tokensIn: 5100, tokensOut: 940, cost: 0.0191, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.1" }, { label: "cache_read_tokens", value: "3800" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Given the methodology tiers, write the acceptance criteria the researcher's source list must satisfy before the analyst is allowed to run.\n\nBe strict about what counts as a primary source for a spec-status claim — the rendered docs site is not the spec.", output: "Acceptance criteria for sources.jsonl:\n- >= 12 unique domains, of which >= 5 are Tier 1\n- Spec-status claims must cite the semconv repo at a pinned tag, not the docs site (docs lag the repo by ~2 releases)\n- Every framework in the coverage matrix needs either a link to its instrumentation source file, or a release note naming gen_ai.* explicitly\n- Reject: any source whose only evidence is a marketing page\n- Flag: anything older than 2024-12 -> mark historical, exclude from the adoption statistic" } },
    { id: "s3c", parentId: "s3", name: "local_workflow", kind: "workflow", startMs: 82000, durationMs: 48000, status: "ok", attributes: [{ label: "workflow.id", value: "wf_methodology_bind" }, { label: "steps", value: "2" }, { label: "persist", value: "session-scoped" }], io: { input: "Bind the methodology output into the shared scratchpad.\n\nGoal: researcher, analyst and writer must all read the same rules object, and a subagent that reads a stale one must fail loudly rather than quietly use different rules.", output: "Wrote scratch/methodology.json (tiers, recency=18mo, citation=[n]+url+date).\nRegistered 3 consumers: researcher, analyst, writer.\nContract hash: 8c41f0d — any subagent that reads a different hash hard-fails at dispatch instead of proceeding." } },
    { id: "s3c1", parentId: "s3c", name: "anthropic.messages.create", kind: "llm", startMs: 82800, durationMs: 46000, status: "ok", tokensIn: 3800, tokensOut: 580, cost: 0.0033, attributes: [{ label: "model", value: "claude-haiku-4-5-20251001" }, { label: "temperature", value: "0" }, { label: "cache_read_tokens", value: "2900" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Convert the prose methodology into a strict JSON rules object.\n\nKeys: tiers, recency_months, citation_format, statistic_provenance.\nNo prose, no trailing commentary, no markdown fence.", output: "{\n  \"tiers\": {\n    \"1\": [\"spec\", \"changelog\", \"release_notes\", \"source_code\"],\n    \"2\": [\"vendor_docs\", \"engineering_blog\"],\n    \"3\": [\"talks\", \"forums\"]\n  },\n  \"recency_months\": 18,\n  \"citation_format\": \"[n] <title> — <url> (retrieved <date>)\",\n  \"statistic_provenance\": \"coverage.csv\"\n}" } },
    { id: "s4", parentId: "s1", name: "Workflow", kind: "workflow", startMs: 132000, durationMs: 207000, status: "ok", attributes: [{ label: "workflow.name", value: "corpus_prepare" }, { label: "steps", value: "4" }, { label: "concurrency", value: "2" }], io: { input: "Prepare the working corpus before any subagent is dispatched.\n\n- check the cache for prior runs of this question\n- seed the framework list to be surveyed\n- produce the per-query retrieval plan the researcher will execute verbatim", output: "Corpus ready.\n- cache: 3 prior runs found, 1 reusable (18 days old, same semconv tag) -> 9 documents rehydrated\n- framework seed list (8): LangChain, LlamaIndex, Vercel AI SDK, Semantic Kernel, Haystack, DSPy, Pydantic AI, OpenAI Agents SDK\n- retrieval plan: 5 queries, max 8 results each, dedupe by canonical URL\nHanded off to researcher." } },
    { id: "s4a", parentId: "s4", name: "local_workflow", kind: "workflow", startMs: 132600, durationMs: 205600, status: "ok", attributes: [{ label: "workflow.id", value: "wf_corpus_2f81" }, { label: "cache.hit", value: "true" }, { label: "documents.rehydrated", value: "9" }], io: { input: "Step 1/4: cache lookup by question hash.\nStep 2/4: triage rehydrated docs for staleness against the current semconv tag.\nStep 3/4: index the survivors into a run-scoped store.\nStep 4/4: emit the retrieval plan.", output: "9 docs rehydrated -> 6 survived staleness triage (3 predated semconv v1.29 and described attributes that have since moved).\nIndexed 6 docs into the run-scoped store (index_id=idx_2f81, 412 chunks).\nRetrieval plan emitted: 5 queries, each with a stop condition and a result budget." } },
    { id: "s4a1", parentId: "s4a", name: "db.query", kind: "db", startMs: 133000, durationMs: 2400, status: "ok", attributes: [{ label: "db.system", value: "postgresql" }, { label: "db.statement", value: "SELECT doc_id, url, fetched_at FROM research_cache WHERE question_hash = $1 AND fetched_at > now() - interval '30 days'" }, { label: "rows", value: "9" }, { label: "db.name", value: "causal_research" }], io: { input: "SELECT doc_id, url, fetched_at\n  FROM research_cache\n WHERE question_hash = $1\n   AND fetched_at > now() - interval '30 days'\n ORDER BY fetched_at DESC\n\n$1 = 'qh_4c7e21a0'  -- sha1 of the normalized research question\n\nThe 30-day SQL bound is deliberately looser than the 18-month methodology window: staleness here is measured against the semconv tag, not the calendar, so the rows are triaged downstream rather than filtered in the query.", output: "9 rows (0.0024s, index scan on research_cache_question_hash_idx):\n\ndoc_id     fetched_at   url\nd_8831     2026-07-24   github.com/open-telemetry/semantic-conventions @ v1.30.0\nd_8832     2026-07-24   .../semantic-conventions/CHANGELOG.md\nd_8834     2026-07-24   github.com/open-telemetry/opentelemetry-python-contrib/.../instrumentation/openai\nd_8839     2026-06-11   ai-sdk.dev/docs/ai-sdk-core/telemetry\nd_8841     2026-06-11   docs.datadoghq.com/llm_observability/setup/sdk\nd_8845     2026-06-11   github.com/langchain-ai/langchain/releases\nd_8802     2024-08-30   blog post — gen_ai.prompt as a span attribute\nd_8803     2024-05-12   conference talk transcript\nd_8811     2026-02-02   vendor comparison landing page\n\n3 prior runs matched the hash; 1 (2026-07-24, same semconv tag) is reusable." } },
    { id: "s4a2", parentId: "s4a", name: "anthropic.messages.create", kind: "llm", startMs: 136000, durationMs: 62000, status: "ok", tokensIn: 6400, tokensOut: 1060, cost: 0.0235, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.2" }, { label: "cache_read_tokens", value: "4300" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Triage these 9 cached documents against the 18-month recency window and the current semconv tag (v1.30.0).\n\nFor each: KEEP or DROP with a one-line reason.\nDrop anything describing gen_ai.* attributes that have since been renamed or moved to events — stale shape is worse than no source.", output: "KEEP  semantic-conventions repo @ v1.30.0 — primary, current\nKEEP  semconv CHANGELOG v1.27..v1.30 — records the prompt->event migration\nKEEP  opentelemetry-python-contrib instrumentation source — shows what is emitted vs specified\nKEEP  Vercel AI SDK telemetry docs (2026-03) — in window\nKEEP  Datadog LLM Obs mapping table (2026-01) — in window\nKEEP  LangChain OTel exporter notes (2026-02)\nDROP  blog post (2024-08) — predates v1.29, uses gen_ai.prompt as a span attribute\nDROP  talk transcript (2024-05) — Tier 3 and historical\nDROP  vendor comparison page — marketing only" } },
    { id: "s4a3", parentId: "s4a", name: "POST /api/v1/index/upsert", kind: "http", startMs: 198600, durationMs: 4200, status: "ok", attributes: [{ label: "http.status_code", value: "200" }, { label: "chunks", value: "412" }, { label: "index_id", value: "idx_2f81" }, { label: "request.bytes", value: "1841203" }], io: { input: "POST /api/v1/index/upsert  (1,841,203 bytes)\ncontent-type: application/json\nidempotency-key: idx_2f81-run1\n\n{\n  \"index_id\": \"idx_2f81\",\n  \"scope\": \"run\",\n  \"chunk_size\": 1200,\n  \"chunk_overlap\": 150,\n  \"embed_model\": \"text-embedding-3-large\",\n  \"documents\": [ 6 survivors of the staleness triage, full text + source metadata (tier, fetched_at, canonical_url) ]\n}", output: "200 OK (4.2s)\n\n{\n  \"index_id\": \"idx_2f81\",\n  \"chunks_written\": 412,\n  \"chunks_skipped\": 0,\n  \"documents\": 6,\n  \"dims\": 3072,\n  \"ttl_seconds\": 86400,\n  \"scope\": \"run\"\n}\n\nRun-scoped: the index is discarded at run end so a later run cannot silently inherit this corpus." } },
    { id: "s4a4", parentId: "s4a", name: "Agent", kind: "agent", startMs: 203400, durationMs: 134000, status: "ok", attributes: [{ label: "subagent_type", value: "planner" }, { label: "model", value: "claude-sonnet-4-5" }, { label: "turns", value: "2" }, { label: "tools", value: "Grep, Read" }], io: { input: "You are the planner subagent.\n\nUsing the 6 indexed documents and the 8-framework seed list, write the exact search queries the researcher will run — plus, for each, the stop condition that says what evidence ends that query. The researcher is not allowed to reformulate them.", output: "Queries locked:\n1. \"opentelemetry gen_ai semantic conventions v1.30 span attributes\" — stop when the attribute table is retrieved at a pinned tag\n2. \"gen_ai.usage.input_tokens output_tokens instrumentation support\" — stop at 3 independent SDK confirmations\n3. \"opentelemetry genai events prompt completion migration v1.27\" — stop when the CHANGELOG entry is found\n4. \"langchain llamaindex vercel ai sdk opentelemetry gen_ai attributes 2026\" — stop at 6 of 8 frameworks covered\n5. \"langsmith datadog llm observability opentelemetry compatibility\" — stop at 2 vendor mapping tables" } },
    { id: "s4a4a", parentId: "s4a4", name: "anthropic.messages.create", kind: "llm", startMs: 204000, durationMs: 62000, status: "ok", tokensIn: 6000, tokensOut: 1120, cost: 0.0232, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.3" }, { label: "cache_read_tokens", value: "4300" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Draft candidate search queries covering:\n- the spec surface\n- token accounting\n- the prompt/completion event migration\n- per-framework adoption\n- vendor interop\n\nScore each for primary-source yield. Reject anything that will return marketing pages.", output: "Candidates (12), scored for primary-source yield:\n0.91  opentelemetry gen_ai semantic conventions v1.30 span attributes\n0.88  gen_ai.usage.input_tokens output_tokens instrumentation support\n0.86  opentelemetry genai events prompt completion migration v1.27\n0.79  langchain llamaindex vercel ai sdk opentelemetry gen_ai attributes 2026\n0.74  langsmith datadog llm observability opentelemetry compatibility\n0.41  best llm observability tools 2026  <- rejected, marketing-heavy\n\nTake the top 5. Queries 1 and 3 must hit the repo, not the docs site." } },
    { id: "s4a4b", parentId: "s4a4", name: "anthropic.messages.create", kind: "llm", startMs: 267000, durationMs: 68000, status: "ok", tokensIn: 6400, tokensOut: 1200, cost: 0.0264, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.2" }, { label: "cache_read_tokens", value: "4000" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Attach a stop condition and a result budget to each of the 5 selected queries.\n\nEmit the retrieval plan as JSON the researcher can execute without any further planning turn.", output: "{\n  \"queries\": [\n    {\"id\": \"q1\", \"max_results\": 8, \"stop\": \"attribute table at pinned tag\"},\n    {\"id\": \"q2\", \"max_results\": 8, \"stop\": \"3 independent SDK confirmations\"},\n    {\"id\": \"q3\", \"max_results\": 6, \"stop\": \"CHANGELOG entry located\"},\n    {\"id\": \"q4\", \"max_results\": 10, \"stop\": \"6 of 8 frameworks covered\"},\n    {\"id\": \"q5\", \"max_results\": 8, \"stop\": \"2 vendor mapping tables\"}\n  ],\n  \"dedupe\": \"canonical_url\",\n  \"parallel\": true,\n  \"reformulation\": \"forbidden\"\n}" } },
    { id: "s6", parentId: "s1", name: "Agent", kind: "agent", startMs: 340000, durationMs: 178000, status: "ok", attributes: [{ label: "subagent_type", value: "researcher" }, { label: "model", value: "claude-sonnet-4-5" }, { label: "searches", value: "5" }, { label: "sources.kept", value: "17 of 34" }], io: { input: "You are the researcher subagent.\n\nExecute the 5 queries in scratch/plan.json in a single parallel block.\nObey scratch/methodology.json: Tier 1 sources for any spec-status or numeric claim, 18-month recency window.\nReturn a claims table where every row carries a source id, a tier, and a verbatim quote.", output: "34 results across 5 parallel searches; 17 kept after dedupe + tier/recency filtering (11 domains, 6 Tier 1).\n\nClaims table (excerpt):\nC1  gen_ai semconv is Development status at v1.30.0  [S1 T1]\nC3  prompts+completions moved from attributes to events in v1.27  [S3 T1]\nC4  token attrs are gen_ai.usage.input_tokens / .output_tokens  [S1,S4 T1]\nC5  no standardized cost attribute exists  [S1,S9]\nC6  most surveyed frameworks emit the required attrs  [S5..S12] — provisional\n\nUNRESOLVED: DSPy emits partial attrs behind a flag; needs code-level confirmation by the analyst." } },
    { id: "s6a", parentId: "s6", name: "anthropic.messages.create", kind: "llm", startMs: 340600, durationMs: 24000, status: "ok", tokensIn: 2600, tokensOut: 520, cost: 0.0029, attributes: [{ label: "model", value: "claude-haiku-4-5-20251001" }, { label: "temperature", value: "0" }, { label: "cache_read_tokens", value: "1800" }, { label: "stop_reason", value: "tool_use" }], io: { input: "Read scratch/plan.json and issue all 5 searches in one parallel tool block.\n\nDo not reformulate the queries — they are scored and locked upstream. Collate only after all five return.", output: "Issuing 5 WebSearch calls in a single block (parallel):\n- q1 spec surface (max 8)\n- q2 token accounting (max 8)\n- q3 event migration (max 6)\n- q4 framework adoption (max 10)\n- q5 vendor interop (max 8)\n\nDedupe key: canonical_url. Collation deferred until the last search returns." } },
    { id: "s6b", parentId: "s6", name: "WebSearch", kind: "search", startMs: 365200, durationMs: 9400, status: "ok", attributes: [{ label: "query", value: "opentelemetry gen_ai semantic conventions v1.30 span attributes" }, { label: "results", value: "8" }, { label: "provider", value: "brave" }, { label: "top_domain", value: "github.com/open-telemetry/semantic-conventions" }], io: { input: "q1 (locked, no reformulation): \"opentelemetry gen_ai semantic conventions v1.30 span attributes\"\nmax_results=8, dedupe=canonical_url\nStop condition: the normative attribute table retrieved at a pinned tag — the rendered docs site does not satisfy it.", output: "8 results. Stop condition met by result 1.\n\n1. semantic-conventions/docs/gen-ai/gen-ai-spans.md @ v1.30.0 — github.com — the normative table: Required = gen_ai.operation.name, gen_ai.system, gen_ai.request.model; Recommended = request.temperature/top_p/max_tokens, response.model, response.finish_reasons\n2. semantic-conventions/docs/gen-ai/README.md @ v1.30.0 — \"Status: Development\"\n3. opentelemetry.io/docs/specs/semconv/gen-ai/ — rendered docs, Tier 2, currently rendering v1.28\n4. semantic-conventions/CHANGELOG.md — v1.27 through v1.30 entries\n5. open-telemetry/semantic-conventions issue #1234 — naming debate on gen_ai.provider.name\n6-8. mirrors and package re-exports — deduped by canonical URL" } },
    { id: "s6b1", parentId: "s6b", name: "GET /res/v1/web/search", kind: "http", startMs: 365600, durationMs: 6900, status: "ok", attributes: [{ label: "http.status_code", value: "200" }, { label: "http.host", value: "api.search.brave.com" }, { label: "response.bytes", value: "94218" }, { label: "retry.count", value: "0" }], io: { input: "GET https://api.search.brave.com/res/v1/web/search?q=opentelemetry+gen_ai+semantic+conventions+v1.30+span+attributes&count=8&freshness=py&result_filter=web\naccept: application/json\nx-subscription-token: <redacted>", output: "200 OK — 94,218 bytes, 6.9s\nx-ratelimit-remaining: 47\n\n{\"web\": {\"results\": [8 items]}}\nTop result: github.com/open-telemetry/semantic-conventions/blob/v1.30.0/docs/gen-ai/gen-ai-spans.md\nNo retries; no results suppressed by the freshness filter." } },
    { id: "s6c", parentId: "s6", name: "WebSearch", kind: "search", startMs: 365400, durationMs: 7800, status: "ok", attributes: [{ label: "query", value: "gen_ai.usage.input_tokens output_tokens instrumentation support" }, { label: "results", value: "8" }, { label: "provider", value: "brave" }, { label: "tier1_hits", value: "3" }], io: { input: "q2 (locked): \"gen_ai.usage.input_tokens output_tokens instrumentation support\"\nmax_results=8, dedupe=canonical_url\nStop condition: 3 independent SDK confirmations that the attributes are actually emitted (source code or release notes — not a docs page describing intent).", output: "8 results, 3 Tier 1 hits — stop condition met.\n\n1. opentelemetry-python-contrib .../instrumentation/openai/patch.py — sets gen_ai.usage.input_tokens / output_tokens from the response usage block (T1)\n2. opentelemetry-js-contrib instrumentation-langchain CHANGELOG — \"emit gen_ai.usage.* on LLM spans\" (T1)\n3. Vercel AI SDK telemetry docs — records ai.usage.promptTokens and maps to gen_ai.usage.input_tokens at export (T1 release notes linked)\n4. semantic-conventions gen-ai-metrics.md — the same names on the metric side\n5-8. blog restatements, no new evidence — dropped at collation" } },
    { id: "s6d", parentId: "s6", name: "WebSearch", kind: "search", startMs: 365800, durationMs: 11200, status: "warn", attributes: [{ label: "query", value: "opentelemetry genai events prompt completion migration v1.27" }, { label: "results", value: "6" }, { label: "provider", value: "brave" }, { label: "warning", value: "2 results behind paywall, excluded from corpus" }], io: { input: "q3 (locked): \"opentelemetry genai events prompt completion migration v1.27\"\nmax_results=6, dedupe=canonical_url\nStop condition: the CHANGELOG entry that states the move as a breaking change.", output: "6 results, stop condition met by result 1 — but WARN: 2 results sit behind a paywall and were excluded from the corpus rather than cited from their abstracts.\n\n1. semantic-conventions/CHANGELOG.md v1.27.0 (T1) — \"gen_ai.prompt and gen_ai.completion span attributes are deprecated in favour of gen_ai.content.prompt / gen_ai.content.completion events\" — this is the only place the move is stated as breaking\n2. gen-ai-events.md @ v1.30.0 (T1) — the event bodies that replaced the attributes\n3. python-contrib PR implementing the event emitter (T1)\n4. opentelemetry.io blog post on the migration (T2)\n5. PAYWALLED — excluded (methodology forbids citing an abstract as evidence)\n6. PAYWALLED — excluded\n\nEffective corpus contribution: 4 of 6." } },
    { id: "s6f", parentId: "s6", name: "WebSearch", kind: "search", startMs: 366200, durationMs: 8600, status: "ok", attributes: [{ label: "query", value: "langchain llamaindex vercel ai sdk opentelemetry gen_ai attributes 2026" }, { label: "results", value: "10" }, { label: "provider", value: "brave" }, { label: "frameworks_covered", value: "7 of 8" }], io: { input: "q4 (locked): \"langchain llamaindex vercel ai sdk opentelemetry gen_ai attributes 2026\"\nmax_results=10, dedupe=canonical_url\nStop condition: 6 of the 8 seeded frameworks covered by at least one instrumentation source or release note.", output: "10 results, 7 of 8 frameworks covered — stop condition met, one gap left open.\n\nCovered: LangChain (exporter release notes, 2026-02), LlamaIndex (instrumentation module), Vercel AI SDK (telemetry docs + changelog), Semantic Kernel (OTel connector source), Haystack (tracing integration), Pydantic AI (logfire/OTel span docs), OpenAI Agents SDK (tracing processor source)\n\nNOT covered: DSPy — only hits are a forum thread and a flag mention in a README; nothing states what is emitted by default. Carried forward as UNRESOLVED for the analyst to settle from source." } },
    { id: "s6g", parentId: "s6", name: "WebSearch", kind: "search", startMs: 366600, durationMs: 12400, status: "ok", attributes: [{ label: "query", value: "langsmith datadog llm observability opentelemetry compatibility" }, { label: "results", value: "8" }, { label: "provider", value: "brave" }, { label: "mapping_tables_found", value: "2" }], io: { input: "q5 (locked): \"langsmith datadog llm observability opentelemetry compatibility\"\nmax_results=8, dedupe=canonical_url\nStop condition: 2 vendor mapping tables that name gen_ai.* fields explicitly (a prose \"we support OTel\" claim does not count).", output: "8 results, both mapping tables found.\n\n1. Datadog LLM Observability — OTel span-to-field mapping table (T2, 2026-01): gen_ai.request.model -> @meta.model_name, gen_ai.usage.input_tokens -> @metrics.input_tokens; top_k and finish_reasons absent from the table\n2. LangSmith OTel ingest reference (T2, 2026-02): accepts gen_ai.* on /otel/v1/traces, maps runs by span name, adds its own feedback and dataset fields with no OTel equivalent\n3. Datadog docs on time-to-first-token (T2) — logs TTFT under a latency label OTel reserves for full duration; flagged as a semantic mismatch\n4-8. marketing comparison pages — rejected per methodology (marketing-only evidence)" } },
    { id: "s6e", parentId: "s6", name: "anthropic.messages.create", kind: "llm", startMs: 379800, durationMs: 44000, status: "ok", tokensIn: 7400, tokensOut: 1010, cost: 0.0236, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.2" }, { label: "cache_read_tokens", value: "5100" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Collate the 34 search results.\n\n- dedupe by canonical URL\n- assign a tier per scratch/methodology.json\n- drop anything outside the 18-month window\n- for each survivor, state what it uniquely proves (if nothing, drop it)", output: "34 -> 21 after dedupe -> 17 after tier/recency filtering (11 domains).\n\nS1  semantic-conventions @ v1.30.0 (T1) — the normative attribute tables; only source for required vs recommended\nS3  semconv CHANGELOG v1.27 (T1) — only place the prompt->event move is stated as breaking\nS4  python-contrib instrumentation (T1) — proves what is actually emitted vs specified\nS9  Datadog LLM Obs mapping table (T2) — vendor-side field mapping\nS12 LangChain exporter release notes (T1) — version + date for gen_ai.* support\n\nDropped: 4 on recency, 2 paywalled, 11 duplicates." } },
    { id: "s6i", parentId: "s6", name: "anthropic.messages.create", kind: "llm", startMs: 424600, durationMs: 48000, status: "ok", tokensIn: 8200, tokensOut: 1250, cost: 0.0315, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.2" }, { label: "cache_read_tokens", value: "4400" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Build the claims table: one row per factual claim the report may rely on.\n\nColumns: claim id, statement, source ids, tier, verbatim supporting quote, confidence.\nMark anything you could not corroborate as UNRESOLVED. Do not paper over a gap with a hedge.", output: "C1  gen_ai semconv is Development at v1.30.0  [S1 T1] \"Status: Development\"  conf=high\nC2  Required on inference spans: gen_ai.operation.name, gen_ai.system, gen_ai.request.model  [S1 T1]  conf=high\nC3  Prompts/completions became events in v1.27; the attribute form is deprecated  [S3 T1]  conf=high\nC4  Tokens: gen_ai.usage.input_tokens / .output_tokens  [S1,S4 T1]  conf=high\nC5  No normative cost attribute  [S1,S9]  conf=high\nC6  7 of 8 frameworks emit the required attrs  [S5,S12]  conf=medium\n\nUNRESOLVED  DSPy: attrs present only behind OTEL_GENAI_ENABLED — needs code-level confirmation." } },
    { id: "s6j", parentId: "s6", name: "Skill", kind: "skill", startMs: 473400, durationMs: 36000, status: "ok", attributes: [{ label: "skill.name", value: "citation-audit" }, { label: "skill.version", value: "0.9.3" }, { label: "claims.checked", value: "6" }], io: { input: "Audit the claims table before it leaves the researcher.\n\nRule: every numeric or spec-status claim must resolve to a Tier 1 source with a verbatim quote. Reject any row that rests on a Tier 2 source alone.", output: "6 claims audited, 5 pass.\n\nC6 (\"7 of 8 frameworks emit the required attrs\") FAILS the Tier 1 rule — it currently rests on vendor docs.\nAction: downgrade C6 to provisional and require the analyst to confirm each framework against its instrumentation source before the writer may state a number.\nThe DSPy UNRESOLVED row is carried forward untouched." } },
    { id: "s6j1", parentId: "s6j", name: "anthropic.messages.create", kind: "llm", startMs: 474000, durationMs: 34000, status: "ok", tokensIn: 4200, tokensOut: 640, cost: 0.0035, attributes: [{ label: "model", value: "claude-haiku-4-5-20251001" }, { label: "temperature", value: "0" }, { label: "cache_read_tokens", value: "3300" }, { label: "stop_reason", value: "end_turn" }], io: { input: "For each claim row, check that the cited source tier satisfies the methodology rule for that claim type.\n\nOutput PASS/FAIL per row with the rule id that was applied. No rewriting.", output: "C1 PASS — spec-status requires T1; cited S1 (repo @ tag)\nC2 PASS — normative attribute list requires T1; cited S1\nC3 PASS — breaking-change claim requires a T1 CHANGELOG; cited S3\nC4 PASS — attribute naming requires T1; cited S1 + S4\nC5 PASS — negative claim; T1 absence corroborated by S9\nC6 FAIL — any statistic requires T1 evidence per framework; cited S5 (T2) only" } },
    { id: "s7", parentId: "s1", name: "Agent", kind: "agent", startMs: 519000, durationMs: 178000, status: "ok", attributes: [{ label: "subagent_type", value: "analyst" }, { label: "model", value: "claude-sonnet-4-5" }, { label: "tools", value: "Bash, Read" }, { label: "recovered_failures", value: "1" }], io: { input: "You are the analyst subagent.\n\nTurn the researcher's provisional C6 into a defensible statistic. For each of the 8 frameworks confirm from the instrumentation source whether it emits (a) the 3 required attrs, (b) token usage attrs, (c) any cost attr.\n\nCompute coverage percentages, write coverage.csv, and resolve the DSPy UNRESOLVED row.", output: "coverage.csv written (8 rows, 4 columns).\n\nRequired-attr coverage: 6/8 = 75.0%\nToken-attr coverage:    7/8 = 87.5%\nCost-attr coverage:     2/8 = 25.0%\n\nDSPy resolved: emits gen_ai.* only when OTEL_GENAI_ENABLED=1, so it counts as not emitting by default — this is the row that moves C6 from 7/8 to 6/8.\n\nOne script failure (ZeroDivisionError on an empty partition) was diagnosed and fixed before any number was produced." } },
    { id: "s7a", parentId: "s7", name: "anthropic.messages.create", kind: "llm", startMs: 519600, durationMs: 26000, status: "ok", tokensIn: 4600, tokensOut: 790, cost: 0.0165, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.1" }, { label: "cache_read_tokens", value: "3400" }, { label: "stop_reason", value: "tool_use" }], io: { input: "Plan the computation before running anything.\n\nThe claims table gives per-framework evidence links; you need three coverage percentages plus a per-framework matrix. State what the script must do and — just as important — what it must refuse to do.", output: "Script contract (scripts/analyze_otel_adoption.py):\n- input: scratch/claims.jsonl, one row per framework/attribute-group observation\n- partition by framework, then by attribute group (required | usage | cost)\n- a framework covers a group only if the evidence tier is 1\n- output: coverage.csv plus three aggregates, rounded to 1dp\n- MUST NOT infer coverage from absence of evidence; unknown is excluded from the denominator and reported separately\n\nRunning it over the 17-source corpus now." } },
    { id: "s7b", parentId: "s7", name: "Bash", kind: "shell", startMs: 546200, durationMs: 3400, status: "error", attributes: [{ label: "command", value: "python3 scripts/analyze_otel_adoption.py --input scratch/claims.jsonl --out coverage.csv" }, { label: "exit_code", value: "1" }, { label: "cwd", value: "/workspace/research" }, { label: "stderr.bytes", value: "412" }], io: { input: "$ cd /workspace/research\n$ python3 scripts/analyze_otel_adoption.py --input scratch/claims.jsonl --out coverage.csv\n\nFirst run of the coverage computation over the 17-source corpus: 8 frameworks x 3 attribute groups (required | usage | cost), Tier 1 evidence only.", output: "stdout:\nloaded 41 observations from scratch/claims.jsonl\npartition required: 8 frameworks\npartition usage: 8 frameworks\npartition cost: 2 frameworks\n\nstderr (412 bytes):\nTraceback (most recent call last):\n  File \"scripts/analyze_otel_adoption.py\", line 63, in <module>\n    main()\n  File \"scripts/analyze_otel_adoption.py\", line 55, in main\n    aggregates = {g: compute_coverage(part[g]) for g in GROUPS}\n  File \"scripts/analyze_otel_adoption.py\", line 47, in compute_coverage\n    return round(100.0 * covered / len(rows), 1)\nZeroDivisionError: division by zero\n\nexit 1 — coverage.csv was not created (the writer runs after the aggregates, so no partial output landed on disk)." }, git: { file: "scripts/analyze_otel_adoption.py", line: 47, commit: "3f9c1ab" }, error: "Command failed with exit code 1\nTraceback (most recent call last):\n  File \"scripts/analyze_otel_adoption.py\", line 47, in compute_coverage\n    return round(100.0 * covered / len(rows), 1)\nZeroDivisionError: division by zero" },
    { id: "s7c", parentId: "s7", name: "Read", kind: "tool", startMs: 550200, durationMs: 1100, status: "ok", attributes: [{ label: "file.path", value: "scripts/analyze_otel_adoption.py" }, { label: "range", value: "30-60" }, { label: "lines", value: "31" }], io: { input: "Read scripts/analyze_otel_adoption.py lines 30-60 — the partition builder and compute_coverage(), i.e. everything between where the rows are grouped and where line 47 divides.", output: "  38  def partition(observations):\n  39      part = {g: [] for g in GROUPS}\n  40      for obs in observations:\n  41          if obs[\"tier\"] == 1:\n  42              part[obs[\"group\"]].append(obs)\n  43      return part\n  44\n  45  def compute_coverage(rows):\n  46      covered = sum(1 for r in rows if r[\"emits\"])\n  47      return round(100.0 * covered / len(rows), 1)\n  48\n  49  def main():\n  50      observations = load(ARGS.input)\n  51      part = partition(observations)\n  52      aggregates = {g: compute_coverage(part[g]) for g in GROUPS}\n\nNote: partition() only appends Tier 1 observations, so a group with no Tier 1 evidence produces an empty list — which is exactly the 'cost' case, and it reaches line 47 unguarded." } },
    { id: "s7d", parentId: "s7", name: "anthropic.messages.create", kind: "llm", startMs: 552000, durationMs: 19000, status: "ok", tokensIn: 3900, tokensOut: 700, cost: 0.0144, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0" }, { label: "cache_read_tokens", value: "2900" }, { label: "stop_reason", value: "end_turn" }], io: { input: "The script died at line 47 with ZeroDivisionError. Lines 30-60 are attached.\n\nExplain the actual cause, not the symptom, and give the minimal fix that preserves the \"unknown is not zero\" rule from the script contract.", output: "Cause: compute_coverage() is called once per attribute group after partitioning. The 'cost' partition is legitimately empty for 6 of 8 frameworks, so len(rows) == 0 reaches the division at line 47. The bug is not the division — it is that empty partitions are passed in at all, which would also silently violate the \"unknown -> excluded from denominator\" rule.\n\nMinimal fix:\n  if not rows:\n      return None  # reported as 'no evidence', never as 0.0\n\nLet the caller print 'n/a' for that cell. Re-run with the same input so the numbers stay comparable." } },
    { id: "s7e", parentId: "s7", name: "Bash", kind: "shell", startMs: 571600, durationMs: 38000, status: "ok", attributes: [{ label: "command", value: "python3 scripts/analyze_otel_adoption.py --input scratch/claims.jsonl --out coverage.csv --strict-unknown" }, { label: "exit_code", value: "0" }, { label: "rows_written", value: "8" }, { label: "stdout.tail", value: "required=75.0% usage=87.5% cost=25.0% unknown_cells=6" }], io: { input: "$ python3 scripts/analyze_otel_adoption.py --input scratch/claims.jsonl --out coverage.csv --strict-unknown\n\nRe-run after the guard was added at line 47. Same input file as the failed run so the numbers stay comparable; --strict-unknown makes an empty partition report 'no evidence' instead of 0.0 and keeps it out of the denominator.", output: "loaded 41 observations from scratch/claims.jsonl (tier-1 only: 34)\nresolved dspy: OTEL_GENAI_ENABLED gate -> emits=false by default\nwrote coverage.csv (8 rows)\n\nrequired: 6/8 covered\nusage:    7/8 covered\ncost:     2/8 covered, 6 cells no-evidence (excluded from the covered/total ratio's numerator, reported separately)\n\nrequired=75.0% usage=87.5% cost=25.0% unknown_cells=6\nexit 0" } },
    { id: "s7f", parentId: "s7", name: "local_workflow", kind: "workflow", startMs: 610200, durationMs: 52000, status: "ok", attributes: [{ label: "workflow.id", value: "wf_gap_analysis" }, { label: "steps", value: "2" }, { label: "comparators", value: "LangSmith, Datadog LLM Observability" }], io: { input: "Run the vendor gap analysis.\n\nStep 1: load the stored field mappings for LangSmith and Datadog LLM Observability.\nStep 2: diff them field-by-field against the gen_ai.* attribute set and classify each row as mapped, OTel-only, vendor-only, or semantic mismatch.", output: "Diff complete: 22 OTel fields, 19 mapped by at least one vendor.\n\nBoth vendors carry fields OTel has no equivalent for: evaluation scores, feedback/annotation payloads, dataset+experiment linkage.\nOTel-only: gen_ai.operation.name as a first-class dimension (vendors infer it from the span name).\nThe cost gap is symmetric — neither the spec nor the vendors emit cost; both compute it at ingest." } },
    { id: "s7f1", parentId: "s7f", name: "db.query", kind: "db", startMs: 610800, durationMs: 2200, status: "ok", attributes: [{ label: "db.system", value: "postgresql" }, { label: "db.statement", value: "SELECT vendor, otel_field, vendor_field, notes FROM vendor_field_map WHERE vendor = ANY($1)" }, { label: "rows", value: "44" }, { label: "db.name", value: "causal_research" }], io: { input: "SELECT vendor, otel_field, vendor_field, notes\n  FROM vendor_field_map\n WHERE vendor = ANY($1)\n ORDER BY vendor, otel_field\n\n$1 = '{langsmith,datadog_llm_obs}'\n\nStored mappings, last refreshed from the two vendor mapping tables found by q5.", output: "44 rows (0.0022s) — 22 OTel fields x 2 vendors.\n\nvendor          otel_field                      vendor_field           notes\ndatadog_llm_obs gen_ai.request.model            @meta.model_name       exact\ndatadog_llm_obs gen_ai.usage.input_tokens       @metrics.input_tokens  cached tokens included\ndatadog_llm_obs gen_ai.request.top_k            (null)                 dropped at ingest\ndatadog_llm_obs gen_ai.response.finish_reasons  @meta.finish_reason    array flattened to scalar\ndatadog_llm_obs gen_ai.operation.name           (null)                 inferred from span name\nlangsmith       gen_ai.usage.input_tokens       usage.prompt_tokens    cached counted separately\nlangsmith       gen_ai.operation.name           (null)                 inferred from run type\nlangsmith       (null)                          feedback.score         vendor-only\nlangsmith       (null)                          dataset_id/example_id  vendor-only\n... 35 more rows" } },
    { id: "s7f2", parentId: "s7f", name: "anthropic.messages.create", kind: "llm", startMs: 613600, durationMs: 47000, status: "ok", tokensIn: 6300, tokensOut: 1120, cost: 0.0233, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.2" }, { label: "cache_read_tokens", value: "4600" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Here are 44 vendor field-mapping rows.\n\nProduce the gap memo:\n- gen_ai.* fields with no vendor equivalent\n- vendor fields with no OTel equivalent\n- fields that map by name but not by meaning", output: "OTel has, vendors lack (3):\n- gen_ai.operation.name — both infer it from the span name, so mixed-operation spans collapse\n- gen_ai.request.top_k — dropped at ingest\n- gen_ai.response.finish_reasons — array flattened to scalar\n\nVendors have, OTel lacks (3): evaluation scores, human feedback, dataset+experiment linkage — why teams still run a proprietary backend next to OTel.\n\nSemantic mismatch (2):\n- latency: OTel duration runs to completion; one vendor logs time-to-first-token under that label\n- tokens: cached input counted inside input_tokens by one, apart by the other — 6-18% drift" } },
    { id: "s7h", parentId: "s7", name: "anthropic.messages.create", kind: "llm", startMs: 663000, durationMs: 33000, status: "ok", tokensIn: 5400, tokensOut: 920, cost: 0.0192, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.2" }, { label: "cache_read_tokens", value: "4000" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Write the analyst memo for the writer.\n\nInclude: the three coverage percentages with their denominators, the DSPy resolution, the gap list, and an explicit statement of what these numbers do NOT support.", output: "ANALYST MEMO\n\nCoverage (denominator = 8 surveyed frameworks, Tier 1 evidence only):\n- 3 required attrs: 6/8 = 75.0%\n- token usage attrs: 7/8 = 87.5%\n- any cost attr: 2/8 = 25.0% (6 cells are 'no evidence', not zero)\n\nDSPy emits gen_ai.* only under OTEL_GENAI_ENABLED=1, so it counts as not emitting by default. That single row moves required-attr coverage from 7/8 to 6/8 — say so in the report.\n\nDo NOT write \"75% of the ecosystem\": the denominator is 8 hand-picked frameworks, not a census. Write \"6 of the 8 frameworks surveyed\"." } },
    { id: "s8", parentId: "s1", name: "Agent", kind: "agent", startMs: 698000, durationMs: 178000, status: "ok", attributes: [{ label: "subagent_type", value: "writer" }, { label: "model", value: "claude-sonnet-4-5" }, { label: "target_words", value: "1200" }, { label: "citations", value: "17" }], io: { input: "You are the writer subagent.\n\nUsing the researcher's claims table and the analyst memo, write the final markdown report answering \"What are the key features of OpenTelemetry for AI observability?\"\n\nRequired: H1 + H2 sections, bullets, one statistics table, inline [n] citations, and the analyst's denominator caveat stated in the body — not a footnote.", output: "Delivered reports/otel-ai-observability.md — 1,284 words, 5 sections, 1 statistics table, 17 inline citations.\n\n# OpenTelemetry for AI Observability — Key Features\n## 1. What the GenAI semantic conventions standardize\n## 2. The 2026 attribute surface: required vs recommended\n## 3. Adoption across the 8 frameworks surveyed\n## 4. Where OTel stops and proprietary backends begin\n## 5. Practical guidance\n\nEvery statistic is written as \"n of 8 surveyed\"; no claim survives without a [n] citation." } },
    { id: "s8a", parentId: "s8", name: "anthropic.messages.create", kind: "llm", startMs: 698600, durationMs: 28000, status: "ok", tokensIn: 3400, tokensOut: 680, cost: 0.0036, attributes: [{ label: "model", value: "claude-haiku-4-5-20251001" }, { label: "temperature", value: "0.3" }, { label: "cache_read_tokens", value: "2600" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Outline the report: five sections, each with the claim ids it will use and a word budget.\n\nThe statistics table belongs to exactly one section — say which.", output: "1. What the conventions standardize — C1, C2 — 220w\n2. The attribute surface (required vs recommended, events vs attributes) — C2, C3, C4, C5 — 320w\n3. Adoption across the 8 surveyed frameworks — C6 + coverage.csv — 300w — TABLE HERE\n4. Where OTel stops and vendors begin — gap memo — 280w\n5. Practical guidance — derived, no new claims — 160w\n\nTotal 1,280w. Section 3 is the only place a number may appear citing coverage.csv rather than the spec." } },
    { id: "s8b", parentId: "s8", name: "Read", kind: "tool", startMs: 727200, durationMs: 1200, status: "ok", attributes: [{ label: "file.path", value: "coverage.csv" }, { label: "rows", value: "8" }, { label: "bytes", value: "612" }], io: { input: "Read coverage.csv — the writer may not restate a number from the analyst memo's prose; every figure in the statistics table has to come from this file.", output: "framework,required_attrs,token_attrs,cost_attr,evidence_tier\nlangchain,3/3,yes,custom,1\nllamaindex,3/3,yes,no-evidence,1\nvercel-ai-sdk,3/3,yes,custom,1\nsemantic-kernel,3/3,yes,no-evidence,1\nhaystack,2/3,yes,no-evidence,1\ndspy,0/3 (OTEL_GENAI_ENABLED gate),no,no-evidence,1\npydantic-ai,3/3,yes,no-evidence,1\nopenai-agents-sdk,3/3,yes,no-evidence,1\n\n612 bytes / 8 data rows. Derived aggregates: required 6/8 (haystack is 2/3, dspy gated off), usage 7/8 (dspy only), cost 2/8 with 6 no-evidence cells." } },
    { id: "s8c", parentId: "s8", name: "anthropic.messages.create", kind: "llm", startMs: 729000, durationMs: 66000, status: "ok", tokensIn: 7000, tokensOut: 1850, cost: 0.039, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.4" }, { label: "cache_read_tokens", value: "3600" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Draft sections 1-3 from the outline.\n\nUse the claims table for every factual sentence and coverage.csv for every number. Never write a percentage without its denominator in the same sentence or table header.", output: "# OpenTelemetry for AI Observability — Key Features\n\n## 1. What the conventions standardize\nStill **Development** at v1.30.0 [1], but the names have held for three releases; the churn moved to *where* data lives.\n\n- Required on inference spans: `gen_ai.operation.name`, `gen_ai.system`, `gen_ai.request.model` [1]\n- Tokens: `gen_ai.usage.input_tokens` / `.output_tokens` [1][4]\n- Payloads became events, not attributes, in v1.27 [3]\n\n| Attribute group | Emitting | Share of the 8 surveyed |\n|---|---|---|\n| 3 required attrs | 6 | 75.0% |\n| Token usage | 7 | 87.5% |\n| Any cost attr | 2 | 25.0% |" } },
    { id: "s8d", parentId: "s8", name: "Skill", kind: "skill", startMs: 795800, durationMs: 42000, status: "ok", attributes: [{ label: "skill.name", value: "report-style-guide" }, { label: "skill.version", value: "3.1.0" }, { label: "rules.applied", value: "11" }], io: { input: "Apply the house style guide to the draft.\n\n- no unsourced adjectives\n- no bare percentages\n- tables must carry their denominator in the header\n- every section must survive the \"so what\" test", output: "11 rules applied, 6 edits made:\n- 2 bare percentages given explicit denominators in-sentence\n- \"dramatically improved\" cut — no source supports a trend claim\n- table header changed to \"Share of the 8 surveyed\" so the denominator travels with the number\n- section 4 reordered to lead with the gap rather than the background\n- 1 sentence cut for restating section 2\n\nStyle pass clean; no rule violations remain." } },
    { id: "s8d1", parentId: "s8d", name: "anthropic.messages.create", kind: "llm", startMs: 796400, durationMs: 40000, status: "ok", tokensIn: 3600, tokensOut: 590, cost: 0.0032, attributes: [{ label: "model", value: "claude-haiku-4-5-20251001" }, { label: "temperature", value: "0" }, { label: "cache_read_tokens", value: "2800" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Scan the draft for style-guide violations.\n\nReport line, rule id, offending text, corrected text. Do not rewrite anything that already passes.", output: "L14 R-03 bare-percentage: \"75% of frameworks\" -> \"6 of the 8 frameworks surveyed (75.0%)\"\nL22 R-03 bare-percentage: \"only 25% support cost\" -> \"2 of the 8 surveyed emit any cost attribute\"\nL31 R-07 unsourced-adjective: \"dramatically improved tooling\" -> cut\nL38 R-11 table-denominator: header \"Share\" -> \"Share of the 8 surveyed\"\nL44 R-02 redundancy: sentence restates section 2 -> cut\nL52 R-09 lead-with-finding: section 4 reordered\n\nAll other lines pass." } },
    { id: "s8e", parentId: "s8", name: "anthropic.messages.create", kind: "llm", startMs: 838600, durationMs: 36000, status: "ok", tokensIn: 4900, tokensOut: 1250, cost: 0.0237, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.3" }, { label: "cache_read_tokens", value: "3600" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Write sections 4-5 and emit the final report.\n\nSection 4 must lead with the gap, not the background. Section 5 gives practical guidance and introduces no new claims.", output: "## 4. Where OpenTelemetry stops and vendors begin\nThe gap is evaluation, not instrumentation. Three field families have no OTel equivalent [9]:\n\n- **Evaluation scores** — no `gen_ai.evaluation.*` namespace.\n- **Human feedback** — no normative carrier.\n- **Dataset linkage** — the trace-to-run join key.\n\nOne mismatch corrupts comparisons: cached input tokens sit inside `input_tokens` in one mapping, apart in the other — a **6-18% gap**.\n\n## 5. Practical guidance\n- Emit the three required attributes first [1].\n- Treat cost as a backend computation [1].\n- Pin the semconv version; read the repo." } },
    { id: "s9", parentId: "s1", name: "anthropic.messages.create", kind: "llm", startMs: 877000, durationMs: 62000, status: "ok", tokensIn: 4600, tokensOut: 970, cost: 0.0189, attributes: [{ label: "model", value: "claude-sonnet-4-5-20250929" }, { label: "temperature", value: "0.2" }, { label: "cache_read_tokens", value: "3500" }, { label: "stop_reason", value: "end_turn" }], io: { input: "Final verification before returning to the caller.\n\n- cross-check every inline citation against the researcher's source list\n- confirm every number in the report appears in coverage.csv\n- confirm the DSPy caveat survived the style pass", output: "Verification: PASS (17/17 citations resolve).\n\n- All 17 [n] markers map to a source id in sources.jsonl; no orphan citations, no uncited statistics.\n- The three numbers in the report (75.0%, 87.5%, 25.0%) each match a row in coverage.csv and are written with the 8-framework denominator in-sentence.\n- DSPy caveat present in section 3, stated as the row that moves required-attr coverage from 7/8 to 6/8.\n- The recovered ZeroDivisionError never touched the published numbers: the failed run wrote no output file.\n\nReturning the report." } },
    { id: "s10", parentId: "s1", name: "Edit", kind: "tool", startMs: 940000, durationMs: 8600, status: "ok", attributes: [{ label: "file.path", value: "reports/otel-ai-observability.md" }, { label: "insertions", value: "148" }, { label: "deletions", value: "6" }, { label: "words", value: "1284" }], io: { input: "Write the verified report to reports/otel-ai-observability.md.\n\nThe file already holds the section-1-3 draft; replace it with the post-style-pass text plus sections 4-5 and the 17-entry reference block.", output: "reports/otel-ai-observability.md — +148 / -6 (1,284 words).\n\n+ ## 4. Where OpenTelemetry stops and vendors begin\n+ ## 5. Practical guidance\n+ ## References  (17 entries, [n] title — url (retrieved 2026-08-11))\n- \"dramatically improved tooling\" (unsourced adjective, R-07)\n- 1 sentence restating section 2 (R-02)\n\nTable header now reads \"Share of the 8 surveyed\". No number in the file lacks its denominator." } },
    { id: "s11", parentId: "s1", name: "POST /api/v1/reports/publish", kind: "http", startMs: 949400, durationMs: 5200, status: "ok", attributes: [{ label: "http.status_code", value: "201" }, { label: "report.id", value: "rpt_9c31f0" }, { label: "request.bytes", value: "18422" }, { label: "visibility", value: "workspace" }], io: { input: "POST /api/v1/reports/publish  (18,422 bytes)\ncontent-type: application/json\n\n{\n  \"path\": \"reports/otel-ai-observability.md\",\n  \"title\": \"OpenTelemetry for AI Observability — Key Features\",\n  \"visibility\": \"workspace\",\n  \"trace_id\": \"research\",\n  \"attachments\": [\"coverage.csv\", \"sources.jsonl\"],\n  \"body\": \"<1,284-word markdown report, 17 citations>\"\n}", output: "201 Created (5.2s)\n\n{\n  \"report_id\": \"rpt_9c31f0\",\n  \"version\": 1,\n  \"visibility\": \"workspace\",\n  \"word_count\": 1284,\n  \"citations\": 17,\n  \"attachments\": [\"coverage.csv\", \"sources.jsonl\"],\n  \"published_at\": \"2026-08-11T09:42:18Z\"\n}\n\nAttachments are linked, not inlined, so the statistics table and its source artifact stay joined." } },
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

// ── Named detectors (LLM-as-judge definitions) with findings + runs ──
export interface DetectorEntity {
  id: string;
  name: string;
  type: DetectorType;
  description: string;
  enabled: boolean;
  findings: { traceId: string; findingId: string; timestamp: string; title: string; severity: string; confidence: number; service: string }[];
  runs: { traceId: string; timestamp: string; identified: boolean; service: string }[];
}

const DETECTOR_DEFS: { name: string; type: DetectorType; description: string }[] = [
  { name: "tool-failure-v1", type: "tool_failure", description: "Flags unhandled tool/function exceptions on the critical path." },
  { name: "hallucination-v1", type: "hallucination", description: "Flags responses with fabricated facts or unsupported claims." },
  { name: "intent-drift-v1", type: "intent_drift", description: "Flags outputs that diverge from the user's original request." },
  { name: "safety-v1", type: "safety", description: "Flags policy or safety violations in agent output." },
];

export function getDetectors(): DetectorEntity[] {
  const all = [...INCIDENTS, ...HEALTHY];
  return DETECTOR_DEFS.map((def, di) => {
    const findings = INCIDENTS.filter((d) => d.finding.detector === def.type).map((d, i) => ({
      traceId: d.incidentId,
      findingId: `${def.name.replace(/-v1$/, "")}-${String(di)}${String(i)}${d.traceId.slice(0, 6)}`,
      timestamp: d.startedAt,
      title: d.finding.title,
      severity: d.finding.severity,
      confidence: d.finding.confidence,
      service: d.service,
    }));
    const runs = all.map((d) => ({
      traceId: d.incidentId,
      timestamp: d.startedAt,
      identified: d.finding?.detector === def.type,
      service: d.service,
    }));
    return { id: `det-${di}`, name: def.name, type: def.type, description: def.description, enabled: true, findings, runs };
  });
}

export function getDetector(name: string): DetectorEntity | undefined {
  return getDetectors().find((d) => d.name === name);
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
