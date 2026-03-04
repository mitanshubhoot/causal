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
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          {node ? `${node.layer} Node` : "Edge Detail"}
        </h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Node detail */}
        {node && (
          <>
            {/* Root cause explanation */}
            {rootCause && (
              <div className="bg-violet-950 border border-violet-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">
                    Root Cause
                  </span>
                  <span className="text-xs bg-violet-800 text-violet-200 px-2 py-0.5 rounded-full">
                    {Math.round(rootCause.probability * 100)}% confidence
                  </span>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{rootCause.explanation}</p>
                {rootCause.counterfactual && (
                  <div className="mt-2 pt-2 border-t border-violet-800">
                    <p className="text-xs text-cyan-400 font-medium mb-1">Counterfactual</p>
                    <p className="text-xs text-gray-400">{rootCause.counterfactual}</p>
                  </div>
                )}
              </div>
            )}

            {/* Node metadata */}
            <div className="space-y-2">
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
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Payload
              </h4>
              <pre className="text-xs text-gray-400 bg-gray-950 rounded-lg p-3 overflow-x-auto leading-relaxed">
                {JSON.stringify(node.payload, null, 2)}
              </pre>
            </div>

            {/* Context snapshot link */}
            {node.contextSnapId && (
              <div className="bg-gray-800 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-white">Context Snapshot</p>
                  <p className="text-xs text-gray-500 font-mono">{node.contextSnapId.slice(0, 16)}...</p>
                </div>
                <a
                  href={`/snapshots/${node.contextSnapId}`}
                  className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
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
            <div className="space-y-2">
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
              <div className="bg-yellow-950 border border-yellow-800 rounded-lg p-3">
                <p className="text-xs font-medium text-yellow-400 mb-1">Suggested Link</p>
                <p className="text-xs text-gray-400">
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
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-950 hover:bg-green-900 border border-green-800 text-green-400 text-sm py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                  Confirm
                </button>
                <button
                  onClick={() => handleConfirmEdge(false)}
                  disabled={confirming}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-red-950 hover:bg-red-900 border border-red-800 text-red-400 text-sm py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
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
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-500 flex-shrink-0 w-20">{label}</span>
      <span className={`text-gray-300 break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
