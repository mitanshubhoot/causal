"use client";

import { useRouter } from "next/navigation";
import { ProductShell } from "@/components/product/ProductShell";
import { SecurityView } from "@/components/product/SecurityView";

export default function SecurityPage() {
  const router = useRouter();
  return (
    <ProductShell>
      <SecurityView onOpenTrace={(id) => router.push(`/incidents/${id}`)} />
    </ProductShell>
  );
}
