/**
 * Options every command shares. They are declared on the root program *and* on
 * each leaf command so both `causal --json traces list` and
 * `causal traces list --json` parse; `optsWithGlobals()` then merges them
 * (leaf wins, and unset boolean flags are absent rather than `false`).
 */

import type { Command } from "commander";
import { resolveConfig, type ResolvedConfig } from "./config.js";
import { ApiClient } from "./api.js";
import { usageError } from "./errors.js";

export interface GlobalFlags {
  json?: boolean;
  host?: string;
  apiKey?: string;
}

/** Attach `--json`, `--host` and `--api-key` to a command. */
export function withCommonOptions(command: Command): Command {
  return command
    .option("--json", "print one machine-readable JSON document on stdout")
    .option("--host <url>", "Causal API base URL (overrides env and config)")
    .option("--api-key <key>", "Causal API key (overrides env and config)");
}

export function globalFlags(command: Command): GlobalFlags {
  const opts = command.optsWithGlobals() as Record<string, unknown>;
  const flags: GlobalFlags = {};
  if (opts["json"] === true) flags.json = true;
  if (typeof opts["host"] === "string") flags.host = opts["host"];
  if (typeof opts["apiKey"] === "string") flags.apiKey = opts["apiKey"];
  return flags;
}

export interface CommandContext {
  flags: GlobalFlags;
  json: boolean;
  config: ResolvedConfig;
  api: ApiClient;
}

/** Resolve credentials + build an API client for a command invocation. */
export function contextFor(command: Command): CommandContext {
  const flags = globalFlags(command);
  const config = resolveConfig({ apiKey: flags.apiKey, host: flags.host });
  return { flags, json: flags.json === true, config, api: ApiClient.fromConfig(config) };
}

/** Parse and validate a `--limit` value. */
export function parseLimit(value: string | undefined, fallback: number, max = 500): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw usageError(`--limit must be an integer between 1 and ${max} (got "${value}")`);
  }
  return n;
}
