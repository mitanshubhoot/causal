"use client";

import { useMemo, useState } from "react";
import type { DemoSpan } from "@/lib/mock-observability";
import { KIND_META, STATUS_META, fmtDuration, fmtTokens } from "./ui";
import { ChevronRight, ChevronDown } from "lucide-react";

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

      rows.push(
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`w-full flex items-center gap-1.5 pr-3 py-[5px] text-left transition-colors ${
            isSel ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
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
          <span className={`font-mono text-[12px] truncate ${isSel ? "text-zinc-100" : "text-zinc-300"}`}>
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
            <span className="ml-auto hidden lg:flex items-center gap-2 flex-shrink-0 font-mono text-[10px] text-zinc-600 tabular-nums">
              <span>
                {fmtTokens(roll.tokensIn)} → {fmtTokens(roll.tokensOut)}{" "}
                <span className="text-zinc-700">({fmtTokens(roll.tokensIn + roll.tokensOut)})</span>
              </span>
              <span className="text-zinc-700">·</span>
              <span>${roll.cost.toFixed(4)}</span>
            </span>
          )}
          {!showRoll && s.cost !== undefined && (
            <span className="ml-auto hidden lg:block flex-shrink-0 font-mono text-[10px] text-zinc-600 tabular-nums">
              ${s.cost.toFixed(4)}
            </span>
          )}
        </button>
      );
      if (hasKids && !isCollapsed) walk(s.id, depth + 1);
    }
  };
  walk(null, 0);

  return <div className="py-1">{rows}</div>;
}
