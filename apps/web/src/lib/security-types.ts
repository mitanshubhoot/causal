/**
 * Trust Boundaries — the type contract.
 *
 * The capability rests on one idea: almost every agent attack is a trust-level
 * confusion, not a malicious string. Untrusted bytes become instructions, or
 * private bytes reach a sink nobody authorised. So every node in a trace carries
 * an ORIGIN (who authored these bytes) and a CAPABILITY (what this node can do),
 * and the whole detection surface reduces to one predicate:
 *
 *     reach(untrusted_origin, capability_sink)
 *
 * These types are the contract every security view builds against. They live
 * apart from the demo data so the shapes can be read without scrolling past
 * fixtures, and so a live API mapper has something to satisfy.
 */

// ── Trust labels ─────────────────────────────────────────────────────

/**
 * Where a node's bytes came from. Five labels, deliberately NOT five hues —
 * the product reserves colour for status, so the UI encodes these as fill and
 * border treatment on the neutral scale (see TRUST_META in security-ui.tsx).
 */
export type Origin =
  | "TRUSTED_OPERATOR"       // your own prompt templates, your own code
  | "TRUSTED_USER"           // the authenticated human driving this session
  | "SEMI_TRUSTED_INTERNAL"  // your database, your vector index — unless user-writable
  | "UNTRUSTED_EXTERNAL"     // the open web, retrieved docs, inbound email, MCP returns
  | "UNTRUSTED_AGENT"        // another agent's output
  | "UNKNOWN";               // resolves at no tier — a coverage gap, never a trust claim

/** What a node is able to do. Reaching one of these with untrusted taint is the event. */
export type Capability =
  | "EGRESS"        // can send bytes out of the process
  | "EXECUTE"       // can run code or shell
  | "MUTATE"        // can write to a system of record
  | "READ_PRIVATE"  // can read data the operator owns
  | "MEMORY_WRITE"  // can persist into context read by a later run
  | "DELEGATE"      // can hand work to another agent
  | "NONE";

/**
 * How confidently a label was established. Tier modulates confidence; it never
 * modulates class. A Tier 0 finding is a real finding — it is just weighted less
 * in coverage, because it was inferred from span shape rather than declared by
 * the SDK or enforced in-process.
 */
export type Tier = "inferred" | "declared" | "enforced";

export const TIER_WEIGHT: Record<Tier, number> = {
  inferred: 0.5,
  declared: 0.9,
  enforced: 1.0,
};

// ── Events ───────────────────────────────────────────────────────────

/**
 * What the system did. A first-class field rather than a bucket, because the
 * whole point is to report what was ATTEMPTED and how we RESPONDED — not only
 * what succeeded.
 */
export type Outcome = "none" | "attempted" | "contained" | "blocked" | "succeeded";

/**
 * Where an event lands. `blocked` is its own class and renders emerald: a
 * successful block is the machine working, and a product that pages you for
 * every attack it stopped teaches you to ignore it.
 */
export type EventClass = "informational" | "suspicious" | "blocked" | "critical";

export type Severity = "critical" | "high" | "medium" | "low";

/** Why a critical event is critical. Set B fires with zero attacks present. */
export type CriticalReason =
  | "crossed_and_succeeded"  // set A — the boundary was crossed and it worked
  | "bypass"                 // set B — would have denied, but nothing was armed
  | "gap"                    // set B — a critical boundary with no enforcement on a live path
  | "quarantine"             // set B — a run was contained
  | "break_glass";           // set B — enforcement manually dropped to monitor

/** One hop in the flow that produced the event. This is the evidence. */
export interface FlowNode {
  spanId: string;
  name: string;
  /** Matches the trace explorer's span kinds so the two views agree. */
  kind: string;
  origin: Origin;
  capability: Capability;
  /** Bytes carried into this node from the previous hop — drives edge weight. */
  bytes?: number;
  /** Short, non-reproducible description of what this hop did. */
  detail?: string;
  /** True when this node is the one that crossed the boundary. */
  violating?: boolean;
}

/**
 * How the flow between two nodes was established.
 *
 * `opaque` matters and must be rendered honestly: when the model paraphrases
 * rather than copies, verbatim carry-through disappears. The detection still
 * holds — propagation through an llm span is unconditional — but showing a
 * matched string we do not have would be a fabrication.
 */
export type WitnessKind = "shingle" | "exact" | "decoded" | "opaque" | "declared";

export interface Witness {
  kind: WitnessKind;
  /** Redacted description of the match. NEVER the payload itself. */
  summary: string;
  sourceSpanId?: string;
  sinkSpanId?: string;
  /** Byte offsets make the claim checkable without reproducing the attack. */
  sourceOffset?: number;
  sinkOffset?: number;
}

export interface Remediation {
  /** Phrased as an edit to the graph — a cut, never advice. */
  title: string;
  detail: string;
  /** Score points this would recover. */
  deltaScore: number;
  /** Rough size of the change, so the ranking is honest about effort. */
  diffLines: number;
  action: "open_pr" | "open_registry" | "copy_snippet" | "rotate_credential" | "arm_rule";
}

export interface SecurityEvent {
  id: string;
  /** Detection that fired, e.g. "TB-01". */
  ruleId: string;
  ruleVersion: number;
  title: string;
  eventClass: EventClass;
  severity: Severity;
  outcome: Outcome;
  criticalReason?: CriticalReason;
  /** Triage order. Impact and outcome, never how frightening the attack sounds. */
  priority: number;
  tier: Tier;
  /** True when a control was actually armed on this path. */
  enforced: boolean;
  timestamp: string;
  agent: string;
  environment: string;
  traceId: string;
  /** The tool or integration involved, if any. */
  tool: string | null;
  /** Standards mapping — security buyers expect their own vocabulary. */
  asi: string[];
  owasp: string[];
  atlas: string[];
  /** The flow, source → sink. Rendered as the boundary line and the Flow Map. */
  flow: FlowNode[];
  witness: Witness;
  /** One line: what happened. No payload. */
  summary: string;
  /** What the system did about it, stated plainly — including "nothing". */
  response: string;
  remediation: Remediation[];
  /** Set when this event's rule was created from an earlier one. The loop closing. */
  derivedFrom?: string;
  /** Deterministic detections say so; only two of seventeen call a model. */
  evidence: "deterministic" | "judge";
  /** Evaluation cost, where a guard actually ran. */
  latencyUs?: number;
  /** Repeated occurrences collapse into one row. */
  occurrences: number;
  status: "new" | "triaging" | "resolved" | "accepted_risk";
}

// ── Detections ───────────────────────────────────────────────────────

export interface Detection {
  id: string;
  name: string;
  catches: string;
  /** What the detection needs to see. */
  signal: string;
  /** Whether Causal captures that signal today, or what must be added. */
  availability: "today" | "tier0" | "partial" | "needs_sdk";
  usesModel: boolean;
  asi: string[];
  atlas: string[];
  /** monitor → backtest → canary → enforce. */
  mode: "off" | "monitor" | "canary" | "enforce";
  canaryPct?: number;
  /** Backtest over stored traces — the reason a rule can be armed safely. */
  backtest?: { fires: number; confirmed: number; precision: number; windowDays: number };
  firing7d: number;
}

// ── Posture ──────────────────────────────────────────────────────────

/**
 * The score's inputs, kept separate so the UI can print the arithmetic. A score
 * whose derivation is hidden is a vanity number; this one shows its working and
 * every term is defended in the proposal.
 */
export interface PostureInputs {
  /** P — Σ(spans × tier weight) / spans. Multiplicative and square-rooted. */
  coverage: number;
  /** C — untrusted ingress that reached no sink. */
  containment: number;
  /** L — capabilities NOT reachable from untrusted taint. */
  leastPrivilege: number;
  /** E — egress to allowlisted hosts. */
  egressDiscipline: number;
  /** R — security assertions passing at HEAD. */
  durability: number;
  openCriticals: number;
  openHighs: number;
  /** A critical boundary with no enforcement on a path that executed. */
  unenforcedCriticalBoundary: boolean;
  measuredAt: string;
  commit: string;
  /** Deployed HEAD. If it differs from `commit`, the score is stale and says so. */
  headCommit: string;
  commitsSince: number;
}

export interface PerimeterCell {
  key: "SOURCES" | "CONTEXT" | "EGRESS" | "EXECUTE" | "CONTAINMENT";
  label: string;
  detections: number;
  mode: "off" | "monitor" | "canary" | "enforce";
  canaryPct?: number;
}

/** Source class × sink capability. The one image that is the whole product. */
export interface HeatCell {
  source: string;
  sink: Capability;
  flows: number;
  /** A declared policy asserts zero flows here and it is not zero. */
  violatesPolicy: boolean;
}

export interface SourceRegistryEntry {
  pattern: string;
  kind: string;
  origin: Origin;
  /** Inferred defaults must be accepted explicitly before the capability arms. */
  confirmed: boolean;
  traffic7d: number;
  note?: string;
}

export interface TrendPoint {
  date: string;
  detected: number;
  blocked: number;
  succeeded: number;
  score: number;
}

/** A reachable (untrusted × private × egress) triple. Usually a single digit. */
export interface Trifecta {
  id: string;
  untrustedSource: string;
  privateSource: string;
  egressSink: string;
  agent: string;
  /** Whether anyone has actually exercised it, as opposed to it merely being reachable. */
  exercised: boolean;
  firstSeen: string;
  remediation: Remediation;
}
