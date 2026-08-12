/**
 * `causal login` — validate a key against the API, then persist it to
 * ./.causal/config.json (0600) and keep that directory out of git.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { dirname, join, relative } from "node:path";
import type { Command } from "commander";
import { ApiClient, probeHealth } from "../api.js";
import {
  CONFIG_DIR,
  configPathFor,
  DEFAULT_HOST,
  findProjectRoot,
  keyHint,
  normalizeHost,
  readConfigFile,
  type ConfigFile,
} from "../config.js";
import { usageError } from "../errors.js";
import { color, out, printJson, renderFields } from "../output.js";
import { globalFlags, withCommonOptions } from "../options.js";

const GITIGNORE_ENTRY = `${CONFIG_DIR}/`;

export function registerLogin(program: Command): void {
  const command = program
    .command("login")
    .description("validate a Causal API key and save it to ./.causal/config.json")
    .action(async () => {
      await runLogin(command);
    });
  withCommonOptions(command);
}

async function runLogin(command: Command): Promise<void> {
  const flags = globalFlags(command);
  const json = flags.json === true;
  const projectRoot = findProjectRoot();
  // A corrupt config file must not block the one command that repairs it.
  let existing: ConfigFile | null = null;
  try {
    existing = readConfigFile(projectRoot);
  } catch {
    existing = null;
  }

  const host = normalizeHost(
    flags.host ?? process.env["CAUSAL_API_URL"] ?? existing?.host ?? DEFAULT_HOST
  );
  const apiKey = await collectApiKey(flags.apiKey, json, host);
  if (!apiKey) {
    throw usageError(
      "no API key provided",
      "Pass --api-key <key>, pipe it on stdin, or set CAUSAL_API_KEY."
    );
  }

  const client = new ApiClient({ host, apiKey });

  // 1. Is there a Causal API at this host at all? /api/v1/health skips auth.
  const health = await probeHealth(client);

  // 2. Does the key actually authenticate? /health is public, so probe a real
  //    authenticated route — otherwise login would "succeed" with a bad key.
  await client.get("/api/v1/traces", { limit: 1 });

  const configPath = configPathFor(projectRoot);
  const saved = writeConfig(configPath, { ...existing, apiKey, host });
  const gitignore = ensureGitignore(projectRoot);

  if (json) {
    printJson({
      ok: true,
      host,
      keyHint: keyHint(apiKey),
      configPath,
      mode: saved.mode,
      gitignore,
      health: { status: health?.status ?? "unknown", services: health?.services ?? {} },
    });
    return;
  }

  out(`${color.green("✓")} authenticated against ${color.bold(host)}`);
  out(
    renderFields([
      ["key", keyHint(apiKey)],
      ["saved to", `${relative(process.cwd(), configPath) || configPath} ${color.dim(`(mode ${saved.mode})`)}`],
      ["api health", health?.status ?? "unknown"],
      [
        "gitignore",
        gitignore.updated
          ? `added ${GITIGNORE_ENTRY} to ${relative(process.cwd(), gitignore.path) || gitignore.path}`
          : gitignore.reason,
      ],
    ])
  );
  out();
  out(color.dim("Next: causal status · causal traces list · causal doctor"));
}

/** Flag, then piped stdin, then an interactive prompt (TTY only). */
async function collectApiKey(flag: string | undefined, json: boolean, host: string): Promise<string> {
  if (flag?.trim()) return flag.trim();

  const fromEnv = process.env["CAUSAL_API_KEY"]?.trim() ?? "";

  if (!process.stdin.isTTY) {
    const piped = (await readStdin()).trim();
    if (piped) return piped.split(/\r?\n/)[0].trim();
    return fromEnv;
  }

  if (json) {
    if (fromEnv) return fromEnv;
    throw usageError("--json cannot prompt for a key", "Pass --api-key <key> or set CAUSAL_API_KEY.");
  }

  out(`Causal API key for ${color.bold(host)}`);
  if (fromEnv) out(color.dim(`Press enter to use CAUSAL_API_KEY from the environment (${keyHint(fromEnv)}).`));
  const typed = (await promptSecret("API key: ")).trim();
  return typed || fromEnv;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Read a line without echoing it. */
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const writable = rl as Interface & { _writeToOutput?: (text: string) => void };
    let muted = false;
    writable._writeToOutput = (text: string): void => {
      if (!muted) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      muted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

function writeConfig(path: string, config: ConfigFile): { mode: string } {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync only applies `mode` when creating the file — re-assert it so
  // an existing world-readable config gets locked down too.
  chmodSync(path, 0o600);
  return { mode: "0600" };
}

export interface GitignoreResult {
  path: string;
  updated: boolean;
  reason: string;
}

/** Make sure `.causal/` is ignored, creating .gitignore inside a repo if needed. */
function ensureGitignore(projectRoot: string): GitignoreResult {
  const path = join(projectRoot, ".gitignore");
  const inRepo = existsSync(join(projectRoot, ".git"));
  const exists = existsSync(path);

  if (!exists && !inRepo) {
    return { path, updated: false, reason: "skipped — not a git repository" };
  }

  let current = "";
  if (exists) {
    try {
      current = readFileSync(path, "utf8");
    } catch {
      return { path, updated: false, reason: "skipped — .gitignore is unreadable" };
    }
    const ignored = current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => line === GITIGNORE_ENTRY || line === CONFIG_DIR || line === `/${GITIGNORE_ENTRY}`);
    if (ignored) return { path, updated: false, reason: `already ignores ${GITIGNORE_ENTRY}` };
  }

  const separator = current.length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  try {
    writeFileSync(path, `${current}${separator}# Causal CLI credentials\n${GITIGNORE_ENTRY}\n`);
  } catch (err) {
    return { path, updated: false, reason: `could not update .gitignore: ${(err as Error).message}` };
  }
  return { path, updated: true, reason: `added ${GITIGNORE_ENTRY}` };
}
