# @causal/cli

`causal` — the terminal front end for [Causal](../../README.md): read traces, findings and
detectors, ask questions about a run, check that your setup is sound, and generate the prompt that
tells a coding agent how to instrument your repo.

```bash
pnpm add -g @causal/cli      # or: npm i -g @causal/cli
causal login
causal traces list
causal traces get tr_9f2c1a
```

Requires Node 20+ (the CLI uses global `fetch`).

---

## Configuration

Every command resolves a **host** and an **API key**, highest precedence first:

| # | Source | Keys |
| --- | --- | --- |
| 1 | Command-line flags | `--api-key`, `--host` |
| 2 | Environment | `CAUSAL_API_KEY`, `CAUSAL_API_URL`, `CAUSAL_ORG_ID` |
| 3 | Project config | `./.causal/config.json` (written by `causal login`, mode `0600`) |
| 4 | Dotenv | `./.env` |

The default host is `http://localhost:3001`. "`./`" means the **project root**: the nearest ancestor
directory holding `.causal/` or `.git/`, so the CLI behaves identically from any subdirectory of a
repo. `causal status` prints exactly what was resolved and where each value came from.

`CAUSAL_ORG_ID` is optional — the API derives the org from the key.

---

## Global options

Available on every command (before or after the subcommand):

| Flag | Effect |
| --- | --- |
| `--json` | Print exactly **one** machine-readable JSON document on stdout. Errors go to stderr as a single line, `{"error":{"code","message"}}`, so stdout stays pipeable into `jq`. |
| `--host <url>` | Causal API base URL for this invocation. |
| `--api-key <key>` | Causal API key for this invocation. |
| `-v, --version` | Print the CLI version. |
| `-h, --help` | Help for the CLI or any subcommand. |

Color is used only when stdout is a TTY, and never when `NO_COLOR` is set.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | ok |
| `1` | internal error (unexpected failure, 5xx, malformed local state) |
| `2` | usage error (bad flag, missing argument, unknown command, rejected request) |
| `3` | auth error (no key configured, or the key was rejected) |
| `4` | not found (no such trace, detector or finding) |
| `5` | network error (host unreachable, DNS failure, timeout, not a Causal API) |

---

## Commands

### `causal login`

Validates a key and saves it.

```bash
causal login                                   # prompts (input is not echoed)
causal login --api-key causal_… --host https://api.causal.dev
echo "$CAUSAL_API_KEY" | causal login          # non-interactive / CI
```

1. `GET /api/v1/health` — is there a Causal API at this host? (This route is unauthenticated, so a
   404 here means "wrong host", not "bad key".)
2. `GET /api/v1/traces?limit=1` — does the key actually authenticate?
3. Writes `{ apiKey, host }` to `./.causal/config.json` with mode `0600` (the directory is created
   `0700`), preserving any other fields already in the file.
4. Appends `.causal/` to `./.gitignore` when it is not ignored already.

With `--json`: `{ ok, host, keyHint, configPath, mode, gitignore, health }`. `--json` never prompts —
pass `--api-key` or set `CAUSAL_API_KEY`.

### `causal status`

The identity the next command will use. Entirely local — it makes no request, so it answers offline.

```
host     https://api.causal.dev  (environment)
api key  …a91f                   (.causal/config.json)
org id   derived from the API key
project  /Users/you/booking-agent
config   .causal/config.json
dotenv   .env
```

Only the **last four characters** of the key are ever printed.

With `--json`: `{ host, hostSource, apiKey: { present, hint, source }, orgId, orgIdSource,
projectRoot, configPath, dotenvPath }`.

### `causal traces list [--limit n]`

Recent traces, newest first (default 20, max 500).

```
STATUS   TRACE ID   SERVICE        ROOT SPAN          SPANS    TOKENS     COST  STARTED
✗ error  tr_9f2c1a  booking-agent  booking_agent.run      7  3.2k→890  $0.0412  12m ago
✓ ok     tr_4b8e77  support-agent  support.reply          4   812→220  $0.0031   3h ago
```

With `--json`: `{ traces, count }`.

### `causal traces get <id>`

One trace as a span tree — nesting by indentation, human durations, status markers, and per-span
tokens, cost, error and git anchor. Spans whose parent is missing are shown as roots so a
partially-flushed trace still prints everything it holds.

```
trace     tr_9f2c1a
status    ✗ error
service   booking-agent (production)
duration  1m 24s
cost      $0.0412

FINDING  hallucinated_tool_args · Planner passed a non-existent `cabin_class` argument (high, confidence 0.82)

SPAN                             KIND      DURATION    TOKENS     COST
✗ booking_agent.run              agent       1m 24s  3.2k→890  $0.0412
├─ ✓ llm.plan                    llm           8.4s  1.2k→340  $0.0180
│  ├─ ✓ tool.search_flights      tool         910ms
│  │     src/tools/flights.ts:44 @ a1b2c3d
│  └─ ✓ db.cache_lookup          db            42ms
└─ ✗ parse_results               function      12ms
   │  error: Unexpected token < in JSON at position 0
   │  src/parse.ts:44 @ a1b2c3d
   └─ ! retry.parse              function       3ms
```

Markers: `✓` ok · `!` warn · `✗` error. Durations render as `910ms`, `8.4s`, `1m 24s`, `2h 05m`.

With `--json`: the full trace document (spans, finding, metadata) exactly as the API returns it.

```bash
causal traces get tr_9f2c1a --json | jq '.spans[] | select(.status == "error") | .name'
```

### `causal detectors list`

Detector definitions with their open/total finding counts and run totals.
With `--json`: `{ detectors, count }`.

### `causal findings list [--limit n]`

The org-wide findings feed, newest first (default 20, max 500) — severity, state, detector, title,
service, trace id and age. With `--json`: `{ findings, count }`.

### `causal ask <traceId> <question…>`

Causal Copilot, grounded in one trace. The markdown answer is printed verbatim, so it pipes cleanly.

```bash
causal ask tr_9f2c1a "why did this fail?"
causal ask tr_9f2c1a why did this fail          # trailing words work too
causal ask tr_9f2c1a "what cost the most?" --json > answer.json
```

With `--json`: `{ traceId, question, answer, model, grounded }`.

### `causal instrument [--print] [--output <path>]`

Generates an **agent-ready prompt** for adding Causal tracing to this repo. The CLI never edits your
code — it inspects the repository locally and emits a brief for a coding agent, with the facts it
found injected so the agent does not have to guess:

- languages in play (bounded file scan) and the config files present
- package manager, taken from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`,
  `bun.lock`, `uv.lock`, `poetry.lock`, `Pipfile.lock`)
- monorepo or single package; `package.json` name, module type and relevant scripts
- LLM/agent libraries, web and queue frameworks, and any tracing already installed (which the agent
  is told to extend, never replace)
- entry point candidates that actually exist on disk
- git remote, branch, HEAD sha and whether the tree is dirty
- the resolved Causal host, and whether a key is configured (hint only, never the key)

```bash
causal instrument                    # writes ./.causal/instrument-prompt.md
causal instrument --print            # straight to stdout
causal instrument --output brief.md  # anywhere you like
```

With `--json`: `{ output, printed, facts, skills, prompt }`.

### `causal doctor`

Pass / warn / fail checks over everything that has to be true before a trace can land. It never
stops at the first problem: all checks run, then the process exits non-zero.

| Check | What it means |
| --- | --- |
| `credentials` | A key was resolved, and from where. |
| `api` | `GET /api/v1/health` — reachable, and whether its dependencies are connected. |
| `api key` | The key is accepted by an authenticated route. |
| `repo` | Languages, package manager, monorepo shape. |
| `git` | Repository, remote, branch and HEAD — without a sha, spans cannot be anchored. |
| `agent surface` | Whether an LLM/agent library is present to trace at all. |
| `tracing` | Causal SDK installed, or another vendor's tracing to extend. |
| `runtime` | Node version (20+) and the detected package manager. |
| `agent skills` | Causal skills installed under `.claude/skills` or `.agents/skills`, project or user scope. |

Exit code `0` when nothing failed (warnings are fine), `3` when the only failures are credential or
auth related, `1` otherwise. With `--json`: `{ ok, summary, checks, host }`.

---

## Development

```bash
pnpm install
pnpm --filter @causal/cli build        # tsc → dist, chmod +x dist/index.js
pnpm --filter @causal/cli type-check   # tsc --noEmit
node packages/cli/dist/index.js --help
```

Layout:

| File | Role |
| --- | --- |
| `src/index.ts` | commander entrypoint; maps every failure to an exit code |
| `src/config.ts` | host/key resolution and precedence |
| `src/api.ts` | fetch wrapper — Bearer auth, timeouts, typed errors |
| `src/options.ts` | the options every command shares |
| `src/output.ts` | colors, human durations/counts/costs, tables |
| `src/repo.ts` | local, read-only repository inspection |
| `src/commands/*` | one file per command |
