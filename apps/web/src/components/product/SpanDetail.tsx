"use client";

import type { DemoSpan } from "@/lib/mock-observability";
import { KIND_META, STATUS_META, MonoLabel } from "./ui";
import { GitCommit, AlertTriangle } from "lucide-react";

function fmtDur(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function IOBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-md border border-white/[0.06] overflow-hidden">
      <div className="px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
        <MonoLabel>{label}</MonoLabel>
      </div>
      <pre className="px-3 py-2 text-[11.5px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words font-mono max-h-52 overflow-auto">
        {text}
      </pre>
    </div>
  );
}

export function SpanDetail({ span }: { span: DemoSpan }) {
  const m = KIND_META[span.kind];
  return (
    <div className="h-full overflow-auto bg-[#0c0c0e]">
      <div className="flex items-center gap-2 px-4 h-9 border-b border-white/[0.06] sticky top-0 bg-[#0c0c0e] z-10">
        <m.Icon className={`w-3.5 h-3.5 ${m.tone}`} strokeWidth={1.75} />
        <span className="font-mono text-[12px] text-zinc-200 truncate">{span.name}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Kind + latency */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase text-zinc-400 border border-white/10 rounded px-2 py-1">
            Span kind: <span className="text-zinc-200">{span.kind}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase text-zinc-400 border border-white/10 rounded px-2 py-1">
            Latency: <span className="text-zinc-200">{fmtDur(span.durationMs)}</span>
          </span>
          <span className={`inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase font-semibold ${STATUS_META[span.status].text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[span.status].dot}`} />
            {span.status}
          </span>
        </div>

        {span.error && (
          <div className="rounded-md border border-red-500/25 bg-red-500/[0.06] px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              <MonoLabel className="text-red-400/80">Error</MonoLabel>
            </div>
            <p className="font-mono text-[11.5px] text-red-300 leading-relaxed break-words">{span.error}</p>
          </div>
        )}

        {span.io?.input && <IOBlock label="Input" text={span.io.input} />}
        {span.io?.output && <IOBlock label="Output" text={span.io.output} />}

        <div>
          <MonoLabel className="block mb-2">Attributes</MonoLabel>
          <div className="rounded-md border border-white/[0.06] divide-y divide-white/[0.04]">
            {span.attributes.map((a) => (
              <div key={a.label} className="flex items-center justify-between px-3 py-1.5 gap-3">
                <span className="font-mono text-[11px] text-zinc-500 flex-shrink-0">{a.label}</span>
                <span className="font-mono text-[11px] text-zinc-200 tabular-nums text-right truncate">{a.value}</span>
              </div>
            ))}
          </div>
        </div>

        {span.git && (
          <div>
            <MonoLabel className="block mb-2">Git context</MonoLabel>
            <div className="rounded-md border border-white/[0.06] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
                <GitCommit className="w-3 h-3 text-zinc-500" />
                <span className="font-mono text-[11px] text-zinc-300 truncate">
                  {span.git.file}:{span.git.line}
                </span>
                <span className="ml-auto font-mono text-[10px] text-indigo-300/80">{span.git.commit}</span>
              </div>
              {span.code && (
                <pre className="overflow-x-auto text-[11px] leading-[1.6] py-2">
                  {span.code.lines.map((ln) => (
                    <div key={ln.n} className={`grid grid-cols-[36px_1fr] ${ln.marked ? "bg-red-500/[0.08]" : ""}`}>
                      <span className="text-right pr-3 text-zinc-600 select-none">{ln.n}</span>
                      <code className={ln.marked ? "text-red-300" : "text-zinc-400"}>{ln.text || " "}</code>
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
