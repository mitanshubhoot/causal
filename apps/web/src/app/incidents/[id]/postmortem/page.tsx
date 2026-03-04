"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Copy, ExternalLink, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";
import ReactMarkdown from "react-markdown";

interface PageProps {
  params: { id: string };
}

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
      const res = await api.generatePostMortem({ rootNodeId: params.id });
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
    <div className="h-full flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href={`/incidents/${params.id}`} className="text-gray-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-lg font-semibold text-white">Post-Mortem Generator</h1>
        <span className="text-sm text-gray-500 font-mono">{params.id.slice(0, 8)}</span>

        <div className="ml-auto flex items-center gap-3">
          {result && (
            <button
              onClick={copyMarkdown}
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy Markdown"}
            </button>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-800 disabled:text-gray-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? (
              <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating...</>
            ) : (
              <><FileText className="w-3.5 h-3.5" /> Generate Post-Mortem</>
            )}
          </button>
        </div>
      </header>

      {!result && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <FileText className="w-10 h-10 text-gray-700 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-white mb-2">Generate Post-Mortem</h2>
            <p className="text-sm text-gray-500 mb-6">
              Causal will generate a structured post-mortem document from the causal chain,
              including root cause, counterfactual, and action items.
            </p>
            <button
              onClick={generate}
              className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Generate Post-Mortem
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3 text-gray-400">
            <div className="w-5 h-5 border-2 border-gray-700 border-t-violet-500 rounded-full animate-spin" />
            Generating post-mortem via Claude...
          </div>
        </div>
      )}

      {result && (
        <div className="flex-1 overflow-hidden flex">
          {/* Main markdown */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div className="max-w-3xl mx-auto prose prose-invert prose-sm">
              <ReactMarkdown>{result.markdown}</ReactMarkdown>
            </div>
          </div>

          {/* Sidebar: Linear ticket + CLAUDE.md */}
          <div className="w-80 border-l border-gray-800 overflow-y-auto p-4 space-y-4">
            {/* Linear ticket */}
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-600 rounded-sm" />
                Linear Ticket
              </h3>
              <p className="text-sm font-medium text-white mb-1">
                {result.linearTicket.title as string}
              </p>
              <p className="text-xs text-gray-400 mb-3">
                {(result.linearTicket.description as string)?.slice(0, 120)}...
              </p>
              <div className="flex flex-wrap gap-1 mb-3">
                {(result.linearTicket.labels as string[])?.map((l) => (
                  <span key={l} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                    {l}
                  </span>
                ))}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(JSON.stringify(result.linearTicket, null, 2))}
                className="w-full text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-1.5 rounded-lg transition-colors"
              >
                Copy as JSON
              </button>
            </div>

            {/* CLAUDE.md rule */}
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3">CLAUDE.md Rule</h3>
              <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap leading-relaxed mb-3">
                {result.claudeMdRule}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(result.claudeMdRule)}
                className="w-full text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-1.5 rounded-lg transition-colors"
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
