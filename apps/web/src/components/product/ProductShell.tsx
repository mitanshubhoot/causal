"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/LogoMark";
import { ProductNav, NAV_ITEMS } from "./ProductNav";

/**
 * Page frame for the product's non-tracing surfaces.
 *
 * The trace explorer builds its own chrome because it manages five resizable
 * panes; everything else — detectors, evals, dashboard — is a single scrolling
 * column and shares this shell. The rail is lg-only, so a horizontal tab strip
 * carries the same navigation on narrow screens.
 */
export function ProductShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="h-full flex bg-[#0a0a0b] text-zinc-300 overflow-hidden">
      <ProductNav />
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile/tablet header — the rail is hidden below lg. */}
        <div className="lg:hidden flex-shrink-0 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 px-4 h-12">
            <Link href="/" className="flex items-center gap-2">
              <LogoMark size={18} />
              <span className="text-[14px] font-semibold text-zinc-100 tracking-tight">Causal</span>
            </Link>
          </div>
          <nav className="flex items-center gap-1 px-2 pb-2 overflow-x-auto">
            {NAV_ITEMS.map(({ href, label, Icon, match }) => {
              const active = match.test(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1 rounded-md text-[12.5px] transition-colors ${
                    active ? "bg-white/[0.06] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </main>
    </div>
  );
}
