"use client";

/**
 * Trust Boundaries — Overview.
 *
 * The tab a platform lead leaves open. It answers four questions in order:
 * is the machine running (perimeter), what is it worth (score, with its
 * arithmetic printed), where do untrusted bytes actually reach capability
 * (heatmap), and what single cut buys the most back (recommendations).
 *
 * Three construction rules, all inherited from the product's palette contract
 * (`ui.tsx:3-7`) and from §3 of the proposal:
 *
 *  1. NO NUMBER IS AUTHORED HERE. Every figure on this screen is computed from
 *     the fixture — `computeScore`, `countsByClass`, `topRemediations`,
 *     `boundaryEfficacy`, or a reduction over HEATMAP / TRIFECTAS / TREND.
 *     Anything that cannot be computed renders an em dash. A security console
 *     that hardcodes its own metrics has no standing to assert anyone else's.
 *
 *  2. COLOUR IS STATUS. Emerald means blocked — the machine working, never an
 *     alarm. Red appears only where something is participating in a violation:
 *     a red-ringed heatmap cell, an open critical, an `off` boundary. Amber is
 *     warn, and it is what staleness gets.
 *
 *  3. THE SCORE REFUSES TO BE CONFIDENT WHEN THE EVIDENCE IS STALE. The
 *     measurement's commit differs from deployed HEAD, so the whole number
 *     renders at 40% opacity with the commit distance and a re-run. This is the
 *     same stance `009_verification.sql` already takes about PRs, and it is the
 *     product's personality rather than a caveat.
 */

import { useMemo, useState } from "react";
import {
  AS_OF,
  CAPABILITY_GRANTS,
  COVERAGE_BY_SERVICE,
  DETECTIONS,
  EGRESS_DISCIPLINE,
  HEATMAP,
  PERIMETER,
  POSTURE,
  SECURITY_ASSERTIONS,
  SECURITY_EVENTS,
  TREND,
  TRIFECTAS,
  UNTRUSTED_INGRESS,
  boundaryEfficacy,
  computeScore,
  countsByClass,
  heatCellEvidence,
  serviceCoverage,
  topRemediations,
  type RankedRemediation,
} from "@/lib/mock-security";
import type { Capability, HeatCell, PerimeterCell, Trifecta } from "@/lib/security-types";
import { ConfidenceMeter, CopyButton, MonoLabel } from "../ui";
import { CAP_META } from "./trust-ui";
import {
  ArrowRight,
  GitCommit,
  Layers,
  Lock,
  RefreshCw,
  Scissors,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

// ── formatting ────────────────────────────────────────────────────────
//
// Grouping is done by hand rather than with toLocaleString, because the server
// and the browser can disagree on locale and a hydration mismatch on a number
// is exactly the kind of thing this screen must never do.

function fmtInt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Cell-sized: 88 · 340 · 1.9k. The exact value is always available in the caption. */
function fmtCompact(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtPct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/** 2026-08-11T14:31:00Z → 2026.08.11 */
function fmtDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, ".");
}

/** 2026-08-11T14:31:00Z → 14:31Z */
function fmtTime(iso: string): string {
  return `${iso.slice(11, 16)}Z`;
}

/** Elapsed between two ISO stamps, as +1h31m. Used to date the score's blind spot. */
function fmtElapsed(fromIso: string, toIso: string): string {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `+${h}h${String(m).padStart(2, "0")}m` : `+${m}m`;
}

// ── shared bits ───────────────────────────────────────────────────────

/** The 4-up StatTile idiom from `views.tsx:261`, widened to carry a footer. */
function Tile({
  label,
  value,
  sub,
  tone = "text-zinc-100",
  dim = false,
  Icon,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  dim?: boolean;
  Icon: typeof Shield;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] p-4 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-zinc-600" strokeWidth={1.75} />
        <MonoLabel>{label}</MonoLabel>
      </div>
      <p className={`text-[26px] font-light tracking-tight tabular-nums ${tone} ${dim ? "opacity-40" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-zinc-600 mt-0.5">{sub}</p>}
      {children}
    </div>
  );
}

const MODE_TONE: Record<PerimeterCell["mode"], string> = {
  // Emerald is the machine working. Amber is a partial rollout. Zinc is honest
  // observation. Red-outlined is a boundary that is decoration.
  enforce: "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]",
  canary: "text-amber-400 border-amber-500/30 bg-amber-500/[0.07]",
  monitor: "text-zinc-400 border-white/10 bg-white/[0.03]",
  off: "text-red-400 border-red-500/40 bg-transparent",
};

/** The wire under each perimeter cell: continuous where the boundary denies, broken where it watches. */
const WIRE_STYLE: Record<PerimeterCell["mode"], React.CSSProperties> = {
  enforce: { backgroundColor: "rgba(16,185,129,0.55)" },
  canary: {
    backgroundImage:
      "repeating-linear-gradient(90deg, rgba(245,158,11,0.6) 0, rgba(245,158,11,0.6) 9px, rgba(245,158,11,0.12) 9px, rgba(245,158,11,0.12) 13px)",
  },
  monitor: {
    backgroundImage:
      "repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0, rgba(255,255,255,0.16) 3px, transparent 3px, transparent 8px)",
  },
  off: {
    backgroundImage:
      "repeating-linear-gradient(90deg, rgba(239,68,68,0.5) 0, rgba(239,68,68,0.5) 3px, transparent 3px, transparent 8px)",
  },
};

function ModeChip({ mode, canaryPct }: { mode: PerimeterCell["mode"]; canaryPct?: number }) {
  const label = mode === "canary" && canaryPct !== undefined ? `canary ${canaryPct}%` : mode;
  return (
    <span
      className={`inline-flex items-center font-mono text-[9px] tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded border ${MODE_TONE[mode]}`}
    >
      {label}
    </span>
  );
}

/** A clickable event id. Nothing on this screen references an event without opening it. */
function EventLink({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpen(id);
      }}
      className="font-mono text-[10.5px] text-zinc-400 hover:text-zinc-100 border border-white/10 hover:border-white/25 rounded px-1.5 py-0.5 transition-colors"
    >
      {id}
    </button>
  );
}

// ── the perimeter partition ───────────────────────────────────────────
//
// Which detections sit on which boundary. This is a structural mapping, not a
// measurement — it is the partition documented alongside PERIMETER in the
// fixture, restated here so the strip can expand. It is checked against
// `PerimeterCell.detections` at render time and the rule list is suppressed on
// any disagreement, because a console that quietly disagrees with its own
// counts is worse than one that shows fewer of them.

const BOUNDARY_RULES: Record<PerimeterCell["key"], string[]> = {
  SOURCES: ["TB-02", "TB-05", "TB-06", "TB-12", "TB-16"],
  CONTEXT: ["TB-07", "TB-09", "TB-13", "TB-17"],
  EGRESS: ["TB-03", "TB-04", "TB-14"],
  EXECUTE: ["TB-08", "TB-10"],
  CONTAINMENT: ["TB-01", "TB-11", "TB-15"],
};

// ── Row 1: KPI strip ──────────────────────────────────────────────────

function KpiStrip({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [rerunQueued, setRerunQueued] = useState(false);

  const score = useMemo(() => computeScore(POSTURE), []);
  const blocked7d = useMemo(() => countsByClass(7).blocked, []);
  const efficacy = useMemo(() => boundaryEfficacy(7), []);

  // The score is computed at `measuredAt`; anything critical that landed after
  // it is, by construction, not in it. Naming that event is the difference
  // between a stale number and a dishonest one.
  const criticalsAfter = useMemo(
    () =>
      SECURITY_EVENTS.filter(
        (e) => e.eventClass === "critical" && Date.parse(e.timestamp) > Date.parse(POSTURE.measuredAt),
      ).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    [],
  );

  const exercised = TRIFECTAS.filter((t) => t.exercised).length;

  // Provenance coverage's sub-line names its own worst offender rather than
  // asserting an average nobody can act on.
  const worstService = useMemo(
    () =>
      [...COVERAGE_BY_SERVICE].sort((a, b) => serviceCoverage(a) - serviceCoverage(b))[0],
    [],
  );
  const totalSpans = useMemo(() => COVERAGE_BY_SERVICE.reduce((a, s) => a + s.spans, 0), []);

  const stale = POSTURE.commit !== POSTURE.headCommit;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Tile label="Containment score" value={String(score.score)} Icon={Shield} dim={stale}>
        {/* Not MonoLabel: it uppercases, and a commit sha rendered A91F34D is a
            different string from the one an analyst pastes into a terminal. */}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1.5 font-mono text-[10px] tracking-[0.12em] text-zinc-500">
          <span className="whitespace-nowrap">
            MEASURED AT {fmtDate(POSTURE.measuredAt)} {fmtTime(POSTURE.measuredAt)}
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <GitCommit className="w-2.5 h-2.5" strokeWidth={1.75} />
            {POSTURE.commit}
            <CopyButton value={POSTURE.commit} />
          </span>
        </span>

        {stale && (
          <div className="mt-2 pt-2 border-t border-white/[0.06]">
            <p className="font-mono text-[10px] tracking-[0.1em] text-amber-400/90 leading-relaxed">
              UNPROVEN AT HEAD — {POSTURE.commitsSince} COMMIT
              {POSTURE.commitsSince === 1 ? "" : "S"} SINCE LAST RUN
            </p>
            {criticalsAfter.length > 0 && (
              <p className="text-[10.5px] text-zinc-600 mt-1 leading-relaxed">
                {criticalsAfter.length} critical
                {criticalsAfter.length === 1 ? " landed" : "s landed"} after the measurement and{" "}
                {criticalsAfter.length === 1 ? "is" : "are"} not in it:{" "}
                {criticalsAfter.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ", "}
                    <EventLink id={e.id} onOpen={onOpenEvent} />{" "}
                    <span className="font-mono text-[10px] text-zinc-600">
                      {fmtElapsed(POSTURE.measuredAt, e.timestamp)}
                    </span>
                  </span>
                ))}
              </p>
            )}
            {rerunQueued ? (
              <p className="font-mono text-[10px] text-zinc-500 mt-2 leading-relaxed">
                RE-RUN QUEUED AT {POSTURE.headCommit} — this number is replaced when the scan
                completes. Nothing is asserted at HEAD until then.
              </p>
            ) : (
              <button
                onClick={() => setRerunQueued(true)}
                className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-zinc-300 hover:text-zinc-100 border border-white/10 hover:border-white/25 rounded px-2 py-1 transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" strokeWidth={2} />
                RE-RUN AT {POSTURE.headCommit}
              </button>
            )}
          </div>
        )}
      </Tile>

      <Tile
        label="Open trifectas"
        value={String(TRIFECTAS.length)}
        tone="text-red-400"
        Icon={ShieldAlert}
        sub={`${exercised} exercised · ${TRIFECTAS.length - exercised} reachable, never traversed`}
      >
        <p className="text-[10.5px] text-zinc-600 mt-1.5 leading-relaxed">
          Distinct untrusted × private × egress triples reachable in 7d. Moves when the architecture
          changes, not when traffic does.
        </p>
      </Tile>

      <Tile
        label="Blocked (7d)"
        value={fmtInt(blocked7d.occurrences)}
        tone="text-emerald-400"
        Icon={ShieldCheck}
        sub={`${blocked7d.events} campaign${blocked7d.events === 1 ? "" : "s"} · ${fmtInt(blocked7d.occurrences)} occurrences`}
      >
        <p className="text-[10.5px] text-zinc-600 mt-1.5 leading-relaxed">
          Boundary efficacy{" "}
          {efficacy.rate === null ? (
            "—"
          ) : (
            <span className="font-mono text-zinc-400">{fmtPct(efficacy.rate, 1)}</span>
          )}{" "}
          — {fmtInt(efficacy.blocked)} held, {fmtInt(efficacy.succeeded)} got through.
        </p>
      </Tile>

      <Tile
        label="Provenance coverage"
        value={fmtPct(POSTURE.coverage)}
        Icon={Layers}
        sub={`${fmtInt(POSTURE.coverage * totalSpans)} of ${fmtInt(totalSpans)} spans, weighted by tier`}
      >
        {worstService && (
          <p className="text-[10.5px] text-zinc-600 mt-1.5 leading-relaxed">
            Worst: <span className="font-mono text-zinc-400">{worstService.service}</span> at{" "}
            {fmtPct(serviceCoverage(worstService))} carrying{" "}
            {fmtPct(worstService.spans / totalSpans)} of span volume.
          </p>
        )}
      </Tile>
    </div>
  );
}

// ── Row 2: perimeter strip ────────────────────────────────────────────

function PerimeterStrip({
  selected,
  onSelect,
}: {
  selected: PerimeterCell["key"] | null;
  onSelect: (key: PerimeterCell["key"] | null) => void;
}) {
  // "Which boundaries are real and which are decoration" is the whole point of
  // the strip, so the sentence under it is counted, not asserted — and canary is
  // kept separate from enforce, because a rule denying on 5% of traces is not a
  // boundary that holds.
  const enforcing = PERIMETER.filter((c) => c.mode === "enforce").length;
  const canary = PERIMETER.filter((c) => c.mode === "canary").length;
  const observeOnly = PERIMETER.filter((c) => c.mode === "monitor" || c.mode === "off").length;

  const cell = selected ? PERIMETER.find((c) => c.key === selected) ?? null : null;
  const ruleIds = selected ? BOUNDARY_RULES[selected] : [];
  const rules = ruleIds.map((id) => DETECTIONS.find((d) => d.id === id)).filter((d) => d !== undefined);
  // Suppress rather than contradict: if the partition and the declared count
  // disagree, show the count and say why the list is missing.
  const consistent = cell !== null && rules.length === ruleIds.length && rules.length === cell.detections;

  return (
    <div className="rounded-lg bg-[#0f0f11] border border-white/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <MonoLabel>Perimeter</MonoLabel>
        <span className="text-[11px] text-zinc-600">
          {enforcing} enforcing · {canary} canary · {observeOnly} observe only — nothing on an
          observe-only path is denied
        </span>
        {selected && (
          <button
            onClick={() => onSelect(null)}
            className="ml-auto font-mono text-[10px] tracking-[0.08em] text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            CLEAR FILTER
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {PERIMETER.map((c, i) => {
          const isSelected = selected === c.key;
          const dimmed = selected !== null && !isSelected;
          return (
            <button
              key={c.key}
              onClick={() => onSelect(isSelected ? null : c.key)}
              className={`text-left px-3 py-3 border-white/[0.06] transition-colors ${
                i > 0 ? "border-l" : ""
              } ${isSelected ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"} ${dimmed ? "opacity-45" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <MonoLabel className={isSelected ? "text-zinc-300" : ""}>{c.key}</MonoLabel>
                <ModeChip mode={c.mode} canaryPct={c.canaryPct} />
              </div>
              <p className="text-[20px] font-light tabular-nums text-zinc-100 mt-2 leading-none">
                {c.detections}
              </p>
              <p className="text-[10.5px] text-zinc-600 mt-1">
                detection{c.detections === 1 ? "" : "s"}
              </p>
              {/* The wiring, drawn. A solid rule denies on this path; a broken
                  one only watches. Five cells, and you can see at a glance which
                  boundaries are real and which are decoration. */}
              <div className="mt-2 h-[2px] w-full" style={WIRE_STYLE[c.mode]} />
            </button>
          );
        })}
      </div>

      {cell && (
        <div className="border-t border-white/[0.06] bg-white/[0.01]">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06]">
            <MonoLabel>{cell.key} · detections</MonoLabel>
            <span className="text-[11px] text-zinc-600">
              precision is measured from analyst dispositions; a rule auto-demotes to monitor below
              0.40
            </span>
          </div>
          {!consistent ? (
            <p className="px-3 py-3 font-mono text-[11px] text-zinc-500">
              {cell.detections} detections on this boundary. Rule list withheld — the partition does
              not agree with the declared count.
            </p>
          ) : (
            rules.map((d) => (
              <div
                key={d.id}
                className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 border-b border-white/[0.03] last:border-b-0"
              >
                <span className="font-mono text-[11px] text-zinc-300">{d.id}</span>
                <div className="min-w-0">
                  <p className="text-[12.5px] text-zinc-300 truncate">{d.name}</p>
                  <p className="text-[10.5px] text-zinc-600 truncate">{d.catches}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10.5px] text-zinc-500 tabular-nums hidden sm:block">
                    {fmtInt(d.firing7d)} fires / 7d
                  </span>
                  <span className="hidden md:block">
                    {d.backtest ? (
                      <ConfidenceMeter value={d.backtest.precision} />
                    ) : (
                      <span className="font-mono text-[11px] text-zinc-600">no backtest</span>
                    )}
                  </span>
                  <ModeChip mode={d.mode} canaryPct={d.canaryPct} />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Row 3: score breakdown ────────────────────────────────────────────

function TermBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
      <div className="h-full bg-zinc-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ScoreBreakdown({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const score = useMemo(() => computeScore(POSTURE), []);

  // Raw counts behind each term, so a subscore is checkable rather than asserted.
  const detail: Record<"P" | "C" | "L" | "E" | "R", string> = {
    P: `${fmtInt(POSTURE.coverage * COVERAGE_BY_SERVICE.reduce((a, s) => a + s.spans, 0))} of ${fmtInt(
      COVERAGE_BY_SERVICE.reduce((a, s) => a + s.spans, 0),
    )} spans, tier-weighted`,
    C: `${fmtInt(UNTRUSTED_INGRESS.total - UNTRUSTED_INGRESS.reachedSink)} of ${fmtInt(
      UNTRUSTED_INGRESS.total,
    )} untrusted ingress events reached no sink`,
    L: `${CAPABILITY_GRANTS.granted - CAPABILITY_GRANTS.reachableFromUntrusted} of ${
      CAPABILITY_GRANTS.granted
    } granted capabilities unreachable from untrusted taint`,
    E: `${fmtInt(EGRESS_DISCIPLINE.allowlisted)} of ${fmtInt(EGRESS_DISCIPLINE.total)} egress spans to allowlisted hosts`,
    R: `${SECURITY_ASSERTIONS.passing} of ${SECURITY_ASSERTIONS.total} security graph assertions passing at HEAD`,
  };

  // The footer names the event that is halving the score. The count is only
  // trusted when the corpus, filtered as of the measurement instant, agrees
  // with the posture input — otherwise the ids are dropped and the prose stands.
  const openCriticalsAtMeasurement = useMemo(
    () =>
      SECURITY_EVENTS.filter(
        (e) =>
          e.eventClass === "critical" &&
          (e.status === "new" || e.status === "triaging") &&
          Date.parse(e.timestamp) <= Date.parse(POSTURE.measuredAt),
      ),
    [],
  );
  const namedCriticals =
    openCriticalsAtMeasurement.length === POSTURE.openCriticals ? openCriticalsAtMeasurement : [];

  return (
    <div className="rounded-lg bg-[#0f0f11] border border-white/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <MonoLabel>Score breakdown</MonoLabel>
        <span className="text-[11px] text-zinc-600">
          Containment = 100 × P^0.5 × (0.40C + 0.25L + 0.20E + 0.15R) × X. No term counts attacks.
        </span>
      </div>

      {/* P is a multiplier, not an addend, and it is square-rooted — so it gets
          its own row above the weighted sum rather than a weight column. */}
      <div className="px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-zinc-500 w-3">P</span>
          <div className="w-[190px] flex-shrink-0">
            <p className="text-[12.5px] text-zinc-300 leading-tight">Provenance coverage</p>
            <p className="text-[10.5px] text-zinc-600 leading-tight mt-0.5 hidden sm:block">
              {detail.P}
            </p>
          </div>
          <div className="flex-1 min-w-[40px] max-w-[220px]">
            <TermBar value={POSTURE.coverage} />
          </div>
          <span className="font-mono text-[11.5px] text-zinc-300 tabular-nums ml-auto text-right">
            {score.breakdown.coverage}
          </span>
        </div>
        <p className="text-[10.5px] text-zinc-600 mt-1.5 pl-6">
          A multiplier, not an addend, and square-rooted — you cannot score 95 by instrumenting
          nothing, and 0.25→0.50 helps far more than 0.90→1.00.
        </p>
      </div>

      {score.terms.map((t) => {
        const expr = score.breakdown.terms.find((x) => x.key === t.key)?.expr ?? "—";
        return (
          <div key={t.key} className="flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.06]">
            <span className="font-mono text-[11px] text-zinc-500 w-3">{t.key}</span>
            <div className="w-[190px] flex-shrink-0">
              <p className="text-[12.5px] text-zinc-300 leading-tight">{t.label}</p>
              <p className="text-[10.5px] text-zinc-600 leading-tight mt-0.5 hidden sm:block">
                {detail[t.key]}
              </p>
            </div>
            <div className="flex-1 min-w-[40px] max-w-[220px]">
              <TermBar value={t.value} />
            </div>
            <span className="font-mono text-[11.5px] text-zinc-300 tabular-nums ml-auto text-right">
              {expr}
            </span>
          </div>
        );
      })}

      <div className="px-3 py-2.5 space-y-1 border-b border-white/[0.06]">
        {[
          { label: "weighted", expr: score.breakdown.weighted },
          { label: "exposure X", expr: score.breakdown.exposure },
          { label: "total", expr: score.breakdown.total },
          ...(score.breakdown.ceiling ? [{ label: "ceiling", expr: score.breakdown.ceiling }] : []),
        ].map((r) => (
          <div key={r.label} className="flex items-baseline gap-3">
            <MonoLabel className="w-[86px] flex-shrink-0">{r.label}</MonoLabel>
            <span
              className={`font-mono text-[11.5px] tabular-nums ${
                r.label === "total" ? "text-zinc-100" : "text-zinc-400"
              }`}
            >
              {r.expr}
            </span>
          </div>
        ))}
      </div>

      <div className="px-3 py-2.5">
        {score.breakdown.footer ? (
          <p className="text-[12.5px] text-zinc-300 leading-relaxed">
            {score.breakdown.footer}
            {namedCriticals.length > 0 && (
              <>
                {" "}
                <span className="text-zinc-500">The open critical is</span>{" "}
                {namedCriticals.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && " "}
                    <EventLink id={e.id} onOpen={onOpenEvent} />
                  </span>
                ))}
                <span className="text-zinc-500">.</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-[12.5px] text-zinc-500">
            Nothing is dragging the score — no open criticals, no open highs, no ceiling armed.
          </p>
        )}
        {!POSTURE.unenforcedCriticalBoundary && (
          <p className="text-[10.5px] text-zinc-600 mt-1.5 leading-relaxed">
            The hard ceiling of 40 is not armed: every critical-severity boundary has an enforcement
            point on a path that executed in the last 7 days. It is the one cap reserved for a hole
            in the perimeter rather than for having had an incident.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Row 4: trust-boundary heatmap ─────────────────────────────────────

interface HeatSelection {
  source: string;
  sink: Capability;
}

function Heatmap({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [selected, setSelected] = useState<HeatSelection | null>(null);

  const { sources, sinks, byKey, max, violations, total } = useMemo(() => {
    const srcs: string[] = [];
    const snks: Capability[] = [];
    const map = new Map<string, HeatCell>();
    let mx = 0;
    let tot = 0;
    for (const c of HEATMAP) {
      if (!srcs.includes(c.source)) srcs.push(c.source);
      if (!snks.includes(c.sink)) snks.push(c.sink);
      map.set(`${c.source}|${c.sink}`, c);
      mx = Math.max(mx, c.flows);
      tot += c.flows;
    }
    return {
      sources: srcs,
      sinks: snks,
      byKey: map,
      max: mx,
      violations: HEATMAP.filter((c) => c.violatesPolicy),
      total: tot,
    };
  }, []);

  /** Log-scaled so 88 is still legible next to 1,902. Neutral fill only — magnitude is not a status. */
  const alpha = (flows: number) =>
    flows === 0 ? 0 : 0.04 + 0.28 * (Math.log1p(flows) / Math.log1p(max));

  const selectedCell = selected ? byKey.get(`${selected.source}|${selected.sink}`) ?? null : null;
  const selectedEvent = selectedCell ? heatCellEvidence(selectedCell) : null;

  const rowTotal = (s: string) =>
    sinks.reduce((a, k) => a + (byKey.get(`${s}|${k}`)?.flows ?? 0), 0);
  const colTotal = (k: Capability) =>
    sources.reduce((a, s) => a + (byKey.get(`${s}|${k}`)?.flows ?? 0), 0);

  return (
    <div className="rounded-lg bg-[#0f0f11] border border-white/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-wrap">
        <MonoLabel>Trust-boundary heatmap</MonoLabel>
        <span className="text-[11px] text-zinc-600">
          source class × sink capability · {fmtInt(total)} flows in the 7 days to{" "}
          {fmtDate(AS_OF)}
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span
                key={f}
                className="w-3.5 h-3.5 rounded-sm border border-white/[0.06]"
                style={{ backgroundColor: `rgba(228,228,231,${(0.04 + 0.28 * f).toFixed(3)})` }}
              />
            ))}
          </span>
          <span className="font-mono text-[10px] text-zinc-600">0 → {fmtInt(max)} log</span>
          <span className="w-3.5 h-3.5 rounded-sm ring-1 ring-red-500/60 bg-red-500/[0.06]" />
          <span className="font-mono text-[10px] text-zinc-600">policy asserts zero</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[620px] p-3">
          {/* Column heads. READ_PRIVATE and MEMORY_WRITE break on the underscore
              rather than rotating — rotated axis labels are unreadable at 9px. */}
          <div className="grid grid-cols-[128px_repeat(6,minmax(0,1fr))_58px] gap-1 items-end mb-1">
            <span />
            {sinks.map((k) => {
              const dim = selected !== null && selected.sink !== k;
              const parts = CAP_META[k].label.split("_");
              return (
                <div key={k} className={`text-center transition-opacity ${dim ? "opacity-40" : ""}`}>
                  <span className="font-mono text-[9px] tracking-[0.09em] text-zinc-500 leading-tight block">
                    {parts[0]}
                    {parts.length > 1 && (
                      <>
                        <br />
                        {parts.slice(1).join("_")}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
            <MonoLabel className="text-right">Σ</MonoLabel>
          </div>

          {sources.map((s) => {
            const rowDim = selected !== null && selected.source !== s;
            return (
              <div key={s} className="grid grid-cols-[128px_repeat(6,minmax(0,1fr))_58px] gap-1 mb-1">
                <div className={`flex items-center transition-opacity ${rowDim ? "opacity-40" : ""}`}>
                  <span className="font-mono text-[11px] text-zinc-400 truncate" title={s}>
                    {s}
                  </span>
                </div>

                {sinks.map((k) => {
                  const cell = byKey.get(`${s}|${k}`);
                  if (!cell) {
                    return (
                      <div
                        key={k}
                        className="h-9 rounded-sm border border-white/[0.04] flex items-center justify-center font-mono text-[11px] text-zinc-700"
                      >
                        —
                      </div>
                    );
                  }
                  const isSelected = selected?.source === s && selected.sink === k;
                  // A crosshair rather than a spotlight: the selected cell's row
                  // and column stay readable, because the question a selection
                  // raises is "what else does this source reach" and "what else
                  // reaches this capability".
                  const onCross =
                    selected !== null && (selected.source === s || selected.sink === k);
                  const dim = selected !== null && !isSelected && !onCross;
                  const a = alpha(cell.flows);
                  return (
                    <button
                      key={k}
                      onClick={() => setSelected(isSelected ? null : { source: s, sink: k })}
                      title={`${s} → ${CAP_META[k].label} · ${fmtInt(cell.flows)} flows in 7d${
                        cell.violatesPolicy ? " · policy asserts zero" : ""
                      }`}
                      style={{ backgroundColor: `rgba(228,228,231,${a.toFixed(3)})` }}
                      className={`h-9 rounded-sm flex items-center justify-center transition-all ${
                        cell.violatesPolicy
                          ? "ring-1 ring-red-500/55 hover:ring-red-400/80"
                          : "border border-white/[0.05] hover:border-white/20"
                      } ${isSelected ? "outline outline-1 outline-offset-1 outline-white/40" : ""} ${
                        dim ? "opacity-25" : ""
                      }`}
                    >
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          cell.violatesPolicy
                            ? "text-red-300"
                            : cell.flows === 0
                              ? "text-zinc-700"
                              : a > 0.18
                                ? "text-zinc-100"
                                : "text-zinc-400"
                        }`}
                      >
                        {cell.flows === 0 ? "·" : fmtCompact(cell.flows)}
                      </span>
                    </button>
                  );
                })}

                <span
                  className={`flex items-center justify-end font-mono text-[10.5px] text-zinc-600 tabular-nums transition-opacity ${
                    rowDim ? "opacity-40" : ""
                  }`}
                >
                  {fmtCompact(rowTotal(s))}
                </span>
              </div>
            );
          })}

          <div className="grid grid-cols-[128px_repeat(6,minmax(0,1fr))_58px] gap-1 pt-1 border-t border-white/[0.06]">
            <MonoLabel className="flex items-center">Σ</MonoLabel>
            {sinks.map((k) => (
              <span
                key={k}
                className="text-center font-mono text-[10.5px] text-zinc-600 tabular-nums pt-1"
              >
                {fmtCompact(colTotal(k))}
              </span>
            ))}
            <span className="text-right font-mono text-[10.5px] text-zinc-600 tabular-nums pt-1">
              {fmtCompact(total)}
            </span>
          </div>
        </div>
      </div>

      {/* Caption. Fixed minimum height so selecting a cell never shifts the page. */}
      <div className="px-3 py-2.5 border-t border-white/[0.06] bg-white/[0.01] min-h-[54px] flex items-center">
        {selectedCell ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[12px] text-zinc-300">
              {selectedCell.source}
              <span className="text-zinc-600"> ──▶ </span>
              {CAP_META[selectedCell.sink].label}
            </span>
            <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
              {fmtInt(selectedCell.flows)} flows / 7d
            </span>
            {selectedCell.violatesPolicy ? (
              <>
                <span className="inline-flex items-center font-mono text-[10px] tracking-[0.08em] px-1.5 py-0.5 rounded border text-red-400 border-red-500/30 bg-red-500/[0.1]">
                  declared expected-flow policy asserts zero
                </span>
                {selectedEvent ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                    evidence <EventLink id={selectedEvent} onOpen={onOpenEvent} />
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-600">evidence —</span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-zinc-600">
                Within the declared expected-flow policy. Counted, not alerted.
              </span>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            {violations.length} of {HEATMAP.length} cells carry flows a declared expected-flow policy
            asserts should be zero. Select one to see the event behind it — every red ring resolves to
            a real incident, or it would not be drawn.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Row 5: open trifectas ─────────────────────────────────────────────

function TrifectaRow({
  trifecta,
  eventId,
  sharedWith,
  onOpenEvent,
}: {
  trifecta: Trifecta;
  eventId: string | null;
  sharedWith: { trifectaId: string; eventId: string } | null;
  onOpenEvent: (id: string) => void;
}) {
  const legs: { label: string; value: string; Icon: typeof Lock }[] = [
    { label: "UNTRUSTED", value: trifecta.untrustedSource, Icon: ShieldAlert },
    { label: "PRIVATE", value: trifecta.privateSource, Icon: Lock },
    { label: "EGRESS", value: trifecta.egressSink, Icon: ArrowRight },
  ];

  return (
    <div className="px-3 py-3 border-b border-white/[0.06] last:border-b-0">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-mono text-[11px] text-zinc-300">{trifecta.id}</span>
        <span className="font-mono text-[11px] text-zinc-500">{trifecta.agent}</span>
        {trifecta.exercised ? (
          <span className="inline-flex items-center font-mono text-[9px] tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded border text-red-400 border-red-500/30 bg-red-500/[0.1]">
            EXERCISED
          </span>
        ) : (
          <span className="inline-flex items-center font-mono text-[9px] tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded border text-zinc-400 border-white/10 bg-white/[0.03]">
            REACHABLE, NEVER TRAVERSED
          </span>
        )}
        <span className="font-mono text-[10.5px] text-zinc-600">
          first seen {fmtDate(trifecta.firstSeen)}
        </span>
        {eventId && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
            evidence <EventLink id={eventId} onOpen={onOpenEvent} />
          </span>
        )}
      </div>

      {/* The triple, as a path rather than three fields. Untrusted carries the
          hatch; nothing here is red unless it was actually exercised. */}
      <div className="overflow-x-auto">
        <div className="inline-flex items-stretch gap-1.5 min-w-max whitespace-nowrap">
          {legs.map((leg, i) => (
            <div key={leg.label} className="inline-flex items-stretch gap-1.5">
              {i > 0 && (
                <span aria-hidden className="self-center font-mono text-[11px] text-zinc-700 px-0.5">
                  ──▶
                </span>
              )}
              <div
                style={
                  i === 0
                    ? {
                        backgroundImage:
                          "repeating-linear-gradient(45deg, rgba(245,158,11,0.16) 0, rgba(245,158,11,0.16) 1px, transparent 1px, transparent 4px)",
                      }
                    : undefined
                }
                className={`px-2 py-1.5 rounded ${
                  i === 0
                    ? "bg-amber-500/[0.07] border border-amber-500/30"
                    : i === 2 && trifecta.exercised
                      ? "border border-red-500/40 bg-red-500/[0.08]"
                      : "bg-zinc-900 border border-dashed border-zinc-700"
                }`}
              >
                <span
                  className={`block font-mono text-[9px] tracking-[0.1em] font-semibold ${
                    i === 0
                      ? "text-amber-200/90"
                      : i === 2 && trifecta.exercised
                        ? "text-red-300/90"
                        : "text-zinc-500"
                  }`}
                >
                  {leg.label}
                </span>
                <span className="block font-mono text-[11px] text-zinc-300 mt-0.5">{leg.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 mt-2">
        <Scissors className="w-3 h-3 text-zinc-600 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
        <p className="text-[12px] text-zinc-400 leading-relaxed">
          <span className="text-zinc-200">{trifecta.remediation.title}</span>{" "}
          <span className="font-mono text-[11px] text-zinc-500">
            +{trifecta.remediation.deltaScore} · {trifecta.remediation.diffLines} lines
          </span>
          {sharedWith && (
            <>
              {" "}
              <span className="text-zinc-600">
                — the same cut closes {sharedWith.trifectaId}, evidenced at
              </span>{" "}
              <EventLink id={sharedWith.eventId} onOpen={onOpenEvent} />
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function OpenTrifectas({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  // A trifecta is linked to the event that evidences it by the cut they share:
  // the event carrying the same remediation, on the same agent, newest first.
  // Only exercised trifectas get an evidence link — an unexercised one is
  // exposure, and pointing it at somebody else's incident would be a fabrication.
  const links = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of TRIFECTAS) {
      if (!t.exercised) continue;
      const ev = SECURITY_EVENTS.filter(
        (e) => e.agent === t.agent && e.remediation.some((r) => r.title === t.remediation.title),
      ).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
      if (ev) m.set(t.id, ev.id);
    }
    return m;
  }, []);

  const totalDelta = TRIFECTAS.reduce((a, t) => a + t.remediation.deltaScore, 0);
  const distinctCuts = new Set(TRIFECTAS.map((t) => t.remediation.title)).size;

  return (
    <div className="rounded-lg bg-[#0f0f11] border border-white/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <MonoLabel>Open trifectas</MonoLabel>
        <span className="text-[11px] text-zinc-600">
          {TRIFECTAS.length} reachable triples closed by {distinctCuts} distinct cut
          {distinctCuts === 1 ? "" : "s"} · each one has a name and a PR
        </span>
      </div>

      {TRIFECTAS.map((t) => {
        // An unexercised trifecta still borrows the evidence of whichever
        // exercised trifecta shares its cut — true by construction, and the
        // reason "closes 2 of 3" is a sentence anyone can check.
        const shared =
          !t.exercised
            ? (() => {
                const sibling = TRIFECTAS.find(
                  (o) => o.id !== t.id && o.exercised && o.remediation.title === t.remediation.title,
                );
                const evId = sibling ? links.get(sibling.id) : undefined;
                return sibling && evId ? { trifectaId: sibling.id, eventId: evId } : null;
              })()
            : null;
        return (
          <TrifectaRow
            key={t.id}
            trifecta={t}
            eventId={links.get(t.id) ?? null}
            sharedWith={shared}
            onOpenEvent={onOpenEvent}
          />
        );
      })}

      <div className="px-3 py-2 border-t border-white/[0.06] bg-white/[0.01]">
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Closing all three recovers {totalDelta} points of containment. Trifecta exposure counts
          architecture, not alerts — it does not move when the attacker gets busier.
        </p>
      </div>
    </div>
  );
}

// ── Row 6: recommended improvements ───────────────────────────────────

const ACTION_LABEL: Record<RankedRemediation["action"], string> = {
  open_pr: "Open PR",
  open_registry: "Open registry",
  copy_snippet: "Copy snippet",
  rotate_credential: "Rotate credential",
  arm_rule: "Arm rule",
};

function Recommendations({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const ranked = useMemo(() => topRemediations(4), []);
  const [acked, setAcked] = useState<string | null>(null);

  const totalDelta = ranked.reduce((a, r) => a + r.deltaScore, 0);
  const totalLines = ranked.reduce((a, r) => a + r.diffLines, 0);
  const score = useMemo(() => computeScore(POSTURE), []);

  return (
    <div className="rounded-lg bg-[#0f0f11] border border-white/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-wrap">
        <MonoLabel>Recommended improvements</MonoLabel>
        <span className="text-[11px] text-zinc-600">
          ranked by score recovered per line changed · every one is a cut, never advice
        </span>
        <span className="ml-auto font-mono text-[11px] text-zinc-500 tabular-nums">
          +{totalDelta} across {totalLines} lines
        </span>
      </div>

      {ranked.length === 0 && (
        <p className="px-3 py-6 text-center font-mono text-[12px] text-zinc-600">
          No open event is asking for a cut.
        </p>
      )}

      {ranked.map((r) => (
        <div key={r.title} className="px-3 py-3 border-b border-white/[0.06] last:border-b-0">
          <div className="flex items-start gap-3">
            <span className="font-mono text-[15px] text-zinc-100 tabular-nums w-9 flex-shrink-0 leading-tight">
              +{r.deltaScore}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] text-zinc-200">{r.title}</span>
                <span className="font-mono text-[10.5px] text-zinc-600 tabular-nums">
                  {r.deltaScore} pts / {r.diffLines} lines = {r.leverage.toFixed(2)} per line
                </span>
              </div>
              <p className="text-[12px] text-zinc-500 leading-relaxed mt-1">{r.detail}</p>
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                <MonoLabel>asked for by</MonoLabel>
                {r.eventIds.map((id) => (
                  <EventLink key={id} id={id} onOpen={onOpenEvent} />
                ))}
              </div>
              {acked === r.title && (
                <p className="font-mono text-[10.5px] text-zinc-500 mt-2 leading-relaxed">
                  QUEUED — the diff, the verification run and the score delta are prepared on the
                  event that asked for it.
                </p>
              )}
            </div>
            <button
              onClick={() => setAcked(acked === r.title ? null : r.title)}
              className="flex-shrink-0 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-zinc-300 hover:text-zinc-100 border border-white/10 hover:border-white/25 rounded px-2 py-1 transition-colors"
            >
              {ACTION_LABEL[r.action]}
              <ArrowRight className="w-2.5 h-2.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      ))}

      {ranked.length > 0 && (
        <div className="px-3 py-2 border-t border-white/[0.06] bg-white/[0.01]">
          <p className="text-[11px] text-zinc-600 leading-relaxed">
            Landing all four moves coverage, containment, least privilege and the registry at once —
            the score is {score.score} today and each row states its own exact recovery rather than
            an estimate.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Row 7: 30-day trend ───────────────────────────────────────────────
//
// Three series, drawn as inline SVG because the CSP blocks CDNs and this needs
// no library.
//
// `detected` peaks two orders of magnitude above the other two, so putting all
// three on one axis would flatten the series that matters into the baseline.
// It gets its own band and its own printed maximum. Below it, blocked and
// succeeded share ONE symmetric axis — blocked upward in emerald (the machine
// working), succeeded downward in red (it got through) — because the asymmetry
// between them is the actual finding, and giving the tiny series its own scale
// to make it look big would be the chart lying on the product's behalf.
//
// The one distortion: a non-zero day is floored at 3px so a single successful
// exfiltration can never render as nothing. That floor is stated in the footer.

const CHART_W = 720;
const CHART_H = 176;
const PAD_L = 38;
const PAD_R = 40;
const AREA_TOP = 14;
const AREA_H = 62;
const MID_Y = 116;
const BAR_H = 30;

function TrendChart() {
  const points = TREND;

  const maxDetected = Math.max(...points.map((p) => p.detected), 1);
  const maxBlocked = Math.max(...points.map((p) => p.blocked), 1);
  const maxSucceeded = Math.max(...points.map((p) => p.succeeded), 1);

  const sumDetected = points.reduce((a, p) => a + p.detected, 0);
  const sumBlocked = points.reduce((a, p) => a + p.blocked, 0);
  const sumSucceeded = points.reduce((a, p) => a + p.succeeded, 0);

  /** One symmetric axis for the pair, so their heights are directly comparable. */
  const maxBar = Math.max(maxBlocked, maxSucceeded);
  const barHeight = (v: number) => (v === 0 ? 0 : Math.max(3, (v / maxBar) * BAR_H));

  const innerW = CHART_W - PAD_L - PAD_R;
  const step = innerW / points.length;
  const x = (i: number) => PAD_L + step * (i + 0.5);
  const yDetected = (v: number) => AREA_TOP + AREA_H - (v / maxDetected) * AREA_H;

  const line = points.map((p, i) => `${x(i).toFixed(1)},${yDetected(p.detected).toFixed(1)}`).join(" ");
  const area = `${PAD_L + step * 0.5},${AREA_TOP + AREA_H} ${line} ${(
    PAD_L +
    innerW -
    step * 0.5
  ).toFixed(1)},${AREA_TOP + AREA_H}`;

  const last = points[points.length - 1];
  const lastX = x(points.length - 1);
  const barW = Math.min(11, step - 4);

  return (
    <div className="rounded-lg bg-[#0f0f11] border border-white/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-wrap">
        <MonoLabel>30-day trend</MonoLabel>
        <span className="text-[11px] text-zinc-600">
          {fmtDate(points[0]?.date ?? "")} → {fmtDate(last?.date ?? "")}
        </span>
        <span className="ml-auto flex items-center gap-3 flex-wrap">
          {[
            { key: "detected", swatch: "bg-zinc-500", sum: sumDetected, peak: maxDetected },
            { key: "blocked", swatch: "bg-emerald-500/70", sum: sumBlocked, peak: maxBlocked },
            { key: "succeeded", swatch: "bg-red-500/80", sum: sumSucceeded, peak: maxSucceeded },
          ].map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-sm ${s.swatch}`} />
              <span className="font-mono text-[10px] tracking-[0.06em] text-zinc-500">
                {s.key} {fmtInt(s.sum)}
              </span>
            </span>
          ))}
        </span>
      </div>

      <div className="p-2">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full h-auto"
          role="img"
          aria-label={`Detected, blocked and succeeded security events over the 30 days to ${last?.date ?? ""}`}
        >
          {/* Faint grid. Horizontal quartiles on the detected axis, a weekly rule
              on the time axis — enough to read a level off, quiet enough to ignore. */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={PAD_L}
              x2={CHART_W - PAD_R}
              y1={AREA_TOP + AREA_H - f * AREA_H}
              y2={AREA_TOP + AREA_H - f * AREA_H}
              stroke="rgba(255,255,255,0.045)"
              strokeWidth={1}
            />
          ))}
          {points.map((p, i) =>
            i % 7 === 0 ? (
              <line
                key={p.date}
                x1={x(i)}
                x2={x(i)}
                y1={AREA_TOP}
                y2={MID_Y + BAR_H + 4}
                stroke="rgba(255,255,255,0.035)"
                strokeWidth={1}
              />
            ) : null,
          )}

          {/* Detected — area + line, neutral. Volume is not a status. */}
          <polygon points={area} fill="rgba(161,161,170,0.10)" />
          <polyline points={line} fill="none" stroke="rgba(161,161,170,0.75)" strokeWidth={1.25} />

          {/* Blocked upward, succeeded downward, off one shared baseline. */}
          <line
            x1={PAD_L}
            x2={CHART_W - PAD_R}
            y1={MID_Y}
            y2={MID_Y}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={1}
          />
          {points.map((p, i) => {
            const h = barHeight(p.blocked);
            return h === 0 ? null : (
              <rect
                key={`b-${p.date}`}
                x={x(i) - barW / 2}
                y={MID_Y - h}
                width={barW}
                height={h}
                rx={1}
                fill={i === points.length - 1 ? "rgba(52,211,153,0.95)" : "rgba(16,185,129,0.55)"}
              />
            );
          })}
          {points.map((p, i) => {
            const h = barHeight(p.succeeded);
            return h === 0 ? null : (
              <rect
                key={`s-${p.date}`}
                x={x(i) - barW / 2}
                y={MID_Y}
                width={barW}
                height={h}
                rx={1}
                fill={i === points.length - 1 ? "rgba(248,113,113,0.95)" : "rgba(239,68,68,0.6)"}
              />
            );
          })}

          {/* Emphasised endpoint: today's detected level, called out by name. */}
          {last && (
            <>
              <circle cx={lastX} cy={yDetected(last.detected)} r={3} fill="#e4e4e7" />
              <text
                x={CHART_W - PAD_R + 4}
                y={yDetected(last.detected) + 3.5}
                fill="#e4e4e7"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {fmtInt(last.detected)}
              </text>
              <text
                x={CHART_W - PAD_R + 4}
                y={MID_Y - 4}
                fill="rgba(52,211,153,0.95)"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {fmtInt(last.blocked)}
              </text>
              <text
                x={CHART_W - PAD_R + 4}
                y={MID_Y + 11}
                fill="rgba(248,113,113,0.95)"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {fmtInt(last.succeeded)}
              </text>
            </>
          )}

          {/* Axis maxima, printed so the two scales can never be confused. */}
          <text x={4} y={AREA_TOP + 4} fill="#52525b" fontSize={9} fontFamily="ui-monospace, monospace">
            {fmtInt(maxDetected)}
          </text>
          <text x={4} y={AREA_TOP + AREA_H} fill="#52525b" fontSize={9} fontFamily="ui-monospace, monospace">
            0
          </text>
          <text x={4} y={MID_Y + 3} fill="#52525b" fontSize={9} fontFamily="ui-monospace, monospace">
            ±{fmtInt(maxBar)}
          </text>

          {/* Dates every 7 days plus the endpoint — the weekly tick is dropped
              when it would collide with the endpoint label. */}
          {points.map((p, i) =>
            (i % 7 === 0 && i < points.length - 2) || i === points.length - 1 ? (
              <text
                key={`t-${p.date}`}
                x={x(i)}
                y={CHART_H - 4}
                fill="#52525b"
                fontSize={9}
                fontFamily="ui-monospace, monospace"
                textAnchor={i === points.length - 1 ? "end" : "middle"}
              >
                {p.date.slice(5).replace("-", ".")}
              </text>
            ) : null,
          )}

          {/* One hit target per day, carrying a native tooltip. No library, no JS. */}
          {points.map((p, i) => (
            <rect
              key={`h-${p.date}`}
              x={x(i) - step / 2}
              y={AREA_TOP}
              width={step}
              height={MID_Y + BAR_H - AREA_TOP}
              fill="transparent"
              className="hover:fill-white/[0.03]"
            >
              <title>
                {`${p.date} · detected ${fmtInt(p.detected)} · blocked ${fmtInt(p.blocked)} · succeeded ${fmtInt(p.succeeded)} · score ${p.score}`}
              </title>
            </rect>
          ))}
        </svg>
      </div>

      <div className="px-3 py-2 border-t border-white/[0.06] bg-white/[0.01]">
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Detected has its own axis, peaking at {fmtInt(maxDetected)} a day; blocked and succeeded
          share one symmetric axis of ±{fmtInt(maxBar)}, so their heights compare directly —{" "}
          {fmtInt(sumBlocked)} held against {fmtInt(sumSucceeded)} through in 30 days. A non-zero day
          is floored at 3px so a single successful exfiltration never renders as nothing. Detected
          volume is neutral: it is the size of the corpus, not the size of the problem. The healthy
          shape is a wide grey base, a steady emerald band, and nothing below the line.
        </p>
      </div>
    </div>
  );
}

// ── The view ──────────────────────────────────────────────────────────

export function SecurityOverview({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [boundary, setBoundary] = useState<PerimeterCell["key"] | null>(null);

  return (
    <div className="space-y-3">
      <KpiStrip onOpenEvent={onOpenEvent} />
      <PerimeterStrip selected={boundary} onSelect={setBoundary} />
      <ScoreBreakdown onOpenEvent={onOpenEvent} />
      <Heatmap onOpenEvent={onOpenEvent} />
      <OpenTrifectas onOpenEvent={onOpenEvent} />
      <Recommendations onOpenEvent={onOpenEvent} />
      <TrendChart />
    </div>
  );
}

export default SecurityOverview;
