"use client";

import { useRouter } from "next/navigation";
import { ProductShell } from "@/components/product/ProductShell";
import { DashboardView, LoadingPane, useLiveIncidents } from "@/components/product/views";
import { getAllDemos } from "@/lib/mock-observability";

export default function DashboardPage() {
  const router = useRouter();
  // This route was mock-only: NEXT_PUBLIC_USE_LIVE_TRACES=1 changed nothing here.
  // The security tiles navigate with <Link href="/security"> inside the view, so
  // they need no router prop — this page still owns only the incident route.
  const live = useLiveIncidents();
  return (
    <ProductShell>
      {live.pending ? (
        <LoadingPane label="Loading incidents…" />
      ) : (
        <DashboardView demos={live.demos ?? getAllDemos()} onOpen={(id) => router.push(`/incidents/${id}`)} />
      )}
    </ProductShell>
  );
}
