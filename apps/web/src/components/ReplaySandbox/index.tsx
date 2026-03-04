"use client";

import { useState } from "react";
import { Play, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { api } from "@/lib/api";
import type { ReplayResult } from "@causal/types";

interface ReplaySandboxProps {
  rootNodeId: string;
  snapshotId?: string;
}

export function ReplaySandbox({ rootNodeId, snapshotId }: ReplaySandboxProps) {
  const [modification, setModification] = useState("");
  const [modType, setModType] = useState<"system_prompt_append" | "context_inject">("system_prompt_append");
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runReplay = async () => {
    if (!modification.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await api.runReplay({
        snapshotId: snapshotId ?? rootNodeId,
        modification: {
          type: modType,
          content: modification,
          position: "end",
        },
      });
      setResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex">
      {/* Left: Controls */}
      <div className="w-96 border-r border-gray-800 flex flex-col p-4 gap-4 overflow-y-auto">
        <div>
          <h2 className="text-sm font-semibold text-white mb-1">Replay with Fix</h2>
          <p className="text-xs text-gray-500">
            Modify the agent&apos;s context and re-run to verify your fix would have prevented the incident.
          </p>
        </div>

        {/* Modification type */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">Modification Type</label>
          <div className="flex gap-2">
            {[
              { value: "system_prompt_append", label: "Append to system prompt" },
              { value: "context_inject", label: "Inject context" },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setModType(value as typeof modType)}
                className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                  modType === value
                    ? "bg-violet-950 border-violet-700 text-violet-300"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Modification content */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">
            {modType === "system_prompt_append"
              ? "Text to append to system prompt"
              : "Context to inject"}
          </label>
          <textarea
            value={modification}
            onChange={(e) => setModification(e.target.value)}
            placeholder={
              modType === "system_prompt_append"
                ? "IMPORTANT: 'retry on failure' means HTTP 408 and 504 ONLY. Do not retry on 4xx client errors."
                : "The relevant spec says: ..."
            }
            rows={8}
            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 font-mono resize-none focus:outline-none focus:border-violet-500 transition-colors"
          />
        </div>

        {/* Fidelity note */}
        <div className="flex items-start gap-2 bg-gray-800 rounded-lg p-3 text-xs">
          <Info className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
          <p className="text-gray-400">
            Replay restores the exact context the agent had, applies your modification,
            and re-runs with the same model. A fidelity score shows how reliable the comparison is.
          </p>
        </div>

        <button
          onClick={runReplay}
          disabled={loading || !modification.trim()}
          className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white py-3 rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Running replay...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run Replay
            </>
          )}
        </button>
      </div>

      {/* Right: Diff output */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!result && !error && !loading && (
          <div className="flex-1 flex items-center justify-center text-gray-600">
            <div className="text-center">
              <Play className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Apply a modification and run the replay</p>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4">
            <div className="bg-red-950 border border-red-800 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Replay failed</p>
                <p className="text-xs text-gray-400 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Fidelity score */}
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-4">
              <div className={`flex items-center gap-1.5 text-xs font-medium ${
                result.fidelityScore >= 0.7 ? "text-green-400" :
                result.fidelityScore >= 0.4 ? "text-yellow-400" : "text-red-400"
              }`}>
                <CheckCircle className="w-3.5 h-3.5" />
                Fidelity: {Math.round(result.fidelityScore * 100)}%
              </div>
              <span className="text-xs text-gray-500">Model: {result.modelUsed}</span>
            </div>

            {/* Side-by-side diff */}
            <div className="flex-1 overflow-hidden grid grid-cols-2 divide-x divide-gray-800">
              <OutputPanel title="Original Output" content={result.originalOutput} variant="original" />
              <OutputPanel title="Modified Output" content={result.modifiedOutput} variant="modified" />
            </div>

            {/* Diff summary */}
            <div className="border-t border-gray-800 px-4 py-3">
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="text-green-400">+{result.diff.filter((d) => d.type === "added").length} additions</span>
                <span className="text-red-400">-{result.diff.filter((d) => d.type === "removed").length} removals</span>
                <span>{result.diff.filter((d) => d.type === "unchanged").length} unchanged</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OutputPanel({
  title,
  content,
  variant,
}: {
  title: string;
  content: string;
  variant: "original" | "modified";
}) {
  return (
    <div className="flex flex-col overflow-hidden">
      <div className={`px-4 py-2 text-xs font-medium border-b border-gray-800 ${
        variant === "original" ? "text-gray-400" : "text-green-400"
      }`}>
        {title}
      </div>
      <div className="flex-1 overflow-y-auto">
        <pre className="p-4 text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}
