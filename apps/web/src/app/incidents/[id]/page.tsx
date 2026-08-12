"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, Eye, LayoutGrid, Github, Search, ChevronDown, X, Waypoints, ScanSearch,
  ArrowLeft, ListTree, GanttChart, ShieldAlert, PanelLeft, PanelRight, Database,
} from "lucide-react";
import { ProvenanceExplorer } from "@/components/ProvenanceExplorer";
import { getMockTrace } from "@/lib/mock-data";
import { getObservabilityDemo, getTraceList, getAllDemos } from "@/lib/mock-observability";
import type { ObservabilityDemo, IncidentDemo, TraceRow } from "@/lib/mock-observability";
import { fetchTraceList, fetchTraceDetail, fetchRca, LIVE_TRACES } from "@/lib/traces-api";
import { mapLiveToDemo, mapLiveRow } from "@/lib/live-traces";
import { LogoMark } from "@/components/LogoMark";
import { TraceTree } from "@/components/product/TraceTree";
import { Timeline } from "@/components/product/Timeline";
import { SpanDetail } from "@/components/product/SpanDetail";
import { Copilot } from "@/components/product/Copilot";
import { FixPrView } from "@/components/product/panels";
import { DetectorsView, DashboardView } from "@/components/product/views";
import { EvalsView } from "@/components/product/EvalsView";
import { TraceActions } from "@/components/product/TraceActions";
import { CommandPalette, type Command } from "@/components/product/CommandPalette";
import { SeverityChip, STATUS_META, CopyButton, DETECTOR_LABEL } from "@/components/product/ui";

interface PageProps {
  params: { id: string };
}

type View = "tracing" | "detectors" | "evals" | "dashboard";
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

interface LiveData {
  demo: ObservabilityDemo;
  demos: IncidentDemo[];
  traceRows: TraceRow[];
}

/** When NEXT_PUBLIC_USE_LIVE_TRACES=1, load the explorer from the live API and
 *  map it into the shapes the UI already renders. Returns null (→ mock) when the
 *  flag is off or any fetch fails, so the demo never breaks. */
function useLiveExplorer(activeId: string): LiveData | null {
  const [state, setState] = useState<LiveData | null>(null);
  useEffect(() => {
    if (!LIVE_TRACES) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchTraceList();
        const traceRows: TraceRow[] = list.map(mapLiveRow);
        const demos: IncidentDemo[] = [];
        for (const row of list.filter((t) => t.status !== "ok")) {
          try {
            const [d, rca] = [await fetchTraceDetail(row.id), await fetchRca(row.id)];
            const mapped = mapLiveToDemo(d, rca);
            if (mapped.finding) demos.push(mapped as IncidentDemo);
          } catch {
            /* skip this incident */
          }
        }
        let demo: ObservabilityDemo | null = null;
        try {
          const d = await fetchTraceDetail(activeId);
          demo = mapLiveToDemo(d, await fetchRca(activeId));
        } catch {
          /* fall back to mock for the active trace */
        }
        if (!cancelled) setState({ demo: demo ?? getObservabilityDemo(activeId), demos, traceRows });
      } catch {
        if (!cancelled) setState(null); // whole load failed → mock
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);
  return state;
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
  // Pane visibility — lets the trace tree take the full width when needed.
  const [showList, setShowList] = useState(true);
  const [showCopilot, setShowCopilot] = useState(true);

  const live = useLiveExplorer(activeId);
  const demo = live?.demo ?? getObservabilityDemo(activeId);
  const demos = live?.demos ?? getAllDemos();
  const traceRows = live?.traceRows ?? getTraceList();

  useEffect(() => {
    setSelectedSpanId(defaultSpanId(demo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.traceId]);

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
      rows = traceRows.map((r) => ({ id: r.id, name: r.name, sub: r.timestamp, status: r.status }));
    }
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)) : rows;
  }, [listTab, search, demos, traceRows]);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];
    traceRows.forEach((r, i) =>
      cmds.push({ id: `t-${i}`, label: r.name, group: "Traces", hint: r.timestamp, run: () => { setActiveId(r.id); setView("tracing"); } })
    );
    cmds.push({ id: "v-trace", label: "Tracing", group: "Views", run: () => setView("tracing") });
    cmds.push({ id: "v-det", label: "Detectors", group: "Views", run: () => setView("detectors") });
    cmds.push({ id: "v-dash", label: "Dashboard", group: "Views", run: () => setView("dashboard") });
    if (demo.finding) {
      if (demo.fixPr) cmds.push({ id: "a-pr", label: `Open fix PR #${demo.fixPr.number}`, group: "Actions", run: () => setModal("fixpr") });
      cmds.push({ id: "a-graph", label: "Open causal graph", group: "Actions", run: () => setModal("graph") });
    }
    return cmds;
  }, [demo, traceRows]);

  const navItems: { id: View; label: string; Icon: typeof Activity }[] = [
    { id: "tracing", label: "Tracing", Icon: Activity },
    { id: "detectors", label: "Detectors", Icon: Eye },
    { id: "evals", label: "Datasets & Evals", Icon: Database },
    { id: "dashboard", label: "Dashboard", Icon: LayoutGrid },
  ];

  return (
    <div className="h-full flex bg-[#0a0a0b] text-zinc-300 overflow-hidden">
      {/* ── Nav rail ── */}
      <aside className="hidden lg:flex w-[176px] flex-col border-r border-white/[0.06] flex-shrink-0">
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
          <aside className={`${showList ? "hidden lg:flex" : "hidden"} w-[224px] flex-col border-r border-white/[0.06] flex-shrink-0`}>
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
                <kbd className="font-mono text-[9px] text-zinc-600 border border-white/10 rounded px-1 py-0.5 flex-shrink-0">⌘K</kbd>
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
            <div className="flex items-center gap-2 px-3 h-12 border-b border-white/[0.06] flex-shrink-0">
              <button
                onClick={() => setShowList((v) => !v)}
                title={showList ? "Hide traces list" : "Show traces list"}
                className={`hidden lg:block flex-shrink-0 transition-colors ${showList ? "text-zinc-500 hover:text-zinc-300" : "text-indigo-300/80"}`}
              >
                <PanelLeft className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-[12px] text-zinc-400 flex-shrink-0">Trace</span>
              <span className="font-mono text-[12px] text-zinc-200 truncate min-w-0">{demo.traceId}</span>
              <CopyButton value={demo.traceId} />
              <SeverityChip severity={demo.severity} />
              {demo.finding && (
                <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] uppercase font-semibold text-red-400 border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 rounded animate-pulse">
                  Alert
                </span>
              )}
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
              <button
                onClick={() => setShowCopilot((v) => !v)}
                title={showCopilot ? "Hide Copilot" : "Show Copilot"}
                className={`hidden 2xl:block flex-shrink-0 transition-colors ${showCopilot ? "text-zinc-500 hover:text-zinc-300" : "text-indigo-300/80"}`}
              >
                <PanelRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 h-8 border-b border-white/[0.04] font-mono text-[11px] text-zinc-500 flex-shrink-0 overflow-hidden whitespace-nowrap">
              <span className="tabular-nums flex-shrink-0">{tokens(demo.tokensIn)} → {tokens(demo.tokensOut)}</span>
              <span className="text-zinc-700 flex-shrink-0">·</span>
              <span className="tabular-nums flex-shrink-0">${demo.cost.toFixed(4)}</span>
              <span className="hidden lg:inline text-zinc-700">·</span>
              <span className="hidden lg:inline truncate">{demo.model}</span>
            </div>
            {/* Trace-level actions, always visible — they used to be buried in
                the Copilot conversation and scrolled away as the chat grew. */}
            <TraceActions
              demo={demo}
              onOpenFixPr={() => setModal("fixpr")}
              onOpenGraph={() => setModal("graph")}
              onPromote={() => setView("evals")}
            />
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
          <section className="hidden md:flex w-[320px] flex-col border-r border-white/[0.06] flex-shrink-0">
            <SpanDetail
              span={selectedSpan}
              trace={{ repo: demo.repo, gitRef: demo.gitRef, user: demo.user, sessionId: demo.sessionId, metadata: demo.metadata }}
            />
          </section>

          {/* ── Copilot ── */}
          <section className={`${showCopilot ? "hidden 2xl:flex" : "hidden"} w-[340px] flex-col flex-shrink-0`}>
            <Copilot demo={demo} onOpenFixPr={() => setModal("fixpr")} onOpenGraph={() => setModal("graph")} />
          </section>
        </>
      ) : view === "detectors" ? (
        <DetectorsView onOpen={openIncident} />
      ) : view === "evals" ? (
        <EvalsView onOpenTrace={openIncident} />
      ) : (
        <DashboardView demos={demos} onOpen={openIncident} />
      )}

      <CommandPalette commands={commands} />

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
