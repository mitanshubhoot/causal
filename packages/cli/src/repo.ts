/**
 * Local, read-only inspection of the repository the CLI is run in.
 *
 * Used by `causal instrument` (to inject real facts into the generated prompt)
 * and `causal doctor` (to report repo shape). Nothing here writes, and every
 * probe fails open — a missing git binary or unreadable file must never turn
 * into a crash.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  engines?: Record<string, string>;
}

export interface GitFacts {
  isRepo: boolean;
  branch?: string;
  commit?: string;
  shortCommit?: string;
  remote?: string;
  /** owner/name parsed out of the origin remote, when it looks like one. */
  slug?: string;
  dirty?: boolean;
}

export interface RepoFacts {
  root: string;
  files: string[];
  packageManager: string | null;
  lockfile: string | null;
  languages: Array<{ name: string; files: number }>;
  monorepo: boolean;
  node: {
    present: boolean;
    name?: string;
    version?: string;
    moduleType?: string;
    scripts?: Record<string, string>;
    dependencies: string[];
  };
  python: {
    present: boolean;
    dependencies: string[];
  };
  agentLibraries: string[];
  webFrameworks: string[];
  existingTracing: string[];
  entryPoints: string[];
  envFiles: string[];
  git: GitFacts;
  runtime: { node: string; platform: string };
}

export interface InstalledSkill {
  name: string;
  path: string;
  scope: "project" | "user";
}

const KNOWN_FILES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Pipfile",
  "Dockerfile",
  "docker-compose.yml",
  "Makefile",
  "vercel.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "turbo.json",
  "pnpm-workspace.yaml",
];

const LOCKFILES: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["uv.lock", "uv"],
  ["poetry.lock", "poetry"],
  ["Pipfile.lock", "pipenv"],
];

const AGENT_LIBRARIES = [
  "openai", "anthropic", "@anthropic-ai/sdk", "ai", "@ai-sdk/openai", "@ai-sdk/anthropic",
  "langchain", "@langchain/core", "@langchain/langgraph", "langgraph", "llamaindex",
  "llama-index", "crewai", "litellm", "@mastra/core", "ollama", "instructor", "dspy-ai",
  "@google/generative-ai", "google-generativeai", "cohere-ai", "groq-sdk", "mistralai",
  "@modelcontextprotocol/sdk", "mcp",
];

const WEB_FRAMEWORKS = [
  "express", "fastify", "next", "hono", "koa", "@nestjs/core", "@trpc/server",
  "fastapi", "flask", "django", "uvicorn", "celery", "starlette",
];

const TRACING_LIBRARIES = [
  "@causal/sdk", "causal-sdk", "langsmith", "langfuse", "@opentelemetry/api",
  "@opentelemetry/sdk-node", "opentelemetry-sdk", "opentelemetry-api", "@sentry/node",
  "sentry-sdk", "braintrust", "traceloop-sdk", "@traceloop/node-server-sdk",
  "@arizeai/openinference-instrumentation-openai", "arize-phoenix", "helicone",
];

const ENTRY_POINT_CANDIDATES = [
  "src/index.ts", "src/main.ts", "src/server.ts", "src/app.ts", "src/agent.ts",
  "src/worker.ts", "src/cli.ts", "src/index.js", "src/main.js", "index.ts", "index.js",
  "server.ts", "server.js", "app.ts", "api/index.ts", "app/api",
  "main.py", "app.py", "server.py", "agent.py", "cli.py", "worker.py",
  "src/main.py", "src/app.py", "src/agent.py", "api/main.py",
];

const ENV_FILES = [".env", ".env.local", ".env.example", ".env.sample"];

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo", ".venv", "venv",
  "__pycache__", "coverage", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  "vendor", "target", ".cache", ".vercel",
]);

const EXTENSION_LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".rb": "Ruby",
  ".java": "Java",
};

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

export function detectGit(root: string): GitFacts {
  if (!existsSync(join(root, ".git"))) return { isRepo: false };
  const facts: GitFacts = { isRepo: true };
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const remote = git(root, ["remote", "get-url", "origin"]);
  const status = git(root, ["status", "--porcelain"]);
  if (branch) facts.branch = branch;
  if (commit) {
    facts.commit = commit;
    facts.shortCommit = commit.slice(0, 7);
  }
  if (remote) {
    facts.remote = remote;
    const slug = /(?:[:/])([^/:]+\/[^/]+?)(?:\.git)?$/.exec(remote);
    if (slug) facts.slug = slug[1];
  }
  if (status !== null) facts.dirty = status.length > 0;
  return facts;
}

/** Shallow, bounded file walk — enough evidence to name the languages in play. */
function scanLanguages(root: string, maxDepth = 5, maxEntries = 5000): Array<{ name: string; files: number }> {
  const counts = new Map<string, number>();
  let seen = 0;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || seen >= maxEntries) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= maxEntries) return;
      if (entry.startsWith(".") && entry !== ".") continue;
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, depth + 1);
        continue;
      }
      seen++;
      const dot = entry.lastIndexOf(".");
      if (dot <= 0) continue;
      const language = EXTENSION_LANGUAGES[entry.slice(dot)];
      if (!language) continue;
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  };

  walk(root, 0);
  return [...counts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files);
}

/** Strip a PEP 508 requirement down to its distribution name. */
function requirementName(raw: string): string | null {
  const name = raw.trim().split(/[\s<>=!~;,[(]/)[0];
  return /^[A-Za-z0-9._-]{2,}$/.test(name) ? name.toLowerCase() : null;
}

/** Package names from requirements.txt / pyproject.toml, normalized + deduped. */
function pythonDependencies(root: string): string[] {
  const names = new Set<string>();

  const requirements = readTextFile(join(root, "requirements.txt"));
  if (requirements) {
    for (const line of requirements.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
      const name = requirementName(trimmed);
      if (name) names.add(name);
    }
  }

  const pyproject = readTextFile(join(root, "pyproject.toml"));
  if (pyproject) {
    // PEP 621 / setuptools: dependencies = ["fastapi>=0.110", ...]
    for (const block of pyproject.matchAll(/dependencies\s*=\s*\[([\s\S]*?)\]/g)) {
      for (const quoted of block[1].matchAll(/["']([^"']+)["']/g)) {
        const name = requirementName(quoted[1]);
        if (name) names.add(name);
      }
    }
    // Poetry: [tool.poetry.dependencies] followed by `name = "^1.2"` lines.
    const poetry = /\[tool\.poetry(?:\.group\.[^\].]+)?\.dependencies\]([\s\S]*?)(?=\n\[|$)/g;
    for (const section of pyproject.matchAll(poetry)) {
      for (const line of section[1].split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9._-]{2,})\s*=/.exec(line);
        if (match) names.add(match[1].toLowerCase());
      }
    }
  }

  return [...names].sort();
}

function intersect(haystack: string[], needles: string[]): string[] {
  const present = new Set(haystack.map((item) => item.toLowerCase()));
  return needles.filter((needle) => present.has(needle.toLowerCase()));
}

/** Everything the CLI can learn about this repo without touching the network. */
export function detectRepoFacts(root: string): RepoFacts {
  const files = KNOWN_FILES.filter((file) => existsSync(join(root, file)));
  const lockfileEntry = LOCKFILES.find(([file]) => existsSync(join(root, file)));
  const pkg = readJsonFile<PackageJson>(join(root, "package.json"));

  const nodeDeps = [
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
    ...Object.keys(pkg?.peerDependencies ?? {}),
  ];
  const pyDeps = pythonDependencies(root);
  const allDeps = [...new Set([...nodeDeps, ...pyDeps])];

  const entryPoints = ENTRY_POINT_CANDIDATES.filter((candidate) => existsSync(join(root, candidate)));
  const scriptEntry = pkg?.main;
  if (scriptEntry && existsSync(join(root, scriptEntry)) && !entryPoints.includes(scriptEntry)) {
    entryPoints.push(scriptEntry);
  }

  const scripts: Record<string, string> = {};
  for (const key of ["start", "dev", "build", "serve", "worker", "test"]) {
    const value = pkg?.scripts?.[key];
    if (value) scripts[key] = value;
  }

  const pythonPresent =
    files.includes("pyproject.toml") || files.includes("requirements.txt") || files.includes("setup.py");

  const node: RepoFacts["node"] = { present: pkg !== null, dependencies: nodeDeps.sort() };
  if (pkg?.name) node.name = pkg.name;
  if (pkg?.version) node.version = pkg.version;
  if (pkg?.type) node.moduleType = pkg.type;
  if (Object.keys(scripts).length > 0) node.scripts = scripts;

  return {
    root,
    files,
    packageManager: lockfileEntry ? lockfileEntry[1] : null,
    lockfile: lockfileEntry ? lockfileEntry[0] : null,
    languages: scanLanguages(root),
    monorepo: Boolean(pkg?.workspaces) || existsSync(join(root, "pnpm-workspace.yaml")),
    node,
    python: { present: pythonPresent, dependencies: pyDeps },
    agentLibraries: intersect(allDeps, AGENT_LIBRARIES),
    webFrameworks: intersect(allDeps, WEB_FRAMEWORKS),
    existingTracing: intersect(allDeps, TRACING_LIBRARIES),
    entryPoints,
    envFiles: ENV_FILES.filter((file) => existsSync(join(root, file))),
    git: detectGit(root),
    runtime: { node: process.version, platform: `${process.platform}-${process.arch}` },
  };
}

/** Causal skills installed for agents, in the project or the user's home. */
export function detectInstalledSkills(root: string): InstalledSkill[] {
  const roots: Array<[string, InstalledSkill["scope"]]> = [
    [join(root, ".claude", "skills"), "project"],
    [join(root, ".agents", "skills"), "project"],
    [join(homedir(), ".claude", "skills"), "user"],
    [join(homedir(), ".agents", "skills"), "user"],
  ];
  const found: InstalledSkill[] = [];
  const seen = new Set<string>();
  for (const [dir, scope] of roots) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.toLowerCase().startsWith("causal")) continue;
      const full = join(dir, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (seen.has(entry)) continue;
      seen.add(entry);
      found.push({ name: entry, path: full, scope });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Primary language guess, used to pick the SDK in the instrument prompt. */
export function primaryRuntime(facts: RepoFacts): "typescript" | "python" | "unknown" {
  const top = facts.languages[0]?.name;
  const hasNode = facts.node.present;
  const hasPython = facts.python.present;
  if (hasNode && !hasPython) return "typescript";
  if (hasPython && !hasNode) return "python";
  if (top === "Python") return "python";
  if (top === "TypeScript" || top === "JavaScript") return "typescript";
  return "unknown";
}
