import { z } from "zod";

export const LayerSchema = z.enum([
  "INTENT",
  "SPEC",
  "REASONING",
  "CODE",
  "EXECUTION",
  "INCIDENT",
]);
export type Layer = z.infer<typeof LayerSchema>;

export const LAYER_ORDER: Layer[] = [
  "INTENT",
  "SPEC",
  "REASONING",
  "CODE",
  "EXECUTION",
  "INCIDENT",
];

// ── CausalNode ────────────────────────────────────────────────────
// Immutable after creation. Embedding populated async.
export const CausalNodeSchema = z.object({
  id: z.string().uuid(),
  layer: LayerSchema,
  kind: z.string(),
  timestamp: z.number().int().positive(),   // Unix ms
  agentId: z.string().nullable(),
  modelVersion: z.string().nullable(),
  sessionId: z.string().nullable(),
  contextSnapId: z.string().nullable(),
  payload: z.record(z.unknown()),
  embedding: z.array(z.number()).length(1536).nullable(),
  orgId: z.string(),
  repoId: z.string(),
});
export type CausalNode = z.infer<typeof CausalNodeSchema>;

// ── Layer-specific payload shapes ────────────────────────────────

export const IntentPayloadSchema = z.object({
  title: z.string(),
  url: z.string().url().optional(),
  freeformText: z.string(),
  source: z.enum(["notion", "slack", "manual"]).default("manual"),
});
export type IntentPayload = z.infer<typeof IntentPayloadSchema>;

export const SpecPayloadSchema = z.object({
  title: z.string(),
  url: z.string().url().optional(),
  externalId: z.string(),                   // Linear/Jira issue ID
  acceptanceCriteria: z.string(),
  description: z.string(),
  status: z.string().optional(),
  source: z.enum(["linear", "jira", "github_issue", "manual"]).default("linear"),
});
export type SpecPayload = z.infer<typeof SpecPayloadSchema>;

export const ReasoningPayloadSchema = z.object({
  sessionId: z.string(),
  modelId: z.string(),
  totalTokens: z.number().int().optional(),
  toolsCalled: z.array(z.string()).default([]),
  filesModified: z.array(z.string()).default([]),
  specIds: z.array(z.string()).default([]),   // declared via causal_link
  summary: z.string().optional(),
  snapshotIds: z.array(z.string()).default([]),
  source: z.enum(["claude_code", "cursor", "langgraph", "langsmith", "manual"]).default("claude_code"),
});
export type ReasoningPayload = z.infer<typeof ReasoningPayloadSchema>;

export const CodePayloadSchema = z.object({
  commitHash: z.string(),
  commitMessage: z.string(),
  authorName: z.string().optional(),
  authorEmail: z.string().optional(),
  branch: z.string().optional(),
  repoFullName: z.string(),
  diffStat: z.object({
    filesChanged: z.number().int(),
    additions: z.number().int(),
    deletions: z.number().int(),
  }).optional(),
  filesChanged: z.array(z.string()).default([]),
  prNumber: z.number().int().optional(),
  causalSessionTrailer: z.string().nullable().optional(),
});
export type CodePayload = z.infer<typeof CodePayloadSchema>;

export const ExecutionPayloadSchema = z.object({
  spanId: z.string(),
  traceId: z.string().optional(),
  service: z.string(),
  operation: z.string(),
  latencyMs: z.number().optional(),
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
  source: z.enum(["datadog", "langfuse", "langsmith", "manual"]).default("datadog"),
});
export type ExecutionPayload = z.infer<typeof ExecutionPayloadSchema>;

export const IncidentPayloadSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  severity: z.enum(["P1", "P2", "P3", "P4", "SEV1", "SEV2", "SEV3", "SEV4", "critical", "high", "medium", "low"]).optional(),
  blastRadius: z.string().optional(),
  service: z.string().optional(),
  url: z.string().url().optional(),
  stackTrace: z.string().optional(),
  stackTraceFrames: z.array(z.object({
    filename: z.string(),
    lineno: z.number().int().optional(),
    function: z.string().optional(),
    module: z.string().optional(),
  })).optional(),
  resolvedAt: z.number().int().optional(),
  source: z.enum(["pagerduty", "sentry", "manual"]).default("pagerduty"),
});
export type IncidentPayload = z.infer<typeof IncidentPayloadSchema>;

// ── CreateNode DTO ────────────────────────────────────────────────
export const CreateNodeSchema = CausalNodeSchema.omit({
  id: true,
  embedding: true,
}).extend({
  id: z.string().uuid().optional(),
});
export type CreateNode = z.infer<typeof CreateNodeSchema>;
