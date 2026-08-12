"use client";

import type { ObservabilityDemo, DiffLineKind } from "@/lib/mock-observability";
import { MonoLabel } from "./ui";
import { GitPullRequest, Check, CornerDownRight } from "lucide-react";

const DIFF_TONE: Record<DiffLineKind, string> = {
  add: "bg-emerald-500/[0.07] text-emerald-300",
  del: "bg-red-500/[0.07] text-red-300",
  ctx: "text-zinc-400",
  meta: "text-zinc-600",
};
const DIFF_SIGN: Record<DiffLineKind, string> = { add: "+", del: "-", ctx: " ", meta: " " };

export function FixPrView({ demo }: { demo: ObservabilityDemo }) {
  const pr = demo.fixPr;
  if (!pr) return null;
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        {/* PR header */}
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-7 h-7 rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] flex items-center justify-center flex-shrink-0">
            <GitPullRequest className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] text-zinc-100 font-medium">{pr.title}</span>
              <span className="font-mono text-[11px] text-zinc-500">#{pr.number}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 font-mono text-[11px] text-zinc-500">
              <span className="text-indigo-300/80">{pr.branch}</span>
              <CornerDownRight className="w-3 h-3" />
              <span>{pr.base}</span>
              <span className="text-zinc-700">·</span>
              <span className="text-emerald-400">+{pr.additions}</span>
              <span className="text-red-400">−{pr.deletions}</span>
              <span className="text-zinc-600">{pr.filesChanged} file</span>
            </div>
          </div>
          {pr.status === "verified" && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 rounded">
              <Check className="w-3 h-3" /> Verified
            </span>
          )}
        </div>

        <p className="text-[13px] text-zinc-400 leading-relaxed">{pr.description}</p>

        {/* Diff */}
        <div className="rounded-md border border-white/[0.06] overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
            <span className="font-mono text-[11px] text-zinc-400">{pr.file}</span>
          </div>
          <pre className="overflow-x-auto text-[11.5px] leading-[1.7] py-1.5">
            {pr.diff.map((ln, i) => (
              <div key={i} className={`grid grid-cols-[18px_1fr] px-2 ${DIFF_TONE[ln.kind]}`}>
                <span className="select-none text-center opacity-60">{DIFF_SIGN[ln.kind]}</span>
                <code>{ln.text || " "}</code>
              </div>
            ))}
          </pre>
        </div>

        {/* Checks */}
        <div className="flex items-center gap-4">
          <MonoLabel>Checks</MonoLabel>
          <div className="flex items-center gap-3">
            {pr.checks.map((c) => (
              <span key={c.name} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-400">
                <span
                  className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ${
                    c.status === "pass" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-zinc-500"
                  }`}
                >
                  {c.status === "pass" && <Check className="w-2.5 h-2.5" />}
                </span>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
