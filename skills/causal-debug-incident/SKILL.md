---
name: causal-debug-incident
description: >
  Root-causes a production AI-agent failure from its Causal trace — earliest failing span, then the
  commit behind it, then a minimal verified fix. Use when the user wants to debug an incident,
  investigate a failing trace or detector finding, find which commit broke an agent, explain a
  looping or 10x-cost run, or "why did the booking agent fail last night" — for Python and
  TypeScript/Node.js services traced with Causal.
metadata:
  author: causal
  version: "1.0"
compatibility: >
  Python uses the `causal-sdk` package (pip). TypeScript/Node.js uses `@causal/sdk` (npm).
  Both read CAUSAL_API_KEY from the environment.
---

# Debug an incident with Causal

A trace is evidence, not a verdict — **the earliest failing span is the cause; every span above it is the symptom.**

## Rules (read first)

- **Never fix the loudest span** — a root 500 is propagation; fix the earliest span that turned `error`.
- **Never patch code you haven't opened** — read the function at `git.file:line` first.
- **Never trust a generated RCA** — reject it if its `file`/`line`/`commit` contradict the span tree.
- **Never copy `io` payloads** into PRs, issues, or fixtures — quote the shape and the error string.
- **Never widen the fix** — one behaviour, one minimal diff; no refactors or dependency bumps.
- **Never green a trace by weakening instrumentation** — swallowing the exception is not a fix.
- **Never conclude without a counterfactual** — "had X been Y, this run would have completed".

## Before writing code

Turn this workflow into a TodoWrite checklist — one item per step, in order — and execute it top to bottom. Steps 2–5 are read-only; edit no file before step 7, and never skip step 8.

## Workflow

### 1. Precondition: API access

`CAUSAL_API_KEY` must be set (`CAUSAL_API_URL` defaults to `http://localhost:3001`; `CAUSAL_ORG_ID` optional); the demo dataset uses `causal_demo_key_2026`. No key → stop and ask; never hardcode one.

### 2. Find the failing trace (read-only)

`causal findings list` (runs a detector already flagged), then `causal traces list`; match on service, time window, and user/session. Curl equivalents: `references/reading-traces.md`. No match means the path is uninstrumented — say so, don't guess.

### 3. Read the trace, don't skim it

`GET /api/v1/traces/:id`, rebuild the tree from `parentId` + `startMs` (script in the reference), and note every `error`/`warn` span's `error`, `io`, `git`, plus the detector `finding`.

### 4. Walk UP to the true origin

Take the error span with the smallest `startMs` and walk its parent chain: at each hop, is the parent's error just its child's, re-raised? If yes, keep the child. The origin is the deepest, earliest span whose error is **not** a wrapped child error.

| Earliest error span | Infer | Read next |
| --- | --- | --- |
| `tool`/`function` with `git` | app code raised | that `file:line`, its commit |
| `http` 4xx/5xx | contract or auth drift | parent `io.input`, span `io.output` |
| `db` errored | query or schema drift | `io.input`, recent migrations |
| `llm` errored | provider or schema failure | span `attributes`, `io.input` |
| `llm` ok, parent errored | bad or hallucinated output | parent's parsing code |
| only `warn`, or span missing | guard degraded or skipped | parent's timeout/budget branch |

### 5. Correlate the origin to a commit

Read what the origin's `git.commit` (or the trace's `gitRef`/`repo`) changed there — `git show --stat <commit>`, `git log -L <line>,<line>:<file>`. `GET /api/v1/traces/:id/provenance` ties that commit to its authoring session. No git context → root-cause from `io` plus code, and flag the gap.

### 6. State the root cause and the counterfactual

Two sentences — mechanism ("`app/x.py:27` reads `payload['change']`, renamed to `delta` in `3f9a1c0`") and counterfactual ("had it read `delta`, the run would have completed"). Match the shape against `references/root-cause-patterns.md`.

**Confirm-gate — stop and ask** if there are two independent error roots, no span has git context, the origin is in a dependency, or the trace contradicts the symptom.

### 7. Propose the minimal fix

Patch the origin, not the symptom, and add a regression test replaying the failing `io.input` (redacted): fails pre-fix, passes post-fix. `POST /api/v1/traces/:id/rca` gives an independent root cause plus a proposed diff (and opens a fix PR when GitHub is wired) — cross-check yours against it, never in place of reading the code.

### 8. Verify — REQUIRED, do not stop early

Do not report done until every line holds:

- The diff touches the origin `file:line`, not the symptom span.
- The regression test fails pre-fix, passes post-fix.
- Root cause, counterfactual, and commit are written down.
- Every other `error`/`warn` span is explained or filed separately.
- No `io` payload, key, or PII in the writeup, PR, or fixture.
- The flow was re-run and its **new** trace is clean.

A clean trace: healthy tree shape, all spans `ok`, git context on code spans, tokens/cost on `llm` spans, no repeated siblings, no spend past the old failure point. Still erroring, or the detector re-fires? You fixed a symptom — back to step 4 with the new trace. API or auth errors: the troubleshooting table in `references/reading-traces.md`.

## References

- `references/reading-traces.md` — span kinds, tree reconstruction, retry-storm and wasted-spend detection, detectors → failure classes, every trace endpoint with curl, troubleshooting.
- `references/root-cause-patterns.md` — recurring failure patterns: trace signature → root cause → fix shape, with code.
