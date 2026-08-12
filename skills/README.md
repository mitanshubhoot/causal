# Causal Agent Skills

[Causal](https://github.com/mitanshubhoot/causal) is AI-native observability and self-healing for AI agents. It traces every LLM, tool, and agent span your system emits; an LLM-as-judge reads those traces and flags the failures no assertion would have caught; an AI agent then root-causes each failure back to the exact commit that introduced it and opens a verified fix PR. These skills cover the half of that loop a human still starts: wiring the SDK into a real codebase, getting a first trace on the board, and driving an incident from alert to root cause without reading the API surface first.

## Which skill?

Route on what the user is actually asking for:

- **"Add tracing to my app" / "instrument this repo" / "get Causal on our agent"** → `causal-instrument-repo`. Surveys the codebase, finds the LLM and tool call sites that matter, and adds spans with the right kinds, git context, and env wiring — without restructuring the agent.
- **"Just show me a trace" / "verify my setup" / "does this thing work?"** → `causal-quickstart`. The smallest end-to-end path: one traced run, confirmed visible in the UI. Run this first whenever credentials are unproven.
- **"Something broke in production" / "why did the agent do that?" / "which commit caused this?"** → `causal-debug-incident`. Pulls the failing trace, reads the judge verdict, walks the causal chain to the offending commit, and proposes a fix it has verified against the same trace.

When a request spans two of them, run them in order: quickstart to prove the connection, instrument to get coverage, debug when something fires.

## Install

Each skill installs on its own:

```bash
npx skills add mitanshubhoot/causal --skill causal-quickstart
npx skills add mitanshubhoot/causal --skill causal-instrument-repo
npx skills add mitanshubhoot/causal --skill causal-debug-incident
```

Or point any coding agent at this repo:

> Read https://github.com/mitanshubhoot/causal/tree/main/packages/skills/skills and follow the skill that matches what I'm asking for: `causal-quickstart` (first trace in minutes), `causal-instrument-repo` (instrument an existing codebase), `causal-debug-incident` (debug a production failure). Read `AGENTS.md` in that directory first — it holds the rules that apply to all three.

## Prerequisites

| Variable | Needed | What it is |
| --- | --- | --- |
| `CAUSAL_API_KEY` | Yes | Bearer key the SDK sends to the ingest endpoint. Read once at client construction. |
| `CAUSAL_API_URL` | In practice | Base URL of the Causal API. Defaults to `http://localhost:3001`, which is correct for a local `@causal/api` dev server and wrong everywhere else — set it explicitly for hosted instances. |
| `CAUSAL_ORG_ID` | Optional | Defaults to `default`. Demo data lives under `org_demo_causal_001`. |
| `CAUSAL_REPO_ID` | Optional | Ties spans to a repository so root-cause analysis can blame commits. Set it before expecting commit-level RCA. |

`causal_demo_key_2026` is a public demo credential recognized by any Causal API deployment (org `org_demo_causal_001`). Use it to get a trace flowing against the public demo before provisioning a real key. It is public by design — never point it at production data, and never leave it in a committed config.

Also assumed: Node 18+ for the TypeScript SDK (`@causal/sdk`, which uses global `fetch`) or Python 3.11+ for `causal-sdk`, and a git checkout the agent can read, since commit and branch context is what makes RCA land on a specific commit rather than a time window.
