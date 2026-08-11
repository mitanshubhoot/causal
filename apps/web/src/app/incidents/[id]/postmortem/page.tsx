"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, FileText, Copy, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";
import ReactMarkdown, { type Components } from "react-markdown";

interface PageProps {
  params: { id: string };
}

// Hand-styled markdown — avoids depending on @tailwindcss/typography.
const MD_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="text-[26px] font-light tracking-[-0.02em] text-white mb-4 mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[13px] font-mono font-semibold tracking-[0.18em] uppercase text-white/50 mt-8 mb-3 pb-2 border-b border-white/10">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[15px] font-medium text-white/90 mt-5 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-[14px] text-white/75 leading-relaxed mb-4">{children}</p>
  ),
  ul: ({ children }) => <ul className="space-y-1.5 mb-4 ml-1">{children}</ul>,
  ol: ({ children }) => <ol className="space-y-1.5 mb-4 ml-5 list-decimal marker:text-white/40">{children}</ol>,
  li: ({ children }) => <li className="text-[14px] text-white/75 leading-relaxed pl-1">{children}</li>,
  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-cyan-400/50 bg-cyan-400/[0.05] pl-4 py-2 my-4 text-[14px] text-white/85 italic rounded-r">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="font-mono text-[12.5px] text-violet-300 bg-white/[0.06] px-1.5 py-0.5 rounded">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="font-mono text-[12.5px] text-white/85 bg-white/[0.04] border border-white/10 rounded-lg p-4 overflow-x-auto leading-relaxed my-4">
      {children}
    </pre>
  ),
};

export default function PostMortemPage({ params }: PageProps) {
  const [result, setResult] = useState<{
    id: string;
    markdown: string;
    linearTicket: Record<string, unknown>;
    claudeMdRule: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      // Small floor so "Generating…" reads as real work rather than a flash,
      // even when the mock resolves instantly.
      const [res] = await Promise.all([
        api.generatePostMortem({ rootNodeId: params.id }),
        new Promise((r) => setTimeout(r, 1100)),
      ]);
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  const copyMarkdown = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col bg-black">
      <header className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-4" style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.85)" }}>
        <Link href={`/incidents/${params.id}`} className="text-white/30 hover:text-white/60 transition-colors duration-300">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-[14px] font-medium text-white tracking-wide">Post-Mortem Generator</h1>
        <span className="font-mono text-[11px] tracking-[0.1em] text-white/20">{params.id.slice(0, 8)}</span>

        <div className="ml-auto flex items-center gap-3">
          {result && (
            <button
              onClick={copyMarkdown}
              className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.12em] uppercase text-white/40 border border-white/[0.08] px-4 py-2 rounded-full hover:border-white/20 hover:text-white/60 transition-all duration-300"
            >
              {copied ? <CheckCircle className="w-3 h-3 text-emerald-400/60" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy MD"}
            </button>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.12em] uppercase text-white bg-white/10 border border-white/[0.12] px-4 py-2 rounded-full hover:bg-white/15 hover:border-white/25 transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" /> Generating...</>
            ) : (
              <><FileText className="w-3 h-3" /> Generate</>
            )}
          </button>
        </div>
      </header>

      {!result && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="text-center max-w-sm"
          >
            <div className="w-12 h-12 rounded-full border border-white/[0.06] flex items-center justify-center mx-auto mb-5">
              <FileText className="w-5 h-5 text-white/15" />
            </div>
            <h2 className="text-[16px] font-medium text-white mb-2">Generate Post-Mortem</h2>
            <p className="text-[13px] text-white/55 mb-8 leading-relaxed">
              Causal will generate a structured post-mortem from the causal chain, including root cause, counterfactual, and action items.
            </p>
            <button
              onClick={generate}
              className="font-mono text-[11px] tracking-[0.15em] uppercase text-white bg-white/10 border border-white/[0.12] px-6 py-2.5 rounded-full hover:bg-white/15 hover:border-white/25 transition-all duration-300"
            >
              Generate Post-Mortem
            </button>
          </motion.div>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3 text-white/25">
            <div className="w-5 h-5 border border-white/10 border-t-violet-400/50 rounded-full animate-spin" />
            <span className="font-mono text-[11px] tracking-[0.15em] uppercase">Generating post-mortem...</span>
          </div>
        </div>
      )}

      {result && (
        <div className="flex-1 overflow-hidden flex">
          {/* Main markdown */}
          <div className="flex-1 overflow-y-auto px-8 py-8">
            <div className="max-w-3xl mx-auto">
              <ReactMarkdown components={MD_COMPONENTS}>{result.markdown}</ReactMarkdown>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-80 border-l border-white/[0.06] overflow-y-auto p-5 space-y-5">
            {/* Linear ticket */}
            <div className="border border-white/[0.06] rounded-xl p-4 bg-white/[0.01]">
              <h3 className="font-mono text-[9px] tracking-[0.2em] text-white/25 uppercase mb-3 flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500/30 rounded-sm" />
                Linear Ticket
              </h3>
              <p className="text-[12px] font-medium text-white/80 mb-1">
                {result.linearTicket.title as string}
              </p>
              <p className="text-[11px] text-white/50 mb-3 leading-relaxed">
                {(() => {
                  const d = (result.linearTicket.description as string) ?? "";
                  return d.length > 140 ? d.slice(0, 140) + "…" : d;
                })()}
              </p>
              <div className="flex flex-wrap gap-1 mb-3">
                {(result.linearTicket.labels as string[])?.map((l) => (
                  <span key={l} className="font-mono text-[9px] tracking-[0.1em] text-white/45 bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 rounded-full uppercase">
                    {l}
                  </span>
                ))}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(JSON.stringify(result.linearTicket, null, 2))}
                className="w-full font-mono text-[10px] tracking-[0.1em] uppercase text-white/25 bg-white/[0.02] border border-white/[0.06] py-2 rounded-lg hover:bg-white/[0.04] hover:text-white/40 transition-all duration-200"
              >
                Copy as JSON
              </button>
            </div>

            {/* CLAUDE.md rule */}
            <div className="border border-white/[0.06] rounded-xl p-4 bg-white/[0.01]">
              <h3 className="font-mono text-[9px] tracking-[0.2em] text-violet-300/80 uppercase mb-3">CLAUDE.md Rule</h3>
              <pre className="text-[11px] text-white/70 font-mono whitespace-pre-wrap leading-relaxed mb-3 bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
                {result.claudeMdRule}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(result.claudeMdRule)}
                className="w-full font-mono text-[10px] tracking-[0.1em] uppercase text-white/25 bg-white/[0.02] border border-white/[0.06] py-2 rounded-lg hover:bg-white/[0.04] hover:text-white/40 transition-all duration-200"
              >
                Copy Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
