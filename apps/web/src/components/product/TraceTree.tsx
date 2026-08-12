"use client";

import { useMemo, useState } from "react";
import type { DemoSpan } from "@/lib/mock-observability";
import { KIND_META, STATUS_META } from "./ui";
import { ChevronRight, ChevronDown } from "lucide-react";

function fmtDur(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${ms}ms`;
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
    return m;
  }, [spans]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const rows: React.ReactNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const kids = children.get(parentId) ?? [];
    for (const s of kids) {
      const kid = children.get(s.id) ?? [];
      const hasKids = kid.length > 0;
      const isCollapsed = collapsed.has(s.id);
      const m = KIND_META[s.kind];
      const isSel = s.id === selectedId;
      rows.push(
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`w-full flex items-center gap-1.5 pr-3 py-[5px] text-left transition-colors ${
            isSel ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
          }`}
          style={{ paddingLeft: 8 + depth * 15 }}
        >
          <span
            className="flex-shrink-0 w-3.5 flex items-center justify-center text-zinc-600"
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
          {s.status === "error" && (
            <span className="flex-shrink-0 font-mono text-[9px] tracking-[0.08em] font-semibold text-red-400 bg-red-500/10 border border-red-500/25 rounded px-1 py-px">
              ERROR
            </span>
          )}
          <span className="ml-auto flex-shrink-0 font-mono text-[10.5px] text-zinc-500 tabular-nums">{fmtDur(s.durationMs)}</span>
        </button>
      );
      if (hasKids && !isCollapsed) walk(s.id, depth + 1);
    }
  };
  walk(null, 0);

  return <div className="py-1">{rows}</div>;
}
