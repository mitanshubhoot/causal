# TypeScript / Node.js — instrumenting with `@causal/sdk`

Runnable recipes. Every snippet is additive: delete it and the app behaves identically.

## 1. Install

`@causal/sdk` is **not yet published to npm**. Build it from a checkout and install it by path:

```bash
git clone https://github.com/mitanshubhoot/causal
cd causal && pnpm install && pnpm --filter @causal/sdk build

cd /path/to/your-project
npm install /path/to/causal/packages/sdk-typescript   # or: pnpm add / yarn add, same path
```

Inside the Causal monorepo itself, use the workspace protocol instead:
`pnpm add @causal/sdk --workspace`.

Node 18+ (the SDK uses global `fetch`, zero dependencies). Environment:

```bash
CAUSAL_API_KEY=causal_...            # required
CAUSAL_API_URL=http://localhost:3001 # default; set to your hosted Causal
CAUSAL_ORG_ID=org_123                # optional
```

Add them to `.env` (untracked) and to the deployment's secret store. Never commit a key.

## 2. One tracer config, one module

Create `src/observability/causal.ts`. This is the only file that constructs a tracer.

```ts
// src/observability/causal.ts
import { CausalTracer } from "@causal/sdk";
import { execSync } from "node:child_process";

/** HEAD sha, resolved ONCE at boot. Never shell out per span. */
export const COMMIT: string =
  process.env.CAUSAL_GIT_COMMIT ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  (() => {
    try {
      return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return "unknown"; // fail open: a missing sha must never crash boot
    }
  })();

const BASE = {
  service: "booking-agent",                       // one per deployable service
  environment: process.env.NODE_ENV ?? "development",
  model: "claude-sonnet-4-5",                     // the service's default model
  repo: "acme/booking",                           // owner/name
  gitRef: COMMIT,
  // apiKey / baseUrl / orgId fall back to CAUSAL_API_KEY / CAUSAL_API_URL / CAUSAL_ORG_ID
} as const;

/** Default tracer for background work with no end user attached. */
export const tracer = new CausalTracer({ ...BASE });

/** Same config, per-request identity. A tracer is a plain object — no connection, no cost. */
export const tracerFor = (ctx: { user?: string; sessionId?: string }) =>
  new CausalTracer({ ...BASE, ...ctx });

/** Git context for a span that runs our code. Path must be repo-relative. */
export const git = (file: string, line: number) => ({ file, line, commit: COMMIT });
```

Serverless / container builds have no `.git`: set `CAUSAL_GIT_COMMIT` at build time (`--build-arg`, `env` in the pipeline) so `COMMIT` is still real.

## 3. Wrap the entry point — one traced run per user-visible run

`tracer.trace(name, fn)` opens a root `agent` span, times it, and flushes when `fn` settles — including when it throws. `span.end()` is idempotent: end the root yourself to attach `io`, and the wrapper's own `end()` becomes a no-op.

```ts
// src/routes/book.ts
import type { Request, Response } from "express";
import { tracerFor } from "../observability/causal.js";
import { runBookingAgent } from "../agent.js";

app.post("/book", async (req: Request, res: Response) => {
  const reqTracer = tracerFor({ user: req.auth?.userId, sessionId: req.body.conversationId });

  const result = await reqTracer.trace("booking_agent.run", async (t, root) => {
    const out = await runBookingAgent(req.body.message, t, root);
    root.end({
      status: "ok",
      io: { input: redact(req.body.message), output: redact(JSON.stringify(out)).slice(0, 4000) },
    });
    return out;
  });

  res.json(result);
});
```

`redact()` is your own helper — strip keys, tokens, emails and card numbers before anything reaches `io`.

Rules of thumb:

- One `trace()` per request/job/CLI invocation — never one per tool call.
- Pass `t` and the parent span down explicitly, or use `AsyncLocalStorage` (§7) when a framework owns the call stack.
- Do not `try/catch` around `trace()` just for telemetry; it already re-throws your error after recording it.

## 4. Nest spans

`t.span(name, kind)` opens a span at the **trace root**. `span.child(name, kind)` nests **under that span**. Nesting is what makes a trace readable: agent → sub-agent → llm/tool.

```ts
// src/agent.ts
import type { CausalTrace, CausalSpan } from "@causal/sdk";
import { git } from "./observability/causal.js";

export async function runBookingAgent(input: string, t: CausalTrace, root: CausalSpan) {
  // 1. plan with the model
  const plan = root.child("llm.plan", "llm");
  const planned = await callModel(input, t, plan);
  plan.end({
    status: "ok",
    io: { input, output: planned.text },
    attributes: [{ label: "model", value: "claude-sonnet-4-5" }, { label: "tool_calls", value: String(planned.toolCalls.length) }],
  });

  // 2. tools the model chose — nested UNDER the llm span that chose them
  const results = [];
  for (const call of planned.toolCalls) {
    const span = plan.child(`tool.${call.name}`, "tool");
    try {
      results.push(await runTool(call));
      span.end({ status: "ok", git: git("src/tools/index.ts", 42), io: { input: JSON.stringify(call.args) } });
    } catch (err) {
      span.end({
        status: "error",
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        git: git("src/tools/index.ts", 42),
      });
      throw err; // tracing never swallows an error
    }
  }

  // 3. a sub-agent gets its own agent span, with its work nested beneath it
  const summarizer = root.child("subagent.summarize", "agent");
  const summary = await summarize(results, t, summarizer);
  summarizer.end({ status: "ok", io: { output: summary } });

  return { summary, results };
}
```

### A reusable step helper

```ts
// src/observability/step.ts
import type { CausalSpan, SpanKind } from "@causal/sdk";
import { git } from "./causal.js";

export async function step<T>(
  parent: CausalSpan,
  name: string,
  kind: SpanKind,
  where: { file: string; line: number },
  fn: (span: CausalSpan) => Promise<T>,
): Promise<T> {
  const span = parent.child(name, kind);
  try {
    const out = await fn(span);           // fn may end(span) early to attach io — first end wins
    span.end({ status: "ok", git: git(where.file, where.line) });
    return out;
  } catch (err) {
    span.end({
      status: "error",
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      git: git(where.file, where.line),
    });
    throw err;
  }
}
```

## 5. Git context — the part that makes RCA work

Attach `git: { file, line, commit }` to every span that executes **your** code: tools, parsers, validators, business logic, graph nodes. Causal uses it to blame a commit and open a fix PR.

```ts
const parse = plan.child("parse.itinerary", "function");
try {
  const itinerary = parseItinerary(raw);          // src/parse/itinerary.ts:27
  parse.end({ status: "ok", git: git("src/parse/itinerary.ts", 27) });
} catch (err) {
  parse.end({
    status: "error",
    error: `${(err as Error).name}: ${(err as Error).message}`,
    git: git("src/parse/itinerary.ts", 27),   // ← the line Causal will blame
  });
  throw err;
}
```

- **Repo-relative paths.** `src/parse/itinerary.ts`, never `/Users/me/proj/src/...` and never a bundled `dist/` path.
- **Real commit.** `COMMIT` from §2; `"unknown"` gets you a file but no blame.
- **Close enough lines.** A line that drifts by a few is still useful — file + commit does most of the localization. Point at the failing call, not the `catch`.
- Skip `git` on `llm` and `http` spans: the failure there belongs to the provider, not to a commit.

## 6. Tokens and cost

Trace-level economics live on the trace object; per-call detail lives on the `llm` span.

```ts
// src/observability/usage.ts
import type { CausalTrace, CausalSpan } from "@causal/sdk";

// Fill in your provider's current rates — USD per million tokens.
const RATES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-5": { in: 0, out: 0 },
};

export function recordUsage(
  t: CausalTrace,
  span: CausalSpan,
  model: string,
  tokensIn: number,
  tokensOut: number,
  io?: { input?: string; output?: string },
) {
  const rate = RATES[model] ?? { in: 0, out: 0 };
  const cost = (tokensIn / 1e6) * rate.in + (tokensOut / 1e6) * rate.out;

  t.tokensIn += tokensIn;
  t.tokensOut += tokensOut;
  t.cost += cost;

  span.end({
    status: "ok",
    io,
    attributes: [
      { label: "model", value: model },
      { label: "tokens_in", value: String(tokensIn) },
      { label: "tokens_out", value: String(tokensOut) },
      { label: "cost_usd", value: cost.toFixed(6) },
    ],
  });
}
```

Cached/streamed calls still report usage — read it from the final message or the stream's completion event, never estimate by counting characters.

## 7. Framework notes

### Anthropic SDK

```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

const span = root.child("llm.answer", "llm");
const res = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: prompt }],
});
const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
recordUsage(t, span, res.model, res.usage.input_tokens, res.usage.output_tokens, { input: prompt, output: text });
```

### OpenAI SDK

```ts
import OpenAI from "openai";
const client = new OpenAI();

const span = root.child("llm.answer", "llm");
const res = await client.chat.completions.create({ model, messages });
recordUsage(t, span, model, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0, {
  input: JSON.stringify(messages).slice(0, 4000),
  output: res.choices[0]?.message?.content ?? "",
});
```

### Vercel AI SDK

```ts
import { generateText } from "ai";

const span = root.child("llm.answer", "llm");
const { text, usage } = await generateText({ model: myModel, prompt });
// field names differ across major versions — read both
const tin = (usage as any).inputTokens ?? (usage as any).promptTokens ?? 0;
const tout = (usage as any).outputTokens ?? (usage as any).completionTokens ?? 0;
recordUsage(t, span, "claude-sonnet-4-5", tin, tout, { input: prompt, output: text });
```

For `streamText`, end the span after the stream resolves (`await result.usage`), not when the first chunk arrives — otherwise the duration is meaningless.

### LangChain / LangGraph

The graph owns the call stack, so carry the current span in `AsyncLocalStorage`:

```ts
// src/observability/context.ts
import { AsyncLocalStorage } from "node:async_hooks";
import type { CausalTrace, CausalSpan } from "@causal/sdk";

export const causalCtx = new AsyncLocalStorage<{ t: CausalTrace; parent: CausalSpan }>();
export const current = () => causalCtx.getStore();
```

```ts
// wrap each node — one agent span per node, nested under whatever is current
import { causalCtx, current } from "./observability/context.js";
import { git } from "./observability/causal.js";

export const tracedNode =
  <S>(name: string, fn: (state: S) => Promise<Partial<S>>) =>
  async (state: S): Promise<Partial<S>> => {
    const ctx = current();
    if (!ctx) return fn(state);                         // fail open: no trace, no tracing
    const span = ctx.parent.child(`node.${name}`, "agent");
    return causalCtx.run({ t: ctx.t, parent: span }, async () => {
      try {
        const out = await fn(state);
        span.end({ status: "ok", git: git(`src/graph/${name}.ts`, 1) });
        return out;
      } catch (err) {
        span.end({ status: "error", error: String(err), git: git(`src/graph/${name}.ts`, 1) });
        throw err;
      }
    });
  };

// entry point
await tracer.trace("support_graph.run", async (t, root) =>
  causalCtx.run({ t, parent: root }, () => graph.invoke(input)),
);
```

Registration stays untouched apart from the wrapper: `.addNode("plan", tracedNode("plan", planNode))`.

For plain LangChain chains, span the `.invoke()` call and read `res.usage_metadata?.input_tokens` / `output_tokens` off the returned `AIMessage`. Callback handlers work too, but wrapping the call site survives version bumps.

## 8. Short-lived processes must flush

`tracer.trace()` flushes for you. Use the manual form only when the trace object has to outlive one function:

```ts
// scripts/reindex.ts
import { tracer, git } from "../src/observability/causal.js";

async function main() {
  const t = tracer.startTrace();
  const root = t.span("nightly_reindex", "agent");
  try {
    await reindex(t, root);
    root.end({ status: "ok" });
  } catch (err) {
    root.end({ status: "error", error: String(err), git: git("scripts/reindex.ts", 12) });
    throw err;
  } finally {
    await t.flush();   // the process is about to exit — this must be awaited
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- **Lambda / Cloud Functions:** `await` the traced run before returning the response. Fire-and-forget loses traces the moment the runtime freezes the container.
- **Long-lived servers:** never call `flush()` yourself — one flush per run already happens.
- **`process.exit()` in a handler:** flush first, or the trace dies in the buffer.

## 9. What to instrument

**Prioritize**

| Instrument | Kind | Why |
| --- | --- | --- |
| The agent entry point | `agent` | One root per user-visible run |
| Every model call | `llm` | Tokens, cost, prompt/response |
| Every tool the model can choose | `tool` | Where agents actually fail |
| Sub-agents and graph nodes | `agent` | Gives the trace its shape |
| Retrieval / vector / SQL queries | `db` | Bad context is a top root cause |
| Outbound third-party API calls | `http` | Latency and 5xx attribution |
| Parsing, validation, business rules | `function` | Carries the `git` that powers RCA |
| Retry / fallback branches | `function` | Silent degradation shows up nowhere else |

**Avoid**

- Per-token or per-chunk spans in a streaming callback — one `llm` span for the whole call.
- Pure helpers: formatters, getters, type guards, tight numeric loops.
- Library internals you do not own.
- Anything inside a loop that runs thousands of times — span the loop, put the count in an attribute.
- Prompts or tool args containing secrets or PII — redact before `io`.
- Traces beyond a few hundred spans; ingest rejects payloads over 2000 spans.

## 10. Fail-open checklist

- No instrumentation helper throws: `git()`, `recordUsage()`, `step()` only touch local objects.
- `COMMIT` resolution is wrapped in `try/catch` and runs once at import.
- No `await` added to a path that did not already have one, other than the flush at the end of a run.
- Errors are recorded, then re-thrown — never swallowed.
- Missing `CAUSAL_API_KEY` degrades to a failed export, not a failed request; `trace()` already swallows export errors.
