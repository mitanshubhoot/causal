"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { getMockTrace, MOCK_INCIDENTS, FEATURED_INCIDENT_ID } from "@/lib/mock-data";
import { ScrambleText } from "./ScrambleText";

// Lazy-load the real product component so it never competes with hero LCP.
const TraceExplorer = dynamic(
  () => import("./TraceExplorer").then((m) => m.TraceExplorer),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-white/40">
          <div className="w-4 h-4 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
          <span className="font-mono text-[11px] tracking-[0.15em] uppercase">Assembling causal graph…</span>
        </div>
      </div>
    ),
  }
);

const SEV_DOT: Record<string, string> = {
  P1: "bg-red-400",
  P2: "bg-amber-400",
  P3: "bg-yellow-400",
};

function tabMeta(id: string) {
  const tg = getMockTrace(id);
  const incident = tg.nodes.find((n) => n.layer === "INCIDENT");
  const p = (incident?.payload ?? {}) as Record<string, unknown>;
  return {
    id,
    externalId: (p["externalId"] as string) ?? id.slice(0, 8),
    severity: (p["severity"] as string) ?? "P3",
    trace: tg,
  };
}

export function LandingTraceDemo() {
  const tabs = useMemo(() => {
    const ids = [FEATURED_INCIDENT_ID, ...MOCK_INCIDENTS.map((i) => i.id).filter((i) => i !== FEATURED_INCIDENT_ID)];
    return ids.map(tabMeta);
  }, []);
  const [activeId, setActiveId] = useState(FEATURED_INCIDENT_ID);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]!;

  return (
    <section className="relative border-b border-white/[0.06] px-4 sm:px-8 py-24">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8 text-center"
        >
          <ScrambleText text="[ NOT A SCREENSHOT ]" className="font-mono text-[11px] tracking-[0.25em] text-cyan-300/70 uppercase" />
          <h2 className="mt-4 text-[34px] sm:text-[48px] font-light tracking-[-0.03em] text-white leading-tight">
            Investigate it yourself
          </h2>
          <p className="mt-3 text-[15px] text-white/55 max-w-xl mx-auto">
            This is the real product, running live on the page. Walk the six-layer chain,
            open the root cause, switch incidents — no signup, no backend.
          </p>
        </motion.div>

        {/* Incident switcher */}
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={`flex items-center gap-2 flex-shrink-0 font-mono text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 rounded-full border transition-all duration-200 ${
                t.id === activeId
                  ? "border-white/30 text-white/85 bg-white/[0.06]"
                  : "border-white/[0.08] text-white/40 hover:border-white/20 hover:text-white/65"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${SEV_DOT[t.severity] ?? "bg-white/40"}`} />
              {t.externalId}
            </button>
          ))}
        </div>

        {/* Browser-chrome frame */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-white/10 overflow-hidden bg-black shadow-[0_40px_120px_-40px_rgba(8,145,178,0.25)]"
        >
          {/* Chrome bar */}
          <div className="flex items-center gap-3 px-4 h-10 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
            </div>
            <div className="flex-1 flex justify-center">
              <span className="font-mono text-[10px] tracking-[0.08em] text-white/35 bg-black/40 border border-white/[0.06] rounded px-3 py-0.5">
                causal.app/incidents/{active.externalId}
              </span>
            </div>
          </div>

          {/* Real TraceExplorer — horizontally scrollable on small screens so its
              fixed 340px sidebar never crushes the detail panel. */}
          <div className="overflow-x-auto">
            <div className="min-w-[760px] h-[560px]">
              <TraceExplorer key={active.id} traceGraph={active.trace} />
            </div>
          </div>
        </motion.div>

        <div className="mt-6 flex justify-center">
          <Link
            href={`/incidents/${active.id}`}
            className="group flex items-center gap-1.5 font-mono text-[11px] tracking-[0.15em] uppercase text-white/60 border border-white/[0.12] px-5 py-2.5 rounded-full hover:border-white/30 hover:text-white/90 transition-all duration-200"
          >
            Open the full incident
            <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
