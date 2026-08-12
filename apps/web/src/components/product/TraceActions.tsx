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
    <div className="flex items-center gap-2 px-3 h-11 border-b border-white/[0.06] flex-shrink-0 overflow-x-auto">
      <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-zinc-600 flex-shrink-0 mr-1">
        Actions
      </span>

      {pr && (
        <button
          onClick={onOpenFixPr}
          className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] rounded-md border px-2.5 py-1.5 transition-colors text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12]"
        >
          <GitPullRequest className="w-3.5 h-3.5" />
          Fix PR #{pr.number}
          <span
            className={`ml-1 inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.08em] uppercase px-1.5 py-0.5 rounded border ${
              verified
                ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                : "text-amber-400 border-amber-500/30 bg-amber-500/10"
            }`}
          >
            {verified ? <Check className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
            {verified ? "verified" : "unverified"}
          </span>
        </button>
      )}

      <button
        onClick={onOpenGraph}
        className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2.5 py-1.5 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
      >
        <Waypoints className="w-3.5 h-3.5 text-indigo-300/80" />
        Causal graph
      </button>

      <Link
        href={`/incidents/${demo.incidentId}/postmortem`}
        className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2.5 py-1.5 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
      >
        <FileText className="w-3.5 h-3.5" />
        Post-mortem
      </Link>

      {demo.finding && (
        <button
          onClick={onPromote}
          title="Turn this finding into a golden case so every release is tested against it"
          className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2.5 py-1.5 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
        >
          <Database className="w-3.5 h-3.5 text-amber-300/80" />
          Add to eval set
        </button>
      )}
    </div>
  );
}
