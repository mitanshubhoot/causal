"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import type { ObservabilityDemo } from "@/lib/mock-observability";
import { askCopilot, LIVE_TRACES } from "@/lib/traces-api";
import { DETECTOR_LABEL, fmtDuration, fmtTokens } from "./ui";
import { Sparkles, GitPullRequest, Waypoints, FileText, ArrowUp } from "lucide-react";

// Dark, compact markdown styling for the copilot panel.
const MD: Components = {
  h1: ({ children }) => <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-zinc-500 mt-3 mb-1.5">{children}</p>,
  h2: ({ children }) => <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-zinc-500 mt-3 mb-1.5">{children}</p>,
  h3: ({ children }) => <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-zinc-500 mt-3 mb-1.5">{children}</p>,
  p: ({ children }) => <p className="text-[12.5px] text-zinc-300 leading-relaxed mb-2">{children}</p>,
  strong: ({ children }) => <strong className="text-zinc-100 font-semibold">{children}</strong>,
  em: ({ children }) => <em className="text-zinc-400 italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 mb-2 text-[12.5px] text-zinc-300">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 mb-2 text-[12.5px] text-zinc-300">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ children }) => (
    <code className="font-mono text-[11px] bg-white/[0.06] border border-white/[0.06] rounded px-1 py-px text-indigo-200/90">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="font-mono text-[11px] bg-black/50 border border-white/[0.06] rounded-md p-2 overflow-x-auto mb-2 text-zinc-300">{children}</pre>
  ),
  a: ({ children }) => <span className="text-indigo-300/90">{children}</span>,
  hr: () => <hr className="border-white/[0.06] my-3" />,
};

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
  if (ql.includes("cost") || ql.includes("token")) {
    const top = [...demo.spans]
      .filter((s) => s.cost !== undefined)
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      .slice(0, 3);
    const lines = top.map((s) => `- \`${s.name}\` — ${fmtTokens((s.tokensIn ?? 0) + (s.tokensOut ?? 0))} tokens, **$${(s.cost ?? 0).toFixed(4)}**`).join("\n");
    return `## Cost breakdown
This trace used **${demo.tokensIn.toLocaleString()}** input + **${demo.tokensOut.toLocaleString()}** output tokens (~**$${demo.cost.toFixed(4)}**) across ${demo.spans.length} spans.

${lines || "_No per-span cost recorded._"}

${rc ? "The retry spans after the failure are pure waste — fixing the root cause removes them entirely." : "Spend is in line with comparable healthy runs."}`;
  }
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
      const llmCalls = demo.spans.filter((s) => s.kind === "llm").length;
      const tools = demo.spans.filter((s) => s.kind === "tool" || s.kind === "shell" || s.kind === "search").length;
      const rootDur = Math.max(...demo.spans.map((s) => s.startMs + s.durationMs), 0);
      return {
        role: "assistant",
        text:
`I analyzed trace \`${demo.traceId}\` — **${demo.service}**, ${demo.spans.length} spans over ${fmtDuration(rootDur)}, ${fmtTokens(demo.tokensIn + demo.tokensOut)} tokens (~$${demo.cost.toFixed(4)}).

## Result
**No detector flagged this run.** All spans returned \`ok\`, and latency and cost are in line with comparable runs.

## Trace structure
- ${llmCalls} LLM calls, ${tools} tool calls
- Entry point: \`${demo.spans.find((s) => !s.parentId)?.name ?? "root"}\`

Ask me about the steps, the cost breakdown, or how it compares to failing runs.`,
      };
    }
    const failing = demo.spans.find((s) => s.id === demo.finding!.triggeredSpanId);
    const where = failing?.git ? ` at \`${failing.git.file}:${failing.git.line}\`` : "";
    const f = demo.finding!;
    const rc = demo.rootCause!;
    const errs = demo.spans.filter((s) => s.status === "error");
    const llmCalls = demo.spans.filter((s) => s.kind === "llm").length;
    const tools = demo.spans.filter((s) => s.kind === "tool" || s.kind === "shell" || s.kind === "search").length;
    const rootDur = Math.max(...demo.spans.map((s) => s.startMs + s.durationMs), 0);
    return {
      role: "assistant",
      text:
`I analyzed trace \`${demo.traceId}\` — **${demo.service}**, ${demo.spans.length} spans over ${fmtDuration(rootDur)}, ${fmtTokens(demo.tokensIn + demo.tokensOut)} tokens (~$${demo.cost.toFixed(4)}).

## Trace structure
- ${llmCalls} LLM calls, ${tools} tool calls, **${errs.length} failing span${errs.length === 1 ? "" : "s"}**
- Entry point: \`${demo.spans.find((s) => !s.parentId)?.name ?? "root"}\`
- First failure: \`${failing?.name ?? "unknown"}\`${where}

## Why the ${DETECTOR_LABEL[f.detector].toLowerCase()} detector fired
${f.summary}

Confidence **${Math.round(f.confidence * 100)}%** (judge: \`${f.judgeModel}\`).

## Root cause — ${rc.hopsUpstream} hop${rc.hopsUpstream === 1 ? "" : "s"} upstream
${rc.explanation}

Introduced in commit \`${rc.commit}\`${rc.file ? ` — \`${rc.file}:${rc.line}\`` : ""}.

**Counterfactual:** ${rc.counterfactual}

## The fix
${demo.fixPr ? `${demo.fixPr.description}\n\n→ **PR #${demo.fixPr.number}** (\`${demo.fixPr.branch}\`), +${demo.fixPr.additions}/−${demo.fixPr.deletions}, status _${demo.fixPr.status}_.` : "A fix has been proposed but not yet opened as a PR."}

**TL;DR** — ${rc.summary}. Fixing \`${rc.file ?? "the failing call site"}\` removes this failure class entirely.`,
    };
  }, [demo]);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || thinking) return;
    setDraft("");
    setMsgs((m) => [...m, { role: "user", text: question }]);

    // In live mode ask the real Copilot endpoint (grounded in the trace's
    // spans, finding, RCA and git context); fall back to the scripted answer
    // whenever the API is unreachable so the demo never dead-ends.
    if (LIVE_TRACES) {
      setThinking(true);
      void askCopilot(demo.traceId, question)
        .then((answer) => {
          setMsgs((m) => [...m, { role: "assistant", text: answer ?? answerFor(question, demo) }]);
        })
        .finally(() => setThinking(false));
      return;
    }
    setMsgs((m) => [...m, { role: "assistant", text: answerFor(question, demo) }]);
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
              <div className="min-w-0 flex-1">
                <ReactMarkdown components={MD}>{m.text}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-end">
              <p className="text-[12.5px] text-zinc-200 bg-white/[0.05] border border-white/[0.06] rounded-lg px-3 py-1.5 max-w-[85%]">
                {m.text}
              </p>
            </div>
          )
        )}

        {thinking && (
          <div className="flex gap-2.5">
            <div className="mt-0.5 w-5 h-5 rounded-md bg-indigo-500/15 border border-indigo-400/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-3 h-3 text-indigo-300/80" />
            </div>
            <span className="flex items-center gap-1.5 text-[12.5px] text-zinc-500">
              <span className="w-1 h-1 rounded-full bg-zinc-500 animate-pulse" />
              Analyzing the trace…
            </span>
          </div>
        )}

        {/* Fix PR / causal graph / post-mortem now live in the pinned
            TraceActions bar under the trace header — they belong to the trace,
            not to a message, and here they scrolled out of view as the
            conversation grew. */}

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
