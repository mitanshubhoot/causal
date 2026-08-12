"use client";

/**
 * Enterprise design primitives for the Causal product surface.
 * Restrained: neutral zinc scale, a single indigo accent, color reserved for
 * status (red=error, amber=warn, emerald=pass). No neon, no gradients.
 */

import { useState } from "react";
import type { SpanKind, SpanStatus, DetectorType } from "@/lib/mock-observability";
import { Bot, Brain, Wrench, Globe, Database, Code2, Copy, Check, Sparkles, Workflow, Search, Terminal, ChevronDown, Maximize2, Minimize2 } from "lucide-react";

export const SURFACE = "bg-[#0a0a0b]";
export const PANEL = "bg-[#0f0f11] border border-white/[0.06]";

export const KIND_META: Record<SpanKind, { label: string; Icon: typeof Bot; tone: string }> = {
  agent: { label: "AGENT", Icon: Bot, tone: "text-zinc-300" },
  llm: { label: "LLM", Icon: Brain, tone: "text-indigo-300/80" },
  tool: { label: "TOOL", Icon: Wrench, tone: "text-zinc-400" },
  http: { label: "HTTP", Icon: Globe, tone: "text-sky-300/70" },
  db: { label: "DB", Icon: Database, tone: "text-violet-300/70" },
  function: { label: "FN", Icon: Code2, tone: "text-zinc-400" },
  skill: { label: "SKILL", Icon: Sparkles, tone: "text-amber-300/80" },
  workflow: { label: "FLOW", Icon: Workflow, tone: "text-emerald-300/70" },
  search: { label: "SEARCH", Icon: Search, tone: "text-sky-300/70" },
  shell: { label: "SHELL", Icon: Terminal, tone: "text-orange-300/70" },
};

export const STATUS_META: Record<SpanStatus, { dot: string; text: string; bar: string }> = {
  ok: { dot: "bg-emerald-500/70", text: "text-emerald-400", bar: "bg-zinc-500/50" },
  warn: { dot: "bg-amber-500", text: "text-amber-400", bar: "bg-amber-500/70" },
  error: { dot: "bg-red-500", text: "text-red-400", bar: "bg-red-500/80" },
};

export const DETECTOR_LABEL: Record<DetectorType, string> = {
  hallucination: "Hallucination",
  tool_failure: "Tool failure",
  intent_drift: "Intent drift",
  safety: "Safety violation",
};

/** Human duration: 910ms · 8.4s · 1m 24s · 16m 48s */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Compact tokens: 980 · 18.4K · 1.2M */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function SeverityChip({ severity }: { severity: string }) {
  const tone =
    severity === "P1" || severity === "critical"
      ? "text-red-400 border-red-500/30 bg-red-500/10"
      : severity === "P2" || severity === "high"
        ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
        : severity === "OK"
          ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
          : "text-zinc-400 border-white/10 bg-white/[0.03]";
  return (
    <span className={`inline-flex items-center font-mono text-[10px] tracking-[0.08em] font-semibold px-1.5 py-0.5 rounded border ${tone}`}>
      {severity.toUpperCase()}
    </span>
  );
}

export function StatusDot({ status }: { status: SpanStatus }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_META[status].dot}`} />;
}

export function KindBadge({ kind }: { kind: SpanKind }) {
  const m = KIND_META[kind];
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] font-semibold ${m.tone}`}>
      <m.Icon className="w-3 h-3" strokeWidth={1.75} />
      {m.label}
    </span>
  );
}

export function MonoLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-[10px] tracking-[0.14em] uppercase text-zinc-500 ${className}`}>{children}</span>
  );
}

/** One-click copy button with a transient check state. */
export function CopyButton({ value, className = "" }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copy"
      className={`text-zinc-600 hover:text-zinc-300 transition-colors ${className}`}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/**
 * Collapsible section with a chevron — the disclosure pattern a trace detail
 * needs, since prompts and reports are far too long to sit inline.
 * `scroll` clamps the body height with its own scrollbar; the expand toggle
 * lifts the clamp so long content can be read in full.
 */
export function Section({
  label,
  children,
  defaultOpen = true,
  copyValue,
  scroll = false,
  count,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  copyValue?: string;
  scroll?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-white/[0.06] overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left group"
        >
          <ChevronDown
            className={`w-3 h-3 text-zinc-600 group-hover:text-zinc-300 transition-transform flex-shrink-0 ${open ? "" : "-rotate-90"}`}
          />
          <MonoLabel className="group-hover:text-zinc-300 transition-colors">{label}</MonoLabel>
          {count !== undefined && <span className="font-mono text-[10px] text-zinc-600">({count})</span>}
        </button>
        {open && scroll && (
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse" : "Expand"}
            className="text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0"
          >
            {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
        )}
        {copyValue !== undefined && <CopyButton value={copyValue} className="flex-shrink-0" />}
      </div>
      {open && (
        <div className={scroll ? (expanded ? "max-h-[60vh] overflow-auto" : "max-h-56 overflow-auto") : ""}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Confidence expressed as a thin bar + percentage, neutral until high. */
export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1 rounded-full bg-white/[0.08] overflow-hidden">
        <div className="h-full bg-zinc-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] text-zinc-300 tabular-nums">{pct}%</span>
    </div>
  );
}
