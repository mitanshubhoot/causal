"use client";

import { useEffect, useState } from "react";

// Deterministic carnage assembled from the real demo incidents (mock-data.ts).
// Labeled SIMULATED FEED so it reads as illustrative, not fabricated telemetry.
const EVENTS: { agent: string; err: string; sev: "P1" | "P2" | "P3" }[] = [
  { agent: "storefront-checkout", err: "AttributeError: checkout_v2_enabled removed", sev: "P1" },
  { agent: "stock-tool-agent", err: "KeyError: 'change' on NVDA", sev: "P1" },
  { agent: "healthcare-voice-bot", err: "ASR booked Thursday, meant Tuesday (0.61)", sev: "P2" },
  { agent: "billing-agent", err: "$4,200 invoice → wrong customer", sev: "P3" },
  { agent: "storefront-checkout", err: "POST /checkout 500 · 34% traffic on legacy path", sev: "P1" },
  { agent: "stock-tool-agent", err: "tool crashed 4× identically", sev: "P1" },
  { agent: "billing-agent", err: "index-based lookup off-by-one", sev: "P3" },
  { agent: "healthcare-voice-bot", err: "confirmation skipped for latency SLA", sev: "P2" },
];

const SEV_COLOR: Record<string, string> = {
  P1: "text-red-400",
  P2: "text-amber-400",
  P3: "text-yellow-400",
};

function clock(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

export function FailureTicker() {
  // Render a stable placeholder on the server; start the live clock after mount
  // to avoid hydration mismatch.
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    setNow(clock(new Date()));
    const id = setInterval(() => setNow(clock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  const row = [...EVENTS, ...EVENTS]; // doubled for a seamless marquee loop

  return (
    <div className="relative py-3.5 border-y border-white/[0.06] overflow-hidden bg-black/40">
      {/* Honesty + live-clock chip */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center gap-2 pl-8 pr-6 bg-gradient-to-r from-black via-black to-transparent">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        <span className="font-mono text-[10px] tracking-[0.2em] text-white/45 uppercase">Simulated Feed</span>
        <span className="font-mono text-[10px] tabular-nums text-white/30">{now ?? "--:--:--"}</span>
      </div>

      <div className="flex ticker-track" style={{ width: "max-content" }}>
        {row.map((e, i) => (
          <span key={i} className="flex items-center gap-2.5 whitespace-nowrap px-6 font-mono text-[11px]">
            <span className={`${SEV_COLOR[e.sev]} font-semibold`}>{e.sev}</span>
            <span className="text-white/45">{e.agent}</span>
            <span className="text-white/25">›</span>
            <span className="text-white/60">{e.err}</span>
            <span className="ml-4 text-white/10">·</span>
          </span>
        ))}
      </div>

      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-black to-transparent" />
    </div>
  );
}
