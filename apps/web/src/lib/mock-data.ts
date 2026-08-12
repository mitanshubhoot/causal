/**
 * Mock data for demo mode — mirrors the API's seed-demo.ts so the UI works
 * end-to-end without a live backend. Three incidents, each with a full
 * 6-layer causal chain (INTENT → SPEC → REASONING → CODE → EXECUTION → INCIDENT)
 * and pre-computed root causes.
 */

import type { CausalNode, CausalEdge, TraceGraph, RootCause, ReplayResult } from "@causal/types";

const ORG_ID = "org_demo_causal_001";
const REPO_ID = "repo_demo_001";

// ── Incident 1: Healthcare voice chatbot — wrong appointment day ───
const I1 = {
  intent: "01937000-0001-7000-8000-000000000001",
  spec: "01937000-0001-7000-8000-000000000002",
  reasoning: "01937000-0001-7000-8000-000000000003",
  code: "01937000-0001-7000-8000-000000000004",
  execution: "01937000-0001-7000-8000-000000000005",
  incident: "01937000-0001-7000-8000-000000000006",
};

// ── Incident 2: Stock price agent — KeyError on 'change' field ─────
const I2 = {
  intent: "01937000-0002-7000-8000-000000000001",
  spec: "01937000-0002-7000-8000-000000000002",
  reasoning: "01937000-0002-7000-8000-000000000003",
  code: "01937000-0002-7000-8000-000000000004",
  execution: "01937000-0002-7000-8000-000000000005",
  incident: "01937000-0002-7000-8000-000000000006",
};

// ── Incident 3: Billing invoice — sent to wrong customer ───────────
const I3 = {
  intent: "01937000-0003-7000-8000-000000000001",
  spec: "01937000-0003-7000-8000-000000000002",
  reasoning: "01937000-0003-7000-8000-000000000003",
  code: "01937000-0003-7000-8000-000000000004",
  execution: "01937000-0003-7000-8000-000000000005",
  incident: "01937000-0003-7000-8000-000000000006",
};

// ── Incident 4: AI coding agent removed a live feature flag ────────
// The flagship, self-referential story: a Claude-Code-style agent ships a
// bug straight to prod. CI stayed green because the flag service was mocked.
const I4 = {
  intent: "01937000-0004-7000-8000-000000000001",
  spec: "01937000-0004-7000-8000-000000000002",
  reasoning: "01937000-0004-7000-8000-000000000003",
  code: "01937000-0004-7000-8000-000000000004",
  execution: "01937000-0004-7000-8000-000000000005",
  incident: "01937000-0004-7000-8000-000000000006",
};

const TG1 = "01937000-0001-7000-a000-000000000001";
const TG2 = "01937000-0002-7000-a000-000000000001";
const TG3 = "01937000-0003-7000-a000-000000000001";
const TG4 = "01937000-0004-7000-a000-000000000001";

function edgeId(incNum: number, idx: number): string {
  return `01937000-000${incNum}-7000-9000-00000000000${idx}`;
}

const NOW = Date.now();
const HOUR = 3600_000;

function makeNode(
  base: Omit<CausalNode, "embedding" | "orgId" | "repoId" | "contextSnapId">
): CausalNode {
  return {
    ...base,
    embedding: null,
    orgId: ORG_ID,
    repoId: REPO_ID,
    contextSnapId: null,
  };
}

// ── All nodes across all incidents ─────────────────────────────────
export const MOCK_NODES: CausalNode[] = [
  // ── Incident 1: Wrong appointment day ────────────────────────────
  makeNode({
    id: I1.intent,
    layer: "INTENT",
    kind: "user_request",
    timestamp: NOW - 6 * HOUR,
    agentId: "healthcare-voice-bot",
    modelVersion: null,
    sessionId: null,
    payload: {
      title: "Schedule patient appointment via voice",
      freeformText:
        "Patient called to schedule a follow-up appointment for next Tuesday at 2pm with Dr. Chen",
      source: "manual",
    },
  }),
  makeNode({
    id: I1.spec,
    layer: "SPEC",
    kind: "linear_issue",
    timestamp: NOW - 5.5 * HOUR,
    agentId: "healthcare-voice-bot",
    modelVersion: null,
    sessionId: null,
    payload: {
      title: "Voice appointment scheduling — handle ambiguous dates",
      externalId: "LIN-447",
      acceptanceCriteria:
        "Agent must confirm date/time with patient before booking. Latency SLA < 500ms.",
      description:
        "Implement voice-based appointment scheduling with ASR confidence thresholds.",
      source: "linear",
    },
  }),
  makeNode({
    id: I1.reasoning,
    layer: "REASONING",
    kind: "claude_session",
    timestamp: NOW - 5 * HOUR,
    agentId: "healthcare-voice-bot",
    modelVersion: "claude-sonnet-4-6",
    sessionId: null,
    payload: {
      sessionId: "sess-hc-001",
      modelId: "claude-sonnet-4-6",
      totalTokens: 3420,
      toolsCalled: ["book_appointment", "get_available_slots"],
      filesModified: ["scheduling_agent.py"],
      summary:
        "Implemented scheduling flow. Chose to skip ASR confirmation step to meet latency SLA. Used low-accuracy ASR fallback model.",
      source: "claude_code",
    },
  }),
  makeNode({
    id: I1.code,
    layer: "CODE",
    kind: "commit",
    timestamp: NOW - 4.5 * HOUR,
    agentId: null,
    modelVersion: null,
    sessionId: null,
    payload: {
      commitHash: "a3f7c2e1",
      commitMessage:
        "feat: implement voice appointment scheduling\n\nRemoved ASR confirmation step to meet <500ms latency SLA.\nUsing fallback ASR model for faster processing.",
      authorName: "Claude (AI)",
      branch: "feat/voice-scheduling",
      repoFullName: "acme/healthcare-bot",
      diffStat: { filesChanged: 3, additions: 127, deletions: 12 },
      filesChanged: [
        "scheduling_agent.py",
        "asr_config.py",
        "tests/test_scheduling.py",
      ],
    },
  }),
  makeNode({
    id: I1.execution,
    layer: "EXECUTION",
    kind: "span",
    timestamp: NOW - 2 * HOUR,
    agentId: "healthcare-voice-bot",
    modelVersion: null,
    sessionId: null,
    payload: {
      spanId: "span-exec-hc-001",
      service: "voice-scheduling-service",
      operation: "book_appointment",
      latencyMs: 380,
      statusCode: 200,
      error:
        "ASR transcribed 'Tuesday' as 'Thursday' (confidence: 0.61). No confirmation requested.",
      source: "datadog",
    },
  }),
  makeNode({
    id: I1.incident,
    layer: "INCIDENT",
    kind: "sentry_issue",
    timestamp: NOW - 1 * HOUR,
    agentId: null,
    modelVersion: null,
    sessionId: null,
    payload: {
      externalId: "SENTRY-4821",
      title:
        "Wrong appointment day booked — patient showed up on Tuesday, slot was Thursday",
      description:
        "Patient called to book Tuesday 2pm. ASR transcribed 'Tuesday' as 'Thursday' with 61% confidence. Agent booked Thursday without confirmation. Patient arrived Tuesday to find no appointment.",
      severity: "P2",
      service: "voice-scheduling-service",
      stackTrace:
        "scheduling_agent.py:47 in book_appointment\nasr_config.py:23 in transcribe_audio",
      source: "sentry",
    },
  }),

  // ── Incident 2: Stock price KeyError ──────────────────────────────
  makeNode({
    id: I2.intent,
    layer: "INTENT",
    kind: "user_request",
    timestamp: NOW - 12 * HOUR,
    agentId: "stock-tool-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      title: "Build stock price lookup tool for agent",
      freeformText:
        "Agent needs to query stock prices and return current price with daily change percentage",
      source: "manual",
    },
  }),
  makeNode({
    id: I2.spec,
    layer: "SPEC",
    kind: "github_issue",
    timestamp: NOW - 11 * HOUR,
    agentId: "stock-tool-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      title: "Stock price tool — handle missing data fields gracefully",
      externalId: "GH-283",
      acceptanceCriteria:
        "Tool must handle missing fields in API response. Use .get() with defaults instead of direct key access.",
      description:
        "Implement get_stock_price tool that returns current price and change percentage.",
      source: "github_issue",
    },
  }),
  makeNode({
    id: I2.reasoning,
    layer: "REASONING",
    kind: "claude_session",
    timestamp: NOW - 10 * HOUR,
    agentId: "stock-tool-agent",
    modelVersion: "gpt-4o-mini-2024-07-18",
    sessionId: null,
    payload: {
      sessionId: "sess-stock-001",
      modelId: "gpt-4o-mini-2024-07-18",
      totalTokens: 1850,
      toolsCalled: ["get_stock_price"],
      filesModified: ["tools/stock_price.py"],
      summary:
        "Implemented stock price tool. Used direct dictionary access data['change'] instead of data.get('change', 0) for the change field.",
      source: "langsmith",
    },
  }),
  makeNode({
    id: I2.code,
    layer: "CODE",
    kind: "commit",
    timestamp: NOW - 9.5 * HOUR,
    agentId: null,
    modelVersion: null,
    sessionId: null,
    payload: {
      commitHash: "d3e75825",
      commitMessage:
        "feat: add get_stock_price tool\n\nHard key access on data['change'] — NVDA entry in stock data dictionary is missing the 'change' field.",
      authorName: "Claude (AI)",
      branch: "feat/stock-tools",
      repoFullName: "acme/tool-agent",
      diffStat: { filesChanged: 2, additions: 45, deletions: 0 },
      filesChanged: ["tools/stock_price.py", "main.py"],
    },
  }),
  makeNode({
    id: I2.execution,
    layer: "EXECUTION",
    kind: "span",
    timestamp: NOW - 4 * HOUR,
    agentId: "stock-tool-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      spanId: "span-exec-stock-001",
      service: "tool-agent-service",
      operation: "get_stock_price",
      latencyMs: 120,
      statusCode: 500,
      error:
        "KeyError: 'change' — NVDA entry missing 'change' field in stock data dictionary. Error hit 4 times in this trace.",
      source: "datadog",
    },
  }),
  makeNode({
    id: I2.incident,
    layer: "INCIDENT",
    kind: "pagerduty_alert",
    timestamp: NOW - 3 * HOUR,
    agentId: null,
    modelVersion: null,
    sessionId: null,
    payload: {
      externalId: "PD-7392",
      title: "Stock price KeyError: 'change' in get_stock_price for NVDA",
      description:
        "The agent queries the stock price for 'NVDA' and hits a KeyError because the NVDA entry in the stock data dictionary is missing the 'change' field. Error happened 4 times, all failing identically. Fix: use data.get('change', 0) instead of data['change'].",
      severity: "P1",
      service: "tool-agent-service",
      stackTrace:
        "tools/stock_price.py:73 in get_stock_price\nmain.py:142 in execute_tool",
      source: "pagerduty",
    },
  }),

  // ── Incident 3: Billing invoice wrong customer ───────────────────
  makeNode({
    id: I3.intent,
    layer: "INTENT",
    kind: "user_request",
    timestamp: NOW - 24 * HOUR,
    agentId: "billing-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      title: "Automate monthly invoice generation",
      freeformText:
        "Generate and send monthly invoices to customers based on usage data from the billing system",
      source: "notion",
    },
  }),
  makeNode({
    id: I3.spec,
    layer: "SPEC",
    kind: "linear_issue",
    timestamp: NOW - 23 * HOUR,
    agentId: "billing-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      title: "Invoice generation — validate customer ID before sending",
      externalId: "LIN-512",
      acceptanceCriteria:
        "Must validate customer_id matches the usage record before generating invoice. Must include idempotency key.",
      description:
        "Automate monthly invoice generation with customer validation.",
      source: "linear",
    },
  }),
  makeNode({
    id: I3.reasoning,
    layer: "REASONING",
    kind: "claude_session",
    timestamp: NOW - 22 * HOUR,
    agentId: "billing-agent",
    modelVersion: "claude-sonnet-4-6",
    sessionId: null,
    payload: {
      sessionId: "sess-bill-001",
      modelId: "claude-sonnet-4-6",
      totalTokens: 2780,
      toolsCalled: ["query_usage", "generate_invoice", "send_email"],
      filesModified: [
        "billing/invoice_generator.py",
        "billing/customer_lookup.py",
      ],
      summary:
        "Implemented invoice generation. Customer lookup uses array index instead of customer_id field, causing off-by-one when records are sorted differently than expected.",
      source: "claude_code",
    },
  }),
  makeNode({
    id: I3.code,
    layer: "CODE",
    kind: "commit",
    timestamp: NOW - 21 * HOUR,
    agentId: null,
    modelVersion: null,
    sessionId: null,
    payload: {
      commitHash: "f8b2c4d9",
      commitMessage:
        "feat: automate monthly invoice generation\n\nUsed array index for customer lookup instead of customer_id.\nMissing validation that customer_id matches usage record.",
      authorName: "Claude (AI)",
      branch: "feat/auto-invoicing",
      repoFullName: "acme/billing-service",
      diffStat: { filesChanged: 4, additions: 203, deletions: 18 },
      filesChanged: [
        "billing/invoice_generator.py",
        "billing/customer_lookup.py",
        "billing/email_sender.py",
        "tests/test_billing.py",
      ],
    },
  }),
  makeNode({
    id: I3.execution,
    layer: "EXECUTION",
    kind: "span",
    timestamp: NOW - 8 * HOUR,
    agentId: "billing-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      spanId: "span-exec-bill-001",
      service: "billing-service",
      operation: "generate_and_send_invoice",
      latencyMs: 2400,
      statusCode: 200,
      error:
        "Invoice sent successfully but to wrong customer. customer_lookup returned index-based match instead of ID-based match.",
      source: "datadog",
    },
  }),
  makeNode({
    id: I3.incident,
    layer: "INCIDENT",
    kind: "sentry_issue",
    timestamp: NOW - 6 * HOUR,
    agentId: null,
    modelVersion: null,
    sessionId: null,
    payload: {
      externalId: "SENTRY-5103",
      title:
        "Billing invoice sent to wrong customer — $4,200 invoice to Acme Corp instead of Beta Inc",
      description:
        "Monthly invoice generation sent a $4,200 invoice to the wrong customer. The customer_lookup function used array index instead of customer_id for matching, causing an off-by-one error when records were sorted by name instead of creation date.",
      severity: "P3",
      service: "billing-service",
      stackTrace:
        "billing/invoice_generator.py:89 in generate_invoice\nbilling/customer_lookup.py:34 in find_customer",
      source: "sentry",
    },
  }),

  // ── Incident 4: AI coding agent removed a live feature flag ───────
  makeNode({
    id: I4.intent,
    layer: "INTENT",
    kind: "user_request",
    timestamp: NOW - 3 * HOUR,
    agentId: "coding-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      title: "Clean up stale checkout feature flags",
      freeformText:
        "Asked the coding agent to remove feature flags for the checkout redesign that we believe has fully rolled out. Keep the diff small.",
      source: "manual",
    },
  }),
  makeNode({
    id: I4.spec,
    layer: "SPEC",
    kind: "linear_issue",
    timestamp: NOW - 2.8 * HOUR,
    agentId: "coding-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      title: "Remove checkout_v2 feature flag — verify rollout before deleting",
      externalId: "LIN-891",
      acceptanceCriteria:
        "Before deleting any flag, confirm 100% rollout via the flag-service analytics dashboard. Do not remove flags still serving traffic.",
      description:
        "Tech-debt cleanup of the checkout_v2_enabled flag now that the redesign is live.",
      source: "linear",
    },
  }),
  makeNode({
    id: I4.reasoning,
    layer: "REASONING",
    kind: "claude_session",
    timestamp: NOW - 2.6 * HOUR,
    agentId: "coding-agent",
    modelVersion: "claude-sonnet-4-6",
    sessionId: null,
    payload: {
      sessionId: "sess-code-4471",
      modelId: "claude-sonnet-4-6",
      totalTokens: 6120,
      toolsCalled: ["grep", "read_file", "edit_file"],
      filesModified: ["checkout/flags.py", "checkout/router.py"],
      summary:
        "Removed the checkout_v2_enabled flag and its legacy branch. Assumed the flag was fully rolled out because the redesign shipped last quarter; did not query flag-service analytics as the spec required. Skipped the rollout check to keep the diff small.",
      source: "claude_code",
    },
  }),
  makeNode({
    id: I4.code,
    layer: "CODE",
    kind: "commit",
    timestamp: NOW - 2.4 * HOUR,
    agentId: null,
    modelVersion: null,
    sessionId: null,
    payload: {
      commitHash: "b91f0ac4",
      commitMessage:
        "chore: remove checkout_v2_enabled feature flag\n\nRedesign is fully live — deleting the flag and the legacy checkout branch.\nCausal-Session: sess-code-4471",
      authorName: "Claude (AI)",
      branch: "chore/flag-cleanup",
      repoFullName: "acme/storefront",
      diffStat: { filesChanged: 2, additions: 4, deletions: 63 },
      filesChanged: ["checkout/flags.py", "checkout/router.py"],
      causalSessionTrailer: "sess-code-4471",
    },
  }),
  makeNode({
    id: I4.execution,
    layer: "EXECUTION",
    kind: "span",
    timestamp: NOW - 1.4 * HOUR,
    agentId: "coding-agent",
    modelVersion: null,
    sessionId: null,
    payload: {
      spanId: "span-exec-checkout-4471",
      service: "storefront-checkout",
      operation: "POST /checkout",
      latencyMs: 88,
      statusCode: 500,
      error:
        "AttributeError: module 'checkout.flags' has no attribute 'checkout_v2_enabled' — 34% of checkout traffic still routed to the removed legacy branch.",
      source: "datadog",
    },
  }),
  makeNode({
    id: I4.incident,
    layer: "INCIDENT",
    kind: "pagerduty_alert",
    timestamp: NOW - 1.1 * HOUR,
    agentId: null,
    modelVersion: null,
    sessionId: null,
    payload: {
      externalId: "PD-8890",
      title:
        "Checkout down 40 min — coding agent removed a live feature flag",
      description:
        "The agent deleted checkout_v2_enabled during a tech-debt cleanup, but 34% of traffic was still on the old checkout path. Every request to POST /checkout 500s with AttributeError. CI stayed green because the test suite mocks the flag service. Revenue impact ~$18k over 40 minutes.",
      severity: "P1",
      service: "storefront-checkout",
      stackTrace:
        "checkout/router.py:112 in handle_checkout\ncheckout/flags.py:— (attribute removed)",
      source: "pagerduty",
    },
  }),
];

function makeEdge(
  base: Omit<CausalEdge, "confirmedBy" | "isSuggested" | "orgId" | "createdAt">
): CausalEdge {
  return {
    ...base,
    confirmedBy: null,
    isSuggested: false,
    orgId: ORG_ID,
    createdAt: NOW,
  };
}

export const MOCK_EDGES: CausalEdge[] = [
  // Incident 1 edges
  makeEdge({ id: edgeId(1, 1), sourceId: I1.intent, targetId: I1.spec, type: "SPECIFIED_BY", weight: 0.95, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(1, 2), sourceId: I1.spec, targetId: I1.reasoning, type: "REASONED_FROM", weight: 0.92, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(1, 3), sourceId: I1.reasoning, targetId: I1.code, type: "PRODUCED", weight: 0.97, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(1, 4), sourceId: I1.code, targetId: I1.execution, type: "DEPLOYED_AS", weight: 0.88, linkStrategy: "stack_trace" }),
  makeEdge({ id: edgeId(1, 5), sourceId: I1.execution, targetId: I1.incident, type: "CAUSED", weight: 0.93, linkStrategy: "stack_trace" }),
  // Incident 2 edges
  makeEdge({ id: edgeId(2, 1), sourceId: I2.intent, targetId: I2.spec, type: "SPECIFIED_BY", weight: 0.90, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(2, 2), sourceId: I2.spec, targetId: I2.reasoning, type: "REASONED_FROM", weight: 0.88, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(2, 3), sourceId: I2.reasoning, targetId: I2.code, type: "PRODUCED", weight: 0.95, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(2, 4), sourceId: I2.code, targetId: I2.execution, type: "DEPLOYED_AS", weight: 0.91, linkStrategy: "stack_trace" }),
  makeEdge({ id: edgeId(2, 5), sourceId: I2.execution, targetId: I2.incident, type: "CAUSED", weight: 0.96, linkStrategy: "stack_trace" }),
  // Incident 3 edges
  makeEdge({ id: edgeId(3, 1), sourceId: I3.intent, targetId: I3.spec, type: "SPECIFIED_BY", weight: 0.87, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(3, 2), sourceId: I3.spec, targetId: I3.reasoning, type: "REASONED_FROM", weight: 0.85, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(3, 3), sourceId: I3.reasoning, targetId: I3.code, type: "PRODUCED", weight: 0.93, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(3, 4), sourceId: I3.code, targetId: I3.execution, type: "DEPLOYED_AS", weight: 0.80, linkStrategy: "time_window" }),
  makeEdge({ id: edgeId(3, 5), sourceId: I3.execution, targetId: I3.incident, type: "CAUSED", weight: 0.89, linkStrategy: "stack_trace" }),
  // Incident 4 edges
  makeEdge({ id: edgeId(4, 1), sourceId: I4.intent, targetId: I4.spec, type: "SPECIFIED_BY", weight: 0.93, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(4, 2), sourceId: I4.spec, targetId: I4.reasoning, type: "REASONED_FROM", weight: 0.90, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(4, 3), sourceId: I4.reasoning, targetId: I4.code, type: "PRODUCED", weight: 0.97, linkStrategy: "session_id" }),
  makeEdge({ id: edgeId(4, 4), sourceId: I4.code, targetId: I4.execution, type: "DEPLOYED_AS", weight: 0.94, linkStrategy: "stack_trace" }),
  makeEdge({ id: edgeId(4, 5), sourceId: I4.execution, targetId: I4.incident, type: "CAUSED", weight: 0.98, linkStrategy: "stack_trace" }),
];

const ROOT_CAUSES_1: RootCause[] = [
  {
    nodeId: I1.reasoning,
    layer: "REASONING",
    probability: 0.91,
    explanation:
      "The voice scheduling agent chose to skip the ASR confirmation step to meet the <500ms latency SLA. When the ASR model transcribed 'Tuesday' as 'Thursday' with only 61% confidence, the agent proceeded to book the appointment without confirming the date with the patient. The latency SLA in the spec was prioritized over accuracy, leading to the wrong day being booked.",
    counterfactual:
      "If the spec had required an ASR confidence threshold of ≥80% before accepting a transcription without confirmation, the agent would have asked the patient to repeat the date, and the correct appointment would have been booked.",
    evidenceEdgeIds: [edgeId(1, 2), edgeId(1, 3)],
  },
  {
    nodeId: I1.spec,
    layer: "SPEC",
    probability: 0.78,
    explanation:
      "Secondary factor: The spec's latency SLA of <500ms created pressure to remove the confirmation step.",
    counterfactual: "",
    evidenceEdgeIds: [edgeId(1, 1)],
  },
];

const ROOT_CAUSES_2: RootCause[] = [
  {
    nodeId: I2.reasoning,
    layer: "REASONING",
    probability: 0.94,
    explanation:
      "The stock price tool agent used direct dictionary key access `data['change']` instead of the safer `data.get('change', 0)` pattern. The NVDA entry in the stock data dictionary was missing the 'change' field entirely, causing a KeyError that crashed the tool 4 times in this trace. The spec explicitly stated to use .get() with defaults, but the agent's implementation ignored this requirement.",
    counterfactual:
      "If the code had used `data.get('change', 0)` instead of `data['change']`, the missing field would have defaulted to 0 and the tool would have returned successfully.",
    evidenceEdgeIds: [edgeId(2, 2), edgeId(2, 3)],
  },
  {
    nodeId: I2.code,
    layer: "CODE",
    probability: 0.82,
    explanation:
      "Secondary factor: No defensive coding review caught the direct key access pattern.",
    counterfactual: "",
    evidenceEdgeIds: [edgeId(2, 3)],
  },
];

const ROOT_CAUSES_3: RootCause[] = [
  {
    nodeId: I3.reasoning,
    layer: "REASONING",
    probability: 0.87,
    explanation:
      "The billing agent implemented customer lookup using array index position instead of matching on the customer_id field. When the usage records were sorted alphabetically by company name (instead of by creation date as the agent assumed), the index-based lookup returned the wrong customer — sending a $4,200 invoice to Acme Corp that should have gone to Beta Inc.",
    counterfactual:
      "If the customer lookup had used a dictionary keyed by customer_id instead of relying on array index position, the invoice would have been sent to the correct customer regardless of record ordering.",
    evidenceEdgeIds: [edgeId(3, 2), edgeId(3, 3)],
  },
];

const ROOT_CAUSES_4: RootCause[] = [
  {
    nodeId: I4.reasoning,
    layer: "REASONING",
    probability: 0.96,
    explanation:
      "The coding agent deleted the checkout_v2_enabled feature flag during a routine cleanup, assuming the redesign was fully rolled out. The spec (LIN-891) explicitly required confirming 100% rollout via the flag-service analytics dashboard before deleting any flag, but the agent skipped that check to keep the diff small. 34% of production traffic was still being served by the legacy checkout path the agent removed, so every one of those requests began failing with an AttributeError.",
    counterfactual:
      "If the agent had queried the flag-service analytics before deleting the flag — as the spec required — it would have seen 34% of traffic still on the legacy path and left the flag in place, preventing the outage.",
    evidenceEdgeIds: [edgeId(4, 2), edgeId(4, 3)],
  },
  {
    nodeId: I4.code,
    layer: "CODE",
    probability: 0.71,
    explanation:
      "Contributing factor: CI stayed green and merged the change because the test suite mocks the flag service, so no test exercised the real removed code path.",
    counterfactual: "",
    evidenceEdgeIds: [edgeId(4, 4)],
  },
];

// ── Per-incident trace graphs ──────────────────────────────────────
function buildTraceGraph(
  tgId: string,
  ids: typeof I1,
  rootCauses: RootCause[]
): TraceGraph {
  const nodeIds = Object.values(ids);
  return {
    id: tgId,
    rootNodeId: ids.incident,
    nodes: MOCK_NODES.filter((n) => nodeIds.includes(n.id)),
    edges: MOCK_EDGES.filter(
      (e) => nodeIds.includes(e.sourceId) && nodeIds.includes(e.targetId)
    ),
    rootCauses,
    criticalPath: [ids.spec, ids.reasoning, ids.code, ids.execution, ids.incident],
    status: "complete",
    confidence: rootCauses[0]?.probability ?? 0,
    createdAt: NOW - HOUR,
    completedAt: NOW - HOUR + 5000,
  };
}

const TRACE_GRAPH_BY_INCIDENT: Record<string, TraceGraph> = {
  // Incident 4 (the self-referential coding-agent story) is listed first so it
  // leads the dashboard and is the default "best" demo incident.
  [I4.incident]: buildTraceGraph(TG4, I4, ROOT_CAUSES_4),
  [I1.incident]: buildTraceGraph(TG1, I1, ROOT_CAUSES_1),
  [I2.incident]: buildTraceGraph(TG2, I2, ROOT_CAUSES_2),
  [I3.incident]: buildTraceGraph(TG3, I3, ROOT_CAUSES_3),
};

/** The incident to open when a visitor just wants the strongest demo. */
export const FEATURED_INCIDENT_ID = I4.incident;

// ── Public mock API ────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

export const MOCK_INCIDENTS = MOCK_NODES
  .filter((n) => n.layer === "INCIDENT")
  .map((n) => {
    const p = n.payload as Record<string, unknown>;
    return {
      id: n.id,
      layer: n.layer,
      kind: n.kind,
      timestamp: new Date(n.timestamp).toISOString(),
      agent_id: n.agentId,
      _severity: (p["severity"] as string) ?? "P3",
      // Mirror the API's flattenPayload: include ALL string fields (severity,
      // source, …) so the list page can detect P1/P2/P3 and the true source —
      // not just externalId/title/description.
      payload_text: [
        p["externalId"],
        p["title"],
        p["description"],
        p["severity"],
        p["source"],
        p["service"],
      ]
        .filter(Boolean)
        .join(" "),
    };
  })
  // Lead with the flagship incident, then by severity, then most-recent first.
  .sort((a, b) => {
    if (a.id === FEATURED_INCIDENT_ID) return -1;
    if (b.id === FEATURED_INCIDENT_ID) return 1;
    const sev = (SEVERITY_RANK[a._severity] ?? 2) - (SEVERITY_RANK[b._severity] ?? 2);
    if (sev !== 0) return sev;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  })
  .map(({ _severity, ...rest }) => { void _severity; return rest; });

export function getMockIncidents(): { nodes: unknown[]; count: number } {
  return { nodes: MOCK_INCIDENTS, count: MOCK_INCIDENTS.length };
}

/** Gate any user-supplied id on `isMockIncidentId` first: the fallback below
 *  substitutes a DIFFERENT incident's provenance chain, so an ungated call
 *  renders I1's root cause under whatever id was asked for. */
export function getMockTrace(rootNodeId: string): TraceGraph {
  const tg = TRACE_GRAPH_BY_INCIDENT[rootNodeId];
  if (tg) return tg;
  // Fallback: return the first incident's trace if the rootNodeId is unknown
  return TRACE_GRAPH_BY_INCIDENT[I1.incident]!;
}

export function getMockNode(id: string): CausalNode | undefined {
  return MOCK_NODES.find((n) => n.id === id);
}

/** True only for the four ids that have a canned trace graph AND post-mortem.
 *  The gate for offering the "Causal graph" / "Post-mortem" actions at all — a
 *  healthy trace has neither, and both getters substitute another incident. */
export function isMockIncidentId(id: string): boolean {
  return id in TRACE_GRAPH_BY_INCIDENT;
}

// ── Replay (canned before/after per incident) ──────────────────────

interface CannedReplay {
  suggestedFix: string;
  modType: "system_prompt_append" | "context_inject";
  original: string;
  modified: string;
  fidelity: number;
}

const REPLAY_BY_INCIDENT: Record<string, CannedReplay> = {
  [I4.incident]: {
    suggestedFix:
      "Before deleting any feature flag, call flag_service.get_rollout(flag) and refuse to remove the flag if it is still serving more than 0% of traffic.",
    modType: "system_prompt_append",
    fidelity: 0.94,
    original: `$ agent: cleaning up checkout_v2_enabled
> assuming redesign is fully rolled out (shipped last quarter)
> editing checkout/flags.py  (-38 lines)
> editing checkout/router.py (-25 lines)
> commit b91f0ac4  "chore: remove checkout_v2_enabled feature flag"
> CI: ✓ green (flag service mocked in tests)

PROD  POST /checkout
500  AttributeError: module 'checkout.flags' has no attribute 'checkout_v2_enabled'
     34% of checkout traffic still on legacy path — all failing.`,
    modified: `$ agent: cleaning up checkout_v2_enabled
> spec LIN-891: confirm 100% rollout before deleting
> calling flag_service.get_rollout("checkout_v2_enabled")
< rollout = 66%  (34% of traffic still on legacy path)
> flag is still serving traffic — NOT SAFE to delete
> leaving checkout_v2_enabled in place; opening LIN-892 to finish migration first

PROD  POST /checkout
200  ok — checkout healthy, 0 errors.`,
  },
  [I1.incident]: {
    suggestedFix:
      "Never accept an ASR transcription with confidence below 0.80 without asking the patient to confirm the date and time out loud.",
    modType: "system_prompt_append",
    fidelity: 0.9,
    original: `patient: "book me for next Tuesday at 2pm"
> ASR transcribed: "Thursday" (confidence 0.61)
> latency budget < 500ms — skipping confirmation
> book_appointment(day="Thursday", time="14:00")
< Booked: Thursday 2:00pm  ✗ (patient meant Tuesday)`,
    modified: `patient: "book me for next Tuesday at 2pm"
> ASR transcribed: "Thursday" (confidence 0.61)
> confidence 0.61 < 0.80 threshold — confirming before booking
agent: "I heard Thursday — did you mean Tuesday or Thursday?"
patient: "Tuesday"
> book_appointment(day="Tuesday", time="14:00")
< Booked: Tuesday 2:00pm  ✓`,
  },
  [I2.incident]: {
    suggestedFix:
      "When reading fields from an external API response, always use data.get(key, default) instead of direct key access like data[key].",
    modType: "system_prompt_append",
    fidelity: 0.92,
    original: `> get_stock_price("NVDA")
> price = data["price"]      -> 875.23
> change = data["change"]    -> KeyError: 'change'
Traceback (most recent call last):
  File "tools/stock_price.py", line 73, in get_stock_price
    change = data["change"]
KeyError: 'change'   (crashed 4x)`,
    modified: `> get_stock_price("NVDA")
> price = data.get("price", 0.0)    -> 875.23
> change = data.get("change", 0.0)  -> 0.0  (field missing, defaulted)
< NVDA $875.23  (change: 0.0%)  ✓  no error`,
  },
  [I3.incident]: {
    suggestedFix:
      "Look up customers by customer_id, never by array index position, and validate the id matches the usage record before sending an invoice.",
    modType: "system_prompt_append",
    fidelity: 0.88,
    original: `> generate_invoice(usage_record)
> customer = customers[record_index]   # index-based lookup
< records sorted by name, not creation date -> off-by-one
> send_email(customer="Acme Corp", amount=4200)
< Sent $4,200 invoice to Acme Corp  ✗ (should be Beta Inc)`,
    modified: `> generate_invoice(usage_record)
> customer = customers_by_id[record.customer_id]   # id-based lookup
> assert customer.id == record.customer_id  ✓
> send_email(customer="Beta Inc", amount=4200)
< Sent $4,200 invoice to Beta Inc  ✓`,
  },
};

function lineDiff(
  original: string,
  modified: string
): { type: "added" | "removed" | "unchanged"; value: string }[] {
  const orig = original.split("\n");
  const mod = modified.split("\n");
  const modSet = new Set(mod);
  const origSet = new Set(orig);
  const out: { type: "added" | "removed" | "unchanged"; value: string }[] = [];
  for (const line of orig) {
    if (!modSet.has(line)) out.push({ type: "removed", value: line });
  }
  for (const line of mod) {
    out.push({ type: origSet.has(line) ? "unchanged" : "added", value: line });
  }
  return out;
}

/** Suggested one-click fix for the replay sandbox, derived from the incident. */
export function getSuggestedFix(
  rootNodeId: string
): { content: string; type: "system_prompt_append" | "context_inject" } | null {
  const canned = REPLAY_BY_INCIDENT[rootNodeId] ?? REPLAY_BY_INCIDENT[FEATURED_INCIDENT_ID];
  if (!canned) return null;
  return { content: canned.suggestedFix, type: canned.modType };
}

/** Canned replay result so the Replay Sandbox works with zero backend. */
export function getMockReplay(rootNodeId: string): ReplayResult {
  const canned = REPLAY_BY_INCIDENT[rootNodeId] ?? REPLAY_BY_INCIDENT[FEATURED_INCIDENT_ID]!;
  return {
    id: TG4, // any stable uuid; not surfaced in the UI
    snapshotId: rootNodeId,
    originalOutput: canned.original,
    modifiedOutput: canned.modified,
    diff: lineDiff(canned.original, canned.modified),
    fidelityScore: canned.fidelity,
    modelUsed: "claude-sonnet-4-6",
    completedAt: NOW,
  };
}

// ── Post-mortem (rich, per-incident) ───────────────────────────────

interface CannedPostMortem {
  markdown: string;
  linearTicket: { title: string; description: string; labels: string[]; priority: string };
  claudeMdRule: string;
}

function postMortemFor(
  ids: typeof I1,
  rootCauses: RootCause[],
  opts: {
    title: string;
    severity: string;
    impact: string;
    timeline: [string, string][];
    fiveWhys: string[];
    remediation: string[];
    labels: string[];
    claudeMdRule: string;
  }
): CannedPostMortem {
  const rc = rootCauses[0]!;
  // Plain-markdown only (no GFM tables/task-lists) so it renders without remark-gfm.
  const timelineRows = opts.timeline.map(([t, e]) => `- **${t}** — ${e}`).join("\n");
  const whys = opts.fiveWhys.map((w, i) => `${i + 1}. ${w}`).join("\n");
  const actions = opts.remediation.map((r) => `- ${r}`).join("\n");
  const markdown = `# Post-Mortem — ${opts.title}

**Severity:** ${opts.severity}  ·  **Status:** Resolved  ·  **Confidence:** ${Math.round(
    rc.probability * 100
  )}%

## Summary
${opts.impact}

## Root Cause
${rc.explanation}

## Timeline
${timelineRows}

## Five Whys
${whys}

## What Would Have Prevented This
> ${rc.counterfactual}

## Remediation
${actions}

## Prevention Rule
The rule below has been generated for your \`CLAUDE.md\` so the agent does not repeat this mistake:

\`\`\`
${opts.claudeMdRule}
\`\`\`
`;
  return {
    markdown,
    linearTicket: {
      title: opts.title,
      description: `Root cause: ${rc.explanation}\n\nCounterfactual: ${rc.counterfactual}`,
      labels: opts.labels,
      priority: opts.severity,
    },
    claudeMdRule: opts.claudeMdRule,
  };
}

const POST_MORTEM_BY_INCIDENT: Record<string, CannedPostMortem> = {
  [I4.incident]: postMortemFor(I4, ROOT_CAUSES_4, {
    title: "Checkout outage — coding agent removed a live feature flag",
    severity: "P1",
    impact:
      "A coding agent deleted the `checkout_v2_enabled` flag during a tech-debt cleanup while 34% of traffic was still on the legacy path. POST /checkout returned 500 for those users for 40 minutes (~$18k revenue impact). CI merged the change because the flag service was mocked in tests.",
    timeline: [
      ["T-0h", "Agent asked to clean up stale checkout flags (LIN-891)"],
      ["T+2m", "Agent removes checkout_v2_enabled without checking rollout"],
      ["T+5m", "CI passes (flag service mocked) — change auto-merges & deploys"],
      ["T+18m", "Datadog: POST /checkout 500s spike; PagerDuty P1 fires"],
      ["T+58m", "Flag restored, checkout recovers"],
    ],
    fiveWhys: [
      "Checkout 500'd — the checkout_v2_enabled attribute was removed.",
      "The agent deleted the flag as tech debt.",
      "It assumed the redesign was fully rolled out.",
      "It never queried flag-service analytics (34% still on legacy).",
      "The spec required a rollout check, but the agent skipped it to keep the diff small.",
    ],
    remediation: [
      "Require a flag-service rollout check before any flag deletion",
      "Stop mocking the flag service in checkout integration tests",
      "Add a canary on POST /checkout error rate that auto-rolls-back",
    ],
    labels: ["incident", "checkout", "feature-flags", "ai-agent"],
    claudeMdRule:
      "Before deleting a feature flag, query the flag service for its current rollout percentage. If it is serving more than 0% of traffic, do not remove it — finish the migration first.",
  }),
  [I1.incident]: postMortemFor(I1, ROOT_CAUSES_1, {
    title: "Wrong appointment day booked by voice agent",
    severity: "P2",
    impact:
      "The voice scheduling agent booked a patient for Thursday instead of Tuesday after a low-confidence ASR transcription (61%) was accepted without confirmation, to meet a <500ms latency SLA. The patient arrived on the wrong day.",
    timeline: [
      ["T-0h", "Patient calls to book Tuesday 2pm"],
      ["T+1s", "ASR transcribes 'Tuesday' as 'Thursday' (confidence 0.61)"],
      ["T+1s", "Agent skips confirmation to meet latency SLA, books Thursday"],
      ["T+2d", "Patient arrives Tuesday — no appointment on record"],
    ],
    fiveWhys: [
      "Patient arrived on the wrong day.",
      "The agent booked Thursday, not Tuesday.",
      "It accepted a 61%-confidence transcription without confirming.",
      "Confirmation was removed to hit the <500ms latency SLA.",
      "The spec prioritized latency over an ASR confidence threshold.",
    ],
    remediation: [
      "Require patient confirmation when ASR confidence < 0.80",
      "Relax the latency SLA to allow a confirmation round-trip",
      "Log ASR confidence on every booking for auditing",
    ],
    labels: ["incident", "voice", "asr", "ai-agent"],
    claudeMdRule:
      "Never accept an ASR transcription with confidence below 0.80 without asking the user to confirm the date and time out loud before acting.",
  }),
  [I2.incident]: postMortemFor(I2, ROOT_CAUSES_2, {
    title: "Stock tool KeyError on missing 'change' field",
    severity: "P1",
    impact:
      "The stock price tool crashed with KeyError: 'change' four times because the NVDA record was missing the 'change' field and the code used direct key access instead of .get() with a default, as the spec required.",
    timeline: [
      ["T-0h", "Agent queries price for NVDA"],
      ["T+0s", "data['change'] raises KeyError (field missing)"],
      ["T+0s", "Tool returns 500 — repeated 4x identically"],
      ["T+3h", "PagerDuty P1 fires on repeated tool failures"],
    ],
    fiveWhys: [
      "The tool returned a 500.",
      "data['change'] raised a KeyError.",
      "The NVDA record had no 'change' field.",
      "The code used direct key access, not .get() with a default.",
      "The spec required .get() with defaults, but the implementation ignored it.",
    ],
    remediation: [
      "Replace direct key access with .get(key, default) in the tool",
      "Add a test for API responses with missing fields",
      "Lint rule flagging direct dict access on external payloads",
    ],
    labels: ["incident", "tools", "reliability", "ai-agent"],
    claudeMdRule:
      "When reading fields from an external API response, always use data.get(key, default) instead of direct key access like data[key].",
  }),
  [I3.incident]: postMortemFor(I3, ROOT_CAUSES_3, {
    title: "Invoice sent to wrong customer",
    severity: "P3",
    impact:
      "A $4,200 invoice was sent to Acme Corp instead of Beta Inc. The customer lookup matched by array index instead of customer_id, causing an off-by-one when records were sorted by name rather than creation date.",
    timeline: [
      ["T-0h", "Monthly invoice job runs"],
      ["T+0s", "customer_lookup returns index-based match (wrong record)"],
      ["T+2s", "Invoice emailed to Acme Corp instead of Beta Inc"],
      ["T+6h", "Finance flags the misdirected invoice"],
    ],
    fiveWhys: [
      "The invoice went to the wrong customer.",
      "customer_lookup returned the wrong record.",
      "It matched by array index, not customer_id.",
      "Records were sorted by name, not the assumed creation order.",
      "The spec required id-based validation, which was not implemented.",
    ],
    remediation: [
      "Look up customers by customer_id via a keyed map",
      "Assert customer.id matches the usage record before sending",
      "Add an idempotency key to invoice sends",
    ],
    labels: ["incident", "billing", "data-integrity", "ai-agent"],
    claudeMdRule:
      "Look up customers by customer_id, never by array index. Validate that the matched customer id equals the usage record's id before sending anything.",
  }),
};

/** Rich canned post-mortem so the Post-Mortem page renders instantly. Gate on
 *  `isMockIncidentId` first — the fallback writes up the FEATURED incident
 *  under the requested id, which reads as a generated document about a failure
 *  that never happened. */
export function getMockPostMortem(rootNodeId: string): {
  id: string;
  markdown: string;
  linearTicket: Record<string, unknown>;
  claudeMdRule: string;
} {
  const pm = POST_MORTEM_BY_INCIDENT[rootNodeId] ?? POST_MORTEM_BY_INCIDENT[FEATURED_INCIDENT_ID]!;
  return {
    id: `demo-postmortem-${rootNodeId.slice(0, 8)}`,
    markdown: pm.markdown,
    linearTicket: pm.linearTicket,
    claudeMdRule: pm.claudeMdRule,
  };
}

/** True when the deployed site is running on demo/mock data (no live API). */
export function isDemoMode(): boolean {
  const env = process.env["NEXT_PUBLIC_DEMO_MODE"];
  return env === "1" || env === "true" || !process.env["NEXT_PUBLIC_API_URL"];
}
