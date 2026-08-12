# TypeScript quickstart

Emits one nested trace from a standalone script. Node 18+ (the SDK uses global `fetch`).

## 1. Install

```bash
npm install @causal/sdk
npm install -D tsx            # runs the .ts file directly; skip if you use the .mjs variant below
```

Inside the Causal monorepo the package is a workspace dependency instead:
`pnpm add @causal/sdk --workspace` (or add `"@causal/sdk": "workspace:*"` to `package.json`).

## 2. Environment

```bash
export CAUSAL_API_KEY=causal_demo_key_2026     # public demo key
export CAUSAL_API_URL=http://localhost:3001    # default; point at the hosted API if remote
```

## 3. `causal-quickstart.ts`

Write this file as-is. It is a fake booking agent: it plans with an LLM, calls two tools, and the second
tool fails on purpose so the trace has something to root-cause.

```ts
/**
 * Causal quickstart — one nested trace, shipped and verifiable.
 * Run: npx tsx causal-quickstart.ts
 */
import { CausalTracer } from "@causal/sdk";

const BASE_URL = process.env.CAUSAL_API_URL ?? "http://localhost:3001";

const tracer = new CausalTracer({
  service: "causal-quickstart",
  apiKey: process.env.CAUSAL_API_KEY,   // never hardcode a real key
  baseUrl: BASE_URL,
  environment: "development",
  model: "claude-sonnet-4-5",
  repo: "acme/storefront",
  gitRef: "3f9a1c05",
  metadata: [{ label: "source", value: "causal-quickstart" }],
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!process.env.CAUSAL_API_KEY) {
    console.error("CAUSAL_API_KEY is not set. Try: export CAUSAL_API_KEY=causal_demo_key_2026");
    process.exit(1);
  }

  // Manual trace (not tracer.trace) so a failed export throws instead of being
  // swallowed — during setup you want ingest errors to be loud.
  const t = tracer.startTrace();
  const root = t.span("booking_agent.run", "agent");

  // --- llm span: economics + io -------------------------------------------
  const plan = root.child("llm.plan", "llm");
  await sleep(120);                                  // stand-in for the model call
  t.tokensIn += 1200;
  t.tokensOut += 340;
  t.cost += 0.014;
  plan.end({
    status: "ok",
    io: {
      input: "Book a window seat on the 8am flight to SFO.",
      output: "Plan: 1) look up inventory 2) hold 12A 3) charge card",
    },
    attributes: [
      { label: "model", value: "claude-sonnet-4-5" },
      { label: "tokensIn", value: "1200" },
      { label: "tokensOut", value: "340" },
      { label: "cost.usd", value: "0.014" },
    ],
  });

  // --- tool span that succeeds: git context, because it runs app code ------
  const lookup = plan.child("tool.lookup_inventory", "tool");
  await sleep(45);
  lookup.end({
    status: "ok",
    io: { input: '{"flight":"UA118","cabin":"economy"}', output: '{"seats":["12A","14C"]}' },
    git: { file: "app/tools/inventory.ts", line: 41, commit: "3f9a1c05" },
  });

  // --- tool span that FAILS: this is what a detector finding is built from --
  const charge = plan.child("tool.charge_card", "tool");
  await sleep(30);
  charge.end({
    status: "error",
    error: "KeyError: 'change' — booking payload missing fare-change amount",
    io: { input: '{"seat":"12A","fare":412.0}', output: "" },
    git: { file: "app/tools/payments.ts", line: 27, commit: "3f9a1c05" },
  });

  // End the root last: the first end() wins, so this is where root io/status live.
  root.end({
    status: "error",
    io: {
      input: "Book a window seat on the 8am flight to SFO.",
      output: "Booking failed at the payment step.",
    },
  });

  await t.flush();   // short-lived process: nothing ships without this

  console.log(`trace id: ${t.traceId}`);
  console.log(
    `verify:   curl -s -H "Authorization: Bearer $CAUSAL_API_KEY" ${BASE_URL}/api/v1/traces/${t.traceId}`,
  );
}

main().catch((err) => {
  console.error("quickstart failed:", err);
  process.exit(1);
});
```

Plain-JavaScript variant: save as `causal-quickstart.mjs`, delete the two type annotations
(`ms: number`, `: Promise<void>`), and run `node causal-quickstart.mjs`.

## 4. Run

```bash
npx tsx causal-quickstart.ts
```

Expected output:

```
trace id: 3a48324eff9e5a00
verify:   curl -s -H "Authorization: Bearer $CAUSAL_API_KEY" http://localhost:3001/api/v1/traces/3a48324eff9e5a00
```

## 5. Verify

Run the printed `verify` command, or open **Traces** in the Causal UI and search the trace id.

```bash
curl -s -H "Authorization: Bearer $CAUSAL_API_KEY" \
  "$CAUSAL_API_URL/api/v1/traces/<trace-id>" | head -60
```

The trace should come back with 4 spans in this shape:

```
booking_agent.run        agent   error
└─ llm.plan              llm     ok      tokens 1200/340, cost 0.014
   ├─ tool.lookup_inventory  tool ok     git app/tools/inventory.ts:41 @3f9a1c05
   └─ tool.charge_card       tool error  git app/tools/payments.ts:27 @3f9a1c05
```

## What makes this a good trace

| Line in the script                        | Why it matters                                              |
| ----------------------------------------- | ----------------------------------------------------------- |
| `root.child(...)` / `plan.child(...)`     | Real nesting (agent → llm → tool). Flat spans hide causality. |
| `t.tokensIn / tokensOut / cost`           | Trace economics — cost regressions become visible.           |
| `io: { input, output }` on agent + llm    | Lets the detector judge the behavior, not just the timing.    |
| `git: { file, line, commit }` on tool spans | Root-causes a failure to a commit and enables a fix PR. Omit it and RCA degrades. |
| `status: "error"` + a real error string   | Nothing is flagged without it.                                |

Keep secrets and PII out of `io` and `attributes` — the values are stored verbatim.

## Ingest contract

`POST {CAUSAL_API_URL}/api/v1/traces` with `Authorization: Bearer $CAUSAL_API_KEY`, returns
`201 {"traceId":"…","spanCount":N}`. Span `kind` is validated server-side; this quickstart uses
`agent`, `llm`, and `tool`. If an unusual kind ever returns 400, fall back to `function`.

## Troubleshooting

| Symptom                                   | Cause                                        | Fix                                                            |
| ----------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `Causal trace export failed: 401`         | Missing or wrong key                         | `export CAUSAL_API_KEY=causal_demo_key_2026`; the header must be `Bearer <key>`. |
| `Causal trace export failed: 400`         | Payload rejected by the schema               | You edited a span — restore the script verbatim (check `kind` and `git.line` being a number). |
| `ECONNREFUSED` / `fetch failed`           | API not running, or wrong `CAUSAL_API_URL`   | Start the API (`http://localhost:3001`) or point at the hosted URL. Confirm with `curl $CAUSAL_API_URL/health`. |
| Script exits 0, nothing in Traces          | Process exited before the export finished    | Keep `await t.flush()` as the last statement; with `tracer.trace()` the flush is automatic but export errors are swallowed by design. |
| Trace exists, but the UI list looks empty | Filtered to a different service/environment  | Look for service `causal-quickstart`, environment `development`. |
| `Cannot find module '@causal/sdk'`        | Not installed, or CommonJS project           | `npm install @causal/sdk`; the package is ESM — use `.mjs`/`tsx` or set `"type": "module"`. |
| No detector finding on the trace          | Detectors disabled on the server             | The trace is still correct; enable detectors server-side to see findings. |
