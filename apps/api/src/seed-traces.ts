/**
 * Seed a couple of real traces into Postgres so the v2 observability endpoints
 * (`/api/v1/traces...`) return live data locally. Runs the detector + RCA on the
 * failing one. Requires infra up (docker compose) and migrations 004/005 applied.
 *
 *   pnpm db:seed-traces
 */
import { buildApp } from "./factory.js";
import { ingestTrace, type IngestTrace } from "./services/traces.js";
import { runDetector } from "./services/detector.js";
import { runRca } from "./services/rca.js";

const ORG = "org_demo_causal_001";

const failing: IngestTrace = {
  traceId: "seed-checkout-fail-01",
  service: "storefront-checkout",
  environment: "production",
  model: "claude-sonnet-4-5",
  tokensIn: 12400,
  tokensOut: 2180,
  cost: 0.1841,
  spans: [
    { id: "s0", parentId: null, name: "checkout-assistant.run", kind: "agent", startMs: 0, durationMs: 2140, status: "error",
      attributes: [{ label: "session", value: "sess-code-4471" }],
      io: { input: "Place the order for cart cust_92f1.", output: "Failed — rollout resolution raised AttributeError." } },
    { id: "s1", parentId: "s0", name: "llm.plan_checkout", kind: "llm", startMs: 40, durationMs: 610, status: "ok",
      attributes: [{ label: "model", value: "claude-sonnet-4-5" }] },
    { id: "s2", parentId: "s0", name: "tool.resolve_rollout_flag", kind: "tool", startMs: 800, durationMs: 22, status: "error",
      error: "AttributeError: module 'flags' has no attribute 'checkout_v2_enabled'",
      git: { file: "services/checkout/flags.py", line: 42, commit: "b91f0ac4" },
      attributes: [{ label: "flag", value: "checkout_v2_enabled" }] },
    { id: "s3", parentId: "s0", name: "POST /api/checkout", kind: "http", startMs: 1560, durationMs: 560, status: "error",
      error: "500 Internal Server Error", attributes: [{ label: "status", value: "500" }] },
  ],
};

const healthy: IngestTrace = {
  traceId: "seed-checkout-ok-01",
  service: "storefront-checkout",
  environment: "production",
  model: "claude-sonnet-4-5",
  tokensIn: 9800,
  tokensOut: 1420,
  cost: 0.1502,
  spans: [
    { id: "s0", parentId: null, name: "checkout-assistant.run", kind: "agent", startMs: 0, durationMs: 1180, status: "ok",
      attributes: [{ label: "session", value: "sess-code-4460" }] },
    { id: "s1", parentId: "s0", name: "tool.resolve_rollout_flag", kind: "tool", startMs: 700, durationMs: 18, status: "ok",
      attributes: [{ label: "result", value: "true" }] },
    { id: "s2", parentId: "s0", name: "POST /api/checkout", kind: "http", startMs: 720, durationMs: 440, status: "ok",
      attributes: [{ label: "status", value: "200" }] },
  ],
};

async function main(): Promise<void> {
  const app = await buildApp();
  try {
    await ingestTrace(app, ORG, failing);
    await ingestTrace(app, ORG, healthy);
    const finding = await runDetector(app, ORG, failing.traceId);
    if (finding) await runRca(app, ORG, failing.traceId);
    // eslint-disable-next-line no-console
    console.log(`Seeded 2 traces for ${ORG}. Detector: ${finding ? "fired" : "none"}.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
