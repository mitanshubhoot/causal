"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check, X, Terminal, Sparkles, Bot } from "lucide-react";

type TabId = "cli" | "prompt" | "skills";

// The skills live at the repo root, not under packages/ — this prompt is the
// landing page's primary conversion path and a 404 dead-ends it.
const AGENT_PROMPT = `Install the Causal AI skill from https://github.com/mitanshubhoot/causal/tree/main/skills/causal-instrument-repo and use it to add tracing to this application with Causal, following best practices.

Specifically:
1. Install the SDK (\`npm i @causal/sdk\` or \`pip install causal-sdk\`).
2. Wrap the application's agent entry points with the Causal tracer so every LLM call, tool call, and sub-agent step is captured as a nested span.
3. Attach git context (file, line, commit) to spans that execute application code.
4. Record tokens and cost on every LLM span.
5. Set CAUSAL_API_KEY and CAUSAL_API_URL from the environment; never hard-code them.
6. Verify by running the app once and confirming a trace appears in the Causal dashboard.`;

const TABS: { id: TabId; label: string; Icon: typeof Terminal; command: string; note: string }[] = [
  {
    id: "cli",
    label: "CLI",
    Icon: Terminal,
    command: "npm install -g @causal/cli",
    note: "Then run `causal init` in your repo to scaffold instrumentation and write a .env template.",
  },
  {
    id: "prompt",
    label: "Prompt",
    Icon: Bot,
    command: "Instrument your app with one prompt",
    note: "Paste this into Claude Code, Cursor, or any coding agent — it installs the SDK and wires up tracing for you.",
  },
  {
    id: "skills",
    label: "Skills",
    Icon: Sparkles,
    command: "npx skills add mitanshubhoot/causal",
    note: "Installs the Causal Agent Skills into .claude/skills so your coding agent knows how to instrument, debug, and query Causal.",
  },
];

function CopyBtn({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="flex items-center gap-1.5 font-mono text-[11px] text-white/45 hover:text-white/80 transition-colors flex-shrink-0"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function InstallWidget() {
  const [tab, setTab] = useState<TabId>("cli");
  const [showPrompt, setShowPrompt] = useState(false);
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-2xl mx-auto rounded-xl border border-white/[0.08] overflow-hidden bg-white/[0.015]"
      >
        {/* Tabs */}
        <div className="flex items-center gap-1 px-2 pt-2 border-b border-white/[0.06]">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[11px] tracking-[0.1em] uppercase rounded-t-md border-b-2 -mb-px transition-colors ${
                tab === id
                  ? "border-white/70 text-white bg-white/[0.04]"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>

        {/* Command row */}
        <div className="flex items-center gap-3 px-5 py-4">
          {tab === "prompt" ? (
            <button
              onClick={() => setShowPrompt(true)}
              className="flex-1 text-left font-mono text-[13px] text-white/80 hover:text-white transition-colors truncate"
            >
              <span className="text-violet-300/80">▸</span> {active.command}
            </button>
          ) : (
            <code className="flex-1 font-mono text-[13px] text-white/85 truncate">
              <span className="text-violet-300/80">{active.command.split(" ")[0]}</span>
              {active.command.slice(active.command.indexOf(" "))}
            </code>
          )}
          <CopyBtn value={tab === "prompt" ? AGENT_PROMPT : active.command} />
        </div>

        {/* Note */}
        <div className="px-5 pb-4">
          <p className="text-[12.5px] text-white/35 leading-relaxed">{active.note}</p>
          {tab === "prompt" && (
            <button
              onClick={() => setShowPrompt(true)}
              className="mt-2 font-mono text-[11px] text-white/50 hover:text-white/80 underline underline-offset-4 transition-colors"
            >
              View full prompt
            </button>
          )}
        </div>
      </motion.div>

      {/* Full prompt modal */}
      {showPrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={() => setShowPrompt(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#0b0b0d] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 h-12 border-b border-white/[0.08]">
              <span className="text-[14px] text-white/90 font-medium">Full prompt</span>
              <div className="ml-auto flex items-center gap-4">
                <CopyBtn value={AGENT_PROMPT} />
                <button onClick={() => setShowPrompt(false)} className="text-white/40 hover:text-white/80 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <pre className="px-5 py-4 font-mono text-[12.5px] leading-relaxed text-white/70 whitespace-pre-wrap max-h-[60vh] overflow-auto">
              {AGENT_PROMPT}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
