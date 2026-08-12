import { spawn, type ChildProcess } from "node:child_process";
import { createAppAuth } from "@octokit/auth-app";
import { mkdtemp, mkdir, rm, writeFile, readFile as fsReadFile, realpath, stat, chmod, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../config.js";

/**
 * A real, disposable git working copy.
 *
 * The GitHub REST API can read one file at one ref. That is not enough to
 * root-cause anything: you cannot `git blame` a line, you cannot pickaxe for the
 * commit that DELETED a symbol, you cannot grep across files, you cannot apply a
 * multi-file patch, and you certainly cannot run the test suite. A sandbox can.
 *
 * Everything here is off by default (SANDBOX_ENABLED=false) and every exec goes
 * through spawn() with an argv array — never a shell string — under a hard
 * timeout, with output capped and the installation token kept out of argv, out
 * of .git/config and out of every log line.
 */

// ── limits ────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_GREP_RESULTS = 200;
const MAX_PICKAXE_COMMITS = 20;
const CLONE_DEPTH = 50;

/** git subcommands the sandbox is allowed to run. Anything else throws. */
const ALLOWED_GIT = new Set([
  "init", "remote", "fetch", "checkout", "rev-parse", "rev-list", "symbolic-ref",
  "blame", "log", "grep", "show", "diff", "status", "ls-files", "cat-file",
  "apply", "add", "commit", "config",
]);

/** Binaries runCommand() may execute (test runners + package managers only). */
const ALLOWED_COMMANDS = new Set([
  "npm", "pnpm", "yarn", "bun", "npx", "node",
  "python", "python3", "pytest", "poetry", "uv",
  "make", "go", "cargo",
]);

// ── types ─────────────────────────────────────────────────────────
export interface CreateSandboxOptions {
  /** "owner/repo". */
  repoFullName: string;
  /** GitHub App installation that grants access to that repo. */
  installationId: number;
  /** Commit SHA or branch to check out. Defaults to the repo's default HEAD. */
  ref?: string | null;
  /** Clone the whole history up front (blame/pickaxe deepen on demand anyway). */
  fullHistory?: boolean;
  /** Per-command timeout. Defaults to SANDBOX_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Pre-minted installation token — skips minting a new one. */
  token?: string;
  /**
   * Override the origin URL (GitHub Enterprise, or a local `file://` repo in
   * tests). TRUSTED CALLERS ONLY — never pass anything derived from a request
   * body. When set, no installation token is minted.
   */
  remoteUrl?: string;
  /** Usually fastify.log. Only ever receives redacted strings. */
  logger?: SandboxLogger;
}

export interface SandboxLogger {
  warn: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Killed by our timeout rather than exiting on its own. */
  timedOut: boolean;
  /** Output exceeded the cap and was cut short. */
  truncated: boolean;
  durationMs: number;
}

export interface BlameResult {
  commit: string;
  author: string;
  authorEmail: string;
  /** ISO-8601, UTC. */
  date: string;
  summary: string;
  /** The blamed line's text. */
  line: string;
  lineNumber: number;
  file: string;
}

export interface PickaxeCommit {
  commit: string;
  author: string;
  date: string;
  subject: string;
  files: string[];
  /** true when this commit removed more occurrences of the symbol than it added. */
  removedSymbol: boolean;
  addedOccurrences: number;
  removedOccurrences: number;
}

export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

export interface ApplyPatchResult {
  applied: boolean;
  /** Redacted stderr from `git apply` when it refused the patch. */
  error?: string;
  /** Strip level that worked (`-p1`, then `-p0`). */
  strip?: number;
}

export interface TestCommandSpec {
  kind: "npm" | "pnpm" | "yarn" | "bun" | "pytest" | "go" | "cargo" | "make" | "custom";
  command: string;
  args: string[];
  /** Human-readable form, e.g. "pnpm test". */
  display: string;
  /** Dependency install to run first, when the ecosystem needs one. */
  install?: { command: string; args: string[]; display: string };
  /** Where the detection came from, e.g. "package.json#scripts.test". */
  source: string;
}

export interface Sandbox {
  /** Absolute path of the checkout. */
  readonly dir: string;
  readonly repoFullName: string;
  /** The commit actually checked out. */
  readonly headSha: string;
  blame(file: string, line: number): Promise<BlameResult | null>;
  pickaxe(symbol: string, opts?: { limit?: number; file?: string }): Promise<PickaxeCommit[]>;
  /** `regex: true` switches from fixed-string to POSIX ERE (git grep -E). */
  grep(pattern: string, opts?: { regex?: boolean; limit?: number; pathspec?: string }): Promise<GrepHit[]>;
  readFile(file: string): Promise<string>;
  applyPatch(unifiedDiff: string): Promise<ApplyPatchResult>;
  commitAll(message: string): Promise<string | null>;
  diff(against?: string): Promise<string>;
  changedFiles(): Promise<string[]>;
  runCommand(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<CommandResult>;
  /** Escape hatch for any ALLOWED_GIT subcommand; throws on anything else. */
  git(args: string[], opts?: { timeoutMs?: number; maxOutputBytes?: number }): Promise<CommandResult>;
  detectTestCommand(): Promise<TestCommandSpec | null>;
  ensureFullHistory(): Promise<boolean>;
  dispose(): Promise<void>;
}

export class SandboxDisabledError extends Error {
  constructor() {
    super("sandbox is disabled — set SANDBOX_ENABLED=true and configure the GitHub App");
    this.name = "SandboxDisabledError";
  }
}

/** True when a sandbox could actually be created right now. */
export function sandboxAvailable(): boolean {
  return Boolean(config.SANDBOX_ENABLED && config.GITHUB_APP_ID && config.GITHUB_APP_PRIVATE_KEY);
}

// ── helpers ───────────────────────────────────────────────────────

function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(s) <= max) return { text: s, truncated: false };
  return { text: `${s.slice(0, max)}\n… [truncated]`, truncated: true };
}

/**
 * Scrub the installation token (and anything shaped like one) out of a string.
 * Every piece of output that leaves this module goes through this — a `git`
 * failure loves to echo the URL it was given back at you.
 */
function makeRedactor(secrets: string[]): (s: string) => string {
  const real = secrets.filter((s) => s && s.length > 8);
  return (s: string) => {
    let out = s;
    for (const secret of real) out = out.split(secret).join("***");
    // Belt and braces: GitHub token shapes and any user:pass@ in a URL.
    out = out.replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, "***");
    out = out.replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1***@");
    return out;
  };
}

/** Reject absolute paths, traversal, NUL bytes and argv-injecting leading dashes. */
function safeRelPath(p: string): string {
  if (typeof p !== "string" || p.length === 0) throw new Error("path is required");
  if (p.includes("\0")) throw new Error("path contains a NUL byte");
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (norm.length === 0) throw new Error("path is required");
  if (norm.startsWith("/") || /^[A-Za-z]:\//.test(norm)) throw new Error(`absolute paths are not allowed: ${p}`);
  if (norm.startsWith("-")) throw new Error(`path may not start with '-': ${p}`);
  if (norm.split("/").some((seg) => seg === "..")) throw new Error(`parent-directory traversal is not allowed: ${p}`);
  return norm;
}

interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes?: number;
}

/**
 * spawn() with an argv array (no shell, so nothing in `args` can ever be
 * interpreted), a hard timeout that kills the whole process group (a test
 * runner spawns children — killing only the direct child leaks them), and
 * byte-capped capture so a runaway log can't exhaust memory.
 */
function spawnCapture(file: string, args: string[], opts: SpawnOptions): Promise<CommandResult> {
  const cap = opts.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const display = `${file} ${args.join(" ")}`.trim();
  const started = Date.now();

  return new Promise<CommandResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
        // Own process group so the timeout can kill the whole tree.
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        command: display, exitCode: null, stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        timedOut: false, truncated: false, durationMs: Date.now() - started,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const append = (chunk: Buffer, which: "out" | "err") => {
      const bytes = which === "out" ? outBytes : errBytes;
      if (bytes >= cap) { truncated = true; return; }
      const room = cap - bytes;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (chunk.length > room) truncated = true;
      if (which === "out") { stdout += slice.toString("utf-8"); outBytes += slice.length; }
      else { stderr += slice.toString("utf-8"); errBytes += slice.length; }
    };

    child.stdout?.on("data", (c: Buffer) => append(c, "out"));
    child.stderr?.on("data", (c: Buffer) => append(c, "err"));

    const kill = () => {
      const pid = child.pid;
      if (pid == null) return;
      try {
        if (process.platform !== "win32") process.kill(-pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }
    };

    const timer = setTimeout(() => { timedOut = true; kill(); }, Math.max(1_000, opts.timeoutMs));

    const finish = (exitCode: number | null, extraErr?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command: display,
        exitCode,
        stdout,
        stderr: extraErr ? `${stderr}${stderr ? "\n" : ""}${extraErr}` : stderr,
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      });
    };

    child.on("error", (err: Error) => finish(null, err.message));
    child.on("close", (code) => finish(timedOut ? null : code));
  });
}

async function mintInstallationToken(installationId: number): Promise<string> {
  if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GitHub App is not configured");
  }
  const auth = createAppAuth({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
    installationId,
  });
  const res = await auth({ type: "installation", installationId });
  return res.token;
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fsReadFile(file, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `npm init`'s placeholder script isn't a test suite. */
function isPlaceholderTestScript(script: string): boolean {
  const s = script.trim().toLowerCase();
  return s === "" || s.includes("no test specified") || s === "exit 1" || s === "true";
}

// ── the sandbox ───────────────────────────────────────────────────

class GitSandbox implements Sandbox {
  readonly dir: string;
  readonly repoFullName: string;
  headSha = "";

  private readonly root: string;
  private readonly gitEnv: NodeJS.ProcessEnv;
  private readonly runEnv: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  private readonly redact: (s: string) => string;
  private readonly logger: SandboxLogger | undefined;
  private disposed = false;
  private deepened = false;

  constructor(args: {
    root: string;
    dir: string;
    repoFullName: string;
    gitEnv: NodeJS.ProcessEnv;
    runEnv: NodeJS.ProcessEnv;
    timeoutMs: number;
    redact: (s: string) => string;
    logger?: SandboxLogger | undefined;
  }) {
    this.root = args.root;
    this.dir = args.dir;
    this.repoFullName = args.repoFullName;
    this.gitEnv = args.gitEnv;
    this.runEnv = args.runEnv;
    this.timeoutMs = args.timeoutMs;
    this.redact = args.redact;
    this.logger = args.logger;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("sandbox has been disposed");
  }

  /** Every git call funnels through here: allowlisted subcommand, no shell. */
  async git(args: string[], opts?: { timeoutMs?: number; maxOutputBytes?: number }): Promise<CommandResult> {
    this.assertLive();
    const sub = args[0];
    if (!sub || !ALLOWED_GIT.has(sub)) throw new Error(`git subcommand not allowed: ${String(sub)}`);
    const res = await spawnCapture("git", args, {
      cwd: this.dir,
      env: this.gitEnv,
      timeoutMs: opts?.timeoutMs ?? this.timeoutMs,
      ...(opts?.maxOutputBytes !== undefined ? { maxOutputBytes: opts.maxOutputBytes } : {}),
    });
    return {
      ...res,
      command: this.redact(res.command),
      stdout: this.redact(res.stdout),
      stderr: this.redact(res.stderr),
    };
  }

  private async gitOut(args: string[], opts?: { timeoutMs?: number; maxOutputBytes?: number }): Promise<string> {
    const res = await this.git(args, opts);
    if (res.exitCode !== 0) return "";
    return res.stdout;
  }

  /**
   * blame/pickaxe are meaningless on a shallow clone — every line is attributed
   * to the grafted boundary commit — so deepen on demand rather than paying for
   * full history on every clone.
   */
  async ensureFullHistory(): Promise<boolean> {
    this.assertLive();
    if (this.deepened) return true;
    const shallow = (await this.gitOut(["rev-parse", "--is-shallow-repository"])).trim();
    if (shallow !== "true") { this.deepened = true; return true; }

    const attempts: string[][] = [
      ["fetch", "--quiet", "--unshallow", "origin"],
      ["fetch", "--quiet", "--depth", "2147483647", "origin"],
    ];
    for (const args of attempts) {
      const res = await this.git(args, { timeoutMs: this.timeoutMs });
      if (res.exitCode === 0) { this.deepened = true; return true; }
      this.logger?.warn({ stderr: res.stderr.slice(0, 500), repo: this.repoFullName }, "sandbox: deepening history failed");
    }
    return false;
  }

  async blame(file: string, line: number): Promise<BlameResult | null> {
    const rel = safeRelPath(file);
    const n = Math.max(1, Math.floor(Number(line) || 1));
    await this.ensureFullHistory();
    // --porcelain is the only stable machine format; -w ignores whitespace-only
    // reformatting so we blame the commit that changed the logic.
    const res = await this.git(["blame", "--porcelain", "-w", "-L", `${n},${n}`, "HEAD", "--", rel]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return null;

    const lines = res.stdout.split("\n");
    const header = lines[0] ?? "";
    const sha = header.split(" ")[0] ?? "";
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;

    const field = (key: string): string => {
      const hit = lines.find((l) => l.startsWith(`${key} `));
      return hit ? hit.slice(key.length + 1).trim() : "";
    };
    const authorTime = Number(field("author-time"));
    const content = lines.find((l) => l.startsWith("\t"));

    return {
      commit: sha,
      author: field("author") || "unknown",
      authorEmail: field("author-mail").replace(/[<>]/g, ""),
      date: Number.isFinite(authorTime) && authorTime > 0 ? new Date(authorTime * 1000).toISOString() : "",
      summary: field("summary"),
      line: content ? content.slice(1) : "",
      lineNumber: n,
      file: field("filename") || rel,
    };
  }

  /**
   * `git log -S` (the pickaxe) finds commits where the NUMBER of occurrences of
   * a string changed — the only reliable way to find the commit that DELETED a
   * function, which is invisible to any "read the current file" approach.
   */
  async pickaxe(symbol: string, opts?: { limit?: number; file?: string }): Promise<PickaxeCommit[]> {
    this.assertLive();
    const needle = (symbol ?? "").trim();
    if (!needle) throw new Error("pickaxe needs a symbol");
    if (needle.length > 200) throw new Error("pickaxe symbol is too long");
    await this.ensureFullHistory();

    const limit = Math.min(Math.max(1, opts?.limit ?? 10), MAX_PICKAXE_COMMITS);
    const args = [
      "log",
      `-S${needle}`,                      // -S must be attached; never shell-quoted
      "--max-count", String(limit),
      "--no-color",
      "--name-only",
      "--pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s",
    ];
    if (opts?.file) args.push("--", safeRelPath(opts.file));

    const out = await this.gitOut(args, { maxOutputBytes: MAX_OUTPUT_BYTES });
    const records = out.split("\x1e").filter((r) => r.trim().length > 0);

    const commits: PickaxeCommit[] = [];
    for (const record of records) {
      const [head = "", ...rest] = record.split("\n");
      const [sha = "", author = "", date = "", subject = ""] = head.split("\x1f");
      if (!/^[0-9a-f]{7,40}$/.test(sha)) continue;
      const files = rest.map((f) => f.trim()).filter((f) => f.length > 0).slice(0, 50);
      const counts = await this.countSymbolDelta(sha, needle);
      commits.push({
        commit: sha,
        author,
        date,
        subject,
        files,
        addedOccurrences: counts.added,
        removedOccurrences: counts.removed,
        removedSymbol: counts.removed > counts.added,
      });
    }
    return commits;
  }

  /** Did this commit add or remove the symbol? Read its own diff and count. */
  private async countSymbolDelta(sha: string, needle: string): Promise<{ added: number; removed: number }> {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return { added: 0, removed: 0 };
    const out = await this.gitOut(
      ["show", "--no-color", "--format=", "--unified=0", sha],
      { maxOutputBytes: 128 * 1024 }
    );
    let added = 0;
    let removed = 0;
    for (const l of out.split("\n")) {
      if (l.startsWith("+++") || l.startsWith("---")) continue;
      if (!l.includes(needle)) continue;
      if (l.startsWith("+")) added++;
      else if (l.startsWith("-")) removed++;
    }
    return { added, removed };
  }

  async grep(pattern: string, opts?: { regex?: boolean; limit?: number; pathspec?: string }): Promise<GrepHit[]> {
    this.assertLive();
    const needle = (pattern ?? "").trim();
    if (!needle) throw new Error("grep needs a pattern");
    if (needle.length > 500) throw new Error("grep pattern is too long");
    const limit = Math.min(Math.max(1, opts?.limit ?? 100), MAX_GREP_RESULTS);

    // -e keeps a leading '-' in the pattern from being read as a flag; -I skips
    // binaries; fixed-string unless the caller explicitly wants a regex, in
    // which case it is POSIX ERE (-E) — no PCRE escapes like \s or \d.
    const args = ["grep", "-n", "-I", "--no-color", opts?.regex ? "-E" : "-F", "-e", needle];
    if (opts?.pathspec) args.push("--", safeRelPath(opts.pathspec));

    const res = await this.git(args, { maxOutputBytes: MAX_OUTPUT_BYTES });
    // git grep exits 1 for "no matches" — that's not an error.
    if (res.exitCode !== 0 && res.exitCode !== 1) return [];

    const hits: GrepHit[] = [];
    for (const raw of res.stdout.split("\n")) {
      if (!raw) continue;
      const first = raw.indexOf(":");
      if (first < 0) continue;
      const second = raw.indexOf(":", first + 1);
      if (second < 0) continue;
      const lineNo = Number(raw.slice(first + 1, second));
      if (!Number.isFinite(lineNo)) continue;
      hits.push({ file: raw.slice(0, first), line: lineNo, text: raw.slice(second + 1).slice(0, 500) });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  async readFile(file: string): Promise<string> {
    this.assertLive();
    const rel = safeRelPath(file);
    const abs = path.resolve(this.dir, rel);
    // Resolve symlinks too — a repo can ship a symlink pointing at /etc/passwd.
    const realDir = await realpath(this.dir);
    let realTarget: string;
    try {
      realTarget = await realpath(abs);
    } catch {
      throw new Error(`no such file in sandbox: ${rel}`);
    }
    if (realTarget !== realDir && !realTarget.startsWith(realDir + path.sep)) {
      throw new Error(`path escapes the sandbox: ${rel}`);
    }
    const info = await stat(realTarget);
    if (!info.isFile()) throw new Error(`not a file: ${rel}`);
    if (info.size > MAX_FILE_BYTES) {
      // Read only the head — never pull a multi-gigabyte file into memory.
      const fh = await open(realTarget, "r");
      try {
        const buf = Buffer.alloc(MAX_FILE_BYTES);
        const { bytesRead } = await fh.read(buf, 0, MAX_FILE_BYTES, 0);
        return `${buf.subarray(0, bytesRead).toString("utf-8")}\n… [truncated]`;
      } finally {
        await fh.close();
      }
    }
    return fsReadFile(realTarget, "utf-8");
  }

  /**
   * Apply a unified diff produced elsewhere (an LLM, usually). Tries -p1 then
   * -p0, and --check first so a bad patch never leaves a half-applied tree.
   */
  async applyPatch(unifiedDiff: string): Promise<ApplyPatchResult> {
    this.assertLive();
    if (!unifiedDiff || !unifiedDiff.trim()) return { applied: false, error: "empty patch" };
    const patchPath = path.join(this.root, `patch-${Date.now()}.diff`);
    const body = unifiedDiff.endsWith("\n") ? unifiedDiff : `${unifiedDiff}\n`;
    await writeFile(patchPath, body, { mode: 0o600 });

    let lastError = "";
    try {
      for (const strip of [1, 0]) {
        const base = [`-p${strip}`, "--whitespace=nowarn", patchPath];
        const check = await this.git(["apply", "--check", ...base]);
        if (check.exitCode !== 0) { lastError = check.stderr.trim() || check.stdout.trim(); continue; }
        const applied = await this.git(["apply", ...base]);
        if (applied.exitCode === 0) return { applied: true, strip };
        lastError = applied.stderr.trim() || applied.stdout.trim();
      }
    } finally {
      await rm(patchPath, { force: true }).catch(() => undefined);
    }
    return { applied: false, error: truncate(lastError, 2000).text };
  }

  /** Stage everything and commit. Returns the new SHA, or null if nothing changed. */
  async commitAll(message: string): Promise<string | null> {
    this.assertLive();
    const msg = (message || "causal: automated fix").slice(0, 4000);
    const add = await this.git(["add", "-A", "--", "."]);
    if (add.exitCode !== 0) throw new Error(`git add failed: ${add.stderr.slice(0, 500)}`);
    const staged = await this.git(["diff", "--cached", "--name-only"]);
    if (!staged.stdout.trim()) return null;
    // --no-verify: repo hooks are untrusted code we did not ask to run.
    const commit = await this.git(["commit", "--no-verify", "-q", "-m", msg]);
    if (commit.exitCode !== 0) throw new Error(`git commit failed: ${commit.stderr.slice(0, 500)}`);
    const sha = (await this.gitOut(["rev-parse", "HEAD"])).trim();
    this.headSha = sha || this.headSha;
    return sha || null;
  }

  /**
   * Unified diff of the working tree (or against an explicit ref). New files are
   * staged intent-to-add first so they show up instead of silently vanishing.
   */
  async diff(against?: string): Promise<string> {
    this.assertLive();
    await this.git(["add", "--intent-to-add", "-A", "--", "."]);
    const args = ["diff", "--no-color", "--patch"];
    if (against) {
      if (!/^[A-Za-z0-9._/^~-]{1,200}$/.test(against) || against.startsWith("-")) throw new Error(`invalid ref: ${against}`);
      args.push(against);
    }
    const out = await this.gitOut(args, { maxOutputBytes: MAX_OUTPUT_BYTES });
    return out;
  }

  async changedFiles(): Promise<string[]> {
    this.assertLive();
    await this.git(["add", "--intent-to-add", "-A", "--", "."]);
    const out = await this.gitOut(["diff", "--name-only"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  }

  /**
   * Run a test/build command. The binary is allowlisted and the environment is
   * rebuilt from scratch — repo code must never inherit ANTHROPIC_API_KEY,
   * POSTGRES_URL or the GitHub token from the API process.
   */
  async runCommand(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<CommandResult> {
    this.assertLive();
    if (!ALLOWED_COMMANDS.has(cmd)) throw new Error(`command not allowed in sandbox: ${cmd}`);
    for (const a of args) {
      if (typeof a !== "string" || a.includes("\0")) throw new Error("invalid command argument");
    }
    const res = await spawnCapture(cmd, args, {
      cwd: this.dir,
      env: this.runEnv,
      timeoutMs: opts?.timeoutMs ?? this.timeoutMs,
    });
    return {
      ...res,
      command: this.redact(res.command),
      stdout: this.redact(res.stdout),
      stderr: this.redact(res.stderr),
    };
  }

  /**
   * Infer how this repo runs its tests. Returns null when we cannot tell —
   * callers must then NOT claim the fix was verified.
   */
  async detectTestCommand(): Promise<TestCommandSpec | null> {
    this.assertLive();
    const at = (f: string) => path.join(this.dir, f);

    // ── Node ──
    const pkg = await readJson(at("package.json"));
    if (pkg) {
      const scripts = (pkg["scripts"] as Record<string, unknown> | undefined) ?? {};
      const testScript = typeof scripts["test"] === "string" ? scripts["test"] : "";
      if (testScript && !isPlaceholderTestScript(testScript)) {
        // The lockfile decides the package manager — running `npm test` in a
        // pnpm workspace installs the wrong tree and fails for the wrong reason.
        const pm = (await exists(at("pnpm-lock.yaml")))
          ? { kind: "pnpm" as const, install: { command: "pnpm", args: ["install", "--frozen-lockfile"], display: "pnpm install --frozen-lockfile" } }
          : (await exists(at("yarn.lock")))
            ? { kind: "yarn" as const, install: { command: "yarn", args: ["install", "--frozen-lockfile"], display: "yarn install --frozen-lockfile" } }
            : (await exists(at("bun.lockb")))
              ? { kind: "bun" as const, install: { command: "bun", args: ["install", "--frozen-lockfile"], display: "bun install --frozen-lockfile" } }
              : (await exists(at("package-lock.json")))
                ? { kind: "npm" as const, install: { command: "npm", args: ["ci", "--no-audit", "--no-fund"], display: "npm ci" } }
                : { kind: "npm" as const, install: { command: "npm", args: ["install", "--no-audit", "--no-fund"], display: "npm install" } };
        return {
          kind: pm.kind,
          command: pm.kind,
          args: pm.kind === "npm" ? ["test", "--silent"] : ["test"],
          display: `${pm.kind} test`,
          install: pm.install,
          source: "package.json#scripts.test",
        };
      }
    }

    // ── Python ──
    const pyproject = (await exists(at("pyproject.toml"))) ? await fsReadFile(at("pyproject.toml"), "utf-8").catch(() => "") : "";
    // Require a real Python project marker — a bare `tests/` directory exists in
    // Go and Java repos too, and guessing pytest there fails for a bogus reason.
    const isPython =
      Boolean(pyproject) ||
      (await exists(at("pytest.ini"))) ||
      (await exists(at("conftest.py"))) ||
      (await exists(at("setup.py"))) ||
      (await exists(at("requirements.txt"))) ||
      (await exists(at("tox.ini")));
    if (isPython) {
      const usesPoetry = pyproject.includes("[tool.poetry");
      const hasRequirements = await exists(at("requirements.txt"));
      const install = usesPoetry
        ? { command: "poetry", args: ["install", "--no-interaction"], display: "poetry install" }
        : hasRequirements
          ? { command: "python3", args: ["-m", "pip", "install", "-q", "-r", "requirements.txt"], display: "pip install -r requirements.txt" }
          : null;
      return {
        kind: "pytest",
        command: usesPoetry ? "poetry" : "python3",
        args: usesPoetry ? ["run", "pytest", "-q"] : ["-m", "pytest", "-q"],
        display: usesPoetry ? "poetry run pytest -q" : "python3 -m pytest -q",
        ...(install ? { install } : {}),
        source: pyproject ? "pyproject.toml" : "python project layout",
      };
    }

    // ── Go / Rust / Make ──
    if (await exists(at("go.mod"))) {
      return { kind: "go", command: "go", args: ["test", "./..."], display: "go test ./...", source: "go.mod" };
    }
    if (await exists(at("Cargo.toml"))) {
      return { kind: "cargo", command: "cargo", args: ["test"], display: "cargo test", source: "Cargo.toml" };
    }
    for (const mk of ["Makefile", "makefile", "GNUmakefile"]) {
      if (!(await exists(at(mk)))) continue;
      const body = await fsReadFile(at(mk), "utf-8").catch(() => "");
      if (/^\.?test:/m.test(body) || /^test:/m.test(body)) {
        return { kind: "make", command: "make", args: ["test"], display: "make test", source: `${mk}#test` };
      }
    }
    return null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await rm(this.root, { recursive: true, force: true, maxRetries: 3 });
    } catch (err) {
      this.logger?.warn({ err, root: this.root }, "sandbox: temp dir could not be removed");
    }
  }
}

// ── construction ──────────────────────────────────────────────────

function sandboxRoot(): string {
  return config.SANDBOX_ROOT && config.SANDBOX_ROOT.trim().length > 0
    ? config.SANDBOX_ROOT
    : path.join(tmpdir(), "causal-sandboxes");
}

/**
 * Clone `repoFullName` at `ref` into a fresh 0700 temp dir and hand back a
 * handle. The installation token is passed to git through GIT_ASKPASS (an env
 * var, readable only by this uid) instead of the clone URL — so it never lands
 * in argv, in .git/config, or in an error message git echoes back.
 *
 * ALWAYS dispose the handle in a finally (or use withSandbox).
 */
export async function createSandbox(opts: CreateSandboxOptions): Promise<Sandbox> {
  if (!config.SANDBOX_ENABLED) throw new SandboxDisabledError();
  const [owner, repo] = (opts.repoFullName ?? "").split("/");
  if (!owner || !repo || !/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    throw new Error(`invalid repo: ${opts.repoFullName}`);
  }
  const ref = (opts.ref ?? "").trim();
  if (ref && (!/^[A-Za-z0-9._/-]{1,255}$/.test(ref) || ref.startsWith("-") || ref.includes(".."))) {
    throw new Error(`invalid ref: ${ref}`);
  }
  const timeoutMs = Math.max(5_000, opts.timeoutMs ?? config.SANDBOX_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  if (opts.remoteUrl && !/^(https?|file):\/\//.test(opts.remoteUrl)) {
    throw new Error("remoteUrl must be an http(s) or file URL");
  }
  const token = opts.token ?? (opts.remoteUrl ? "" : await mintInstallationToken(opts.installationId));
  const redact = makeRedactor([token]);

  await mkdir(sandboxRoot(), { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(sandboxRoot(), "sbx-"));
  await chmod(root, 0o700).catch(() => undefined);
  const dir = path.join(root, "repo");
  const home = path.join(root, "home");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await mkdir(home, { recursive: true, mode: 0o700 });

  // GIT_ASKPASS keeps the token in this process tree's environment only.
  const askpass = path.join(root, "askpass.sh");
  await writeFile(askpass, '#!/bin/sh\nprintf "%s" "$CAUSAL_GIT_TOKEN"\n', { mode: 0o700 });
  await chmod(askpass, 0o700).catch(() => undefined);

  const basePath = process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin";
  const gitEnv: NodeJS.ProcessEnv = {
    PATH: basePath,
    HOME: home,
    LANG: "C",
    // Ignore the host's global/system git config, hooks and aliases entirely.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: askpass,
    CAUSAL_GIT_TOKEN: token,
    GIT_AUTHOR_NAME: "Causal",
    GIT_AUTHOR_EMAIL: "bot@causal.dev",
    GIT_COMMITTER_NAME: "Causal",
    GIT_COMMITTER_EMAIL: "bot@causal.dev",
  };
  // Test processes get a clean environment: no token, no API keys, no DB URL.
  const runEnv: NodeJS.ProcessEnv = {
    PATH: basePath,
    HOME: home,
    LANG: "C",
    CI: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    NODE_ENV: "test",
  };

  const sandbox = new GitSandbox({
    root, dir, repoFullName: `${owner}/${repo}`, gitEnv, runEnv, timeoutMs, redact,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });

  try {
    const cloneUrl = opts.remoteUrl ?? `https://x-access-token@github.com/${owner}/${repo}.git`;
    const depthArgs = opts.fullHistory ? [] : ["--depth", String(CLONE_DEPTH)];

    // init + fetch (rather than `git clone`) so we can fetch a bare SHA, which
    // is exactly what a failing span gives us. `clone --branch` cannot do that.
    const init = await sandbox.git(["init", "--quiet"], { timeoutMs });
    if (init.exitCode !== 0) throw new Error(`git init failed: ${init.stderr.slice(0, 300)}`);
    const remote = await sandbox.git(["remote", "add", "origin", cloneUrl], { timeoutMs });
    if (remote.exitCode !== 0) throw new Error(`git remote add failed: ${remote.stderr.slice(0, 300)}`);

    const fetchArgs = ["fetch", "--quiet", ...depthArgs, "origin", ...(ref ? [ref] : ["HEAD"])];
    let fetched = await sandbox.git(fetchArgs, { timeoutMs });
    if (fetched.exitCode !== 0 && ref) {
      // Some refs are only reachable via the default refspec (or the server
      // refuses bare-SHA wants) — fall back to fetching the default branch.
      fetched = await sandbox.git(["fetch", "--quiet", ...depthArgs, "origin"], { timeoutMs });
    }
    if (fetched.exitCode !== 0) throw new Error(`git fetch failed: ${fetched.stderr.slice(0, 300)}`);

    const target = ref || "FETCH_HEAD";
    let checkout = await sandbox.git(["checkout", "--quiet", "-b", "causal-sandbox", target], { timeoutMs });
    if (checkout.exitCode !== 0) {
      checkout = await sandbox.git(["checkout", "--quiet", "-b", "causal-sandbox", "FETCH_HEAD"], { timeoutMs });
    }
    if (checkout.exitCode !== 0) throw new Error(`git checkout failed: ${checkout.stderr.slice(0, 300)}`);

    const head = await sandbox.git(["rev-parse", "HEAD"], { timeoutMs });
    sandbox.headSha = head.stdout.trim();
    return sandbox;
  } catch (err) {
    // Never leak a half-built checkout (or its temp dir) on a failed clone.
    await sandbox.dispose();
    throw new Error(redact(err instanceof Error ? err.message : String(err)));
  }
}

/** createSandbox + guaranteed dispose. Prefer this over calling dispose by hand. */
export async function withSandbox<T>(opts: CreateSandboxOptions, fn: (sandbox: Sandbox) => Promise<T>): Promise<T> {
  const sandbox = await createSandbox(opts);
  try {
    return await fn(sandbox);
  } finally {
    await sandbox.dispose();
  }
}
