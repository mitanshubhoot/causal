"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DemoSpan } from "@/lib/mock-observability";
import type { Capability, Origin, SecurityEvent, Tier } from "@/lib/security-types";
import { KIND_META, STATUS_META, MonoLabel, CopyButton, Section, fmtDuration, fmtTokens } from "./ui";
import { TrustChip, CapabilityChip, TierChip, ClassChip } from "./security/trust-ui";
import { GitCommit, AlertTriangle, GitBranch, User, Boxes } from "lucide-react";

export interface TraceContext {
  repo?: string;
  gitRef?: string;
  user?: string;
  sessionId?: string;
  metadata?: { label: string; value: string }[];
  /** Wire trace id or incident id, used to look this trace up in the security
   *  corpus. Optional: when absent the panel falls back to the route (below)
   *  and, failing that, renders no security claim at all. */
  traceId?: string;
}

// ── Provenance · TIER 0 ───────────────────────────────────────────────

export interface SpanProvenance {
  /** UNKNOWN wherever the span does not justify a label. A coverage gap, never a trust claim. */
  origin: Origin;
  /** null when unresolved — NOT "NONE". NONE asserts the node can do nothing, which is a claim. */
  capability: Capability | null;
  tier: Tier;
  /** The single rule that fired, printed verbatim in the UI so the label is auditable in place. */
  basis: string;
}

const DB_WRITE_VERBS = ["insert", "update", "upsert", "delete", "write", "create", "close", "set", "put", "save"];
const DB_READ_VERBS = ["query", "select", "lookup", "fetch", "read", "find", "get", "scan", "load", "list"];

/**
 * Derive a span's ORIGIN (who authored these bytes) and CAPABILITY (what this
 * node can do) from the span alone. One function, one place, so the rule is
 * auditable rather than smeared through JSX.
 *
 * This is TIER 0 · INFERRED (weight 0.5). The observability fixture carries no
 * trust labels — nothing in a span says who authored its bytes — so this claims
 * only what `kind` and `name` justify and returns UNKNOWN everywhere else.
 * Inventing a label per span would be fabricating a security claim, which is the
 * exact failure this product exists to eliminate.
 *
 * WHAT IT CAN KNOW
 *   agent | workflow   orchestration the operator wrote and deploys → TRUSTED_OPERATOR
 *   http | search      the bytes returned were authored off-process → UNTRUSTED_EXTERNAL
 *   db                 a system of record the operator runs        → SEMI_TRUSTED_INTERNAL
 *   http               an outbound request carries bytes out       → EGRESS
 *   shell              runs a command                              → EXECUTE
 *   db + verb in name  read verb → READ_PRIVATE, write verb → MUTATE
 *
 * WHAT IT CANNOT KNOW, and therefore never says
 *   • Whether an http/search target is your own service or the open web. It takes
 *     the stronger label: under-labelling an external source is the failure that
 *     matters. This over-labels, and SOURCE_REGISTRY is where it gets corrected —
 *     one row there exists precisely because kind='search' is wrong for a purely
 *     internal vector index.
 *   • Whether a table is user-writable. A user-writable table is a laundering
 *     surface and belongs at UNTRUSTED_EXTERNAL; kind='db' cannot see that, which
 *     is the documented reason the source registry is mandatory rather than nice
 *     to have.
 *   • What an llm span read. Its origin is whatever fed its prompt, and a trace
 *     records call structure, not dataflow — parentage is not taint. UNKNOWN.
 *   • What a tool / skill / function span is. Your own code and a third-party MCP
 *     return produce the same span shape.
 *
 * Tier 1 (declared, w0.9) replaces all of this with labels the SDK writes into
 * spans.security. Nothing returned here may be read as a declared label.
 */
export function deriveSpanProvenance(span: DemoSpan): SpanProvenance {
  const tier: Tier = "inferred";
  const words = span.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  switch (span.kind) {
    case "agent":
    case "workflow":
      return {
        origin: "TRUSTED_OPERATOR",
        capability: null,
        tier,
        basis: `kind=${span.kind} — orchestration you wrote and deploy. Capability unresolved: whether it delegates is a property of the tree, not of this span.`,
      };

    case "http":
      return {
        origin: "UNTRUSTED_EXTERNAL",
        capability: "EGRESS",
        tier,
        basis:
          "kind=http — the response was authored off-process, and an outbound request carries bytes out of it. The span does not say whether the host is yours; tier 0 takes the stronger label and the source registry corrects it.",
      };

    case "search":
      return {
        origin: "UNTRUSTED_EXTERNAL",
        capability: null,
        tier,
        basis:
          "kind=search — retrieved bytes are authored by whoever wrote the document. A purely internal index is the known false positive here; register the source to replace this with a declared label.",
      };

    case "db": {
      const write = DB_WRITE_VERBS.find((v) => words.includes(v));
      const read = write ? undefined : DB_READ_VERBS.find((v) => words.includes(v));
      const capability: Capability | null = write ? "MUTATE" : read ? "READ_PRIVATE" : null;
      const verb = write ?? read;
      return {
        origin: "SEMI_TRUSTED_INTERNAL",
        capability,
        tier,
        basis: `kind=db${verb ? ` and "${verb}" in the span name` : ""} — a system of record you run${
          verb ? "" : "; the name carries no read or write verb, so the capability stays unresolved"
        }. If the table is user-writable it is a laundering surface and belongs at UNTRUSTED_EXTERNAL — this rule cannot see that.`,
      };
    }

    case "shell":
      return {
        origin: "UNKNOWN",
        capability: "EXECUTE",
        tier,
        basis:
          "kind=shell — it runs a command, so EXECUTE is structural. Who authored that command is not in the span, so the origin stays unknown.",
      };

    case "llm":
      return {
        origin: "UNKNOWN",
        capability: null,
        tier,
        basis:
          "kind=llm — an llm span's origin is whatever fed its prompt. A trace records call structure, not dataflow, so tier 0 cannot resolve it. Taint propagation through this span needs a declared label upstream.",
      };

    default:
      return {
        origin: "UNKNOWN",
        capability: null,
        tier,
        basis: `kind=${span.kind} — your own function and a third-party tool return produce the same span shape. Nothing here justifies a label.`,
      };
  }
}

/**
 * Which trace this panel is looking at, for the security-corpus lookup.
 *
 * The prop wins. Failing that, the explorer route keeps the address bar on the
 * trace that is on screen (it pushes history on every trace switch for exactly
 * that reason), so the path segment identifies the run. Anywhere else — the
 * landing preview, for one — this resolves to undefined and no security claim
 * is rendered at all.
 */
function useTraceKey(explicit?: string): string | undefined {
  const pathname = usePathname();
  if (explicit) return explicit;
  const m = /^\/incidents\/([^/?#]+)/.exec(pathname ?? "");
  return m ? decodeURIComponent(m[1]) : undefined;
}

/**
 * Security events whose trace is this trace. Loaded on demand: the corpus is
 * large and SpanDetail also renders on the landing page, which must not ship a
 * fixture it never queries. `null` means "not looked up" and prints nothing —
 * only a completed lookup is allowed to say a trace is clean.
 */
function useTraceSecurityEvents(traceKey: string | undefined): SecurityEvent[] | null {
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  useEffect(() => {
    if (!traceKey) {
      setEvents(null);
      return;
    }
    let live = true;
    import("@/lib/mock-security")
      .then((m) => {
        if (!live) return;
        setEvents(
          m.SECURITY_EVENTS.filter(
            (e) => e.traceId === traceKey || m.explorerIncidentFor(e.traceId) === traceKey,
          ),
        );
      })
      .catch(() => {
        /* a failed lookup stays null — it must not render as "no events". */
      });
    return () => {
      live = false;
    };
  }, [traceKey]);
  return events;
}

function ProvenanceSection({ span, traceKey }: { span: DemoSpan; traceKey?: string }) {
  const p = deriveSpanProvenance(span);
  const events = useTraceSecurityEvents(traceKey);

  return (
    <Section label="Provenance">
      <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-white/[0.06] bg-white/[0.01]">
        <TierChip tier={p.tier} showWeight />
        <span className="font-mono text-[10px] text-zinc-600">derived from span kind + name</span>
      </div>

      <div className="divide-y divide-white/[0.04]">
        <div className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span className="font-mono text-[11px] text-zinc-500 flex-shrink-0">Origin</span>
          <TrustChip origin={p.origin} />
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span className="font-mono text-[11px] text-zinc-500 flex-shrink-0">Capability</span>
          {p.capability ? (
            <CapabilityChip capability={p.capability} />
          ) : (
            <span
              title="No capability is claimed for this span. NONE would assert it can do nothing, which this rule cannot establish."
              className="font-mono text-[10px] tracking-[0.08em] text-zinc-600"
            >
              UNRESOLVED
            </span>
          )}
        </div>
      </div>

      <p className="px-3 py-2 border-t border-white/[0.04] font-mono text-[10.5px] leading-relaxed text-zinc-500">
        {p.basis}
      </p>

      {events !== null &&
        (events.length > 0 ? (
          <div className="border-t border-white/[0.06]">
            <div className="px-3 pt-2 pb-1">
              <MonoLabel>Security events on this trace</MonoLabel>
            </div>
            {events.map((e) => (
              <Link
                key={e.id}
                href="/security"
                className="flex items-start gap-2 px-3 py-1.5 hover:bg-white/[0.03] transition-colors"
              >
                <ClassChip eventClass={e.eventClass} />
                <span className="font-mono text-[10px] text-zinc-500 flex-shrink-0 pt-0.5">{e.id}</span>
                <span className="text-[11px] leading-snug text-zinc-300">{e.title}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="px-3 py-2 border-t border-white/[0.04] font-mono text-[10.5px] leading-relaxed text-zinc-600">
            No event in the security corpus references this trace.
          </p>
        ))}
    </Section>
  );
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
  const traceKey = useTraceKey(trace?.traceId);

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

        {/* Trust picture for this span, where the engineer already is. Inferred,
            and chipped as such — see deriveSpanProvenance for what it can and
            cannot know. */}
        <ProvenanceSection span={span} traceKey={traceKey} />

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
