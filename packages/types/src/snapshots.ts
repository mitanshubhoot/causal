import { z } from "zod";

// ── ContextSnapshot (stored in S3) ───────────────────────────────
// Full context window capture at a decision point in an agent session.
// Immutable after creation. SHA256 integrity verified on fetch.

export const ContextMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([
    z.string(),
    z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
      tool_use_id: z.string().optional(),
      content: z.unknown().optional(),
    })),
  ]),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});
export type ContextMessage = z.infer<typeof ContextMessageSchema>;

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.unknown().optional(),
  parameters: z.unknown().optional(),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ContextSnapshotSchema = z.object({
  snapshotId: z.string(),
  nodeId: z.string().uuid(),
  timestamp: z.number().int().positive(),
  modelId: z.string(),
  systemPrompt: z.string(),
  messages: z.array(ContextMessageSchema),
  toolsAvailable: z.array(ToolDefinitionSchema).default([]),
  repoState: z.object({
    headCommit: z.string(),
    openFiles: z.array(z.string()).default([]),
    branch: z.string().optional(),
  }),
  contentHash: z.string(),    // SHA256 hex of the snapshot JSON content
  decisionType: z.enum([
    "tool_call",
    "file_edit",
    "clarification",
    "session_start",
    "session_end",
    "langgraph_node_transition",
    "manual",
  ]).default("tool_call"),
  tokenCount: z.number().int().optional(),
});
export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

// ── Snapshot metadata (stored in Postgres, not S3) ────────────────
export const SnapshotMetaSchema = z.object({
  snapshotId: z.string(),
  nodeId: z.string().uuid(),
  orgId: z.string(),
  s3Key: z.string(),
  contentHash: z.string(),
  modelId: z.string(),
  tokenCount: z.number().int().nullable(),
  decisionType: z.string(),
  timestamp: z.number().int().positive(),
  createdAt: z.number().int().positive(),
});
export type SnapshotMeta = z.infer<typeof SnapshotMetaSchema>;

// ── Replay fidelity ───────────────────────────────────────────────
export const ReplayFidelitySchema = z.object({
  snapshotId: z.string(),
  overallScore: z.number().min(0).max(1),
  modelVersionMatch: z.number().min(0).max(1),   // weight 0.4
  toolDefinitionMatch: z.number().min(0).max(1), // weight 0.3
  repoDivergenceScore: z.number().min(0).max(1), // weight 0.3
  daysElapsed: z.number().int(),
  warningLevel: z.enum(["none", "low", "high", "disabled"]),
  details: z.object({
    originalModel: z.string(),
    currentModel: z.string().optional(),
    toolsChanged: z.array(z.string()).default([]),
    commitsAhead: z.number().int().optional(),
  }),
});
export type ReplayFidelity = z.infer<typeof ReplayFidelitySchema>;
