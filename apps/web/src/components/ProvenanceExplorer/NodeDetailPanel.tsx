"use client";

import { useState } from "react";
import { X, ThumbsUp, ThumbsDown, ExternalLink, Clock } from "lucide-react";
import type { CausalNode, CausalEdge, RootCause } from "@causal/types";
import { api } from "@/lib/api";

interface NodeDetailPanelProps {
  node: CausalNode | null;
  edge: CausalEdge | null;
  rootCauses: RootCause[];
  onClose: () => void;
}

export function NodeDetailPanel({ node, edge, rootCauses, onClose }: NodeDetailPanelProps) {
  const [confirming, setConfirming] = useState(false);

  const rootCause = node ? rootCauses.find((rc) => rc.nodeId === node.id) : null;

  const handleConfirmEdge = async (confirmed: boolean) => {
    if (!edge) return;
    setConfirming(true);
    try {
      await api.confirmEdge(edge.id, confirmed, "current-user");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="font-mono text-[11px] tracking-[0.15em] text-white/60 uppercase">
          {node ? `${node.layer} Node` : "Edge Detail"}
        </h3>
        <button onClick={onClose} className="text-white/20 hover:text-white/50 transition-colors duration-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Node detail */}
        {node && (
          <>
            {/* Root cause explanation */}
            {rootCause && (
              <div className="border border-violet-400/15 rounded-xl p-4 bg-violet-400/[0.03]">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-mono text-[9px] tracking-[0.2em] text-violet-400/60 uppercase">
                    Root Cause
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.1em] text-violet-400/40 bg-violet-400/10 border border-violet-400/15 px-2 py-0.5 rounded-full">
                    {Math.round(rootCause.probability * 100)}% confidence
                  </span>
                </div>
                <p className="text-[12px] text-white/45 leading-relaxed">{rootCause.explanation}</p>
                {rootCause.counterfactual && (
                  <div className="mt-3 pt-3 border-t border-violet-400/10">
                    <p className="font-mono text-[9px] tracking-[0.15em] text-cyan-400/50 uppercase mb-1">Counterfactual</p>
                    <p className="text-[11px] text-white/30 leading-relaxed">{rootCause.counterfactual}</p>
                  </div>
                )}
              </div>
            )}

            {/* Node metadata */}
            <div className="space-y-2.5">
              <MetaRow label="ID" value={node.id} mono />
              <MetaRow label="Layer" value={node.layer} />
              <MetaRow label="Kind" value={node.kind} />
              <MetaRow
                label="Timestamp"
                value={new Date(node.timestamp).toLocaleString()}
              />
              {node.sessionId && <MetaRow label="Session ID" value={node.sessionId} mono />}
              {node.modelVersion && <MetaRow label="Model" value={node.modelVersion} />}
              {node.agentId && <MetaRow label="Agent" value={node.agentId} />}
            </div>

            {/* Payload */}
            <div>
              <h4 className="font-mono text-[9px] tracking-[0.2em] text-white/20 uppercase mb-2">
                Payload
              </h4>
              <pre className="text-[11px] text-white/25 font-mono bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 overflow-x-auto leading-relaxed">
                {JSON.stringify(node.payload, null, 2)}
              </pre>
            </div>

            {/* Context snapshot link */}
            {node.contextSnapId && (
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] tracking-[0.1em] text-white/50 uppercase">Context Snapshot</p>
                  <p className="text-[10px] text-white/20 font-mono mt-0.5">{node.contextSnapId.slice(0, 16)}...</p>
                </div>
                <a
                  href={`/snapshots/${node.contextSnapId}`}
                  className="flex items-center gap-1 font-mono text-[10px] text-violet-400/50 hover:text-violet-400/70 transition-colors"
                >
                  View <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </>
        )}

        {/* Edge detail */}
        {edge && (
          <>
            <div className="space-y-2.5">
              <MetaRow label="Type" value={edge.type} />
              <MetaRow label="Weight" value={`${Math.round(edge.weight * 100)}%`} />
              <MetaRow label="Strategy" value={edge.linkStrategy} />
              <MetaRow label="Source" value={edge.sourceId} mono />
              <MetaRow label="Target" value={edge.targetId} mono />
              {edge.confirmedBy && (
                <MetaRow label="Confirmed by" value={edge.confirmedBy} />
              )}
            </div>

            {/* Confidence warning */}
            {edge.isSuggested && (
              <div className="border border-amber-400/15 rounded-xl p-4 bg-amber-400/[0.03]">
                <p className="font-mono text-[9px] tracking-[0.2em] text-amber-400/60 uppercase mb-1">Suggested Link</p>
                <p className="text-[11px] text-white/30 leading-relaxed">
                  This link was generated with confidence {Math.round(edge.weight * 100)}%
                  using {edge.linkStrategy} matching. Please confirm or reject.
                </p>
              </div>
            )}

            {/* Confirm/reject buttons for suggested edges */}
            {edge.isSuggested && !edge.confirmedBy && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleConfirmEdge(true)}
                  disabled={confirming}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-400/[0.05] hover:bg-emerald-400/10 border border-emerald-400/15 text-emerald-400/60 font-mono text-[10px] tracking-[0.1em] uppercase py-2.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  <ThumbsUp className="w-3 h-3" />
                  Confirm
                </button>
                <button
                  onClick={() => handleConfirmEdge(false)}
                  disabled={confirming}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-red-400/[0.05] hover:bg-red-400/10 border border-red-400/15 text-red-400/60 font-mono text-[10px] tracking-[0.1em] uppercase py-2.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  <ThumbsDown className="w-3 h-3" />
                  Reject
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 text-[11px]">
      <span className="font-mono text-[9px] tracking-[0.15em] text-white/20 uppercase flex-shrink-0 w-20 pt-0.5">{label}</span>
      <span className={`text-white/40 break-all ${mono ? "font-mono text-[10px]" : ""}`}>{value}</span>
    </div>
  );
}
