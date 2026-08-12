"use client";

import type { ObservabilityDemo, DemoSpan, DiffLineKind, DetectorType } from "./mock-observability";
import type { LiveTraceRow } from "./traces-api";

// Map the API's severity/detector shapes to the web product shapes.
function sev(findingSeverity: string | undefined): ObservabilityDemo["severity"] {
  if (findingSeverity === "critical") return "P1";
  if (findingSeverity === "high") return "P2";
  if (findingSeverity === "medium") return "P3";
  return "OK";
}

/**
 * The demo shape plus the identifier the demo shape has no field for. Promoting
 * a finding to a golden case is keyed on the finding id, and dropping it during
 * the map left the explorer with nothing to send to `POST /findings/:id/promote`.
 */
export type LiveDemo = ObservabilityDemo & { findingId: string | null };

/** Map a live `GET /traces/:id` (+ optional `GET /traces/:id/rca`) into the
 *  ObservabilityDemo shape the explorer already renders.
 *
 *  `findingId` is passed in because `GET /traces/:id` does not return it —
 *  `fetchFindingId(traceId)` resolves it from the findings list. */
export function mapLiveToDemo(
  detail: Record<string, unknown>,
  rca: Record<string, unknown> | null,
  findingId?: string | null
): LiveDemo {
  const finding = detail["finding"] as Record<string, unknown> | null;
  const spans = (detail["spans"] as DemoSpan[]) ?? [];
  const diff = (rca?.["fixDiff"] as { kind: DiffLineKind; text: string }[]) ?? [];
  const additions = diff.filter((d) => d.kind === "add").length;
  const deletions = diff.filter((d) => d.kind === "del").length;

  return {
    // The caller's id wins; `id` is read too so this keeps working if the trace
    // endpoint ever carries the finding's id itself. Null when neither exists —
    // the promote button must stay disabled rather than post a guessed id.
    findingId: findingId ?? (finding?.["id"] as string | undefined) ?? null,
    incidentId: String(detail["traceId"]),
    service: String(detail["service"] ?? "service"),
    environment: String(detail["environment"] ?? "production"),
    traceId: String(detail["traceId"]),
    externalId: String(detail["traceId"]).slice(0, 8),
    title: String(detail["title"] ?? finding?.["title"] ?? "Trace"),
    severity: sev(finding?.["severity"] as string | undefined),
    startedAt: String(detail["startedAt"] ?? ""),
    model: String(detail["model"] ?? "claude-sonnet-4-5"),
    tokensIn: Number(detail["tokensIn"] ?? 0),
    tokensOut: Number(detail["tokensOut"] ?? 0),
    cost: Number(detail["cost"] ?? 0),
    repo: (detail["repo"] as string) ?? undefined,
    gitRef: (detail["gitRef"] as string) ?? undefined,
    user: (detail["user"] as string) ?? undefined,
    sessionId: (detail["sessionId"] as string) ?? undefined,
    metadata: (detail["metadata"] as { label: string; value: string }[]) ?? [],
    spans,
    finding: finding
      ? {
          detector: (finding["detector"] as DetectorType) ?? "tool_failure",
          title: String(finding["title"]),
          severity: (finding["severity"] as "critical" | "high" | "medium") ?? "high",
          confidence: Number(finding["confidence"] ?? 0.9),
          summary: String(finding["summary"] ?? ""),
          triggeredSpanId: String(finding["triggeredSpanId"] ?? spans[0]?.id ?? ""),
          // Only what the API actually told us — inventing "slack" here claimed
          // an alert had been delivered that may never have been sent.
          alertedVia: Array.isArray(finding["alertedVia"]) ? (finding["alertedVia"] as ("slack" | "email")[]) : [],
          judgeModel: String(finding["judgeModel"] ?? "unknown"),
        }
      : undefined,
    rootCause: rca
      ? {
          summary: String(rca["summary"] ?? ""),
          commit: String(rca["commit"] ?? ""),
          commitMessage: String(rca["commitMessage"] ?? ""),
          // The RCA row records the model that produced it; "causal-rca" was a
          // made-up author string presented as if a person or agent signed it.
          author: String(rca["model"] ?? ""),
          file: String(rca["file"] ?? ""),
          line: Number(rca["line"] ?? 0),
          explanation: String(rca["explanation"] ?? ""),
          counterfactual: String(rca["counterfactual"] ?? ""),
          confidence: Number(rca["confidence"] ?? 0.85),
          hopsUpstream: Number(rca["hopsUpstream"] ?? 1),
        }
      : undefined,
    fixPr: rca
      ? {
          number: Number(rca["prNumber"] ?? 0),
          title: String(rca["fixTitle"] ?? "Proposed fix"),
          branch: `causal/fix-${String(rca["id"] ?? "").slice(0, 8)}`,
          base: String(rca["baseBranch"] ?? "main"),
          // "verified" means the causal-replay check RAN THE TESTS and they
          // passed — the API reports that as `verified`. Opening a PR is not
          // verification, and mapping it to "verified" here was the one place
          // the product asserted something untrue at runtime.
          status: rca["verified"] === true ? "verified" : "open",
          filesChanged: Number(rca["filesChanged"] ?? (diff.length ? 1 : 0)),
          additions,
          deletions,
          description: String(rca["fixDescription"] ?? ""),
          file: String(rca["file"] ?? ""),
          diff,
          // Only report a check we were actually told about.
          checks:
            rca["verified"] === true
              ? [{ name: "causal-replay", status: "pass" as const }]
              : rca["prStatus"] === "opened"
                ? [{ name: "causal-replay", status: "pending" as const }]
                : [],
        }
      : undefined,
  };
}

/** Map a live list row to the TraceRow shape used by the traces list. */
export function mapLiveRow(r: LiveTraceRow): { id: string; name: string; timestamp: string; status: "ok" | "warn" | "error"; selectable: boolean } {
  return {
    id: r.id,
    name: r.name ?? r.service,
    timestamp: r.startedAt,
    status: r.status,
    selectable: true,
  };
}
