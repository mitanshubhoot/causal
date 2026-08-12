"use client";

/**
 * Trust Boundaries — the Flow Map.
 *
 * The trace re-rendered as a PROVENANCE GRAPH instead of a waterfall. Three
 * lanes: SOURCES (who authored these bytes) · CONTEXT & DECISIONS (the llm and
 * agent spans that assembled them) · SINKS (what the bytes were able to do).
 * The whole capability reduces to one predicate and this screen is that
 * predicate drawn: reach(untrusted_origin, capability_sink).
 *
 * Four construction rules govern this file.
 *
 *  1. EVERY COORDINATE IS COMPUTED. Lane assignment falls out of `kind` and
 *     `capability`; rows fall out of position in the flow; x/y fall out of the
 *     lane and the row. Nothing is hand-placed for one fixture, so a 1-hop
 *     event and an 8-hop event both lay out correctly.
 *
 *  2. COLOUR IS STATUS. Trust is fill, border and a 4px diagonal hatch on the
 *     neutral scale — never five hues. Red marks only the nodes and edges on
 *     the violating path. Emerald means the machine worked: on a blocked or
 *     contained event the last red edge is SEVERED, drawn dashed and stopped
 *     at a bar instead of an arrowhead, so you can see the bytes not arrive.
 *
 *  3. GRACEFUL DEGRADATION. Taint that reaches no capability sink draws its
 *     amber overlay at 8% and its node in neutral clothing — effectively
 *     invisible. Taint on a path that reaches a sink draws at full strength.
 *     On a chatty RAG agent the default view is a quiet graph with one red line
 *     through it. REVEAL ALL TAINT lifts the suppression for the rare case
 *     someone wants everything.
 *
 *  4. NO PAYLOAD, EVER, AND NO MARKUP. Every string that could carry
 *     attacker-controlled bytes renders as escaped monospace with hosts
 *     defanged and nothing auto-linked. Evidence is a redacted summary plus
 *     span ids and byte offsets: enough to check the claim, never enough to
 *     reproduce the attack.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Capability, FlowNode, Origin, SecurityEvent } from "@/lib/security-types";
import type { SpanKind } from "@/lib/mock-observability";
import { CopyButton, KIND_META, MonoLabel, PANEL } from "../ui";
import {
  CAP_META,
  CapabilityChip,
  ClassChip,
  OutcomeChip,
  RedactedWitness,
  SeverityBadge,
  TierChip,
  TRUST_META,
  TrustChip,
  defang,
  fmtBytes,
  isUntrusted,
} from "./trust-ui";
import {
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  CircleDot,
  Eye,
  EyeOff,
  ExternalLink,
  Lock,
  RotateCw,
  ShieldCheck,
  UserCheck,
  X,
  type LucideIcon,
} from "lucide-react";

// See SecurityEvents.tsx: a traceId is not an incidentId, and most demo events
// reference a run the explorer has no page for. Resolve before linking.
import { explorerIncidentFor } from "@/lib/mock-security";

// ── Layout constants — the only numbers in this file, and none of them are data ──

const NODE_W = 236;
const NODE_H = 62;
const ROW_GAP = 30;
const LANE_GAP = 112;
const PAD_X = 18;
/**
 * The lane header is laid out in the DOM while nodes are positioned absolutely,
 * so the two only stay apart if this constant actually covers the header. It did
 * not: the context lane's hint wraps to two lines in a 248px column, putting the
 * header at ~47px against a PAD_TOP of 46 — so the first node sat on top of the
 * caption. The hint is now clamped to a fixed two-line box, which makes the
 * header height deterministic rather than dependent on font fallback, and this
 * derives from it with room to breathe.
 */
const LANE_HEADER_H = 48;
const PAD_TOP = LANE_HEADER_H + 18;
const PAD_BOTTOM = 28;
const CANVAS_W = PAD_X * 2 + NODE_W * 3 + LANE_GAP * 2;
/**
 * Floors for the two horizontal measurements. Panes never collapse — controls
 * shrink — so a container narrower than CANVAS_W does not hide the SINKS lane
 * behind an invisible overlay scrollbar; the empty gap between lanes gives way
 * first (it carries nothing), then the node box, down to a width that still
 * fits a span name and its two chips. Only below both floors does the canvas
 * scroll, and then the edge fade says so out loud.
 */
const LANE_GAP_MIN = 56;
const NODE_W_MIN = 176;
const TIP_W = 312;
/** Floor for the canvas: `overflow-x-auto` forces overflow-y to auto, so a hover
 *  card taller than a two-node graph would be clipped. Lanes simply run longer. */
const CANVAS_MIN_H = 300;

const LANES = ["source", "context", "sink"] as const;
type Lane = (typeof LANES)[number];

const LANE_TITLE: Record<Lane, string> = {
  source: "SOURCES",
  context: "CONTEXT & DECISIONS",
  sink: "SINKS",
};

const LANE_HINT: Record<Lane, string> = {
  source: "who authored these bytes",
  context: "llm and agent spans — where bytes became instructions",
  sink: "what the bytes were able to do",
};

/**
 * The capabilities that make reaching a node an event. READ_PRIVATE is
 * deliberately absent: a private read is where the operator's own bytes ENTER
 * the context, which is why `db.query customers` sits in the SOURCES lane in
 * the trifecta rather than at the end of it.
 */
const SINK_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  "EGRESS",
  "EXECUTE",
  "MUTATE",
  "MEMORY_WRITE",
  "DELEGATE",
]);

/** Spans that decide rather than fetch or act. */
const CONTEXT_KINDS: ReadonlySet<string> = new Set(["llm", "agent", "approval", "workflow"]);

/**
 * Lane assignment, derived. Order matters: a violating node with a capability
 * is the thing that was reached, whatever its span kind — which is how an `llm`
 * span whose own output IS the egress (a rendered markdown image, no http span
 * anywhere in the trace) lands correctly in SINKS.
 */
function laneFor(n: FlowNode): Lane {
  if (n.violating === true && n.capability !== "NONE") return "sink";
  if (SINK_CAPS.has(n.capability)) return "sink";
  if (CONTEXT_KINDS.has(n.kind)) return "context";
  return "source";
}

// ── Kind glyphs ───────────────────────────────────────────────────────
//
// The trace explorer's KIND_META is the source of truth so the two views agree.
// It does not cover the kinds the security path adds (`memory`, `approval`), so
// those are supplied here rather than crashing on an unknown index.

interface KindMeta {
  label: string;
  Icon: LucideIcon;
  tone: string;
}

const EXTRA_KIND_META: Record<string, KindMeta> = {
  memory: { label: "MEMORY", Icon: Archive, tone: "text-zinc-400" },
  approval: { label: "APPROVAL", Icon: UserCheck, tone: "text-zinc-300" },
};

function kindMeta(kind: string): KindMeta {
  const known = (KIND_META as Record<string, KindMeta | undefined>)[kind as SpanKind];
  return known ?? EXTRA_KIND_META[kind] ?? { label: kind.toUpperCase(), Icon: CircleDot, tone: "text-zinc-500" };
}

// ── Defanging prose ───────────────────────────────────────────────────

const SCHEME_URL = /\b[a-z][a-z0-9+.-]{1,10}:\/\/[^\s,;)]+/gi;
const BARE_HOST =
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|ai|ru|ee|dev|app|cloud|info|me|uk|de|example|internal|local)\b(?:\/[^\s,;)]*)?/gi;

/**
 * Renders hosts inert inside a sentence without touching the sentence. A blunt
 * `defang()` over prose brackets every full stop; this only rewrites tokens that
 * are actually resolvable — schemes, and hostnames ending in a real TLD — so
 * `io.output` and `package.json` survive while `cdn-metrics.ru` does not.
 */
export function defangProse(text: string): string {
  return text.replace(SCHEME_URL, (m) => defang(m)).replace(BARE_HOST, (m) => defang(m));
}

/** Escaped monospace, pre-wrapped, hosts defanged, nothing auto-linked. */
function SafeText({ value, className = "" }: { value: string; className?: string }) {
  return (
    <pre className={`font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words ${className}`}>
      {defangProse(value)}
    </pre>
  );
}

// ── Edge weight ───────────────────────────────────────────────────────

/**
 * Stroke width = 1 + log2(bytes / 64), capped at 6px. Zero bytes — a denial
 * before invoke — draws at the 1px floor, which is the correct picture: the
 * edge exists as a decision, and nothing traversed it.
 */
export function edgeWidth(bytes: number | undefined): number {
  if (bytes === undefined || bytes <= 0) return 1;
  return Math.max(1, Math.min(6, 1 + Math.log2(bytes / 64)));
}

// ── Graph ─────────────────────────────────────────────────────────────

interface GNode {
  index: number;
  node: FlowNode;
  lane: Lane;
  laneIdx: number;
  row: number;
  x: number;
  y: number;
}

interface GEdge {
  key: string;
  from: number;
  to: number;
  /** Bytes carried into the destination — the type contract defines `bytes` as exactly this. */
  bytes?: number;
  d: string;
  mx: number;
  my: number;
}

/** The horizontal measurements, resolved against the width actually available. */
export interface FlowLayout {
  nodeW: number;
  laneGap: number;
  canvasW: number;
}

const BASE_LAYOUT: FlowLayout = { nodeW: NODE_W, laneGap: LANE_GAP, canvasW: CANVAS_W };

function canvasWidth(nodeW: number, laneGap: number): number {
  return PAD_X * 2 + nodeW * 3 + laneGap * 2;
}

/**
 * Shrink to fit, in the order that costs the least information: the lane gap is
 * whitespace, the node box is content. `available <= 0` is the first paint,
 * before the container has been measured — draw at full size and let the effect
 * correct it, so the server and the client agree on the first frame.
 */
export function layoutFor(available: number): FlowLayout {
  if (available <= 0 || available >= CANVAS_W) return BASE_LAYOUT;
  const laneGap = Math.max(LANE_GAP_MIN, Math.floor((available - PAD_X * 2 - NODE_W * 3) / 2));
  let nodeW = NODE_W;
  if (canvasWidth(nodeW, laneGap) > available) {
    nodeW = Math.max(NODE_W_MIN, Math.floor((available - PAD_X * 2 - laneGap * 2) / 3));
  }
  return { nodeW, laneGap, canvasW: canvasWidth(nodeW, laneGap) };
}

function laneX(laneIdx: number, layout: FlowLayout): number {
  return PAD_X + layout.nodeW / 2 + laneIdx * (layout.nodeW + layout.laneGap);
}

function rowY(row: number): number {
  return PAD_TOP + NODE_H / 2 + row * (NODE_H + ROW_GAP);
}

function edgePath(a: GNode, b: GNode, layout: FlowLayout): { d: string; mx: number; my: number } {
  if (a.laneIdx === b.laneIdx) {
    const y1 = a.y + (b.y > a.y ? NODE_H / 2 : -NODE_H / 2);
    const y2 = b.y + (b.y > a.y ? -NODE_H / 2 : NODE_H / 2);
    const k = (y2 - y1) * 0.45;
    return {
      d: `M${a.x},${y1} C${a.x},${y1 + k} ${b.x},${y2 - k} ${b.x},${y2}`,
      mx: a.x,
      my: (y1 + y2) / 2,
    };
  }
  const dir = b.laneIdx > a.laneIdx ? 1 : -1;
  const x1 = a.x + (dir * layout.nodeW) / 2;
  const x2 = b.x - (dir * layout.nodeW) / 2;
  const k = Math.min(150, Math.max(44, Math.abs(x2 - x1) * 0.5));
  const c1 = x1 + dir * k;
  const c2 = x2 - dir * k;
  return {
    d: `M${x1},${a.y} C${c1},${a.y} ${c2},${b.y} ${x2},${b.y}`,
    mx: (x1 + 3 * c1 + 3 * c2 + x2) / 8,
    my: (a.y + b.y) / 2,
  };
}

function reach(from: number, adj: number[][]): Set<number> {
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    for (const next of adj[cur] ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

export interface FlowGraph {
  nodes: GNode[];
  edges: GEdge[];
  rows: number;
  height: number;
  fwd: number[][];
  bwd: number[][];
  /** Indices whose forward cone contains a capability sink or a violating node. */
  reachesSink: boolean[];
  /** Indices that are untrusted AND reach a sink. Full-strength amber. */
  liveTaint: Set<number>;
  /** Untrusted, reaching nothing. Suppressed to 8% unless revealed. */
  dormantTaint: Set<number>;
  violating: number[];
  redEdges: Set<string>;
  /** The last red edge into each violating node — the one a block severs. */
  terminalRedEdges: Set<string>;
  /** Edges the event's witness actually covers, source span → sink span. */
  witnessedEdges: Set<string>;
  bySpanId: Map<string, number>;
  laneCounts: Record<Lane, number>;
  /** The measurements every coordinate above was computed against. */
  layout: FlowLayout;
}

export function buildFlowGraph(event: SecurityEvent, layout: FlowLayout = BASE_LAYOUT): FlowGraph {
  const nodes: GNode[] = [];
  const bySpanId = new Map<string, number>();
  const laneCounts: Record<Lane, number> = { source: 0, context: 0, sink: 0 };

  // Rows follow first appearance in the flow, so the path descends as it moves
  // between lanes — every edge reads downward and the sequence stays legible
  // even when a memory write in one run is read back as a source in another.
  const path: number[] = [];
  for (const fn of event.flow) {
    const existing = bySpanId.get(fn.spanId);
    if (existing !== undefined) {
      path.push(existing);
      continue;
    }
    const lane = laneFor(fn);
    const laneIdx = LANES.indexOf(lane);
    const index = nodes.length;
    nodes.push({
      index,
      node: fn,
      lane,
      laneIdx,
      row: index,
      x: laneX(laneIdx, layout),
      y: rowY(index),
    });
    laneCounts[lane] += 1;
    bySpanId.set(fn.spanId, index);
    path.push(index);
  }

  const edges: GEdge[] = [];
  const fwd: number[][] = nodes.map(() => []);
  const bwd: number[][] = nodes.map(() => []);
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    if (from === to) continue;
    const a = nodes[from];
    const b = nodes[to];
    const geom = edgePath(a, b, layout);
    edges.push({ key: `${from}-${to}-${i}`, from, to, bytes: b.node.bytes, ...geom });
    fwd[from].push(to);
    bwd[to].push(from);
  }

  const isSinkNode = (g: GNode) => SINK_CAPS.has(g.node.capability) || g.node.violating === true;
  const reachesSink = nodes.map((g) => {
    for (const i of reach(g.index, fwd)) {
      if (isSinkNode(nodes[i])) return true;
    }
    return false;
  });

  const liveTaint = new Set<number>();
  const dormantTaint = new Set<number>();
  for (const g of nodes) {
    if (!isUntrusted(g.node.origin)) continue;
    (reachesSink[g.index] ? liveTaint : dormantTaint).add(g.index);
  }

  // The violating path. Where an untrusted ancestor exists it starts at the
  // earliest one — that is the byte that should never have been able to author
  // an instruction. Where none exists (an approval-integrity gap has no
  // untrusted content anywhere in the trace) the violation is the single edge
  // into the node, which is exactly the boundary that broke.
  const violating = nodes.filter((g) => g.node.violating === true).map((g) => g.index);
  const redEdges = new Set<string>();
  const terminalRedEdges = new Set<string>();
  for (const v of violating) {
    const anc = reach(v, bwd);
    const untrustedAnc = [...anc].filter((i) => isUntrusted(nodes[i].node.origin)).sort((a, b) => a - b);
    const starts = untrustedAnc.length > 0 ? [untrustedAnc[0]] : bwd[v];
    const cone = new Set<number>();
    for (const s of starts) for (const i of reach(s, fwd)) cone.add(i);
    for (const e of edges) {
      if (cone.has(e.from) && anc.has(e.to)) redEdges.add(e.key);
      if (e.to === v && cone.has(e.from)) terminalRedEdges.add(e.key);
    }
  }

  // The witness covers one hop pair. Edges between its source and sink carry
  // the witness kind; every other edge honestly carries none.
  const witnessedEdges = new Set<string>();
  const ws = event.witness.sourceSpanId ? bySpanId.get(event.witness.sourceSpanId) : undefined;
  const wk = event.witness.sinkSpanId ? bySpanId.get(event.witness.sinkSpanId) : undefined;
  if (ws !== undefined && wk !== undefined) {
    const cone = reach(ws, fwd);
    const anc = reach(wk, bwd);
    for (const e of edges) {
      if (cone.has(e.from) && anc.has(e.to)) witnessedEdges.add(e.key);
    }
  }

  const rows = nodes.length;
  const height = Math.max(
    CANVAS_MIN_H,
    PAD_TOP + rows * NODE_H + Math.max(0, rows - 1) * ROW_GAP + PAD_BOTTOM,
  );

  return {
    nodes,
    edges,
    rows,
    height,
    fwd,
    bwd,
    reachesSink,
    liveTaint,
    dormantTaint,
    violating,
    redEdges,
    terminalRedEdges,
    witnessedEdges,
    bySpanId,
    laneCounts,
    layout,
  };
}

// ── Stroke tones ──────────────────────────────────────────────────────

// Alpha lives in the stroke colour; the per-edge `opacity` attribute carries the
// degradation state on top of it, so 8% dormant taint is 8% of the same ink.
const STROKE_STRUCTURAL = "rgba(228,228,231,0.16)";
const STROKE_TAINT = "rgba(245,158,11,0.9)";
const STROKE_VIOLATION = "rgba(239,68,68,0.9)";

type Direction = "forward" | "backward" | "both";

const DIRECTION_META: Record<Direction, { label: string; hint: string; Icon: LucideIcon }> = {
  forward: { label: "Forward", hint: "everything these bytes provably reached", Icon: ArrowRight },
  backward: { label: "Backward", hint: "everything that could have written these bytes", Icon: ArrowLeft },
  both: { label: "Both", hint: "everything upstream and everything downstream", Icon: ArrowLeftRight },
};

function defaultDirection(lane: Lane): Direction {
  if (lane === "sink") return "backward";
  if (lane === "source") return "forward";
  return "both";
}

// ── Node ──────────────────────────────────────────────────────────────

interface NodeVisual {
  className: string;
  hatch?: string;
  hatchOpacity: number;
}

function nodeVisual(g: GNode, graph: FlowGraph, reveal: boolean): NodeVisual {
  const trust = TRUST_META[g.node.origin];
  if (g.node.violating === true) {
    return { className: "border border-red-500/45 bg-red-500/[0.09] text-red-200", hatch: trust.hatch, hatchOpacity: 0.14 };
  }
  if (graph.dormantTaint.has(g.index) && !reveal) {
    // Dormant taint wears neutral clothing and an 8% hatch. It is present, it is
    // checkable, and it does not compete with the one path that matters.
    return { className: "bg-zinc-900 border border-white/[0.07] text-zinc-400", hatch: trust.hatch, hatchOpacity: 0.08 };
  }
  return { className: trust.className, hatch: trust.hatch, hatchOpacity: 1 };
}

// ── The map ───────────────────────────────────────────────────────────

export interface FlowMapProps {
  event: SecurityEvent;
  onOpenTrace?: (id: string) => void;
  className?: string;
}

type Hover = { kind: "node"; index: number } | { kind: "edge"; key: string } | null;

export function FlowMap({ event, onOpenTrace, className = "" }: FlowMapProps) {
  const uid = useId().replace(/:/g, "");

  // The canvas is laid out against the width the scroll viewport actually has,
  // not against a constant — and hover cards are placed against the part of it
  // that is on screen, since a card is dismissed by the very scroll that would
  // bring it into view.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ width: 0, scrollLeft: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setView((cur) =>
        cur.width === el.clientWidth && cur.scrollLeft === el.scrollLeft
          ? cur
          : { width: el.clientWidth, scrollLeft: el.scrollLeft },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);

  const layout = useMemo(() => layoutFor(view.width), [view.width]);
  const graph = useMemo(() => buildFlowGraph(event, layout), [event, layout]);

  const [reveal, setReveal] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [hover, setHover] = useState<Hover>(null);

  // Selection and hover survive an `event` prop change — a picker driving this
  // component swaps the graph underneath them — so both are resolved against the
  // current graph rather than trusted as indices into it.
  const anchor = selected !== null && selected < graph.nodes.length ? selected : null;
  const anchorNode = anchor === null ? null : graph.nodes[anchor];

  const activeDirection: Direction =
    anchorNode === null ? "forward" : (direction ?? defaultDirection(anchorNode.lane));

  const highlight = useMemo(() => {
    if (anchor === null) return null;
    if (activeDirection === "forward") return reach(anchor, graph.fwd);
    if (activeDirection === "backward") return reach(anchor, graph.bwd);
    const set = reach(anchor, graph.fwd);
    for (const i of reach(anchor, graph.bwd)) set.add(i);
    return set;
  }, [anchor, activeDirection, graph]);

  const pick = useCallback(
    (index: number) => {
      setSelected((cur) => (cur === index ? null : index));
      setDirection(null);
    },
    [],
  );

  const clear = useCallback(() => {
    setSelected(null);
    setDirection(null);
  }, []);

  // Escape clears the highlighter wherever focus went — clicking a node moves
  // focus to the node button, but clicking the page background moves it to
  // <body>, and a handler on a non-focusable div never hears that key.
  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, clear]);

  const cycleDirection = useCallback(() => {
    setDirection((cur) => {
      const from = cur ?? (anchorNode === null ? "forward" : defaultDirection(anchorNode.lane));
      return from === "forward" ? "backward" : from === "backward" ? "both" : "forward";
    });
  }, [anchorNode]);

  // ── derived figures — every number on this screen comes from here ──
  const severed = event.outcome === "blocked" || event.outcome === "contained";
  const live = event.outcome === "succeeded";
  const sinkNodes = graph.nodes.filter((g) => g.lane === "sink");
  const sinksReachedByTaint = sinkNodes.filter((g) => {
    for (const t of graph.liveTaint) if (reach(t, graph.fwd).has(g.index)) return true;
    return false;
  });
  const violatingNodes = graph.violating.map((i) => graph.nodes[i]);
  const bytesAtSink = violatingNodes.length > 0 ? violatingNodes[violatingNodes.length - 1].node.bytes : undefined;
  const originsPresent = useMemo(() => {
    const seen: Origin[] = [];
    for (const g of graph.nodes) if (!seen.includes(g.node.origin)) seen.push(g.node.origin);
    return seen;
  }, [graph]);

  const hoveredNode = hover?.kind === "node" ? graph.nodes[hover.index] ?? null : null;
  const hoveredEdge = hover?.kind === "edge" ? graph.edges.find((e) => e.key === hover.key) ?? null : null;

  // The horizontal band a hover card may occupy: what is on screen right now,
  // never wider than the canvas it is positioned inside.
  const visibleW = view.width > 0 ? Math.min(view.width, layout.canvasW) : layout.canvasW;
  const cardBounds = { min: view.scrollLeft + 8, max: view.scrollLeft + visibleW - 8 };
  const overflowsLeft = view.scrollLeft > 1;
  const overflowsRight = view.width > 0 && view.scrollLeft + view.width < layout.canvasW - 1;

  return (
    <div className={`${PANEL} rounded-lg overflow-hidden ${className}`}>
      <style>{`
        @keyframes causal-flowmap-march { to { stroke-dashoffset: -28; } }
        .causal-flowmap-march { animation: causal-flowmap-march 1.6s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .causal-flowmap-march { animation: none; } }
      `}</style>

      {/* ── toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <MonoLabel className="text-zinc-400">Flow map</MonoLabel>
        <span className="font-mono text-[11px] text-zinc-500">{event.id}</span>
        <span className="text-zinc-700">·</span>
        <span className="font-mono text-[11px] text-zinc-500">
          {event.ruleId} v{event.ruleVersion}
        </span>
        {/* The class and the outcome can both read `blocked`, and they mean two
            different things, so each carries the name of what it is. */}
        <span className="inline-flex items-center gap-1">
          <MonoLabel>class</MonoLabel>
          <ClassChip eventClass={event.eventClass} />
        </span>
        <SeverityBadge severity={event.severity} />
        <span className="inline-flex items-center gap-1">
          <MonoLabel>outcome</MonoLabel>
          <OutcomeChip outcome={event.outcome} />
        </span>
        <TierChip tier={event.tier} />

        <div className="ml-auto flex items-center gap-1.5">
          {graph.dormantTaint.size === 0 && (
            <span className="font-mono text-[10px] text-zinc-500">
              nothing suppressed here
            </span>
          )}
          <button
            onClick={() => setReveal((v) => !v)}
            disabled={graph.dormantTaint.size === 0}
            aria-pressed={reveal}
            title={
              graph.dormantTaint.size === 0
                ? "Nothing is suppressed on this graph — every untrusted node here reaches a capability sink."
                : "Dormant taint — untrusted bytes that reach no capability sink — is suppressed by default so the one path that matters is the only thing shouting."
            }
            className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] px-2 py-1.5 rounded border transition-colors disabled:opacity-40 disabled:cursor-default ${
              reveal
                ? "text-amber-300 border-amber-500/30 bg-amber-500/[0.08]"
                : "text-zinc-400 border-white/10 bg-white/[0.03] enabled:hover:text-zinc-200 enabled:hover:border-white/20"
            }`}
          >
            {reveal ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Reveal all taint
            <span className="text-zinc-500 tabular-nums">{graph.dormantTaint.size}</span>
          </button>
          {onOpenTrace && explorerIncidentFor(event.traceId) && (
            <button
              onClick={() => onOpenTrace(event.traceId)}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] px-2 py-1.5 rounded border border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Trace {event.traceId.slice(0, 8)}
            </button>
          )}
        </div>
      </div>

      {/* ── title ───────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <p className="text-[13px] text-zinc-200 leading-snug">{defangProse(event.title)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <span className="font-mono text-[10.5px] text-zinc-500">{event.agent}</span>
          <span className="font-mono text-[10.5px] text-zinc-400">{event.environment}</span>
          {event.tool && <span className="font-mono text-[10.5px] text-zinc-400">{event.tool}</span>}
          <span className="font-mono text-[10.5px] text-zinc-400 tabular-nums">{event.timestamp.slice(11, 19)} UTC</span>
        </div>
      </div>

      {/* ── graph ───────────────────────────────────────────────── */}
      <div className="relative">
        <div ref={scrollRef} className="overflow-x-auto">
          <div className="relative" style={{ width: layout.canvasW, height: graph.height }}>
            {/* lane bands + headers */}
            {LANES.map((lane, i) => {
              const count = graph.laneCounts[lane];
              return (
                <div
                  key={lane}
                  className="absolute top-0 bottom-0 border-x border-white/[0.035] bg-white/[0.012]"
                  style={{ left: laneX(i, layout) - layout.nodeW / 2 - 14, width: layout.nodeW + 28 }}
                >
                  {/* Fixed height so nodes can never be laid out over the caption. */}
                  <div className="px-2 pt-2 overflow-hidden" style={{ height: LANE_HEADER_H }}>
                    <div className="flex items-baseline gap-1.5">
                      {/* MonoLabel's own text-zinc-500 wins over any lighter tone
                          passed in, so the caption carries its colour itself. */}
                      <MonoLabel>{LANE_TITLE[lane]}</MonoLabel>
                      <span className="font-mono text-[10px] text-zinc-400 tabular-nums">{count}</span>
                    </div>
                    <span
                      className="block font-mono text-[9px] text-zinc-400 leading-tight mt-0.5"
                      style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}
                      title={LANE_HINT[lane]}
                    >
                      {LANE_HINT[lane]}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* edges */}
            <svg
              width={layout.canvasW}
              height={graph.height}
              className="absolute inset-0"
              style={{ pointerEvents: "none" }}
              aria-hidden
            >
              <defs>
                {[
                  ["neutral", "rgba(228,228,231,0.34)"],
                  ["taint", STROKE_TAINT],
                  ["violation", STROKE_VIOLATION],
                ].map(([name, fill]) => (
                  <marker
                    key={name}
                    id={`${uid}-arrow-${name}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="9"
                    markerHeight="9"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M0.5,1 L9,5 L0.5,9 Z" fill={fill} />
                  </marker>
                ))}
                <marker
                  id={`${uid}-stop`}
                  viewBox="0 0 10 10"
                  refX="5"
                  refY="5"
                  markerWidth="11"
                  markerHeight="11"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M4,0.5 L4,9.5" stroke={STROKE_VIOLATION} strokeWidth="2.2" strokeLinecap="round" />
                </marker>
              </defs>

              {graph.edges.map((e) => {
                const from = graph.nodes[e.from];
                const to = graph.nodes[e.to];
                const w = edgeWidth(e.bytes);
                const red = graph.redEdges.has(e.key);
                const taint = isUntrusted(from.node.origin);
                const dormant = graph.dormantTaint.has(e.from) && !reveal;
                const isSevered = severed && graph.terminalRedEdges.has(e.key);
                const dim =
                  highlight !== null && !(highlight.has(e.from) && highlight.has(e.to)) ? 0.25 : 1;

                const tone: "neutral" | "taint" | "violation" = red ? "violation" : taint ? "taint" : "neutral";
                const overlayOpacity = red ? 0.95 : dormant ? 0.08 : 0.7;

                return (
                  <g key={e.key} opacity={dim}>
                    <path
                      d={e.d}
                      fill="none"
                      stroke={STROKE_STRUCTURAL}
                      strokeWidth={w}
                      strokeLinecap="round"
                      markerEnd={tone === "neutral" ? `url(#${uid}-arrow-neutral)` : undefined}
                    />
                    {tone !== "neutral" && (
                      <path
                        d={e.d}
                        fill="none"
                        stroke={red ? STROKE_VIOLATION : STROKE_TAINT}
                        strokeWidth={w}
                        strokeLinecap="round"
                        strokeDasharray={isSevered ? "5 5" : undefined}
                        opacity={overlayOpacity}
                        markerEnd={
                          isSevered
                            ? `url(#${uid}-stop)`
                            : `url(#${uid}-arrow-${red ? "violation" : "taint"})`
                        }
                      />
                    )}
                    {red && live && !isSevered && (
                      <path
                        d={e.d}
                        fill="none"
                        stroke="rgba(254,202,202,0.55)"
                        strokeWidth={Math.max(1, w - 0.5)}
                        strokeLinecap="round"
                        strokeDasharray="4 24"
                        className="causal-flowmap-march"
                      />
                    )}
                    {/* generous invisible hit area */}
                    <path
                      d={e.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(w, 16)}
                      style={{ pointerEvents: "stroke", cursor: "crosshair" }}
                      onMouseEnter={() => setHover({ kind: "edge", key: e.key })}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>
                        {`${from.node.name} → ${to.node.name} · ${e.bytes !== undefined ? fmtBytes(e.bytes) : "bytes not recorded"}`}
                      </title>
                    </path>
                  </g>
                );
              })}
            </svg>

            {/* edge labels */}
            {graph.edges.map((e) => {
              const from = graph.nodes[e.from];
              const red = graph.redEdges.has(e.key);
              const dormant = graph.dormantTaint.has(e.from) && !reveal;
              const dim = highlight !== null && !(highlight.has(e.from) && highlight.has(e.to));
              const deferred =
                from.node.capability === "MEMORY_WRITE" && graph.nodes[e.to].node.capability !== "NONE";
              const carriesPrivate = from.node.capability === "READ_PRIVATE";
              if (e.bytes === undefined && !deferred) return null;
              return (
                <div
                  key={`label-${e.key}`}
                  className="absolute z-30 pointer-events-none"
                  style={{
                    left: e.mx,
                    top: e.my,
                    transform: "translate(-50%,-50%)",
                    opacity: dim ? 0.25 : dormant ? 0.35 : 1,
                  }}
                >
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[9.5px] tabular-nums px-1.5 py-0.5 rounded border bg-[#0f0f11] ${
                      red ? "border-red-500/30 text-red-300/90" : "border-white/[0.08] text-zinc-500"
                    }`}
                  >
                    {carriesPrivate && <Lock className="w-2.5 h-2.5" strokeWidth={2} />}
                    {e.bytes !== undefined ? fmtBytes(e.bytes) : "—"}
                    {deferred && <span className="text-zinc-400 tracking-[0.08em]">DEFERRED</span>}
                    {graph.witnessedEdges.has(e.key) && (
                      <span className="text-zinc-400 tracking-[0.08em]">{event.witness.kind.toUpperCase()}</span>
                    )}
                  </span>
                </div>
              );
            })}

            {/* nodes */}
            {graph.nodes.map((g) => {
              const visual = nodeVisual(g, graph, reveal);
              const dim = highlight !== null && !highlight.has(g.index) ? 0.25 : 1;
              const isSelected = anchor === g.index;
              const km = kindMeta(g.node.kind);
              const violating = g.node.violating === true;
              return (
                <div key={g.node.spanId} className="absolute z-20" style={{ left: g.x, top: g.y, transform: "translate(-50%,-50%)" }}>
                  <button
                    onClick={() => pick(g.index)}
                    onMouseEnter={() => setHover({ kind: "node", index: g.index })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ kind: "node", index: g.index })}
                    onBlur={() => setHover(null)}
                    aria-pressed={isSelected}
                    aria-label={`${g.node.name}, span ${g.node.spanId}, origin ${g.node.origin}, capability ${g.node.capability}${violating ? ", violating node" : ""}`}
                    style={{ width: layout.nodeW, height: NODE_H, opacity: dim }}
                    className={`relative block text-left rounded overflow-hidden transition-opacity ${visual.className} ${
                      isSelected ? "ring-1 ring-indigo-400/70" : ""
                    } hover:brightness-125`}
                  >
                    {visual.hatch && (
                      <span
                        aria-hidden
                        className="absolute inset-0 pointer-events-none"
                        style={{ backgroundImage: visual.hatch, opacity: visual.hatchOpacity }}
                      />
                    )}
                    <span className="relative flex flex-col gap-1 px-2 py-1.5">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <km.Icon className={`w-3 h-3 flex-shrink-0 ${violating ? "text-red-300" : km.tone}`} strokeWidth={1.75} />
                        <span className={`font-mono text-[12px] truncate ${violating ? "text-red-100" : "text-zinc-200"}`}>
                          {g.node.name}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-zinc-400 flex-shrink-0">#{g.node.spanId}</span>
                      </span>
                      <span className="flex items-center gap-1 min-w-0">
                        {violating && <X className="w-2.5 h-2.5 text-red-400 flex-shrink-0" strokeWidth={3} />}
                        <span
                          className={`font-mono text-[9px] tracking-[0.1em] font-semibold truncate ${
                            violating ? "text-red-300/90" : "text-zinc-400"
                          }`}
                        >
                          {TRUST_META[g.node.origin].short}
                        </span>
                        {g.node.capability !== "NONE" && (
                          <>
                            <span className="text-zinc-700">·</span>
                            <span
                              className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.09em] font-semibold truncate ${
                                violating ? "text-red-300/90" : "text-zinc-500"
                              }`}
                            >
                              {(() => {
                                const CapIcon = CAP_META[g.node.capability].Icon;
                                return <CapIcon className="w-2.5 h-2.5 flex-shrink-0" strokeWidth={1.75} />;
                              })()}
                              {CAP_META[g.node.capability].label}
                            </span>
                          </>
                        )}
                        {graph.dormantTaint.has(g.index) && !reveal && (
                          <span className="ml-auto font-mono text-[8.5px] tracking-[0.1em] text-zinc-500 flex-shrink-0">
                            DORMANT
                          </span>
                        )}
                      </span>
                    </span>
                  </button>

                  {/* the verdict seal sits on the node the boundary crossed */}
                  {violating && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full pt-1 flex items-center gap-1 whitespace-nowrap">
                      <OutcomeChip outcome={event.outcome} />
                      {severed && <ShieldCheck className="w-3 h-3 text-emerald-400" strokeWidth={2} />}
                    </div>
                  )}
                </div>
              );
            })}

            {/* hover card */}
            {/* Keyed on the subject so each card measures its own height rather
                than inheriting the previous hover's box. */}
            {hoveredNode && (
              <NodeCard
                key={hoveredNode.node.spanId}
                g={hoveredNode}
                graph={graph}
                event={event}
                bounds={cardBounds}
                onOpenTrace={onOpenTrace}
              />
            )}
            {hoveredEdge && (
              <EdgeCard key={hoveredEdge.key} e={hoveredEdge} graph={graph} event={event} bounds={cardBounds} />
            )}
          </div>
        </div>
        {/* macOS overlay scrollbars are invisible until they move, so the canvas
            says for itself when it continues past the viewport. */}
        {overflowsLeft && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[#0f0f11] to-transparent"
          />
        )}
        {overflowsRight && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#0f0f11] to-transparent"
          />
        )}
      </div>

      {/* ── selection bar ───────────────────────────────────────── */}
      {anchorNode !== null && highlight !== null && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-white/[0.06] bg-indigo-500/[0.04]">
          <MonoLabel className="text-indigo-300/70">Taint highlighter</MonoLabel>
          {/* It cycles rather than toggles, so it says so — a bordered chip that
              never changes on hover is how the badges beside it behave. */}
          <button
            onClick={cycleDirection}
            title={`Direction — ${DIRECTION_META[activeDirection].label.toLowerCase()}. Click to cycle.`}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] px-2 py-1.5 rounded border border-indigo-400/30 bg-indigo-500/[0.08] text-indigo-200 transition-colors hover:bg-indigo-500/[0.16] hover:border-indigo-400/50"
          >
            {(() => {
              const DirIcon = DIRECTION_META[activeDirection].Icon;
              return <DirIcon className="w-3 h-3" strokeWidth={2} />;
            })()}
            {DIRECTION_META[activeDirection].label}
            <RotateCw className="w-2.5 h-2.5 text-indigo-300/60" strokeWidth={2} />
          </button>
          <span className="font-mono text-[11px] text-zinc-400">
            from <span className="text-zinc-200">{anchorNode.node.name}</span>
            <span className="text-zinc-500"> #{anchorNode.node.spanId}</span> —{" "}
            {DIRECTION_META[activeDirection].hint}
          </span>
          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
            {highlight.size} of {graph.nodes.length} nodes
          </span>
          <button
            onClick={clear}
            title="Clear the taint highlighter (Escape)"
            className="ml-auto inline-flex items-center font-mono text-[10px] tracking-[0.08em] px-2 py-1.5 rounded border border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── derived figures ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.06] border-t border-white/[0.06]">
        <Figure label="hops" value={String(graph.nodes.length)} hint="flow nodes in this event" />
        <Figure
          label="live taint"
          value={graph.liveTaint.size === 0 && graph.dormantTaint.size === 0 ? "—" : `${graph.liveTaint.size} / ${graph.liveTaint.size + graph.dormantTaint.size}`}
          hint="untrusted nodes that reach a capability sink, of all untrusted nodes"
        />
        <Figure
          label="sinks reached"
          value={sinkNodes.length === 0 ? "—" : `${sinksReachedByTaint.length} / ${sinkNodes.length}`}
          hint="capability sinks reachable from untrusted taint"
        />
        <Figure
          label="bytes at the sink"
          value={bytesAtSink === undefined ? "—" : fmtBytes(bytesAtSink)}
          hint="carried into the violating node"
        />
      </div>

      {/* ── legend ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 border-t border-white/[0.06]">
        <MonoLabel>legend</MonoLabel>
        {originsPresent.map((o) => (
          <div key={o} className="flex items-center gap-1.5">
            <span
              className={`relative inline-block w-4 h-4 rounded-sm overflow-hidden ${TRUST_META[o].className}`}
              title={TRUST_META[o].description}
            >
              {TRUST_META[o].hatch && (
                <span aria-hidden className="absolute inset-0" style={{ backgroundImage: TRUST_META[o].hatch }} />
              )}
            </span>
            <span className="font-mono text-[9.5px] tracking-[0.08em] text-zinc-500">{TRUST_META[o].short}</span>
          </div>
        ))}
        {graph.violating.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded-sm border border-red-500/45 bg-red-500/[0.09]" />
            <span className="font-mono text-[9.5px] tracking-[0.08em] text-red-300/80">VIOLATING</span>
          </div>
        )}
        {severed && (
          <div className="flex items-center gap-1.5">
            <svg width="26" height="10" aria-hidden>
              <path d="M0,5 L18,5" stroke={STROKE_VIOLATION} strokeWidth="2" strokeDasharray="5 5" />
              <path d="M21,1 L21,9" stroke={STROKE_VIOLATION} strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span className="font-mono text-[9.5px] tracking-[0.08em] text-emerald-400/90">SEVERED — nothing traversed</span>
          </div>
        )}
        {graph.dormantTaint.size > 0 && (
          <div className="flex items-center gap-1.5">
            {/* A legend key has to SHOW the distinction, so the hatch is drawn at
                a legible strength here rather than reproducing the 8% suppression
                it is explaining — at 8% in a 16px box the swatch is a blank. */}
            <span className="relative inline-block w-4 h-4 rounded-sm overflow-hidden bg-zinc-900 border border-white/[0.07]">
              <span
                aria-hidden
                className="absolute inset-0"
                style={{ backgroundImage: TRUST_META.UNTRUSTED_EXTERNAL.hatch, opacity: 0.35 }}
              />
            </span>
            <span className="font-mono text-[9.5px] tracking-[0.08em] text-zinc-400">DORMANT — reaches no sink</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <svg width="46" height="14" aria-hidden>
            {[64, 1024, 65_536].map((b, i) => (
              <path
                key={b}
                d={`M${i * 16 + 2},2 L${i * 16 + 2},12`}
                stroke="rgba(228,228,231,0.34)"
                strokeWidth={edgeWidth(b)}
                strokeLinecap="round"
              />
            ))}
          </svg>
          <span className="font-mono text-[9.5px] text-zinc-400">
            {fmtBytes(64)} · {fmtBytes(1024)} · {fmtBytes(65_536)} — w = 1 + log₂(bytes ÷ 64), max 6
          </span>
        </div>
      </div>

      {/* ── witness + gloss ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 border-t border-white/[0.06]">
        <div className="space-y-1.5">
          <RedactedWitness witness={event.witness} />
          <p className="font-mono text-[10px] text-zinc-400 leading-relaxed">
            {graph.witnessedEdges.size > 0
              ? `Covers ${graph.witnessedEdges.size} of ${graph.edges.length} edges on this graph. Every other hop carries no witness and claims none.`
              : "No hop on this graph is covered by a verbatim witness; the finding rests on structure, not on a matched string."}
          </p>
        </div>
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/[0.06]">
            <MonoLabel>what this graph shows</MonoLabel>
            <span className="ml-auto">
              <CopyButton value={event.summary} />
            </span>
          </div>
          <div className="px-2.5 py-2">
            <SafeText value={event.summary} className="text-zinc-400" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Figure ────────────────────────────────────────────────────────────

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-[#0f0f11] px-3 py-2" title={hint}>
      <MonoLabel>{label}</MonoLabel>
      <div className="font-mono text-[15px] text-zinc-200 tabular-nums pt-0.5">{value}</div>
    </div>
  );
}

// ── Hover cards ───────────────────────────────────────────────────────

/** The horizontal band a card may occupy, in canvas coordinates. */
interface CardBounds {
  min: number;
  max: number;
}

/**
 * Anchors a hover card beside its subject, flipping to the other side when it
 * would leave the VISIBLE part of the canvas — not the canvas, which can be
 * wider than the viewport showing it — and clamping in both axes so it is never
 * clipped. Bounding against the canvas instead cut a card off the right edge of
 * a narrow viewport, and a hover card cannot be scrolled into view: the scroll
 * that would reveal it is the gesture that dismisses it.
 */
function cardPosition(
  x: number,
  halfWidth: number,
  y: number,
  height: number,
  canvasHeight: number,
  bounds: CardBounds,
) {
  const rightSide = x + halfWidth + 14;
  const leftSide = x - halfWidth - 14 - TIP_W;
  const ceiling = Math.max(bounds.min, bounds.max - TIP_W);
  const left = Math.min(Math.max(rightSide + TIP_W <= bounds.max ? rightSide : leftSide, bounds.min), ceiling);
  const top = Math.min(Math.max(8, y - 24), Math.max(8, canvasHeight - height - 8));
  return { left, top, maxHeight: canvasHeight - 16 };
}

/**
 * The vertical clamp needs the card's height, and a card's height depends on how
 * much evidence the node carries — a guessed constant clipped the last line of
 * the witness gloss off the bottom. Measure the rendered box and re-clamp with
 * it. `overflow: hidden` caps the measurement at maxHeight, so this converges in
 * one extra frame instead of oscillating.
 */
function useCardHeight(estimate: number): [(el: HTMLDivElement | null) => void, number] {
  const [height, setHeight] = useState(estimate);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (el !== null && el.offsetHeight > 0) setHeight(el.offsetHeight);
  }, []);
  return [measure, height];
}

function NodeCard({
  g,
  graph,
  event,
  bounds,
  onOpenTrace,
}: {
  g: GNode;
  graph: FlowGraph;
  event: SecurityEvent;
  bounds: CardBounds;
  onOpenTrace?: (id: string) => void;
}) {
  const [measure, height] = useCardHeight(224);
  const { left, top, maxHeight } = cardPosition(g.x, graph.layout.nodeW / 2, g.y, height, graph.height, bounds);
  const km = kindMeta(g.node.kind);
  const downstream = reach(g.index, graph.fwd).size - 1;
  const upstream = reach(g.index, graph.bwd).size - 1;
  const dormant = graph.dormantTaint.has(g.index);

  return (
    <div
      ref={measure}
      className="absolute z-40 rounded-md border border-white/[0.1] bg-[#131316] shadow-xl shadow-black/60 pointer-events-none"
      style={{ left, top, width: TIP_W, maxHeight, overflow: "hidden" }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-white/[0.06]">
        <km.Icon className={`w-3 h-3 ${km.tone}`} strokeWidth={1.75} />
        <span className="font-mono text-[9px] tracking-[0.1em] text-zinc-500">{km.label}</span>
        <span className="font-mono text-[11px] text-zinc-200 truncate">{g.node.name}</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-400">#{g.node.spanId}</span>
      </div>
      <div className="px-2.5 py-2 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <TrustChip origin={g.node.origin} />
          <CapabilityChip capability={g.node.capability} violating={g.node.violating === true} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
            bytes in {g.node.bytes !== undefined ? fmtBytes(g.node.bytes) : "—"}
          </span>
          <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
            influenced {downstream} · influenced by {upstream}
          </span>
          <span className="font-mono text-[10px] text-zinc-400">{LANE_TITLE[g.lane].toLowerCase()}</span>
        </div>
        {isUntrusted(g.node.origin) && (
          <p className="font-mono text-[10px] leading-relaxed text-zinc-500">
            {dormant
              ? "Untrusted, and it reaches no capability sink — informational, not an incident. Taint is not the event; taint reaching a sink is."
              : "Untrusted, and it reaches a capability sink. Propagation through an llm span is unconditional — paraphrase does not launder taint."}
          </p>
        )}
        {g.node.detail && (
          <div
            style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 6, overflow: "hidden" }}
          >
            <SafeText value={g.node.detail} className="text-zinc-400" />
          </div>
        )}
        {onOpenTrace && explorerIncidentFor(event.traceId) && (
          <p className="font-mono text-[9.5px] text-zinc-500 pt-0.5">
            span lives in trace {event.traceId.slice(0, 8)}
          </p>
        )}
      </div>
    </div>
  );
}

function EdgeCard({
  e,
  graph,
  event,
  bounds,
}: {
  e: GEdge;
  graph: FlowGraph;
  event: SecurityEvent;
  bounds: CardBounds;
}) {
  const from = graph.nodes[e.from];
  const to = graph.nodes[e.to];
  const witnessed = graph.witnessedEdges.has(e.key);
  const red = graph.redEdges.has(e.key);
  const [measure, height] = useCardHeight(168);
  const { left, top, maxHeight } = cardPosition(e.mx, 14, e.my, height, graph.height, bounds);

  return (
    <div
      ref={measure}
      className="absolute z-40 rounded-md border border-white/[0.1] bg-[#131316] shadow-xl shadow-black/60 pointer-events-none"
      style={{ left, top, width: TIP_W, maxHeight, overflow: "hidden" }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-white/[0.06]">
        <MonoLabel className={red ? "text-red-300/80" : ""}>{red ? "violating edge" : "flow edge"}</MonoLabel>
        <span className="ml-auto font-mono text-[10px] text-zinc-500 tabular-nums">
          {e.bytes !== undefined ? fmtBytes(e.bytes) : "—"}
        </span>
      </div>
      <div className="px-2.5 py-2 space-y-1.5">
        <p className="font-mono text-[11px] text-zinc-300">
          {from.node.name} <span className="text-zinc-400">#{from.node.spanId}</span>
          <span className="text-zinc-400"> → </span>
          {to.node.name} <span className="text-zinc-400">#{to.node.spanId}</span>
        </p>
        <p className="font-mono text-[10px] text-zinc-400">
          stroke {edgeWidth(e.bytes).toFixed(2)}px = 1 + log₂({e.bytes !== undefined ? e.bytes.toLocaleString() : "—"} ÷ 64)
        </p>
        {witnessed ? (
          <p className="font-mono text-[10px] leading-relaxed text-zinc-400">
            witness {event.witness.kind.toUpperCase()}
            {event.witness.sourceOffset !== undefined && ` · source offset ${event.witness.sourceOffset.toLocaleString()}`}
            {event.witness.sinkOffset !== undefined && ` · sink offset ${event.witness.sinkOffset.toLocaleString()}`}
          </p>
        ) : (
          <p className="font-mono text-[10px] text-zinc-400">witness — this hop is not the witnessed pair</p>
        )}
        {from.node.capability === "MEMORY_WRITE" && to.node.capability !== "NONE" && (
          <p className="font-mono text-[10px] leading-relaxed text-amber-200/70">
            DEFERRED — bytes persisted by one run and read back by a later one. A stateless interceptor has nowhere to
            keep the fact that connects them.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Picker ────────────────────────────────────────────────────────────

/**
 * A chooser, so the map can be exercised against every event in the corpus —
 * three hops or eight, one node or five lanes' worth. Rows are ordered by the
 * events' own priority, which is arithmetic, not adjective.
 */
export function FlowMapPicker({
  events,
  selectedId,
  onSelect,
  className = "",
}: {
  events: SecurityEvent[];
  selectedId?: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const ordered = useMemo(() => [...events].sort((a, b) => b.priority - a.priority), [events]);

  return (
    <div className={`${PANEL} rounded-lg overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <MonoLabel className="text-zinc-400">Flows</MonoLabel>
        <span className="font-mono text-[10px] text-zinc-400 tabular-nums">{ordered.length}</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto divide-y divide-white/[0.04]">
        {ordered.map((e) => {
          const active = e.id === selectedId;
          const sinks = e.flow.filter((n) => SINK_CAPS.has(n.capability) || n.violating === true).length;
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              className={`w-full text-left px-3 py-2 transition-colors ${
                active ? "bg-indigo-500/[0.07]" : "hover:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12.5px] text-zinc-200 tabular-nums w-7 text-right">{e.priority}</span>
                <ClassChip eventClass={e.eventClass} />
                <span className="font-mono text-[10.5px] text-zinc-500">{e.id}</span>
                <span className="ml-auto font-mono text-[9.5px] text-zinc-400 tabular-nums whitespace-nowrap">
                  {e.flow.length} hops · {sinks} sink{sinks === 1 ? "" : "s"}
                </span>
              </div>
              <p className={`text-[12.5px] leading-snug truncate pt-0.5 ${active ? "text-zinc-200" : "text-zinc-400"}`}>
                {defangProse(e.title)}
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <span className="font-mono text-[10px] text-zinc-400">{e.agent}</span>
                <span className="font-mono text-[10px] text-zinc-500">{e.ruleId}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
