"use client";

/**
 * LandingCapabilityTour — five capabilities, five real artifacts, one page.
 *
 * The landing page states its argument several times and demonstrates it once.
 * This component demonstrates it five times and states nothing: every string and
 * every number below is read out of the same fixture modules the product runs on
 * (mock-observability, mock-security, mock-evals). Nothing here is authored copy
 * about the product — it is the product's own data, rendered small.
 *
 * Four of the five panels are the SAME incident (PD-8890, the featured checkout
 * outage) walked end to end — failing span → judge verdict → root cause and fix
 * PR → the golden case that now guards it. That is the loop, on one trace, in
 * one component. The fifth panel is a security finding on a different trace and
 * says so; the security corpus has no event on the checkout trace and we do not
 * pretend otherwise.
 *
 * Bundle: adds no new fixture module to the landing chunk. page.tsx already
 * imports mock-evals, mock-security and mock-data, and LandingTraceDemo already
 * pulls mock-observability, so the data here is free — only this file's own JSX
 * is new. Icons reuse KIND_META from product/ui, already in the chunk.
 */

import { useCallback, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, X } from "lucide-react";
import { FEATURED_INCIDENT_ID } from "@/lib/mock-data";
import { getAllDemos, type DemoSpan } from "@/lib/mock-observability";
import { getEvent, explorerIncidentFor } from "@/lib/mock-security";
import { getDatasets, getRuns } from "@/lib/mock-evals";
import { KIND_META, STATUS_META, fmtDuration, fmtTokens } from "./product/ui";

/**
 * The security finding shown in panel 03.
 *
 * SEC-1055 rather than SEC-1043 for two reasons: the landing's Benefit 03
 * section already renders SEC-1043's flow, and SEC-1055's trace is one of the
 * two the explorer has a page for (see EXPLORER_TRACES), so this panel can link
 * a security event straight into the trace view — the "two surfaces, one
 * dataset" claim, provable in a click. Swap the id here to move the panel.
 */
const TOUR_EVENT_ID = "SEC-1055";

export type TourTabKey = "observe" | "detect" | "secure" | "heal" | "improve";
type TabKey = TourTabKey;

const TABS: { key: TabKey; num: string; label: string; hint: string }[] = [
  { key: "observe", num: "01", label: "Observe", hint: "The failing span" },
  { key: "detect", num: "02", label: "Detect", hint: "The judge's verdict" },
  { key: "secure", num: "03", label: "Secure", hint: "A boundary with no guard" },
  { key: "heal", num: "04", label: "Heal", hint: "Root cause and the fix" },
  { key: "improve", num: "05", label: "Improve", hint: "The regression test" },
];

/** Root → target ancestry, cycle-safe. The chain you would screenshot to explain a failure. */
function pathToSpan(spans: DemoSpan[], targetId: string): DemoSpan[] {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const out: DemoSpan[] = [];
  const seen = new Set<string>();
  let cur = byId.get(targetId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Trust vocabulary, shortened for a small surface. Tone stays inside the
 *  product's palette: zinc for trusted, amber for untrusted, red for the hop
 *  that crossed. No new hues. */
const ORIGIN_SHORT: Record<string, { label: string; tone: string }> = {
  TRUSTED_OPERATOR: { label: "OPERATOR", tone: "text-zinc-400 border-white/[0.10]" },
  TRUSTED_USER: { label: "USER", tone: "text-zinc-400 border-white/[0.10]" },
  SEMI_TRUSTED_INTERNAL: { label: "INTERNAL", tone: "text-zinc-400 border-white/[0.10]" },
  UNTRUSTED_EXTERNAL: { label: "UNTRUSTED", tone: "text-amber-300/90 border-amber-400/25" },
  UNTRUSTED_AGENT: { label: "AGENT OUT", tone: "text-amber-300/90 border-amber-400/25" },
  UNKNOWN: { label: "UNRESOLVED", tone: "text-zinc-500 border-white/[0.08]" },
};

const PANEL = "rounded-lg border border-white/[0.07] bg-white/[0.015]";
const EYEBROW = "font-mono text-[10px] tracking-[0.14em] uppercase text-white/35";
const LABEL = "font-mono text-[9px] tracking-[0.16em] uppercase text-white/30";

function Chip({ children, tone = "text-white/50 border-white/[0.10]" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] uppercase border rounded px-1.5 py-0.5 ${tone}`}>
      {children}
    </span>
  );
}

/** A labelled percentage bar. Value is always printed next to it — the bar is
 *  the redundant channel, never the only one. */
function Meter({ value, tone = "bg-indigo-400/70" }: { value: number; tone?: string }) {
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative block w-16 h-1 rounded-full bg-white/[0.08] overflow-hidden">
        <span className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[11px] text-white/70 tabular-nums">{pct}%</span>
    </span>
  );
}

function StatRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 pt-3 mt-3 border-t border-white/[0.06]">
      {items.map((s) => (
        <div key={s.label}>
          <div className={LABEL}>{s.label}</div>
          <div className="font-mono text-[12px] text-white/75 tabular-nums mt-0.5">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function PanelHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <div className={`${EYEBROW} break-all`}>{eyebrow}</div>
      <h3 className="mt-1.5 text-[17px] sm:text-[19px] font-light tracking-[-0.01em] text-white/90 leading-snug">{title}</h3>
    </div>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-white/50 border border-white/[0.10] rounded-full px-3.5 py-1.5 hover:border-white/30 hover:text-white/85 transition-colors duration-200"
    >
      {children}
      <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
    </Link>
  );
}

export function LandingCapabilityTour({
  id = "capabilities",
  initialTab = "observe",
}: {
  id?: string;
  /** Which capability opens first. Handy if a nav anchor should land on one. */
  initialTab?: TourTabKey;
}) {
  const reduced = useReducedMotion();
  const uid = useId();
  const [active, setActive] = useState<TabKey>(initialTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // ── Fixture reads. getAllDemos() returns IncidentDemo, which guarantees
  //    finding / rootCause / fixPr — no optional-chaining theatre below.
  const demo = useMemo(() => {
    const all = getAllDemos();
    return all.find((d) => d.incidentId === FEATURED_INCIDENT_ID) ?? all[0]!;
  }, []);

  const chain = useMemo(() => pathToSpan(demo.spans, demo.finding.triggeredSpanId), [demo]);
  const failing = chain[chain.length - 1] ?? demo.spans[0]!;
  const rootSpan = useMemo(() => demo.spans.find((s) => s.parentId === null), [demo]);

  const event = useMemo(() => getEvent(TOUR_EVENT_ID), []);

  // The golden case promoted from this very incident — derived, not hardcoded.
  const evals = useMemo(() => {
    const dataset = getDatasets().find((d) => d.items.some((i) => i.traceId === FEATURED_INCIDENT_ID));
    if (!dataset) return null;
    const item = dataset.items.find((i) => i.traceId === FEATURED_INCIDENT_ID)!;
    const run = getRuns(dataset.id)[0];
    const result = run?.results.find((r) => r.itemId === item.id);
    return { dataset, item, run, result };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const i = TABS.findIndex((t) => t.key === active);
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = TABS.length - 1;
      if (next < 0) return;
      e.preventDefault();
      setActive(TABS[next]!.key);
      tabRefs.current[next]?.focus();
    },
    [active]
  );

  // Motion is decoration, never the thing that makes content visible. Under
  // prefers-reduced-motion we emit no hidden initial state at all — the markup
  // renders opaque and stays that way, so nothing depends on an animation (or
  // on an IntersectionObserver callback) firing to be readable.
  const fade = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6 },
        transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const },
      };

  const reveal = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 20 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: "-80px" },
        transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <section id={id} className="relative border-b border-white/[0.06] px-4 sm:px-8 py-24">
      <div className="max-w-6xl mx-auto">
        <motion.div {...reveal} className="mb-10 text-center">
          <span className="font-mono text-[11px] tracking-[0.25em] text-cyan-300/70 uppercase">
            [ ONE FAILURE · FIVE SURFACES ]
          </span>
          <h2 className="mt-4 text-[34px] sm:text-[48px] font-light tracking-[-0.03em] text-white leading-tight">
            The whole loop, on one incident
          </h2>
          <p className="mt-3 text-[15px] text-white/55 max-w-2xl mx-auto">
            Every panel is rendered from the fixture the product runs on. Four of them are the
            same trace — {demo.externalId}, a checkout outage — from the span that raised to the
            regression test that now guards it. The fifth is a security finding on a different
            trace, and says so.
          </p>
        </motion.div>

        {/* Tablist — horizontal, scrolls on narrow screens rather than hiding. */}
        <div
          role="tablist"
          aria-label="Causal capabilities"
          onKeyDown={onKeyDown}
          className="flex items-stretch gap-2 overflow-x-auto pb-2 mb-4"
        >
          {TABS.map((t, i) => {
            const on = t.key === active;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                id={`${uid}-tab-${t.key}`}
                aria-selected={on}
                aria-controls={`${uid}-panel-${t.key}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(t.key)}
                className={`flex-shrink-0 text-left rounded-lg border px-3.5 py-2.5 transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/60 ${
                  on
                    ? "border-white/25 bg-white/[0.06]"
                    : "border-white/[0.08] hover:border-white/20 hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-[10px] ${on ? "text-cyan-300/80" : "text-white/30"}`}>{t.num}</span>
                  <span
                    className={`font-mono text-[11px] tracking-[0.14em] uppercase ${
                      on ? "text-white/90" : "text-white/45"
                    }`}
                  >
                    {t.label}
                  </span>
                </div>
                <div className={`mt-0.5 text-[11px] ${on ? "text-white/50" : "text-white/25"}`}>{t.hint}</div>
              </button>
            );
          })}
        </div>

        {/* Panel */}
        <div className="rounded-xl border border-white/10 bg-black overflow-hidden shadow-[0_40px_120px_-40px_rgba(8,145,178,0.22)]">
          <div className="px-4 sm:px-6 py-5 sm:py-6 lg:min-h-[430px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active}
                role="tabpanel"
                id={`${uid}-panel-${active}`}
                aria-labelledby={`${uid}-tab-${active}`}
                tabIndex={0}
                className="focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/40 rounded"
                {...fade}
              >
                {active === "observe" && (
                  <div>
                    <PanelHead
                      eyebrow={`${demo.externalId} · ${demo.service} · trace ${demo.traceId}`}
                      title="The call path that raised, root to failure"
                    />
                    <div className={`${PANEL} p-1.5`}>
                      {chain.map((s, i) => {
                        const meta = KIND_META[s.kind];
                        const Icon = meta.Icon;
                        const isFail = s.id === failing.id;
                        return (
                          <div
                            key={s.id}
                            className={`flex items-center gap-2.5 rounded px-2 py-1.5 ${
                              isFail ? "bg-red-500/[0.07]" : ""
                            }`}
                            style={{ marginLeft: `${i * 14}px` }}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_META[s.status].dot}`} />
                            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${meta.tone}`} />
                            {/* min-w-0 is load-bearing: without it the flex item's
                                automatic min-width is its content width, so a long
                                span name widens the whole page instead of truncating. */}
                            <span className="font-mono text-[11px] sm:text-[12px] text-white/80 truncate min-w-0 flex-1">
                              {s.name}
                            </span>
                            <span className={`${LABEL} hidden sm:inline flex-shrink-0`}>{meta.label}</span>
                            <span className="ml-auto font-mono text-[11px] text-white/40 tabular-nums flex-shrink-0">
                              {fmtDuration(s.durationMs)}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {failing.error && (
                      <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3">
                        <div className={`${LABEL} text-red-300/60`}>Error</div>
                        <p className="mt-1 font-mono text-[11px] leading-relaxed text-red-200/85 break-words">
                          {failing.error}
                        </p>
                        {failing.git && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <Chip tone="text-white/60 border-white/[0.12]">
                              {failing.git.file}:{failing.git.line}
                            </Chip>
                            <Chip tone="text-white/60 border-white/[0.12]">commit {failing.git.commit}</Chip>
                          </div>
                        )}
                      </div>
                    )}

                    <StatRow
                      items={[
                        { label: "spans in trace", value: String(demo.spans.length) },
                        { label: "wall clock", value: rootSpan ? fmtDuration(rootSpan.durationMs) : "—" },
                        { label: "tokens", value: `${fmtTokens(demo.tokensIn)} → ${fmtTokens(demo.tokensOut)}` },
                        { label: "cost", value: `$${demo.cost.toFixed(2)}` },
                        { label: "model", value: demo.model },
                      ]}
                    />
                    <div className="mt-4">
                      <PanelLink href={`/incidents/${demo.incidentId}`}>Walk the full trace</PanelLink>
                    </div>
                  </div>
                )}

                {active === "detect" && (
                  <div>
                    <PanelHead
                      eyebrow={`detector ${demo.finding.detector.replace(/_/g, "-")}-v1 · judge ${demo.finding.judgeModel}`}
                      title={demo.finding.title}
                    />
                    <div className={`${PANEL} p-4`}>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                        <div>
                          <div className={LABEL}>Confidence</div>
                          <div className="mt-1">
                            <Meter value={demo.finding.confidence} />
                          </div>
                        </div>
                        <div>
                          <div className={LABEL}>Severity</div>
                          <div className="mt-1.5">
                            <Chip tone="text-red-300/90 border-red-400/25">{demo.finding.severity}</Chip>
                          </div>
                        </div>
                        <div>
                          <div className={LABEL}>Triggered on</div>
                          <div className="mt-1 font-mono text-[12px] text-white/75">{failing.name}</div>
                        </div>
                        <div>
                          <div className={LABEL}>Alerted via</div>
                          <div className="mt-1.5 flex gap-1.5">
                            {demo.finding.alertedVia.map((a) => (
                              <Chip key={a}>{a}</Chip>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="mt-4 pt-4 border-t border-white/[0.06] text-[13px] leading-relaxed text-white/65">
                        {demo.finding.summary}
                      </p>
                    </div>
                    <p className="mt-3 text-[12px] leading-relaxed text-white/40">
                      An LLM judge scored the trace above and named the failure class. It labels and
                      explains the run — it does not block it.
                    </p>
                    <div className="mt-4">
                      <PanelLink href="/detectors">See every detector</PanelLink>
                    </div>
                  </div>
                )}

                {active === "secure" &&
                  (event ? (
                    <div>
                      <PanelHead
                        eyebrow={`${event.id} · rule ${event.ruleId} v${event.ruleVersion} · ${event.agent} · ${event.environment}`}
                        title={event.title}
                      />
                      <div className={`${PANEL} p-1.5`}>
                        {event.flow.map((n) => {
                          const o = ORIGIN_SHORT[n.origin] ?? ORIGIN_SHORT.UNKNOWN!;
                          return (
                            <div
                              key={n.spanId}
                              className={`flex flex-wrap items-center gap-2 rounded px-2 py-1.5 ${
                                n.violating ? "bg-red-500/[0.07]" : ""
                              }`}
                            >
                              <Chip tone={o.tone}>{o.label}</Chip>
                              <span className="font-mono text-[11px] sm:text-[12px] text-white/80 truncate min-w-0">
                                {n.name}
                              </span>
                              {n.capability !== "NONE" && (
                                <Chip tone={n.violating ? "text-red-300/90 border-red-400/30" : "text-white/50 border-white/[0.10]"}>
                                  {n.capability}
                                </Chip>
                              )}
                              {typeof n.bytes === "number" && (
                                <span className="ml-auto font-mono text-[11px] text-white/35 tabular-nums">
                                  {n.bytes.toLocaleString()} B
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className={`${PANEL} p-3`}>
                          <div className={LABEL}>Witness · {event.witness.kind}</div>
                          <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">{event.witness.summary}</p>
                        </div>
                        <div className={`${PANEL} p-3`}>
                          <div className={LABEL}>Response</div>
                          <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">{event.response}</p>
                        </div>
                      </div>

                      <StatRow
                        items={[
                          { label: "priority", value: String(event.priority) },
                          { label: "outcome", value: event.outcome },
                          { label: "enforced", value: event.enforced ? "yes" : "no" },
                          { label: "evidence", value: event.evidence },
                          { label: "maps to", value: [...event.asi, ...event.owasp].join(" · ") || "—" },
                        ]}
                      />
                      <p className="mt-3 text-[12px] leading-relaxed text-white/40">
                        Causal labels the origin and capability of every hop and says when a declared
                        boundary has no enforcement point on the path. It detects and explains
                        crossings — it does not block them.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <PanelLink href="/security">Open the security console</PanelLink>
                        {explorerIncidentFor(event.traceId) && (
                          <PanelLink href={`/incidents/${explorerIncidentFor(event.traceId)}`}>
                            Same trace, in the explorer
                          </PanelLink>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-white/45">No security event resolved for {TOUR_EVENT_ID}.</p>
                  ))}

                {active === "heal" && (
                  <div>
                    <PanelHead
                      eyebrow={`root cause · ${demo.rootCause.hopsUpstream} hops upstream · commit ${demo.rootCause.commit} · ${demo.rootCause.author}`}
                      title={demo.rootCause.summary}
                    />
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className={`${PANEL} p-3.5`}>
                        <p className="text-[12.5px] leading-relaxed text-white/65">{demo.rootCause.explanation}</p>
                        <div className="mt-3 pt-3 border-t border-white/[0.06]">
                          <div className={LABEL}>Counterfactual</div>
                          <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/70">
                            {demo.rootCause.counterfactual}
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Chip tone="text-white/60 border-white/[0.12]">
                            {demo.rootCause.file}:{demo.rootCause.line}
                          </Chip>
                          <span className="font-mono text-[10px] text-white/35">confidence</span>
                          <Meter value={demo.rootCause.confidence} />
                        </div>
                      </div>

                      <div className={`${PANEL} p-3.5`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12px] text-white/85">#{demo.fixPr.number}</span>
                          <Chip tone={demo.fixPr.status === "verified" ? "text-emerald-300/90 border-emerald-400/25" : "text-white/50 border-white/[0.10]"}>
                            {demo.fixPr.status}
                          </Chip>
                          <span className="font-mono text-[10px] text-emerald-400/80 tabular-nums">+{demo.fixPr.additions}</span>
                          <span className="font-mono text-[10px] text-red-400/80 tabular-nums">−{demo.fixPr.deletions}</span>
                          <span className="font-mono text-[10px] text-white/35">
                            {demo.fixPr.filesChanged} file{demo.fixPr.filesChanged === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="mt-1.5 font-mono text-[11px] text-white/45 break-all">
                          {demo.fixPr.branch} → {demo.fixPr.base}
                        </div>
                        <div className="mt-3 rounded border border-white/[0.06] bg-black/40 overflow-x-auto">
                          {demo.fixPr.diff.map((l, i) => (
                            <div
                              key={i}
                              className={`font-mono text-[10.5px] leading-[1.7] whitespace-pre px-2 ${
                                l.kind === "add"
                                  ? "text-emerald-300/85 bg-emerald-500/[0.06]"
                                  : l.kind === "del"
                                    ? "text-red-300/85 bg-red-500/[0.06]"
                                    : l.kind === "meta"
                                      ? "text-indigo-300/60"
                                      : "text-white/35"
                              }`}
                            >
                              {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
                              {l.text}
                            </div>
                          ))}
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {demo.fixPr.checks.map((c) => (
                            <Chip
                              key={c.name}
                              tone={c.status === "pass" ? "text-emerald-300/85 border-emerald-400/25" : "text-white/50 border-white/[0.10]"}
                            >
                              {c.status === "pass" ? <Check className="w-2.5 h-2.5" /> : null}
                              {c.name}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <PanelLink href={`/incidents/${demo.incidentId}/postmortem`}>Read the post-mortem</PanelLink>
                      <PanelLink href={`/incidents/${demo.incidentId}/replay`}>Replay the counterfactual</PanelLink>
                    </div>
                  </div>
                )}

                {active === "improve" &&
                  (evals ? (
                    <div>
                      <PanelHead
                        eyebrow={`${evals.dataset.name} · case ${evals.item.id} · promoted from ${evals.item.fromFinding}`}
                        title={evals.item.title}
                      />
                      <div className={`${PANEL} divide-y divide-white/[0.05]`}>
                        {evals.item.assertions.map((a) => {
                          const res = evals.result?.assertionResults.find((r) => r.id === a.id);
                          return (
                            <div key={a.id} className="flex items-start gap-2.5 p-2.5">
                              {res ? (
                                res.passed ? (
                                  <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-400/80" />
                                ) : (
                                  <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-400/80" />
                                )
                              ) : (
                                <span className="w-3.5 h-3.5 flex-shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Chip>{a.kind.replace(/_/g, " ")}</Chip>
                                  <span className="font-mono text-[10.5px] text-white/45 break-all">{a.target}</span>
                                </div>
                                {res && (
                                  <p className="mt-1 text-[12px] leading-relaxed text-white/60">{res.detail}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={LABEL}>By release</span>
                        {evals.item.history.map((h) => (
                          <span
                            key={h.release}
                            className={`inline-flex items-center gap-1.5 font-mono text-[10px] rounded border px-2 py-1 ${
                              h.passed
                                ? "text-emerald-300/85 border-emerald-400/25 bg-emerald-500/[0.05]"
                                : "text-red-300/85 border-red-400/25 bg-red-500/[0.05]"
                            }`}
                          >
                            {h.passed ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                            {h.release}
                          </span>
                        ))}
                      </div>

                      {evals.run && (
                        <StatRow
                          items={[
                            { label: "latest run", value: `${evals.run.passed} of ${evals.run.total} passed` },
                            { label: "release", value: evals.run.release },
                            { label: "commit", value: evals.run.commit },
                            { label: "judge", value: evals.run.judgeModel },
                            { label: "assertions on this case", value: String(evals.item.assertions.length) },
                          ]}
                        />
                      )}
                      <div className="mt-4">
                        <PanelLink href="/evals">Open the eval sets</PanelLink>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-white/45">No golden case is linked to this trace.</p>
                  ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
