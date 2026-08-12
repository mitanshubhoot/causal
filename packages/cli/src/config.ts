/**
 * Credential + host resolution.
 *
 * Precedence, highest first:
 *   1. flags        --api-key / --host
 *   2. environment  CAUSAL_API_KEY / CAUSAL_API_URL / CAUSAL_ORG_ID
 *   3. project file ./.causal/config.json
 *   4. dotenv       ./.env
 *
 * "./" means the project root: the nearest ancestor directory of the working
 * directory holding `.causal/` or `.git/` (the working directory itself when
 * neither exists), so the CLI behaves the same from any subdirectory of a repo.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { internalError } from "./errors.js";

export const DEFAULT_HOST = "http://localhost:3001";
export const CONFIG_DIR = ".causal";
export const CONFIG_FILE = "config.json";

export type Source = "flag" | "env" | "config" | "dotenv" | "default" | "missing";

export interface ConfigFile {
  apiKey?: string;
  host?: string;
  orgId?: string;
}

export interface ResolvedConfig {
  /** Causal API base URL, never with a trailing slash. */
  host: string;
  /** Empty string when no credential was found anywhere. */
  apiKey: string;
  orgId: string | undefined;
  sources: { host: Source; apiKey: Source; orgId: Source };
  /** Where the project root was resolved to. */
  projectRoot: string;
  /** Absolute path of the config file, present only when it exists. */
  configPath: string | undefined;
  /** Absolute path of the .env that contributed values, when it exists. */
  dotenvPath: string | undefined;
}

export interface ConfigFlags {
  apiKey?: string | undefined;
  host?: string | undefined;
}

/** Nearest ancestor holding `.causal/` or `.git/`; falls back to `cwd`. */
export function findProjectRoot(cwd: string = process.cwd()): string {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, CONFIG_DIR)) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

export const configPathFor = (projectRoot: string): string =>
  join(projectRoot, CONFIG_DIR, CONFIG_FILE);

/** Read `.causal/config.json`. Returns null when absent; throws when corrupt. */
export function readConfigFile(projectRoot: string): ConfigFile | null {
  const path = configPathFor(projectRoot);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw internalError(`cannot read ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw internalError(`${path} is not valid JSON`, "Delete it and run `causal login` again.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw internalError(`${path} must contain a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  const file: ConfigFile = {};
  if (typeof record["apiKey"] === "string") file.apiKey = record["apiKey"];
  if (typeof record["host"] === "string") file.host = record["host"];
  if (typeof record["orgId"] === "string") file.orgId = record["orgId"];
  return file;
}

/**
 * Minimal `.env` reader — `KEY=value`, optional `export `, `#` comments, and
 * single/double quoted values. Deliberately does not mutate `process.env`.
 */
export function readDotenv(projectRoot: string): Record<string, string> | null {
  const path = join(projectRoot, ".env");
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null; // an unreadable .env is not worth failing a command over
  }
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    values[key] = value;
  }
  return values;
}

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeHost = (host: string): string => host.trim().replace(/\/+$/, "");

/** Resolve host + credentials, recording where each value came from. */
export function resolveConfig(flags: ConfigFlags = {}, cwd: string = process.cwd()): ResolvedConfig {
  const projectRoot = findProjectRoot(cwd);
  const file = readConfigFile(projectRoot);
  const dotenv = readDotenv(projectRoot);
  const env = process.env;

  const pick = (
    candidates: Array<[Source, string | undefined]>,
    fallback: string | undefined
  ): { value: string | undefined; source: Source } => {
    for (const [source, value] of candidates) {
      const cleaned = clean(value);
      if (cleaned !== undefined) return { value: cleaned, source };
    }
    return fallback === undefined
      ? { value: undefined, source: "missing" }
      : { value: fallback, source: "default" };
  };

  const apiKey = pick(
    [
      ["flag", flags.apiKey],
      ["env", env["CAUSAL_API_KEY"]],
      ["config", file?.apiKey],
      ["dotenv", dotenv?.["CAUSAL_API_KEY"]],
    ],
    undefined
  );

  const host = pick(
    [
      ["flag", flags.host],
      ["env", env["CAUSAL_API_URL"]],
      ["config", file?.host],
      ["dotenv", dotenv?.["CAUSAL_API_URL"]],
    ],
    DEFAULT_HOST
  );

  const orgId = pick(
    [
      ["env", env["CAUSAL_ORG_ID"]],
      ["config", file?.orgId],
      ["dotenv", dotenv?.["CAUSAL_ORG_ID"]],
    ],
    undefined
  );

  return {
    host: normalizeHost(host.value ?? DEFAULT_HOST),
    apiKey: apiKey.value ?? "",
    orgId: orgId.value,
    sources: { host: host.source, apiKey: apiKey.source, orgId: orgId.source },
    projectRoot,
    configPath: file ? configPathFor(projectRoot) : undefined,
    dotenvPath: dotenv ? join(projectRoot, ".env") : undefined,
  };
}

/** Last 4 characters of a key — the only part ever printed. */
export function keyHint(apiKey: string): string {
  if (!apiKey) return "";
  return apiKey.length <= 4 ? "*".repeat(apiKey.length) : `…${apiKey.slice(-4)}`;
}

export function describeSource(config: ResolvedConfig, source: Source): string {
  const short = (path: string): string => relative(process.cwd(), path) || path;
  switch (source) {
    case "flag":
      return "command-line flag";
    case "env":
      return "environment";
    case "config":
      return config.configPath ? short(config.configPath) : `${CONFIG_DIR}/${CONFIG_FILE}`;
    case "dotenv":
      return config.dotenvPath ? short(config.dotenvPath) : ".env";
    case "default":
      return "built-in default";
    default:
      return "not set";
  }
}
