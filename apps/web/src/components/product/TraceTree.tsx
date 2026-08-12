"use client";

import { useMemo, useState } from "react";
import type { DemoSpan } from "@/lib/mock-observability";
import { KIND_META, STATUS_META, fmtDuration, fmtTokens } from "./ui";
// One derivation rule, one place — the tree and the detail panel must never
// disagree about a span's origin. See deriveSpanProvenance for what it can and
// cannot know; every label it produces is TIER 0 · INFERRED.
import { deriveSpanProvenance } from "./SpanDetail";
import { TRUST_META } from "./security/trust-ui";
import { ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";

interface Rollup {
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

/** Sum tokens/cost over each span's whole subtree, so parent rows show
 *  aggregate economics the way a real APM does. */
function computeRollups(spans: DemoSpan[]): Map<string, Rollup> {
  const kids = new Map<string | null, DemoSpan[]>();
  for (const s of spans) {
    const arr = kids.get(s.parentId) ?? [];
    arr.push(s);
    kids.set(s.parentId, arr);
  }
  const out = new Map<string, Rollup>();
  const walk = (s: DemoSpan): Rollup => {
    let r: Rollup = { tokensIn: s.tokensIn ?? 0, tokensOut: s.tokensOut ?? 0, cost: s.cost ?? 0 };
    for (const c of kids.get(s.id) ?? []) {
      const cr = walk(c);
      r = { tokensIn: r.tokensIn + cr.tokensIn, tokensOut: r.tokensOut + cr.tokensOut, cost: r.cost + cr.cost };
    }
    out.set(s.id, r);
    return r;
  };
  for (const root of kids.get(null) ?? []) walk(root);
  return out;
}

export function TraceTree({
  spans,
  selectedId,
  onSelect,
}: {
  spans: DemoSpan[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const children = useMemo(() => {
    const m = new Map<string | null, DemoSpan[]>();
    for (const s of spans) {
      const key = s.parentId;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    // siblings in wall-clock order
    for (const arr of m.values()) arr.sort((a, b) => a.startMs - b.startMs);
    return m;
  }, [spans]);

  const rollups = useMemo(() => computeRollups(spans), [spans]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows: React.ReactNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const s of children.get(parentId) ?? []) {
      const kid = children.get(s.id) ?? [];
      const hasKids = kid.length > 0;
      const isCollapsed = collapsed.has(s.id);
      const m = KIND_META[s.kind];
      const isSel = s.id === selectedId;
      const roll = rollups.get(s.id);
      const showRoll = !!roll && roll.tokensIn + roll.tokensOut > 0 && hasKids;
      const trust = TRUST_META[deriveSpanProvenance(s).origin];

      rows.push(
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`relative w-full flex items-center gap-1.5 pr-3 py-[5px] text-left transition-colors ${
            isSel ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {/* Trust ribbon. Absolutely positioned at the row's left edge so it
              costs the layout nothing and every row's marker lands in one
              column — scanning it shows where the trust level changes. Encoded
              as fill/border/hatch on the neutral scale, never a new hue: colour
              stays reserved for status. UNKNOWN renders as unknown. */}
          <span
            aria-hidden
            title={`${trust.label} · TIER 0 · INFERRED — origin derived from span kind, not declared`}
            style={trust.hatch ? { backgroundImage: trust.hatch } : undefined}
            className={`absolute left-0 inset-y-0 w-[3px] ${trust.className}`}
          />
          <span
            className="flex-shrink-0 w-3.5 flex items-center justify-center text-zinc-600 hover:text-zinc-300"
            onClick={(e) => {
              if (hasKids) {
                e.stopPropagation();
                toggle(s.id);
              }
            }}
          >
            {hasKids ? (
              isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            ) : null}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_META[s.status].dot}`} />
          <m.Icon className={`w-3.5 h-3.5 flex-shrink-0 ${m.tone}`} strokeWidth={1.75} />
          <span className={`font-mono text-[12px] truncate flex-1 min-w-0 ${isSel ? "text-zinc-100" : "text-zinc-300"}`}>
            {s.name}
          </span>
          <span className="flex-shrink-0 font-mono text-[10.5px] text-zinc-500 tabular-nums ml-1.5">
            {fmtDuration(s.durationMs)}
          </span>
          {s.status === "error" && (
            <span className="flex-shrink-0 font-mono text-[9px] tracking-[0.08em] font-semibold text-red-400 bg-red-500/10 border border-red-500/25 rounded px-1 py-px">
              ERROR
            </span>
          )}
          {/* subtree economics, like a real APM */}
          {showRoll && (
            <span className="hidden xl:flex items-center gap-2 flex-shrink-0 font-mono text-[10px] text-zinc-600 tabular-nums">
              <span>
                {fmtTokens(roll.tokensIn)} → {fmtTokens(roll.tokensOut)}{" "}
                <span className="text-zinc-700">({fmtTokens(roll.tokensIn + roll.tokensOut)})</span>
              </span>
              <span className="text-zinc-700">·</span>
              <span>${roll.cost.toFixed(4)}</span>
            </span>
          )}
          {!showRoll && s.cost !== undefined && (
            <span className="hidden xl:block flex-shrink-0 font-mono text-[10px] text-zinc-600 tabular-nums">
              ${s.cost.toFixed(4)}
            </span>
          )}
        </button>
      );
      if (hasKids && !isCollapsed) walk(s.id, depth + 1);
    }
  };
  walk(null, 0);

  const parentIds = spans.filter((s) => children.has(s.id)).map((s) => s.id);
  const allCollapsed = parentIds.length > 0 && parentIds.every((id) => collapsed.has(id));

  /** How many ribbons carry a label at all. The rest are a coverage gap, and the
   *  header says so rather than letting a quiet stripe read as "trusted". */
  const labelled = spans.filter((s) => deriveSpanProvenance(s).origin !== "UNKNOWN").length;

  return (
    <div>
      {parentIds.length > 1 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04] sticky top-0 bg-[#0a0a0b] z-10">
          <button
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parentIds))}
            className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {allCollapsed ? <ChevronsUpDown className="w-3 h-3" /> : <ChevronsDownUp className="w-3 h-3" />}
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
          <span
            title={`Trust ribbon at each row's left edge. Origin resolves for ${labelled} of ${spans.length} spans, inferred from span kind — TIER 0, never a declared label. The rest render as UNKNOWN.`}
            className="ml-auto font-mono text-[10px] text-zinc-600 tabular-nums flex-shrink-0"
          >
            trust {labelled}/{spans.length}
          </span>
          <span aria-hidden className="font-mono text-[10px] text-zinc-700 flex-shrink-0">·</span>
          <span className="font-mono text-[10px] text-zinc-600 flex-shrink-0">{spans.length} spans</span>
        </div>
      )}
      <div className="py-1">{rows}</div>
    </div>
  );
}
