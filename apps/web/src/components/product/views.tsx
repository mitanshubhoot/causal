"use client";

import { useEffect, useMemo, useState } from "react";
import type { IncidentDemo, DetectorEntity } from "@/lib/mock-observability";
import { getDetectors } from "@/lib/mock-observability";
import { fetchDetectors, fetchDetector, fetchTraceList, fetchTraceDetail, fetchRca, LIVE_TRACES } from "@/lib/traces-api";
import { mapLiveToDemo } from "@/lib/live-traces";
import { DETECTOR_LABEL, SeverityChip, ConfidenceMeter, MonoLabel } from "./ui";
import { ShieldAlert, ChevronRight, ChevronLeft, AlertOctagon, Activity, DollarSign, GitPullRequest, Eye, CheckCircle2, Loader2 } from "lucide-react";

/** Shown while a live fetch is in flight. Rendering mock data under a real id
 *  while the API answers showed fabricated content attributed to that id. */
export function LoadingPane({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <span className="flex items-center gap-2 font-mono text-[12px] text-zinc-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {label}
      </span>
    </div>
  );
}

/** Live incidents for the dashboard and the /incidents list — both routes used
 *  to be mock-only, so NEXT_PUBLIC_USE_LIVE_TRACES=1 changed nothing on either.
 *  `demos` stays null when the flag is off or the load fails, so the caller
 *  falls back to the mock instead of rendering an empty workspace. */
export function useLiveIncidents(): { demos: IncidentDemo[] | null; pending: boolean } {
  const [demos, setDemos] = useState<IncidentDemo[] | null>(null);
  const [pending, setPending] = useState(LIVE_TRACES);

  useEffect(() => {
    if (!LIVE_TRACES) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchTraceList();
        const out: IncidentDemo[] = [];
        for (const row of list.filter((t) => t.status !== "ok")) {
          try {
            const mapped = mapLiveToDemo(await fetchTraceDetail(row.id), await fetchRca(row.id));
            if (mapped.finding) out.push(mapped as IncidentDemo);
          } catch {
            /* skip this incident */
          }
        }
        if (!cancelled) setDemos(out);
      } catch {
        if (!cancelled) setDemos(null); // whole load failed → mock
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { demos, pending };
}

// ── Detectors view — named detectors, each with Findings + Runs ─────
function DetectorList({ detectors, onOpen }: { detectors: DetectorEntity[]; onOpen: (d: DetectorEntity) => void }) {
  return (
    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
      {detectors.map((d) => {
        // The list endpoint carries counts, not the findings/runs rows — deriving
        // the count from the (empty) arrays printed "0 open / 0" for every live
        // detector.
        const open = d.openFindings ?? d.findings.filter((f) => !f.resolved).length;
        const total = d.totalFindings ?? d.findings.length;
        return (
          <button
            key={d.id}
            onClick={() => onOpen(d)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.enabled ? "bg-emerald-400" : "bg-zinc-600"}`} title={d.enabled ? "Enabled" : "Disabled"} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] text-zinc-100">{d.name}</span>
                <span className="font-mono text-[9px] tracking-[0.08em] uppercase text-zinc-500 border border-white/10 rounded px-1.5 py-0.5">{DETECTOR_LABEL[d.type]}</span>
              </div>
              <span className="block text-[12px] text-zinc-500 truncate mt-0.5">{d.description}</span>
            </div>
            <span className="font-mono text-[11px] text-zinc-500 flex-shrink-0 tabular-nums">
              <span className={open > 0 ? "text-red-400" : "text-zinc-600"}>{open}</span>{" "}
              open <span className="text-zinc-700">/</span> {total}
            </span>
            <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function DetectorDetail({ detector, onBack, onOpen }: { detector: DetectorEntity; onBack: () => void; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<"findings" | "runs">("findings");
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300">
          <ChevronLeft className="w-3.5 h-3.5" /> Detectors
        </button>
        <span className="text-zinc-700">/</span>
        <span className="font-mono text-[13px] text-zinc-100">{detector.name}</span>
        <span className="font-mono text-[9px] tracking-[0.08em] uppercase text-zinc-500 border border-white/10 rounded px-1.5 py-0.5">{DETECTOR_LABEL[detector.type]}</span>
      </div>

      <div className="flex items-center gap-4 border-b border-white/[0.06] mb-3">
        {(["findings", "runs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[12.5px] capitalize py-2 -mb-px border-b-2 transition-colors ${
              tab === t ? "border-indigo-400/80 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t} {t === "findings" ? `(${detector.findings.length})` : `(${detector.runs.length})`}
          </button>
        ))}
      </div>

      {tab === "findings" ? (
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          <div className="hidden sm:grid grid-cols-[70px_140px_1fr_120px] gap-3 px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
            <MonoLabel>Severity</MonoLabel>
            <MonoLabel>Timestamp</MonoLabel>
            <MonoLabel>Finding</MonoLabel>
            <MonoLabel>Confidence</MonoLabel>
          </div>
          {detector.findings.length === 0 && <p className="px-4 py-8 text-center font-mono text-[12px] text-zinc-600">No findings.</p>}
          {detector.findings.map((f) => (
            <button
              key={f.findingId}
              onClick={() => onOpen(f.traceId)}
              className="w-full grid grid-cols-[70px_140px_1fr_120px] gap-3 px-4 py-3 items-center text-left border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors"
            >
              <SeverityChip severity={f.severity} />
              <span className="font-mono text-[11px] text-zinc-500">{f.timestamp}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[12.5px] text-zinc-200 truncate">{f.title}</span>
                  <span
                    className={`flex-shrink-0 font-mono text-[9px] tracking-[0.08em] uppercase px-1.5 py-0.5 rounded border ${
                      f.resolved
                        ? "text-emerald-400/80 border-emerald-500/25 bg-emerald-500/[0.06]"
                        : "text-red-400 border-red-500/25 bg-red-500/[0.08]"
                    }`}
                  >
                    {f.resolved ? "Resolved" : "Open"}
                  </span>
                </span>
                <span className="block font-mono text-[10px] text-zinc-600 truncate">{f.findingId} · {f.service}</span>
              </span>
              <ConfidenceMeter value={f.confidence} />
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          <div className="hidden sm:grid grid-cols-[90px_150px_1fr] gap-3 px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
            <MonoLabel>Result</MonoLabel>
            <MonoLabel>Timestamp</MonoLabel>
            <MonoLabel>Service</MonoLabel>
          </div>
          {detector.runs.length === 0 && <p className="px-4 py-8 text-center font-mono text-[12px] text-zinc-600">No runs.</p>}
          {detector.runs.map((r, i) => (
            <button
              key={i}
              onClick={() => onOpen(r.traceId)}
              className="w-full grid grid-cols-[90px_150px_1fr] gap-3 px-4 py-2.5 items-center text-left border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors"
            >
              <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase ${r.identified ? "text-red-400" : "text-zinc-500"}`}>
                {r.identified ? <ShieldAlert className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3 text-emerald-500/70" />}
                {r.identified ? "flagged" : "clean"}
              </span>
              <span className="font-mono text-[11px] text-zinc-500">{r.timestamp}</span>
              <span className="font-mono text-[11.5px] text-zinc-300 truncate">{r.service}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DetectorsView({ onOpen }: { onOpen: (id: string) => void }) {
  const mock = useMemo(() => getDetectors(), []);
  const [detectors, setDetectors] = useState<DetectorEntity[]>(mock);
  const [selected, setSelected] = useState<DetectorEntity | null>(null);

  // Live mode: load real detectors + their findings/runs history. Any failure
  // leaves the mock data in place so the demo never shows an empty section.
  useEffect(() => {
    if (!LIVE_TRACES) return;
    let cancelled = false;
    void fetchDetectors()
      .then((live) => {
        if (cancelled || live.length === 0) return;
        setDetectors(
          live.map((d) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            description: d.description,
            enabled: d.enabled,
            // The counts the API computed. Dropping them here is what made every
            // live detector read "0 open / 0".
            openFindings: d.openFindings,
            totalFindings: d.totalFindings,
            totalRuns: d.totalRuns,
            findings: [],
            runs: [],
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch a detector's history only when it's opened.
  const open = (d: DetectorEntity) => {
    setSelected(d);
    if (!LIVE_TRACES) return;
    void fetchDetector(d.name)
      .then((full) => {
        if (!full) return;
        setSelected({
          ...d,
          findings: (full["findings"] as DetectorEntity["findings"]) ?? [],
          runs: (full["runs"] as DetectorEntity["runs"]) ?? [],
        });
      })
      .catch(() => undefined);
  };
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        {!selected ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Eye className="w-4 h-4 text-zinc-400" />
              <h1 className="text-[16px] text-zinc-100 font-medium">Detectors</h1>
            </div>
            <p className="text-[13px] text-zinc-500 mb-5">LLM-as-judge detectors evaluating every trace. Open one to see its findings and runs.</p>
            <DetectorList detectors={detectors} onOpen={open} />
          </>
        ) : (
          <DetectorDetail detector={selected} onBack={() => setSelected(null)} onOpen={onOpen} />
        )}
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

export function DashboardView({ demos, onOpen }: { demos: IncidentDemo[]; onOpen: (id: string) => void }) {
  const p1 = demos.filter((d) => d.severity === "P1").length;
  const cost = demos.reduce((a, d) => a + d.cost, 0);
  // Each tile has to answer a different question. Three of them rendered
  // demos.length, so the row repeated one number and called it three metrics.
  const firing = new Set(demos.map((d) => d.finding.detector)).size;
  // "Shipped" means causal-replay ran the tests and they passed — the only flag
  // that carries that claim. An opened PR is not a shipped fix.
  const verified = demos.filter((d) => d.fixPr?.status === "verified").length;
  // Nothing to average over → drop the tile rather than print 0% or NaN%.
  const avgConf = demos.length
    ? Math.round((demos.reduce((a, d) => a + d.finding.confidence, 0) / demos.length) * 100)
    : null;

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
          <StatTile label="Detectors firing" value={String(firing)} sub="with open findings" Icon={ShieldAlert} />
          <StatTile label="Fixes shipped" value={String(verified)} sub={`of ${demos.length} · causal-replay passed`} Icon={GitPullRequest} tone="text-emerald-400" />
          {avgConf !== null && (
            <StatTile label="Avg confidence" value={`${avgConf}%`} sub={`$${cost.toFixed(2)} spend`} Icon={DollarSign} />
          )}
        </div>

        <MonoLabel className="block mb-2">Recent incidents</MonoLabel>
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          {demos.length === 0 && <p className="px-4 py-10 text-center font-mono text-[12px] text-zinc-600">No incidents.</p>}
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
