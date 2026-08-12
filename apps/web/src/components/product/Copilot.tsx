"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ObservabilityDemo } from "@/lib/mock-observability";
import { DETECTOR_LABEL } from "./ui";
import { Sparkles, GitPullRequest, Waypoints, FileText, ArrowUp } from "lucide-react";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "Why did this trace fail?",
  "What's the fix?",
  "How do we prevent this?",
  "Where did the cost go?",
];

function answerFor(q: string, demo: ObservabilityDemo): string {
  const ql = q.toLowerCase();
  const rc = demo.rootCause;
  if (ql.includes("cost") || ql.includes("token"))
    return `This trace used ${demo.tokensIn.toLocaleString()} input + ${demo.tokensOut.toLocaleString()} output tokens (~$${demo.cost.toFixed(4)}) across ${demo.spans.length} spans.${rc ? " The wasted spend is the recovery retries after the failure — fixing the root cause removes them." : " Nothing anomalous — spend is in line with similar runs."}`;
  if (!rc)
    return `This trace completed successfully — no detector flagged it. All ${demo.spans.length} spans returned ok, latency and cost are nominal. Nothing to fix here.`;
  if (ql.includes("fix"))
    return `The fix is a small, safe change in ${rc.file}: ${demo.fixPr?.description ?? "restore the guard with a safe default"} PR #${demo.fixPr?.number} is open and passed causal-replay — use "Open fix PR" to view the diff.`;
  if (ql.includes("prevent") || ql.includes("avoid"))
    return `Two guards would have prevented it: a safe default at the failing call site, and a replay/canary check that exercises the real dependency — CI stayed green because it was mocked. Causal now watches for this failure signature across your agents.`;
  return `The run failed at \`${demo.finding?.title.toLowerCase() ?? "the failing span"}\`. ${rc.explanation} Root cause: commit ${rc.commit} (${rc.hopsUpstream} hops upstream), ${Math.round(rc.confidence * 100)}% confidence.`;
}

export function Copilot({
  demo,
  onOpenFixPr,
  onOpenGraph,
}: {
  demo: ObservabilityDemo;
  onOpenFixPr: () => void;
  onOpenGraph: () => void;
}) {
  const intro = useMemo<Msg>(() => {
    if (!demo.finding || !demo.rootCause) {
      return {
        role: "assistant",
        text: `I analyzed trace ${demo.traceId} (${demo.service}). All ${demo.spans.length} spans completed successfully — no detector flagged this run, and latency and cost look nominal. Ask me anything about it.`,
      };
    }
    const failing = demo.spans.find((s) => s.id === demo.finding!.triggeredSpanId);
    const where = failing?.git ? ` (${failing.git.file}:${failing.git.line})` : "";
    const f = demo.finding!;
    const rc = demo.rootCause!;
    const errCount = demo.spans.filter((s) => s.status === "error").length;
    return {
      role: "assistant",
      text:
        `I analyzed trace ${demo.traceId} (${demo.service}, ${demo.spans.length} spans, ${errCount} failing).\n\n` +
        `WHAT HAPPENED\n\`${failing?.name ?? "a span"}\`${where} returned an error, and the ${DETECTOR_LABEL[f.detector]} detector fired at ${Math.round(f.confidence * 100)}%. ${f.summary}\n\n` +
        `ROOT CAUSE — ${rc.hopsUpstream} hop${rc.hopsUpstream === 1 ? "" : "s"} upstream, ${Math.round(rc.confidence * 100)}%\n${rc.explanation}\nIntroduced in commit ${rc.commit}${rc.file ? ` (${rc.file}:${rc.line})` : ""}.\n\n` +
        `COUNTERFACTUAL\n${rc.counterfactual}\n\n` +
        `THE FIX\n${demo.fixPr ? `${demo.fixPr.description} → PR #${demo.fixPr.number} (${demo.fixPr.status}).` : "Proposed."}`,
    };
  }, [demo]);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");

  const ask = (q: string) => {
    const question = q.trim();
    if (!question) return;
    setMsgs((m) => [...m, { role: "user", text: question }, { role: "assistant", text: answerFor(question, demo) }]);
    setDraft("");
  };

  const all = [intro, ...msgs];

  return (
    <div className="h-full flex flex-col bg-[#0c0c0e]">
      <div className="flex items-center gap-2 px-4 h-9 border-b border-white/[0.06] flex-shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-indigo-300/80" strokeWidth={1.75} />
        <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-zinc-400">Causal Copilot</span>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {all.map((m, i) =>
          m.role === "assistant" ? (
            <div key={i} className="flex gap-2.5">
              <div className="mt-0.5 w-5 h-5 rounded-md bg-indigo-500/15 border border-indigo-400/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-3 h-3 text-indigo-300/80" />
              </div>
              <p className="text-[12.5px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{m.text}</p>
            </div>
          ) : (
            <div key={i} className="flex justify-end">
              <p className="text-[12.5px] text-zinc-200 bg-white/[0.05] border border-white/[0.06] rounded-lg px-3 py-1.5 max-w-[85%]">
                {m.text}
              </p>
            </div>
          )
        )}

        {/* Actions — only for incidents (traces with a finding) */}
        {demo.finding && (
          <div className="flex flex-wrap gap-2 pt-1">
            {demo.fixPr && (
              <button
                onClick={onOpenFixPr}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-300 border border-emerald-500/25 bg-emerald-500/[0.06] rounded-md px-2.5 py-1.5 hover:bg-emerald-500/10 transition-colors"
              >
                <GitPullRequest className="w-3 h-3" /> Open fix PR #{demo.fixPr.number}
              </button>
            )}
            <button
              onClick={onOpenGraph}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2.5 py-1.5 hover:border-white/20 transition-colors"
            >
              <Waypoints className="w-3 h-3" /> Causal graph
            </button>
            <Link
              href={`/incidents/${demo.incidentId}/postmortem`}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2.5 py-1.5 hover:border-white/20 transition-colors"
            >
              <FileText className="w-3 h-3" /> Post-mortem
            </Link>
          </div>
        )}

        {/* Suggestions (only before the user asks anything) */}
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="font-mono text-[11px] text-zinc-400 border border-white/[0.08] rounded-full px-3 py-1 hover:border-white/20 hover:text-zinc-200 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-white/[0.06] p-3">
        <div className="flex items-end gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(draft);
              }
            }}
            placeholder="Ask about this trace, error, or cost…"
            className="flex-1 bg-transparent resize-none outline-none text-[12.5px] text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            onClick={() => ask(draft)}
            className="flex-shrink-0 w-6 h-6 rounded-md bg-white/10 hover:bg-white/15 flex items-center justify-center text-zinc-300 transition-colors"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="font-mono text-[10px] text-zinc-600">Causal Copilot · demo responses</span>
          <span className="font-mono text-[10px] text-zinc-500">claude-opus-4-8</span>
        </div>
      </div>
    </div>
  );
}
