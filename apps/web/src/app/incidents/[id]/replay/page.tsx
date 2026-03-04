"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReplaySandbox } from "@/components/ReplaySandbox";

interface PageProps {
  params: { id: string };
}

export default function ReplayPage({ params }: PageProps) {
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href={`/incidents/${params.id}`} className="text-gray-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-lg font-semibold text-white">Replay Sandbox</h1>
        <span className="text-sm text-gray-500 font-mono">{params.id.slice(0, 8)}</span>
      </header>
      <div className="flex-1 overflow-hidden">
        <ReplaySandbox rootNodeId={params.id} />
      </div>
    </div>
  );
}
