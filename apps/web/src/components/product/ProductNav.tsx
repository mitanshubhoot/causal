"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/LogoMark";
import { Activity, Eye, Database, LayoutGrid, Github, ArrowLeft } from "lucide-react";

const REPO_URL = "https://github.com/mitanshubhoot/causal";

/**
 * The product's left rail, shared by every surface.
 *
 * Datasets & Evals previously existed only as a tab INSIDE a single trace, so
 * a whole capability was undiscoverable unless you already knew to open an
 * incident and click through. Each view now has a real route and is reachable
 * from anywhere in the product.
 */
export const NAV_ITEMS = [
  { href: "/incidents", label: "Tracing", Icon: Activity, match: /^\/incidents/ },
  { href: "/detectors", label: "Detectors", Icon: Eye, match: /^\/detectors/ },
  { href: "/evals", label: "Datasets & Evals", Icon: Database, match: /^\/evals/ },
  { href: "/dashboard", label: "Dashboard", Icon: LayoutGrid, match: /^\/dashboard/ },
] as const;

export function ProductNav({
  activeHref,
  back = { href: "/", label: "Home" },
}: {
  activeHref?: string;
  back?: { href: string; label: string };
}) {
  const pathname = usePathname() ?? "";
  return (
    <aside className="hidden lg:flex w-[176px] flex-col border-r border-white/[0.06] flex-shrink-0">
      <Link
        href="/"
        className="flex items-center gap-2 px-4 h-12 border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors"
      >
        <LogoMark size={20} />
        <span className="text-[14px] font-semibold text-zinc-100 tracking-tight">Causal</span>
      </Link>

      <nav className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, Icon, match }) => {
          const active = activeHref ? activeHref === href : match.test(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                active ? "bg-white/[0.06] text-zinc-100" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-white/[0.06] space-y-0.5">
        <Link
          href={back.href}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} /> {back.label}
        </Link>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03] transition-colors"
        >
          <Github className="w-4 h-4" strokeWidth={1.75} /> GitHub
        </a>
        <div className="flex items-center gap-2 px-2.5 py-1.5 mt-1">
          <div className="w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-400/20 flex items-center justify-center font-mono text-[9px] text-indigo-200">
            DW
          </div>
          <span className="font-mono text-[11px] text-zinc-500">Demo workspace</span>
        </div>
      </div>
    </aside>
  );
}
