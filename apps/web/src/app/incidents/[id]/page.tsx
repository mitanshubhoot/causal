"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, FileText, Play, Activity, GitBranch, List } from "lucide-react";
import { ProvenanceExplorer } from "@/components/ProvenanceExplorer";
import { TraceExplorer } from "@/components/TraceExplorer";
import { api } from "@/lib/api";
import type { TraceGraph } from "@causal/types";

interface PageProps {
  params: { id: string };
}

function getIncidentTitle(traceGraph: TraceGraph): string {
  const incident = traceGraph.nodes.find(n => n.layer === "INCIDENT");
  if (!incident) return "Incident";
  const p = incident.payload as Record<string, unknown>;
  return (p["title"] as string) ?? (p["externalId"] as string) ?? "Incident";
}

export default function IncidentPage({ params }: PageProps) {
  const [traceGraph, setTraceGraph] = useState<TraceGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"trace" | "graph">("trace");

  useEffect(() => {
    const load = async () => {
      try {
        const trace = await api.getTrace(params.id);
        setTraceGraph(trace);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [params.id]);

  const topRootCause = traceGraph?.rootCauses[0];
  const confidence = topRootCause?.probability ?? 0;
  const confidencePct = Math.round(confidence * 100);
  const incidentTitle = traceGraph ? getIncidentTitle(traceGraph) : "";

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Top bar */}
      <header className="border-b border-white/[0.06] px-6 py-3 flex items-center gap-4 flex-shrink-0" style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.85)" }}>
        <Link href="/incidents" className="text-white/30 hover:text-white/60 transition-colors duration-300">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h1 className="text-[14px] font-medium text-white tracking-wide truncate">
            {incidentTitle || (viewMode === "trace" ? "Trace Explorer" : "Provenance Graph")}
          </h1>
          <span className="font-mono text-[11px] tracking-[0.1em] text-white/20 flex-shrink-0">{params.id.slice(0, 12)}</span>
        </div>

        {traceGraph && (
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* View toggle */}
            <div className="flex items-center border border-white/[0.08] rounded-full overflow-hidden">
              <button
                onClick={() => setViewMode("trace")}
                className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] uppercase transition-all duration-200 ${
                  viewMode === "trace"
                    ? "bg-white/[0.08] text-white/60"
                    : "text-white/25 hover:text-white/40"
                }`}
              >
                <List className="w-3 h-3" />
                Trace
              </button>
              <button
                onClick={() => setViewMode("graph")}
                className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] uppercase transition-all duration-200 ${
                  viewMode === "graph"
                    ? "bg-white/[0.08] text-white/60"
                    : "text-white/25 hover:text-white/40"
                }`}
              >
                <GitBranch className="w-3 h-3" />
                Graph
              </button>
            </div>

            {/* Confidence badge */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-mono text-[10px] tracking-[0.12em] uppercase border ${
              confidence >= 0.85 ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" :
              confidence >= 0.6  ? "text-amber-400 bg-amber-400/10 border-amber-400/20" :
                                   "text-red-400 bg-red-400/10 border-red-400/20"
            }`}>
              <Activity className="w-3 h-3" />
              <span>{confidencePct}%</span>
            </div>

            <Link
              href={`/incidents/${params.id}/replay`}
              className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.12em] uppercase text-white/40 border border-white/[0.08] px-4 py-1.5 rounded-full hover:border-white/20 hover:text-white/60 transition-all duration-300"
            >
              <Play className="w-3 h-3" />
              Replay
            </Link>

            <Link
              href={`/incidents/${params.id}/postmortem`}
              className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.12em] uppercase text-white bg-white/10 border border-white/[0.12] px-4 py-1.5 rounded-full hover:bg-white/15 hover:border-white/25 transition-all duration-300"
            >
              <FileText className="w-3 h-3" />
              Post-Mortem
            </Link>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="h-full flex items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-4 text-white/30">
              <RefreshCw className="w-6 h-6 animate-spin text-white/15" />
              <span className="font-mono text-[11px] tracking-[0.15em] uppercase">Assembling causal graph...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="h-full flex items-center justify-center bg-black">
            <div className="text-center">
              <p className="text-red-400/60 mb-2 font-mono text-[12px] tracking-[0.1em] uppercase">Failed to load trace</p>
              <p className="text-[12px] text-white/20 font-mono">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && traceGraph && (
          viewMode === "trace"
            ? <TraceExplorer traceGraph={traceGraph} />
            : <ProvenanceExplorer traceGraph={traceGraph} />
        )}
      </div>
    </div>
  );
}
