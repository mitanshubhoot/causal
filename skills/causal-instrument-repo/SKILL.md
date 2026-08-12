---
name: causal-instrument-repo
description: >
  Adds Causal tracing to an existing codebase so every agent run arrives as a nested,
  git-anchored trace. Use when the user wants to add tracing or observability to an
  agent, instrument an existing repo, find out why an agent failed in production, turn
  on root-cause analysis, or "add Causal to my repo" — for Python and TypeScript/Node.js.
metadata:
  author: causal
  version: "1.0"
compatibility: >
  Python uses the `causal-sdk` package (pip). TypeScript/Node.js uses `@causal/sdk` (npm).
  Both read CAUSAL_API_KEY from the environment.
---

# Instrument a repo with Causal

Tracing is **additive** — it never changes business logic. Every line you add must be deletable without altering one behavior.

## Rules (read first)

- **Never refactor to fit tracing.** No renames, signature changes, moved files; span the caller of an awkward boundary.
- **Never let telemetry break the app.** Fail open: no throwing helpers, no import-time network calls, no new failure mode.
- **Never hardcode a key or URL.** `CAUSAL_API_KEY` / `CAUSAL_API_URL` / `CAUSAL_ORG_ID` come from the env; `.env` stays untracked.
- **Never double-instrument.** One tracer config per service, created once; where Causal traces exist, extend them.
- **Never flush in a long-lived process.** `trace(...)` flushes each run; explicit `flush()` is for scripts, CLIs, cron, lambdas.
- **Never put secrets or PII in `io`.** Redact keys, tokens, emails, card numbers first.
- **Never call it done before Step 6 passes.** Code that compiles is not a trace that arrived.

## Before writing code

Turn the Workflow below into a TodoWrite checklist — one todo per step, in order — and execute top to bottom. No edits while Step 2 is open.

## Workflow

### 1. Precondition: CAUSAL_API_KEY

Confirm `CAUSAL_API_KEY` is in the environment or an untracked `.env`; if missing, stop and ask. `causal_demo_key_2026` is the public demo key, for local trials. `CAUSAL_API_URL` defaults to `http://localhost:3001`.

### 2. Read-only analysis (no edits yet)

- **Runtime** — `package.json` / `pyproject.toml` / `requirements.txt`, start scripts.
- **Agent surface** — grep imports for `openai`, `anthropic`, `langchain`, `langgraph`, `crewai`, `litellm`.
- **Existing tracing** — grep `causal_sdk`, `@causal/sdk`, `langsmith`, `langfuse`, `opentelemetry`. Causal present ⇒ **extend mode**: reuse that tracer, add spans only. Other vendors: leave running.
- **Entry points** — one function per user-visible run: HTTP handler, queue consumer, CLI `main`, graph `invoke`.
- **Context** — infer tracer options rather than asking, then report findings:

| If the code has… | Infer | Attach |
| --- | --- | --- |
| Authenticated request | end user | `user` = principal id |
| Conversation / thread id | session | `sessionId` |
| Queue or cron job | batch run | `metadata: [{ label: "jobId", value }]` |
| A git checkout | provenance | `repo`, `gitRef` (HEAD sha) |

### 3. Confirm scope if ambiguous

Confirm first when: several plausible entry points, several services, tracing already present, or the "agent" is a library others call. State what you will wrap, span, and leave alone.

### 4. Install and initialize once

Add the SDK, create one tracer module every entry point imports — never a tracer per file. See the runtime reference.

### 5. Span the boundaries, attach git context

Wrap each entry point in one traced run, then span boundaries that can independently fail or cost money:

| Boundary | Kind | Must carry |
| --- | --- | --- |
| The whole run | `agent` | `io.input` / `io.output` |
| Sub-agent, graph node, planner | `agent` | `io`, nested under the run |
| Model call | `llm` | tokens, cost, `io`, model |
| Tool the model can pick | `tool` | args summary, `git` |
| Retrieval or SQL query | `db` | query summary, result count |
| Your parsing / business code | `function` | **`git` {file, line, commit}** |

**Git context is the differentiator.** Every span running application code gets `git: { file, line, commit }` with a repo-relative path — that is what lets Causal blame a commit and open a fix PR; without it RCA degrades to "something failed somewhere". Failing spans get `status: "error"` plus a real error string.

### 6. REQUIRED: verify (do not stop early)

Non-skippable. Run the app for real — one request, job, or CLI run — and confirm the trace landed: ingest answers `201`, the run appears in the traces list. A good trace, all four:

1. **Shaped** — one root `agent` span with model and tool spans nested beneath, not a flat pile.
2. **Anchored** — spans running your code carry `git` with the real HEAD commit.
3. **Economic** — every `llm` span has tokens in/out; the trace has non-zero cost.
4. **Legible** — redacted `io` on agent and llm spans; failures carry the exception text.

Miss any: fix and re-run. No trace, `401`, empty spans, zero durations — see `references/troubleshooting.md`. Report the trace id and what it holds, never just "instrumentation added".

## References

- `references/ts-instrument.md` — `@causal/sdk`: tracer module, entry points, nesting, git context, tokens/cost, frameworks, flushing, what to skip.
- `references/python-instrument.md` — `causal-sdk`: the same for Python, plus FastAPI, LangGraph, auto file/line capture.
- `references/troubleshooting.md` — symptom → cause → fix table; localizing a failing span.
