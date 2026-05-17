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
    <div className="h-full flex bg-black">
      {/* Left: Controls */}
      <div className="w-[400px] border-r border-white/[0.06] flex flex-col p-6 gap-6 overflow-y-auto flex-shrink-0">
        <div>
          <h2 className="text-[14px] font-medium text-white mb-1.5 tracking-wide">Replay with Fix</h2>
          <p className="text-[12px] text-white/30 leading-relaxed">
            Modify the agent&apos;s context and re-run to verify your fix would have prevented the incident.
          </p>
        </div>

        {/* Modification type */}
        <div>
          <label className="block font-mono text-[10px] tracking-[0.15em] text-white/25 uppercase mb-3">Modification Type</label>
          <div className="flex gap-2">
            {[
              { value: "system_prompt_append", label: "Append to prompt" },
              { value: "context_inject", label: "Inject context" },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setModType(value as typeof modType)}
                className={`flex-1 font-mono text-[10px] tracking-[0.1em] uppercase px-3 py-2.5 rounded-lg border transition-all duration-200 ${
                  modType === value
                    ? "border-white/20 text-white/60 bg-white/[0.06]"
                    : "border-white/[0.06] text-white/25 hover:border-white/15 hover:text-white/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Modification content */}
        <div>
          <label className="block font-mono text-[10px] tracking-[0.15em] text-white/25 uppercase mb-3">
            {modType === "system_prompt_append"
              ? "Text to append to system prompt"
              : "Context to inject"}
          </label>
          <textarea
            value={modification}
            onChange={(e) => setModification(e.target.value)}
            placeholder={
              modType === "system_prompt_append"
                ? "IMPORTANT: Always confirm ASR transcriptions with confidence < 80% before proceeding..."
                : "The relevant spec says: ..."
            }
            rows={8}
            className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 text-[13px] text-white/60 font-mono resize-none focus:outline-none focus:border-white/20 transition-colors placeholder:text-white/15 leading-relaxed"
          />
        </div>

        {/* Fidelity note */}
        <div className="flex items-start gap-3 border border-white/[0.06] rounded-lg p-4">
          <Info className="w-3.5 h-3.5 text-white/20 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-white/25 leading-relaxed">
            Replay restores the exact context the agent had, applies your modification,
            and re-runs with the same model. A fidelity score shows how reliable the comparison is.
          </p>
        </div>

        <button
          onClick={runReplay}
          disabled={loading || !modification.trim()}
          className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-lg font-mono text-[11px] tracking-[0.12em] uppercase transition-all duration-300 ${
            loading || !modification.trim()
              ? "border border-white/[0.06] text-white/15 cursor-not-allowed"
              : "bg-white/10 border border-white/[0.12] text-white hover:bg-white/15 hover:border-white/25"
          }`}
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
              Running replay...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Run Replay
            </>
          )}
        </button>
      </div>

      {/* Right: Diff output */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!result && !error && !loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Play className="w-8 h-8 mx-auto mb-3 text-white/10" />
              <p className="text-[13px] text-white/20 mb-1">No replay results yet</p>
              <p className="font-mono text-[10px] tracking-[0.1em] text-white/10 uppercase">Apply a modification and run the replay</p>
            </div>
          </div>
        )}

        {error && (
          <div className="p-6">
            <div className="border border-red-400/20 bg-red-400/5 rounded-lg p-5 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400/60 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] font-medium text-red-400/80 mb-1">Replay failed</p>
                <p className="text-[12px] text-white/25 font-mono">{error}</p>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Fidelity score bar */}
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-6">
              <div className={`flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] uppercase ${
                result.fidelityScore >= 0.7 ? "text-emerald-400" :
                result.fidelityScore >= 0.4 ? "text-amber-400" : "text-red-400"
              }`}>
                <CheckCircle className="w-3.5 h-3.5" />
                Fidelity: {Math.round(result.fidelityScore * 100)}%
              </div>
              <span className="font-mono text-[10px] tracking-[0.1em] text-white/20 uppercase">
                Model: {result.modelUsed}
              </span>
            </div>

            {/* Side-by-side diff */}
            <div className="flex-1 overflow-hidden grid grid-cols-2 divide-x divide-white/[0.06]">
              <OutputPanel title="Original Output" content={result.originalOutput} variant="original" />
              <OutputPanel title="Modified Output" content={result.modifiedOutput} variant="modified" />
            </div>

            {/* Diff summary footer */}
            <div className="border-t border-white/[0.06] px-6 py-3">
              <div className="flex items-center gap-6 font-mono text-[10px] tracking-[0.1em] uppercase">
                <span className="text-emerald-400/60">+{result.diff.filter((d) => d.type === "added").length} additions</span>
                <span className="text-red-400/60">-{result.diff.filter((d) => d.type === "removed").length} removals</span>
                <span className="text-white/15">{result.diff.filter((d) => d.type === "unchanged").length} unchanged</span>
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
      <div className={`px-6 py-3 font-mono text-[10px] tracking-[0.15em] uppercase border-b border-white/[0.06] ${
        variant === "original" ? "text-white/25" : "text-emerald-400/50"
      }`}>
        {title}
      </div>
      <div className="flex-1 overflow-y-auto">
        <pre className="p-6 text-[12px] text-white/40 font-mono whitespace-pre-wrap leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}
