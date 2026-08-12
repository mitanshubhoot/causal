/**
 * wrapAnthropic — instrument an Anthropic client so every model call emits a
 * Causal `llm` span carrying the model, the prompt/completion io, and tokens
 * and cost read off `usage.input_tokens` / `usage.output_tokens`.
 *
 * Cache tiers are priced correctly: `cache_read_input_tokens` bill at 0.1x the
 * input rate and `cache_creation_input_tokens` at 1.25x, so a cache-heavy agent
 * does not show a fictional bill. `tokensIn` reports the *total* prompt size
 * (fresh + cache read + cache write), matching how the API bills you.
 *
 * The client is accepted structurally (duck-typed), so `@causal/sdk` never
 * takes a dependency on `@anthropic-ai/sdk`.
 *
 * Usage:
 *   import Anthropic from "@anthropic-ai/sdk";
 *   import { CausalTracer } from "@causal/sdk";
 *   import { wrapAnthropic } from "@causal/sdk/integrations";
 *
 *   const tracer = new CausalTracer({ service: "research-agent" });
 *
 *   await tracer.trace("research_agent.run", async (t, root) => {
 *     const claude = wrapAnthropic(new Anthropic(), t, { parent: root });
 *
 *     // one `llm` span, nested under the run's root span
 *     const msg = await claude.messages.create({
 *       model: "claude-opus-5",
 *       max_tokens: 16000,
 *       messages: [{ role: "user", content: "Summarise this incident." }],
 *     });
 *     return msg.content;
 *   });
 *
 * `messages.stream(...)` and `messages.create({ stream: true })` are both
 * instrumented; the span closes when the stream finishes, errors, or the
 * consumer breaks out of the loop.
 */

import {
  attrs,
  buildIo,
  errMessage,
  isPromiseLike,
  num,
  openSpan,
  pick,
  pickPath,
  priceFor,
  proxyPath,
  roundCost,
  str,
  stringify,
  traceStream,
  type SpanTarget,
  type WrapOptions,
} from "./internal.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- proxy plumbing is inherently untyped */
type AnyFn = (...args: any[]) => any;

/** Anthropic bills cache reads at 0.1x and cache writes at 1.25x the input rate. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/* ── prompt / completion rendering ──────────────────────────────────── */

/** Render a content value: a string, or Anthropic's block array. */
function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? "" : stringify(content);
  return content
    .map((block) => {
      const type = str(pick(block, "type"));
      switch (type) {
        case "text":
          return String(pick(block, "text") ?? "");
        case "thinking":
          return `[thinking] ${String(pick(block, "thinking") ?? "")}`;
        case "redacted_thinking":
          return "[thinking redacted]";
        case "tool_use":
          return `[tool_use ${String(pick(block, "name") ?? "")}] ${stringify(pick(block, "input"))}`;
        case "tool_result":
          return `[tool_result] ${renderContent(pick(block, "content"))}`;
        case "image":
          return "[image]";
        case "document":
          return "[document]";
        default:
          return `[${type ?? "block"}]`;
      }
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Flatten `system` + `messages` into a readable transcript. */
function renderInput(params: unknown): string {
  const lines: string[] = [];
  const system = pick(params, "system");
  if (system !== undefined && system !== null) {
    const rendered = renderContent(system);
    if (rendered) lines.push(`system: ${rendered}`);
  }
  const messages = pick(params, "messages");
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const role = String(pick(message, "role") ?? "user");
      lines.push(`${role}: ${renderContent(pick(message, "content"))}`);
    }
  } else if (messages !== undefined) {
    lines.push(stringify(messages));
  }
  return lines.join("\n");
}

/* ── usage ─────────────────────────────────────────────────────────── */

interface Usage {
  /** Fresh (uncached) prompt tokens. */
  fresh: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function readUsage(usage: unknown): Usage | undefined {
  const fresh = num(pick(usage, "input_tokens"));
  const output = num(pick(usage, "output_tokens"));
  const cacheRead = num(pick(usage, "cache_read_input_tokens"));
  const cacheWrite = num(pick(usage, "cache_creation_input_tokens"));
  if (fresh === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return undefined;
  }
  return { fresh: fresh ?? 0, output: output ?? 0, cacheRead: cacheRead ?? 0, cacheWrite: cacheWrite ?? 0 };
}

/** Merge a streamed `message_delta` usage patch onto what `message_start` gave us. */
function mergeUsage(base: Usage | undefined, patch: Usage | undefined): Usage | undefined {
  if (!patch) return base;
  if (!base) return patch;
  return {
    fresh: patch.fresh || base.fresh,
    output: patch.output || base.output,
    cacheRead: patch.cacheRead || base.cacheRead,
    cacheWrite: patch.cacheWrite || base.cacheWrite,
  };
}

function costOf(model: string | undefined, usage: Usage, prices?: WrapOptions["prices"]): number {
  const price = priceFor(model, prices);
  const input =
    usage.fresh * price.in +
    usage.cacheRead * price.in * CACHE_READ_MULTIPLIER +
    usage.cacheWrite * price.in * CACHE_WRITE_MULTIPLIER;
  return roundCost((input + usage.output * price.out) / 1_000_000);
}

/* ── the wrapper ───────────────────────────────────────────────────── */

interface Accumulator {
  text: string;
  usage?: Usage;
  model?: string;
  messageId?: string;
  stopReason?: string;
}

function instrument(orig: AnyFn, target: SpanTarget, options: WrapOptions, defaultName: string): AnyFn {
  return function call(...args: unknown[]): unknown {
    const params = args[0];
    const requestedModel = str(pick(params, "model"));
    const streaming = pick(params, "stream") === true || defaultName.endsWith(".stream");
    const span = openSpan(target, options.spanName ?? defaultName, "llm", options.parent);
    const input = renderInput(params);

    const close = (
      output: string,
      usage: Usage | undefined,
      extra: Record<string, unknown>,
      error?: unknown
    ): void => {
      const model = str(extra["model"]) ?? requestedModel;
      const end: Parameters<typeof span.end>[0] = {
        status: error ? "error" : "ok",
        attributes: attrs({
          provider: "anthropic",
          model,
          stream: streaming ? "true" : "false",
          max_tokens: num(pick(params, "max_tokens")),
          thinking: str(pickPath(params, "thinking", "type")),
          effort: str(pickPath(params, "output_config", "effort")),
          "cache.read_tokens": usage && usage.cacheRead > 0 ? usage.cacheRead : undefined,
          "cache.write_tokens": usage && usage.cacheWrite > 0 ? usage.cacheWrite : undefined,
          ...extra,
        }),
      };
      const io = buildIo(options, input, output);
      if (io) end.io = io;
      if (usage) {
        end.tokensIn = usage.fresh + usage.cacheRead + usage.cacheWrite;
        end.tokensOut = usage.output;
        end.cost = costOf(model, usage, options.prices);
      }
      if (error) end.error = errMessage(error);
      // A safety-classifier decline is a successful HTTP call that produced no
      // answer — surface it as a warn so detectors can see it, not a silent ok.
      if (!error && extra["stop_reason"] === "refusal") end.status = "warn";
      span.end(end);
      void span.finish();
    };

    const onMessage = (message: unknown): void => {
      close(renderContent(pick(message, "content")), readUsage(pick(message, "usage")), {
        model: str(pick(message, "model")),
        "message.id": str(pick(message, "id")),
        stop_reason: str(pick(message, "stop_reason")),
        "stop_details.category": str(pickPath(message, "stop_details", "category")),
      });
    };

    const onStream = (stream: object): object => {
      const acc: Accumulator = { text: "" };
      return traceStream(
        stream,
        (event) => onStreamEvent(acc, event),
        (err) =>
          close(acc.text, acc.usage, {
            model: acc.model,
            "message.id": acc.messageId,
            stop_reason: acc.stopReason,
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

    // `messages.stream()` hands back a MessageStream that buffers internally.
    // `finalMessage()` resolves once the stream completes and does not steal
    // events from the caller's iteration, so we can observe without wrapping.
    const finalMessage = pick(result, "finalMessage");
    if (typeof finalMessage === "function") {
      try {
        const settled = (finalMessage as AnyFn).call(result) as unknown;
        if (isPromiseLike(settled)) {
          void Promise.resolve(settled).then(onMessage, (err: unknown) => close("", undefined, {}, err));
          return result;
        }
      } catch (err) {
        close("", undefined, {}, err);
      }
      return result;
    }

    if (isPromiseLike(result)) {
      if (!streaming) {
        // Observe without replacing the returned value: the Anthropic SDK hands
        // back an APIPromise and callers rely on `.withResponse()`.
        void Promise.resolve(result).then(onMessage, (err: unknown) => close("", undefined, {}, err));
        return result;
      }
      return Promise.resolve(result).then(
        (value: unknown) => (value && typeof value === "object" ? onStream(value) : value),
        (err: unknown) => {
          close("", undefined, {}, err);
          throw err;
        }
      );
    }

    if (streaming && result && typeof result === "object") return onStream(result);
    onMessage(result);
    return result;
  };
}

/** Accumulate one server-sent event off a `messages` stream. */
function onStreamEvent(acc: Accumulator, event: unknown): void {
  const type = str(pick(event, "type"));

  if (type === "message_start") {
    const message = pick(event, "message");
    acc.model = str(pick(message, "model")) ?? acc.model;
    acc.messageId = str(pick(message, "id")) ?? acc.messageId;
    acc.usage = mergeUsage(acc.usage, readUsage(pick(message, "usage")));
    return;
  }

  if (type === "content_block_start") {
    const block = pick(event, "content_block");
    if (str(pick(block, "type")) === "tool_use") {
      acc.text += `\n[tool_use ${String(pick(block, "name") ?? "")}] `;
    }
    return;
  }

  if (type === "content_block_delta") {
    const delta = pick(event, "delta");
    const deltaType = str(pick(delta, "type"));
    if (deltaType === "text_delta") {
      const text = pick(delta, "text");
      if (typeof text === "string") acc.text += text;
    } else if (deltaType === "thinking_delta") {
      const thinking = pick(delta, "thinking");
      if (typeof thinking === "string") acc.text += thinking;
    } else if (deltaType === "input_json_delta") {
      const partial = pick(delta, "partial_json");
      if (typeof partial === "string") acc.text += partial;
    }
    return;
  }

  if (type === "message_delta") {
    acc.stopReason = str(pickPath(event, "delta", "stop_reason")) ?? acc.stopReason;
    acc.usage = mergeUsage(acc.usage, readUsage(pick(event, "usage")));
  }
}

/**
 * Wrap an Anthropic-shaped client so `messages.create`, `messages.stream` and
 * `beta.messages.create` emit `llm` spans.
 *
 * The original client is never mutated — a Proxy is returned.
 *
 * @param client  An `Anthropic` (or Bedrock/Vertex/Foundry) instance.
 * @param target  A `CausalTracer`, a live `CausalTrace`, or a parent `CausalSpan`.
 *                Prefer a trace or span: a bare tracer opens and flushes a
 *                one-span trace per call.
 * @param options Span naming, io capture limits and price-table overrides.
 */
export function wrapAnthropic<T extends object>(client: T, target: SpanTarget, options: WrapOptions = {}): T {
  if (!client || typeof client !== "object") return client;

  const withCreate = proxyPath(client, ["messages", "create"], (orig) =>
    instrument(orig, target, options, "anthropic.messages.create")
  );
  const withStream = proxyPath(withCreate, ["messages", "stream"], (orig) =>
    instrument(orig, target, options, "anthropic.messages.stream")
  );
  return proxyPath(withStream, ["beta", "messages", "create"], (orig) =>
    instrument(orig, target, options, "anthropic.beta.messages.create")
  );
}
