"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, Eye, LayoutGrid, Github, Search, ChevronDown, X, Waypoints, ScanSearch,
  ArrowLeft, ListTree, GanttChart, ShieldAlert,
} from "lucide-react";
import { ProvenanceExplorer } from "@/components/ProvenanceExplorer";
import { getMockTrace } from "@/lib/mock-data";
import { getObservabilityDemo, getTraceList, getAllDemos } from "@/lib/mock-observability";
import { LogoMark } from "@/components/LogoMark";
import { TraceTree } from "@/components/product/TraceTree";
import { Timeline } from "@/components/product/Timeline";
import { SpanDetail } from "@/components/product/SpanDetail";
import { Copilot } from "@/components/product/Copilot";
import { FixPrView } from "@/components/product/panels";
import { DetectorsView, DashboardView } from "@/components/product/views";
import { SeverityChip, STATUS_META, CopyButton, DETECTOR_LABEL } from "@/components/product/ui";

interface PageProps {
  params: { id: string };
}

type View = "tracing" | "detectors" | "dashboard";
type ListTab = "traces" | "users" | "sessions";

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

function defaultSpanId(demo: ReturnType<typeof getObservabilityDemo>): string {
  return (
    demo.finding?.triggeredSpanId ??
    demo.spans.find((s) => s.status !== "ok")?.id ??
    demo.spans[0]!.id
  );
}

const REPO_URL = "https://github.com/mitanshubhoot/causal";

export default function IncidentPage({ params }: PageProps) {
  const [view, setView] = useState<View>("tracing");
  const [activeId, setActiveId] = useState(params.id);
  const [selectedSpanId, setSelectedSpanId] = useState(() => defaultSpanId(getObservabilityDemo(params.id)));
  const [modal, setModal] = useState<null | "fixpr" | "graph">(null);
  const [listTab, setListTab] = useState<ListTab>("traces");
  const [search, setSearch] = useState("");
  const [treeMode, setTreeMode] = useState<"trace" | "timeline">("trace");
  const [wsOpen, setWsOpen] = useState(false);

  const demo = getObservabilityDemo(activeId);
  const demos = getAllDemos();

  useEffect(() => {
    setSelectedSpanId(defaultSpanId(getObservabilityDemo(activeId)));
  }, [activeId]);

  // Esc closes any open modal / dropdown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setWsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openIncident = (id: string) => {
    setActiveId(id);
    setView("tracing");
  };

  const selectedSpan = demo.spans.find((s) => s.id === selectedSpanId) ?? demo.spans[0]!;

  // List rows depend on the active tab.
  const listRows = useMemo(() => {
    let rows: { id: string; name: string; sub: string; status: "ok" | "warn" | "error" }[];
    if (listTab === "sessions") {
      rows = demos.map((d) => {
        const agent = d.spans.find((s) => s.kind === "agent");
        return {
          id: d.incidentId,
          name: agent?.attributes.find((a) => a.label === "session")?.value ?? "session",
          sub: d.service,
          status: agent?.status ?? "ok",
        };
      });
    } else if (listTab === "users") {
      rows = demos.map((d) => ({
        id: d.incidentId,
        name: d.service,
        sub: `${d.model} · ${d.severity}`,
        status: d.spans.find((s) => s.kind === "agent")?.status ?? "ok",
      }));
    } else {
      rows = getTraceList().map((r) => ({ id: r.id, name: r.name, sub: r.timestamp, status: r.status }));
    }
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)) : rows;
  }, [listTab, search, demos]);

  const navItems: { id: View; label: string; Icon: typeof Activity }[] = [
    { id: "tracing", label: "Tracing", Icon: Activity },
    { id: "detectors", label: "Detectors", Icon: Eye },
    { id: "dashboard", label: "Dashboard", Icon: LayoutGrid },
  ];

  return (
    <div className="h-full flex bg-[#0a0a0b] text-zinc-300 overflow-hidden">
      {/* ── Nav rail ── */}
      <aside className="hidden lg:flex w-[186px] flex-col border-r border-white/[0.06] flex-shrink-0">
        <Link href="/" className="flex items-center gap-2 px-4 h-12 border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors">
          <LogoMark size={20} />
          <span className="text-[14px] font-semibold text-zinc-100 tracking-tight">Causal</span>
        </Link>
        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                view === id ? "bg-white/[0.06] text-zinc-100" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </nav>
        <div className="p-2 border-t border-white/[0.06] space-y-0.5">
          <Link href="/incidents" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03] transition-colors">
            <ArrowLeft className="w-4 h-4" strokeWidth={1.75} /> All incidents
          </Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03] transition-colors">
            <Github className="w-4 h-4" strokeWidth={1.75} /> GitHub
          </a>
          <div className="flex items-center gap-2 px-2.5 py-1.5 mt-1">
            <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-400/20 flex items-center justify-center font-mono text-[9px] text-indigo-200">DW</div>
            <span className="font-mono text-[11px] text-zinc-500">Demo workspace</span>
          </div>
        </div>
      </aside>

      {view === "tracing" ? (
        <>
          {/* ── Traces list ── */}
          <aside className="hidden md:flex w-[248px] flex-col border-r border-white/[0.06] flex-shrink-0">
            <div className="relative">
              <button
                onClick={() => setWsOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 h-12 border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors w-full"
              >
                <span className="font-mono text-[12px] text-zinc-300">causal</span>
                <span className="text-zinc-700">/</span>
                <span className="font-mono text-[12px] text-zinc-400">demo</span>
                <ChevronDown className={`w-3 h-3 text-zinc-600 ml-auto transition-transform ${wsOpen ? "rotate-180" : ""}`} />
              </button>
              {wsOpen && (
                <div className="absolute top-11 left-2 right-2 z-30 rounded-md border border-white/10 bg-[#111114] shadow-xl overflow-hidden">
                  {["demo", "production", "staging"].map((ws, i) => (
                    <button
                      key={ws}
                      onClick={() => setWsOpen(false)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${i === 0 ? "bg-indigo-400" : "bg-zinc-700"}`} />
                      <span className="font-mono text-[12px] text-zinc-300">causal / {ws}</span>
                      {i === 0 && <span className="ml-auto font-mono text-[9px] text-zinc-600 uppercase">current</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 px-3 border-b border-white/[0.06]">
              {(["traces", "users", "sessions"] as ListTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setListTab(t)}
                  className={`text-[12px] capitalize py-2 transition-colors ${
                    listTab === t ? "text-zinc-200 border-b-2 border-indigo-400/80 -mb-px" : "text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="px-3 py-2 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1.5 focus-within:border-white/20 transition-colors">
                <Search className="w-3 h-3 text-zinc-600" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="flex-1 bg-transparent outline-none font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {listRows.length === 0 && (
                <p className="px-3 py-4 font-mono text-[11px] text-zinc-600">No results.</p>
              )}
              {listRows.map((row, i) => {
                const isActive = row.id === activeId;
                return (
                  <button
                    key={i}
                    onClick={() => setActiveId(row.id)}
                    className={`w-full text-left px-3 py-2 border-b border-white/[0.03] flex items-center gap-2 transition-colors ${
                      isActive ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_META[row.status].dot}`} />
                    <div className="min-w-0">
                      <p className={`font-mono text-[12px] truncate ${isActive ? "text-zinc-100" : "text-zinc-300"}`}>{row.name}</p>
                      <p className="font-mono text-[10px] text-zinc-600 truncate">{row.sub}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* ── Trace tree / timeline ── */}
          <section className="flex-1 min-w-0 flex flex-col border-r border-white/[0.06]">
            <div className="flex items-center gap-2 px-4 h-12 border-b border-white/[0.06] flex-shrink-0">
              <span className="font-mono text-[12px] text-zinc-400">Trace</span>
              <span className="font-mono text-[12px] text-zinc-200 truncate">{demo.traceId}</span>
              <CopyButton value={demo.traceId} />
              <SeverityChip severity={demo.severity} />
              {/* Trace/Timeline toggle */}
              <div className="ml-auto flex items-center rounded-md border border-white/10 overflow-hidden">
                {([["trace", ListTree], ["timeline", GanttChart]] as const).map(([mode, Icon]) => (
                  <button
                    key={mode}
                    onClick={() => setTreeMode(mode)}
                    className={`flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors ${
                      treeMode === mode ? "bg-white/[0.08] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    <Icon className="w-3 h-3" /> {mode}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 h-8 border-b border-white/[0.04] font-mono text-[11px] text-zinc-500 flex-shrink-0">
              <span className="tabular-nums">{tokens(demo.tokensIn)} → {tokens(demo.tokensOut)} tok</span>
              <span className="text-zinc-700">·</span>
              <span className="tabular-nums">${demo.cost.toFixed(4)}</span>
              <span className="text-zinc-700">·</span>
              <span>{demo.model}</span>
              <span className="ml-auto text-zinc-600">{demo.spans.length} spans</span>
            </div>
            {demo.finding && (
              <button
                onClick={() => { setTreeMode("trace"); setSelectedSpanId(demo.finding!.triggeredSpanId); }}
                className="flex items-center gap-2 px-4 h-8 border-b border-red-500/15 bg-red-500/[0.04] text-left flex-shrink-0 hover:bg-red-500/[0.07] transition-colors"
              >
                <ShieldAlert className="w-3 h-3 text-red-400 flex-shrink-0" />
                <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-red-400/90 font-semibold flex-shrink-0">
                  {DETECTOR_LABEL[demo.finding.detector]}
                </span>
                <span className="text-[11px] text-zinc-400 truncate">{demo.finding.title}</span>
                <span className="ml-auto font-mono text-[10px] text-zinc-500 flex-shrink-0">{Math.round(demo.finding.confidence * 100)}%</span>
              </button>
            )}
            <div className="flex-1 overflow-auto">
              {treeMode === "trace" ? (
                <TraceTree spans={demo.spans} selectedId={selectedSpanId} onSelect={setSelectedSpanId} />
              ) : (
                <Timeline spans={demo.spans} selectedId={selectedSpanId} onSelect={setSelectedSpanId} />
              )}
            </div>
          </section>

          {/* ── Span detail ── */}
          <section className="hidden md:flex w-[340px] flex-col border-r border-white/[0.06] flex-shrink-0">
            <SpanDetail span={selectedSpan} />
          </section>

          {/* ── Copilot ── */}
          <section className="hidden xl:flex w-[360px] flex-col flex-shrink-0">
            <Copilot demo={demo} onOpenFixPr={() => setModal("fixpr")} onOpenGraph={() => setModal("graph")} />
          </section>
        </>
      ) : view === "detectors" ? (
        <DetectorsView demos={demos} onOpen={openIncident} />
      ) : (
        <DashboardView demos={demos} onOpen={openIncident} />
      )}

      {/* ── Modals ── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8" style={{ background: "rgba(0,0,0,0.72)" }} onClick={() => setModal(null)}>
          <div
            className={`relative bg-[#0a0a0b] border border-white/10 rounded-xl overflow-hidden w-full ${modal === "graph" ? "max-w-6xl h-[80vh]" : "max-w-3xl max-h-[85vh]"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 h-11 border-b border-white/[0.06]">
              {modal === "fixpr" ? <ScanSearch className="w-4 h-4 text-emerald-400/80" /> : <Waypoints className="w-4 h-4 text-indigo-300/80" />}
              <span className="font-mono text-[12px] text-zinc-300">
                {modal === "fixpr" ? `Fix PR #${demo.fixPr?.number ?? ""}` : "Causal graph — provenance"}
              </span>
              <button onClick={() => setModal(null)} className="ml-auto text-zinc-500 hover:text-zinc-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={modal === "graph" ? "h-[calc(80vh-44px)]" : "max-h-[calc(85vh-44px)] overflow-auto"}>
              {modal === "fixpr" ? <FixPrView demo={demo} /> : <ProvenanceExplorer traceGraph={getMockTrace(activeId)} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
