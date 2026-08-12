/**
 * Vercel AI SDK integration — wrap `generateText` / `streamText` (and their
 * object counterparts) so each call emits a Causal `llm` span with the model,
 * the prompt/completion io, and tokens and cost from the SDK's `usage`.
 *
 * The AI SDK exports plain functions rather than a client object, so these
 * wrappers take the function itself. Both the v4 usage shape
 * (`promptTokens` / `completionTokens`) and the v5 shape
 * (`inputTokens` / `outputTokens`) are read; nothing imports `ai`, so
 * `@causal/sdk` stays dependency-free.
 *
 * Usage:
 *   import { openai } from "@ai-sdk/openai";
 *   import * as ai from "ai";
 *   import { CausalTracer } from "@causal/sdk";
 *   import { wrapVercelAI } from "@causal/sdk/integrations";
 *
 *   const tracer = new CausalTracer({ service: "checkout-agent" });
 *
 *   await tracer.trace("checkout_agent.run", async (t, root) => {
 *     const { generateText } = wrapVercelAI(ai, t, { parent: root });
 *
 *     // one `llm` span, nested under the run's root span
 *     const { text } = await generateText({
 *       model: openai("gpt-4o-mini"),
 *       prompt: "Draft a refund email for order 4417.",
 *     });
 *     return text;
 *   });
 *
 * Or wrap a single function:
 *   const streamText = wrapStreamText(ai.streamText, t, { parent: root });
 *   const result = streamText({ model, prompt });
 *   for await (const delta of result.textStream) process.stdout.write(delta);
 *   // the span closes when `result.usage` / `result.text` settle, i.e. once
 *   // the stream has been consumed
 */

import {
  attrs,
  buildIo,
  errMessage,
  estimateCost,
  isPromiseLike,
  num,
  openSpan,
  pick,
  str,
  stringify,
  type SpanTarget,
  type WrapOptions,
} from "./internal.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- the AI SDK's generics do not survive erasure */
type AnyFn = (...args: any[]) => any;

/* ── prompt / completion rendering ──────────────────────────────────── */

function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? "" : stringify(content);
  return content
    .map((part) => {
      const type = str(pick(part, "type"));
      switch (type) {
        case "text":
          return String(pick(part, "text") ?? "");
        case "reasoning":
          return `[reasoning] ${String(pick(part, "text") ?? pick(part, "reasoning") ?? "")}`;
        case "tool-call":
          return `[tool-call ${String(pick(part, "toolName") ?? "")}] ${stringify(pick(part, "args") ?? pick(part, "input"))}`;
        case "tool-result":
          return `[tool-result ${String(pick(part, "toolName") ?? "")}] ${stringify(pick(part, "result") ?? pick(part, "output"))}`;
        case "image":
          return "[image]";
        case "file":
          return "[file]";
        default:
          return `[${type ?? "part"}]`;
      }
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Flatten `system` + `prompt`/`messages` into a readable transcript. */
function renderInput(params: unknown): string {
  const lines: string[] = [];
  const system = str(pick(params, "system"));
  if (system) lines.push(`system: ${system}`);

  const prompt = pick(params, "prompt");
  if (typeof prompt === "string" && prompt) {
    lines.push(`user: ${prompt}`);
  } else if (Array.isArray(prompt)) {
    for (const message of prompt) lines.push(renderMessage(message));
  }

  const messages = pick(params, "messages");
  if (Array.isArray(messages)) {
    for (const message of messages) lines.push(renderMessage(message));
  }
  return lines.join("\n");
}

function renderMessage(message: unknown): string {
  const role = String(pick(message, "role") ?? "user");
  return `${role}: ${renderContent(pick(message, "content"))}`;
}

/** `model` is a LanguageModel object in v4/v5, or a plain string in v5. */
function describeModel(model: unknown): { model?: string; provider?: string } {
  if (typeof model === "string") return { model };
  return {
    model: str(pick(model, "modelId")),
    provider: str(pick(model, "provider")),
  };
}

/* ── usage ─────────────────────────────────────────────────────────── */

interface Usage {
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

/** Reads both the AI SDK v4 and v5 usage shapes. */
function readUsage(usage: unknown): Usage | undefined {
  const tokensIn = num(pick(usage, "inputTokens")) ?? num(pick(usage, "promptTokens"));
  const tokensOut = num(pick(usage, "outputTokens")) ?? num(pick(usage, "completionTokens"));
  if (tokensIn === undefined && tokensOut === undefined) return undefined;
  return {
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
    cachedTokens: num(pick(usage, "cachedInputTokens")),
    reasoningTokens: num(pick(usage, "reasoningTokens")),
  };
}

/* ── shared span bookkeeping ───────────────────────────────────────── */

interface Closer {
  (output: string, usage: Usage | undefined, extra: Record<string, unknown>, error?: unknown): void;
}

function begin(
  params: unknown,
  target: SpanTarget,
  options: WrapOptions,
  defaultName: string,
  streaming: boolean
): Closer {
  const described = describeModel(pick(params, "model"));
  const span = openSpan(target, options.spanName ?? defaultName, "llm", options.parent);
  const input = renderInput(params);

  return (output, usage, extra, error) => {
    const model = described.model;
    const end: Parameters<typeof span.end>[0] = {
      status: error ? "error" : "ok",
      attributes: attrs({
        provider: described.provider ?? "vercel-ai",
        model,
        stream: streaming ? "true" : "false",
        temperature: num(pick(params, "temperature")),
        max_tokens: num(pick(params, "maxOutputTokens")) ?? num(pick(params, "maxTokens")),
        "cache.read_tokens": usage?.cachedTokens,
        "reasoning.tokens": usage?.reasoningTokens,
        ...extra,
      }),
    };
    const io = buildIo(options, input, output);
    if (io) end.io = io;
    if (usage) {
      end.tokensIn = usage.tokensIn;
      end.tokensOut = usage.tokensOut;
      end.cost = estimateCost(model, usage.tokensIn, usage.tokensOut, options.prices);
    }
    if (error) end.error = errMessage(error);
    span.end(end);
    void span.finish();
  };
}

/** Render the assistant side of a `generateText` / `generateObject` result. */
function renderResult(value: unknown): string {
  const text = pick(value, "text");
  const parts: string[] = [];
  if (typeof text === "string" && text) parts.push(text);
  const object = pick(value, "object");
  if (object !== undefined && object !== null) parts.push(stringify(object));
  const toolCalls = pick(value, "toolCalls");
  if (Array.isArray(toolCalls) && toolCalls.length > 0) parts.push(`[tool-calls] ${stringify(toolCalls)}`);
  return parts.join("\n");
}

/* ── awaited variants: generateText / generateObject ───────────────── */

function wrapAwaited<F extends AnyFn>(
  fn: F,
  target: SpanTarget,
  options: WrapOptions,
  defaultName: string
): F {
  if (typeof fn !== "function") return fn;
  const wrapped = (...args: unknown[]): unknown => {
    const params = args[0];
    const close = begin(params, target, options, defaultName, false);

    const onValue = (value: unknown): unknown => {
      close(renderResult(value), readUsage(pick(value, "usage") ?? pick(value, "totalUsage")), {
        finish_reason: str(pick(value, "finishReason")),
        "response.id": str(pick(pick(value, "response"), "id")),
        steps: Array.isArray(pick(value, "steps")) ? (pick(value, "steps") as unknown[]).length : undefined,
      });
      return value;
    };

    let result: unknown;
    try {
      result = fn(...args);
    } catch (err) {
      close("", undefined, {}, err);
      throw err;
    }

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(onValue, (err: unknown) => {
        close("", undefined, {}, err);
        throw err;
      });
    }
    return onValue(result);
  };
  return wrapped as unknown as F;
}

/* ── streaming variants: streamText / streamObject ─────────────────── */

/**
 * `streamText` returns synchronously; the interesting values arrive later on
 * `result.usage` / `result.text`. We observe those promises instead of touching
 * `textStream` / `fullStream`, so the caller's stream is never consumed twice.
 */
function wrapStreaming<F extends AnyFn>(
  fn: F,
  target: SpanTarget,
  options: WrapOptions,
  defaultName: string
): F {
  if (typeof fn !== "function") return fn;
  const wrapped = (...args: unknown[]): unknown => {
    const params = args[0];
    const close = begin(params, target, options, defaultName, true);

    let result: unknown;
    try {
      result = fn(...args);
    } catch (err) {
      close("", undefined, {}, err);
      throw err;
    }
    if (!result || typeof result !== "object") {
      close("", undefined, {});
      return result;
    }

    let failure: unknown;
    const settle = (value: unknown): Promise<unknown> => {
      if (!isPromiseLike(value)) return Promise.resolve(value);
      return Promise.resolve(value).catch((err: unknown) => {
        if (failure === undefined) failure = err;
        return undefined;
      });
    };

    const usageSource = pick(result, "totalUsage") ?? pick(result, "usage");
    const textSource = pick(result, "text") ?? pick(result, "object");
    const finishSource = pick(result, "finishReason");

    if (!isPromiseLike(usageSource) && !isPromiseLike(textSource)) {
      // Nothing to await — close immediately with whatever is already there.
      close(renderResult(result), readUsage(usageSource), {});
      return result;
    }

    void Promise.all([settle(usageSource), settle(textSource), settle(finishSource)]).then(
      ([usage, text, finishReason]) => {
        const output = typeof text === "string" ? text : text === undefined ? "" : stringify(text);
        close(output, readUsage(usage), { finish_reason: str(finishReason) }, failure);
      }
    );

    return result;
  };
  return wrapped as unknown as F;
}

/* ── public API ────────────────────────────────────────────────────── */

/** Instrument the AI SDK's `generateText`. Returns a drop-in replacement. */
export function wrapGenerateText<F extends AnyFn>(
  generateText: F,
  target: SpanTarget,
  options: WrapOptions = {}
): F {
  return wrapAwaited(generateText, target, options, "ai.generateText");
}

/** Instrument the AI SDK's `streamText`. Returns a drop-in replacement. */
export function wrapStreamText<F extends AnyFn>(
  streamText: F,
  target: SpanTarget,
  options: WrapOptions = {}
): F {
  return wrapStreaming(streamText, target, options, "ai.streamText");
}

/** Instrument the AI SDK's `generateObject`. Returns a drop-in replacement. */
export function wrapGenerateObject<F extends AnyFn>(
  generateObject: F,
  target: SpanTarget,
  options: WrapOptions = {}
): F {
  return wrapAwaited(generateObject, target, options, "ai.generateObject");
}

/** Instrument the AI SDK's `streamObject`. Returns a drop-in replacement. */
export function wrapStreamObject<F extends AnyFn>(
  streamObject: F,
  target: SpanTarget,
  options: WrapOptions = {}
): F {
  return wrapStreaming(streamObject, target, options, "ai.streamObject");
}

/** The subset of the `ai` module surface this integration knows how to trace. */
export interface VercelAiModule {
  generateText?: AnyFn;
  streamText?: AnyFn;
  generateObject?: AnyFn;
  streamObject?: AnyFn;
}

/**
 * Wrap the `ai` module in one call:
 *
 *   import * as ai from "ai";
 *   const { generateText, streamText } = wrapVercelAI(ai, trace, { parent: root });
 *
 * Returns a shallow copy with the four traced entry points replaced; every
 * other export (`tool`, `jsonSchema`, `Output`, …) is passed through untouched.
 */
export function wrapVercelAI<T extends VercelAiModule>(
  sdk: T,
  target: SpanTarget,
  options: WrapOptions = {}
): T {
  if (!sdk || typeof sdk !== "object") return sdk;
  const traced: VercelAiModule = { ...sdk };
  if (typeof sdk.generateText === "function") {
    traced.generateText = wrapGenerateText(sdk.generateText, target, options);
  }
  if (typeof sdk.streamText === "function") {
    traced.streamText = wrapStreamText(sdk.streamText, target, options);
  }
  if (typeof sdk.generateObject === "function") {
    traced.generateObject = wrapGenerateObject(sdk.generateObject, target, options);
  }
  if (typeof sdk.streamObject === "function") {
    traced.streamObject = wrapStreamObject(sdk.streamObject, target, options);
  }
  return traced as T;
}
