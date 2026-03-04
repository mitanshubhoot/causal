import { z } from "zod";
import { CausalNodeSchema } from "./nodes.js";
import { CausalEdgeSchema } from "./edges.js";

// ── RootCause ─────────────────────────────────────────────────────
export const RootCauseSchema = z.object({
  nodeId: z.string().uuid(),
  layer: z.string(),
  probability: z.number().min(0).max(1),
  explanation: z.string(),        // LLM-generated plain English
  counterfactual: z.string(),     // "If X had been Y, incident would not occur"
  evidenceEdgeIds: z.array(z.string().uuid()),
  interventionPoint: z.string().optional(),  // what should be fixed
});
export type RootCause = z.infer<typeof RootCauseSchema>;

// ── TraceGraph ────────────────────────────────────────────────────
// Primary query result. Assembled from Neo4j ancestor traversal.
export const TraceGraphSchema = z.object({
  id: z.string().uuid(),
  rootNodeId: z.string().uuid(),
  nodes: z.array(CausalNodeSchema),
  edges: z.array(CausalEdgeSchema),
  rootCauses: z.array(RootCauseSchema),
  criticalPath: z.array(z.string().uuid()),  // node IDs: most probable chain
  status: z.enum(["assembling", "complete", "failed"]),
  confidence: z.number().min(0).max(1).optional(),   // top root cause probability
  createdAt: z.number().int().positive(),
  completedAt: z.number().int().positive().optional(),
});
export type TraceGraph = z.infer<typeof TraceGraphSchema>;

// ── TraceRequest ──────────────────────────────────────────────────
export const TraceRequestSchema = z.object({
  rootNodeId: z.string().uuid(),
  maxDepth: z.number().int().min(1).max(10).default(6),
  minWeight: z.number().min(0).max(1).default(0.3),
  layers: z.array(z.string()).optional(),
  includeContributed: z.boolean().default(true),
});
export type TraceRequest = z.infer<typeof TraceRequestSchema>;

// ── SearchRequest ─────────────────────────────────────────────────
export const SearchRequestSchema = z.object({
  query: z.string().min(1),
  layers: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).default(0.7),
  orgId: z.string().optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

// ── Replay ────────────────────────────────────────────────────────
export const ReplayModificationSchema = z.object({
  type: z.enum(["system_prompt_append", "system_prompt_replace", "context_inject", "spec_override"]),
  content: z.string(),
  position: z.enum(["start", "end", "before_last_user"]).default("end"),
});
export type ReplayModification = z.infer<typeof ReplayModificationSchema>;

export const ReplayRequestSchema = z.object({
  snapshotId: z.string(),
  modification: ReplayModificationSchema,
  modelOverride: z.string().optional(),
  maxTokens: z.number().int().positive().default(4096),
});
export type ReplayRequest = z.infer<typeof ReplayRequestSchema>;

export const ReplayResultSchema = z.object({
  id: z.string().uuid(),
  snapshotId: z.string(),
  originalOutput: z.string(),
  modifiedOutput: z.string(),
  diff: z.array(z.object({
    type: z.enum(["added", "removed", "unchanged"]),
    value: z.string(),
  })),
  fidelityScore: z.number().min(0).max(1),
  modelUsed: z.string(),
  completedAt: z.number().int().positive(),
});
export type ReplayResult = z.infer<typeof ReplayResultSchema>;
