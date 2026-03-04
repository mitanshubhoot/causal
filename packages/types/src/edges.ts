import { z } from "zod";

export const EdgeTypeSchema = z.enum([
  "SPECIFIED_BY",    // INTENT → SPEC
  "REASONED_FROM",   // SPEC → REASONING
  "PRODUCED",        // REASONING → CODE
  "DEPLOYED_AS",     // CODE → EXECUTION
  "CAUSED",          // EXECUTION → INCIDENT (strong)
  "CONTRIBUTED_TO",  // EXECUTION → INCIDENT (partial)
  "CONTRADICTS",     // cross-layer conflict
  "CORRECTED_BY",    // INCIDENT → remediation
]);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

export const LinkStrategySchema = z.enum([
  "session_id",   // 0.97 — commit trailer matches REASONING session
  "stack_trace",  // 0.85–0.95 — stack frame → git blame → commit
  "time_window",  // 0.6–0.8 — temporal + semantic proximity
  "vector",       // 0.3–0.6 — embedding similarity (fallback only)
  "manual",       // 1.0 — human-confirmed
]);
export type LinkStrategy = z.infer<typeof LinkStrategySchema>;

// Confidence ranges per strategy (for validation and UI display)
export const STRATEGY_CONFIDENCE: Record<
  z.infer<typeof LinkStrategySchema>,
  { min: number; max: number }
> = {
  session_id:  { min: 0.90, max: 0.99 },
  stack_trace: { min: 0.80, max: 0.95 },
  time_window: { min: 0.60, max: 0.80 },
  vector:      { min: 0.30, max: 0.60 },
  manual:      { min: 1.00, max: 1.00 },
};

// ── CausalEdge ────────────────────────────────────────────────────
// Immutable except confirmedBy (set once, never changed again).
export const CausalEdgeSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: EdgeTypeSchema,
  weight: z.number().min(0).max(1),
  linkStrategy: LinkStrategySchema,
  confirmedBy: z.string().nullable(),
  isSuggested: z.boolean().default(false),  // true = needs human confirmation
  orgId: z.string(),
  createdAt: z.number().int().positive(),
});
export type CausalEdge = z.infer<typeof CausalEdgeSchema>;

export const CreateEdgeSchema = CausalEdgeSchema.omit({
  id: true,
  createdAt: true,
}).extend({
  id: z.string().uuid().optional(),
});
export type CreateEdge = z.infer<typeof CreateEdgeSchema>;

// ── Edge confirmation ─────────────────────────────────────────────
export const ConfirmEdgeSchema = z.object({
  confirmed: z.boolean(),
  userId: z.string(),
  note: z.string().optional(),
});
export type ConfirmEdge = z.infer<typeof ConfirmEdgeSchema>;
