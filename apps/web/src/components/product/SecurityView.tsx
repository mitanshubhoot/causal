"use client";

/**
 * Trust Boundaries — the shell.
 *
 * Three tabs over one corpus: Overview (posture), Events (triage), Flow Map
 * (the provenance graph). They are tabs rather than routes because they are
 * three lenses on the SAME incident, and the shell's job is to keep that
 * incident pinned as you move between them.
 *
 * That pin is the only state this file owns beyond the tab:
 *
 *   focusId    the incident the console is currently pointed at
 *   eventReq   an explicit "open this in the Events tab" request, carrying a
 *              nonce — `SecurityEvents` takes `initialEventId` and seeds its own
 *              state from it, so re-requesting the SAME id has to remount it
 *   flowId     what the Flow Map is drawing
 *
 * Clicking a finding on the Overview arms all three: the Events tab opens the
 * incident, the Flow Map is loaded with it, and the header carries it as the
 * focus chip with buttons into either tab. Selecting in the Flow Map's picker
 * moves the focus without remounting the Events tab, so a filter set there
 * survives.
 *
 * The three panes stay MOUNTED and are hidden with `display:none` rather than
 * unmounted. Switching tabs must not reset a filter, a scroll position, or a
 * taint selection — three pages pretending to be one product is exactly the
 * failure this shell exists to avoid.
 *
 * No number is authored here. The two figures the shell prints — the corpus
 * size on the Events tab and "n of N" on the Flow Map — are the length of the
 * event array and an index into it.
 */

import { useCallback, useMemo, useState } from "react";
import { Shield, Waypoints, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { SECURITY_EVENTS, getEvent } from "@/lib/mock-security";
import { MonoLabel } from "./ui";
import { SecurityOverview } from "./security/SecurityOverview";
import { SecurityEvents } from "./security/SecurityEvents";
import { FlowMap, FlowMapPicker } from "./security/FlowMap";
import { ClassChip } from "./security/trust-ui";

type Tab = "overview" | "events" | "flow";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "events", label: "Events" },
  { key: "flow", label: "Flow Map" },
];

/**
 * The corpus in the order the Flow Map's own picker renders it — priority
 * descending — so stepping with ‹ › walks the list below rather than some
 * second ordering the user cannot see.
 */
const ORDERED = [...SECURITY_EVENTS].sort((a, b) => b.priority - a.priority);

/**
 * The map opens on the highest-priority incident that actually has a flow to
 * draw. Priority is arithmetic (§2.1), not an adjective, and requiring two hops
 * keeps the default off a single-node inventory fact — a one-node graph is a
 * correct rendering of a control finding but a poor first impression of a
 * dataflow view. Both halves are derived; nothing is hand-picked.
 */
function defaultFlowId(): string {
  return (ORDERED.find((e) => e.flow.length >= 2) ?? ORDERED[0]).id;
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex items-center justify-center w-5 h-5 rounded border border-white/[0.06] text-zinc-500 transition-colors enabled:hover:text-zinc-200 enabled:hover:border-white/15 disabled:text-zinc-800 disabled:border-white/[0.03]"
    >
      {children}
    </button>
  );
}

export function SecurityView({ onOpenTrace }: { onOpenTrace: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [eventReq, setEventReq] = useState<{ id: string; nonce: number } | null>(null);
  const [flowId, setFlowId] = useState<string>(defaultFlowId);

  /**
   * Open an incident in the Events tab, and arm the Flow Map with the same one
   * so the third tab is never showing a different incident than the one you
   * just clicked. The nonce is what makes re-opening the same id work: the
   * Events view seeds its own `openId` from `initialEventId`, so the request
   * has to arrive as a remount, not as an unchanged prop.
   */
  const openInEvents = useCallback((id: string) => {
    setFocusId(id);
    setFlowId(id);
    setEventReq((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
    setTab("events");
  }, []);

  const openInFlow = useCallback((id: string) => {
    setFocusId(id);
    setFlowId(id);
    setTab("flow");
  }, []);

  // Picking in the Flow Map moves the pin but does NOT remount the Events tab —
  // browsing flows should not throw away a triage filter on the other side.
  const selectFlow = useCallback((id: string) => {
    setFocusId(id);
    setFlowId(id);
  }, []);

  const focused = focusId ? getEvent(focusId) : undefined;
  const flowEvent = useMemo(() => getEvent(flowId), [flowId]);
  const flowIndex = useMemo(() => ORDERED.findIndex((e) => e.id === flowId), [flowId]);

  return (
    <div className="h-full flex flex-col">
      {/* ── Header: identity, the predicate, the focus pin, the tabs ── */}
      <header className="flex-shrink-0 border-b border-white/[0.06] px-6 pt-5">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-zinc-400" strokeWidth={1.75} />
                <h1 className="text-[16px] text-zinc-100 font-medium">Trust Boundaries</h1>
              </div>
              <p className="text-[13px] text-zinc-500">
                Every span carries an origin and a capability, so the whole attack category is one
                query over the trace you already send:{" "}
                <span className="font-mono text-[12px] text-zinc-400">
                  reach(untrusted_origin, capability_sink)
                </span>
                .
              </p>
            </div>

            {focused && (
              <div className="hidden md:flex items-center gap-2 ml-auto flex-shrink-0 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                {/* The pin is shell state — the incident this console was last
                    pointed at — not a claim about what the Events list is
                    currently scrolled to. */}
                <MonoLabel className="text-zinc-600">Focus</MonoLabel>
                <span className="font-mono text-[11.5px] text-zinc-200">{focused.id}</span>
                {/* Id and class only. A bare number here would be a figure with
                    no unit on it — priority is a labelled column in both of the
                    tabs this chip points at. */}
                <ClassChip eventClass={focused.eventClass} />
                <span className="w-px h-3.5 bg-white/[0.08]" />
                {(
                  [
                    { key: "events" as const, label: "Events", go: () => openInEvents(focused.id) },
                    { key: "flow" as const, label: "Flow", go: () => openInFlow(focused.id) },
                  ]
                ).map((b) => (
                  <button
                    key={b.key}
                    onClick={b.go}
                    className={`font-mono text-[10px] tracking-[0.1em] uppercase px-1.5 py-0.5 rounded border transition-colors ${
                      tab === b.key
                        ? "border-white/10 bg-white/[0.05] text-zinc-300"
                        : "border-white/[0.06] text-zinc-500 hover:text-zinc-200 hover:border-white/15"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <nav className="flex items-center gap-4 mt-4 -mb-px overflow-x-auto">
            {TABS.map(({ key, label }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex items-center gap-1.5 flex-shrink-0 text-[12.5px] py-2 border-b-2 transition-colors ${
                    active
                      ? "border-indigo-400/80 text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {label}
                  {key === "events" && (
                    <span className="font-mono text-[10px] text-zinc-600 tabular-nums">
                      {SECURITY_EVENTS.length}
                    </span>
                  )}
                  {/* The map always names the incident it is holding, so the
                      third tab is never an unlabelled destination. */}
                  {key === "flow" && flowEvent && (
                    <span className="font-mono text-[10px] text-zinc-600">{flowEvent.id}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ── Panes. Hidden, never unmounted. ── */}
      <div className="flex-1 min-h-0">
        <div className={tab === "overview" ? "h-full overflow-auto" : "hidden"}>
          <div className="max-w-6xl mx-auto p-6">
            <SecurityOverview onOpenEvent={openInEvents} />
          </div>
        </div>

        <div className={tab === "events" ? "h-full" : "hidden"}>
          <SecurityEvents
            // A remount is the only way to re-request an id the view already
            // holds; see `openInEvents`.
            key={`events-${eventReq?.nonce ?? 0}`}
            initialEventId={eventReq?.id}
            onOpenTrace={onOpenTrace}
          />
        </div>

        <div className={tab === "flow" ? "h-full overflow-auto" : "hidden"}>
          {/*
            One column, not two. The canvas is a fixed 980px and the map's own
            container scrolls horizontally when it does not fit — but the SINKS
            lane is the payoff of this screen, and a side rail costs exactly the
            width that clips it at 1440. So the map gets the full content width
            and the chooser sits underneath, where it is a list rather than a
            competitor for the graph's space. The step control keeps the corpus
            reachable without scrolling to it.
          */}
          <div className="max-w-6xl mx-auto p-6 space-y-3">
            {flowEvent ? (
              <>
                <div className="flex items-center gap-2">
                  <Waypoints className="w-3.5 h-3.5 text-zinc-500" strokeWidth={1.75} />
                  <MonoLabel className="text-zinc-500">Flow</MonoLabel>
                  <span className="font-mono text-[11.5px] text-zinc-400 tabular-nums">
                    {flowIndex + 1} of {ORDERED.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <StepButton
                      label="Previous flow"
                      disabled={flowIndex <= 0}
                      onClick={() => selectFlow(ORDERED[flowIndex - 1].id)}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </StepButton>
                    <StepButton
                      label="Next flow"
                      disabled={flowIndex < 0 || flowIndex >= ORDERED.length - 1}
                      onClick={() => selectFlow(ORDERED[flowIndex + 1].id)}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </StepButton>
                  </div>
                  <span className="font-mono text-[10px] text-zinc-700">by priority</span>
                  <button
                    onClick={() => openInEvents(flowEvent.id)}
                    title={`Open ${flowEvent.id} in the Events tab`}
                    className="ml-auto flex-shrink-0 flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] uppercase text-zinc-500 hover:text-zinc-200 border border-white/[0.06] hover:border-white/15 rounded px-2 py-1 transition-colors"
                  >
                    Open incident <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
                {/* The map names the incident, its rule, its class and its
                    outcome in its own header — nothing above it repeats that. */}
                <FlowMap event={flowEvent} onOpenTrace={onOpenTrace} />
              </>
            ) : (
              <p className="rounded-lg border border-white/[0.06] px-4 py-8 text-center font-mono text-[12px] text-zinc-600">
                No event with id {flowId}.
              </p>
            )}
            <FlowMapPicker events={SECURITY_EVENTS} selectedId={flowId} onSelect={selectFlow} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default SecurityView;
