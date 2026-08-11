"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReplaySandbox } from "@/components/ReplaySandbox";
import { api } from "@/lib/api";

interface PageProps {
  params: { id: string };
}

const SEV_STYLE: Record<string, string> = {
  P1: "text-red-300 bg-red-500/15 border-red-500/40",
  P2: "text-amber-300 bg-amber-500/15 border-amber-500/40",
  P3: "text-yellow-300 bg-yellow-500/15 border-yellow-500/40",
};

export default function ReplayPage({ params }: PageProps) {
  const [title, setTitle] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");

  useEffect(() => {
    let active = true;
    api.getTrace(params.id).then((tg) => {
      if (!active) return;
      const incident = tg.nodes.find((n) => n.layer === "INCIDENT");
      const p = (incident?.payload ?? {}) as Record<string, unknown>;
      setTitle((p["title"] as string) ?? "");
      setSeverity((p["severity"] as string) ?? "");
    }).catch(() => { /* keep bare header on failure */ });
    return () => { active = false; };
  }, [params.id]);

  return (
    <div className="h-full flex flex-col bg-black">
      <header className="border-b border-white/10 px-6 py-4 flex items-center gap-3" style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.85)" }}>
        <Link href={`/incidents/${params.id}`} className="text-white/65 hover:text-white transition-colors duration-200">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <span className="font-mono text-[10px] tracking-[0.18em] text-white/50 uppercase">Replay Sandbox</span>
        {severity && (
          <span className={`font-mono text-[10px] tracking-[0.1em] uppercase px-2 py-0.5 rounded border font-semibold ${SEV_STYLE[severity] ?? SEV_STYLE.P3}`}>
            {severity}
          </span>
        )}
        <h1 className="text-[14px] font-medium text-white tracking-tight truncate min-w-0">
          {title || "Verify your fix"}
        </h1>
      </header>
      <div className="flex-1 overflow-hidden">
        <ReplaySandbox rootNodeId={params.id} />
      </div>
    </div>
  );
}
