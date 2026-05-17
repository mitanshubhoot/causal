"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Search,
  Activity,
  ArrowUpRight,
  Clock,
  Zap,
  Shield,
  Filter,
  Circle,
} from "lucide-react";
import { api } from "@/lib/api";

// ── Animation variants (matching landing page) ──────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};
const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};
const cardVariant = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

// ── Severity config ──────────────────────────────────────────────
const SEVERITY_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  P1:       { color: "text-red-400",    bg: "bg-red-400/10",    border: "border-red-400/20",    label: "P1 · CRITICAL" },
  P2:       { color: "text-amber-400",  bg: "bg-amber-400/10",  border: "border-amber-400/20",  label: "P2 · HIGH" },
  P3:       { color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/20", label: "P3 · MEDIUM" },
  P4:       { color: "text-white/40",   bg: "bg-white/5",       border: "border-white/10",      label: "P4 · LOW" },
};

// ── Status config — give incidents realistic status based on age ─
function getIncidentStatus(timestamp: string): { label: string; color: string; dotColor: string } {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < 2) return { label: "Investigating", color: "text-red-400/70", dotColor: "bg-red-400" };
  if (ageHours < 6) return { label: "Identified", color: "text-amber-400/70", dotColor: "bg-amber-400" };
  return { label: "Mitigated", color: "text-emerald-400/60", dotColor: "bg-emerald-400/60" };
}

const SOURCE_ICONS: Record<string, string> = {
  sentry: "SEN",
  pagerduty: "PD",
  manual: "MAN",
};

interface IncidentRow {
  id: string;
  layer: string;
  kind: string;
  timestamp: string;
  agent_id: string | null;
  payload_text: string;
}

function parseSeverity(text: string): string {
  for (const sev of ["P1", "P2", "P3", "P4"]) {
    if (text.includes(sev)) return sev;
  }
  return "P3";
}

function parseSource(text: string): string {
  const lower = text.toLowerCase();
  for (const src of ["sentry", "pagerduty", "manual"]) {
    if (lower.includes(src)) return src;
  }
  return "manual";
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getIncidents();
        setIncidents(data.nodes as IncidentRow[]);
      } catch (err) {
        console.error("Failed to load incidents:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = incidents.filter((inc) => {
    const text = inc.payload_text?.toLowerCase() ?? "";
    const matchesSearch = !searchQuery || text.includes(searchQuery.toLowerCase());
    const severity = parseSeverity(inc.payload_text ?? "");
    const matchesSeverity = severityFilter === "all" || severity === severityFilter;
    return matchesSearch && matchesSeverity;
  });

  const stats = {
    total: incidents.length,
    p1: incidents.filter(i => parseSeverity(i.payload_text ?? "") === "P1").length,
    p2: incidents.filter(i => parseSeverity(i.payload_text ?? "") === "P2").length,
    p3: incidents.filter(i => parseSeverity(i.payload_text ?? "") === "P3").length,
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.06]" style={{ backdropFilter: "blur(20px) saturate(1.4)", WebkitBackdropFilter: "blur(20px) saturate(1.4)", background: "rgba(0,0,0,0.75)" }}>
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-6 h-6 relative">
              <div className="absolute inset-0 rounded-full border border-white/20" />
              <div className="absolute inset-[3px] rounded-full border border-white/40" />
              <div className="absolute inset-[6px] rounded-full bg-white/80" />
            </div>
            <span className="text-[14px] font-medium text-white tracking-wide">Causal</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/" className="font-mono text-[11px] tracking-[0.15em] text-white/30 hover:text-white/60 transition-colors uppercase">
              Home
            </Link>
            <span className="font-mono text-[11px] tracking-[0.15em] text-white/60 uppercase border-b border-white/30 pb-0.5">
              Incidents
            </span>
          </div>
        </div>
      </nav>

      <div className="pt-16">
        {/* Header section */}
        <section className="border-b border-white/[0.06] px-8 py-16">
          <div className="max-w-7xl mx-auto">
            <motion.div variants={staggerContainer} initial="hidden" animate="visible">
              <motion.p variants={fadeUp} className="font-mono text-[11px] tracking-[0.25em] text-white/25 uppercase mb-4">
                [ INCIDENT DASHBOARD ]
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-[40px] sm:text-[56px] font-light tracking-[-0.03em] text-white mb-6">
                Active Incidents
              </motion.h1>
              <motion.p variants={fadeUp} className="text-[15px] text-white/30 max-w-lg">
                Monitor, diagnose, and resolve AI agent failures. Click any incident to explore the full causal graph.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Stats bar */}
        <section className="border-b border-white/[0.06]">
          <div className="max-w-7xl mx-auto">
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-2 lg:grid-cols-4 gap-[1px] bg-white/[0.06]"
            >
              {[
                { label: "Total Incidents", value: stats.total, icon: AlertTriangle },
                { label: "P1 Critical", value: stats.p1, icon: Zap, highlight: stats.p1 > 0 ? "text-red-400" : undefined },
                { label: "P2 High", value: stats.p2, icon: Activity, highlight: stats.p2 > 0 ? "text-amber-400" : undefined },
                { label: "P3 Medium", value: stats.p3, icon: Shield },
              ].map(({ label, value, icon: Icon, highlight }) => (
                <motion.div key={label} variants={cardVariant} className="bg-black px-8 py-6 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-white/40" />
                  </div>
                  <div>
                    <p className={`text-[28px] font-light tabular-nums ${highlight ?? "text-white"}`}>{value}</p>
                    <p className="font-mono text-[10px] tracking-[0.15em] text-white/25 uppercase">{label}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Search + filters */}
        <section className="border-b border-white/[0.06] px-8 py-6">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
              <input
                type="text"
                placeholder="Search incidents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg pl-11 pr-4 py-2.5 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors font-mono"
                id="incidents-search"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-white/20" />
              {["all", "P1", "P2", "P3"].map((sev) => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  className={`font-mono text-[10px] tracking-[0.15em] uppercase px-3 py-1.5 rounded-full border transition-all duration-200 ${
                    severityFilter === sev
                      ? "border-white/30 text-white/70 bg-white/[0.06]"
                      : "border-white/[0.06] text-white/25 hover:border-white/15 hover:text-white/40"
                  }`}
                  id={`filter-${sev}`}
                >
                  {sev === "all" ? "All" : sev}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Incident list */}
        <section className="px-8 py-8">
          <div className="max-w-7xl mx-auto">
            {loading ? (
              <div className="flex items-center justify-center py-32">
                <div className="flex items-center gap-3 text-white/30">
                  <div className="w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
                  <span className="font-mono text-[12px] tracking-[0.1em] uppercase">Loading incidents...</span>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 text-center">
                <AlertTriangle className="w-8 h-8 text-white/10 mb-4" />
                <p className="text-[14px] text-white/30 mb-2">No incidents found</p>
                <p className="text-[12px] text-white/15 font-mono">Run the seed script to populate demo data</p>
              </div>
            ) : (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="space-y-[1px] bg-white/[0.06] rounded-xl overflow-hidden"
              >
                {filtered.map((incident) => {
                  const severity = parseSeverity(incident.payload_text ?? "");
                  const source = parseSource(incident.payload_text ?? "");
                  const sevConfig = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.P3!;
                  const title = extractTitle(incident.payload_text ?? "");
                  const timestamp = new Date(incident.timestamp);
                  const timeAgo = getTimeAgo(timestamp);
                  const status = getIncidentStatus(incident.timestamp);

                  return (
                    <motion.div key={incident.id} variants={cardVariant}>
                      <Link
                        href={`/incidents/${incident.id}`}
                        className="flex items-center gap-6 bg-black px-8 py-5 group hover:bg-white/[0.02] transition-colors duration-300"
                        id={`incident-${incident.id.slice(0, 8)}`}
                      >
                        {/* Severity indicator */}
                        <div className={`flex-shrink-0 w-2 h-2 rounded-full ${sevConfig.color.replace("text-", "bg-")}`} />

                        {/* Main content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1.5">
                            <h3 className="text-[14px] font-medium text-white truncate group-hover:text-white/90 transition-colors">
                              {title}
                            </h3>
                          </div>
                          <div className="flex items-center gap-4 flex-wrap">
                            <span className={`font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-0.5 rounded border ${sevConfig.color} ${sevConfig.bg} ${sevConfig.border}`}>
                              {sevConfig.label}
                            </span>
                            {/* Status badge */}
                            <span className={`flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] uppercase ${status.color}`}>
                              <Circle className={`w-1.5 h-1.5 ${status.dotColor} rounded-full fill-current`} />
                              {status.label}
                            </span>
                            <span className="font-mono text-[10px] tracking-[0.1em] text-white/20 uppercase">
                              {SOURCE_ICONS[source] ?? "SRC"} · {incident.kind.replace("_", " ")}
                            </span>
                            <span className="flex items-center gap-1 text-white/15">
                              <Clock className="w-3 h-3" />
                              <span className="font-mono text-[10px] tracking-[0.05em]">{timeAgo}</span>
                            </span>
                          </div>
                        </div>

                        {/* Diagnose button */}
                        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.15em] text-white/50 uppercase border border-white/[0.12] px-4 py-2 rounded-full hover:border-white/25 hover:text-white/70 transition-all duration-200">
                            Diagnose <ArrowUpRight className="w-3 h-3" />
                          </span>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────
function extractTitle(payloadText: string): string {
  // The payload_text contains the external ID and title at the start.
  // Pattern: "SENTRY-4821 Wrong appointment day booked — ..."
  // or: "PD-7392 Stock price KeyError: ..."
  // First, try to extract between the external ID and the description
  const match = payloadText.match(/^(?:[A-Z]+-\d+\s+)?(.+?)(?:\s+(?:Patient|The agent|Monthly|Agent|Error)\s)/);
  if (match?.[1] && match[1].length > 15) return match[1];

  // Fallback: try sentences that look like titles
  const sentences = payloadText.split(/[.!]/).filter(s => s.trim().length > 10);
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length > 15 && trimmed.length < 120 && /^[A-Z]/.test(trimmed)) {
      return trimmed;
    }
  }
  // Last resort: first 80 chars
  return payloadText.slice(0, 80) + (payloadText.length > 80 ? "..." : "");
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
