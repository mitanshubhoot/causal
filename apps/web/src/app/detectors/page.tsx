"use client";

import { useRouter } from "next/navigation";
import { ProductShell } from "@/components/product/ProductShell";
import { DetectorsView } from "@/components/product/views";

export default function DetectorsPage() {
  const router = useRouter();
  return (
    <ProductShell>
      <DetectorsView onOpen={(id) => router.push(`/incidents/${id}`)} />
    </ProductShell>
  );
}
