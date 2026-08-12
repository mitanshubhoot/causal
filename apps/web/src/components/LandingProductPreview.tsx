"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { getObservabilityDemo } from "@/lib/mock-observability";
import { TraceTree } from "./product/TraceTree";
import { SpanDetail } from "./product/SpanDetail";
import { DETECTOR_LABEL, SeverityChip } from "./product/ui";

/** Compact, live preview of the real product surface for the landing page —
 *  a mini trace explorer (tree + span detail) in the enterprise dark theme.
 *  Give it a `key={incidentId}` so selection resets when the incident changes. */
export function LandingProductPreview({ incidentId }: { incidentId: string }) {
  const demo = getObservabilityDemo(incidentId);
  const [sel, setSel] = useState(demo.finding?.triggeredSpanId ?? demo.spans[0]!.id);
  const selected = demo.spans.find((s) => s.id === sel) ?? demo.spans[0]!;

  return (
    <div className="grid grid-cols-[1fr_300px] h-full bg-[#0a0a0b] text-zinc-300">
      <div className="flex flex-col border-r border-white/[0.06] min-w-0">
        <div className="flex items-center gap-2 px-3 h-9 border-b border-white/[0.06] flex-shrink-0">
          <span className="font-mono text-[11px] text-zinc-400">Trace</span>
          <span className="font-mono text-[11px] text-zinc-200 truncate">{demo.traceId}</span>
          <SeverityChip severity={demo.severity} />
          {/* The verdict, not a teaser. This read demo.finding only to pick the
              selected span and then advertised a Copilot that is not in this
              frame — a chip for an absent feature reads as broken. Showing what
              the judge actually decided is the trace→detection handoff, and the
              data was already in scope. */}
          {demo.finding && (
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] flex-shrink-0">
              <ShieldAlert className="w-3 h-3 text-red-400" />
              <span className="text-zinc-300">{DETECTOR_LABEL[demo.finding.detector]}</span>
              <span className="text-zinc-500 tabular-nums">
                {Math.round(demo.finding.confidence * 100)}%
              </span>
            </span>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          <TraceTree spans={demo.spans} selectedId={sel} onSelect={setSel} />
        </div>
      </div>
      <div className="hidden sm:flex flex-col min-w-0">
        <SpanDetail span={selected} />
      </div>
    </div>
  );
}
