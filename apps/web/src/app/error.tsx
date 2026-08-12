"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { LogoMark } from "@/components/LogoMark";

/** Error boundary for every route. Without it a single thrown render — a trace
 *  with no spans was enough — white-screened the whole product. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[causal] route error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[#0a0a0b] text-zinc-300 p-6 text-center">
      <Link href="/" className="flex items-center gap-2">
        <LogoMark size={24} />
        <span className="text-[14px] font-semibold text-zinc-100 tracking-tight">Causal</span>
      </Link>
      <div>
        <p className="flex items-center justify-center gap-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-red-400/90 mb-2">
          <AlertTriangle className="w-3 h-3" />
          Something broke
        </p>
        <h1 className="text-[22px] font-medium text-zinc-100 tracking-tight">This view failed to render</h1>
        {/* The message, not a guess at the cause. */}
        <p className="text-[13px] text-zinc-500 mt-1 max-w-md break-words">{error.message || "No error message was reported."}</p>
        {error.digest && <p className="font-mono text-[10.5px] text-zinc-600 mt-2">digest {error.digest}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={reset}
          className="font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-3 py-1.5 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
        >
          Try again
        </button>
        <Link
          href="/incidents"
          className="font-mono text-[11px] text-zinc-500 hover:text-zinc-300 px-3 py-1.5 transition-colors"
        >
          All incidents
        </Link>
      </div>
    </div>
  );
}
