"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ObservabilityDemo } from "@/lib/mock-observability";
import {
  GitPullRequest, Waypoints, FileText, Database, Check, Clock, ChevronDown,
} from "lucide-react";

/**
 * Trace-level actions, pinned under the trace header.
 *
 * These used to live inside the Copilot conversation, where they scrolled out
 * of view as soon as the chat grew — so the product's most valuable outputs
 * became undiscoverable.
 *
 * The bar measures ITS OWN width rather than the viewport, because the trace
 * pane grows and shrinks as the user toggles the list and Copilot panes. Wide
 * enough → full labelled buttons. Too narrow → one "Actions" dropdown, so
 * nothing is ever silently trimmed off the edge.
 */

/** Below this the labelled buttons stop fitting and we collapse to a menu. */
const FULL_WIDTH_PX = 520;

export function TraceActions({
  demo,
  onOpenFixPr,
  onOpenGraph,
  onPromote,
}: {
  demo: ObservabilityDemo;
  onOpenFixPr: () => void;
  onOpenGraph: () => void;
  onPromote?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= FULL_WIDTH_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close the menu on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pr = demo.fixPr;
  const verified = pr?.status === "verified";

  const actions = [
    ...(pr
      ? [{
          key: "pr",
          label: `Fix PR #${pr.number}`,
          hint: verified ? "causal-replay passed" : "not yet verified",
          Icon: GitPullRequest,
          tone: "text-emerald-300",
          run: onOpenFixPr,
          badge: verified
            ? { Icon: Check, className: "text-emerald-400" }
            : { Icon: Clock, className: "text-amber-400" },
        }]
      : []),
    { key: "graph", label: "Causal graph", hint: "six-layer provenance chain", Icon: Waypoints, tone: "text-indigo-300/80", run: onOpenGraph },
    { key: "pm", label: "Post-mortem", hint: "generate the write-up", Icon: FileText, tone: "text-zinc-300", href: `/incidents/${demo.incidentId}/postmortem` },
    ...(demo.finding && onPromote
      ? [{ key: "eval", label: "Add to eval set", hint: "make this a golden case", Icon: Database, tone: "text-amber-300/80", run: onPromote }]
      : []),
  ];

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-1.5 px-3 h-10 border-b border-white/[0.06] flex-shrink-0 min-w-0"
    >
      {wide ? (
        actions.map((a) =>
          a.href ? (
            <Link
              key={a.key}
              href={a.href}
              title={a.hint}
              className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2 py-1 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
            >
              <a.Icon className={`w-3.5 h-3.5 ${a.tone}`} />
              {a.label}
            </Link>
          ) : (
            <button
              key={a.key}
              onClick={a.run}
              title={a.hint}
              className={`inline-flex items-center gap-1.5 flex-shrink-0 font-mono text-[11px] rounded-md border px-2 py-1 transition-colors ${
                a.key === "pr"
                  ? "text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12]"
                  : "text-zinc-300 border-white/10 hover:border-white/25 hover:bg-white/[0.03]"
              }`}
            >
              <a.Icon className={`w-3.5 h-3.5 ${a.key === "pr" ? "" : a.tone}`} />
              {a.label}
              {a.badge && <a.badge.Icon className={`w-3 h-3 ${a.badge.className}`} />}
            </button>
          )
        )
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-2 py-1 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
        >
          <GitPullRequest className="w-3.5 h-3.5 text-emerald-300" />
          Actions
          <span className="text-zinc-600">({actions.length})</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}

      {!wide && open && (
        <div className="absolute left-3 top-9 z-40 w-64 rounded-md border border-white/10 bg-[#111114] shadow-xl overflow-hidden">
          {actions.map((a) =>
            a.href ? (
              <Link
                key={a.key}
                href={a.href}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors"
              >
                <a.Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${a.tone}`} />
                <span className="min-w-0">
                  <span className="block font-mono text-[11.5px] text-zinc-200">{a.label}</span>
                  <span className="block text-[10.5px] text-zinc-600">{a.hint}</span>
                </span>
              </Link>
            ) : (
              <button
                key={a.key}
                onClick={() => { a.run?.(); setOpen(false); }}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
              >
                <a.Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${a.key === "pr" ? "text-emerald-300" : a.tone}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11.5px] text-zinc-200">{a.label}</span>
                    {a.badge && <a.badge.Icon className={`w-3 h-3 ${a.badge.className}`} />}
                  </span>
                  <span className="block text-[10.5px] text-zinc-600">{a.hint}</span>
                </span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
