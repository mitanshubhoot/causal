/**
 * `causal doctor` — everything that has to be true before a trace can land,
 * checked one at a time. Never throws on a failing check: it reports all of
 * them, then exits non-zero.
 */

import { basename, relative } from "node:path";
import type { Command } from "commander";
import { contextFor, globalFlags, withCommonOptions, type CommandContext } from "../options.js";
import { CausalCliError, EXIT_CODES, toCliError } from "../errors.js";
import { color, out, printJson } from "../output.js";
import { describeSource, keyHint, type ResolvedConfig } from "../config.js";
import { detectInstalledSkills, detectRepoFacts, type RepoFacts } from "../repo.js";
import { probeHealth, type ApiClient } from "../api.js";
import type { TracesListResponse } from "../types.js";

type CheckStatus = "pass" | "warn" | "fail";

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  /** Set on the credential/auth checks so the exit code can be 3 rather than 1. */
  auth?: boolean;
}

const MIN_NODE_MAJOR = 20;

export function registerDoctor(program: Command): void {
  const command = program
    .command("doctor")
    .description("check credentials, connectivity, repo shape, runtime and installed skills")
    .action(async () => {
      await runDoctor(command);
    });
  withCommonOptions(command);
}

async function runDoctor(command: Command): Promise<void> {
  const json = globalFlags(command).json === true;

  // A diagnostic command must survive broken local state and report it, so
  // config resolution failures become a check rather than a stack unwind.
  let context: CommandContext;
  try {
    context = contextFor(command);
  } catch (err) {
    const cliError = toCliError(err);
    report(
      [
        {
          name: "config",
          status: "fail",
          detail: cliError.message,
          ...(cliError.hint === undefined ? {} : { hint: cliError.hint }),
        },
      ],
      json,
      null
    );
    process.exitCode = cliError.exitCode;
    return;
  }

  const { api, config } = context;
  const facts = detectRepoFacts(config.projectRoot);

  const checks: Check[] = [];
  checks.push(credentialsCheck(config));
  const reachable = await reachabilityCheck(api);
  checks.push(reachable);
  checks.push(await authCheck(api, config, reachable.status));
  checks.push(...repoChecks(facts));
  checks.push(runtimeCheck(facts));
  checks.push(skillsCheck(config));

  const failures = report(checks, json, config.host);
  if (failures.length > 0) {
    process.exitCode = failures.every((c) => c.auth === true) ? EXIT_CODES.auth : EXIT_CODES.internal;
  }
}

/** Print the report in whichever format was asked for; return the failures. */
function report(checks: Check[], json: boolean, host: string | null): Check[] {
  const summary = {
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
  };
  const failures = checks.filter((c) => c.status === "fail");

  if (json) {
    printJson({ ok: failures.length === 0, summary, checks, host });
    return failures;
  }

  for (const check of checks) {
    out(`${marker(check.status)} ${color.bold(padName(check.name))} ${check.detail}`);
    if (check.hint && check.status !== "pass") out(`  ${color.dim(check.hint)}`);
  }
  out();
  const warnings = `${summary.warn} warning${summary.warn === 1 ? "" : "s"}`;
  out(
    [
      `${summary.pass} passed`,
      summary.warn > 0 ? color.yellow(warnings) : warnings,
      summary.fail > 0 ? color.red(`${summary.fail} failed`) : `${summary.fail} failed`,
    ].join(color.dim(" · "))
  );
  return failures;
}

const NAME_WIDTH = 16;
const padName = (name: string): string => name.padEnd(NAME_WIDTH);

function marker(status: CheckStatus): string {
  if (status === "pass") return color.green("✓");
  if (status === "warn") return color.yellow("!");
  return color.red("✗");
}

function credentialsCheck(config: ResolvedConfig): Check {
  if (!config.apiKey) {
    return {
      name: "credentials",
      status: "fail",
      detail: "no API key resolved from flags, environment, .causal/config.json or .env",
      hint: "Run `causal login`, or export CAUSAL_API_KEY.",
      auth: true,
    };
  }
  return {
    name: "credentials",
    status: "pass",
    detail: `key ${keyHint(config.apiKey)} from ${describeSource(config, config.sources.apiKey)}`,
  };
}

async function reachabilityCheck(api: ApiClient): Promise<Check> {
  try {
    const health = await probeHealth(api);
    const degraded = Object.entries(health?.services ?? {})
      .filter(([, service]) => service.status !== "connected")
      .map(([name]) => name);
    if (health?.status === "ok" && degraded.length === 0) {
      return {
        name: "api",
        status: "pass",
        detail: `${api.host} — ok${health.totalLatencyMs === undefined ? "" : ` (${health.totalLatencyMs}ms)`}`,
      };
    }
    return {
      name: "api",
      status: "warn",
      detail: `${api.host} — ${health?.status ?? "unknown"}${degraded.length > 0 ? ` (${degraded.join(", ")} disconnected)` : ""}`,
      hint: "The API answers but a dependency is down; ingest and queries may fail.",
    };
  } catch (err) {
    const cliError = err instanceof CausalCliError ? err : null;
    return {
      name: "api",
      status: "fail",
      detail: cliError?.message ?? (err instanceof Error ? err.message : String(err)),
      hint: cliError?.hint ?? "Start the API, or point --host / CAUSAL_API_URL at a Causal deployment.",
    };
  }
}

async function authCheck(api: ApiClient, config: ResolvedConfig, reachability: CheckStatus): Promise<Check> {
  if (!config.apiKey) {
    return { name: "api key", status: "fail", detail: "skipped — no key to check", auth: true };
  }
  if (reachability === "fail") {
    return { name: "api key", status: "warn", detail: "skipped — the API is unreachable" };
  }
  try {
    const response = await api.get<TracesListResponse>("/api/v1/traces", { limit: 1 });
    const count = response.traces?.length ?? 0;
    return {
      name: "api key",
      status: "pass",
      detail: `accepted by ${api.host}${count > 0 ? " · traces are readable" : " · no traces ingested yet"}`,
    };
  } catch (err) {
    const cliError = err instanceof CausalCliError ? err : null;
    return {
      name: "api key",
      status: "fail",
      detail: cliError?.message ?? String(err),
      ...(cliError?.hint === undefined ? {} : { hint: cliError.hint }),
      auth: cliError?.code === "auth",
    };
  }
}

function repoChecks(facts: RepoFacts): Check[] {
  const checks: Check[] = [];

  const shape: string[] = [];
  if (facts.languages.length > 0) {
    shape.push(facts.languages.map((l) => `${l.name} (${l.files} files)`).join(", "));
  }
  if (facts.packageManager) shape.push(facts.packageManager);
  if (facts.monorepo) shape.push("monorepo");

  const where = relative(process.cwd(), facts.root) || basename(facts.root);
  checks.push({
    name: "repo",
    status: facts.languages.length > 0 || facts.node.present || facts.python.present ? "pass" : "warn",
    detail: shape.length > 0 ? `${where} — ${shape.join(" · ")}` : `${where} — no recognizable project files`,
    ...(shape.length > 0 ? {} : { hint: "Run this from the root of the repository you want to instrument." }),
  });

  checks.push(
    facts.git.isRepo
      ? {
          name: "git",
          status: "pass",
          detail: [
            facts.git.slug ?? facts.git.remote ?? "no remote",
            facts.git.branch,
            facts.git.shortCommit ? `HEAD ${facts.git.shortCommit}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : {
          name: "git",
          status: "warn",
          detail: "not a git repository",
          hint: "Without a commit sha, spans cannot be anchored and RCA cannot blame a change.",
        }
  );

  const agentSurface = [...facts.agentLibraries];
  checks.push({
    name: "agent surface",
    status: agentSurface.length > 0 ? "pass" : "warn",
    detail:
      agentSurface.length > 0
        ? agentSurface.join(", ")
        : "no LLM or agent library detected in the manifests",
    ...(agentSurface.length > 0
      ? {}
      : { hint: "Causal traces agent runs — run `causal instrument` to see what it would tell an agent to wrap." }),
  });

  if (facts.existingTracing.length > 0) {
    const hasCausal = facts.existingTracing.some((name) => name === "@causal/sdk" || name === "causal-sdk");
    checks.push({
      name: "tracing",
      status: "pass",
      detail: hasCausal
        ? `Causal SDK installed (${facts.existingTracing.join(", ")})`
        : `other tracing present: ${facts.existingTracing.join(", ")}`,
      ...(hasCausal ? {} : { hint: "Causal can run alongside it — extend, do not replace." }),
    });
  }

  return checks;
}

function runtimeCheck(facts: RepoFacts): Check {
  const major = Number(process.versions.node.split(".")[0]);
  const detail = `node ${process.version} on ${process.platform}-${process.arch}${
    facts.packageManager ? ` · ${facts.packageManager}` : ""
  }`;
  if (Number.isNaN(major) || major < 18) {
    return {
      name: "runtime",
      status: "fail",
      detail,
      hint: `The Causal CLI and SDK need Node ${MIN_NODE_MAJOR}+ (global fetch).`,
    };
  }
  if (major < MIN_NODE_MAJOR) {
    return { name: "runtime", status: "warn", detail, hint: `Node ${MIN_NODE_MAJOR}+ is recommended.` };
  }
  return { name: "runtime", status: "pass", detail };
}

function skillsCheck(config: ResolvedConfig): Check {
  const skills = detectInstalledSkills(config.projectRoot);
  if (skills.length === 0) {
    return {
      name: "agent skills",
      status: "warn",
      detail: "no Causal skills found in .claude/skills or .agents/skills",
      hint: "Copy the skills/ directory from the Causal repo into .claude/skills/ to teach your agent the workflows.",
    };
  }
  const scopes = [...new Set(skills.map((skill) => skill.scope))].join(" + ");
  return {
    name: "agent skills",
    status: "pass",
    detail: `${skills.map((skill) => skill.name).join(", ")} (${scopes})`,
  };
}
