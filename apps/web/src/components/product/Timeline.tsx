"use client";

import { useMemo } from "react";
import type { DemoSpan } from "@/lib/mock-observability";
import { KIND_META, STATUS_META } from "./ui";

export function Timeline({
  spans,
  selectedId,
  onSelect,
}: {
  spans: DemoSpan[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const total = useMemo(() => Math.max(...spans.map((s) => s.startMs + s.durationMs), 1), [spans]);

  return (
    <div className="py-2">
      {spans.map((s) => {
        const left = (s.startMs / total) * 100;
        const width = Math.max((s.durationMs / total) * 100, 0.8);
        const m = KIND_META[s.kind];
        const isSel = s.id === selectedId;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full grid grid-cols-[minmax(0,240px)_1fr] items-center gap-3 px-4 py-1.5 text-left transition-colors ${
              isSel ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <m.Icon className={`w-3.5 h-3.5 flex-shrink-0 ${m.tone}`} strokeWidth={1.75} />
              <span className={`font-mono text-[12px] truncate ${isSel ? "text-zinc-100" : "text-zinc-300"}`}>{s.name}</span>
            </span>
            <span className="relative h-4">
              <span
                className={`absolute top-1/2 -translate-y-1/2 h-2 rounded-sm ${STATUS_META[s.status].bar}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
              <span
                className="absolute top-1/2 -translate-y-1/2 font-mono text-[10px] text-zinc-500 tabular-nums"
                style={{ left: `calc(${Math.min(left + width, 84)}% + 6px)` }}
              >
                {s.durationMs}ms
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
