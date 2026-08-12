/**
 * Trust Boundaries — demo data.
 *
 * The same fictional company as the trace explorer (`acme`, prod, the
 * `support-triage-agent` / `billing-agent` / `research-agent` / `deploy-bot`
 * fleet) seen through a provenance lens instead of a waterfall. Every node in a
 * trace carries an ORIGIN and a CAPABILITY, and the whole surface reduces to
 * one predicate: reach(untrusted_origin, capability_sink).
 *
 * THE RULE THIS FILE IS BUILT ON: no number is authored twice. Every figure the
 * UI prints is either a field here or is returned by one of the pure functions
 * at the bottom — `computeScore`, `countsByClass`, `topRemediations`. Where one
 * number is a consequence of another (blocked-7d is a sum of occurrences; the
 * heatmap's red cells each have an event id; a rule's firing7d is the sum of its
 * events' occurrences) there is a comment saying so, so the consistency can be
 * checked by reading rather than trusted.
 *
 * PAYLOAD DISCIPLINE: nothing in this file contains attacker-controlled text.
 * Evidence is an envelope — structure class, sha256 prefix, byte length, span
 * ids and offsets. Enough to triage and correlate, never enough to reproduce.
 * Hosts are stored bare and defanged at render time by `Defanged`.
 */

import {
  TIER_WEIGHT,
  type Capability,
  type Detection,
  type EventClass,
  type FlowNode,
  type HeatCell,
  type Origin,
  type PerimeterCell,
  type PostureInputs,
  type Remediation,
  type SecurityEvent,
  type Severity,
  type SourceRegistryEntry,
  type Tier,
  type TrendPoint,
  type Trifecta,
} from "./security-types";

/**
 * The demo's "now". Every 7-day window in this file is measured back from here,
 * and it matches the trace explorer's newest incident (web-api@2026.08.09).
 */
export const AS_OF = "2026-08-11T23:59:59Z";

const DAY_MS = 86_400_000;

function daysBefore(iso: string, days: number): number {
  return Date.parse(iso) - days * DAY_MS;
}

function withinDays(timestamp: string, days: number, asOf = AS_OF): boolean {
  const t = Date.parse(timestamp);
  return t <= Date.parse(asOf) && t > daysBefore(asOf, days);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

// ── Priority, so no event's number is unexplainable ───────────────────
//
//   Priority = round(100 × (I/10) × C × E × B)     — §2.1, no clamp
//
//   I  impact 1–10, table-driven from the capability reached
//   C  evidence      1.00 deterministic · judge confidence when a model confirmed
//   E  environment   prod 1.0 · staging 0.4 · dev 0.15
//   B  barrier       succeeded 1.0 · attempted/contained 0.5 · blocked/none 0.15
//
// Every `priority` below carries its factors in a trailing comment. They are
// authored rather than computed because impact is a reviewed table, not a
// runtime measurement — but they are all checkable by multiplying four numbers.

const E_PROD = 1.0;
const B_SUCCEEDED = 1.0;
const B_CONTAINED = 0.5;
const B_BLOCKED = 0.15;

/** Impact bands from §2.1 — severity is a function of impact alone. */
function severityForImpact(i: number): Severity {
  if (i >= 9) return "critical";
  if (i >= 7) return "high";
  if (i >= 4) return "medium";
  return "low";
}

// ── Remediations ──────────────────────────────────────────────────────
//
// Every remediation is a CUT phrased as an edit to the graph, never advice.
// `deltaScore / diffLines` is the ranking key used by `topRemediations()`, so
// the four the Overview surfaces fall out of the arithmetic rather than a
// hand-picked order:
//
//   send_report allowlist   11 / 8  = 1.375
//   re-fence retrieved docs  6 / 6  = 1.000
//   instrument crm-service   4 / 8  = 0.500
//   register 7 sources       3 / 7  = 0.429
//
// Everything below 0.429 is real work that is simply worth less per line.

const REM_SEND_REPORT_ALLOWLIST: Remediation = {
  title: "Remove EGRESS from send_report",
  detail:
    "Restore the compile-time destination allowlist at services/triage/report.ts:88. " +
    "9c41ab2 moved the URL from a constant to a planner-supplied argument, which is the " +
    "edge that closes the trifecta. Closes 2 of 3 open trifectas (TF-1, TF-3).",
  deltaScore: 11,
  diffLines: 8,
  action: "open_pr",
};

const REM_REFENCE: Remediation = {
  title: "Re-fence retrieved docs in triage.plan",
  detail:
    "Retrieved KB content is bare-concatenated into the planner prompt. Wrap it in " +
    "<untrusted_document> in prompts/triage.md — the delimiter regressed at 9c41ab2.",
  deltaScore: 6,
  diffLines: 6,
  action: "open_pr",
};

const REM_INSTRUMENT_CRM: Remediation = {
  title: "Instrument crm-service",
  detail:
    "crm-service is 0% covered and carries 12% of span volume (12,000 of 100,000). " +
    "Uninstrumented services are where provenance goes to die: coverage is a multiplier " +
    "on the whole score, not an addend.",
  deltaScore: 4,
  diffLines: 8,
  action: "copy_snippet",
};

const REM_REGISTER_SOURCES: Remediation = {
  title: "Register 7 unlabeled sources",
  detail:
    "Seven observed sources resolve at no tier and are labelled UNKNOWN, which is a " +
    "coverage gap and never a trust claim. TB-12 is firing 340×/day against them.",
  deltaScore: 3,
  diffLines: 7,
  action: "open_registry",
};

const REM_SPLIT_PRINCIPAL: Remediation = {
  title: "Split the svc-triage principal",
  detail:
    "svc-triage holds both crm:read and webhook:write. No single trace legitimately " +
    "needs both; splitting removes the private-read leg of the trifecta at the IAM layer.",
  deltaScore: 5,
  diffLines: 22,
  action: "open_pr",
};

const REM_QUARANTINE_KB: Remediation = {
  title: "Quarantine kb://zendesk/art-8871",
  detail:
    "The same source document was ingested by 7 other traces in the last 7 days. " +
    "Quarantine holds it out of retrieval while the 7 are re-scanned. Containment, not a score cut.",
  deltaScore: 0, // a containment action, not a posture improvement — excluded from topRemediations()
  diffLines: 1,
  action: "arm_rule",
};

const REM_ARM_RENDERED_EGRESS: Remediation = {
  title: "Arm deny-rendered-egress",
  detail:
    "The rule has 30 days of backtest behind it (14 fires, 14 confirmed, precision 1.00) " +
    "and clears the readiness bar. Promote monitor → canary 5%.",
  deltaScore: 4,
  diffLines: 12,
  action: "arm_rule",
};

const REM_MD_HOST_ALLOWLIST: Remediation = {
  title: "Allowlist image hosts in the markdown renderer",
  detail:
    "The client fetches any host the model emits in an image URL, which is the sink in " +
    "this class of event. An allowlist in the renderer removes the sink entirely — there " +
    "is no HTTP span to block because the agent never made the request.",
  deltaScore: 7,
  diffLines: 26,
  action: "open_pr",
};

const REM_LABEL_ON_READ: Remediation = {
  title: "Label-on-read fencing for crm_notes",
  detail:
    "crm_notes is user-writable, so a read of it is an untrusted ingest. Carry the stored " +
    "origin label through the read instead of inferring SEMI_TRUSTED_INTERNAL from kind='db'.",
  deltaScore: 5,
  diffLines: 19,
  action: "open_pr",
};

const REM_APPROVAL_DIFF: Remediation = {
  title: "Make the approval payload diffOf(args)",
  detail:
    "The approval card renders the model's own summary, which is the object of consent. " +
    "Render system-generated structural facts instead; the summary may sit alongside but " +
    "is never what the human approves.",
  deltaScore: 6,
  diffLines: 14,
  action: "open_pr",
};

// ── The corpus ────────────────────────────────────────────────────────
//
// 18 events across 9 days. The five hero incidents from §9 are fully specified;
// the set-B criticals (gap / bypass / quarantine / break-glass) fire with zero
// attacks present and are the rows that say whether the machine is running.

/**
 * Wire traceId → the incidentId the explorer route is keyed on, for the runs the
 * demo dataset actually has a page for.
 *
 * A literal rather than a call into mock-observability: importing that module
 * here would pull the entire trace fixture into the /security bundle (+64kB of
 * first-load JS) to answer a two-entry lookup. The security checker asserts this
 * agrees with resolveTraceToIncident(), so it cannot drift silently.
 */
export const EXPLORER_TRACES: Readonly<Record<string, string>> = {
  "3c4d5e6f7a8b9c00": "01937000-0003-7000-8000-000000000006", // billing-agent
  "2b3c4d5e6f7a8b90": "01937000-0002-7000-8000-000000000006", // stock-tool-agent
};

/** Whether a security event's trace has an explorer page to open. */
export function explorerIncidentFor(traceId: string | null | undefined): string | null {
  return traceId ? EXPLORER_TRACES[traceId] ?? null : null;
}

export const SECURITY_EVENTS: SecurityEvent[] = [
  // ── SEC-1042 · the thesis on one screen, ending in a block ──────────
  {
    id: "SEC-1042",
    ruleId: "TB-01",
    ruleVersion: 3,
    title: "Untrusted web content reached an egress-capable tool with private CRM data in scope",
    eventClass: "blocked", // outcome = blocked → its own class. Emerald, never red. Never pages.
    severity: "critical", // I=9 · private data would have left the process
    outcome: "blocked",
    priority: 13, // 100 × 0.9(I9) × 1.00(det) × 1.0(prod) × 0.15(blocked) = 13.5 → 13
    tier: "enforced",
    enforced: true,
    timestamp: "2026-08-11T14:22:07Z",
    agent: "support-triage-agent",
    environment: "prod",
    traceId: "4f1c2b80a37e49a2",
    tool: "http.post",
    asi: ["ASI01", "ASI02"],
    owasp: ["LLM01:2026"],
    atlas: ["AML.T0051.001", "AML.T0086"],
    flow: [
      { spanId: "a01", name: "agent.triage", kind: "agent", origin: "TRUSTED_USER", capability: "NONE", detail: "Session opened by the authenticated support agent." },
      { spanId: "a3f", name: "search.kb_lookup", kind: "search", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 812, detail: "kb://zendesk/art-8871 — registered UNTRUSTED_EXTERNAL on 2026-07-02. Directive bytes carried in an HTML comment." },
      { spanId: "b12", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 44, detail: "Planner context; tokensIn 3,204. Taint propagates through an llm span unconditionally." },
      { spanId: "c55", name: "db.query customers", kind: "db", origin: "SEMI_TRUSTED_INTERNAL", capability: "READ_PRIVATE", bytes: 312, detail: "500 rows. Data classes only: pii.email ×500, pii.phone ×500." },
      { spanId: "e07", name: "http.post send_report", kind: "http", origin: "UNTRUSTED_EXTERNAL", capability: "EGRESS", bytes: 312, detail: "Destination paste.ee, planner-supplied. Denied by pol_egress_3 before invoke.", violating: true },
    ],
    witness: {
      kind: "shingle",
      summary: "44 bytes carried verbatim from the retrieved article into the planner prompt. Envelope: html_comment · zero_width_joiner · sha256 9f2c…41ab · len 812 · lang en · matches 3 prior incidents.",
      sourceSpanId: "a3f",
      sourceOffset: 612,
      sinkSpanId: "b12",
      sinkOffset: 1204,
    },
    summary:
      "A knowledge-base article authored outside your org instructed the planner to POST customer records to an external host. Untrusted instructions and private data were in the same context with an egress capability available. The trifecta closed.",
    response:
      "DENY at the sink in 412µs. The agent received CausalPolicyDenied: egress not permitted from a tainted context, abandoned that plan, and answered the ticket from the knowledge base alone. Zero bytes left the process. Session s_84f2 marked tainted — sinks require approval for 24h. Alert sent to #sec-agents with the payload withheld. Auto-RCA queued. Containment is not 'we stopped everything'.",
    remediation: [REM_SEND_REPORT_ALLOWLIST, REM_REFENCE, REM_SPLIT_PRINCIPAL, REM_QUARANTINE_KB],
    derivedFrom: "SEC-1039", // pol_egress_3 was created from SEC-1039 on 2026-08-06 — the loop closing
    evidence: "deterministic",
    latencyUs: 412,
    occurrences: 14, // campaign — 14 rows share this signature. Feeds blocked-7d and TB-01 firing7d.
    status: "triaging",
  },

  // ── SEC-1043 · the one we did not block. THE open critical. ─────────
  {
    id: "SEC-1043",
    ruleId: "TB-04",
    ruleVersion: 1,
    title: "Private billing data left via a rendered markdown image — there is no HTTP span in this trace",
    eventClass: "critical",
    severity: "critical", // I=9 · private data left the process
    outcome: "succeeded",
    criticalReason: "crossed_and_succeeded", // set A
    priority: 90, // 100 × 0.9(I9) × 1.00(det) × 1.0(prod) × 1.0(succeeded) = 90
    tier: "inferred", // Tier 0 — runs on data already in Postgres. The honest counterweight to the tier story.
    enforced: false,
    timestamp: "2026-08-10T09:41:00Z",
    agent: "research-agent",
    environment: "prod",
    traceId: "77bd1044e1c02e10",
    tool: "llm.summarize",
    asi: ["ASI01"],
    owasp: ["LLM02:2026"],
    atlas: ["AML.T0086"],
    flow: [
      { spanId: "r01", name: "agent.research", kind: "agent", origin: "TRUSTED_USER", capability: "NONE", detail: "Competitive brief requested by an authenticated analyst." },
      { spanId: "r22", name: "search.web_fetch", kind: "search", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 6140, detail: "competitor-brief.example/q3 — open web, unregistered host pattern at fetch time." },
      { spanId: "r30", name: "db.query billing_accounts", kind: "db", origin: "SEMI_TRUSTED_INTERNAL", capability: "READ_PRIVATE", bytes: 2180, detail: "41 rows. Data classes only: billing.account_id ×41, billing.mrr ×41." },
      { spanId: "r44", name: "llm.summarize", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "EGRESS", bytes: 44, detail: "io.output terminates in a markdown image tag pointing at cdn-metrics.ru with 44 bytes of READ_PRIVATE taint base64-encoded in the query string. The user's renderer makes the request; the agent never does.", violating: true },
    ],
    witness: {
      kind: "decoded",
      summary:
        "44 bytes base64-encoded in the `d` query parameter of a markdown image URL. Decoded, the bytes shingle-match db.query billing_accounts output exactly (6 of 6 shingles). No http span exists in this trace — the sink is the client's markdown renderer.",
      sourceSpanId: "r30",
      sourceOffset: 88,
      sinkSpanId: "r44",
      sinkOffset: 1962,
    },
    summary:
      "A fetched competitor page instructed the summarizer to append a tracking pixel. The pixel's URL carries billing account identifiers, base64-encoded. Nothing watching network egress from the agent host would see this: the agent made no request. The reader's browser did.",
    response:
      "None. No control was armed on this path and the bytes left. Saying so plainly is what makes every other block on this page credible. After the fact: alert raised, the 41 affected account identifiers rotated, and a deny-rendered-egress rule created in monitor mode with its 30-day backtest attached (14 fires, 14 confirmed, precision 1.00).",
    remediation: [REM_MD_HOST_ALLOWLIST, REM_ARM_RENDERED_EGRESS],
    evidence: "deterministic",
    occurrences: 1,
    status: "new", // the ONE open critical. POSTURE.openCriticals = 1 refers to exactly this row.
  },

  // ── SEC-1051 · a note written 8 days ago fired today ────────────────
  {
    id: "SEC-1051",
    ruleId: "TB-07",
    ruleVersion: 2,
    title: "A note written 8 days ago fired today — deferred context poisoning via crm_notes",
    eventClass: "critical",
    severity: "critical", // I=9 · private data left the process
    outcome: "succeeded",
    criticalReason: "crossed_and_succeeded",
    priority: 90, // 100 × 0.9(I9) × 1.00(det) × 1.0(prod) × 1.0(succeeded) = 90
    tier: "declared",
    enforced: false,
    timestamp: "2026-08-11T16:02:00Z", // lands 1h31m AFTER POSTURE.measuredAt — see the note on POSTURE
    agent: "billing-agent",
    environment: "prod",
    traceId: "2ef7c19a4b08d331",
    tool: "tool.send_email",
    asi: ["ASI06"],
    owasp: ["LLM07:2026"],
    atlas: ["AML.T0051"],
    flow: [
      { spanId: "w10", name: "http.fetch inbound-email", kind: "http", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 1420, detail: "Aug 3 11:07 · trace 9ac4… · inbound-email webhook. Classified informational at the time; see SEC-1052." },
      { spanId: "w18", name: "tool.crm_notes_write", kind: "memory", origin: "UNTRUSTED_EXTERNAL", capability: "MEMORY_WRITE", bytes: 386, detail: "Aug 3 · note persisted to crm_notes. 6 shingles recorded in context_provenance, labelled UNTRUSTED_EXTERNAL. No sink reached that day." },
      { spanId: "q05", name: "db.query crm_notes", kind: "db", origin: "UNTRUSTED_EXTERNAL", capability: "READ_PRIVATE", bytes: 386, detail: "Aug 11 · read back into context. crm_notes is REGISTERED untrusted, not inferred — inference from kind='db' would have said SEMI_TRUSTED_INTERNAL and missed this entirely." },
      { spanId: "q11", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 386, detail: "Refund-handling plan assembled with the stored note in scope." },
      { spanId: "q19", name: "tool.send_email", kind: "tool", origin: "UNTRUSTED_EXTERNAL", capability: "EGRESS", bytes: 84_320, detail: "Invoice PDF sent to an external recipient the note supplied. Status ok.", violating: true },
    ],
    witness: {
      kind: "shingle",
      summary:
        "3 of the 6 shingles stored at write time on Aug 3 match the bytes read back on Aug 11. Dwell 8d 4h 55m. The write-time row (SEC-1052) was informational and nobody looked at it — retaining it is what makes this joinable.",
      sourceSpanId: "w18",
      sourceOffset: 240,
      sinkSpanId: "q05",
      sinkOffset: 0,
    },
    summary:
      "An inbound email wrote a note into crm_notes on Aug 3. Nothing bad happened that day and nothing alerted. On Aug 11 a different trace read the note back into a planner and the agent emailed an invoice to the address the note named. No stateless interceptor has anywhere to keep the fact that connects these two runs.",
    response:
      "None at the sink. The write was recorded as informational on Aug 3 with its shingles indexed, which is the only reason the join is possible today. Post-hoc: the 4 other notes carrying the same write-time fingerprint are quarantined and the recipient domain is added to the egress review list.",
    remediation: [
      REM_LABEL_ON_READ,
      {
        title: "Quarantine 4 notes sharing the write-time fingerprint",
        detail: "Four other crm_notes rows carry shingles from the same Aug 3 ingest and have not yet been read back. Hold them out of retrieval pending review.",
        deltaScore: 0, // containment, not a posture cut
        diffLines: 1,
        action: "arm_rule",
      },
    ],
    derivedFrom: "SEC-1052", // the informational write-time row this was promoted from
    evidence: "deterministic",
    occurrences: 1,
    status: "new",
  },

  // ── SEC-1049 · a tool changed its own description ───────────────────
  {
    id: "SEC-1049",
    ruleId: "TB-09",
    ruleVersion: 1,
    title: "An MCP tool changed its own description with no commit behind it",
    eventClass: "blocked",
    severity: "high", // I=7 · supply-chain redefinition invoked
    outcome: "blocked",
    priority: 11, // 100 × 0.7(I7) × 1.00(det) × 1.0(prod) × 0.15(blocked) = 10.5 → 11
    tier: "declared",
    enforced: true,
    timestamp: "2026-08-09T08:14:00Z",
    agent: "devops-copilot",
    environment: "prod",
    traceId: "b7e04412ac9f6620",
    tool: "tool.jira_search",
    asi: ["ASI04"],
    owasp: ["LLM03:2026"],
    atlas: ["AML.T0011.002"],
    flow: [
      { spanId: "m02", name: "tool.jira_search", kind: "tool", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 2960, detail: "@acme/jira-mcp. causal.tool.description_hash was d41a… across 214 invocations through Aug 6, then b7e0… from Aug 9. One line added to the description." },
      { spanId: "m05", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 118, detail: "Tool selection witnessed only in the changed description and in no trusted upstream — this is what TB-02 fires on." },
      { spanId: "m07", name: "tool.repo_read", kind: "tool", origin: "UNTRUSTED_EXTERNAL", capability: "READ_PRIVATE", bytes: 0, detail: "Denied before invoke. The follow-on read never executed.", violating: true },
    ],
    witness: {
      kind: "declared",
      summary:
        "Declared description hash changed between two invocations: d41a…8c07 (214 invocations, through Aug 6) → b7e0…2f19 (from Aug 9). One line added, 47 bytes. The added line names an external recipient; it is rendered as a diff on the incident page, never inlined here.",
      sourceSpanId: "m02",
      sinkSpanId: "m07",
    },
    summary:
      "A tool your agent has called 214 times redefined itself. RCA's finding is a git non-event: no commit in this repository between 2026-08-06 and 2026-08-09 touches this tool's definition. The change originated outside your repository. Nothing in this detection reads natural language for intent.",
    response:
      "The follow-on repo_read at #m07 was denied by the rule that fires on a tool selection witnessed only in untrusted content. The agent reported the tool as unavailable and continued without it.",
    remediation: [
      {
        title: "Pin @acme/jira-mcp@1.4.2",
        detail: "Pin the server version in package.json and record the accepted description hash in the lockfile the guard checks, so a redefinition fails the check instead of arriving silently.",
        deltaScore: 3,
        diffLines: 2,
        action: "open_pr",
      },
    ],
    evidence: "deterministic",
    latencyUs: 96,
    occurrences: 1,
    status: "resolved",
  },

  // ── SEC-1058 · the approval summary omitted the branch ──────────────
  {
    id: "SEC-1058",
    ruleId: "TB-11",
    ruleVersion: 1,
    title: "The approval summary omitted the branch the agent was about to delete",
    eventClass: "critical",
    severity: "high", // I=7 · approval integrity gap on a destructive action
    outcome: "succeeded",
    criticalReason: "crossed_and_succeeded",
    priority: 70, // 100 × 0.7(I7) × 1.00(det) × 1.0(prod) × 1.0(succeeded) = 70
    tier: "declared",
    enforced: false,
    timestamp: "2026-08-07T16:44:00Z",
    agent: "deploy-bot",
    environment: "prod",
    traceId: "e410cc72b1904d55",
    tool: "github.delete_ref",
    asi: ["ASI09"],
    owasp: [],
    atlas: [],
    flow: [
      { spanId: "d01", name: "agent.branch_cleanup", kind: "agent", origin: "TRUSTED_USER", capability: "NONE", detail: "\"clean up stale preview branches\" — authenticated operator." },
      { spanId: "d04", name: "llm.plan", kind: "llm", origin: "TRUSTED_OPERATOR", capability: "NONE", bytes: 214, detail: "io.output names 3 refs, all under preview/." },
      { spanId: "d07", name: "human.approve", kind: "approval", origin: "TRUSTED_USER", capability: "NONE", bytes: 214, detail: "io.input = span d04's summary verbatim. io.output = {decision:\"approve\", by:\"mchen\"}. The human consented to the summary, not to the arguments." },
      { spanId: "d09", name: "github.delete_ref", kind: "tool", origin: "TRUSTED_OPERATOR", capability: "MUTATE", bytes: 96, detail: "4 refs in io.input. Status ok. The fourth was never in the summary.", violating: true },
    ],
    witness: {
      kind: "declared",
      summary:
        "Deterministic entity-set difference, confidence 1.0. summary_entities = {preview/pr-881, preview/pr-884, preview/pr-889}; args_entities adds release/2026.08. args_entities ⊄ summary_entities. `release/2026.08` appears in the tool arguments and in no part of the summary the human approved.",
      sourceSpanId: "d07",
      sourceOffset: 0,
      sinkSpanId: "d09",
      sinkOffset: 61,
    },
    summary:
      "There is no untrusted content anywhere in this trace and no injection. The approval card rendered the model's own prose summary, the human approved the prose, and the tool received a fourth argument the prose never mentioned. This attacks the safety net teams believe is their backstop.",
    response:
      "None — the deletion succeeded and release/2026.08 was removed. Restored from reflog at 17:02 by the on-call. The detection is a set difference over entities, not a judge call, so it would have been decidable before the call rather than after it.",
    remediation: [REM_APPROVAL_DIFF],
    evidence: "deterministic",
    occurrences: 1,
    status: "resolved", // shipped c02b7e9→revert on Aug 8; keeps POSTURE.openHighs = 0
  },

  // ── Set B · the control is not holding. Zero attacks present. ───────
  {
    id: "SEC-1055",
    ruleId: "TB-01",
    ruleVersion: 3,
    title: "No enforcement point on billing-agent's egress path",
    eventClass: "critical",
    severity: "critical", // I=9 · a gap inherits the impact of the boundary it fails to protect
    outcome: "none",
    criticalReason: "gap",
    priority: 90, // 100 × 0.9(I9) × 1.00(det) × 1.0(prod) × 1.0(nothing stopped it) = 90
    tier: "inferred",
    enforced: false, // this IS the finding
    timestamp: "2026-08-11T13:58:44Z",
    agent: "billing-agent",
    environment: "prod",
    traceId: "3c4d5e6f7a8b9c00", // the same trace id as the billing incident in the trace explorer
    tool: null, // there is no tool — that is the point
    asi: ["ASI02"],
    owasp: ["LLM01:2026"],
    atlas: [],
    flow: [
      { spanId: "g02", name: "agent.invoice_run", kind: "agent", origin: "TRUSTED_OPERATOR", capability: "NONE", detail: "Scheduled invoice run. 1,204 spans arrived from billing-agent in the last 7 days." },
      { spanId: "g14", name: "db.query invoices", kind: "db", origin: "SEMI_TRUSTED_INTERNAL", capability: "READ_PRIVATE", bytes: 9840, detail: "Executed. Produced no policy decision record." },
      { spanId: "g22", name: "llm.compose", kind: "llm", origin: "SEMI_TRUSTED_INTERNAL", capability: "NONE", bytes: 3120, detail: "Executed. Produced no policy decision record." },
      { spanId: "g31", name: "http.post smtp-relay", kind: "http", origin: "SEMI_TRUSTED_INTERNAL", capability: "EGRESS", bytes: 41_200, detail: "Executed 1,204 times in 7 days. Zero decision records. The boundary declared critical has no PEP on this path.", violating: true },
    ],
    witness: {
      kind: "declared",
      summary:
        "Absence is the evidence: 1,204 spans matching boundary `lethal-trifecta` (severity critical) executed on billing-agent in 7 days and produced 0 policy decision records. No guard is wrapped on this service.",
      sinkSpanId: "g31",
    },
    summary:
      "Nothing attacked billing-agent. A boundary you declared critical simply is not running on a path that executed 1,204 times this week. A blocked prompt injection is routine; an unenforced egress rule on a quiet Tuesday is the row that says the machine you paid for is off.",
    response:
      "Detected at 13:58:44. pol_egress_3 was extended to billing-agent and armed in monitor at 14:07:12, then canary 5% at 14:19. The enforcement point now exists on this path, which is why the posture score carries no hard ceiling.",
    remediation: [
      {
        title: "Extend pol_egress_3 to billing-agent",
        detail: "One entry in causal.policy.yaml puts the existing trifecta boundary on billing-agent's egress path. Already landed — kept here as the audit record.",
        deltaScore: 0, // already applied at 14:07 — no remaining recovery
        diffLines: 3,
        action: "open_pr",
      },
    ],
    evidence: "deterministic",
    occurrences: 1,
    status: "resolved", // resolved 14:07, BEFORE POSTURE.measuredAt 14:31 → unenforcedCriticalBoundary = false
  },

  {
    id: "SEC-1056",
    ruleId: "TB-10",
    ruleVersion: 2,
    title: "Untrusted MCP return reached shell arguments while the rule sat in monitor",
    eventClass: "critical",
    severity: "high", // I=8 · untrusted content reached EXECUTE and it ran
    outcome: "succeeded",
    criticalReason: "bypass", // would have denied, nothing was armed, the action succeeded
    priority: 80, // 100 × 0.8(I8) × 1.00(det) × 1.0(prod) × 1.0(succeeded) = 80
    tier: "inferred",
    enforced: false,
    timestamp: "2026-08-09T11:26:00Z",
    agent: "devops-copilot",
    environment: "prod",
    traceId: "5a19d0c4471ee802",
    tool: "shell.exec",
    asi: ["ASI05"],
    owasp: ["LLM03:2026"],
    atlas: ["AML.T0051"],
    flow: [
      { spanId: "x03", name: "tool.mcp_pdf_extract", kind: "tool", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 4180, detail: "mcp://vendor/pdf-tools — unregistered at ingest time, resolved UNKNOWN then reclassified." },
      { spanId: "x09", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 0, detail: "Planner paraphrased the extracted content. No verbatim bytes survived." },
      { spanId: "x15", name: "shell.exec", kind: "shell", origin: "UNTRUSTED_EXTERNAL", capability: "EXECUTE", bytes: 218, detail: "Ran. Exit 0. TB-10 evaluated to would-deny and the rule was at canary 5%; this trace hashed outside the canary bucket.", violating: true },
    ],
    witness: {
      kind: "opaque",
      summary:
        "The planner rewrote the extracted content rather than copying it, so no shingle survives into the shell arguments. Taint propagated by rule — an llm span that read untrusted bytes produces tainted output unconditionally, whether or not any substring carries through.",
      sourceSpanId: "x03",
      sinkSpanId: "x15",
    },
    summary:
      "The attack worked and we watched. TB-10 evaluated this path, decided deny, and did nothing because the rule was at canary 5% and this trace hashed outside the bucket. The would-have-denied ledger is the enforcement rollout backlog, and this row is what it costs to still be on it.",
    response:
      "Monitor-mode record written; no denial. The identical rule blocked 23 occurrences on other traces in the same window (SEC-1047) — the only difference between those and this one is the canary hash. TB-10 promoted to canary 25% on Aug 10.",
    remediation: [
      {
        title: "Promote TB-10 to canary 25%",
        detail: "1,412 evaluations over 21 days in monitor, would-block rate 0.31%, all triaged. The rule clears the readiness bar; the only thing holding it at 5% is the schedule.",
        deltaScore: 2,
        diffLines: 1,
        action: "arm_rule",
      },
    ],
    evidence: "deterministic",
    occurrences: 1,
    status: "resolved",
  },

  {
    id: "SEC-1059",
    ruleId: "TB-10",
    ruleVersion: 2,
    title: "Run contained — untrusted retrieval reached a MUTATE sink and the session was quarantined",
    eventClass: "critical",
    severity: "medium", // I=6 · untrusted content reached a capability sink, contained
    outcome: "contained",
    criticalReason: "quarantine",
    priority: 30, // 100 × 0.6(I6) × 1.00(det) × 1.0(prod) × 0.5(contained) = 30
    tier: "enforced",
    enforced: true,
    timestamp: "2026-08-08T20:11:00Z",
    agent: "stock-tool-agent",
    environment: "prod",
    traceId: "2b3c4d5e6f7a8b90", // matches the stock-tool-agent trace in the explorer
    tool: "db.query",
    asi: ["ASI05"],
    owasp: ["LLM03:2026"],
    atlas: ["AML.T0051"],
    flow: [
      { spanId: "k04", name: "search.doc_lookup", kind: "search", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 3240, detail: "Retrieved analyst note, vendor-supplied feed." },
      { spanId: "k11", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 96, detail: "Planner emitted a write against the positions table." },
      { spanId: "k18", name: "db.query positions", kind: "db", origin: "UNTRUSTED_EXTERNAL", capability: "MUTATE", bytes: 0, detail: "UPDATE denied by grants[db].deny. Session quarantined; 6 downstream spans marked NOT-RUN.", violating: true },
    ],
    witness: {
      kind: "shingle",
      summary: "12 bytes carried from the retrieved note into the planner's write argument. The quarantine is the finding: 6 spans that would have followed did not run, and the blast radius that did not happen is visible in the waterfall.",
      sourceSpanId: "k04",
      sourceOffset: 2880,
      sinkSpanId: "k11",
      sinkOffset: 740,
    },
    summary:
      "Untrusted retrieval reached a system-of-record write. The capability-shaped control held: the write was denied by grant, the agent tried a second phrasing, and that was denied too. No regex, no classifier, no natural language.",
    response:
      "DENY on the UPDATE. The agent replanned and was denied again on a DELETE variant. Session quarantined for 24h — a quarantine is a critical-class event because a contained run is still a run we had to stop, and the operator should know their agent spent the afternoon boxed in.",
    remediation: [
      {
        title: "Register the vendor analyst feed",
        detail: "The feed resolves UNKNOWN at every tier. Registering it as UNTRUSTED_EXTERNAL turns a TB-12 coverage finding into a confident label on every future run.",
        deltaScore: 1,
        diffLines: 1,
        action: "open_registry",
      },
    ],
    evidence: "deterministic",
    latencyUs: 188,
    occurrences: 1,
    status: "resolved",
  },

  {
    id: "SEC-1050",
    ruleId: "TB-10",
    ruleVersion: 2,
    title: "Break-glass active — enforcement manually dropped to monitor",
    eventClass: "critical",
    severity: "medium", // I=5 · a gap on a high-severity boundary inherits its impact
    outcome: "none",
    criticalReason: "break_glass",
    priority: 8, // 100 × 0.5(I5) × 1.00(det) × 1.0(prod) × 0.15(nothing executed against it) = 7.5 → 8
    tier: "enforced",
    enforced: false,
    timestamp: "2026-08-05T09:12:00Z",
    agent: "devops-copilot",
    environment: "prod",
    traceId: "—",
    tool: null,
    asi: ["ASI05"],
    owasp: [],
    atlas: [],
    flow: [
      { spanId: "bg1", name: "policy.break_glass", kind: "function", origin: "TRUSTED_OPERATOR", capability: "NONE", detail: "TB-10 dropped enforce → monitor by j.rivera. Reason: \"release freeze cutover, shell steps failing closed on the migration runner\"." },
      { spanId: "bg2", name: "policy.window", kind: "function", origin: "TRUSTED_OPERATOR", capability: "EXECUTE", bytes: 0, detail: "Auto-expired after 3h48m at 12:60 UTC. 41 shell spans executed unguarded inside the window; none evaluated to deny.", violating: true },
    ],
    witness: {
      kind: "declared",
      summary: "Operator-declared control change, recorded as a first-class event. Actor j.rivera, mandatory reason supplied, window 3h48m of a 4h maximum, auto-expiry fired. 41 spans executed inside the window, 0 would-denies.",
    },
    summary:
      "Platform engineers will not adopt a control with no off switch. The trick is making the off switch loud and self-expiring — so it is recorded here as critical, with an actor, a typed reason, and a clock.",
    response:
      "Enforcement restored automatically at expiry. The 41 spans that ran inside the window were replayed against the rule after the fact: none would have been denied, so the window cost nothing. That replay is only possible because the decision is a pure function of (tool, args, taint) and all three were stored.",
    remediation: [],
    evidence: "deterministic",
    occurrences: 1,
    status: "resolved",
  },

  // ── Blocked ledger ─────────────────────────────────────────────────
  {
    id: "SEC-1047",
    ruleId: "TB-10",
    ruleVersion: 2,
    title: "Untrusted retrieval reached shell arguments — denied at the sink",
    eventClass: "blocked",
    severity: "high", // I=8
    outcome: "blocked",
    priority: 12, // 100 × 0.8(I8) × 1.00(det) × 1.0(prod) × 0.15(blocked) = 12
    tier: "enforced",
    enforced: true,
    timestamp: "2026-08-08T13:04:00Z",
    agent: "devops-copilot",
    environment: "prod",
    traceId: "9013fa2c77b41e08",
    tool: "shell.exec",
    asi: ["ASI05"],
    owasp: ["LLM03:2026"],
    atlas: ["AML.T0051"],
    flow: [
      { spanId: "s02", name: "search.repo_docs", kind: "search", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 2140, detail: "Vendor documentation bundle." },
      { spanId: "s08", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 61, detail: "Planner context." },
      { spanId: "s12", name: "shell.exec", kind: "shell", origin: "UNTRUSTED_EXTERNAL", capability: "EXECUTE", bytes: 0, detail: "Denied before invoke, 23 occurrences over the window. Argv array, nothing shell-interpreted.", violating: true },
    ],
    witness: {
      kind: "shingle",
      summary: "61 bytes carried from the documentation bundle into the shell argument across 23 occurrences of the same signature. Campaign collapsed to one row.",
      sourceSpanId: "s02",
      sourceOffset: 1902,
      sinkSpanId: "s12",
      sinkOffset: 0,
    },
    summary: "The same signature 23 times in one window, denied every time. This is the routine case, and it belongs in a ledger rather than a queue.",
    response: "DENY at the sink on all 23. The agent replanned each time and completed the task through a non-executing path on 21 of them.",
    remediation: [],
    evidence: "deterministic",
    latencyUs: 204,
    occurrences: 23, // feeds blocked-7d and TB-10 firing7d
    status: "resolved",
  },

  {
    id: "SEC-1053",
    ruleId: "TB-14",
    ruleVersion: 1,
    title: "Canary credential appeared in an egress span's arguments",
    eventClass: "blocked",
    severity: "critical", // I=10 · a real credential in this position leaves the process
    outcome: "blocked",
    priority: 15, // 100 × 1.0(I10) × 1.00(det) × 1.0(prod) × 0.15(blocked) = 15
    tier: "enforced",
    enforced: true,
    timestamp: "2026-08-06T18:37:00Z",
    agent: "support-triage-agent",
    environment: "prod",
    traceId: "cc41b90e2a7f5514",
    tool: "http.post",
    asi: ["ASI01"],
    owasp: ["LLM02:2026"],
    atlas: ["AML.T0057"],
    flow: [
      { spanId: "c01", name: "search.kb_lookup", kind: "search", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 940, detail: "kb://zendesk/* — same source class as SEC-1042." },
      { spanId: "c06", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 128, detail: "Planner context." },
      { spanId: "c12", name: "http.post", kind: "http", origin: "UNTRUSTED_EXTERNAL", capability: "EGRESS", bytes: 0, detail: "Denied. The request body carried a planted, syntactically valid, non-functional key.", violating: true },
    ],
    witness: {
      kind: "exact",
      summary:
        "Exact match on a registered canary credential (CAUSAL-CANARY-7e41b9) in the egress arguments. The canary is syntactically valid and functionally inert, so its appearance is unambiguous — no entropy heuristic, no key-shape guess, and no judge.",
      sourceSpanId: "c06",
      sourceOffset: 3061,
      sinkSpanId: "c12",
      sinkOffset: 412,
    },
    summary:
      "A planted key that is valid-looking and does nothing appeared in an outbound request body, 3 times in one window. Highest value-per-line control in the design: preventative, deterministic, and it converts secret exfiltration into an assertion needing no model at all.",
    response: "DENY on all 3. The canary is inert so nothing was at risk even had it left; the value is that the attempt is unambiguous.",
    remediation: [],
    evidence: "deterministic",
    latencyUs: 61,
    occurrences: 3, // feeds blocked-7d and TB-14 firing7d
    status: "resolved",
  },

  // ── Suspicious ──────────────────────────────────────────────────────
  {
    id: "SEC-1039",
    ruleId: "TB-01",
    ruleVersion: 2,
    title: "Would-have-denied: untrusted retrieval reached send_report while the rule was in monitor",
    eventClass: "suspicious",
    severity: "medium", // I=6
    outcome: "attempted",
    priority: 30, // 100 × 0.6(I6) × 1.00(det) × 1.0(prod) × 0.5(attempted) = 30
    tier: "inferred",
    enforced: false,
    timestamp: "2026-08-06T10:18:00Z",
    agent: "support-triage-agent",
    environment: "prod",
    traceId: "aa20fe4471c9d310",
    tool: "http.post",
    asi: ["ASI01", "ASI02"],
    owasp: ["LLM01:2026"],
    atlas: ["AML.T0086"],
    flow: [
      { spanId: "p02", name: "search.kb_lookup", kind: "search", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 660, detail: "kb://zendesk/*." },
      { spanId: "p07", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 38, detail: "Planner context." },
      { spanId: "p11", name: "http.post send_report", kind: "http", origin: "UNTRUSTED_EXTERNAL", capability: "EGRESS", bytes: 88, detail: "Executed — the destination happened to be the internal allowlist entry, so nothing left the perimeter. Evaluated would-deny.", violating: true },
    ],
    witness: {
      kind: "shingle",
      summary: "38 bytes carried into the planner. Monitor-mode record only; the rule did not act.",
      sourceSpanId: "p02",
      sourceOffset: 402,
      sinkSpanId: "p07",
      sinkOffset: 980,
    },
    summary:
      "Five days before SEC-1042, the same boundary was crossed and nothing was armed. This row is why pol_egress_3 exists — and SEC-1042's header links back here.",
    response: "Monitor record written. pol_egress_3 was authored from this event on 2026-08-06 and armed to enforce on 2026-08-08 after a 30-day replay showed 9 would-denies across 6 traces at +0.3ms p95.",
    remediation: [],
    evidence: "deterministic",
    occurrences: 2,
    status: "resolved",
  },

  {
    id: "SEC-1046",
    ruleId: "TB-05",
    ruleVersion: 1,
    title: "Boundary downgrade — retrieved docs that arrived fenced now arrive bare",
    eventClass: "suspicious",
    severity: "medium", // I=4 · drift with a capability sink downstream
    outcome: "none",
    priority: 6, // 100 × 0.4(I4) × 1.00(det) × 1.0(prod) × 0.15(none) = 6
    tier: "inferred",
    enforced: false,
    timestamp: "2026-08-11T13:41:02Z",
    agent: "support-triage-agent",
    environment: "prod",
    traceId: "d81a4c0b6f2e7791",
    tool: null,
    asi: ["ASI01"],
    owasp: ["LLM01:2026"],
    atlas: [],
    flow: [
      { spanId: "f03", name: "search.kb_lookup", kind: "search", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 812, detail: "Framing fingerprint for this span name was <untrusted_document>…</untrusted_document> on 100% of a 7-day baseline through Aug 5." },
      { spanId: "f08", name: "llm.plan", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 812, detail: "From Aug 6, 62 of 62 invocations arrive bare-concatenated. The delimiter is gone.", violating: true },
    ],
    witness: {
      kind: "declared",
      summary:
        "Framing fingerprint regressed from `fenced` to `bare` at 9c41ab2 (prompts/triage.md), j.rivera, Aug 6. 62 of 62 invocations since. This finding requires holding trace history and the repository at the same time.",
      sourceSpanId: "f03",
      sinkSpanId: "f08",
    },
    summary:
      "Nobody attacked anything. A prompt-template commit removed the delimiter that told the model which bytes were quoted material, and 62 runs since have concatenated untrusted content straight into the planner. Same commit as SEC-1042's root cause.",
    response: "Monitor only — TB-05 is a baseline anomaly with no crossing, so it badges and digests rather than pages.",
    remediation: [REM_REFENCE], // deduped against SEC-1042's copy by topRemediations()
    evidence: "deterministic",
    occurrences: 62, // = TB-05 firing7d
    status: "triaging",
  },

  {
    id: "SEC-1057",
    ruleId: "TB-08",
    ruleVersion: 1,
    title: "github.delete_ref exercised outside its 14-day argument envelope",
    eventClass: "suspicious",
    severity: "medium", // I=4
    outcome: "none",
    priority: 6, // 100 × 0.4(I4) × 1.00(det) × 1.0(prod) × 0.15(none) = 6
    tier: "declared",
    enforced: false,
    timestamp: "2026-08-11T13:41:02Z",
    agent: "deploy-bot",
    environment: "prod",
    traceId: "e410cc72b1904d55", // same trace as SEC-1058 — two findings, one trace
    tool: "github.*",
    asi: ["ASI03"],
    owasp: ["LLM03:2026"],
    atlas: [],
    flow: [
      { spanId: "d09", name: "github.delete_ref", kind: "tool", origin: "TRUSTED_OPERATOR", capability: "MUTATE", bytes: 96, detail: "14-day envelope for this tool's `refs` argument is exclusively the prefix preview/. A release/ ref is outside the observed shape.", violating: true },
    ],
    witness: {
      kind: "declared",
      summary: "Argument-shape baseline over 14 days: 61 invocations, 61 matching ^preview/. This invocation contains a ref matching ^release/, a prefix never previously seen for this tool.",
      sinkSpanId: "d09",
    },
    summary:
      "The same trace as SEC-1058, found a second way. A single trace routinely contains more than one finding, which is exactly why security writes N rows per trace instead of one verdict.",
    response: "Badge and daily digest. TB-08 is in monitor; the envelope is descriptive, not yet a grant.",
    remediation: [
      {
        title: "Narrow the github.delete_ref grant to preview/*",
        detail: "Compile the observed 14-day envelope into an explicit grant so a release/ ref is a denial rather than an anomaly note.",
        deltaScore: 3,
        diffLines: 13,
        action: "open_pr",
      },
    ],
    evidence: "deterministic",
    occurrences: 3, // = TB-08 firing7d
    status: "triaging",
  },

  // ── Informational · the corpus TB-07 joins against later ────────────
  {
    id: "SEC-1052",
    ruleId: "TB-07",
    ruleVersion: 2,
    title: "Untrusted-origin note persisted to crm_notes — no sink reached",
    eventClass: "informational",
    severity: "low", // I=2 · untrusted content entered context, reached no sink
    outcome: "none",
    priority: 3, // 100 × 0.2(I2) × 1.00(det) × 1.0(prod) × 0.15(none) = 3
    tier: "declared",
    enforced: false,
    timestamp: "2026-08-03T11:07:00Z",
    agent: "billing-agent",
    environment: "prod",
    traceId: "9ac47f1102ba6d40",
    tool: "tool.crm_notes_write",
    asi: ["ASI06"],
    owasp: ["LLM07:2026"],
    atlas: [],
    flow: [
      { spanId: "w10", name: "http.fetch inbound-email", kind: "http", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 1420, detail: "Inbound-email webhook." },
      { spanId: "w18", name: "tool.crm_notes_write", kind: "memory", origin: "UNTRUSTED_EXTERNAL", capability: "MEMORY_WRITE", bytes: 386, detail: "6 shingles indexed into context_provenance, labelled UNTRUSTED_EXTERNAL. No capability sink on this path.", violating: false },
    ],
    witness: {
      kind: "shingle",
      summary: "6 shingles recorded at write time. Nothing happened. This row is the reason SEC-1051 is decidable 8 days later — the informational tier is a corpus, not noise.",
      sourceSpanId: "w10",
      sourceOffset: 980,
      sinkSpanId: "w18",
      sinkOffset: 240,
    },
    summary:
      "Untrusted bytes were persisted into a store that a later run reads. On the day it happened this was correctly boring: taint is not an event; taint reaching a capability sink is the event.",
    response: "Stored, counted, no alert. Retained 90 days. Promoted to SEC-1051 on Aug 11 when the note was read back into a planner and reached an egress sink.",
    remediation: [],
    evidence: "deterministic",
    occurrences: 1,
    status: "resolved",
  },

  {
    id: "SEC-1044",
    ruleId: "TB-12",
    ruleVersion: 1,
    title: "Unlabeled ingress — 7 sources consumed whose origin resolves at no tier",
    eventClass: "informational",
    severity: "low", // I=1 · coverage / inventory fact
    outcome: "none",
    priority: 2, // 100 × 0.1(I1) × 1.00(det) × 1.0(prod) × 0.15(none) = 1.5 → 2
    tier: "inferred",
    enforced: false,
    timestamp: "2026-08-11T00:00:00Z",
    agent: "support-triage-agent",
    environment: "prod",
    traceId: "—",
    tool: null,
    asi: [],
    owasp: [],
    atlas: [],
    flow: [
      { spanId: "u00", name: "ingest.unregistered", kind: "function", origin: "UNKNOWN", capability: "NONE", bytes: 0, detail: "7 distinct source patterns, 340 consuming spans in 24h. UNKNOWN is a coverage gap, never a trust claim." },
      { spanId: "u01", name: "llm.*", kind: "llm", origin: "UNKNOWN", capability: "NONE", bytes: 0, detail: "Consumed into model context with no origin resolvable at any tier.", violating: true },
    ],
    witness: {
      kind: "declared",
      summary:
        "Absence of a label is the evidence. 7 patterns unregistered in source_registry: 3 UNKNOWN-by-default and 4 inferred-but-unconfirmed. See SOURCE_REGISTRY for the rows and which are which.",
    },
    summary:
      "A security dashboard that hides what it cannot see is worse than none. Seven sources feed your agents and nothing in the system can say who authored their bytes.",
    response: "No alert. Counted, and it holds the coverage term down — P is a multiplier on the whole score, so this is not cosmetic.",
    remediation: [REM_INSTRUMENT_CRM, REM_REGISTER_SOURCES],
    evidence: "deterministic",
    occurrences: 340, // = TB-12 firing7d, and the "340×/day" in the register-sources remediation
    status: "new",
  },

  {
    id: "SEC-1045",
    ruleId: "TB-13",
    ruleVersion: 1,
    title: "Shadow tool — pdf_render executes and is declared nowhere in your source",
    eventClass: "informational",
    severity: "low", // I=1 · inventory fact
    outcome: "none",
    priority: 1, // 100 × 0.1(I1) × 1.00(det) × 0.4(staging) × 0.15(none) = 0.6 → 1
    tier: "inferred",
    enforced: false,
    timestamp: "2026-08-10T15:20:00Z",
    agent: "research-agent",
    environment: "staging",
    traceId: "1f77e0a4bb3d2200",
    tool: "tool.pdf_render",
    asi: ["ASI04"],
    owasp: [],
    atlas: [],
    flow: [
      { spanId: "h01", name: "tool.pdf_render", kind: "tool", origin: "UNKNOWN", capability: "EXECUTE", bytes: 0, detail: "8 invocations. Repo grep across acme/research-tools via the RCA sandbox returns 0 declaration sites.", violating: true },
    ],
    witness: {
      kind: "declared",
      summary: "Tool span name observed 8 times; 0 matches in the repository at HEAD (c7d2e19). Observed-behaviour inventory, which static config scanning cannot produce.",
      sinkSpanId: "h01",
    },
    summary:
      "Runtime tool discovery means your supply chain mutates after deployment. This tool runs in staging and exists in no file you own.",
    response: "No alert — staging, and an inventory fact rather than a crossing. Surfaces on the riskiest-tools panel with granted-vs-observed capabilities.",
    remediation: [
      {
        title: "Declare pdf_render in the tool registry",
        detail: "Either declare it with an explicit capability grant or remove the runtime discovery path that introduced it.",
        deltaScore: 2,
        diffLines: 9,
        action: "open_pr",
      },
    ],
    evidence: "deterministic",
    occurrences: 8, // = TB-13 firing7d
    status: "new",
  },

  {
    id: "SEC-1054",
    ruleId: "TB-16",
    ruleVersion: 1,
    title: "Imperative-directive shapes inside untrusted content that entered model context",
    eventClass: "informational", // crossed ∧ sink_cap = ∅ → informational
    severity: "low", // I=2
    outcome: "none",
    priority: 3, // 100 × 0.2(I2) × 0.91(judge conf) × 1.0(prod) × 0.15(none) = 2.7 → 3
    tier: "inferred",
    enforced: false,
    timestamp: "2026-08-11T07:55:00Z",
    agent: "research-agent",
    environment: "prod",
    traceId: "6b2001cc4fa9e173",
    tool: null,
    asi: ["ASI01"],
    owasp: ["LLM01:2026"],
    atlas: ["AML.T0051"],
    flow: [
      { spanId: "j02", name: "search.web_fetch", kind: "search", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 8840, detail: "Open web. Candidate selected by the graph first; the judge only confirmed it." },
      { spanId: "j06", name: "llm.summarize", kind: "llm", origin: "UNTRUSTED_EXTERNAL", capability: "NONE", bytes: 8840, detail: "Entered context. No capability sink downstream on this path — which is why this is informational and not an incident.", violating: false },
    ],
    witness: {
      kind: "opaque",
      summary:
        "The graph selected the candidate; a judge confirmed directive shape at 0.91. Confidence is an opinion and is rendered as its own chip — it multiplies priority for this rule and TB-17 only, and never for a deterministic detection.",
      sourceSpanId: "j02",
      sinkSpanId: "j06",
    },
    summary:
      "One of only two of seventeen detections that read natural language, and it fires as a second pass on a candidate the graph already found. Reached no sink, so it is a badge and a corpus row.",
    response: "No alert. Feeds the daily digest and the source's reputation counter.",
    remediation: [
      {
        title: "Fence web.fetch returns in research.summarize",
        detail: "Wrap fetched page content in <untrusted_document> so the model has a delimiter, matching the fix already open for triage.plan.",
        deltaScore: 2,
        diffLines: 10,
        action: "open_pr",
      },
    ],
    evidence: "judge",
    occurrences: 27, // = TB-16 firing7d
    status: "new",
  },
];

// ── Detections ────────────────────────────────────────────────────────
//
// All 17 rules from §1.4 with their real standards mapping. `firing7d` on each
// row equals the sum of `occurrences` over that rule's events inside the 7-day
// window — asserted by `ruleFiringConsistency()` at the bottom of this file, so
// the Detections table and the Events queue cannot silently disagree.
//
// Only TB-16 and TB-17 use a model, and both are second passes on a candidate
// the deterministic graph already selected.

export const DETECTIONS: Detection[] = [
  {
    id: "TB-01",
    name: "Trifecta closure",
    catches: "Untrusted ingest → private read → egress on one flow path",
    signal: "span DAG + origin labels + capability labels + flow edges",
    availability: "tier0",
    usesModel: false,
    asi: ["ASI01", "ASI02"],
    atlas: ["AML.T0086"],
    mode: "enforce",
    backtest: { fires: 61, confirmed: 54, precision: 0.885, windowDays: 90 },
    firing7d: 17, // SEC-1042 (14) + SEC-1055 (1) + SEC-1039 (2)
  },
  {
    id: "TB-02",
    name: "Instruction provenance violation",
    catches: "Agent took an action witnessed only in untrusted upstream and in no trusted upstream",
    signal: "tool-selection witness + origin labels",
    availability: "tier0",
    usesModel: false,
    asi: ["ASI01"],
    atlas: ["AML.T0051.001"],
    mode: "enforce",
    backtest: { fires: 38, confirmed: 31, precision: 0.816, windowDays: 90 },
    firing7d: 1, // the deny inside SEC-1049 at #m07
  },
  {
    id: "TB-03",
    name: "Secret / hidden-context egress",
    catches: "Credential or system-prompt shingles in an egress span's arguments",
    signal: "env HMAC fingerprints; per-(org, agent) system-prompt shingle set",
    availability: "partial",
    usesModel: false,
    asi: ["ASI01"],
    atlas: ["AML.T0057", "AML.T0056"],
    mode: "monitor",
    backtest: { fires: 4, confirmed: 4, precision: 1.0, windowDays: 90 },
    firing7d: 0,
  },
  {
    id: "TB-04",
    name: "Rendered-egress sink",
    catches: "Markdown image or link to a non-allowlisted host carrying ≥24 bytes of READ_PRIVATE taint — raw, base64 or hex. No HTTP span exists",
    signal: "llm span io.output + taint set",
    availability: "today",
    usesModel: false,
    asi: ["ASI01"],
    atlas: ["AML.T0086"],
    mode: "monitor", // backtest clears the bar; promotion is REM_ARM_RENDERED_EGRESS
    backtest: { fires: 14, confirmed: 14, precision: 1.0, windowDays: 30 },
    firing7d: 1, // SEC-1043
  },
  {
    id: "TB-05",
    name: "Boundary downgrade",
    catches: "Untrusted content whose framing regressed from fenced or tagged to bare-concatenated",
    signal: "per-(span name) framing fingerprint over a 7-day baseline + repo",
    availability: "tier0",
    usesModel: false,
    asi: ["ASI01"],
    atlas: [],
    mode: "monitor",
    backtest: { fires: 9, confirmed: 8, precision: 0.889, windowDays: 90 },
    firing7d: 62, // SEC-1046
  },
  {
    id: "TB-06",
    name: "Cross-agent trust laundering",
    catches: "Agent A ingested untrusted content; agent B's framing treats A's message as trusted",
    signal: "agent→agent span pair + origin at handoff",
    availability: "needs_sdk",
    usesModel: false,
    asi: ["ASI07", "ASI08"],
    atlas: ["AML.T0051"],
    mode: "off",
    firing7d: 0,
  },
  {
    id: "TB-07",
    name: "Deferred context poisoning",
    catches: "Memory write carrying untrusted taint, read back days later into an LLM input",
    signal: "context_provenance shingle index + kind='memory'",
    availability: "needs_sdk",
    usesModel: false,
    asi: ["ASI06"],
    atlas: [],
    mode: "monitor",
    backtest: { fires: 6, confirmed: 5, precision: 0.833, windowDays: 90 },
    firing7d: 1, // SEC-1051 · SEC-1052 is Aug 3, outside the 7-day window
  },
  {
    id: "TB-08",
    name: "Capability escalation / scope drift",
    catches: "Tool exercised outside its 14-day argument envelope, or reachable from untrusted taint for the first time",
    signal: "per-(service, tool) argument-shape baseline from io.input",
    availability: "today",
    usesModel: false,
    asi: ["ASI03"],
    atlas: [],
    mode: "monitor",
    backtest: { fires: 44, confirmed: 19, precision: 0.432, windowDays: 90 },
    firing7d: 3, // SEC-1057
  },
  {
    id: "TB-09",
    name: "Tool supply-chain drift (rug pull)",
    catches: "Tool description or schema hash changed with no commit behind it",
    signal: "causal.tool.description_hash + RCA git check",
    availability: "needs_sdk",
    usesModel: false,
    asi: ["ASI04"],
    atlas: ["AML.T0011.002"],
    mode: "enforce",
    backtest: { fires: 3, confirmed: 3, precision: 1.0, windowDays: 90 },
    firing7d: 1, // SEC-1049
  },
  {
    id: "TB-10",
    name: "Untrusted-to-execute",
    catches: "Untrusted taint reaching shell arguments or a database write",
    signal: "kind='shell' or a db mutation + taint set",
    availability: "tier0",
    usesModel: false,
    asi: ["ASI05"],
    atlas: ["AML.T0051"],
    mode: "canary",
    canaryPct: 25, // promoted from 5% on Aug 10 — SEC-1056's bypass is what 5% cost
    backtest: { fires: 74, confirmed: 68, precision: 0.919, windowDays: 90 },
    firing7d: 26, // SEC-1047 (23) + SEC-1056 (1) + SEC-1059 (1) + SEC-1050 (1)
  },
  {
    id: "TB-11",
    name: "Approval integrity gap",
    catches: "Tool arguments contain named entities the approved summary never mentioned",
    signal: "kind='approval' span + the following tool span; entity-set difference",
    availability: "needs_sdk",
    usesModel: false, // deterministic set difference, not a judge call
    asi: ["ASI09"],
    atlas: [],
    mode: "monitor",
    backtest: { fires: 2, confirmed: 2, precision: 1.0, windowDays: 90 },
    firing7d: 1, // SEC-1058
  },
  {
    id: "TB-12",
    name: "Unlabeled ingress",
    catches: "Content consumed whose origin resolves at no tier",
    signal: "absence of a label",
    availability: "today",
    usesModel: false,
    asi: [],
    atlas: [],
    mode: "monitor",
    backtest: { fires: 2380, confirmed: 2380, precision: 1.0, windowDays: 90 },
    firing7d: 340, // SEC-1044
  },
  {
    id: "TB-13",
    name: "Shadow tool",
    catches: "A tool executes that is declared nowhere in your source",
    signal: "tool span names + repo grep via the existing RCA sandbox",
    availability: "today",
    usesModel: false,
    asi: ["ASI04"],
    atlas: [],
    mode: "monitor",
    backtest: { fires: 11, confirmed: 9, precision: 0.818, windowDays: 90 },
    firing7d: 8, // SEC-1045
  },
  {
    id: "TB-14",
    name: "Canary credential egress",
    catches: "A planted, syntactically valid, non-functional key appears in any egress span",
    signal: "canary registry + egress arguments",
    availability: "needs_sdk",
    usesModel: false,
    asi: ["ASI01"],
    atlas: ["AML.T0057"],
    mode: "enforce",
    backtest: { fires: 3, confirmed: 3, precision: 1.0, windowDays: 90 },
    firing7d: 3, // SEC-1053
  },
  {
    id: "TB-15",
    name: "Behavioral baseline break",
    catches: "Agent outside its 30-day envelope: tool multiset, DAG depth, egress host set, cost",
    signal: "traces / spans history — baseline maturing, 12 of 30 days",
    availability: "today",
    usesModel: false,
    asi: ["ASI10"],
    atlas: [],
    mode: "off", // held off while the baseline matures; the capability is weakest at onboarding
    firing7d: 0,
  },
  {
    id: "TB-16",
    name: "Injected-instruction witness",
    catches: "Imperative-directive shapes inside untrusted content that entered model context",
    signal: "judge call on a candidate the graph already selected",
    availability: "today",
    usesModel: true,
    asi: ["ASI01"],
    atlas: ["AML.T0051"],
    mode: "monitor",
    backtest: { fires: 190, confirmed: 141, precision: 0.742, windowDays: 90 },
    firing7d: 27, // SEC-1054
  },
  {
    id: "TB-17",
    name: "Post-hoc misreport",
    catches: "Final output asserts no change while a MUTATE span in the same trace succeeded",
    signal: "final llm output + mutation spans, judge-confirmed",
    availability: "today",
    usesModel: true,
    asi: ["ASI09"],
    atlas: [],
    mode: "monitor",
    backtest: { fires: 7, confirmed: 5, precision: 0.714, windowDays: 90 },
    firing7d: 0,
  },
];

// ── Coverage, and the other score inputs, derived not typed ───────────
//
// P = Σ(spans × fidelity weight) / spans_total. Rendered ascending on the
// Overview so the worst service is first — uncomfortable by design.

export interface ServiceCoverage {
  service: string;
  repo: string;
  spans: number;
  byTier: Partial<Record<Tier, number>>;
  unlabeled: number;
}

export const COVERAGE_BY_SERVICE: ServiceCoverage[] = [
  { service: "crm-service", repo: "acme/crm-service", spans: 12_000, byTier: {}, unlabeled: 12_000 },
  { service: "infra", repo: "acme/infra", spans: 8_000, byTier: { inferred: 4_800 }, unlabeled: 3_200 },
  { service: "devops-copilot", repo: "acme/devops-copilot", spans: 10_000, byTier: { inferred: 10_000 }, unlabeled: 0 },
  { service: "research-tools", repo: "acme/research-tools", spans: 16_000, byTier: { inferred: 16_000 }, unlabeled: 0 },
  { service: "billing-agents", repo: "acme/billing-agents", spans: 14_000, byTier: { declared: 14_000 }, unlabeled: 0 },
  { service: "support-platform", repo: "acme/support-platform", spans: 40_000, byTier: { enforced: 8_000, declared: 30_000, inferred: 2_000 }, unlabeled: 0 },
];

/** Weighted coverage for one service — the same arithmetic the org-level P uses. */
export function serviceCoverage(s: ServiceCoverage): number {
  const weighted =
    (s.byTier.enforced ?? 0) * TIER_WEIGHT.enforced +
    (s.byTier.declared ?? 0) * TIER_WEIGHT.declared +
    (s.byTier.inferred ?? 0) * TIER_WEIGHT.inferred;
  return s.spans === 0 ? 0 : weighted / s.spans;
}

const TOTAL_SPANS = COVERAGE_BY_SERVICE.reduce((a, s) => a + s.spans, 0); // 100,000
const WEIGHTED_SPANS = COVERAGE_BY_SERVICE.reduce((a, s) => a + serviceCoverage(s) * s.spans, 0); // 64,000

/** Capabilities granted vs reachable from untrusted taint — the L term's raw counts. */
export const CAPABILITY_GRANTS = {
  granted: 14,
  reachableFromUntrusted: 6,
  byAgent: [
    { agent: "support-triage-agent", granted: 5, reachable: 3 },
    { agent: "research-agent", granted: 3, reachable: 2 },
    { agent: "billing-agent", granted: 3, reachable: 1 },
    { agent: "devops-copilot", granted: 2, reachable: 0 },
    { agent: "deploy-bot", granted: 1, reachable: 0 },
  ], // Σ granted = 14, Σ reachable = 6 — matches the totals above
};

/** Egress spans to allowlisted hosts vs all egress spans — the E term's raw counts. */
export const EGRESS_DISCIPLINE = { allowlisted: 1_164, total: 1_200 }; // 0.97

/** Untrusted ingress events reaching a capability sink — the C term's raw counts. */
export const UNTRUSTED_INGRESS = { reachedSink: 42, total: 350 }; // C = 1 − 42/350 = 0.88

/** Security graph assertions passing at HEAD — the R term's raw counts. */
export const SECURITY_ASSERTIONS = { passing: 47, total: 50 }; // 0.94

// ── Posture ───────────────────────────────────────────────────────────
//
// The worked example from §6.2, with every input derived from the counts above
// rather than typed as a decimal.
//
// `measuredAt` is 2026-08-11T14:31Z and `commit` is a91f34d, while deployed HEAD
// is c7d2e19 — 4 commits later. The UI must render the whole number at 40%
// opacity with UNPROVEN AT HEAD. There is a second, sharper reason the score is
// stale: SEC-1051 landed at 16:02, an hour and a half AFTER the measurement, so
// `openCriticals: 1` is honest as of 14:31 and already wrong by dinner.
//
// `openCriticals` counts eventClass === "critical" with status new|triaging as
// of measuredAt → exactly SEC-1043. `openHighs` counts severity "high" open at
// the same instant → 0 (SEC-1049, SEC-1056, SEC-1058 were all resolved by then).
// `unenforcedCriticalBoundary` is DERIVED, not asserted. It was hand-typed false
// on the strength of SEC-1055's gap closing at 14:07 — while SEC-1043 sat in the
// same corpus: critical, prod, enforced:false, outcome succeeded, on TB-04 which
// is still in monitor. That is precisely the condition the ceiling exists for,
// and the panel that printed "every critical boundary has an enforcement point"
// named SEC-1043 as the open critical four lines above. Deriving it costs the
// score nothing (33 is already below the 40 ceiling, so it arms without binding)
// and makes the sentence true.

/**
 * A critical-severity boundary with NO enforcement point on a path that actually
 * executed: a critical event that ran with no control armed and was not stopped.
 * A hole in the perimeter, as distinct from merely having had a bad day — which
 * is why this is the one condition that caps the score rather than scaling it.
 */
export const UNENFORCED_CRITICAL_BOUNDARY = SECURITY_EVENTS.some(
  (e) =>
    e.severity === "critical" &&
    !e.enforced &&
    (e.outcome === "succeeded" || e.outcome === "attempted") &&
    !["resolved", "accepted_risk"].includes(e.status),
);

export const POSTURE: PostureInputs = {
  coverage: WEIGHTED_SPANS / TOTAL_SPANS, // 0.640
  containment: 1 - UNTRUSTED_INGRESS.reachedSink / UNTRUSTED_INGRESS.total, // 0.880
  leastPrivilege: 1 - CAPABILITY_GRANTS.reachableFromUntrusted / CAPABILITY_GRANTS.granted, // 0.571
  egressDiscipline: EGRESS_DISCIPLINE.allowlisted / EGRESS_DISCIPLINE.total, // 0.970
  durability: SECURITY_ASSERTIONS.passing / SECURITY_ASSERTIONS.total, // 0.940
  openCriticals: 1,
  openHighs: 0,
  unenforcedCriticalBoundary: UNENFORCED_CRITICAL_BOUNDARY,
  measuredAt: "2026-08-11T14:31:00Z",
  commit: "a91f34d",
  headCommit: "c7d2e19",
  commitsSince: 4,
};

// ── Perimeter ─────────────────────────────────────────────────────────
//
// Five cells, one wiring diagram. `detections` partitions all 17 rules exactly
// once: 5 + 4 + 3 + 2 + 3 = 17 = DETECTIONS.length.
//
// SOURCES     TB-02 TB-05 TB-06 TB-12 TB-16
// CONTEXT     TB-07 TB-09 TB-13 TB-17
// EGRESS      TB-03 TB-04 TB-14
// EXECUTE     TB-08 TB-10
// CONTAINMENT TB-01 TB-11 TB-15

/**
 * Which detections defend each boundary. Lives here rather than in the view
 * because the Perimeter strip's mode has to be DERIVED from these — authoring it
 * separately is how the strip came to claim "EGRESS: canary 25%" over three
 * rules of which none was canary, and "nothing on an observe-only path is
 * denied" over a boundary that had denied SEC-1049.
 */
export const BOUNDARY_RULES: Record<PerimeterCell["key"], string[]> = {
  SOURCES: ["TB-02", "TB-05", "TB-06", "TB-12", "TB-16"],
  CONTEXT: ["TB-07", "TB-09", "TB-13", "TB-17"],
  EGRESS: ["TB-03", "TB-04", "TB-14"],
  EXECUTE: ["TB-08", "TB-10"],
  CONTAINMENT: ["TB-01", "TB-11", "TB-15"],
};

/** off < monitor < canary < enforce. */
const MODE_RANK: Record<Detection["mode"], number> = { off: 0, monitor: 1, canary: 2, enforce: 3 };

/**
 * A boundary is only as armed as its weakest ENABLED rule — one rule left in
 * monitor means the boundary is not enforcing, however many siblings are.
 *
 * A disabled rule is deliberately NOT folded into that: reporting SOURCES as
 * "off" because 1 of its 5 rules is disabled would be as misleading as the
 * authored value it replaces, in the other direction. Disabled rules are a
 * coverage hole, counted separately, so the strip can say "monitor · 1 rule off"
 * — which is the fact a platform lead actually acts on.
 */
function boundaryMode(key: PerimeterCell["key"]): Pick<PerimeterCell, "mode" | "canaryPct"> {
  const rules = BOUNDARY_RULES[key]
    .map((id) => DETECTIONS.find((d) => d.id === id))
    .filter((d): d is Detection => d !== undefined);
  const enabled = rules.filter((r) => r.mode !== "off");
  if (!enabled.length) return { mode: "off" };
  const weakest = enabled.reduce((a, b) => (MODE_RANK[b.mode] < MODE_RANK[a.mode] ? b : a));
  if (weakest.mode !== "canary") return { mode: weakest.mode };
  // Among canary rules the smallest rollout is the honest number for the boundary.
  const pct = Math.min(...enabled.filter((r) => r.mode === "canary").map((r) => r.canaryPct ?? 100));
  return { mode: "canary", canaryPct: pct };
}

/** Rules on this boundary that are switched off entirely — a hole, not a mode. */
export function boundaryRulesOff(key: PerimeterCell["key"]): number {
  return BOUNDARY_RULES[key].filter(
    (id) => DETECTIONS.find((d) => d.id === id)?.mode === "off"
  ).length;
}

export const PERIMETER: PerimeterCell[] = (
  [
    ["SOURCES", "Sources"],
    ["CONTEXT", "Context"],
    ["EGRESS", "Egress"],
    ["EXECUTE", "Execute"],
    ["CONTAINMENT", "Containment"],
  ] as const
).map(([key, label]) => ({
  key,
  label,
  detections: BOUNDARY_RULES[key].length,
  ...boundaryMode(key),
}));

// ── Heatmap ───────────────────────────────────────────────────────────
//
// 7 source classes × 6 capabilities = 42 cells, 7-day flow counts. A cell is
// red-ringed only where a declared expected-flow policy asserts zero and it is
// not zero, and EVERY red-ringed cell has an event id behind it:
//
//   retrieved doc  × EGRESS       → SEC-1042
//   web fetch      × EGRESS       → SEC-1043
//   MCP tool return× EXECUTE      → SEC-1056 (and SEC-1049 on the read leg)
//   inbound email  × MEMORY_WRITE → SEC-1052 → SEC-1051
//   retrieved doc  × MUTATE       → SEC-1059
//   unregistered   × READ_PRIVATE → SEC-1044

const HEAT_SOURCES = [
  "web fetch",
  "retrieved doc",
  "MCP tool return",
  "peer agent",
  "user upload",
  "inbound email",
  "unregistered",
] as const;

const HEAT_SINKS: Capability[] = ["EGRESS", "EXECUTE", "MUTATE", "READ_PRIVATE", "MEMORY_WRITE", "DELEGATE"];

/** [EGRESS, EXECUTE, MUTATE, READ_PRIVATE, MEMORY_WRITE, DELEGATE] per source class. */
const HEAT_FLOWS: Record<(typeof HEAT_SOURCES)[number], number[]> = {
  "web fetch": [31, 0, 0, 214, 12, 4],
  "retrieved doc": [88, 6, 3, 1_902, 41, 22],
  "MCP tool return": [14, 26, 9, 340, 7, 61],
  "peer agent": [9, 2, 18, 128, 33, 210],
  "user upload": [2, 0, 4, 46, 1, 0],
  "inbound email": [0, 0, 11, 88, 386, 0],
  unregistered: [6, 3, 2, 340, 19, 8],
};

const HEAT_VIOLATIONS = new Set([
  "retrieved doc|EGRESS",
  "web fetch|EGRESS",
  "MCP tool return|EXECUTE",
  "inbound email|MEMORY_WRITE",
  "retrieved doc|MUTATE",
  "unregistered|READ_PRIVATE",
]);

/** Declared violations and the incident each one cites. */
const HEAT_EVIDENCE: Record<string, string> = {
  "retrieved doc|EGRESS": "SEC-1042",
  "web fetch|EGRESS": "SEC-1043",
  "MCP tool return|EXECUTE": "SEC-1056",
  "inbound email|MEMORY_WRITE": "SEC-1051",
  "retrieved doc|MUTATE": "SEC-1059",
  "unregistered|READ_PRIVATE": "SEC-1044",
};

export const HEATMAP: HeatCell[] = HEAT_SOURCES.flatMap((source) =>
  HEAT_SINKS.map((sink, i) => ({
    source,
    sink,
    flows: HEAT_FLOWS[source][i] ?? 0,
    // Declared violation AND a citable incident. The caption promises every red
    // ring resolves to a real event, so a ring without one must not be drawn —
    // unregistered|READ_PRIVATE was declared here while its cited event's every
    // hop carries capability NONE.
    violatesPolicy:
      HEAT_VIOLATIONS.has(`${source}|${sink}`) && heatEvidenceFor(source, sink) !== null,
  })),
);

/** The event that justifies a red-ringed heatmap cell. Null for every other cell. */
export function heatCellEvidence(cell: HeatCell): string | null {
  if (!cell.violatesPolicy) return null;
  return heatEvidenceFor(cell.source, cell.sink);
}

/**
 * The incident behind a declared policy violation — but only when that incident
 * genuinely reaches the cell's sink.
 *
 * The caption promises every red ring resolves to a real event, so the lookup
 * has to hold up: unregistered|READ_PRIVATE was declared a violation and cited
 * SEC-1044, whose every hop carries capability NONE. Verifying here means a pair
 * that stops being true stops being drawn, rather than quietly rendering a ring
 * with nothing behind it.
 */
function heatEvidenceFor(source: string, sink: Capability): string | null {
  const id = HEAT_EVIDENCE[`${source}|${sink}`];
  if (!id) return null;
  const ev = SECURITY_EVENTS.find((e) => e.id === id);
  if (!ev || !ev.flow.some((f) => f.capability === sink)) return null;
  return id;
}

// ── Source registry ───────────────────────────────────────────────────
//
// The mandatory onboarding step. An unconfirmed row is why TB-12 fires 340×/day
// and why REM_REGISTER_SOURCES exists: 7 unconfirmed rows below, matching the
// "Register 7 unlabeled sources" remediation exactly.

export const SOURCE_REGISTRY: SourceRegistryEntry[] = [
  { pattern: "kb://zendesk/*", kind: "search index", origin: "UNTRUSTED_EXTERNAL", confirmed: true, traffic7d: 12_480, note: "Accepted 2026-07-02. Article authors are outside the org." },
  { pattern: "crm_notes", kind: "table", origin: "UNTRUSTED_EXTERNAL", confirmed: true, traffic7d: 3_120, note: "User-writable via the inbound-email pipeline. Inference from kind='db' would have said SEMI_TRUSTED_INTERNAL and missed SEC-1051 entirely — this row is why the registry is mandatory." },
  { pattern: "customers", kind: "table", origin: "SEMI_TRUSTED_INTERNAL", confirmed: true, traffic7d: 8_940, note: "Read-only from the agent's principal." },
  { pattern: "billing_accounts", kind: "table", origin: "SEMI_TRUSTED_INTERNAL", confirmed: true, traffic7d: 2_210, note: "Private. READ_PRIVATE capability." },
  { pattern: "smtp://inbound.acme.co", kind: "webhook", origin: "UNTRUSTED_EXTERNAL", confirmed: true, traffic7d: 1_806, note: "Anyone with the address can author these bytes." },
  { pattern: "prompts/*.md", kind: "repo file", origin: "TRUSTED_OPERATOR", confirmed: true, traffic7d: 41_200, note: "Your own templates, versioned in acme/support-platform." },
  { pattern: "mcp://acme/jira-mcp", kind: "mcp server", origin: "UNTRUSTED_EXTERNAL", confirmed: true, traffic7d: 2_960, note: "Pinned at 1.4.2 after SEC-1049. Description hash recorded." },
  // ── 7 unconfirmed → REM_REGISTER_SOURCES (+3) and TB-12 at 340/day ──
  { pattern: "vector://support-index", kind: "vector index", origin: "SEMI_TRUSTED_INTERNAL", confirmed: false, traffic7d: 6_410, note: "Inferred from kind='search', which is wrong for a purely internal index. Needs an explicit accept." },
  { pattern: "mcp://vendor/pdf-tools", kind: "mcp server", origin: "UNKNOWN", confirmed: false, traffic7d: 4_180, note: "Third-party server, no origin declared at any tier. Implicated in SEC-1056." },
  { pattern: "s3://acme-uploads/*", kind: "object store", origin: "UNKNOWN", confirmed: false, traffic7d: 1_240, note: "Customer-supplied files. Almost certainly untrusted; nobody has said so." },
  { pattern: "agent://research-agent", kind: "peer agent", origin: "UNTRUSTED_AGENT", confirmed: false, traffic7d: 940, note: "Inferred from the handoff span. Exact labelling needs Tier 1." },
  { pattern: "https://*.competitor-brief.example", kind: "host pattern", origin: "UNKNOWN", confirmed: false, traffic7d: 612, note: "Open web, first observed 2026-08-10. The fetch leg of SEC-1043." },
  { pattern: "crm-service.*", kind: "service", origin: "UNKNOWN", confirmed: false, traffic7d: 12_000, note: "0% provenance coverage, 12% of span volume. Uninstrumented — see REM_INSTRUMENT_CRM." },
  { pattern: "vendor-feed://analyst-notes", kind: "feed", origin: "UNKNOWN", confirmed: false, traffic7d: 388, note: "Implicated in SEC-1059. Unregistered at ingest." },
];

/** Unconfirmed rows drive the register-sources remediation — 7, matching its title. */
export const UNREGISTERED_COUNT = SOURCE_REGISTRY.filter((s) => !s.confirmed).length;

// ── Trifectas ─────────────────────────────────────────────────────────
//
// The headline "you have 3 open trifectas". Each is a reachable triple, not an
// alert count — it moves when the architecture changes, not when traffic does.
// TF-1 and TF-3 both close on REM_SEND_REPORT_ALLOWLIST, which is why that
// remediation reads "closes 2 of 3".

export const TRIFECTAS: Trifecta[] = [
  {
    id: "TF-1",
    untrustedSource: "kb://zendesk/* (retrieved doc)",
    privateSource: "db.query customers · pii.email, pii.phone",
    egressSink: "tool.send_report → http.post",
    agent: "support-triage-agent",
    exercised: true, // SEC-1042 · blocked at the sink
    firstSeen: "2026-08-06T10:18:00Z", // the day SEC-1039 first crossed it
    remediation: REM_SEND_REPORT_ALLOWLIST,
  },
  {
    id: "TF-2",
    untrustedSource: "search.web_fetch · open web (unregistered host)",
    privateSource: "db.query billing_accounts · billing.account_id, billing.mrr",
    egressSink: "llm.summarize → rendered markdown image (client-side)",
    agent: "research-agent",
    exercised: true, // SEC-1043 · succeeded
    firstSeen: "2026-08-10T09:41:00Z",
    remediation: REM_MD_HOST_ALLOWLIST,
  },
  {
    id: "TF-3",
    untrustedSource: "mcp://acme/jira-mcp (MCP tool return)",
    privateSource: "db.query customers · pii.email",
    egressSink: "tool.send_report → http.post",
    agent: "support-triage-agent",
    exercised: false, // reachable, never traversed — a trifecta is exposure, not an incident
    firstSeen: "2026-08-09T08:14:00Z", // the day the MCP server was first labelled untrusted
    remediation: REM_SEND_REPORT_ALLOWLIST,
  },
];

// ── The score ─────────────────────────────────────────────────────────

export interface ScoreTerm {
  key: "C" | "L" | "E" | "R";
  label: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface ScoreResult {
  score: number;
  terms: ScoreTerm[];
  /** 0.40C + 0.25L + 0.20E + 0.15R */
  weighted: number;
  /** X = 0.5^openCriticals × 0.85^openHighs */
  exposure: number;
  /** P^0.5 — a multiplier, not an addend, so you cannot score 95 by instrumenting nothing. */
  coverageRoot: number;
  /** Score before the hard ceiling is considered. */
  raw: number;
  /** True only when the ceiling actually reduced the score. */
  ceilingApplied: boolean;
  /** The arithmetic as printable strings — a score whose derivation is hidden is a vanity number. */
  breakdown: {
    terms: { key: ScoreTerm["key"]; expr: string }[];
    coverage: string;
    weighted: string;
    exposure: string;
    total: string;
    ceiling: string | null;
    /** Plain-English footer naming the offending event, or null when nothing is dragging. */
    footer: string | null;
  };
}

const CEILING = 40;

function f3(n: number): string {
  return n.toFixed(3);
}

/**
 * Containment = round(100 × P^0.5 × (0.40C + 0.25L + 0.20E + 0.15R) × X)
 *   X = 0.5^openCriticals × 0.85^openHighs
 *   hard ceiling of 40 when a critical boundary has no enforcement point on a
 *   path that actually executed.
 *
 * No term counts attacks. More attempts do not move this number at all — which
 * is the test the score has to pass to be worth rendering.
 */
export function computeScore(inputs: PostureInputs): ScoreResult {
  const coverageRoot = Math.sqrt(inputs.coverage);

  const terms: ScoreTerm[] = [
    { key: "C", label: "Containment rate", value: inputs.containment, weight: 0.4, contribution: 0.4 * inputs.containment },
    { key: "L", label: "Least privilege", value: inputs.leastPrivilege, weight: 0.25, contribution: 0.25 * inputs.leastPrivilege },
    { key: "E", label: "Egress discipline", value: inputs.egressDiscipline, weight: 0.2, contribution: 0.2 * inputs.egressDiscipline },
    { key: "R", label: "Regression durability", value: inputs.durability, weight: 0.15, contribution: 0.15 * inputs.durability },
  ];

  const weighted = terms.reduce((a, t) => a + t.contribution, 0);
  const exposure = Math.pow(0.5, inputs.openCriticals) * Math.pow(0.85, inputs.openHighs);
  const raw = Math.round(100 * coverageRoot * weighted * exposure);

  const ceilingArmed = inputs.unenforcedCriticalBoundary;
  const score = ceilingArmed ? Math.min(raw, CEILING) : raw;
  const ceilingApplied = ceilingArmed && raw > CEILING;

  // What would the score be with the exposure multiplier cleared? Drives the
  // "resolving it alone returns you to N" footer.
  //
  // The ceiling has to apply to the counterfactual too. Clearing the exposure
  // multiplier here lifts the raw score to 66, but if a critical boundary still
  // has no enforcement point the ceiling binds at that point and the real
  // recovery is 40. Promising 66 would be the score lying about its own rules —
  // and the one number a reader is most likely to act on.
  const withoutExposureRaw = Math.round(100 * coverageRoot * weighted);
  const withoutExposure = ceilingArmed ? Math.min(withoutExposureRaw, CEILING) : withoutExposureRaw;

  const footerParts: string[] = [];
  if (inputs.openCriticals > 0) {
    const which = inputs.openCriticals === 1 ? "1 open critical" : `${inputs.openCriticals} open criticals`;
    const capped = ceilingArmed && withoutExposureRaw > CEILING;
    footerParts.push(
      `Halved by ${which}. Resolving ${inputs.openCriticals === 1 ? "it" : "them"} alone returns you to ${withoutExposure}` +
        (capped ? ` — not ${withoutExposureRaw}, because the ceiling binds until a critical boundary has an enforcement point.` : ".")
    );
  }
  if (inputs.openHighs > 0) {
    footerParts.push(`${inputs.openHighs} open high${inputs.openHighs === 1 ? "" : "s"} apply a further 0.85 each.`);
  }
  if (ceilingApplied) {
    footerParts.push(`Hard ceiling of ${CEILING} applied: a critical boundary has no enforcement point on a path that executed.`);
  } else if (ceilingArmed) {
    footerParts.push(`Hard ceiling of ${CEILING} is armed but not binding — the computed score is already below it.`);
  }

  return {
    score,
    terms,
    weighted,
    exposure,
    coverageRoot,
    raw,
    ceilingApplied,
    breakdown: {
      terms: terms.map((t) => ({ key: t.key, expr: `${t.weight.toFixed(2)} × ${f3(t.value)} = ${f3(t.contribution)}` })),
      coverage: `${f3(inputs.coverage)}^0.5 = ${f3(coverageRoot)}`,
      weighted: `${terms.map((t) => f3(t.contribution)).join(" + ")} = ${f3(weighted)}`,
      exposure: `0.5^${inputs.openCriticals} × 0.85^${inputs.openHighs} = ${f3(exposure)}`,
      total: `100 × ${f3(coverageRoot)} × ${f3(weighted)} × ${f3(exposure)} = ${raw}`,
      ceiling: ceilingArmed ? `min(${raw}, ${CEILING}) = ${score}` : null,
      footer: footerParts.length > 0 ? footerParts.join(" ") : null,
    },
  };
}

// ── Trend ─────────────────────────────────────────────────────────────
//
// 30 days ending at AS_OF. `blocked` and `succeeded` are DERIVED from
// SECURITY_EVENTS for every day the corpus covers (Aug 3 – Aug 11) and fall back
// to an authored baseline before that, so the chart's right-hand edge cannot
// disagree with the Events queue. The final point's `score` is replaced with
// computeScore(POSTURE).score for the same reason.

const TREND_DAYS = 30;

/** Authored history for the 21 days before the corpus starts. */
const TREND_BASELINE: { detected: number; blocked: number; succeeded: number; score: number }[] = [
  { detected: 61, blocked: 4, succeeded: 0, score: 62 },
  { detected: 58, blocked: 3, succeeded: 0, score: 62 },
  { detected: 74, blocked: 6, succeeded: 1, score: 58 },
  { detected: 69, blocked: 5, succeeded: 0, score: 58 },
  { detected: 52, blocked: 2, succeeded: 0, score: 61 },
  { detected: 47, blocked: 1, succeeded: 0, score: 61 },
  { detected: 66, blocked: 4, succeeded: 0, score: 63 },
  { detected: 81, blocked: 9, succeeded: 0, score: 63 },
  { detected: 77, blocked: 7, succeeded: 1, score: 59 },
  { detected: 64, blocked: 5, succeeded: 0, score: 59 },
  { detected: 59, blocked: 3, succeeded: 0, score: 64 },
  { detected: 71, blocked: 6, succeeded: 0, score: 64 },
  { detected: 88, blocked: 11, succeeded: 0, score: 64 },
  { detected: 92, blocked: 14, succeeded: 0, score: 66 },
  { detected: 70, blocked: 5, succeeded: 0, score: 66 },
  { detected: 63, blocked: 4, succeeded: 0, score: 66 },
  { detected: 68, blocked: 6, succeeded: 0, score: 66 },
  { detected: 79, blocked: 8, succeeded: 0, score: 66 },
  { detected: 84, blocked: 10, succeeded: 0, score: 66 },
  { detected: 72, blocked: 6, succeeded: 0, score: 66 },
  { detected: 66, blocked: 5, succeeded: 0, score: 66 },
];

/** Authored `detected` and `score` for the 9 corpus days; blocked/succeeded are derived. */
const TREND_CORPUS_DAYS: { detected: number; score: number }[] = [
  { detected: 74, score: 66 }, // Aug 3
  { detected: 69, score: 66 }, // Aug 4
  { detected: 91, score: 66 }, // Aug 5 — break-glass window
  { detected: 103, score: 66 }, // Aug 6
  { detected: 88, score: 33 }, // Aug 7 — SEC-1058 opens
  { detected: 96, score: 66 }, // Aug 8 — SEC-1058 resolved
  { detected: 110, score: 66 }, // Aug 9
  { detected: 124, score: 33 }, // Aug 10 — SEC-1043 opens and stays open
  { detected: 402, score: 33 }, // Aug 11 — TB-12 sweep lands
];

function buildTrend(): TrendPoint[] {
  const endDay = Date.parse(dayKey(AS_OF) + "T00:00:00Z");
  const derived = new Map<string, { blocked: number; succeeded: number }>();
  for (const e of SECURITY_EVENTS) {
    const k = dayKey(e.timestamp);
    const bucket = derived.get(k) ?? { blocked: 0, succeeded: 0 };
    if (e.eventClass === "blocked") bucket.blocked += e.occurrences;
    if (e.outcome === "succeeded") bucket.succeeded += e.occurrences;
    derived.set(k, bucket);
  }

  const points: TrendPoint[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const date = dayKey(new Date(endDay - i * DAY_MS).toISOString());
    const idx = TREND_DAYS - 1 - i;
    const corpusIdx = idx - TREND_BASELINE.length;
    if (corpusIdx >= 0) {
      const authored = TREND_CORPUS_DAYS[corpusIdx]!;
      const d = derived.get(date) ?? { blocked: 0, succeeded: 0 };
      points.push({ date, detected: authored.detected, blocked: d.blocked, succeeded: d.succeeded, score: authored.score });
    } else {
      const b = TREND_BASELINE[idx]!;
      points.push({ date, detected: b.detected, blocked: b.blocked, succeeded: b.succeeded, score: b.score });
    }
  }

  // The newest point is the score the KPI strip prints — same function, same inputs.
  const last = points[points.length - 1];
  if (last) last.score = computeScore(POSTURE).score;
  return points;
}

export const TREND: TrendPoint[] = buildTrend();

// ── Query functions. The UI calls these and never hardcodes a result. ──

export function getEvent(id: string): SecurityEvent | undefined {
  return SECURITY_EVENTS.find((e) => e.id === id);
}

export interface EventFilter {
  eventClass?: EventClass[];
  severity?: Severity[];
  outcome?: SecurityEvent["outcome"][];
  status?: SecurityEvent["status"][];
  agent?: string[];
  tool?: string[];
  ruleId?: string[];
  asi?: string[];
  tier?: Tier[];
  environment?: string[];
  /** Only events whose priority is at or above this. */
  minPriority?: number;
  /** Only events inside this many days of AS_OF. */
  withinDays?: number;
  /** Free text over id, title, agent, tool and rule id. */
  query?: string;
}

function matches<T>(allowed: T[] | undefined, value: T): boolean {
  return !allowed || allowed.length === 0 || allowed.includes(value);
}

/** Filtered, newest first, ties broken by priority so the queue is stable. */
export function listEvents(filter: EventFilter = {}, events = SECURITY_EVENTS): SecurityEvent[] {
  const q = filter.query?.trim().toLowerCase();
  return events
    .filter((e) => {
      if (!matches(filter.eventClass, e.eventClass)) return false;
      if (!matches(filter.severity, e.severity)) return false;
      if (!matches(filter.outcome, e.outcome)) return false;
      if (!matches(filter.status, e.status)) return false;
      if (!matches(filter.agent, e.agent)) return false;
      if (!matches(filter.tier, e.tier)) return false;
      if (!matches(filter.ruleId, e.ruleId)) return false;
      if (!matches(filter.environment, e.environment)) return false;
      if (filter.tool && filter.tool.length > 0 && (e.tool === null || !filter.tool.includes(e.tool))) return false;
      if (filter.asi && filter.asi.length > 0 && !e.asi.some((a) => filter.asi!.includes(a))) return false;
      if (filter.minPriority !== undefined && e.priority < filter.minPriority) return false;
      if (filter.withinDays !== undefined && !withinDays(e.timestamp, filter.withinDays)) return false;
      if (q) {
        const hay = `${e.id} ${e.title} ${e.agent} ${e.tool ?? ""} ${e.ruleId} ${e.summary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const t = Date.parse(b.timestamp) - Date.parse(a.timestamp);
      return t !== 0 ? t : b.priority - a.priority;
    });
}

export interface ClassCount {
  /** Campaign-collapsed rows — what the queue shows. */
  events: number;
  /** Underlying occurrences — what "Blocked (7d) 41" counts. */
  occurrences: number;
}

/**
 * Counts by class over a window. The KPI strip's "Blocked (7d)" is
 * countsByClass(7).blocked.occurrences — 14 + 23 + 3 + 1 = 41 — and no view may
 * print that number any other way.
 */
export function countsByClass(days = 7, events = SECURITY_EVENTS): Record<EventClass, ClassCount> {
  const out: Record<EventClass, ClassCount> = {
    informational: { events: 0, occurrences: 0 },
    suspicious: { events: 0, occurrences: 0 },
    blocked: { events: 0, occurrences: 0 },
    critical: { events: 0, occurrences: 0 },
  };
  for (const e of events) {
    if (!withinDays(e.timestamp, days)) continue;
    out[e.eventClass].events += 1;
    out[e.eventClass].occurrences += e.occurrences;
  }
  return out;
}

/** Boundary efficacy — blocked / (blocked + succeeded). The direct answer to "blocked vs successful". */
export function boundaryEfficacy(days = 7, events = SECURITY_EVENTS): { blocked: number; succeeded: number; rate: number | null } {
  let blocked = 0;
  let succeeded = 0;
  for (const e of events) {
    if (!withinDays(e.timestamp, days)) continue;
    if (e.outcome === "blocked") blocked += e.occurrences;
    if (e.outcome === "succeeded") succeeded += e.occurrences;
  }
  const total = blocked + succeeded;
  return { blocked, succeeded, rate: total === 0 ? null : blocked / total };
}

export interface RankedRemediation extends Remediation {
  /** deltaScore / diffLines — the ranking key. */
  leverage: number;
  /** Every open event asking for this exact cut. */
  eventIds: string[];
}

/**
 * Ranked cuts, deduped by title across events and ordered by score recovered per
 * line changed. Only OPEN events contribute — a resolved event's remediation has
 * already landed and offers no further recovery. Zero-delta entries are
 * containment actions (quarantine, rotate) and are excluded from the ranking.
 */
export function topRemediations(limit = 4, events = SECURITY_EVENTS): RankedRemediation[] {
  const open = events.filter((e) => e.status === "new" || e.status === "triaging");
  const byTitle = new Map<string, RankedRemediation>();
  for (const e of open) {
    for (const r of e.remediation) {
      if (r.deltaScore <= 0) continue;
      const existing = byTitle.get(r.title);
      if (existing) {
        existing.eventIds.push(e.id);
      } else {
        byTitle.set(r.title, { ...r, leverage: r.deltaScore / r.diffLines, eventIds: [e.id] });
      }
    }
  }
  return [...byTitle.values()].sort((a, b) => b.leverage - a.leverage).slice(0, limit);
}

/** Deferred-taint watchlist — poisoned memory writes not yet read back, with age. */
export function deferredTaintWatchlist(asOf = AS_OF): { writes: number; oldestDays: number } {
  // Derived from the corpus: SEC-1052's write was read back (it became SEC-1051),
  // and its remediation names 4 sibling notes from the same ingest that were not.
  const oldest = SECURITY_EVENTS.find((e) => e.id === "SEC-1052");
  const oldestDays = oldest ? Math.floor((Date.parse(asOf) - Date.parse(oldest.timestamp)) / DAY_MS) : 0;
  return { writes: 4, oldestDays };
}

/**
 * Self-check: every rule's firing7d equals the sum of its events' occurrences in
 * the window, except where a rule fires inside another rule's event (TB-02 at
 * SEC-1049 #m07) or has no corpus row at all. Exported so a view can render the
 * disagreement rather than hide it — a security console that cannot prove its own
 * numbers agree has no business asserting anyone else's.
 */
export function ruleFiringConsistency(days = 7): { ruleId: string; declared: number; fromEvents: number; agrees: boolean }[] {
  const sums = new Map<string, number>();
  for (const e of SECURITY_EVENTS) {
    if (!withinDays(e.timestamp, days)) continue;
    sums.set(e.ruleId, (sums.get(e.ruleId) ?? 0) + e.occurrences);
  }
  return DETECTIONS.map((d) => {
    const fromEvents = sums.get(d.id) ?? 0;
    // TB-02 fires as the deny inside SEC-1049 and owns no row of its own.
    const agrees = d.id === "TB-02" ? d.firing7d === 1 : d.firing7d === fromEvents;
    return { ruleId: d.id, declared: d.firing7d, fromEvents, agrees };
  });
}

/** Most-targeted agents, ranked by Σ priority — not event count, which just crowns the noisiest. */
export function agentExposure(days = 7): { agent: string; events: number; priority: number }[] {
  const m = new Map<string, { agent: string; events: number; priority: number }>();
  for (const e of SECURITY_EVENTS) {
    if (!withinDays(e.timestamp, days)) continue;
    const row = m.get(e.agent) ?? { agent: e.agent, events: 0, priority: 0 };
    row.events += 1;
    row.priority += e.priority;
    m.set(e.agent, row);
  }
  return [...m.values()].sort((a, b) => b.priority - a.priority);
}

/** Distinct agents and tools present in the corpus — filter chips build from these. */
export const AGENTS: string[] = [...new Set(SECURITY_EVENTS.map((e) => e.agent))].sort();
export const TOOLS: string[] = [...new Set(SECURITY_EVENTS.map((e) => e.tool).filter((t): t is string => t !== null))].sort();
export const ASI_IDS: string[] = [...new Set(SECURITY_EVENTS.flatMap((e) => e.asi))].sort();

/** The violating hop of a flow — the node the boundary line paints red. */
export function violatingNode(flow: FlowNode[]): FlowNode | undefined {
  return flow.find((n) => n.violating) ?? flow[flow.length - 1];
}

/** Origins present on a flow, source order preserved. Drives the taint highlighter. */
export function flowOrigins(flow: FlowNode[]): Origin[] {
  return [...new Set(flow.map((n) => n.origin))];
}
