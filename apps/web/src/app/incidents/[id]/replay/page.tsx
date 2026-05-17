"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReplaySandbox } from "@/components/ReplaySandbox";

interface PageProps {
  params: { id: string };
}

export default function ReplayPage({ params }: PageProps) {
  return (
    <div className="h-full flex flex-col bg-black">
      <header className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-4" style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.85)" }}>
        <Link href={`/incidents/${params.id}`} className="text-white/30 hover:text-white/60 transition-colors duration-300">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-[14px] font-medium text-white tracking-wide">Replay Sandbox</h1>
        <span className="font-mono text-[11px] tracking-[0.1em] text-white/20">{params.id.slice(0, 8)}</span>
      </header>
      <div className="flex-1 overflow-hidden">
        <ReplaySandbox rootNodeId={params.id} />
      </div>
    </div>
  );
}
