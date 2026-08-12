"use client";

/**
 * Trust Boundaries — shared primitives.
 *
 * Two rules govern everything in this file, and both come from the product's
 * existing palette contract (`ui.tsx:3-7`, "colour is reserved for status"):
 *
 *  1. FIVE TRUST LABELS ARE NOT FIVE HUES. Trust is encoded as fill and border
 *     treatment on the neutral zinc scale, plus a 4px diagonal hatch for the
 *     untrusted pair. Red appears only on a node or edge participating in a
 *     violation. Emerald means BLOCKED — a successful block is the machine
 *     working, not an alarm, and a product that alarms on every attack it
 *     stopped teaches you to ignore it.
 *
 *  2. ATTACKER-CONTROLLED TEXT IS NEVER RENDERED AS MARKDOWN OR HTML. Escaped
 *     monospace only, no auto-linking, no image loading, hosts defanged. A
 *     security console that renders hostile strings is a second injection
 *     surface. Nothing here ever renders a payload — evidence is a redacted
 *     summary plus span ids and byte offsets, which is enough to check the
 *     claim and never enough to reproduce the attack.
 */

import type {
  Capability,
  EventClass,
  Origin,
  Outcome,
  SecurityEvent,
  Severity,
  Tier,
  Witness,
} from "@/lib/security-types";
import { CopyButton, MonoLabel } from "../ui";
import {
  Archive,
  Ban,
  Database,
  Lock,
  Minus,
  PenLine,
  Send,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react";

// ── Trust ─────────────────────────────────────────────────────────────

/**
 * The 4px diagonal hatch that marks untrusted bytes. It carries the meaning on
 * texture rather than hue, so it survives being printed, being colour-blind, and
 * sitting next to a red violation without competing with it.
 */
const HATCH =
  "repeating-linear-gradient(45deg, rgba(245,158,11,0.16) 0, rgba(245,158,11,0.16) 1px, transparent 1px, transparent 4px)";

export interface TrustMeta {
  label: string;
  short: string;
  /** Fill, border and text treatment — neutral scale only. */
  className: string;
  /** Inline background layer, or undefined for the trusted labels. */
  hatch?: string;
  description: string;
}

export const TRUST_META: Record<Origin, TrustMeta> = {
  TRUSTED_OPERATOR: {
    label: "TRUSTED_OPERATOR",
    short: "OPERATOR",
    className: "bg-zinc-800 border border-zinc-700 text-zinc-300",
    description: "Your own prompt templates and your own code. Bytes you wrote and version.",
  },
  TRUSTED_USER: {
    label: "TRUSTED_USER",
    short: "USER",
    className: "bg-zinc-800 border border-indigo-400/30 text-zinc-300",
    description: "The authenticated human driving this session.",
  },
  SEMI_TRUSTED_INTERNAL: {
    label: "SEMI_TRUSTED_INTERNAL",
    short: "INTERNAL",
    className: "bg-zinc-900 border border-dashed border-zinc-600 text-zinc-400",
    description:
      "Your database or vector index — unless it is user-writable, in which case it is a laundering surface and must be registered as untrusted.",
  },
  UNTRUSTED_EXTERNAL: {
    label: "UNTRUSTED_EXTERNAL",
    short: "EXTERNAL",
    className: "bg-amber-500/[0.07] border border-amber-500/30 text-amber-200/90",
    hatch: HATCH,
    description: "The open web, retrieved documents, inbound email, MCP tool returns. Anyone can author these bytes.",
  },
  UNTRUSTED_AGENT: {
    label: "UNTRUSTED_AGENT",
    short: "AGENT",
    className: "bg-amber-500/[0.07] border border-dotted border-amber-500/40 text-amber-200/90",
    hatch: HATCH,
    description: "Another agent's output. A sub-agent's effective grant is parent ∩ own, never the union.",
  },
  UNKNOWN: {
    label: "UNKNOWN",
    short: "UNKNOWN",
    className: "bg-zinc-900 border border-dashed border-zinc-700 text-zinc-500",
    description: "Resolves at no tier. A coverage gap, never a trust claim — register the source to replace it with a label.",
  },
};

/** True for the two labels that make reaching a sink an event. */
export function isUntrusted(origin: Origin): boolean {
  return origin === "UNTRUSTED_EXTERNAL" || origin === "UNTRUSTED_AGENT";
}

export function TrustChip({
  origin,
  short = false,
  className = "",
}: {
  origin: Origin;
  short?: boolean;
  className?: string;
}) {
  const m = TRUST_META[origin];
  return (
    <span
      title={m.description}
      style={m.hatch ? { backgroundImage: m.hatch } : undefined}
      className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded ${m.className} ${className}`}
    >
      {origin === "UNKNOWN" && <span aria-hidden>?</span>}
      {short ? m.short : m.label}
    </span>
  );
}

// ── Capability ────────────────────────────────────────────────────────
//
// Capability icons are deliberately monochrome. What a node CAN do is not a
// status; whether it did something it should not have been able to do is, and
// that is carried by the violation treatment instead.

export interface CapMeta {
  label: string;
  Icon: typeof Send;
  tone: string;
}

export const CAP_META: Record<Capability, CapMeta> = {
  EGRESS: { label: "EGRESS", Icon: Send, tone: "text-zinc-300" },
  EXECUTE: { label: "EXECUTE", Icon: Terminal, tone: "text-zinc-300" },
  MUTATE: { label: "MUTATE", Icon: PenLine, tone: "text-zinc-300" },
  READ_PRIVATE: { label: "READ_PRIVATE", Icon: Lock, tone: "text-zinc-400" },
  MEMORY_WRITE: { label: "MEMORY_WRITE", Icon: Archive, tone: "text-zinc-400" },
  DELEGATE: { label: "DELEGATE", Icon: Users, tone: "text-zinc-400" },
  NONE: { label: "—", Icon: Minus, tone: "text-zinc-600" },
};

export function CapabilityChip({
  capability,
  violating = false,
  className = "",
}: {
  capability: Capability;
  violating?: boolean;
  className?: string;
}) {
  if (capability === "NONE") return null;
  const m = CAP_META[capability];
  const tone = violating
    ? "text-red-300 border-red-500/40 bg-red-500/[0.1]"
    : `${m.tone} border-white/10 bg-white/[0.03]`;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.09em] font-semibold px-1.5 py-0.5 rounded border ${tone} ${className}`}
    >
      <m.Icon className="w-2.5 h-2.5" strokeWidth={1.75} />
      {m.label}
    </span>
  );
}

// ── Status chips ──────────────────────────────────────────────────────

const OUTCOME_TONE: Record<Outcome, string> = {
  // Emerald is reserved for the machine working.
  blocked: "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]",
  contained: "text-emerald-300/80 border-emerald-500/20 bg-emerald-500/[0.05]",
  succeeded: "text-red-400 border-red-500/30 bg-red-500/[0.1]",
  attempted: "text-amber-400 border-amber-500/25 bg-amber-500/[0.07]",
  none: "text-zinc-500 border-white/10 bg-white/[0.03]",
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  blocked: "blocked",
  contained: "contained",
  succeeded: "succeeded",
  attempted: "attempted",
  none: "no action",
};

export function OutcomeChip({ outcome }: { outcome: Outcome }) {
  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded border ${OUTCOME_TONE[outcome]}`}
    >
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

const CLASS_TONE: Record<EventClass, string> = {
  critical: "text-red-400 border-red-500/30 bg-red-500/[0.1]",
  blocked: "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]",
  suspicious: "text-amber-400 border-amber-500/25 bg-amber-500/[0.07]",
  informational: "text-zinc-500 border-white/10 bg-white/[0.03]",
};

export function ClassChip({ eventClass }: { eventClass: EventClass }) {
  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded border ${CLASS_TONE[eventClass]}`}
    >
      {eventClass}
    </span>
  );
}

/**
 * Severity is impact only, and stable across occurrences — a blocked critical is
 * still critical. `low` is quieter than `medium`, per the four-band scale.
 */
const SEVERITY_TONE: Record<Severity, string> = {
  critical: "text-red-400 border-red-500/30 bg-red-500/10",
  high: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  medium: "text-zinc-400 border-white/10 bg-white/[0.03]",
  low: "text-zinc-600 border-white/[0.06] bg-transparent",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center font-mono text-[10px] tracking-[0.08em] font-semibold px-1.5 py-0.5 rounded border ${SEVERITY_TONE[severity]}`}
    >
      {severity.toUpperCase()}
    </span>
  );
}

/**
 * Fidelity tier. Tier modulates confidence; it never modulates class — a Tier 0
 * finding is a real finding, just inferred from span shape rather than declared
 * by the SDK or enforced in-process.
 */
const TIER_META: Record<Tier, { label: string; weight: string; hint: string }> = {
  inferred: { label: "TIER 0 · INFERRED", weight: "0.5", hint: "Inferred from span kind and attributes. Zero instrumentation." },
  declared: { label: "TIER 1 · DECLARED", weight: "0.9", hint: "Declared by the SDK into spans.security." },
  enforced: { label: "TIER 2 · ENFORCED", weight: "1.0", hint: "Computed by identity, in-process, before execution. Exact." },
};

export function TierChip({ tier, showWeight = false }: { tier: Tier; showWeight?: boolean }) {
  const m = TIER_META[tier];
  return (
    <span
      title={m.hint}
      className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03] text-zinc-400"
    >
      {m.label}
      {showWeight && <span className="text-zinc-600">w{m.weight}</span>}
    </span>
  );
}

// ── Standards ─────────────────────────────────────────────────────────

/**
 * ASI / OWASP / ATLAS identifiers, each copyable, because the first thing an
 * analyst does with one is paste it into a ticket. These come from a reviewed
 * mapping table keyed by rule id and versioned in git with the rule — never from
 * a judge. Emitting `AML.T0051.001` from a distributed trace is the highest-
 * leverage credibility move available, and the fastest way to lose a security
 * engineer permanently the first time it is wrong.
 */
export function StandardsRow({
  asi,
  owasp,
  atlas,
  className = "",
}: {
  asi: string[];
  owasp: string[];
  atlas: string[];
  className?: string;
}) {
  const groups: { label: string; ids: string[] }[] = [
    { label: "ASI", ids: asi },
    { label: "OWASP", ids: owasp },
    { label: "ATLAS", ids: atlas },
  ].filter((g) => g.ids.length > 0);

  if (groups.length === 0) {
    return <span className="font-mono text-[11px] text-zinc-600">—</span>;
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}>
      {groups.map((g) => (
        <div key={g.label} className="flex items-center gap-1.5">
          <MonoLabel className="text-zinc-600">{g.label}</MonoLabel>
          {g.ids.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03] text-zinc-300"
            >
              {id}
              <CopyButton value={id} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Defanging ─────────────────────────────────────────────────────────

/**
 * Renders a host or URL inert: scheme neutered, dots bracketed, no anchor tag,
 * no auto-linking, nothing the browser will resolve. `paste.ee` becomes
 * `paste[.]ee`; `https://cdn-metrics.ru/px` becomes `hxxps://cdn-metrics[.]ru/px`.
 */
export function defang(value: string): string {
  return value
    .replace(/^http:\/\//i, "hxxp://")
    .replace(/^https:\/\//i, "hxxps://")
    .replace(/\./g, "[.]");
}

export function Defanged({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span
      title="Defanged — this string is inert and is never linked or fetched"
      className={`font-mono text-[11px] text-zinc-400 break-all ${className}`}
    >
      {defang(value)}
    </span>
  );
}

// ── Formatting ────────────────────────────────────────────────────────

/** 0 B · 44 B · 1.4 KB · 3.2 MB — byte counts drive edge weight, so they are always exact at small sizes. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── The boundary line ─────────────────────────────────────────────────

const TERMINAL_TONE: Record<Outcome, { label: string; className: string }> = {
  blocked: { label: "DENIED", className: "text-emerald-400 border-emerald-500/40 bg-emerald-500/[0.1]" },
  contained: { label: "CONTAINED", className: "text-emerald-300/80 border-emerald-500/25 bg-emerald-500/[0.06]" },
  succeeded: { label: "SUCCEEDED", className: "text-red-400 border-red-500/40 bg-red-500/[0.12]" },
  attempted: { label: "ATTEMPTED", className: "text-amber-400 border-amber-500/30 bg-amber-500/[0.08]" },
  none: { label: "NO CONTROL", className: "text-zinc-400 border-white/15 bg-white/[0.04]" },
};

/**
 * The single monospace line that IS the incident at a glance: source, hop, hop,
 * sink. Untrusted nodes are hatched, the violating sink is red, and the last
 * arrow carries the verdict. Used on the event row preview, the incident header,
 * and the flow map — so it scrolls horizontally rather than wrapping, because a
 * boundary that wraps stops reading as a path.
 */
export function BoundaryLine({
  event,
  compact = false,
  className = "",
}: {
  event: Pick<SecurityEvent, "flow" | "outcome" | "enforced">;
  compact?: boolean;
  className?: string;
}) {
  const terminal = TERMINAL_TONE[event.outcome];
  const lastIndex = event.flow.length - 1;

  return (
    <div className={`overflow-x-auto ${className}`}>
      <div className="inline-flex items-stretch gap-1.5 min-w-max whitespace-nowrap py-1">
        {event.flow.map((node, i) => {
          const trust = TRUST_META[node.origin];
          const violating = node.violating === true;
          return (
            <div key={`${node.spanId}-${i}`} className="inline-flex items-stretch gap-1.5">
              {i > 0 && (
                <div className="inline-flex flex-col items-center justify-center px-0.5 min-w-[52px]">
                  <span className="font-mono text-[9px] text-zinc-600 leading-none tabular-nums">
                    {node.bytes !== undefined ? fmtBytes(node.bytes) : ""}
                  </span>
                  <span
                    aria-hidden
                    className={`font-mono text-[11px] leading-none ${violating ? "text-red-500/70" : "text-zinc-700"}`}
                  >
                    ──▶
                  </span>
                </div>
              )}

              <div
                style={trust.hatch && !violating ? { backgroundImage: trust.hatch } : undefined}
                className={`inline-flex items-center gap-2 px-2 py-1.5 rounded ${
                  violating
                    ? "border border-red-500/45 bg-red-500/[0.09]"
                    : trust.className
                }`}
              >
                {violating && (
                  <span aria-hidden className="font-mono text-[11px] leading-none text-red-400">
                    ✕
                  </span>
                )}
                <div className="flex flex-col gap-0.5 leading-none">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-mono text-[9px] tracking-[0.1em] font-semibold ${
                        violating ? "text-red-300/90" : ""
                      }`}
                    >
                      {violating ? CAP_META[node.capability].label : trust.short}
                    </span>
                    {!compact && node.capability !== "NONE" && !violating && (
                      <span className="font-mono text-[9px] tracking-[0.09em] text-zinc-500">
                        {CAP_META[node.capability].label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono text-[11px] ${violating ? "text-red-200" : "text-zinc-300"}`}>
                      {node.name}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-600">#{node.spanId}</span>
                  </div>
                </div>
              </div>

              {i === lastIndex && (
                <div className="inline-flex items-center pl-1">
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] font-semibold px-1.5 py-1 rounded border ${terminal.className}`}
                  >
                    {event.outcome === "blocked" && <ShieldCheck className="w-2.5 h-2.5" strokeWidth={2} />}
                    {event.outcome === "none" && <Ban className="w-2.5 h-2.5" strokeWidth={2} />}
                    {terminal.label}
                    {!event.enforced && event.outcome !== "blocked" && (
                      <span className="text-zinc-500 font-normal">· unenforced</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Witness ───────────────────────────────────────────────────────────

const WITNESS_META: Record<Witness["kind"], { label: string; hint: string }> = {
  shingle: { label: "SHINGLE", hint: "Rolling 8-byte fingerprints computed at capture time, before truncation." },
  exact: { label: "EXACT", hint: "Byte-for-byte match on a registered value." },
  decoded: { label: "DECODED", hint: "Match found after decoding a transport encoding — base64, hex or URL." },
  opaque: { label: "OPAQUE", hint: "No verbatim carry-through. Taint propagated by rule." },
  declared: { label: "DECLARED", hint: "Established structurally — hashes, entity sets, or the absence of a decision record." },
};

/**
 * The evidence strip. Never a payload: a redacted summary, span ids, and byte
 * offsets — enough to check the claim, never enough to reproduce the attack.
 *
 * The `opaque` case is the one that matters. Instruct the model to paraphrase
 * and the verbatim carry-through disappears; the detection still holds because
 * propagation through an llm span is unconditional, but showing a matched string
 * we do not have would be a fabrication. So it says so, explicitly, rather than
 * rendering an empty space that reads as a weaker product.
 */
export function RedactedWitness({ witness, className = "" }: { witness: Witness; className?: string }) {
  const m = WITNESS_META[witness.kind];
  const opaque = witness.kind === "opaque";

  const offsets: string[] = [];
  if (witness.sourceSpanId) {
    offsets.push(
      `source #${witness.sourceSpanId}${witness.sourceOffset !== undefined ? ` @ ${witness.sourceOffset.toLocaleString()}` : ""}`,
    );
  }
  if (witness.sinkSpanId) {
    offsets.push(
      `sink #${witness.sinkSpanId}${witness.sinkOffset !== undefined ? ` @ ${witness.sinkOffset.toLocaleString()}` : ""}`,
    );
  }

  return (
    <div className={`rounded-md border border-white/[0.06] bg-white/[0.02] ${className}`}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/[0.06]">
        <span
          title={m.hint}
          className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded border ${
            opaque
              ? "text-zinc-400 border-dashed border-zinc-600 bg-transparent"
              : "text-zinc-300 border-white/10 bg-white/[0.04]"
          }`}
        >
          {m.label}
        </span>
        <MonoLabel>witness</MonoLabel>
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.08em] text-zinc-600">
          <Database className="w-2.5 h-2.5" strokeWidth={1.75} />
          payload withheld
        </span>
      </div>

      <div className="px-2.5 py-2 space-y-1.5">
        {opaque && (
          <p className="font-mono text-[11px] text-amber-200/70 leading-relaxed">
            OPAQUE — model paraphrased; taint propagated by rule, no verbatim carry-through.
          </p>
        )}
        {/* Escaped monospace, pre-wrap, no markdown, no auto-linking. */}
        <pre className="font-mono text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap break-words">
          {witness.summary}
        </pre>
        {offsets.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
            {offsets.map((o) => (
              <span key={o} className="font-mono text-[10px] text-zinc-600 tabular-nums">
                {o}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
