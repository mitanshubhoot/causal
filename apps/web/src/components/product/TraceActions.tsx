"use client";

import Link from "next/link";
import type { ObservabilityDemo } from "@/lib/mock-observability";
import { GitPullRequest, Waypoints, FileText, Database, Check, Clock } from "lucide-react";

/**
 * Trace-level actions, pinned under the trace header.
 *
 * These used to live inside the Copilot conversation, where they scrolled out
 * of view as soon as the chat grew — so the product's most valuable outputs
 * (the fix PR, the provenance graph, the post-mortem) became undiscoverable.
 * They belong to the TRACE, not to a message, so they live here: always
 * visible, and labelled with their state rather than just an icon.
 */
export function TraceActions({
  demo,
  onOpenFixPr,
  onOpenGraph,
  onPromote,
}: {
  demo: ObservabilityDemo;
  onOpenFixPr: () => void;
  onOpenGraph: () => void;
  onPromote?: () => void;
}) {
  const pr = demo.fixPr;
  const verified = pr?.status === "verified";

  return (
    // min-w-0 + a scroll container: the bar must never widen the trace pane,
    // which previously pushed the whole 5-pane layout past the viewport.
    <div className="flex items-center gap-1.5 px-3 h-10 border-b border-white/[0.06] flex-shrink-0 min-w-0 overflow-x-auto">
      {pr && (
        <button
          onClick={onOpenFixPr}
          title={`Fix PR #${pr.number} — ${verified ? "causal-replay passed" : "not yet verified"}`}
          className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] rounded-md border px-2 py-1 transition-colors text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12]"
        >
          <GitPullRequest className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Fix PR</span> #{pr.number}
          {verified ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <Clock className="w-3 h-3 text-amber-400" />
          )}
        </button>
      )}

      <button
        onClick={onOpenGraph}
        title="Causal graph — the six-layer provenance chain for this failure"
        className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2 py-1 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
      >
        <Waypoints className="w-3.5 h-3.5 text-indigo-300/80" />
        <span className="hidden lg:inline">Causal graph</span>
      </button>

      <Link
        href={`/incidents/${demo.incidentId}/postmortem`}
        title="Generate the post-mortem for this incident"
        className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2 py-1 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
      >
        <FileText className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">Post-mortem</span>
      </Link>

      {demo.finding && (
        <button
          onClick={onPromote}
          title="Turn this finding into a golden case so every release is tested against it"
          className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2 py-1 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
        >
          <Database className="w-3.5 h-3.5 text-amber-300/80" />
          <span className="hidden lg:inline">Add to eval set</span>
        </button>
      )}
    </div>
  );
}
