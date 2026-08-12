"use client";

import { useRouter } from "next/navigation";
import { ProductShell } from "@/components/product/ProductShell";
import { EvalsView } from "@/components/product/EvalsView";

export default function EvalsPage() {
  const router = useRouter();
  return (
    <ProductShell>
      <EvalsView onOpenTrace={(id) => router.push(`/incidents/${id}`)} />
    </ProductShell>
  );
}
