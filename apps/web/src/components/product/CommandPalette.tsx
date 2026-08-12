"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

/** ⌘K command palette — jump between traces, views, and actions.
 *  Opens on ⌘K / Ctrl-K; arrow keys + enter to run; Esc to close. */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(query) || c.group.toLowerCase().includes(query));
  }, [q, commands]);

  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    c.run();
    setOpen(false);
  };

  // group order preserved by first appearance
  const groups: string[] = [];
  for (const c of filtered) if (!groups.includes(c.group)) groups.push(c.group);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#111114] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 h-11 border-b border-white/[0.06]">
          <Search className="w-4 h-4 text-zinc-600" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); run(filtered[idx]); }
            }}
            placeholder="Jump to a trace, view, or action…"
            className="flex-1 bg-transparent outline-none text-[13px] text-zinc-100 placeholder:text-zinc-600"
          />
          <kbd className="font-mono text-[9px] text-zinc-600 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div className="max-h-[52vh] overflow-auto py-1.5">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center font-mono text-[11px] text-zinc-600">No matches.</p>
          )}
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <p className="px-4 pt-2 pb-1 font-mono text-[9px] tracking-[0.14em] uppercase text-zinc-600">{g}</p>
              {filtered.filter((c) => c.group === g).map((c) => {
                const globalIndex = filtered.indexOf(c);
                const active = globalIndex === idx;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setIdx(globalIndex)}
                    onClick={() => run(c)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${active ? "bg-white/[0.06]" : ""}`}
                  >
                    <span className={`text-[13px] truncate ${active ? "text-zinc-100" : "text-zinc-300"}`}>{c.label}</span>
                    {c.hint && <span className="font-mono text-[10px] text-zinc-600 truncate">{c.hint}</span>}
                    {active && <CornerDownLeft className="w-3 h-3 text-zinc-500 ml-auto flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
