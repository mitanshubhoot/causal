---
name: causal-quickstart
description: >
  Emits a first Causal trace from a standalone script and verifies it landed. Use when the user wants to
  try Causal, set up tracing from scratch, check that CAUSAL_API_KEY and the ingest endpoint work, see
  what a trace looks like before instrumenting a real agent, or "send a test trace" — for
  TypeScript/Node.js and Python.
metadata:
  author: causal
  version: "1.0"
compatibility: >
  Python uses the `causal-sdk` package (pip). TypeScript/Node.js uses `@causal/sdk` (npm).
  Both read CAUSAL_API_KEY from the environment.
---

# Causal Quickstart

One standalone script, one nested trace, confirmed landed — no existing LLM app required.

## Rules (read first)

- **Never modify the user's application code** — quickstart adds exactly one new file.
- **Never hardcode a real API key** — read it from the environment. Only the public demo key `causal_demo_key_2026` may appear literally.
- **Never invent SDK surface** — copy the script from the reference verbatim.
- **Never drop the explicit `flush()`** — a short-lived script that exits first sends nothing.
- **Never trust exit code 0** — the script can print a trace id and still have failed to ingest.
- **Never delete the deliberately failing span** — it is what produces a detector finding.
- **Never guess the runtime** — if the directory is ambiguous, ask.

## Before writing code

Turn the Workflow below into a TodoWrite checklist — one item per step — and execute it in order. Do not merge steps, and do not mark step 5 done from inference.

## Workflow

### 1. Precondition: the API key

Check `CAUSAL_API_KEY`. If unset, offer the public demo key:

```bash
export CAUSAL_API_KEY=causal_demo_key_2026
export CAUSAL_API_URL=http://localhost:3001   # default; use the hosted URL if remote
```

`CAUSAL_ORG_ID` is optional — the server derives the org from the key. Do not continue without a key.

### 2. Read-only: pick the runtime

Inspect the working directory. Write nothing in this step.

| If the directory has…                           | Infer           | Use                              |
| ----------------------------------------------- | --------------- | -------------------------------- |
| `package.json`, `tsconfig.json`, `node_modules` | TypeScript/Node | `references/ts-quickstart.md`    |
| `pyproject.toml`, `requirements.txt`, `.venv`   | Python          | `references/python-quickstart.md` |
| both, or neither                                | ambiguous       | **stop and ask the user**        |

### 3. Install the SDK and create the script

Follow the chosen reference: install the dependency, then write its quickstart file into the current directory. Do not edit the script's spans.

### 4. Run it

Run the command in the reference. It prints a trace id and a ready-made verify command. A non-zero exit means the trace did not ship — read the error before continuing.

### 5. REQUIRED — verify the trace landed

**Do not stop early, and do not report success from console output alone.** Fetch the trace back with the printed verify command, or find the trace id in the Causal UI under Traces.

A good first trace shows all of this:

- a **nested** shape: `agent` root → `llm` span → `tool` spans (not flat siblings)
- `tokensIn`/`tokensOut`/`cost` on the trace
- `io.input`/`io.output` on the agent and llm spans
- **git context** (`file`, `line`, `commit`) on spans that run application code
- one span with status `error` and a real error string

If nothing appears or a field is missing, work the Troubleshooting table at the end of the reference — 401, wrong base URL, missing flush, and an empty-looking Traces view each have a distinct fix. Report the trace id and what to look at.

## References

- `references/ts-quickstart.md` — runnable TypeScript quickstart with `@causal/sdk`: install, script, run command, expected output, verification, troubleshooting.
- `references/python-quickstart.md` — the same for Python with `causal-sdk`, including the `async with` variant.
