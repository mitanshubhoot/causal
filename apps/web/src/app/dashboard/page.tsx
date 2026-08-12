"use client";

import { useRouter } from "next/navigation";
import { ProductShell } from "@/components/product/ProductShell";
import { DashboardView } from "@/components/product/views";
import { getAllDemos } from "@/lib/mock-observability";

export default function DashboardPage() {
  const router = useRouter();
  return (
    <ProductShell>
      <DashboardView demos={getAllDemos()} onOpen={(id) => router.push(`/incidents/${id}`)} />
    </ProductShell>
  );
}
