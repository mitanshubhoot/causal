"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity, Eye, LayoutGrid, Github, Settings2, Search, ChevronDown,
  X, Waypoints, ScanSearch, Network, ArrowLeft,
} from "lucide-react";
import { ProvenanceExplorer } from "@/components/ProvenanceExplorer";
import { getMockTrace } from "@/lib/mock-data";
import { getObservabilityDemo, getTraceList } from "@/lib/mock-observability";
import { TraceTree } from "@/components/product/TraceTree";
import { SpanDetail } from "@/components/product/SpanDetail";
import { Copilot } from "@/components/product/Copilot";
import { FixPrView } from "@/components/product/panels";
import { SeverityChip, STATUS_META } from "@/components/product/ui";

interface PageProps {
  params: { id: string };
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
}

export default function IncidentPage({ params }: PageProps) {
  const [activeId, setActiveId] = useState(params.id);
  const demo = getObservabilityDemo(activeId);
  const traceRows = getTraceList();

  const [selectedSpanId, setSelectedSpanId] = useState(demo.finding.triggeredSpanId);
  const [modal, setModal] = useState<null | "fixpr" | "graph">(null);

  // reset span selection when the active trace changes
  useEffect(() => {
    setSelectedSpanId(getObservabilityDemo(activeId).finding.triggeredSpanId);
  }, [activeId]);

  const selectedSpan = demo.spans.find((s) => s.id === selectedSpanId) ?? demo.spans[0]!;

  return (
    <div className="h-full flex bg-[#0a0a0b] text-zinc-300 overflow-hidden">
      {/* ── Nav rail ── */}
      <aside className="hidden lg:flex w-[186px] flex-col border-r border-white/[0.06] flex-shrink-0">
        <Link href="/" className="flex items-center gap-2 px-4 h-12 border-b border-white/[0.06]">
          <Network className="w-4 h-4 text-indigo-300/80" />
          <span className="text-[14px] font-semibold text-zinc-100 tracking-tight">Causal</span>
        </Link>
        <nav className="flex-1 p-2 space-y-0.5">
          {[
            { label: "Tracing", Icon: Activity, active: true },
            { label: "Detectors", Icon: Eye, active: false },
            { label: "Dashboard", Icon: LayoutGrid, active: false },
          ].map(({ label, Icon, active }) => (
            <div
              key={label}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] ${
                active ? "bg-white/[0.06] text-zinc-100" : "text-zinc-500"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {label}
            </div>
          ))}
        </nav>
        <div className="p-2 border-t border-white/[0.06] space-y-0.5">
          <Link href="/incidents" className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]">
            <ArrowLeft className="w-4 h-4" strokeWidth={1.75} /> All incidents
          </Link>
          <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-zinc-600">
            <Github className="w-4 h-4" strokeWidth={1.75} /> GitHub
          </div>
          <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] text-zinc-600">
            <Settings2 className="w-4 h-4" strokeWidth={1.75} /> Settings
          </div>
        </div>
      </aside>

      {/* ── Traces list ── */}
      <aside className="hidden md:flex w-[248px] flex-col border-r border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-1.5 px-3 h-12 border-b border-white/[0.06]">
          <span className="font-mono text-[12px] text-zinc-300">causal</span>
          <span className="text-zinc-700">/</span>
          <span className="font-mono text-[12px] text-zinc-400">demo</span>
          <ChevronDown className="w-3 h-3 text-zinc-600 ml-auto" />
        </div>
        <div className="flex items-center gap-4 px-3 h-9 border-b border-white/[0.06]">
          {["Traces", "Users", "Sessions"].map((t, i) => (
            <span key={t} className={`text-[12px] ${i === 0 ? "text-zinc-200 border-b-2 border-indigo-400/80 -mb-px py-2" : "text-zinc-600"}`}>
              {t}
            </span>
          ))}
        </div>
        <div className="px-3 py-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
            <Search className="w-3 h-3 text-zinc-600" />
            <span className="font-mono text-[11px] text-zinc-600">Search…</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {traceRows.map((row, i) => {
            const isActive = row.selectable && row.id === activeId && i < 4;
            return (
              <button
                key={i}
                onClick={() => row.selectable && setActiveId(row.id)}
                className={`w-full text-left px-3 py-2 border-b border-white/[0.03] flex items-center gap-2 transition-colors ${
                  isActive ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_META[row.status].dot}`} />
                <div className="min-w-0">
                  <p className={`font-mono text-[12px] truncate ${isActive ? "text-zinc-100" : "text-zinc-300"}`}>{row.name}</p>
                  <p className="font-mono text-[10px] text-zinc-600">{row.timestamp}</p>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Trace tree ── */}
      <section className="flex-1 min-w-0 flex flex-col border-r border-white/[0.06]">
        <div className="flex items-center gap-3 px-4 h-12 border-b border-white/[0.06] flex-shrink-0">
          <span className="font-mono text-[12px] text-zinc-400">Trace</span>
          <span className="font-mono text-[12px] text-zinc-200 truncate">{demo.traceId}</span>
          <SeverityChip severity={demo.severity} />
          <div className="ml-auto flex items-center gap-3 font-mono text-[11px] text-zinc-500">
            <span className="tabular-nums">{tokens(demo.tokensIn)} → {tokens(demo.tokensOut)}</span>
            <span className="text-zinc-700">·</span>
            <span className="tabular-nums">${demo.cost.toFixed(4)}</span>
            <span className="hidden xl:inline text-zinc-700">·</span>
            <span className="hidden xl:inline">{demo.model}</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <TraceTree spans={demo.spans} selectedId={selectedSpanId} onSelect={setSelectedSpanId} />
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

      {/* ── Modals ── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8" style={{ background: "rgba(0,0,0,0.72)" }}>
          <div className={`relative bg-[#0a0a0b] border border-white/10 rounded-xl overflow-hidden w-full ${modal === "graph" ? "max-w-6xl h-[80vh]" : "max-w-3xl max-h-[85vh]"}`}>
            <div className="flex items-center gap-2 px-4 h-11 border-b border-white/[0.06]">
              {modal === "fixpr" ? <ScanSearch className="w-4 h-4 text-emerald-400/80" /> : <Waypoints className="w-4 h-4 text-indigo-300/80" />}
              <span className="font-mono text-[12px] text-zinc-300">
                {modal === "fixpr" ? `Fix PR #${demo.fixPr.number}` : "Causal graph — provenance"}
              </span>
              <button onClick={() => setModal(null)} className="ml-auto text-zinc-500 hover:text-zinc-200">
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
