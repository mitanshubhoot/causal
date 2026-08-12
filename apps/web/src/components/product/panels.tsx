"use client";

import type { ObservabilityDemo, DiffLineKind } from "@/lib/mock-observability";
import { DETECTOR_LABEL, MonoLabel, ConfidenceMeter, SeverityChip } from "./ui";
import { ShieldAlert, GitPullRequest, GitCommit, Check, Slack, Mail, CornerDownRight } from "lucide-react";

// ── Detector finding banner ─────────────────────────────────────────
export function DetectorBanner({ demo, onInspect }: { demo: ObservabilityDemo; onInspect?: () => void }) {
  const f = demo.finding;
  return (
    <div className="border-b border-white/[0.06] bg-[#0f0f11] px-4 sm:px-6 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-md border border-red-500/25 bg-red-500/[0.08] flex items-center justify-center">
          <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-red-400/90 font-semibold">
              Detector · {DETECTOR_LABEL[f.detector]}
            </span>
            <SeverityChip severity={f.severity} />
            <span className="font-mono text-[10px] text-zinc-600">judge: {f.judgeModel}</span>
          </div>
          <p className="text-[13px] text-zinc-200 mt-1 font-medium">{f.title}</p>
          <p className="text-[12.5px] text-zinc-500 mt-1 leading-relaxed max-w-3xl">{f.summary}</p>
        </div>
        <div className="hidden md:flex flex-col items-end gap-2 flex-shrink-0">
          <ConfidenceMeter value={f.confidence} />
          <div className="flex items-center gap-1.5">
            {f.alertedVia.includes("slack") && <Slack className="w-3 h-3 text-zinc-500" />}
            {f.alertedVia.includes("email") && <Mail className="w-3 h-3 text-zinc-500" />}
            <span className="font-mono text-[10px] text-zinc-600">alerted</span>
          </div>
          {onInspect && (
            <button onClick={onInspect} className="font-mono text-[10px] text-indigo-300/80 hover:text-indigo-200">
              inspect span →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Root-cause panel ────────────────────────────────────────────────
export function RootCausePanel({ demo, graph }: { demo: ObservabilityDemo; graph?: React.ReactNode }) {
  const rc = demo.rootCause;
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-5">
          <div>
            <MonoLabel className="block mb-2">Root cause · {rc.hopsUpstream} hops upstream</MonoLabel>
            <h2 className="text-[19px] text-zinc-100 font-medium leading-snug">{rc.summary}</h2>
          </div>

          <div className="rounded-md border border-white/[0.06] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]">
              <GitCommit className="w-3.5 h-3.5 text-indigo-300/80" />
              <span className="font-mono text-[11px] text-indigo-300/80">{rc.commit}</span>
              <span className="font-mono text-[12px] text-zinc-300 truncate">{rc.commitMessage}</span>
            </div>
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="font-mono text-[11px] text-zinc-500">
                {rc.file}:{rc.line}
              </span>
              <span className="font-mono text-[11px] text-zinc-500">by {rc.author}</span>
            </div>
          </div>

          <div>
            <MonoLabel className="block mb-1.5">Analysis</MonoLabel>
            <p className="text-[13.5px] text-zinc-300 leading-relaxed">{rc.explanation}</p>
          </div>

          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5">
            <MonoLabel className="block mb-1 text-emerald-400/70">Counterfactual</MonoLabel>
            <p className="text-[13px] text-zinc-300 leading-relaxed">{rc.counterfactual}</p>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-md border border-white/[0.06] p-3">
            <MonoLabel className="block mb-2">Confidence</MonoLabel>
            <ConfidenceMeter value={rc.confidence} />
          </div>
          {graph && (
            <div className="rounded-md border border-white/[0.06] overflow-hidden">
              <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]">
                <MonoLabel>Causal path</MonoLabel>
              </div>
              <div className="h-[320px]">{graph}</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Fix PR view ─────────────────────────────────────────────────────
const DIFF_TONE: Record<DiffLineKind, string> = {
  add: "bg-emerald-500/[0.07] text-emerald-300",
  del: "bg-red-500/[0.07] text-red-300",
  ctx: "text-zinc-400",
  meta: "text-zinc-600",
};
const DIFF_SIGN: Record<DiffLineKind, string> = { add: "+", del: "-", ctx: " ", meta: " " };

export function FixPrView({ demo }: { demo: ObservabilityDemo }) {
  const pr = demo.fixPr;
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
