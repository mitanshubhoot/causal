import type { Sandbox, TestCommandSpec, SandboxLogger } from "./sandbox.js";
import { config } from "../config.js";

/**
 * Verification = actually running the repo's test suite against the patched
 * working tree inside a sandbox.
 *
 * The one rule that matters: `ran: false` means we learned NOTHING. A caller
 * that cannot detect a test command, or whose tests timed out, must not tell
 * the user (or a GitHub check run) that the fix is verified.
 */

const MAX_OUTPUT_CHARS = 16_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 300_000;

export interface VerificationResult {
  /** Did a test suite actually execute? Everything else is only meaningful when true. */
  ran: boolean;
  /** Exit code 0. False whenever `ran` is false. */
  passed: boolean;
  exitCode: number | null;
  /** Combined stdout+stderr, tail-truncated. */
  output: string;
  durationMs: number;
  /** The command we ran, e.g. "pnpm test". null when nothing ran. */
  command: string | null;
  /** Killed by the timeout rather than finishing. */
  timedOut: boolean;
  /** Why nothing ran, when `ran` is false. */
  reason?: string;
  /** Dependency install outcome, when one was attempted. */
  install?: { ran: boolean; ok: boolean; command: string; durationMs: number };
  /** How the test command was found, e.g. "package.json#scripts.test". */
  detectedFrom?: string;
}

export interface VerifyFixOptions {
  sandbox: Sandbox;
  /**
   * Override the detected command. A bare string is split on whitespace and run
   * WITHOUT a shell, so "npm test && lint" will not do what it looks like —
   * pass a TestCommandSpec when you need something precise.
   */
  testCommand?: string | TestCommandSpec | null;
  /** Test-suite timeout. Defaults to SANDBOX_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Install dependencies first (default true — most suites cannot run without). */
  installDeps?: boolean;
  installTimeoutMs?: number;
  logger?: SandboxLogger;
}

/** Keep the tail: the failing assertion and the summary line live at the end. */
function tail(s: string, max = MAX_OUTPUT_CHARS): string {
  if (s.length <= max) return s;
  return `… [truncated ${s.length - max} chars]\n${s.slice(s.length - max)}`;
}

function notRun(reason: string, durationMs: number): VerificationResult {
  return { ran: false, passed: false, exitCode: null, output: "", durationMs, command: null, timedOut: false, reason };
}

/** "pnpm run test --filter x" → {command:"pnpm", args:[...]}. No shell, ever. */
function parseCommandString(raw: string): { command: string; args: string[] } | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const command = parts[0];
  if (!command) return null;
  if (/[;&|><`$(){}]/.test(raw)) return null; // shell metacharacters: we do not run a shell
  return { command, args: parts.slice(1) };
}

/**
 * Run the test suite in the sandbox and report exactly what happened.
 *
 * Returns `{ran:false}` — never a cheerful default — when no test command can
 * be detected, when the command is not one we are willing to execute, or when
 * dependency installation fails so the suite never starts.
 */
export async function verifyFix(opts: VerifyFixOptions): Promise<VerificationResult> {
  const { sandbox } = opts;
  const started = Date.now();
  const timeoutMs = Math.max(5_000, opts.timeoutMs ?? config.SANDBOX_TIMEOUT_MS);

  // 1. Work out what to run.
  let spec: TestCommandSpec | null = null;
  if (typeof opts.testCommand === "string" && opts.testCommand.trim()) {
    const parsed = parseCommandString(opts.testCommand);
    if (!parsed) return notRun(`unusable test command: ${opts.testCommand}`, Date.now() - started);
    spec = {
      kind: "custom",
      command: parsed.command,
      args: parsed.args,
      display: `${parsed.command} ${parsed.args.join(" ")}`.trim(),
      source: "caller",
    };
  } else if (opts.testCommand && typeof opts.testCommand === "object") {
    spec = opts.testCommand;
  } else {
    try {
      spec = await sandbox.detectTestCommand();
    } catch (err) {
      opts.logger?.warn({ err }, "verify: test-command detection failed");
      spec = null;
    }
  }
  if (!spec) return notRun("no test command could be detected for this repo", Date.now() - started);

  // 2. Install dependencies when the ecosystem needs them. A failed install is
  //    not a failed test — it means we could not verify, so ran stays false.
  let install: VerificationResult["install"];
  const wantInstall = opts.installDeps !== false && Boolean(spec.install);
  if (wantInstall && spec.install) {
    const iStarted = Date.now();
    try {
      const res = await sandbox.runCommand(spec.install.command, spec.install.args, {
        timeoutMs: Math.max(timeoutMs, opts.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS),
      });
      install = { ran: true, ok: res.exitCode === 0, command: spec.install.display, durationMs: Date.now() - iStarted };
      if (res.exitCode !== 0) {
        return {
          ...notRun(`dependency install failed (${spec.install.display})`, Date.now() - started),
          output: tail(`${res.stdout}\n${res.stderr}`.trim()),
          install,
        };
      }
    } catch (err) {
      opts.logger?.warn({ err }, "verify: dependency install could not be executed");
      return {
        ...notRun(`dependency install could not be executed: ${err instanceof Error ? err.message : String(err)}`, Date.now() - started),
        install: { ran: false, ok: false, command: spec.install.display, durationMs: Date.now() - iStarted },
      };
    }
  }

  // 3. Run the suite.
  try {
    const res = await sandbox.runCommand(spec.command, spec.args, { timeoutMs });
    const output = tail(`${res.stdout}\n${res.stderr}`.trim());
    // A timeout tells us nothing about correctness — do not call it a failure
    // the user should act on, and never call it verified.
    if (res.timedOut) {
      return {
        ran: false,
        passed: false,
        exitCode: null,
        output,
        durationMs: Date.now() - started,
        command: spec.display,
        timedOut: true,
        reason: `test suite exceeded ${timeoutMs}ms and was killed`,
        ...(install ? { install } : {}),
        detectedFrom: spec.source,
      };
    }
    // exitCode null without a timeout means the process died on a signal or
    // never started — we cannot claim a result from that either.
    if (res.exitCode === null) {
      return {
        ...notRun("test process did not produce an exit code", Date.now() - started),
        output,
        command: spec.display,
        ...(install ? { install } : {}),
        detectedFrom: spec.source,
      };
    }
    return {
      ran: true,
      passed: res.exitCode === 0,
      exitCode: res.exitCode,
      output,
      durationMs: Date.now() - started,
      command: spec.display,
      timedOut: false,
      ...(install ? { install } : {}),
      detectedFrom: spec.source,
    };
  } catch (err) {
    // e.g. the runner isn't on the sandbox allowlist.
    opts.logger?.warn({ err }, "verify: test command could not be executed");
    return {
      ...notRun(`test command could not be executed: ${err instanceof Error ? err.message : String(err)}`, Date.now() - started),
      command: spec.display,
      ...(install ? { install } : {}),
      detectedFrom: spec.source,
    };
  }
}

/** One-line, honest description for a PR body or a check-run summary. */
export function describeVerification(v: VerificationResult | null | undefined): string {
  if (!v) return "Not verified — no sandbox run was attempted.";
  if (!v.ran) return `Not verified — ${v.reason ?? "the test suite did not run"}.`;
  const secs = (v.durationMs / 1000).toFixed(1);
  return v.passed
    ? `Verified — \`${v.command}\` passed in the sandbox (${secs}s).`
    : `Not verified — \`${v.command}\` failed with exit code ${v.exitCode} (${secs}s).`;
}
