"use client";

import type { DemoSpan } from "@/lib/mock-observability";
import { KIND_META, STATUS_META, MonoLabel, CopyButton, Section, fmtDuration, fmtTokens } from "./ui";
import { GitCommit, AlertTriangle, GitBranch, User, Boxes } from "lucide-react";

export interface TraceContext {
  repo?: string;
  gitRef?: string;
  user?: string;
  sessionId?: string;
  metadata?: { label: string; value: string }[];
}

function ContextRow({ Icon, label, value }: { Icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <Icon className="w-3 h-3 text-zinc-600 flex-shrink-0" strokeWidth={1.75} />
      <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-zinc-500 w-14 flex-shrink-0">{label}</span>
      <span className="font-mono text-[11px] text-zinc-200 truncate">{value}</span>
      <CopyButton value={value} className="ml-auto flex-shrink-0" />
    </div>
  );
}

function KV({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="divide-y divide-white/[0.04]">
      {rows.map((a) => (
        <div key={a.label} className="flex items-center justify-between px-3 py-1.5 gap-3">
          <span className="font-mono text-[11px] text-zinc-500 flex-shrink-0">{a.label}</span>
          <span className="font-mono text-[11px] text-zinc-200 tabular-nums text-right truncate">{a.value}</span>
        </div>
      ))}
    </div>
  );
}

export function SpanDetail({ span, trace }: { span: DemoSpan; trace?: TraceContext }) {
  const m = KIND_META[span.kind];
  const isRoot = span.parentId === null;
  const hasCtx = !!trace && !!(trace.repo || trace.gitRef || trace.user || trace.sessionId);

  return (
    <div className="h-full overflow-auto bg-[#0c0c0e]">
      <div className="flex items-center gap-2 px-4 h-9 border-b border-white/[0.06] sticky top-0 bg-[#0c0c0e] z-10">
        <m.Icon className={`w-3.5 h-3.5 ${m.tone}`} strokeWidth={1.75} />
        <span className="font-mono text-[12px] text-zinc-200 truncate">{span.name}</span>
        <CopyButton value={span.name} className="ml-auto flex-shrink-0" />
      </div>

      <div className="p-3 space-y-3">
        {/* Kind / latency / status / economics */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase text-zinc-400 border border-white/10 rounded px-2 py-1">
            Kind: <span className="text-zinc-200">{span.kind}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase text-zinc-400 border border-white/10 rounded px-2 py-1">
            Latency: <span className="text-zinc-200">{fmtDuration(span.durationMs)}</span>
          </span>
          <span className={`inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase font-semibold ${STATUS_META[span.status].text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[span.status].dot}`} />
            {span.status}
          </span>
          {(span.tokensIn !== undefined || span.tokensOut !== undefined) && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-400 border border-white/10 rounded px-2 py-1 tabular-nums">
              {fmtTokens(span.tokensIn ?? 0)} → {fmtTokens(span.tokensOut ?? 0)}
              <span className="text-zinc-600">({fmtTokens((span.tokensIn ?? 0) + (span.tokensOut ?? 0))})</span>
            </span>
          )}
          {span.cost !== undefined && (
            <span className="inline-flex items-center font-mono text-[10px] text-zinc-400 border border-white/10 rounded px-2 py-1 tabular-nums">
              ${span.cost.toFixed(4)}
            </span>
          )}
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

        {/* Trace-level context — on the root span, like a real APM. */}
        {isRoot && hasCtx && (
          <Section label="Trace context">
            <div className="divide-y divide-white/[0.04]">
              {trace!.repo && <ContextRow Icon={GitBranch} label="Repo" value={trace!.repo} />}
              {trace!.gitRef && <ContextRow Icon={GitCommit} label="Ref" value={trace!.gitRef} />}
              {trace!.user && <ContextRow Icon={User} label="User" value={trace!.user} />}
              {trace!.sessionId && <ContextRow Icon={Boxes} label="Session" value={trace!.sessionId} />}
            </div>
          </Section>
        )}

        {span.io?.input && (
          <Section label="Input" copyValue={span.io.input} scroll>
            <pre className="px-3 py-2 text-[11.5px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words font-mono">
              {span.io.input}
            </pre>
          </Section>
        )}

        {span.io?.output && (
          <Section label="Output" copyValue={span.io.output} scroll>
            <pre className="px-3 py-2 text-[11.5px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words font-mono">
              {span.io.output}
            </pre>
          </Section>
        )}

        <Section label="Attributes" count={span.attributes.length} scroll>
          <KV rows={span.attributes} />
        </Section>

        {isRoot && trace?.metadata && trace.metadata.length > 0 && (
          <Section label="Metadata" count={trace.metadata.length} scroll>
            <KV rows={trace.metadata} />
          </Section>
        )}

        {span.git && (
          <Section label="Git context" copyValue={`${span.git.file}:${span.git.line}`}>
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.01]">
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
          </Section>
        )}
      </div>
    </div>
  );
}
