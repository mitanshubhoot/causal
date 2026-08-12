"use client";

/**
 * Trust Boundaries — Events.
 *
 * The triage surface and the incident. Two levels, list → detail, in the
 * breadcrumb idiom the trace explorer and the evals view already use.
 *
 * Four rules govern this file, and all four come from the proposal:
 *
 *  1. NO NUMBER IS AUTHORED HERE. Every figure on screen is a field on the
 *     fixture or is computed from one — counts are `.length`, dwell is a
 *     timestamp subtraction, leverage is Δscore/lines. Where a fact is not
 *     carried on the record (the exact impact cell behind a priority, a judge's
 *     confidence) the UI renders an em dash and says why, rather than inventing
 *     something that reads as a measurement.
 *
 *  2. NO PAYLOAD, ANYWHERE. Evidence is a redacted envelope plus span ids and
 *     byte offsets. The reveal control exists and is DISABLED, because showing
 *     the gate communicates the policy better than hiding the button.
 *
 *  3. ATTACKER-INFLUENCED TEXT IS NEVER MARKDOWN OR HTML. Prose is rendered as
 *     escaped text with hosts defanged at render time (`paste.ee` →
 *     `paste[.]ee`), no anchors, no images, nothing the browser will resolve.
 *
 *  4. COLOUR IS STATUS ONLY. Trust labels are texture, not hue. Red marks a node
 *     or edge participating in a violation. Emerald means blocked — a successful
 *     block is the machine working, not an alarm.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AGENTS,
  AS_OF,
  DETECTIONS,
  SECURITY_EVENTS,
  getEvent,
  listEvents,
  violatingNode,
  type EventFilter,
} from "@/lib/mock-security";
import type {
  CriticalReason,
  EventClass,
  FlowNode,
  Outcome,
  Remediation,
  SecurityEvent,
  Severity,
  Tier,
} from "@/lib/security-types";
import { CopyButton, MonoLabel, PANEL, Section } from "../ui";
import {
  BoundaryLine,
  CapabilityChip,
  ClassChip,
  OutcomeChip,
  RedactedWitness,
  SeverityBadge,
  StandardsRow,
  TRUST_META,
  TierChip,
  TrustChip,
  defang,
  fmtBytes,
} from "./trust-ui";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  CornerDownRight,
  Layers,
  Lock,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";

// The explorer is keyed on incidentId while events carry the wire traceId, and the
// demo dataset holds only a handful of runs — so most security events reference a
// trace that has no explorer page. Resolve before offering the affordance: a link
// that 404s is worse than no link.
import { explorerIncidentFor } from "@/lib/mock-security";

// ── Text safety ───────────────────────────────────────────────────────

/**
 * Hosts are stored bare in the fixture and defanged here, at render time. The
 * TLD set is deliberately a short allowlist rather than a generic `word.word`
 * pattern: this prose is full of `report.ts:88`, `package.json`,
 * `causal.policy.yaml` and `@acme/jira-mcp@1.4.2`, and a console that bracketed
 * the dots in a file path would be worse than one that did nothing.
 */
const HOST_RE =
  /\b(?:(?:https?|hxxps?):\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|co|ru|ee|club|example)\b(?:\/[^\s,;)]*)?/gi;

/** Escaped text with every host rendered inert. No markdown, no auto-linking. */
function DefangedText({ text, className = "" }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const out: { key: string; value: string; host: boolean }[] = [];
    let last = 0;
    for (const m of text.matchAll(HOST_RE)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ key: `t${last}`, value: text.slice(last, at), host: false });
      out.push({ key: `h${at}`, value: m[0], host: true });
      last = at + m[0].length;
    }
    if (last < text.length) out.push({ key: `t${last}`, value: text.slice(last), host: false });
    return out;
  }, [text]);

  return (
    <span className={className}>
      {parts.map((p) =>
        p.host ? (
          <span
            key={p.key}
            title="Defanged — this string is inert and is never linked or fetched"
            className="font-mono text-[0.92em] text-zinc-400 break-all"
          >
            {defang(p.value)}
          </span>
        ) : (
          <span key={p.key}>{p.value}</span>
        ),
      )}
    </span>
  );
}

// ── Time ──────────────────────────────────────────────────────────────
//
// Timestamps are sliced, never parsed into a local Date for display: the
// fixture is stamped in UTC and an incident that moves by an hour because the
// analyst is in Berlin is an incident nobody can correlate.

const dateOf = (iso: string) => iso.slice(0, 10);
const timeOf = (iso: string) => iso.slice(11, 19);
const shortStamp = (iso: string) => `${iso.slice(5, 10)} ${iso.slice(11, 19)}`;

/** Elapsed, as the analyst reads it: 8d 4h 55m. */
function elapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d}d ${h}h${min > 0 ? ` ${min}m` : ""}`;
  if (h > 0) return `${h}h${min > 0 ? ` ${min}m` : ""}`;
  return `${min}m`;
}

const ago = (iso: string) => `${elapsed(Date.parse(AS_OF) - Date.parse(iso))} ago`;

/** Events with no trace carry an em dash, not a fake id. */
const hasTrace = (e: SecurityEvent) => e.traceId !== "" && e.traceId !== "—";

/**
 * The whole flow as recoverable text, for the `title` on a preview that can
 * still clip on the longest paths. Hosts are defanged here exactly as they are
 * on screen — a tooltip is chrome, not a second place the rules relax.
 */
function flowTitle(e: SecurityEvent): string {
  const path = e.flow
    .map(
      (n) =>
        `${TRUST_META[n.origin].short} ${defang(n.name)} #${n.spanId}` +
        (n.bytes === undefined ? "" : ` · ${fmtBytes(n.bytes)}`) +
        (n.violating === true ? " · violating sink" : ""),
    )
    .join("  →  ");
  return `${path}  ⇒  ${e.outcome}${e.enforced ? "" : " · unenforced"}`;
}

// ── Vocabulary ────────────────────────────────────────────────────────

const CLASS_ORDER: EventClass[] = ["critical", "blocked", "suspicious", "informational"];
const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const OUTCOME_ORDER: Outcome[] = ["succeeded", "contained", "blocked", "attempted", "none"];
const TIER_ORDER: Tier[] = ["enforced", "declared", "inferred"];

const TIER_SHORT: Record<Tier, string> = {
  enforced: "tier 2 enforced",
  declared: "tier 1 declared",
  inferred: "tier 0 inferred",
};

/** Set B fires with zero attacks present. It is the product argument. */
const SET_B: CriticalReason[] = ["bypass", "gap", "quarantine", "break_glass"];

const REASON_META: Record<CriticalReason, { label: string; gloss: string }> = {
  crossed_and_succeeded: {
    label: "crossed and succeeded",
    gloss: "Set A — untrusted taint reached a capability sink and the action completed.",
  },
  bypass: {
    label: "bypass",
    gloss: "Set B — the rule evaluated to deny, nothing was armed on this path, and the action then succeeded. The attack worked; we watched.",
  },
  gap: {
    label: "gap",
    gloss: "Set B — a boundary you declared critical has no enforcement point on a path that actually executed. This fires on a quiet Tuesday with no attacker present.",
  },
  quarantine: {
    label: "quarantine",
    gloss: "Set B — a run was contained. A contained run is still a run we had to stop, and the operator should know their agent spent the afternoon boxed in.",
  },
  break_glass: {
    label: "break-glass",
    gloss: "Set B — enforcement was manually dropped to monitor. The off switch exists; it is loud, attributed, and self-expiring.",
  },
};

const STATUS_TONE: Record<SecurityEvent["status"], string> = {
  new: "text-zinc-200 border-white/20 bg-white/[0.06]",
  triaging: "text-zinc-300 border-dashed border-white/20 bg-transparent",
  resolved: "text-zinc-600 border-white/[0.06] bg-transparent",
  accepted_risk: "text-zinc-500 border-dashed border-zinc-700 bg-transparent",
};

const STATUS_LABEL: Record<SecurityEvent["status"], string> = {
  new: "new",
  triaging: "triaging",
  resolved: "resolved",
  accepted_risk: "accepted risk",
};

const ACTION_LABEL: Record<Remediation["action"], string> = {
  open_pr: "Open PR",
  open_registry: "Open registry",
  copy_snippet: "Copy snippet",
  rotate_credential: "Rotate credential",
  arm_rule: "Arm rule",
};

/**
 * What a demo button does when the thing behind it is a real product surface
 * that does not exist yet. A dead button is worse than an honest one.
 */
const ACTION_NOTE: Record<Remediation["action"], string> = {
  open_pr: "Opens a pull request against the customer's repository, verified by the repo's own suite before it is marked verified. Not wired in this demo — the cut is real, the button is not.",
  open_registry: "Opens the source registry at the unregistered rows. Not wired in this demo.",
  copy_snippet: "Copies the exact instrumentation snippet for this service. Not wired in this demo.",
  rotate_credential: "Hands off to the credential owner's rotation flow. Not wired in this demo.",
  arm_rule: "Moves the rule one stage along monitor → canary → enforce, gated on its readiness bar. Not wired in this demo.",
};

/**
 * A rule mode renders identically wherever it appears. These four tones and the
 * chip geometry below are byte-identical to the Overview's (`SecurityOverview.tsx`
 * MODE_TONE / ModeChip) — the same `TB-04 canary` must not be a different amber
 * on two tabs of one console. They are duplicated rather than shared only because
 * `trust-ui.tsx` is owned elsewhere this pass; the pair belongs next to
 * OutcomeChip/ClassChip/TierChip and should move there in one edit.
 */
const MODE_TONE: Record<string, string> = {
  enforce: "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]",
  canary: "text-amber-400 border-amber-500/30 bg-amber-500/[0.07]",
  monitor: "text-zinc-400 border-white/10 bg-white/[0.03]",
  off: "text-red-400 border-red-500/40 bg-transparent",
};

function ModeChip({ mode, canaryPct }: { mode: string; canaryPct?: number }) {
  const label = mode === "canary" && canaryPct !== undefined ? `canary ${canaryPct}%` : mode;
  return (
    <span
      className={`inline-flex items-center font-mono text-[9px] tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded border ${MODE_TONE[mode]}`}
    >
      {label}
    </span>
  );
}

// ── Small chips ───────────────────────────────────────────────────────

function Chip({
  children,
  tone = "text-zinc-400 border-white/10 bg-white/[0.03]",
  title,
  className = "",
}: {
  children: React.ReactNode;
  tone?: string;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.06em] px-1.5 py-0.5 rounded border ${tone} ${className}`}
    >
      {children}
    </span>
  );
}

function StatusChip({ status }: { status: SecurityEvent["status"] }) {
  return <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>;
}

function ReasonChip({ reason }: { reason: CriticalReason }) {
  const m = REASON_META[reason];
  return (
    <Chip tone="text-red-300 border-red-500/30 bg-red-500/[0.08]" title={m.gloss}>
      <ShieldAlert className="w-2.5 h-2.5" strokeWidth={2} />
      {m.label}
    </Chip>
  );
}

/** A campaign is N rows sharing a signature. The count is what the analyst wants. */
function OccurrenceBadge({ n }: { n: number }) {
  if (n <= 1) return null;
  return (
    <Chip
      tone="text-zinc-300 border-white/15 bg-white/[0.05]"
      title={`${n} occurrences share this signature and are collapsed into one row`}
      className="tabular-nums"
    >
      <Layers className="w-2.5 h-2.5" strokeWidth={1.75} />×{n}
    </Chip>
  );
}

// ── Priority, opened up ───────────────────────────────────────────────
//
// Priority = round(100 × (I/10) × C × E × B), no clamp. Three of the four
// factors are decidable from the record; the impact cell is a reviewed table
// keyed by the capability reached and is NOT carried here, so the popover shows
// the band severity implies and says the cell is missing rather than inverting
// the arithmetic to a number that would be wrong under rounding.

const B_FACTOR: Record<Outcome, number> = {
  succeeded: 1.0,
  contained: 0.5,
  attempted: 0.5,
  blocked: 0.15,
  none: 0.15,
};

const E_FACTOR: Record<string, number> = { prod: 1.0, staging: 0.4, dev: 0.15 };

const IMPACT_BAND: Record<Severity, string> = {
  critical: "I ≥ 9",
  high: "I 7–8",
  medium: "I 4–6",
  low: "I ≤ 3",
};

function PriorityFactors({ event }: { event: SecurityEvent }) {
  const e = E_FACTOR[event.environment];
  const rows: { key: string; name: string; value: string; why: string }[] = [
    {
      key: "I",
      name: "impact",
      value: "—",
      why: `${IMPACT_BAND[event.severity]} — the band severity implies. The exact cell is a reviewed table keyed by the capability reached and is not carried on this record.`,
    },
    {
      key: "C",
      name: "evidence",
      value: event.evidence === "deterministic" ? "1.00" : "—",
      why:
        event.evidence === "deterministic"
          ? "Deterministic detection. C is 1.00 for every graph predicate — a model's self-reported confidence is not a calibrated probability."
          : "Judge-confirmed. The confidence is an opinion, is rendered as its own chip on the witness, and is not carried as a factor here.",
    },
    {
      key: "E",
      name: "environment",
      value: e === undefined ? "—" : e.toFixed(2),
      why: `${event.environment} — prod 1.00 · staging 0.40 · dev 0.15.`,
    },
    {
      key: "B",
      name: "barrier",
      value: B_FACTOR[event.outcome].toFixed(2),
      why: `outcome ${event.outcome} — succeeded 1.00 · contained/attempted 0.50 · blocked/none 0.15.`,
    },
  ];

  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
      <p className="font-mono text-[11px] text-zinc-400">
        priority = round(100 × (I/10) × C × E × B) <span className="text-zinc-600">· no clamp</span>
      </p>
      {rows.map((r) => (
        <div key={r.key} className="flex items-start gap-2.5">
          <span className="font-mono text-[11px] text-zinc-300 w-3">{r.key}</span>
          <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-zinc-600 w-[92px] flex-shrink-0 pt-0.5">
            {r.name}
          </span>
          <span className="font-mono text-[11px] text-zinc-200 tabular-nums w-10 flex-shrink-0">{r.value}</span>
          <span className="text-[11.5px] text-zinc-500 min-w-0 flex-1 leading-relaxed">{r.why}</span>
        </div>
      ))}
      <p className="text-[11.5px] text-zinc-600 leading-relaxed border-t border-white/[0.06] pt-2">
        A hole in the perimeter outranks a blocked attack: a critical gap in prod scores 90, the same
        boundary crossed and blocked scores 13. That ordering is the point of the formula.
      </p>
    </div>
  );
}

// ── Level 1 · the queue ───────────────────────────────────────────────

interface Dims {
  eventClass: EventClass[];
  severity: Severity[];
  outcome: Outcome[];
  agent: string[];
  tier: Tier[];
}

const EMPTY_DIMS: Dims = { eventClass: [], severity: [], outcome: [], agent: [], tier: [] };

interface SavedView {
  id: string;
  label: string;
  hint: string;
  filter: EventFilter;
  /** For predicates `EventFilter` cannot express — set B is a field, not a filter. */
  predicate?: (e: SecurityEvent) => boolean;
}

const SAVED_VIEWS: SavedView[] = [
  {
    id: "succeeded-prod-7d",
    label: "Succeeded, prod, 7d",
    hint: "Boundary crossed, in production, and the action completed. The queue you work first.",
    filter: { outcome: ["succeeded"], environment: ["prod"], withinDays: 7 },
  },
  {
    id: "untriaged-70",
    label: "Untriaged priority ≥ 70",
    hint: "Nobody has touched these and the arithmetic says they page.",
    filter: { status: ["new"], minPriority: 70 },
  },
  {
    id: "controls-not-holding",
    label: "Controls not holding",
    hint: "Critical set B — bypass, gap, quarantine, break-glass. These fire with zero attacks present, and they are the rows that say whether the machine you paid for is running.",
    filter: { eventClass: ["critical"] },
    predicate: (e) => e.criticalReason !== undefined && SET_B.includes(e.criticalReason),
  },
];

/** The queue's own order: priority descending, ties broken newest-first. */
function byPriority(a: SecurityEvent, b: SecurityEvent): number {
  return b.priority - a.priority || Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

function dimsToFilter(d: Partial<Dims>, query: string): EventFilter {
  return {
    eventClass: d.eventClass,
    severity: d.severity,
    outcome: d.outcome,
    agent: d.agent,
    tier: d.tier,
    query: query.trim() || undefined,
  };
}

/**
 * The queue's columns. Below `xl` the two identifier columns — agent and tool —
 * are dropped rather than pushed off the right edge behind an overlay scrollbar:
 * a column you cannot see and cannot discover is worse than one that is honestly
 * absent, and both facts are one click away on the incident. This is the same
 * drop-columns pattern the detector and eval tables use (`views.tsx:132`).
 *
 * xl track budget: 24px row padding + 932px of tracks + 84px of gaps = 1040px,
 * against 1056px of usable width at a 1280px viewport. Below xl: 24 + 684 + 60
 * = 768px, which clears the narrowest supported width with room to spare.
 */
const GRID =
  "grid grid-cols-[54px_78px_98px_122px_minmax(240px,1fr)_92px] xl:grid-cols-[54px_78px_98px_122px_minmax(240px,1fr)_128px_112px_92px] gap-x-3 items-start";

/** Dropped below xl — see GRID. */
const XL_ONLY = "hidden xl:block";

function FilterChip({
  label,
  count,
  active,
  onClick,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  // A chip that can only ever produce an empty table is inert, and says so with
  // the cursor and with a reason on hover. `aria-disabled` rather than
  // `disabled`, because a disabled button in Chrome swallows its own tooltip and
  // the reason is the whole point. An ACTIVE chip is never inert even at 0 —
  // the count is computed with this dimension cleared, so deselecting it has to
  // stay possible.
  const inert = count === 0 && !active;
  return (
    <button
      onClick={inert ? undefined : onClick}
      aria-disabled={inert || undefined}
      aria-pressed={active}
      title={
        inert
          ? `No event under the other filters is ${label} — nothing to select. Clear or widen the filters to bring it back.`
          : title
      }
      className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] px-2 py-1 rounded border transition-colors ${
        active
          ? "text-zinc-100 border-white/25 bg-white/[0.07]"
          : inert
            ? "text-zinc-600 border-white/[0.05] cursor-not-allowed"
            : "text-zinc-500 border-white/[0.06] hover:text-zinc-300 hover:border-white/15"
      }`}
    >
      {label}
      <span className="tabular-nums text-zinc-600">{count}</span>
    </button>
  );
}

function EventList({
  onOpenEvent,
}: {
  onOpenEvent: (id: string) => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [dims, setDims] = useState<Dims>(EMPTY_DIMS);
  const [query, setQuery] = useState("");

  const view = SAVED_VIEWS.find((v) => v.id === saved);

  // A saved view is a pool; the chips narrow inside it. Picking a view resets
  // the chips so you start clean, but a chip never silently drops the view —
  // otherwise the facet counts on screen would describe a different set than
  // the one a click produces.
  const pool = useMemo(() => {
    if (!view) return SECURITY_EVENTS;
    const base = listEvents(view.filter);
    return view.predicate ? base.filter(view.predicate) : base;
  }, [view]);

  const rows = useMemo(
    () => [...listEvents(dimsToFilter(dims, query), pool)].sort(byPriority),
    [dims, query, pool],
  );

  /** Facet counts respect every other dimension, so a chip that would yield
   *  nothing says 0 before it is clicked rather than after. */
  const facet = useMemo(() => {
    const count = <K extends keyof Dims>(key: K, value: Dims[K][number]): number => {
      const others: Partial<Dims> = { ...dims, [key]: [] };
      return listEvents(dimsToFilter(others, query), pool).filter((e) => {
        if (key === "eventClass") return e.eventClass === value;
        if (key === "severity") return e.severity === value;
        if (key === "outcome") return e.outcome === value;
        if (key === "tier") return e.tier === value;
        return e.agent === value;
      }).length;
    };
    return count;
  }, [dims, query, pool]);

  const toggle = <K extends keyof Dims>(key: K, value: Dims[K][number]) => {
    setDims((prev) => {
      const current = prev[key] as Dims[K][number][];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const activeCount =
    dims.eventClass.length + dims.severity.length + dims.outcome.length + dims.agent.length + dims.tier.length;

  const groups: { key: keyof Dims; label: string; values: string[] }[] = [
    { key: "eventClass", label: "class", values: CLASS_ORDER },
    { key: "outcome", label: "outcome", values: OUTCOME_ORDER },
    { key: "severity", label: "severity", values: SEVERITY_ORDER },
    { key: "tier", label: "tier", values: TIER_ORDER },
    { key: "agent", label: "agent", values: AGENTS },
  ];

  // Every headline count is a length, never a literal.
  const shownOccurrences = rows.reduce((a, e) => a + e.occurrences, 0);

  return (
    <>
      <p className="text-[13px] text-zinc-500 mb-5 max-w-3xl leading-relaxed">
        Every row is a trust-level confusion: untrusted bytes became instructions, or private bytes
        reached a sink nobody authorised. Sorted by priority, which is impact and outcome — never how
        frightening the attack sounds. A hole in the perimeter outranks an attack that was blocked.
      </p>

      {/* Saved views. The third one is the argument: it is the queue with no attacker in it. */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <MonoLabel className="flex-shrink-0">Saved views</MonoLabel>
        {SAVED_VIEWS.map((v) => {
          const base = listEvents(v.filter);
          const n = (v.predicate ? base.filter(v.predicate) : base).length;
          const active = saved === v.id;
          return (
            <button
              key={v.id}
              title={v.hint}
              onClick={() => {
                setDims(EMPTY_DIMS);
                setSaved(active ? null : v.id);
              }}
              className={`inline-flex items-center gap-2 text-[11.5px] px-2 py-1 rounded-md border transition-colors ${
                active
                  ? "text-zinc-100 border-indigo-400/40 bg-indigo-500/[0.08]"
                  : "text-zinc-400 border-white/[0.06] hover:border-white/15 hover:text-zinc-200"
              }`}
            >
              {v.label}
              <span className="font-mono text-[10.5px] text-zinc-500 tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Filters. Panes never collapse in this product; controls shrink. */}
      <div className={`rounded-lg ${PANEL} p-3 mb-4 space-y-2`}>
        {groups.map((g) => (
          <div key={g.key} className="flex items-start gap-2.5">
            <MonoLabel className="w-[62px] flex-shrink-0 pt-1">{g.label}</MonoLabel>
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              {g.values.map((v) => (
                <FilterChip
                  key={v}
                  label={g.key === "tier" ? TIER_SHORT[v as Tier] : v}
                  count={facet(g.key, v as never)}
                  active={(dims[g.key] as string[]).includes(v)}
                  onClick={() => toggle(g.key, v as never)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2.5 pt-1 border-t border-white/[0.04]">
          <MonoLabel className="w-[62px] flex-shrink-0">search</MonoLabel>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Search className="w-3 h-3 text-zinc-600 flex-shrink-0" />
            <input
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="id, title, agent, tool, rule"
              className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-zinc-200 placeholder:text-zinc-700 outline-none"
            />
          </div>
          {(activeCount > 0 || query || saved) && (
            <button
              onClick={() => {
                setDims(EMPTY_DIMS);
                setQuery("");
                setSaved(null);
              }}
              title="Clear every filter, the search box and the saved view"
              className="inline-flex items-center gap-1 font-mono text-[10.5px] text-zinc-400 border border-white/[0.06] rounded px-2 py-1 hover:text-zinc-100 hover:border-white/15 transition-colors flex-shrink-0"
            >
              <X className="w-3 h-3" /> clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <MonoLabel>
          {rows.length} of {SECURITY_EVENTS.length} events
        </MonoLabel>
        <span
          className="font-mono text-[10.5px] text-zinc-600 tabular-nums"
          title="Rows sharing a signature are collapsed; this is the number of occurrences behind the rows on screen."
        >
          {shownOccurrences} occurrences behind them
        </span>
        {view && <span className="font-mono text-[10.5px] text-zinc-600">· {view.label}</span>}
      </div>

      <div className={`rounded-lg ${PANEL} overflow-x-auto`}>
        {/* The track budget for each breakpoint — see GRID. Below this the grid
            would spill out of its own scroll box instead of scrolling. */}
        <div className="min-w-[768px] xl:min-w-[1040px]">
          <div className={`${GRID} px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]`}>
            {[
              { h: "priority" },
              { h: "severity" },
              { h: "class" },
              { h: "time · utc" },
              { h: "event" },
              { h: "agent", only: XL_ONLY },
              { h: "tool", only: XL_ONLY },
              { h: "status" },
            ].map((c) => (
              <MonoLabel key={c.h} className={c.only ?? ""}>
                {c.h}
              </MonoLabel>
            ))}
          </div>

          {rows.length === 0 && (
            <p className="px-4 py-10 text-center font-mono text-[12px] text-zinc-600">
              No events match this filter.
            </p>
          )}

          {rows.map((e) => (
            <button
              key={e.id}
              onClick={() => onOpenEvent(e.id)}
              className={`${GRID} w-full text-left px-3 py-2.5 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.03] transition-colors`}
            >
              <span
                className={`font-mono text-[15px] tabular-nums leading-tight ${
                  e.priority >= 70 ? "text-zinc-100" : e.priority >= 30 ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                {e.priority}
              </span>
              <span className="pt-0.5">
                <SeverityBadge severity={e.severity} />
              </span>
              <span className="pt-0.5">
                <ClassChip eventClass={e.eventClass} />
              </span>
              <span className="font-mono text-[10.5px] text-zinc-500 tabular-nums pt-1">
                {shortStamp(e.timestamp)}
              </span>

              <span className="min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] text-zinc-200 leading-snug">{e.title}</span>
                  <OccurrenceBadge n={e.occurrences} />
                  {e.criticalReason && <ReasonChip reason={e.criticalReason} />}
                </span>
              </span>

              <span className={`font-mono text-[10.5px] text-zinc-400 truncate pt-1 ${XL_ONLY}`} title={e.agent}>
                {e.agent}
              </span>
              <span
                className={`font-mono text-[10.5px] text-zinc-500 truncate pt-1 ${XL_ONLY}`}
                title={e.tool ?? "This event is not a tool call."}
              >
                {e.tool ?? "—"}
              </span>
              <span className="pt-0.5">
                <StatusChip status={e.status} />
              </span>

              {/* The flow is the most information-dense thing a row can carry, and
                  it is the sink and the verdict at the END of it that decide the
                  row — so it gets the full width of the table rather than a 272px
                  column that hid four fifths of every path. The mask still fades
                  the longest ones, and `title` carries the whole thing as text. */}
              <span
                className="col-span-full mt-1.5 flex items-center gap-2 min-w-0"
                title={flowTitle(e)}
              >
                <span
                  className="block relative min-w-0 flex-1 overflow-hidden [&>div]:overflow-x-hidden [mask-image:linear-gradient(to_right,black_92%,transparent)]"
                  aria-hidden
                >
                  <BoundaryLine event={e} compact />
                </span>
                <span className="font-mono text-[10px] text-zinc-600 tabular-nums flex-shrink-0">
                  {e.flow.length} hop{e.flow.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11.5px] text-zinc-600 mt-3 max-w-3xl leading-relaxed">
        Rows sharing a signature collapse to one with a ×N badge — fourteen identical blocks are one
        fact, not fourteen. Blocked events are a ledger and never page; a successful block is the
        machine working.
      </p>
    </>
  );
}

// ── Level 2 · the incident ────────────────────────────────────────────

function HeaderChip({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <Chip tone={tone} title={title}>
      {children}
    </Chip>
  );
}

/** The loop, drawn: what this event was created from, and what came out of it. */
function Lineage({ event, onOpen }: { event: SecurityEvent; onOpen: (id: string) => void }) {
  const parent = event.derivedFrom ? getEvent(event.derivedFrom) : undefined;
  const child = SECURITY_EVENTS.find((e) => e.derivedFrom === event.id);
  if (!parent && !child) return null;

  const link = (e: SecurityEvent, role: string) => (
    <button
      onClick={() => onOpen(e.id)}
      className="flex items-start gap-2.5 w-full text-left group rounded px-1.5 py-1 -mx-1.5 hover:bg-white/[0.03] transition-colors"
    >
      <span className="font-mono text-[11.5px] text-indigo-300 group-hover:text-indigo-200 flex-shrink-0">
        {e.id}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 flex-wrap">
          <ClassChip eventClass={e.eventClass} />
          <span className="font-mono text-[10.5px] text-zinc-600">
            {e.ruleId} v{e.ruleVersion} · {dateOf(e.timestamp)} {timeOf(e.timestamp)}
          </span>
        </span>
        <span className="block text-[11.5px] text-zinc-500 mt-0.5 leading-snug">
          {role} — {e.title}
        </span>
      </span>
      <ArrowUpRight className="w-3 h-3 text-zinc-700 group-hover:text-zinc-400 flex-shrink-0 mt-0.5" />
    </button>
  );

  const gap = (a: SecurityEvent, b: SecurityEvent) =>
    elapsed(Date.parse(b.timestamp) - Date.parse(a.timestamp));

  return (
    <div className="rounded-lg border border-indigo-400/20 bg-indigo-500/[0.03] p-3 mb-5">
      <MonoLabel className="block mb-2">Lineage</MonoLabel>

      {parent && (
        <>
          {link(parent, "the earlier event this one was created from")}
          <div className="flex items-center gap-2 pl-1 py-1">
            <CornerDownRight className="w-3 h-3 text-zinc-700" />
            <span className="font-mono text-[10.5px] text-zinc-500 tabular-nums">
              {gap(parent, event)} later
            </span>
            {parent.ruleId === event.ruleId && parent.ruleVersion !== event.ruleVersion && (
              <span className="font-mono text-[10.5px] text-zinc-600">
                · {parent.ruleId} v{parent.ruleVersion} → v{event.ruleVersion}
              </span>
            )}
          </div>
        </>
      )}

      <div className="flex items-start gap-2.5 px-1.5 py-1">
        <span className="font-mono text-[11.5px] text-zinc-200 flex-shrink-0">{event.id}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 flex-wrap">
            <ClassChip eventClass={event.eventClass} />
            <span className="font-mono text-[10.5px] text-zinc-600">
              {event.ruleId} v{event.ruleVersion} · {dateOf(event.timestamp)} {timeOf(event.timestamp)}
            </span>
          </span>
          <span className="block text-[11.5px] text-zinc-500 mt-0.5">this event</span>
        </span>
      </div>

      {child && (
        <>
          <div className="flex items-center gap-2 pl-1 py-1">
            <CornerDownRight className="w-3 h-3 text-zinc-700" />
            <span className="font-mono text-[10.5px] text-zinc-500 tabular-nums">
              {gap(event, child)} later
            </span>
          </div>
          {link(child, "what this event became")}
        </>
      )}

      <p className="text-[11.5px] text-zinc-600 mt-2 pt-2 border-t border-white/[0.06] leading-relaxed">
        {parent && child
          ? "This event sits in the middle of a chain — it was produced by an earlier finding and produced a later one."
          : parent
            ? "The control that fired here was authored from that earlier finding. A false positive closes back into the rule; a true positive closes back into a policy."
            : "The earlier row nobody looked at is what makes the later one decidable. That is why informational events are retained rather than dropped."}
      </p>
    </div>
  );
}

/** Two findings, one trace — the concrete reason security writes N rows per trace. */
function SameTrace({ event, onOpen }: { event: SecurityEvent; onOpen: (id: string) => void }) {
  if (!hasTrace(event)) return null;
  const siblings = SECURITY_EVENTS.filter((e) => e.id !== event.id && e.traceId === event.traceId);
  if (siblings.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/[0.06] p-3 mb-5">
      <div className="flex items-center gap-2 flex-wrap">
        <MonoLabel>Same trace</MonoLabel>
        <span className="font-mono text-[10.5px] text-zinc-600">{event.traceId}</span>
        {siblings.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-indigo-300 border border-indigo-400/25 rounded px-1.5 py-0.5 hover:bg-indigo-500/[0.08] transition-colors"
          >
            {s.id} <span className="text-zinc-500">{s.ruleId}</span>
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-zinc-600 mt-1.5 leading-relaxed">
        {siblings.length === 1 ? "One other finding" : `${siblings.length} other findings`} on this
        trace. A single trace routinely contains more than one, which is why a security scan writes N
        rows instead of one verdict per trace.
      </p>
    </div>
  );
}

function FlowHop({
  node,
  index,
  traceId,
  onOpenTrace,
}: {
  node: FlowNode;
  index: number;
  traceId: string | null;
  onOpenTrace: (id: string) => void;
}) {
  const violating = node.violating === true;

  const body = (
    <>
      <div className="flex items-start gap-3 flex-wrap">
        <span className="font-mono text-[10px] text-zinc-600 tabular-nums w-8 flex-shrink-0 pt-1">
          {index + 1}
        </span>
        <span className="font-mono text-[10.5px] text-zinc-500 w-12 flex-shrink-0 pt-1">
          #{node.spanId}
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className={`font-mono text-[12.5px] ${violating ? "text-red-200" : "text-zinc-200"}`}>
            {node.name}
          </span>
          <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-zinc-600 ml-2">
            {node.kind}
          </span>
        </span>
        <span className="flex items-center gap-1.5 flex-wrap flex-shrink-0 pt-0.5">
          <TrustChip origin={node.origin} short />
          <CapabilityChip capability={node.capability} violating={violating} />
          <span className="font-mono text-[10.5px] text-zinc-500 tabular-nums w-14 text-right">
            {node.bytes === undefined ? "—" : fmtBytes(node.bytes)}
          </span>
        </span>
      </div>
      {violating && (
        <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-red-400/80 mt-1.5 ml-[92px]">
          violating hop
        </p>
      )}
      {node.detail && (
        <DefangedText
          text={node.detail}
          className="block text-[11.5px] text-zinc-500 leading-relaxed mt-1 ml-[92px]"
        />
      )}
    </>
  );

  const shell = `px-3 py-2.5 border-b border-white/[0.03] last:border-b-0 ${
    violating ? "border-l-2 border-l-red-500/50 bg-red-500/[0.04]" : "border-l-2 border-l-transparent"
  }`;

  const incidentId = traceId ? explorerIncidentFor(traceId) : null;
  if (!traceId || !incidentId) return <div className={shell}>{body}</div>;

  return (
    <button
      onClick={() => onOpenTrace(traceId)}
      title={`Open trace ${traceId} in the explorer`}
      className={`${shell} w-full text-left hover:bg-white/[0.03] transition-colors`}
    >
      {body}
    </button>
  );
}

function RemediationRow({ item, rank }: { item: Remediation; rank: number }) {
  const [note, setNote] = useState(false);
  const containment = item.deltaScore <= 0;
  return (
    <div className="px-3 py-3 border-b border-white/[0.03] last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="font-mono text-[10px] text-zinc-600 tabular-nums pt-1 w-4 flex-shrink-0">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-zinc-200 leading-snug">{item.title}</p>
          <DefangedText
            text={item.detail}
            className="block text-[11.5px] text-zinc-500 leading-relaxed mt-1"
          />
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <Chip
              tone={
                containment
                  ? "text-zinc-500 border-white/10 bg-transparent"
                  : "text-zinc-200 border-white/15 bg-white/[0.05]"
              }
              title={
                containment
                  ? "A containment action. It reduces exposure now but recovers no posture points, so it is excluded from the ranked cuts on the Overview."
                  : "Points this cut would return to the containment score."
              }
              className="tabular-nums"
            >
              {containment ? "containment · no score change" : `+${item.deltaScore} score`}
            </Chip>
            <span className="font-mono text-[10.5px] text-zinc-600 tabular-nums">
              ~{item.diffLines} line{item.diffLines === 1 ? "" : "s"}
            </span>
            {!containment && (
              <span
                className="font-mono text-[10.5px] text-zinc-600 tabular-nums"
                title="Δscore ÷ diff lines — the ranking key. Ranked cuts are ordered by score recovered per line changed."
              >
                {(item.deltaScore / item.diffLines).toFixed(2)} pts/line
              </span>
            )}
            {/* The action sits in the meta row, not out at the right margin, so
                the note it opens lands directly beneath the control that opened
                it. Neutral and chevroned rather than indigo-and-arrow: the arrow
                idiom belongs to the links that really navigate — the lineage
                rows and the trace chip — and this one only discloses text. The
                treatment is the Overview's action button, so the same
                `Open PR` is one control across both tabs. */}
            <button
              onClick={() => setNote((v) => !v)}
              aria-expanded={note}
              title={note ? "Hide what this action does" : "What does this action do?"}
              className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] rounded border px-2 py-1 transition-colors ${
                note
                  ? "text-zinc-100 border-white/25 bg-white/[0.07]"
                  : "text-zinc-300 border-white/10 hover:text-zinc-100 hover:border-white/25"
              }`}
            >
              {ACTION_LABEL[item.action]}
              <ChevronDown
                className={`w-2.5 h-2.5 transition-transform ${note ? "" : "-rotate-90"}`}
                strokeWidth={2}
              />
            </button>
          </div>
          {note && (
            <p className="text-[11.5px] text-zinc-500 mt-2 border-l border-white/10 pl-2 leading-relaxed">
              {ACTION_NOTE[item.action]}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** What the outcome enum means, stated from the enum and nothing else. */
const OUTCOME_SENTENCE: Record<Outcome, string> = {
  succeeded: "The action completed.",
  blocked: "The action was denied.",
  contained: "The run was contained.",
  attempted: "Evaluated, not acted on.",
  none: "No control acted on this path.",
};

function EventDetail({
  event,
  onBack,
  onOpenEvent,
  onOpenTrace,
}: {
  event: SecurityEvent;
  onBack: () => void;
  onOpenEvent: (id: string) => void;
  onOpenTrace: (traceId: string) => void;
}) {
  const [showFactors, setShowFactors] = useState(false);
  const rule = DETECTIONS.find((d) => d.id === event.ruleId);
  const sink = violatingNode(event.flow);
  const traceId = hasTrace(event) ? event.traceId : null;
  const totalBytes = event.flow.reduce((a, n) => a + (n.bytes ?? 0), 0);

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Events
        </button>
        <span className="text-zinc-700">/</span>
        <span className="font-mono text-[12px] text-zinc-400">{event.id}</span>
        <CopyButton value={event.id} />
      </div>

      {/* Header. No payload anywhere in it. */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <ClassChip eventClass={event.eventClass} />
        <SeverityBadge severity={event.severity} />
        <button
          onClick={() => setShowFactors((v) => !v)}
          title="Show the four factors behind this number"
          className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] font-semibold px-1.5 py-0.5 rounded border transition-colors ${
            showFactors
              ? "text-zinc-100 border-white/25 bg-white/[0.07]"
              : "text-zinc-300 border-white/15 bg-white/[0.04] hover:border-white/25"
          }`}
        >
          PRIORITY <span className="tabular-nums text-[11px]">{event.priority}</span>
        </button>
        {event.criticalReason && <ReasonChip reason={event.criticalReason} />}
        <OccurrenceBadge n={event.occurrences} />
        <span className="font-mono text-[10.5px] text-zinc-500 tabular-nums">
          {dateOf(event.timestamp)} {timeOf(event.timestamp)} UTC
        </span>
        <span className="font-mono text-[10.5px] text-zinc-600">· {ago(event.timestamp)}</span>
        <span className="font-mono text-[10.5px] text-zinc-400">· {event.agent}</span>
        <HeaderChip>{event.environment}</HeaderChip>
        <StatusChip status={event.status} />
      </div>

      {showFactors && (
        <div className="mb-3">
          <PriorityFactors event={event} />
        </div>
      )}

      <h2 className="text-[15px] text-zinc-100 leading-snug mb-3 max-w-3xl">{event.title}</h2>

      {/* Standards / tier / evidence / latency. Each id is copyable because the
          first thing an analyst does with one is paste it into a ticket. */}
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mb-4">
        <StandardsRow asi={event.asi} owasp={event.owasp} atlas={event.atlas} />
        <span className="w-px h-4 bg-white/10" aria-hidden />
        <TierChip tier={event.tier} showWeight />
        <HeaderChip
          tone={
            event.evidence === "deterministic"
              ? "text-zinc-300 border-white/10 bg-white/[0.03]"
              : "text-zinc-400 border-dashed border-zinc-600 bg-transparent"
          }
        >
          evidence: {event.evidence}
        </HeaderChip>
        <HeaderChip
          tone={
            event.enforced
              ? "text-zinc-300 border-white/10 bg-white/[0.03]"
              : "text-amber-300/80 border-amber-500/25 bg-amber-500/[0.05]"
          }
        >
          {event.enforced ? "control armed" : "no control armed"}
        </HeaderChip>
        {event.latencyUs !== undefined && (
          <HeaderChip title="Measured decision cost, not an SLO — this runs on the customer's hardware over their payload sizes.">
            <span className="tabular-nums">{event.latencyUs}µs</span>
          </HeaderChip>
        )}
        <span className="inline-flex items-center gap-1.5">
          <MonoLabel className="text-zinc-600">rule</MonoLabel>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03] text-zinc-300">
            {event.ruleId} v{event.ruleVersion}
            <CopyButton value={event.ruleId} />
          </span>
          {rule && <span className="font-mono text-[10.5px] text-zinc-500">{rule.name}</span>}
          {rule && <ModeChip mode={rule.mode} canaryPct={rule.canaryPct} />}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MonoLabel className="text-zinc-600">trace</MonoLabel>
          {traceId && explorerIncidentFor(traceId) ? (
            <button
              onClick={() => onOpenTrace(traceId)}
              className="inline-flex items-center gap-1 font-mono text-[10.5px] text-indigo-300 border border-indigo-400/25 rounded px-1.5 py-0.5 hover:bg-indigo-500/[0.08] transition-colors"
            >
              {traceId} <ArrowUpRight className="w-3 h-3" />
            </button>
          ) : traceId ? (
            <span
              className="font-mono text-[10.5px] text-zinc-500"
              title="This run is not in the demo trace set, so there is no explorer page to open."
            >
              {traceId}
            </span>
          ) : (
            <span
              className="font-mono text-[10.5px] text-zinc-600"
              title="This event is a control or inventory fact rather than a crossing on one run, so it has no single trace."
            >
              —
            </span>
          )}
        </span>
      </div>

      <Lineage event={event} onOpen={onOpenEvent} />
      <SameTrace event={event} onOpen={onOpenEvent} />

      <div className="space-y-3">
        {/* 1 — the whole incident on one line. */}
        <Section label="1 · The boundary that was crossed">
          <div className="p-3">
            <div className="rounded-md border border-white/[0.06] bg-black/20 px-2 py-1.5">
              <BoundaryLine event={event} />
            </div>
            <DefangedText
              text={event.summary}
              className="block text-[12.5px] text-zinc-300 leading-relaxed mt-3 max-w-3xl"
            />
            {sink && (
              <p className="font-mono text-[11px] text-zinc-500 mt-2">
                sink ·{" "}
                <span className={sink.violating ? "text-red-300" : "text-zinc-300"}>{sink.name}</span>{" "}
                <span className="text-zinc-600">#{sink.spanId}</span>
                {sink.capability !== "NONE" && (
                  <span className="text-zinc-500"> · capability {sink.capability}</span>
                )}
              </p>
            )}
          </div>
        </Section>

        {/* 2 — the flow. Each hop is a span that existed before anything was concatenated. */}
        <Section label="2 · The flow" count={event.flow.length}>
          <div>
            {event.flow.map((n, i) => (
              <FlowHop
                key={`${n.spanId}-${i}`}
                node={n}
                index={i}
                traceId={traceId}
                onOpenTrace={onOpenTrace}
              />
            ))}
          </div>
          <div className="px-3 py-2 border-t border-white/[0.06] flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[10.5px] text-zinc-600 tabular-nums">
              {event.flow.length} hops · {fmtBytes(totalBytes)} carried
            </span>
            <span className="text-[11.5px] text-zinc-600 leading-relaxed min-w-0 flex-1">
              {/* Gated on the same predicate FlowHop uses to decide whether a hop
                  is a button at all. Most demo traces have no explorer page, and
                  telling an analyst to click a div is worse than saying nothing. */}
              {traceId && explorerIncidentFor(traceId)
                ? "Each hop is a separate row in spans, with its own io and parent, captured before anything was concatenated. Click one to open the trace."
                : traceId
                  ? "Each hop is a separate row in spans, with its own io and parent, captured before anything was concatenated. This run is not in the demo trace set, so there is no explorer page to open from here."
                  : "This event has no single trace: it is a control or inventory fact, and the hops describe the boundary rather than one run."}
            </span>
          </div>
        </Section>

        {/* 3 — an envelope, not a payload. */}
        <Section label="3 · Evidence">
          <div className="p-3 space-y-3">
            <RedactedWitness witness={event.witness} />

            <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-start gap-3 flex-wrap">
                <button
                  disabled
                  title="Requires the security:payload:read scope"
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-600 border border-dashed border-zinc-700 rounded-md px-2 py-1 cursor-not-allowed"
                >
                  <Lock className="w-3 h-3" /> Reveal payload
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-zinc-500 leading-relaxed">
                    Disabled. Reveal is a control, not a convenience:
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {[
                      "requires the security:payload:read scope, which this session does not hold",
                      "requires a typed reason, recorded with the actor and the timestamp",
                      "writes a security_event_actions row that renders on this artifact — chain of custody is visible on the page, not in a log nobody reads",
                      "org payload_retention is summary_only, so no raw blob was retained for this event to reveal",
                    ].map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <span className="text-zinc-700 font-mono text-[11px] leading-relaxed">·</span>
                        <span className="text-[11.5px] text-zinc-500 leading-relaxed">{line}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11.5px] text-zinc-600 leading-relaxed mt-2">
                    Payload text never enters Slack, email, a PR body, or an RCA summary. A working
                    exploit pasted into a 400-person channel turns a detection product into a
                    distribution channel.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* 4 — including "nothing", which is what makes every other block credible. */}
        <Section label="4 · What the system did">
          <div className="p-3">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <OutcomeChip outcome={event.outcome} />
              <span className="text-[12.5px] text-zinc-300">{OUTCOME_SENTENCE[event.outcome]}</span>
              {!event.enforced && (
                <Chip
                  tone="text-amber-300/80 border-amber-500/25 bg-amber-500/[0.05]"
                  title="No control was armed on this path at the time."
                >
                  unenforced
                </Chip>
              )}
              {event.latencyUs !== undefined && (
                <span className="font-mono text-[10.5px] text-zinc-600 tabular-nums">
                  decision in {event.latencyUs}µs
                </span>
              )}
            </div>
            <DefangedText
              text={event.response}
              className="block text-[12.5px] text-zinc-300 leading-relaxed max-w-3xl"
            />
            {event.criticalReason && (
              <p className="text-[11.5px] text-zinc-500 leading-relaxed mt-3 pt-2.5 border-t border-white/[0.06] max-w-3xl">
                <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-zinc-600 mr-2">
                  {REASON_META[event.criticalReason].label}
                </span>
                {REASON_META[event.criticalReason].gloss}
              </p>
            )}
          </div>
        </Section>

        {/* 5 — ranked cuts, each phrased as an edit to the graph. */}
        <Section label="5 · Recommended remediation" count={event.remediation.length}>
          {event.remediation.length === 0 ? (
            /* The product's one empty state: px-4 py-8, centred, mono 12px —
               the same as the queue above and as views.tsx / EvalsView. */
            <p className="px-4 py-8 text-center font-mono text-[12px] text-zinc-600 leading-relaxed">
              No cut is proposed for this event. Nothing in the graph would change: the control held,
              or the finding is a record of something that already ran its course.
            </p>
          ) : (
            <div>
              {[...event.remediation]
                .sort((a, b) => b.deltaScore / b.diffLines - a.deltaScore / a.diffLines)
                .map((r, i) => (
                  <RemediationRow key={r.title} item={r} rank={i + 1} />
                ))}
            </div>
          )}
        </Section>

        {/* 6 — the buyer's own vocabulary, from a reviewed table and never a judge. */}
        <Section label="6 · Standards">
          <div className="p-3 space-y-3">
            <StandardsRow asi={event.asi} owasp={event.owasp} atlas={event.atlas} />
            {rule && (
              <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11.5px] text-zinc-200">
                    {rule.id} v{event.ruleVersion}
                  </span>
                  <span className="text-[12px] text-zinc-400">{rule.name}</span>
                  <ModeChip mode={rule.mode} canaryPct={rule.canaryPct} />
                  <Chip
                    tone={
                      rule.usesModel
                        ? "text-zinc-400 border-dashed border-zinc-600 bg-transparent"
                        : "text-zinc-400 border-white/10 bg-white/[0.03]"
                    }
                    title={
                      rule.usesModel
                        ? "One of only two of seventeen detections that read natural language, and it runs as a second pass on a candidate the graph already selected."
                        : "This detection never reads natural language."
                    }
                  >
                    {rule.usesModel ? "reads natural language" : "no natural language"}
                  </Chip>
                </div>
                <DefangedText
                  text={rule.catches}
                  className="block text-[11.5px] text-zinc-500 leading-relaxed"
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-[10.5px] text-zinc-600">
                    signal · <DefangedText text={rule.signal} />
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-wrap font-mono text-[10.5px] text-zinc-600 tabular-nums">
                  {rule.backtest ? (
                    <span
                      title="Measured from analyst dispositions: confirmed / (confirmed + benign). A rule below 0.40 is auto-demoted to monitor."
                    >
                      backtest {rule.backtest.windowDays}d · {rule.backtest.fires} fires ·{" "}
                      {rule.backtest.confirmed} confirmed · precision{" "}
                      {rule.backtest.precision.toFixed(3)}
                    </span>
                  ) : (
                    <span title="This rule has not been backtested, so no precision can be stated.">
                      backtest —
                    </span>
                  )}
                  <span>· firing 7d {rule.firing7d}</span>
                </div>
              </div>
            )}
            <p className="text-[11.5px] text-zinc-600 leading-relaxed max-w-3xl">
              ASI, OWASP and ATLAS identifiers come from a reviewed mapping table keyed by rule id and
              versioned in git with the rule. They are never judge output — emitting{" "}
              <span className="font-mono text-zinc-500">AML.T0051.001</span> from a distributed trace
              is only credible while it is never wrong.
            </p>
          </div>
        </Section>
      </div>
    </>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────

export function SecurityEvents({
  onOpenTrace,
  initialEventId,
}: {
  onOpenTrace: (traceId: string) => void;
  initialEventId?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(initialEventId ?? null);

  // A deep link can arrive after mount — /security/events/SEC-1042 opens here.
  useEffect(() => {
    if (initialEventId) setOpenId(initialEventId);
  }, [initialEventId]);

  const event = openId ? getEvent(openId) : undefined;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6">
        {openId && !event ? (
          <>
            <button
              onClick={() => setOpenId(null)}
              className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300 mb-4"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Events
            </button>
            <p className="rounded-lg border border-white/[0.06] px-4 py-8 text-center font-mono text-[12px] text-zinc-600">
              No event with id {openId}.
            </p>
          </>
        ) : event ? (
          <EventDetail
            event={event}
            onBack={() => setOpenId(null)}
            onOpenEvent={setOpenId}
            onOpenTrace={onOpenTrace}
          />
        ) : (
          <EventList onOpenEvent={setOpenId} />
        )}
      </div>
    </div>
  );
}
