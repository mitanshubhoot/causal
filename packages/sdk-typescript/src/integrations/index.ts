/**
 * Causal integrations — drop-in wrappers that make an existing LLM client emit
 * Causal spans without changing a single call site.
 *
 * Every wrapper takes the same second argument: a `CausalTracer`, a live
 * `CausalTrace`, or a parent `CausalSpan`. Prefer a trace or a span so the
 * model calls land inside the run you are already tracing; a bare tracer opens
 * and flushes a one-span trace per call, which is only right for a script.
 *
 * Usage:
 *   import OpenAI from "openai";
 *   import { CausalTracer } from "@causal/sdk";
 *   import { wrapOpenAI } from "@causal/sdk/integrations";
 *
 *   const tracer = new CausalTracer({ service: "support-agent" });
 *
 *   await tracer.trace("support_agent.run", async (t, root) => {
 *     const openai = wrapOpenAI(new OpenAI(), t, { parent: root });
 *     const res = await openai.chat.completions.create({
 *       model: "gpt-4o-mini",
 *       messages: [{ role: "user", content: "Where is my order?" }],
 *     });
 *     return res.choices[0]?.message.content ?? "";
 *   });
 *
 * None of these modules import a provider SDK — clients are accepted
 * structurally — so adding an integration adds no dependencies to your build.
 *
 * Note: publishing the `@causal/sdk/integrations` subpath requires an
 * `"./integrations"` entry in this package's `exports` map. Inside the
 * monorepo, import from `./integrations/index.js` directly.
 */

export { wrapOpenAI } from "./openai.js";
export { wrapAnthropic } from "./anthropic.js";
export {
  wrapVercelAI,
  wrapGenerateText,
  wrapStreamText,
  wrapGenerateObject,
  wrapStreamObject,
} from "./vercel-ai.js";
export type { VercelAiModule } from "./vercel-ai.js";

export { MODEL_PRICES, priceFor, estimateCost, openSpan } from "./internal.js";
export type { ModelPrice, SpanTarget, SpanHandle, WrapOptions } from "./internal.js";
