"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, FileText, Play } from "lucide-react";
import { ProvenanceExplorer } from "@/components/ProvenanceExplorer";
import { api } from "@/lib/api";
import type { TraceGraph } from "@causal/types";

interface PageProps {
  params: { id: string };
}

export default function IncidentPage({ params }: PageProps) {
  const [traceGraph, setTraceGraph] = useState<TraceGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4 flex-shrink-0">
        <Link href="/incidents" className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <h1 className="text-lg font-semibold text-white">Provenance Explorer</h1>
          <span className="text-sm text-gray-500 font-mono">{params.id.slice(0, 8)}</span>
        </div>

        {traceGraph && (
          <div className="flex items-center gap-3">
            {/* Confidence badge */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
              confidence >= 0.85 ? "bg-green-950 text-green-400 border border-green-800" :
              confidence >= 0.6  ? "bg-yellow-950 text-yellow-400 border border-yellow-800" :
                                   "bg-red-950 text-red-400 border border-red-800"
            } ${traceGraph.status === "assembling" ? "confidence-assembling" : ""}`}>
              <span>{confidencePct}% confidence</span>
            </div>

            <Link
              href={`/incidents/${params.id}/replay`}
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              Replay with Fix
            </Link>

            <Link
              href={`/incidents/${params.id}/postmortem`}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Generate Post-Mortem
            </Link>
          </div>
        )}
      </header>

      {/* Root cause summary bar */}
      {topRootCause && (
        <div className="border-b border-gray-800 px-6 py-4 bg-gray-900 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Root Cause</span>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed flex-1">
              {topRootCause.explanation || "Analyzing causal chain..."}
            </p>
          </div>
          {topRootCause.counterfactual && (
            <div className="mt-2 pl-0">
              <span className="text-xs text-cyan-400 font-medium">Counterfactual: </span>
              <span className="text-xs text-gray-400">{topRootCause.counterfactual}</span>
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="h-full flex items-center justify-center">
            <div className="flex items-center gap-3 text-gray-400">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Assembling causal graph...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-red-400 mb-2">Failed to load trace</p>
              <p className="text-sm text-gray-500">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && traceGraph && (
          <ProvenanceExplorer traceGraph={traceGraph} />
        )}
      </div>
    </div>
  );
}
