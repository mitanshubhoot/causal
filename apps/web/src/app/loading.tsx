import { LogoMark } from "@/components/LogoMark";

/** Route-level loading state. Without it a slow segment showed the previous
 *  page's content under the new URL. */
export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0a0a0b] text-zinc-300 p-6">
      <span className="animate-pulse">
        <LogoMark size={28} />
      </span>
      <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-zinc-600">Loading</span>
    </div>
  );
}
