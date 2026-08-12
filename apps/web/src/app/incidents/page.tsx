"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, AlertOctagon, ShieldAlert, GitPullRequest, Gauge } from "lucide-react";
import { getAllDemos } from "@/lib/mock-observability";
import { LogoMark } from "@/components/LogoMark";
import { NAV_ITEMS } from "@/components/product/ProductNav";
import { SeverityChip, ConfidenceMeter, MonoLabel, DETECTOR_LABEL, STATUS_META } from "@/components/product/ui";

type SevFilter = "all" | "P1" | "P2" | "P3";

function StatTile({ label, value, sub, Icon, tone = "text-zinc-100" }: {
  label: string; value: string; sub?: string; Icon: typeof Gauge; tone?: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] p-4 bg-[#0f0f11]">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-zinc-600" strokeWidth={1.75} />
        <MonoLabel>{label}</MonoLabel>
      </div>
      <p className={`text-[26px] font-light tracking-tight tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function IncidentsPage() {
  const demos = getAllDemos();
  const [search, setSearch] = useState("");
  const [sev, setSev] = useState<SevFilter>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return demos.filter((d) => {
      const matchesSev = sev === "all" || d.severity === sev;
      const matchesText = !q || d.title.toLowerCase().includes(q) || d.service.toLowerCase().includes(q) || d.externalId.toLowerCase().includes(q);
      return matchesSev && matchesText;
    });
  }, [demos, search, sev]);

  const p1 = demos.filter((d) => d.severity === "P1").length;
  const avgConf = Math.round((demos.reduce((a, d) => a + d.finding.confidence, 0) / demos.length) * 100);

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-300">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex items-center gap-3 px-4 sm:px-6 h-12 border-b border-white/[0.06] bg-[#0a0a0b]/90 backdrop-blur">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={20} />
          <span className="text-[14px] font-semibold text-zinc-100 tracking-tight">Causal</span>
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-[13px] text-zinc-400">Incidents</span>
        {/* The other product surfaces are real routes — reachable from here,
            not buried inside a single trace. */}
        <nav className="hidden md:flex items-center gap-1 ml-3">
          {NAV_ITEMS.filter((n) => n.href !== "/incidents").map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12.5px] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span className="font-mono text-[9px] tracking-[0.14em] text-indigo-200/80 uppercase border border-indigo-400/25 bg-indigo-500/[0.08] px-2.5 py-1 rounded-full">
            Demo workspace
          </span>
          <Link href="/" className="font-mono text-[11px] tracking-[0.12em] text-zinc-500 hover:text-zinc-300 uppercase transition-colors">
            Home
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="mb-5">
          <h1 className="text-[22px] font-medium text-zinc-100 tracking-tight">Incidents</h1>
          <p className="text-[13px] text-zinc-500 mt-1">Production agent failures, detected and root-caused. Open one to explore its trace.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile label="Open incidents" value={String(demos.length)} sub={`${p1} P1`} Icon={AlertOctagon} tone="text-red-400" />
          <StatTile label="Detectors firing" value={String(demos.length)} sub="LLM-as-judge" Icon={ShieldAlert} />
          <StatTile label="Fixes shipped" value={String(demos.length)} sub="auto PRs, verified" Icon={GitPullRequest} tone="text-emerald-400" />
          <StatTile label="Avg confidence" value={`${avgConf}%`} sub="root-cause certainty" Icon={Gauge} />
        </div>

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.02] px-3 py-2 flex-1 max-w-sm focus-within:border-white/20 transition-colors">
            <Search className="w-3.5 h-3.5 text-zinc-600" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search incidents…"
              className="flex-1 bg-transparent outline-none text-[12.5px] text-zinc-200 placeholder:text-zinc-600"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "P1", "P2", "P3"] as SevFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setSev(s)}
                className={`font-mono text-[11px] tracking-[0.08em] uppercase px-2.5 py-1.5 rounded-md border transition-colors ${
                  sev === s ? "border-white/25 text-zinc-200 bg-white/[0.05]" : "border-white/[0.07] text-zinc-500 hover:border-white/15 hover:text-zinc-300"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          <div className="hidden sm:grid grid-cols-[80px_1fr_150px_150px_28px] gap-3 px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
            <MonoLabel>Severity</MonoLabel>
            <MonoLabel>Incident</MonoLabel>
            <MonoLabel>Detector</MonoLabel>
            <MonoLabel>Confidence</MonoLabel>
            <span />
          </div>
          {filtered.length === 0 && (
            <p className="px-4 py-10 text-center font-mono text-[12px] text-zinc-600">No incidents match your filters.</p>
          )}
          {filtered.map((d) => (
            <Link
              key={d.incidentId}
              href={`/incidents/${d.incidentId}`}
              className="grid grid-cols-[80px_1fr_150px_150px_28px] gap-3 px-4 py-3 items-center border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
            >
              <span><SeverityChip severity={d.severity} /></span>
              <span className="min-w-0 flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_META.error.dot}`} />
                <span className="min-w-0">
                  <span className="block text-[13px] text-zinc-200 truncate group-hover:text-zinc-100">{d.title}</span>
                  <span className="block font-mono text-[10.5px] text-zinc-600 truncate">{d.service} · {d.externalId} · {d.startedAt}</span>
                </span>
              </span>
              <span className="hidden sm:block font-mono text-[11px] text-zinc-400">{DETECTOR_LABEL[d.finding.detector]}</span>
              <span className="hidden sm:block"><ConfidenceMeter value={d.finding.confidence} /></span>
              <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors justify-self-end" />
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
