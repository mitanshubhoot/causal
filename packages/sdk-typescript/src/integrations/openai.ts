/**
 * wrapOpenAI — instrument an OpenAI client so every model call emits a Causal
 * `llm` span carrying the model, the prompt/completion io, and the tokens and
 * cost read straight off `response.usage`.
 *
 * The client is accepted structurally (duck-typed), so `@causal/sdk` never
 * takes a dependency on `openai` — the same wrapper works for Azure OpenAI,
 * OpenRouter, Together and anything else that speaks the OpenAI shape.
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
 *
 *     // one `llm` span, nested under the run's root span
 *     const res = await openai.chat.completions.create({
 *       model: "gpt-4o-mini",
 *       messages: [{ role: "user", content: "Where is my order?" }],
 *     });
 *     return res.choices[0]?.message.content ?? "";
 *   });
 *
 * Streaming works too. Pass `stream_options: { include_usage: true }` and the
 * span picks up tokens and cost from the final chunk:
 *
 *   const stream = await openai.chat.completions.create({
 *     model: "gpt-4o-mini",
 *     messages,
 *     stream: true,
 *     stream_options: { include_usage: true },
 *   });
 *   for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
 *   // the span ends when the loop ends — including on `break` or a throw
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
  pickPath,
  proxyPath,
  str,
  stringify,
  traceStream,
  type SpanTarget,
  type WrapOptions,
} from "./internal.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- proxy plumbing is inherently untyped */
type AnyFn = (...args: any[]) => any;

/* ── prompt / completion rendering ──────────────────────────────────── */

/** Render one message's `content`, which may be a string or a parts array. */
function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const type = pick(part, "type");
        if (type === "text" || type === "input_text" || type === "output_text") {
          return String(pick(part, "text") ?? "");
        }
        if (type === "refusal") return `[refusal] ${String(pick(part, "refusal") ?? "")}`;
        return `[${String(type ?? "part")}]`;
      })
      .join("");
  }
  if (content === undefined || content === null) return "";
  return stringify(content);
}

/** Flatten a chat `messages` array into a readable transcript. */
function renderMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return stringify(messages);
  return messages
    .map((message) => {
      const role = String(pick(message, "role") ?? "user");
      const calls = pick(message, "tool_calls");
      const body = renderContent(pick(message, "content"));
      return calls ? `${role}: ${body}\n[tool_calls] ${stringify(calls)}` : `${role}: ${body}`;
    })
    .join("\n");
}

/** Render whatever the Responses API was handed as `input`. */
function renderResponsesInput(params: unknown): string {
  const instructions = str(pick(params, "instructions"));
  const input = pick(params, "input");
  const rendered =
    typeof input === "string"
      ? input
      : Array.isArray(input)
        ? input
            .map((item) => {
              const role = pick(item, "role");
              const body = renderContent(pick(item, "content"));
              return role ? `${String(role)}: ${body}` : body || stringify(item);
            })
            .join("\n")
        : stringify(input);
  return instructions ? `[instructions] ${instructions}\n${rendered}` : rendered;
}

/** Pull the assistant text out of a Responses API response object. */
function renderResponsesOutput(response: unknown): string {
  const convenience = pick(response, "output_text");
  if (typeof convenience === "string") return convenience;
  const output = pick(response, "output");
  if (!Array.isArray(output)) return stringify(output);
  return output
    .map((item) => {
      const type = pick(item, "type");
      if (type === "message") return renderContent(pick(item, "content"));
      if (type === "function_call") {
        return `[function_call ${String(pick(item, "name") ?? "")}] ${String(pick(item, "arguments") ?? "")}`;
      }
      return `[${String(type ?? "item")}]`;
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

/* ── usage ─────────────────────────────────────────────────────────── */

interface Usage {
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

/** Chat Completions reports `prompt_tokens` / `completion_tokens`. */
function readChatUsage(usage: unknown): Usage | undefined {
  const tokensIn = num(pick(usage, "prompt_tokens"));
  const tokensOut = num(pick(usage, "completion_tokens"));
  if (tokensIn === undefined && tokensOut === undefined) return undefined;
  return {
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
    cachedTokens: num(pickPath(usage, "prompt_tokens_details", "cached_tokens")),
    reasoningTokens: num(pickPath(usage, "completion_tokens_details", "reasoning_tokens")),
  };
}

/** The Responses API reports `input_tokens` / `output_tokens`. */
function readResponsesUsage(usage: unknown): Usage | undefined {
  const tokensIn = num(pick(usage, "input_tokens"));
  const tokensOut = num(pick(usage, "output_tokens"));
  if (tokensIn === undefined && tokensOut === undefined) return undefined;
  return {
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
    cachedTokens: num(pickPath(usage, "input_tokens_details", "cached_tokens")),
    reasoningTokens: num(pickPath(usage, "output_tokens_details", "reasoning_tokens")),
  };
}

/* ── the wrappers ──────────────────────────────────────────────────── */

/** Mutable state a streamed call accumulates before the span can be closed. */
interface Accumulator {
  text: string;
  usage?: unknown;
  finishReason?: string;
  model?: string;
  responseId?: string;
}

function instrument(
  orig: AnyFn,
  target: SpanTarget,
  options: WrapOptions,
  spec: {
    defaultName: string;
    renderInput: (params: unknown) => string;
    renderOutput: (value: unknown) => string;
    readUsage: (usage: unknown) => Usage | undefined;
    usageOf: (value: unknown) => unknown;
    onChunk: (acc: Accumulator, chunk: unknown) => void;
  }
): AnyFn {
  return function create(...args: unknown[]): unknown {
    const params = args[0];
    const requestedModel = str(pick(params, "model"));
    const streaming = pick(params, "stream") === true;
    const span = openSpan(target, options.spanName ?? spec.defaultName, "llm", options.parent);
    const input = spec.renderInput(params);

    const close = (
      output: string,
      usage: Usage | undefined,
      extra: Record<string, unknown>,
      error?: unknown
    ): void => {
      const model = str(extra["model"]) ?? requestedModel;
      const cost = usage ? estimateCost(model, usage.tokensIn, usage.tokensOut, options.prices) : undefined;
      const end: Parameters<typeof span.end>[0] = {
        status: error ? "error" : "ok",
        attributes: attrs({
          provider: "openai",
          model,
          stream: streaming ? "true" : "false",
          temperature: num(pick(params, "temperature")),
          max_tokens: num(pick(params, "max_tokens")) ?? num(pick(params, "max_output_tokens")),
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
        if (cost !== undefined) end.cost = cost;
      }
      if (error) end.error = errMessage(error);
      span.end(end);
      void span.finish();
    };

    const onValue = (value: unknown): void => {
      const usage = spec.readUsage(spec.usageOf(value));
      close(spec.renderOutput(value), usage, {
        model: str(pick(value, "model")),
        "response.id": str(pick(value, "id")),
        finish_reason: str(pickPath(value, "choices", "0", "finish_reason")),
      });
    };

    const onStream = (stream: object): object => {
      const acc: Accumulator = { text: "" };
      return traceStream(
        stream,
        (chunk) => spec.onChunk(acc, chunk),
        (err) =>
          close(acc.text, spec.readUsage(acc.usage), {
            model: acc.model,
            "response.id": acc.responseId,
            finish_reason: acc.finishReason,
          }, err)
      );
    };

    let result: unknown;
    try {
      result = orig(...args);
    } catch (err) {
      close("", undefined, {}, err);
      throw err;
    }

    if (isPromiseLike(result)) {
      if (!streaming) {
        // Observe without replacing the returned value: the OpenAI SDK hands
        // back an APIPromise, and callers rely on `.withResponse()` / `.asResponse()`.
        void Promise.resolve(result).then(onValue, (err: unknown) => close("", undefined, {}, err));
        return result;
      }
      // Streaming: we must hand back an instrumented stream, so this call site
      // resolves to a plain Promise. Streams have no APIPromise extras to lose.
      return Promise.resolve(result).then(
        (value: unknown) => (value && typeof value === "object" ? onStream(value) : value),
        (err: unknown) => {
          close("", undefined, {}, err);
          throw err;
        }
      );
    }

    if (streaming && result && typeof result === "object") return onStream(result);
    onValue(result);
    return result;
  };
}

/** Accumulate a `chat.completions` stream chunk. */
function onChatChunk(acc: Accumulator, chunk: unknown): void {
  const model = str(pick(chunk, "model"));
  if (model) acc.model = model;
  const id = str(pick(chunk, "id"));
  if (id) acc.responseId = id;
  const usage = pick(chunk, "usage");
  if (usage) acc.usage = usage;

  const choices = pick(chunk, "choices");
  if (!Array.isArray(choices)) return;
  for (const choice of choices) {
    const delta = pick(choice, "delta");
    const text = pick(delta, "content");
    if (typeof text === "string") acc.text += text;
    const calls = pick(delta, "tool_calls");
    if (Array.isArray(calls)) {
      for (const call of calls) {
        const name = str(pickPath(call, "function", "name"));
        const chunkArgs = pickPath(call, "function", "arguments");
        if (name) acc.text += `\n[tool_call ${name}] `;
        if (typeof chunkArgs === "string") acc.text += chunkArgs;
      }
    }
    const finish = str(pick(choice, "finish_reason"));
    if (finish) acc.finishReason = finish;
  }
}

/** Accumulate a Responses API stream event. */
function onResponsesEvent(acc: Accumulator, event: unknown): void {
  const type = str(pick(event, "type")) ?? "";
  if (type === "response.output_text.delta") {
    const delta = pick(event, "delta");
    if (typeof delta === "string") acc.text += delta;
    return;
  }
  if (type === "response.function_call_arguments.delta") {
    const delta = pick(event, "delta");
    if (typeof delta === "string") acc.text += delta;
    return;
  }
  const response = pick(event, "response");
  if (!response) return;
  const model = str(pick(response, "model"));
  if (model) acc.model = model;
  const id = str(pick(response, "id"));
  if (id) acc.responseId = id;
  const usage = pick(response, "usage");
  if (usage) acc.usage = usage;
  const status = str(pick(response, "status"));
  if (status) acc.finishReason = status;
  if (!acc.text) {
    const text = renderResponsesOutput(response);
    if (text) acc.text = text;
  }
}

/**
 * Wrap an OpenAI-shaped client so `chat.completions.create` and
 * `responses.create` emit `llm` spans.
 *
 * The original client is never mutated — a Proxy is returned, so an
 * un-instrumented reference to the same client keeps working and two tracers
 * can wrap the same client independently.
 *
 * @param client  An `OpenAI` (or Azure/compatible) instance.
 * @param target  A `CausalTracer`, a live `CausalTrace`, or a parent `CausalSpan`.
 *                Prefer a trace or span: a bare tracer opens and flushes a
 *                one-span trace per call.
 * @param options Span naming, io capture limits and price-table overrides.
 */
export function wrapOpenAI<T extends object>(client: T, target: SpanTarget, options: WrapOptions = {}): T {
  if (!client || typeof client !== "object") return client;

  const withChat = proxyPath(client, ["chat", "completions", "create"], (orig) =>
    instrument(orig, target, options, {
      defaultName: "openai.chat.completions.create",
      renderInput: (params) => renderMessages(pick(params, "messages")),
      renderOutput: (value) => {
        const message = pickPath(value, "choices", "0", "message");
        const content = renderContent(pick(message, "content"));
        const calls = pick(message, "tool_calls");
        if (calls) return content ? `${content}\n[tool_calls] ${stringify(calls)}` : stringify(calls);
        return content;
      },
      readUsage: readChatUsage,
      usageOf: (value) => pick(value, "usage"),
      onChunk: onChatChunk,
    })
  );

  return proxyPath(withChat, ["responses", "create"], (orig) =>
    instrument(orig, target, options, {
      defaultName: "openai.responses.create",
      renderInput: renderResponsesInput,
      renderOutput: renderResponsesOutput,
      readUsage: readResponsesUsage,
      usageOf: (value) => pick(value, "usage"),
      onChunk: onResponsesEvent,
    })
  );
}
