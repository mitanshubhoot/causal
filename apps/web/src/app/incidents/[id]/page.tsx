"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, notFound } from "next/navigation";
import {
  Search, ChevronDown, X, Waypoints, ScanSearch,
  ListTree, GanttChart, ShieldAlert, PanelLeft, Sparkles,
  CheckCircle2, AlertTriangle, Database,
} from "lucide-react";
import { ProvenanceExplorer } from "@/components/ProvenanceExplorer";
import { getMockTrace, isMockIncidentId } from "@/lib/mock-data";
import { getObservabilityDemo, getTraceList, getAllDemos, hasObservabilityDemo } from "@/lib/mock-observability";
import type { ObservabilityDemo, IncidentDemo, TraceRow } from "@/lib/mock-observability";
import { fetchTraceList, fetchTraceDetail, fetchRca, fetchFindingId, promoteFinding, LIVE_TRACES } from "@/lib/traces-api";
import { mapLiveToDemo, mapLiveRow, type LiveDemo } from "@/lib/live-traces";
import { LoadingPane } from "@/components/product/views";
import { TraceTree } from "@/components/product/TraceTree";
import { Timeline } from "@/components/product/Timeline";
import { SpanDetail } from "@/components/product/SpanDetail";
import { Copilot } from "@/components/product/Copilot";
import { FixPrView } from "@/components/product/panels";
import { ProductNav, NAV_ITEMS } from "@/components/product/ProductNav";
import { TraceActions } from "@/components/product/TraceActions";
import { CommandPalette, type Command } from "@/components/product/CommandPalette";
import { SeverityChip, STATUS_META, CopyButton, DETECTOR_LABEL } from "@/components/product/ui";

interface PageProps {
  params: { id: string };
}

type ListTab = "traces" | "users" | "sessions";

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

/** Null when the trace carries no spans at all — reachable in live mode, and
 *  asserting spans[0]! there white-screened the primary route. */
function defaultSpanId(demo: ObservabilityDemo): string | null {
  return (
    demo.finding?.triggeredSpanId ??
    demo.spans.find((s) => s.status !== "ok")?.id ??
    demo.spans[0]?.id ??
    null
  );
}

interface LiveData {
  /** Null when the live API has no such trace — the route 404s rather than
   *  substituting the featured incident under the requested id. */
  demo: LiveDemo | null;
  demos: IncidentDemo[];
  traceRows: TraceRow[];
}

/** When NEXT_PUBLIC_USE_LIVE_TRACES=1, load the explorer from the live API and
 *  map it into the shapes the UI already renders. `data` stays null (→ mock)
 *  when the flag is off or any fetch fails, so the demo never breaks; `pending`
 *  keeps the caller from painting mock content under a live trace id. */
function useLiveExplorer(activeId: string): { data: LiveData | null; pending: boolean } {
  const [data, setData] = useState<LiveData | null>(null);
  const [pending, setPending] = useState(LIVE_TRACES);
  useEffect(() => {
    if (!LIVE_TRACES) return;
    let cancelled = false;
    setPending(true);
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
        let demo: LiveDemo | null = null;
        try {
          const d = await fetchTraceDetail(activeId);
          // The finding id is what `POST /findings/:id/promote` is keyed on and
          // `GET /traces/:id` never returns it.
          demo = mapLiveToDemo(d, await fetchRca(activeId), await fetchFindingId(activeId));
        } catch {
          /* no such live trace — fall through to the mock, or to not-found */
        }
        const mock = hasObservabilityDemo(activeId) ? getObservabilityDemo(activeId) : null;
        if (!cancelled) {
          setData({ demo: demo ?? (mock ? { ...mock, findingId: null } : null), demos, traceRows });
        }
      } catch {
        if (!cancelled) setData(null); // whole load failed → mock
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);
  return { data, pending };
}

export default function IncidentPage({ params }: PageProps) {
  const router = useRouter();
  const [activeId, setActiveId] = useState(params.id);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(() =>
    hasObservabilityDemo(params.id) ? defaultSpanId(getObservabilityDemo(params.id)) : null
  );
  const [modal, setModal] = useState<null | "fixpr" | "graph">(null);
  // Outcome of the last "Add to eval set" — the button used to navigate to
  // /evals and claim nothing, so a failed promotion looked like a filed case.
  const [promo, setPromo] = useState<{ tone: "ok" | "error" | "info"; message: string } | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [listTab, setListTab] = useState<ListTab>("traces");
  const [search, setSearch] = useState("");
  const [treeMode, setTreeMode] = useState<"trace" | "timeline">("trace");
  const [wsOpen, setWsOpen] = useState(false);
  // Pane visibility. Every pane is open by default — the full five-pane view is
  // the product. Nothing is collapsed to buy space; instead TraceActions
  // collapses to a dropdown whenever the tree pane is too narrow for full
  // buttons, and both pane toggles sit in the trace header.
  //
  // The Copilot is inline from xl and a drawer below it, so it stays usable on
  // narrow screens. Its toggle is ALWAYS visible: it can never become
  // unreachable the way it briefly did.
  const [showList, setShowList] = useState(true);
  const [showCopilot, setShowCopilot] = useState(true);
  useEffect(() => {
    setShowCopilot(window.matchMedia("(min-width: 1280px)").matches);
  }, []);

  const { data: live, pending } = useLiveExplorer(activeId);
  // No live trace and no mock trace for this id → null, and the route 404s.
  // Falling through to getObservabilityDemo rendered the featured incident's
  // six-layer chain under whatever id the visitor typed.
  const mock = hasObservabilityDemo(activeId) ? getObservabilityDemo(activeId) : null;
  const demo: LiveDemo | null = live ? live.demo : mock ? { ...mock, findingId: null } : null;
  const demos = live?.demos ?? getAllDemos();
  const traceRows = live?.traceRows ?? getTraceList();

  useEffect(() => {
    if (demo) setSelectedSpanId(defaultSpanId(demo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo?.traceId]);

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

  // Back/forward must move between traces, not out of the explorer.
  useEffect(() => {
    const onPop = () => {
      const match = /^\/incidents\/([^/]+)$/.exec(window.location.pathname);
      if (match?.[1]) setActiveId(decodeURIComponent(match[1]));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const promoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (promoTimer.current) clearTimeout(promoTimer.current); }, []);

  const openIncident = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    setPromo(null);
    // Keep the address bar on the trace that is on screen: the URL used to name
    // a trace the user was no longer looking at, so a shared link, a reload and
    // the post-mortem link all pointed somewhere else. history over router.push
    // because a push on the [id] segment remounts the explorer and drops the
    // selected span.
    window.history.pushState(null, "", `/incidents/${id}`);
  };

  /** The one-click promotion the landing page sells. */
  const promote = async () => {
    if (promoting || !demo) return;
    setPromo(null);
    // Demo data has no production finding behind it. The flow still runs so the
    // demo shows what it does, but it must not report a case that was filed.
    if (!demo.findingId) {
      setPromo({ tone: "info", message: "No production finding is linked to this trace — nothing was filed. Opening the eval sets." });
      promoTimer.current = setTimeout(() => router.push("/evals"), 1400);
      return;
    }
    setPromoting(true);
    const result = await promoteFinding(demo.findingId);
    setPromoting(false);
    if (!result) {
      setPromo({ tone: "error", message: "Could not add to the eval set — the API rejected the promotion. Nothing was filed." });
      return;
    }
    setPromo({
      tone: "ok",
      message: result.created
        ? `Added to “${result.dataset.name}” as a golden case.`
        : `Already a case in “${result.dataset.name}” — nothing duplicated.`,
    });
    promoTimer.current = setTimeout(() => router.push("/evals"), 1400);
  };

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

  // Only the canned incidents have a provenance graph and a post-mortem; both
  // getters substitute a different incident for anything else.
  const hasProvenance = isMockIncidentId(activeId);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];
    traceRows.forEach((r, i) =>
      cmds.push({ id: `t-${i}`, label: r.name, group: "Traces", hint: r.timestamp, run: () => openIncident(r.id) })
    );
    NAV_ITEMS.forEach(({ href, label }) =>
      cmds.push({ id: `v-${href}`, label, group: "Views", run: () => router.push(href) })
    );
    if (demo?.finding) {
      if (demo.fixPr) cmds.push({ id: "a-pr", label: `Open fix PR #${demo.fixPr.number}`, group: "Actions", run: () => setModal("fixpr") });
      if (hasProvenance) cmds.push({ id: "a-graph", label: "Open causal graph", group: "Actions", run: () => setModal("graph") });
    }
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, traceRows, hasProvenance]);

  // A live load in flight must not paint mock content under the requested id.
  if (pending) {
    return (
      <div className="h-full flex bg-[#0a0a0b] text-zinc-300 overflow-hidden">
        <ProductNav activeHref="/incidents" back={{ href: "/incidents", label: "All incidents" }} />
        <div className="flex-1 min-w-0">
          <LoadingPane label={`Loading trace ${activeId}…`} />
        </div>
      </div>
    );
  }

  if (!demo) notFound();

  // Undefined only for a trace with no spans at all — the span pane says so
  // rather than crashing on spans[0]!.
  const selectedSpan = demo.spans.find((s) => s.id === selectedSpanId) ?? demo.spans[0];

  return (
    <div className="h-full flex bg-[#0a0a0b] text-zinc-300 overflow-hidden">
      <ProductNav activeHref="/incidents" back={{ href: "/incidents", label: "All incidents" }} />

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
                    onClick={() => openIncident(row.id)}
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
              {/* ALWAYS visible — gating this behind the same breakpoint as the
                  pane made the Copilot unreachable on any screen under 1536px. */}
              <button
                onClick={() => setShowCopilot((v) => !v)}
                title={showCopilot ? "Hide Copilot" : "Ask Causal Copilot about this trace"}
                className={`inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] rounded-md border px-2 py-1 transition-colors ${
                  showCopilot
                    ? "text-zinc-400 border-white/10 hover:border-white/25"
                    : "text-indigo-300 border-indigo-400/30 bg-indigo-500/[0.08] hover:bg-indigo-500/[0.15]"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Copilot</span>
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
              onPromote={() => void promote()}
              hasGraph={hasProvenance}
              hasPostMortem={hasProvenance}
              promoting={promoting}
            />
            {promo && (
              <div
                className={`flex items-center gap-2 px-3 h-8 border-b flex-shrink-0 ${
                  promo.tone === "error"
                    ? "border-red-500/15 bg-red-500/[0.05]"
                    : promo.tone === "ok"
                      ? "border-emerald-500/15 bg-emerald-500/[0.05]"
                      : "border-white/[0.06] bg-white/[0.02]"
                }`}
              >
                {promo.tone === "error" ? (
                  <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                ) : promo.tone === "ok" ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Database className="w-3 h-3 text-amber-300/80 flex-shrink-0" />
                )}
                <span className="text-[11px] text-zinc-300 truncate">{promo.message}</span>
                <button onClick={() => setPromo(null)} className="ml-auto text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
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
              {demo.spans.length === 0 ? (
                <p className="px-4 py-8 font-mono text-[11px] text-zinc-600">This trace was ingested with no spans.</p>
              ) : treeMode === "trace" ? (
                <TraceTree spans={demo.spans} selectedId={selectedSpan?.id ?? ""} onSelect={setSelectedSpanId} />
              ) : (
                <Timeline spans={demo.spans} selectedId={selectedSpan?.id ?? ""} onSelect={setSelectedSpanId} />
              )}
            </div>
          </section>

          {/* ── Span detail ── */}
          <section className="hidden md:flex w-[320px] flex-col border-r border-white/[0.06] flex-shrink-0">
            {selectedSpan ? (
              <SpanDetail
                span={selectedSpan}
                trace={{ repo: demo.repo, gitRef: demo.gitRef, user: demo.user, sessionId: demo.sessionId, metadata: demo.metadata }}
              />
            ) : (
              <p className="px-4 py-8 font-mono text-[11px] text-zinc-600">No span to inspect.</p>
            )}
          </section>

          {/* ── Copilot ── */}
          {/* Inline pane from xl where there is room; a right-hand drawer below
              that, so the Copilot is reachable at every width. */}
          {showCopilot && (
            <>
              <div
                onClick={() => setShowCopilot(false)}
                className="fixed inset-0 z-30 bg-black/50 xl:hidden"
                aria-hidden
              />
              <section className="fixed inset-y-0 right-0 z-40 w-[min(380px,90vw)] flex flex-col border-l border-white/10 bg-[#0c0c0e] shadow-2xl xl:static xl:z-auto xl:w-[320px] xl:shadow-none xl:border-l-0 flex-shrink-0">
                <Copilot demo={demo} onClose={() => setShowCopilot(false)} />
              </section>
            </>
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
