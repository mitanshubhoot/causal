/**
 * `causal instrument` — emit a ready-to-paste prompt that tells a coding agent
 * how to add Causal tracing to THIS repo.
 *
 * The CLI never edits code. It inspects the repo locally, turns what it finds
 * into facts, and hands the agent a brief that is specific enough to act on.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Command } from "commander";
import { contextFor, withCommonOptions } from "../options.js";
import { internalError } from "../errors.js";
import { color, out, printJson } from "../output.js";
import { detectInstalledSkills, detectRepoFacts, primaryRuntime, type RepoFacts } from "../repo.js";
import { keyHint } from "../config.js";

const DEFAULT_OUTPUT = join(".causal", "instrument-prompt.md");

export function registerInstrument(program: Command): void {
  const command = program
    .command("instrument")
    .description("generate an agent-ready prompt to add Causal tracing to this repo")
    .option("--print", "write the prompt to stdout instead of a file")
    .option("-o, --output <path>", "where to write the prompt", DEFAULT_OUTPUT)
    .action(() => {
      runInstrument(command);
    });
  withCommonOptions(command);
}

function runInstrument(command: Command): void {
  const { config, json } = contextFor(command);
  const opts = command.opts() as { print?: boolean; output?: string };

  const facts = detectRepoFacts(config.projectRoot);
  const skills = detectInstalledSkills(config.projectRoot);
  const prompt = buildPrompt(facts, {
    host: config.host,
    hasKey: config.apiKey.length > 0,
    keyHint: config.apiKey ? keyHint(config.apiKey) : null,
    skills: skills.map((skill) => skill.name),
  });

  const toStdout = opts.print === true;
  // The default lands in the project; a path the user typed is relative to
  // wherever they are standing.
  const outputPath = toStdout
    ? null
    : command.getOptionValueSource("output") === "default"
      ? join(config.projectRoot, DEFAULT_OUTPUT)
      : resolve(process.cwd(), opts.output ?? DEFAULT_OUTPUT);

  if (outputPath) {
    try {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, prompt);
    } catch (err) {
      throw internalError(`could not write ${outputPath}: ${(err as Error).message}`);
    }
  }

  if (json) {
    printJson({
      output: outputPath,
      printed: toStdout,
      facts,
      skills,
      prompt,
    });
    return;
  }

  if (toStdout) {
    out(prompt.trimEnd());
    return;
  }

  const shown = relative(process.cwd(), outputPath ?? "") || outputPath;
  out(`${color.green("✓")} wrote instrumentation prompt to ${color.bold(String(shown))}`);
  out(
    color.dim(
      `${facts.languages.map((l) => `${l.name} (${l.files} files)`).join(", ") || "no source files detected"} · ` +
        `${facts.packageManager ?? "no lockfile"} · ${facts.entryPoints.length} entry point candidate(s)`
    )
  );
  out();
  out(color.dim("Hand it to a coding agent:"));
  out(`  cat ${shown}`);
  out(color.dim("or regenerate straight into one with `causal instrument --print`."));
}

interface PromptContext {
  host: string;
  hasKey: boolean;
  keyHint: string | null;
  skills: string[];
}

const bullet = (items: string[]): string => items.map((item) => `- ${item}`).join("\n");

function buildPrompt(facts: RepoFacts, ctx: PromptContext): string {
  const runtime = primaryRuntime(facts);
  const rows: Array<[string, string]> = [
    ["Repo root", facts.root],
    ["Languages", facts.languages.map((l) => `${l.name} (${l.files} files)`).join(", ") || "none detected"],
    ["Package manager", facts.packageManager ? `${facts.packageManager} (${facts.lockfile})` : "none detected"],
    ["Config files", facts.files.join(", ") || "none of the usual suspects"],
    ["Monorepo", facts.monorepo ? "yes — instrument the service package, not the root" : "no"],
  ];
  if (facts.node.present) {
    rows.push([
      "package.json",
      [
        facts.node.name ?? "(unnamed)",
        facts.node.version ? `v${facts.node.version}` : null,
        `type: ${facts.node.moduleType ?? "commonjs"}`,
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  }
  if (facts.node.scripts) {
    rows.push([
      "Scripts",
      Object.entries(facts.node.scripts)
        .map(([name, value]) => `${name}: \`${value}\``)
        .join("<br>"),
    ]);
  }
  if (facts.python.present) {
    rows.push(["Python deps", facts.python.dependencies.slice(0, 25).join(", ") || "none parsed"]);
  }
  rows.push([
    "Agent/LLM libraries",
    facts.agentLibraries.join(", ") || "none detected — find the agent loop by reading the code",
  ]);
  rows.push(["Web/queue frameworks", facts.webFrameworks.join(", ") || "none detected"]);
  rows.push([
    "Existing tracing",
    facts.existingTracing.length > 0
      ? `${facts.existingTracing.join(", ")} — EXTEND, do not replace`
      : "none detected",
  ]);
  rows.push([
    "Entry point candidates",
    facts.entryPoints.length > 0 ? facts.entryPoints.map((p) => `\`${p}\``).join(", ") : "none matched — locate them yourself",
  ]);
  rows.push(["Env files", facts.envFiles.join(", ") || "none"]);
  rows.push([
    "Git",
    facts.git.isRepo
      ? [
          facts.git.slug ?? facts.git.remote ?? "no remote",
          facts.git.branch ? `branch ${facts.git.branch}` : null,
          facts.git.shortCommit ? `HEAD ${facts.git.shortCommit}` : null,
          facts.git.dirty ? "working tree dirty" : "working tree clean",
        ]
          .filter(Boolean)
          .join(" · ")
      : "not a git repository — RCA will not be able to blame a commit",
  ]);
  rows.push(["Causal host", ctx.host]);
  rows.push([
    "CAUSAL_API_KEY",
    ctx.hasKey ? `configured (${ctx.keyHint}) — read it from the env, never inline it` : "NOT configured — stop and ask for one",
  ]);
  rows.push(["Node running the CLI", `${facts.runtime.node} on ${facts.runtime.platform}`]);
  if (ctx.skills.length > 0) rows.push(["Causal skills available", ctx.skills.join(", ")]);

  const factTable = [
    "| Fact | Value |",
    "| --- | --- |",
    ...rows.map(([label, value]) => `| ${label} | ${value.replace(/\|/g, "\\|")} |`),
  ].join("\n");

  const skillNote =
    ctx.skills.includes("causal-instrument-repo")
      ? "The `causal-instrument-repo` skill is installed in this environment — load it and follow its workflow; this brief supplies the repo-specific facts."
      : "No Causal skill is installed here, so this brief is self-contained. Follow it exactly.";

  return `# Add Causal tracing to this repository

You are a coding agent with write access to \`${facts.root}\`. Instrument this codebase so every
agent run arrives in Causal as one nested, git-anchored trace.

${skillNote}

## Facts detected by \`causal instrument\`

These were read off the filesystem just now. Treat them as leads, not gospel — confirm each one
before you rely on it.

${factTable}

## Rules

${bullet([
  "**Tracing is additive.** Every line you add must be deletable without changing one behavior. No refactors, no renamed functions, no moved files.",
  "**Telemetry must never break the app.** No throwing helpers, no import-time network calls, no new failure mode. Missing `CAUSAL_API_KEY` means tracing quietly does nothing.",
  "**Never hardcode a key or a URL.** `CAUSAL_API_KEY`, `CAUSAL_API_URL` and `CAUSAL_ORG_ID` come from the environment. `.env` stays untracked.",
  "**One tracer configuration per service**, created once in its own module and imported everywhere. Never construct a tracer per file or per call.",
  "**Never put secrets or PII into `io`.** Redact keys, tokens, emails and card numbers before anything is attached.",
  "**Do not flush inside a long-lived process.** The traced-run wrapper flushes for you; an explicit flush is only for scripts, CLIs, cron jobs and lambdas.",
  facts.existingTracing.length > 0
    ? `**Tracing already exists here (${facts.existingTracing.join(", ")}).** Leave it running and extend it — do not rip it out or double-instrument.`
    : "**Do not add a second observability vendor.** Causal only.",
])}

## Steps

1. **Read before you write.** Open the entry point candidates above and find every user-visible run:
   HTTP handler, queue consumer, cron job, CLI \`main\`, graph \`invoke\`. Report what you found and
   what you intend to wrap before editing. If several services live here, confirm which one first.
2. **Install the SDK** with the detected package manager (${facts.packageManager ?? "the project's package manager"}).
3. **Create one tracer module** that resolves the HEAD commit once at boot and exports a tracer plus a
   helper that builds \`{ file, line, commit }\` git context.
4. **Wrap each entry point in exactly one traced run** — one trace per request/job/invocation, never
   one per tool call.
5. **Span the boundaries that can independently fail or cost money**, nested under the run:

   | Boundary | Span kind | Must carry |
   | --- | --- | --- |
   | The whole run | \`agent\` | redacted \`io.input\` / \`io.output\` |
   | Sub-agent, graph node, planner | \`agent\` | \`io\`, nested under the run |
   | Model call | \`llm\` | \`tokensIn\`, \`tokensOut\`, \`cost\`, model name, \`io\` |
   | Tool the model can choose | \`tool\` | argument summary, \`git\` |
   | Retrieval / SQL / vector query | \`db\` | query summary, result count |
   | Outbound HTTP | \`http\` | method, host, status |
   | Your own parsing / business logic | \`function\` | \`git\` **{ file, line, commit }** |

6. **Anchor every span that runs your code with git context** — repo-relative file, line, and the real
   HEAD sha${facts.git.shortCommit ? ` (currently \`${facts.git.shortCommit}\`)` : ""}. This is what lets Causal
   blame a commit and open a fix PR; without it root-cause analysis degrades to "something failed somewhere".
7. **Mark failures honestly.** A failing span gets \`status: "error"\` and the real exception text.
8. **Verify for real — do not stop early.** Run one request/job/CLI invocation against a live Causal at
   \`${ctx.host}\`, confirm ingest answered \`201\`, then check the trace with:

   \`\`\`bash
   causal traces list --limit 5
   causal traces get <traceId>
   \`\`\`

   A good trace is all four: **shaped** (one root \`agent\` span with children, not a flat pile),
   **anchored** (git on the spans running your code), **economic** (tokens and cost on every \`llm\` span),
   and **legible** (redacted \`io\`, real error text). Report the trace id and what it contains — never
   just "instrumentation added".

${sdkSection(runtime)}

## Wire format (what the SDK sends, for reference)

\`POST ${ctx.host}/api/v1/traces\` with \`Authorization: Bearer $CAUSAL_API_KEY\`:

\`\`\`jsonc
{
  "traceId": "…", "service": "…", "environment": "production", "model": "…",
  "startedAt": "ISO-8601", "repo": "owner/name", "gitRef": "<sha>",
  "user": "…", "sessionId": "…", "metadata": [{ "label": "…", "value": "…" }],
  "spans": [{
    "id": "…", "parentId": null, "name": "agent.run", "kind": "agent",
    "startMs": 0, "durationMs": 1240, "status": "ok",
    "attributes": [{ "label": "…", "value": "…" }],
    "io": { "input": "…", "output": "…" },
    "git": { "file": "src/agent.ts", "line": 42, "commit": "<sha>" },
    "tokensIn": 1200, "tokensOut": 340, "cost": 0.0182, "error": null
  }]
}
\`\`\`

\`kind\` ∈ \`agent | llm | tool | http | db | function | skill | workflow | search | shell\`.
\`status\` ∈ \`ok | warn | error\`. \`parentId\` is \`null\` for the root span.

## Definition of done

${bullet([
  "The app behaves identically with `CAUSAL_API_KEY` unset.",
  "One traced run per user-visible invocation, with nested spans — verified by reading a real trace, not by inspection of the diff.",
  "Every `llm` span carries tokens and cost; every code span carries git context.",
  "No secret, key or PII appears in any `io` or attribute.",
  "The trace id of a real verified run is reported back, with what it contains.",
])}
`;
}

function sdkSection(runtime: "typescript" | "python" | "unknown"): string {
  const ts = `### TypeScript / Node.js — \`@causal/sdk\`

\`\`\`ts
import { CausalTracer } from "@causal/sdk";

// One module owns this. Resolve the sha once at boot — never shell out per span.
export const COMMIT = process.env.CAUSAL_GIT_COMMIT ?? headSha();
export const git = (file: string, line: number) => ({ file, line, commit: COMMIT });

const tracer = new CausalTracer({
  service: "your-service",                       // one per deployable service
  environment: process.env.NODE_ENV ?? "development",
  repo: "owner/name",
  gitRef: COMMIT,
  // apiKey / baseUrl / orgId fall back to CAUSAL_API_KEY / CAUSAL_API_URL / CAUSAL_ORG_ID
});

// One traced run per request/job. Opens a root \`agent\` span and flushes on
// completion — including when fn throws.
await tracer.trace("agent.run", async (t, root) => {
  const plan = root.child("llm.plan", "llm");
  const answer = await callModel(input);
  plan.end({
    status: "ok",
    io: { input: redact(input), output: redact(answer.text) },
    tokensIn: answer.usage.input_tokens,
    tokensOut: answer.usage.output_tokens,
    cost: answer.cost,
  });

  const parse = root.child("parse_results", "function");
  try {
    const parsed = parseResults(answer.text);
    parse.end({ status: "ok", git: git("src/parse.ts", 44) });
    return parsed;
  } catch (err) {
    parse.end({ status: "error", error: (err as Error).message, git: git("src/parse.ts", 44) });
    throw err;   // tracing records the failure, then gets out of the way
  }
});
\`\`\`

Surface: \`tracer.trace(name, fn)\`, \`tracer.startTrace()\`, \`t.span(name, kind, parentId?)\`,
\`span.child(name, kind)\`, \`span.end({ status, error, attributes, io, git, tokensIn, tokensOut, cost })\`,
\`t.tokensIn / t.tokensOut / t.cost\`, \`await t.flush()\`. \`span.end()\` is idempotent.`;

  const py = `### Python — \`causal-sdk\`

\`\`\`python
from causal_sdk import CausalTracer, observe

tracer = CausalTracer(
    service="your-service",              # one per deployable service
    environment=os.getenv("ENV", "development"),
    repo="owner/name",
    git_ref=COMMIT,                      # resolved once at import
    # api_key / base_url / org_id fall back to CAUSAL_API_KEY / CAUSAL_API_URL / CAUSAL_ORG_ID
)

async with tracer.trace("agent.run") as t:
    span = t.span("llm.plan", kind="llm")
    answer = await call_model(prompt)
    span.end(
        status="ok",
        io={"input": redact(prompt), "output": redact(answer.text)},
        tokens_in=answer.usage.input_tokens,
        tokens_out=answer.usage.output_tokens,
        cost=answer.cost,
    )
\`\`\`

\`@observe(kind="llm")\` nests a decorated function automatically inside the active trace. Short-lived
scripts must \`await t.flush()\` before exit.`;

  if (runtime === "typescript") return `## SDK surface\n\n${ts}`;
  if (runtime === "python") return `## SDK surface\n\n${py}`;
  return `## SDK surface\n\nThe runtime is ambiguous — confirm it before installing anything.\n\n${ts}\n\n${py}`;
}
