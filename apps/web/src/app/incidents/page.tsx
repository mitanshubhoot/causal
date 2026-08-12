"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, AlertOctagon, ShieldAlert, GitPullRequest, Gauge, Shield } from "lucide-react";
import { getAllDemos } from "@/lib/mock-observability";
import { SECURITY_EVENTS, explorerIncidentFor } from "@/lib/mock-security";
import type { SecurityEvent } from "@/lib/security-types";
import { LogoMark } from "@/components/LogoMark";
import { NAV_ITEMS } from "@/components/product/ProductNav";
import { LoadingPane, useLiveIncidents } from "@/components/product/views";
import { SeverityChip, ConfidenceMeter, MonoLabel, DETECTOR_LABEL, STATUS_META } from "@/components/product/ui";

type SevFilter = "all" | "P1" | "P2" | "P3";

/**
 * Security events grouped by the incident whose trace they were raised against.
 *
 * `explorerIncidentFor` is the only wiring that proves an event and an incident
 * share a trace, so a row is marked only when it resolves — an event on a trace
 * with no explorer page, or a live incident whose id came from the API, matches
 * nothing and gets no chip. Nothing here is inferred from titles or timestamps.
 */
const SECURITY_BY_INCIDENT: ReadonlyMap<string, SecurityEvent[]> = (() => {
  const byIncident = new Map<string, SecurityEvent[]>();
  for (const event of SECURITY_EVENTS) {
    const incidentId = explorerIncidentFor(event.traceId);
    if (!incidentId) continue;
    const bucket = byIncident.get(incidentId);
    if (bucket) bucket.push(event);
    else byIncident.set(incidentId, [event]);
  }
  return byIncident;
})();

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
  // This route was mock-only: NEXT_PUBLIC_USE_LIVE_TRACES=1 changed nothing here.
  const live = useLiveIncidents();
  const demos = live.demos ?? getAllDemos();
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
  // Each tile has to answer a different question. Three of them rendered
  // demos.length, so the row repeated one number and called it three metrics.
  const firing = new Set(demos.map((d) => d.finding.detector)).size;
  // "Shipped" means causal-replay ran the tests and they passed. An opened PR
  // is not a shipped fix.
  const verified = demos.filter((d) => d.fixPr?.status === "verified").length;
  // Nothing to average over → drop the tile rather than print 0% or NaN%.
  const avgConf = demos.length
    ? Math.round((demos.reduce((a, d) => a + d.finding.confidence, 0) / demos.length) * 100)
    : null;

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

        {/* A live load in flight must not paint the mock incidents and then
            swap them for the real ones. */}
        {live.pending ? (
          <div className="h-[40vh]">
            <LoadingPane label="Loading incidents…" />
          </div>
        ) : (
          <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatTile label="Open incidents" value={String(demos.length)} sub={`${p1} P1`} Icon={AlertOctagon} tone="text-red-400" />
            <StatTile label="Detectors firing" value={String(firing)} sub="with open findings" Icon={ShieldAlert} />
            <StatTile label="Fixes shipped" value={String(verified)} sub={`of ${demos.length} · causal-replay passed`} Icon={GitPullRequest} tone="text-emerald-400" />
            {avgConf !== null && (
              <StatTile label="Avg confidence" value={`${avgConf}%`} sub="root-cause certainty" Icon={Gauge} />
            )}
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
            {filtered.map((d) => {
              const sec = SECURITY_BY_INCIDENT.get(d.incidentId);
              const secOpen = sec?.some((e) => e.status !== "resolved") ?? false;
              return (
                <div
                  key={d.incidentId}
                  className="relative grid grid-cols-[80px_1fr_150px_150px_28px] gap-3 px-4 py-3 items-center border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
                >
                  {/* The row still navigates to the trace, but a row with a
                      security event has a second destination — and an <a>
                      inside an <a> is invalid — so the row link is a stretched
                      overlay rather than a wrapper. */}
                  <Link
                    href={`/incidents/${d.incidentId}`}
                    aria-label={`Open incident: ${d.title}`}
                    className="absolute inset-0"
                  />
                  <span><SeverityChip severity={d.severity} /></span>
                  <span className="min-w-0 flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_META.error.dot}`} />
                    <span className="min-w-0">
                      <span className="block text-[13px] text-zinc-200 truncate group-hover:text-zinc-100">{d.title}</span>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10.5px] text-zinc-600 truncate">{d.service} · {d.externalId} · {d.startedAt}</span>
                        {sec && (
                          <Link
                            href="/security"
                            title={sec.map((e) => `${e.id} · ${e.title}`).join("\n")}
                            className={`relative z-10 flex-shrink-0 flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] transition-colors ${
                              secOpen
                                ? "border-red-400/25 bg-red-500/[0.08] text-red-300/90 hover:border-red-400/50"
                                : "border-white/[0.07] bg-white/[0.02] text-zinc-500 hover:text-zinc-200 hover:border-white/20"
                            }`}
                          >
                            <Shield className="w-3 h-3" strokeWidth={1.75} />
                            {sec.length === 1 ? sec[0].id : `${sec.length} security events`}
                          </Link>
                        )}
                      </span>
                    </span>
                  </span>
                  <span className="hidden sm:block font-mono text-[11px] text-zinc-400">{DETECTOR_LABEL[d.finding.detector]}</span>
                  <span className="hidden sm:block"><ConfidenceMeter value={d.finding.confidence} /></span>
                  <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors justify-self-end" />
                </div>
              );
            })}
          </div>
          </>
        )}
      </main>
    </div>
  );
}
