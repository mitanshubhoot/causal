import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";

/** 404. Routes that key on an id call `notFound()` rather than substituting a
 *  record that exists — an unknown trace id used to render a real incident's
 *  data under it. */
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[#0a0a0b] text-zinc-300 p-6 text-center">
      <Link href="/" className="flex items-center gap-2">
        <LogoMark size={24} />
        <span className="text-[14px] font-semibold text-zinc-100 tracking-tight">Causal</span>
      </Link>
      <div>
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-zinc-600 mb-2">404 — not found</p>
        <h1 className="text-[22px] font-medium text-zinc-100 tracking-tight">Nothing here</h1>
        <p className="text-[13px] text-zinc-500 mt-1 max-w-md">
          This trace or incident does not exist in this workspace.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/incidents"
          className="font-mono text-[11px] text-zinc-300 border border-white/10 rounded-md px-3 py-1.5 hover:border-white/25 hover:bg-white/[0.03] transition-colors"
        >
          All incidents
        </Link>
        <Link
          href="/"
          className="font-mono text-[11px] text-zinc-500 hover:text-zinc-300 px-3 py-1.5 transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
