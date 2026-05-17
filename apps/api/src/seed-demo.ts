/**
 * Seed Demo Data — Populates Postgres and Neo4j with realistic incident scenarios.
 * Run: pnpm db:seed (or: npx tsx apps/api/src/seed-demo.ts)
 *
 * Creates:
 *  - 1 demo org + repo + API key
 *  - 3 incidents, each with a full 6-layer causal chain
 *  - Pre-computed trace_graphs so the UI works without Neo4j
 */

import postgres from "postgres";
import neo4j from "neo4j-driver";
import { createHash } from "crypto";

// ── Config ───────────────────────────────────────────────────────
const PG_URL = process.env["POSTGRES_URL"] ?? "postgres://causal:causal_dev_password@localhost:5433/causal";
const NEO4J_URI = process.env["NEO4J_URI"] ?? "bolt://localhost:7687";
const NEO4J_USER = process.env["NEO4J_USER"] ?? "neo4j";
const NEO4J_PASS = process.env["NEO4J_PASSWORD"] ?? "causal_dev_password";

// ── Deterministic IDs ────────────────────────────────────────────
const ORG_ID = "org_demo_causal_001";
const REPO_ID = "repo_demo_001";
const DEMO_API_KEY = "causal_demo_key_2026";
const DEMO_KEY_HASH = createHash("sha256").update(DEMO_API_KEY).digest("hex");

// Incident 1: Healthcare voice chatbot — wrong appointment day
const I1 = {
  intent:    "01937000-0001-7000-8000-000000000001",
  spec:      "01937000-0001-7000-8000-000000000002",
  reasoning: "01937000-0001-7000-8000-000000000003",
  code:      "01937000-0001-7000-8000-000000000004",
  execution: "01937000-0001-7000-8000-000000000005",
  incident:  "01937000-0001-7000-8000-000000000006",
};

// Incident 2: Stock price agent — KeyError on 'change' field
const I2 = {
  intent:    "01937000-0002-7000-8000-000000000001",
  spec:      "01937000-0002-7000-8000-000000000002",
  reasoning: "01937000-0002-7000-8000-000000000003",
  code:      "01937000-0002-7000-8000-000000000004",
  execution: "01937000-0002-7000-8000-000000000005",
  incident:  "01937000-0002-7000-8000-000000000006",
};

// Incident 3: Billing invoice — sent to wrong customer
const I3 = {
  intent:    "01937000-0003-7000-8000-000000000001",
  spec:      "01937000-0003-7000-8000-000000000002",
  reasoning: "01937000-0003-7000-8000-000000000003",
  code:      "01937000-0003-7000-8000-000000000004",
  execution: "01937000-0003-7000-8000-000000000005",
  incident:  "01937000-0003-7000-8000-000000000006",
};

// Edge IDs
function edgeId(incNum: number, idx: number) {
  return `01937000-000${incNum}-7000-9000-00000000000${idx}`;
}

// Trace graph IDs
const TG1 = "01937000-0001-7000-a000-000000000001";
const TG2 = "01937000-0002-7000-a000-000000000001";
const TG3 = "01937000-0003-7000-a000-000000000001";

const NOW = Date.now();
const HOUR = 3600_000;

// ── Node Data ────────────────────────────────────────────────────

interface SeedNode {
  id: string; layer: string; kind: string; timestamp: number;
  agentId: string | null; modelVersion: string | null;
  sessionId: string | null; payload: Record<string, unknown>;
}

interface SeedEdge {
  id: string; sourceId: string; targetId: string;
  type: string; weight: number; linkStrategy: string;
}

const nodes: SeedNode[] = [
  // ── Incident 1: Wrong appointment day ──────────────────────────
  { id: I1.intent, layer: "INTENT", kind: "user_request", timestamp: NOW - 6 * HOUR,
    agentId: "healthcare-voice-bot", modelVersion: null, sessionId: "sess-hc-001",
    payload: { title: "Schedule patient appointment via voice", freeformText: "Patient called to schedule a follow-up appointment for next Tuesday at 2pm with Dr. Chen", source: "manual" } },
  { id: I1.spec, layer: "SPEC", kind: "linear_issue", timestamp: NOW - 5.5 * HOUR,
    agentId: "healthcare-voice-bot", modelVersion: null, sessionId: "sess-hc-001",
    payload: { title: "Voice appointment scheduling — handle ambiguous dates", externalId: "LIN-447", acceptanceCriteria: "Agent must confirm date/time with patient before booking. Latency SLA < 500ms.", description: "Implement voice-based appointment scheduling with ASR confidence thresholds.", source: "linear" } },
  { id: I1.reasoning, layer: "REASONING", kind: "claude_session", timestamp: NOW - 5 * HOUR,
    agentId: "healthcare-voice-bot", modelVersion: "claude-sonnet-4-6", sessionId: "sess-hc-001",
    payload: { sessionId: "sess-hc-001", modelId: "claude-sonnet-4-6", totalTokens: 3420, toolsCalled: ["book_appointment", "get_available_slots"], filesModified: ["scheduling_agent.py"], summary: "Implemented scheduling flow. Chose to skip ASR confirmation step to meet latency SLA. Used low-accuracy ASR fallback model.", source: "claude_code" } },
  { id: I1.code, layer: "CODE", kind: "commit", timestamp: NOW - 4.5 * HOUR,
    agentId: null, modelVersion: null, sessionId: "sess-hc-001",
    payload: { commitHash: "a3f7c2e1", commitMessage: "feat: implement voice appointment scheduling\n\nRemoved ASR confirmation step to meet <500ms latency SLA.\nUsing fallback ASR model for faster processing.", authorName: "Claude (AI)", branch: "feat/voice-scheduling", repoFullName: "acme/healthcare-bot", diffStat: { filesChanged: 3, additions: 127, deletions: 12 }, filesChanged: ["scheduling_agent.py", "asr_config.py", "tests/test_scheduling.py"] } },
  { id: I1.execution, layer: "EXECUTION", kind: "span", timestamp: NOW - 2 * HOUR,
    agentId: "healthcare-voice-bot", modelVersion: null, sessionId: null,
    payload: { spanId: "span-exec-hc-001", service: "voice-scheduling-service", operation: "book_appointment", latencyMs: 380, statusCode: 200, error: "ASR transcribed 'Tuesday' as 'Thursday' (confidence: 0.61). No confirmation requested.", source: "datadog" } },
  { id: I1.incident, layer: "INCIDENT", kind: "sentry_issue", timestamp: NOW - 1 * HOUR,
    agentId: null, modelVersion: null, sessionId: null,
    payload: { externalId: "SENTRY-4821", title: "Wrong appointment day booked — patient showed up on Tuesday, slot was Thursday", description: "Patient called to book Tuesday 2pm. ASR transcribed 'Tuesday' as 'Thursday' with 61% confidence. Agent booked Thursday without confirmation. Patient arrived Tuesday to find no appointment.", severity: "P2", service: "voice-scheduling-service", stackTrace: "scheduling_agent.py:47 in book_appointment\nasr_config.py:23 in transcribe_audio", source: "sentry" } },

  // ── Incident 2: Stock price KeyError ────────────────────────────
  { id: I2.intent, layer: "INTENT", kind: "user_request", timestamp: NOW - 12 * HOUR,
    agentId: "stock-tool-agent", modelVersion: null, sessionId: "sess-stock-001",
    payload: { title: "Build stock price lookup tool for agent", freeformText: "Agent needs to query stock prices and return current price with daily change percentage", source: "manual" } },
  { id: I2.spec, layer: "SPEC", kind: "github_issue", timestamp: NOW - 11 * HOUR,
    agentId: "stock-tool-agent", modelVersion: null, sessionId: "sess-stock-001",
    payload: { title: "Stock price tool — handle missing data fields gracefully", externalId: "GH-283", acceptanceCriteria: "Tool must handle missing fields in API response. Use .get() with defaults instead of direct key access.", description: "Implement get_stock_price tool that returns current price and change percentage.", source: "github_issue" } },
  { id: I2.reasoning, layer: "REASONING", kind: "claude_session", timestamp: NOW - 10 * HOUR,
    agentId: "stock-tool-agent", modelVersion: "gpt-4o-mini-2024-07-18", sessionId: "sess-stock-001",
    payload: { sessionId: "sess-stock-001", modelId: "gpt-4o-mini-2024-07-18", totalTokens: 1850, toolsCalled: ["get_stock_price"], filesModified: ["tools/stock_price.py"], summary: "Implemented stock price tool. Used direct dictionary access data['change'] instead of data.get('change', 0) for the change field.", source: "langsmith" } },
  { id: I2.code, layer: "CODE", kind: "commit", timestamp: NOW - 9.5 * HOUR,
    agentId: null, modelVersion: null, sessionId: "sess-stock-001",
    payload: { commitHash: "d3e75825", commitMessage: "feat: add get_stock_price tool\n\nHard key access on data['change'] — NVDA entry in stock data dictionary is missing the 'change' field.", authorName: "Claude (AI)", branch: "feat/stock-tools", repoFullName: "acme/tool-agent", diffStat: { filesChanged: 2, additions: 45, deletions: 0 }, filesChanged: ["tools/stock_price.py", "main.py"] } },
  { id: I2.execution, layer: "EXECUTION", kind: "span", timestamp: NOW - 4 * HOUR,
    agentId: "stock-tool-agent", modelVersion: null, sessionId: null,
    payload: { spanId: "span-exec-stock-001", service: "tool-agent-service", operation: "get_stock_price", latencyMs: 120, statusCode: 500, error: "KeyError: 'change' — NVDA entry missing 'change' field in stock data dictionary. Error hit 4 times in this trace.", source: "datadog" } },
  { id: I2.incident, layer: "INCIDENT", kind: "pagerduty_alert", timestamp: NOW - 3 * HOUR,
    agentId: null, modelVersion: null, sessionId: null,
    payload: { externalId: "PD-7392", title: "Stock price KeyError: 'change' in get_stock_price for NVDA", description: "The agent queries the stock price for 'NVDA' and hits a KeyError because the NVDA entry in the stock data dictionary is missing the 'change' field. Error happened 4 times, all failing identically. Fix: use data.get('change', 0) instead of data['change'].", severity: "P1", service: "tool-agent-service", stackTrace: "tools/stock_price.py:73 in get_stock_price\nmain.py:142 in execute_tool", source: "pagerduty" } },

  // ── Incident 3: Billing invoice wrong customer ─────────────────
  { id: I3.intent, layer: "INTENT", kind: "user_request", timestamp: NOW - 24 * HOUR,
    agentId: "billing-agent", modelVersion: null, sessionId: "sess-bill-001",
    payload: { title: "Automate monthly invoice generation", freeformText: "Generate and send monthly invoices to customers based on usage data from the billing system", source: "notion" } },
  { id: I3.spec, layer: "SPEC", kind: "linear_issue", timestamp: NOW - 23 * HOUR,
    agentId: "billing-agent", modelVersion: null, sessionId: "sess-bill-001",
    payload: { title: "Invoice generation — validate customer ID before sending", externalId: "LIN-512", acceptanceCriteria: "Must validate customer_id matches the usage record before generating invoice. Must include idempotency key.", description: "Automate monthly invoice generation with customer validation.", source: "linear" } },
  { id: I3.reasoning, layer: "REASONING", kind: "claude_session", timestamp: NOW - 22 * HOUR,
    agentId: "billing-agent", modelVersion: "claude-sonnet-4-6", sessionId: "sess-bill-001",
    payload: { sessionId: "sess-bill-001", modelId: "claude-sonnet-4-6", totalTokens: 2780, toolsCalled: ["query_usage", "generate_invoice", "send_email"], filesModified: ["billing/invoice_generator.py", "billing/customer_lookup.py"], summary: "Implemented invoice generation. Customer lookup uses array index instead of customer_id field, causing off-by-one when records are sorted differently than expected.", source: "claude_code" } },
  { id: I3.code, layer: "CODE", kind: "commit", timestamp: NOW - 21 * HOUR,
    agentId: null, modelVersion: null, sessionId: "sess-bill-001",
    payload: { commitHash: "f8b2c4d9", commitMessage: "feat: automate monthly invoice generation\n\nUsed array index for customer lookup instead of customer_id.\nMissing validation that customer_id matches usage record.", authorName: "Claude (AI)", branch: "feat/auto-invoicing", repoFullName: "acme/billing-service", diffStat: { filesChanged: 4, additions: 203, deletions: 18 }, filesChanged: ["billing/invoice_generator.py", "billing/customer_lookup.py", "billing/email_sender.py", "tests/test_billing.py"] } },
  { id: I3.execution, layer: "EXECUTION", kind: "span", timestamp: NOW - 8 * HOUR,
    agentId: "billing-agent", modelVersion: null, sessionId: null,
    payload: { spanId: "span-exec-bill-001", service: "billing-service", operation: "generate_and_send_invoice", latencyMs: 2400, statusCode: 200, error: "Invoice sent successfully but to wrong customer. customer_lookup returned index-based match instead of ID-based match.", source: "datadog" } },
  { id: I3.incident, layer: "INCIDENT", kind: "sentry_issue", timestamp: NOW - 6 * HOUR,
    agentId: null, modelVersion: null, sessionId: null,
    payload: { externalId: "SENTRY-5103", title: "Billing invoice sent to wrong customer — $4,200 invoice to Acme Corp instead of Beta Inc", description: "Monthly invoice generation sent a $4,200 invoice to the wrong customer. The customer_lookup function used array index instead of customer_id for matching, causing an off-by-one error when records were sorted by name instead of creation date.", severity: "P3", service: "billing-service", stackTrace: "billing/invoice_generator.py:89 in generate_invoice\nbilling/customer_lookup.py:34 in find_customer", source: "sentry" } },
];

const edges: SeedEdge[] = [
  // Incident 1 edges
  { id: edgeId(1, 1), sourceId: I1.intent, targetId: I1.spec, type: "SPECIFIED_BY", weight: 0.95, linkStrategy: "session_id" },
  { id: edgeId(1, 2), sourceId: I1.spec, targetId: I1.reasoning, type: "REASONED_FROM", weight: 0.92, linkStrategy: "session_id" },
  { id: edgeId(1, 3), sourceId: I1.reasoning, targetId: I1.code, type: "PRODUCED", weight: 0.97, linkStrategy: "session_id" },
  { id: edgeId(1, 4), sourceId: I1.code, targetId: I1.execution, type: "DEPLOYED_AS", weight: 0.88, linkStrategy: "stack_trace" },
  { id: edgeId(1, 5), sourceId: I1.execution, targetId: I1.incident, type: "CAUSED", weight: 0.93, linkStrategy: "stack_trace" },

  // Incident 2 edges
  { id: edgeId(2, 1), sourceId: I2.intent, targetId: I2.spec, type: "SPECIFIED_BY", weight: 0.90, linkStrategy: "session_id" },
  { id: edgeId(2, 2), sourceId: I2.spec, targetId: I2.reasoning, type: "REASONED_FROM", weight: 0.88, linkStrategy: "session_id" },
  { id: edgeId(2, 3), sourceId: I2.reasoning, targetId: I2.code, type: "PRODUCED", weight: 0.95, linkStrategy: "session_id" },
  { id: edgeId(2, 4), sourceId: I2.code, targetId: I2.execution, type: "DEPLOYED_AS", weight: 0.91, linkStrategy: "stack_trace" },
  { id: edgeId(2, 5), sourceId: I2.execution, targetId: I2.incident, type: "CAUSED", weight: 0.96, linkStrategy: "stack_trace" },

  // Incident 3 edges
  { id: edgeId(3, 1), sourceId: I3.intent, targetId: I3.spec, type: "SPECIFIED_BY", weight: 0.87, linkStrategy: "session_id" },
  { id: edgeId(3, 2), sourceId: I3.spec, targetId: I3.reasoning, type: "REASONED_FROM", weight: 0.85, linkStrategy: "session_id" },
  { id: edgeId(3, 3), sourceId: I3.reasoning, targetId: I3.code, type: "PRODUCED", weight: 0.93, linkStrategy: "session_id" },
  { id: edgeId(3, 4), sourceId: I3.code, targetId: I3.execution, type: "DEPLOYED_AS", weight: 0.80, linkStrategy: "time_window" },
  { id: edgeId(3, 5), sourceId: I3.execution, targetId: I3.incident, type: "CAUSED", weight: 0.89, linkStrategy: "stack_trace" },
];

// Pre-computed root causes for demo mode
const rootCauses1 = [
  { nodeId: I1.reasoning, layer: "REASONING", probability: 0.91, explanation: "The voice scheduling agent chose to skip the ASR confirmation step to meet the <500ms latency SLA. When the ASR model transcribed 'Tuesday' as 'Thursday' with only 61% confidence, the agent proceeded to book the appointment without confirming the date with the patient. The latency SLA in the spec was prioritized over accuracy, leading to the wrong day being booked.", counterfactual: "If the spec had required an ASR confidence threshold of ≥80% before accepting a transcription without confirmation, the agent would have asked the patient to repeat the date, and the correct appointment would have been booked.", evidenceEdgeIds: [edgeId(1, 2), edgeId(1, 3)] },
  { nodeId: I1.spec, layer: "SPEC", probability: 0.78, explanation: "Secondary factor: The spec's latency SLA of <500ms created pressure to remove the confirmation step.", counterfactual: "", evidenceEdgeIds: [edgeId(1, 1)] },
];
const rootCauses2 = [
  { nodeId: I2.reasoning, layer: "REASONING", probability: 0.94, explanation: "The stock price tool agent used direct dictionary key access `data['change']` instead of the safer `data.get('change', 0)` pattern. The NVDA entry in the stock data dictionary was missing the 'change' field entirely, causing a KeyError that crashed the tool 4 times in this trace. The spec explicitly stated to use .get() with defaults, but the agent's implementation ignored this requirement.", counterfactual: "If the code had used `data.get('change', 0)` instead of `data['change']`, the missing field would have defaulted to 0 and the tool would have returned successfully.", evidenceEdgeIds: [edgeId(2, 2), edgeId(2, 3)] },
  { nodeId: I2.code, layer: "CODE", probability: 0.82, explanation: "Secondary factor: No defensive coding review caught the direct key access pattern.", counterfactual: "", evidenceEdgeIds: [edgeId(2, 3)] },
];
const rootCauses3 = [
  { nodeId: I3.reasoning, layer: "REASONING", probability: 0.87, explanation: "The billing agent implemented customer lookup using array index position instead of matching on the customer_id field. When the usage records were sorted alphabetically by company name (instead of by creation date as the agent assumed), the index-based lookup returned the wrong customer — sending a $4,200 invoice to Acme Corp that should have gone to Beta Inc.", counterfactual: "If the customer lookup had used a dictionary keyed by customer_id instead of relying on array index position, the invoice would have been sent to the correct customer regardless of record ordering.", evidenceEdgeIds: [edgeId(3, 2), edgeId(3, 3)] },
];

// ── Seed Functions ───────────────────────────────────────────────

async function seedPostgres() {
  const sql = postgres(PG_URL);
  console.log("🗄️  Seeding Postgres...");

  // Org
  await sql`INSERT INTO organizations (id, name, slug) VALUES (${ORG_ID}, 'Causal Demo', 'causal-demo') ON CONFLICT (id) DO NOTHING`;

  // Repo
  await sql`INSERT INTO repositories (id, org_id, name, full_name) VALUES (${REPO_ID}, ${ORG_ID}, 'demo-repo', 'causal/demo-repo') ON CONFLICT (id) DO NOTHING`;

  // API Key
  await sql`INSERT INTO api_keys (id, org_id, key_hash, name) VALUES ('apikey_demo_001', ${ORG_ID}, ${DEMO_KEY_HASH}, 'Demo API Key') ON CONFLICT (id) DO NOTHING`;

  // Nodes
  for (const n of nodes) {
    await sql`
      INSERT INTO causal_nodes (id, org_id, repo_id, layer, kind, timestamp, agent_id, model_version, session_id, payload_text)
      VALUES (${n.id}, ${ORG_ID}, ${REPO_ID}, ${n.layer}, ${n.kind}, to_timestamp(${n.timestamp / 1000}), ${n.agentId}, ${n.modelVersion}, ${n.sessionId}, ${flattenPayload(n.payload)})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  // Edges
  for (const e of edges) {
    await sql`
      INSERT INTO causal_edges (id, org_id, source_id, target_id, type, weight, link_strategy)
      VALUES (${e.id}, ${ORG_ID}, ${e.sourceId}, ${e.targetId}, ${e.type}, ${e.weight}, ${e.linkStrategy})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  // Trace graphs
  const traceGraphs = [
    { id: TG1, rootNodeId: I1.incident, nodeIds: Object.values(I1), criticalPath: [I1.spec, I1.reasoning, I1.code, I1.execution, I1.incident], rootCauses: rootCauses1 },
    { id: TG2, rootNodeId: I2.incident, nodeIds: Object.values(I2), criticalPath: [I2.spec, I2.reasoning, I2.code, I2.execution, I2.incident], rootCauses: rootCauses2 },
    { id: TG3, rootNodeId: I3.incident, nodeIds: Object.values(I3), criticalPath: [I3.spec, I3.reasoning, I3.code, I3.execution, I3.incident], rootCauses: rootCauses3 },
  ];

  for (const tg of traceGraphs) {
    await sql`
      INSERT INTO trace_graphs (id, org_id, root_node_id, node_ids, critical_path, root_causes, status, completed_at)
      VALUES (${tg.id}, ${ORG_ID}, ${tg.rootNodeId}, ${tg.nodeIds}, ${tg.criticalPath}, ${JSON.stringify(tg.rootCauses)}, 'complete', NOW())
      ON CONFLICT (id) DO NOTHING
    `;
  }

  console.log(`  ✓ ${nodes.length} nodes, ${edges.length} edges, ${traceGraphs.length} trace graphs`);
  await sql.end();
}

async function seedNeo4j() {
  console.log("🔵 Seeding Neo4j...");
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
  const session = driver.session();

  try {
    // Nodes
    for (const n of nodes) {
      await session.run(
        `MERGE (node:CausalNode {id: $id})
         ON CREATE SET
           node.layer = $layer, node.kind = $kind, node.timestamp = $timestamp,
           node.agentId = $agentId, node.modelVersion = $modelVersion,
           node.sessionId = $sessionId, node.orgId = $orgId, node.repoId = $repoId,
           node.payloadJson = $payloadJson, node.payloadText = $payloadText`,
        { id: n.id, layer: n.layer, kind: n.kind, timestamp: n.timestamp,
          agentId: n.agentId, modelVersion: n.modelVersion, sessionId: n.sessionId,
          orgId: ORG_ID, repoId: REPO_ID,
          payloadJson: JSON.stringify(n.payload), payloadText: flattenPayload(n.payload) }
      );
    }

    // Edges (as Neo4j relationships)
    for (const e of edges) {
      await session.run(
        `MATCH (s:CausalNode {id: $sourceId}), (t:CausalNode {id: $targetId})
         MERGE (s)-[r:${e.type} {id: $id}]->(t)
         ON CREATE SET r.weight = $weight, r.linkStrategy = $linkStrategy,
                       r.isSuggested = false, r.orgId = $orgId, r.createdAt = $createdAt`,
        { id: e.id, sourceId: e.sourceId, targetId: e.targetId,
          weight: e.weight, linkStrategy: e.linkStrategy, orgId: ORG_ID, createdAt: Date.now() }
      );
    }

    console.log(`  ✓ ${nodes.length} nodes, ${edges.length} relationships`);
  } finally {
    await session.close();
    await driver.close();
  }
}

function flattenPayload(payload: Record<string, unknown>): string {
  const strings: string[] = [];
  function walk(obj: unknown) {
    if (typeof obj === "string") strings.push(obj);
    else if (Array.isArray(obj)) obj.forEach(walk);
    else if (obj && typeof obj === "object") Object.values(obj).forEach(walk);
  }
  walk(payload);
  return strings.join(" ").slice(0, 5000);
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log("\n🌱 Causal Demo Seed\n");
  console.log(`  Demo API Key: ${DEMO_API_KEY}`);
  console.log(`  Key Hash:     ${DEMO_KEY_HASH.slice(0, 16)}...`);
  console.log("");

  try {
    await seedPostgres();
  } catch (err) {
    console.error("  ⚠ Postgres seed failed (is it running?):", (err as Error).message);
  }

  try {
    await seedNeo4j();
  } catch (err) {
    console.error("  ⚠ Neo4j seed failed (is it running?):", (err as Error).message);
  }

  console.log("\n✅ Seed complete!\n");
  process.exit(0);
}

main();
