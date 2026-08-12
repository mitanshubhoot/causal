"use client";

import type { ObservabilityDemo } from "@/lib/mock-observability";
import { DETECTOR_LABEL, SeverityChip, ConfidenceMeter, MonoLabel } from "./ui";
import { ShieldAlert, ChevronRight, AlertOctagon, Activity, DollarSign, GitPullRequest } from "lucide-react";

// ── Detectors view ──────────────────────────────────────────────────
export function DetectorsView({ demos, onOpen }: { demos: ObservabilityDemo[]; onOpen: (id: string) => void }) {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-4 h-4 text-zinc-400" />
          <h1 className="text-[16px] text-zinc-100 font-medium">Detectors</h1>
        </div>
        <p className="text-[13px] text-zinc-500 mb-5">LLM-as-judge findings across your agents. Click a finding to open its trace.</p>

        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          <div className="grid grid-cols-[80px_130px_1fr_130px] gap-3 px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
            <MonoLabel>Severity</MonoLabel>
            <MonoLabel>Detector</MonoLabel>
            <MonoLabel>Finding</MonoLabel>
            <MonoLabel>Confidence</MonoLabel>
          </div>
          {demos.map((d) => (
            <button
              key={d.incidentId}
              onClick={() => onOpen(d.incidentId)}
              className="w-full grid grid-cols-[80px_130px_1fr_130px] gap-3 px-4 py-3 items-center text-left border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
            >
              <span><SeverityChip severity={d.finding.severity} /></span>
              <span className="font-mono text-[11px] text-zinc-400">{DETECTOR_LABEL[d.finding.detector]}</span>
              <span className="min-w-0">
                <span className="block text-[12.5px] text-zinc-200 truncate">{d.finding.title}</span>
                <span className="block font-mono text-[10.5px] text-zinc-600 truncate">{d.service} · {d.externalId}</span>
              </span>
              <span className="flex items-center gap-2">
                <ConfidenceMeter value={d.finding.confidence} />
                <ChevronRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard view ──────────────────────────────────────────────────
function StatTile({ label, value, sub, Icon, tone = "text-zinc-100" }: {
  label: string; value: string; sub?: string; Icon: typeof Activity; tone?: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-zinc-600" strokeWidth={1.75} />
        <MonoLabel>{label}</MonoLabel>
      </div>
      <p className={`text-[26px] font-light tracking-tight tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export function DashboardView({ demos, onOpen }: { demos: ObservabilityDemo[]; onOpen: (id: string) => void }) {
  const p1 = demos.filter((d) => d.severity === "P1").length;
  const cost = demos.reduce((a, d) => a + d.cost, 0);
  const avgConf = Math.round((demos.reduce((a, d) => a + d.finding.confidence, 0) / demos.length) * 100);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-4 h-4 text-zinc-400" />
          <h1 className="text-[16px] text-zinc-100 font-medium">Dashboard</h1>
        </div>
        <p className="text-[13px] text-zinc-500 mb-5">Production agent health — last 24 hours.</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile label="Open incidents" value={String(demos.length)} sub={`${p1} P1`} Icon={AlertOctagon} tone="text-red-400" />
          <StatTile label="Detectors firing" value={String(demos.length)} sub="LLM-as-judge" Icon={ShieldAlert} />
          <StatTile label="Fixes shipped" value={String(demos.length)} sub="auto PRs, verified" Icon={GitPullRequest} tone="text-emerald-400" />
          <StatTile label="Avg confidence" value={`${avgConf}%`} sub={`$${cost.toFixed(2)} spend`} Icon={DollarSign} />
        </div>

        <MonoLabel className="block mb-2">Recent incidents</MonoLabel>
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          {demos.map((d) => (
            <button
              key={d.incidentId}
              onClick={() => onOpen(d.incidentId)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
            >
              <SeverityChip severity={d.severity} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-zinc-200 truncate">{d.title}</span>
                <span className="block font-mono text-[10.5px] text-zinc-600">{d.service} · {d.startedAt}</span>
              </span>
              <span className="font-mono text-[10px] text-zinc-600 hidden sm:block">{d.externalId}</span>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
