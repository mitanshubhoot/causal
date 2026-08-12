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

/** Map a live `GET /traces/:id` (+ optional `GET /traces/:id/rca`) into the
 *  ObservabilityDemo shape the explorer already renders. */
export function mapLiveToDemo(detail: Record<string, unknown>, rca: Record<string, unknown> | null): ObservabilityDemo {
  const finding = detail["finding"] as Record<string, unknown> | null;
  const spans = (detail["spans"] as DemoSpan[]) ?? [];
  const diff = (rca?.["fixDiff"] as { kind: DiffLineKind; text: string }[]) ?? [];
  const additions = diff.filter((d) => d.kind === "add").length;
  const deletions = diff.filter((d) => d.kind === "del").length;

  return {
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
    spans,
    finding: finding
      ? {
          detector: (finding["detector"] as DetectorType) ?? "tool_failure",
          title: String(finding["title"]),
          severity: (finding["severity"] as "critical" | "high" | "medium") ?? "high",
          confidence: Number(finding["confidence"] ?? 0.9),
          summary: String(finding["summary"] ?? ""),
          triggeredSpanId: String(finding["triggeredSpanId"] ?? spans[0]?.id ?? ""),
          alertedVia: ["slack"],
          judgeModel: String(finding["judgeModel"] ?? "claude-haiku-4-5"),
        }
      : undefined,
    rootCause: rca
      ? {
          summary: String(rca["summary"] ?? ""),
          commit: String(rca["commit"] ?? ""),
          commitMessage: "",
          author: "causal-rca",
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
          base: "main",
          status: rca["prStatus"] === "opened" ? "verified" : "open",
          filesChanged: 1,
          additions,
          deletions,
          description: String(rca["fixDescription"] ?? ""),
          file: String(rca["file"] ?? ""),
          diff,
          checks: rca["prStatus"] === "opened" ? [{ name: "opened", status: "pass" }] : [],
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
