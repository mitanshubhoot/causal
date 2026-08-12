"use client";

import { useRouter } from "next/navigation";
import { ProductShell } from "@/components/product/ProductShell";
import { SecurityView } from "@/components/product/SecurityView";
import { explorerIncidentFor } from "@/lib/mock-security";

export default function SecurityPage() {
  const router = useRouter();
  return (
    <ProductShell>
      <SecurityView
        // A security event carries the WIRE trace id; /incidents/[id] is keyed on
        // the incident id. Pushing the former resolves nothing and lands on
        // notFound(). The views gate the affordance on this same resolver, so a
        // link only renders when it will work — but they hand back the trace id
        // they were given, and translating it is routing's job, not theirs.
        // Resolving here fixes every call site at once.
        onOpenTrace={(traceId) => {
          const incidentId = explorerIncidentFor(traceId);
          if (incidentId) router.push(`/incidents/${incidentId}`);
        }}
      />
    </ProductShell>
  );
}
