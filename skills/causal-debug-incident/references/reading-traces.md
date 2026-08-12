# Reading a Causal trace

Everything here is read-only. Nothing in this file changes a running system — it fetches traces and interprets them.

## 1. The shape you are reading

`GET /api/v1/traces/:id` returns one run: trace-level economics, the flat span list, and the detector's finding (if one fired).

```jsonc
{
  "traceId": "trc_8f21c9",
  "service": "booking-agent",
  "environment": "production",
  "title": "booking_agent.run",        // name of the root span
  "status": "error",                   // rollup: error > warn > ok
  "model": "claude-sonnet-4-5",
  "tokensIn": 1200, "tokensOut": 340, "cost": 0.014,
  "repo": "acme/storefront", "gitRef": "b91f0ac4",
  "user": "usr_1", "sessionId": "sess_1",
  "metadata": [{ "label": "region", "value": "us-east-1" }],
  "startedAt": "2026-08-11T02:14:07.221Z",
  "spans": [
    {
      "id": "sp_1", "parentId": null,
      "name": "booking_agent.run", "kind": "agent",
      "startMs": 0, "durationMs": 4120, "status": "error",
      "attributes": [{ "label": "model", "value": "claude-sonnet-4-5" }],
      "io": { "input": "reschedule my flight", "output": "" },
      "git": null,
      "error": "AgentError: run failed"
    },
    {
      "id": "sp_4", "parentId": "sp_2",
      "name": "tool.lookup", "kind": "tool",
      "startMs": 812, "durationMs": 31, "status": "error",
      "io": { "input": "{\"booking\":\"BK-9\"}" },
      "git": { "file": "app/x.py", "line": 27, "commit": "3f9a1c05" },
      "error": "KeyError: 'change'"
    }
  ],
  "finding": {
    "detector": "tool_failure",
    "title": "Tool failure — KeyError: 'change'",
    "severity": "critical",
    "confidence": 0.92,
    "summary": "tool.lookup (app/x.py:27) returned error. KeyError: 'change'",
    "triggeredSpanId": "sp_4",
    "judgeModel": "claude-sonnet-4-5"
  }
}
```

Three things carry almost all the diagnostic value:

- **`git`** — `{file, line, commit}` on spans that executed application code. This is what turns "a tool failed" into "commit `3f9a1c05` broke `app/x.py:27`". A span without it can still be root-caused, but only by reading code by hand.
- **`io`** — the actual input/output at that hop. It tells you whether the bad value was *produced* here or *passed in* from the parent. Treat it as user data: never copy it into a PR, an issue, or a test fixture unredacted.
- **`parentId` + `startMs`** — the causal skeleton. Order and nesting are how you separate origin from propagation.

## 2. Span kinds and what each implies

| Kind | Emitted around | A failure here usually means |
| --- | --- | --- |
| `agent` | a whole agent or sub-agent run | nothing by itself — it is the rollup of its children; look down |
| `llm` | one model call | provider error, context overflow, schema/tool-call refusal; if `ok`, the *content* may still be wrong |
| `tool` | one tool/function the agent may call | the tool's own code raised, or the agent called it with bad arguments |
| `http` | an outbound request | provider contract drift, auth, rate limit, timeout |
| `db` | a query | schema drift, missing row, constraint, lock/timeout |
| `function` | an internal helper worth timing | plain application-code bug (parsing, indexing, coercion) |
| `skill` | a packaged skill/playbook invocation | the skill's precondition wasn't met |
| `workflow` | a multi-step orchestration | a step was skipped, or the wrong branch was taken |
| `search` | retrieval / vector lookup | empty or irrelevant results feeding a downstream hallucination |
| `shell` | a subprocess | non-zero exit, missing binary, sandbox/permission denial |

`agent`, `llm`, `tool`, `http`, `db`, and `function` are the core six and dominate real traces; the rest add structure when the SDK is instrumented for them.

**Interpretation rules**

- An `agent` span in `error` with an `error` child is *always* propagation. Descend.
- An `llm` span in `ok` whose parent is in `error` means the model returned something the caller could not use — the bug is in the caller's parsing or in the prompt contract, not in the provider.
- An `http` span in `ok` (200) followed by a sibling/child `function` span in `error` means the provider changed its payload, not its status.
- A **missing** span is evidence. If the healthy path has `tool.confirm` and this trace does not, a branch was skipped — go read the control flow in the parent.

## 3. Rebuilding the tree

Spans arrive flat. Nesting lives in `parentId`; wall-clock order lives in `startMs`.

```js
// causal-trace-tree.mjs — node >= 18. Usage: node causal-trace-tree.mjs <traceId>
const base = process.env.CAUSAL_API_URL ?? "http://localhost:3001";
const key = process.env.CAUSAL_API_KEY;
const traceId = process.argv[2];
if (!key || !traceId) {
  console.error("usage: CAUSAL_API_KEY=... node causal-trace-tree.mjs <traceId>");
  process.exit(1);
}

const res = await fetch(`${base}/api/v1/traces/${traceId}`, {
  headers: { Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`GET ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const trace = await res.json();

// Index children by parent. Spans whose parent is absent are treated as roots
// so nothing is silently hidden from the tree.
const ids = new Set(trace.spans.map((s) => s.id));
const byParent = new Map();
for (const s of trace.spans) {
  const parent = s.parentId && ids.has(s.parentId) ? s.parentId : "__root__";
  if (!byParent.has(parent)) byParent.set(parent, []);
  byParent.get(parent).push(s);
}
for (const kids of byParent.values()) kids.sort((a, b) => a.startMs - b.startMs);

const MARK = { ok: "  ", warn: "! ", error: "X " };
function walk(parent, depth) {
  for (const s of byParent.get(parent) ?? []) {
    const git = s.git ? ` @${s.git.file}:${s.git.line} (${s.git.commit})` : "";
    const err = s.error ? `  <- ${s.error}` : "";
    console.log(
      `${MARK[s.status] ?? "  "}${"  ".repeat(depth)}${s.name} [${s.kind}] ` +
        `${s.startMs}ms +${s.durationMs}ms${git}${err}`
    );
    walk(s.id, depth + 1);
  }
}
walk("__root__", 0);

// The span to investigate first: earliest error, not the loudest one.
const first = trace.spans
  .filter((s) => s.status === "error")
  .sort((a, b) => a.startMs - b.startMs)[0];
console.log(
  first
    ? `\nEarliest error: ${first.name} (${first.id}) ` +
        (first.git
          ? `-> ${first.git.file}:${first.git.line} @ ${first.git.commit}`
          : "-> NO GIT CONTEXT (root-cause by reading code)")
    : "\nNo error spans — look for warn spans and for spans that should exist but don't."
);
if (trace.finding) {
  console.log(
    `Detector: ${trace.finding.detector} — ${trace.finding.title} ` +
      `(${Math.round(trace.finding.confidence * 100)}%) span=${trace.finding.triggeredSpanId}`
  );
}
```

```python
# causal_trace_tree.py — stdlib only. Usage: python causal_trace_tree.py <traceId>
import json, os, sys, urllib.request

base = os.environ.get("CAUSAL_API_URL", "http://localhost:3001")
key = os.environ.get("CAUSAL_API_KEY")
trace_id = sys.argv[1] if len(sys.argv) > 1 else None
if not key or not trace_id:
    sys.exit("usage: CAUSAL_API_KEY=... python causal_trace_tree.py <traceId>")

req = urllib.request.Request(
    f"{base}/api/v1/traces/{trace_id}", headers={"Authorization": f"Bearer {key}"}
)
with urllib.request.urlopen(req) as resp:
    trace = json.load(resp)

spans = trace["spans"]
ids = {s["id"] for s in spans}
by_parent: dict[str, list[dict]] = {}
for s in spans:
    parent = s["parentId"] if s.get("parentId") in ids else "__root__"
    by_parent.setdefault(parent, []).append(s)
for kids in by_parent.values():
    kids.sort(key=lambda s: s["startMs"])

MARK = {"ok": "  ", "warn": "! ", "error": "X "}

def walk(parent: str, depth: int) -> None:
    for s in by_parent.get(parent, []):
        git = f" @{s['git']['file']}:{s['git']['line']} ({s['git']['commit']})" if s.get("git") else ""
        err = f"  <- {s['error']}" if s.get("error") else ""
        print(f"{MARK.get(s['status'], '  ')}{'  ' * depth}{s['name']} [{s['kind']}] "
              f"{s['startMs']}ms +{s['durationMs']}ms{git}{err}")
        walk(s["id"], depth + 1)

walk("__root__", 0)

errors = sorted((s for s in spans if s["status"] == "error"), key=lambda s: s["startMs"])
if errors:
    f = errors[0]
    where = (f"-> {f['git']['file']}:{f['git']['line']} @ {f['git']['commit']}"
             if f.get("git") else "-> NO GIT CONTEXT (root-cause by reading code)")
    print(f"\nEarliest error: {f['name']} ({f['id']}) {where}")
else:
    print("\nNo error spans — check warn spans and spans that should exist but don't.")
```

Sample output — the shape you are looking for:

```
X booking_agent.run [agent] 0ms +4120ms  <- AgentError: run failed
X   plan.execute [agent] 40ms +4010ms  <- AgentError: step 2 failed
    llm.plan [llm] 45ms +690ms
X     tool.lookup [tool] 812ms +31ms @app/x.py:27 (3f9a1c05)  <- KeyError: 'change'
```

Three spans are red; only the last one is the bug. The two above it re-raise it.

## 4. Timeline reading: storms, stalls, and wasted spend

`startMs` is relative to the trace start; `durationMs` is wall time for that span. **Self time** = `durationMs` minus the summed duration of its children. A parent with large self time is doing the work (or waiting); a parent whose time is all in its children is just orchestration.

```js
// Retry storms, stalls, and post-failure spend. Append to the script above.
const counts = new Map();
for (const s of trace.spans) {
  const k = `${s.kind}:${s.name}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
const storms = [...counts].filter(([, n]) => n >= 3);
if (storms.length) console.log("Repeated spans (retry storm?):", storms);

// Spend that happened after the run had already failed.
const firstErrMs = first?.startMs ?? Infinity;
const wasted = trace.spans.filter(
  (s) => s.startMs > firstErrMs && (s.kind === "llm" || s.kind === "http" || s.kind === "tool")
);
if (wasted.length)
  console.log(`${wasted.length} model/tool calls ran AFTER the first failure ` +
              `(trace cost $${trace.cost}) — the failure was retried, not handled.`);
```

| Signature in the timeline | Reading |
| --- | --- |
| 3+ identical sibling names, all `error`, gaps roughly doubling | retry storm with exponential backoff; the retried call never had a terminal-failure branch |
| 3+ identical sibling names, all `ok`, near-zero gaps | the agent is looping — same tool, same args, no state change between iterations |
| One span holding ~all trace duration, no children | a stall: an un-timed-out network call or a lock |
| A gap with no span covering it | uninstrumented work; you are blind there — instrument before concluding |
| `llm` spans continuing after the first `error` | wasted spend; compare their count against trace `cost` and `tokensIn`/`tokensOut` |
| Trace `cost` 5-10x the median for that `service` | usually a storm or a loop, not a bigger prompt — count spans before blaming context size |

Trace-level `tokensIn`, `tokensOut`, and `cost` are the run's totals. Per-call economics live on the `llm` spans' `attributes` when instrumented — if they're missing, you can only reason about the total.

## 5. Detectors and what they mean

A detector runs over the trace at ingest and writes at most one `finding`. It is a *label with a pointer* (`triggeredSpanId`) — a starting point, not a verdict. When an LLM judge is unavailable, the label is produced heuristically (an `llm` span becomes `hallucination`, any other error becomes `tool_failure`, warn-only becomes `intent_drift`), so a coarse label on a correct span is common. **Trust the span tree over the label.**

| Detector | Failure class | Typical trace signature | Where the cause usually is |
| --- | --- | --- | --- |
| `hallucination` | fabricated content | `llm` span `ok`, output contains a fact/number absent from every upstream `io.output` | the prompt's grounding, or a `search`/`db` span that returned nothing |
| `tool_failure` | execution broke | a `tool`/`function`/`http`/`db` span in `error`, usually with `git` context | the code at `git.file:line` and the commit that changed it |
| `intent_drift` | did the wrong thing | run completes, but the root `io.output` doesn't answer the root `io.input`; often `warn`-only | a planning `llm` span, or a branch/guard that was skipped |
| `safety` | policy violation | flagged content or an action taken without its confirmation span | a missing guard span; check the parent's control flow |

`severity` (`critical`/`high`/`medium`) and `confidence` (0-1) rank the queue; they say nothing about where the cause sits.

## 6. The API, with curl

All calls take `Authorization: Bearer $CAUSAL_API_KEY` against `$CAUSAL_API_URL` (default `http://localhost:3001`). The public demo dataset uses `causal_demo_key_2026`.

```bash
export CAUSAL_API_URL="${CAUSAL_API_URL:-http://localhost:3001}"
export CAUSAL_API_KEY="${CAUSAL_API_KEY:-causal_demo_key_2026}"
auth=(-H "Authorization: Bearer $CAUSAL_API_KEY")
```

**List recent traces** — newest first, `limit` defaults to 100 and is capped at 500.

```bash
curl -s "${auth[@]}" "$CAUSAL_API_URL/api/v1/traces?limit=50" \
  | jq '.traces[] | select(.status != "ok") | {id, service, status, cost, spanCount, startedAt}'
```

Returns `{ "traces": [{ id, service, environment, name, status, model, tokensIn, tokensOut, cost, spanCount, startedAt }], "count": n }`.

**Fetch one trace** with spans and finding (the shape in §1):

```bash
curl -s "${auth[@]}" "$CAUSAL_API_URL/api/v1/traces/$TRACE_ID" > trace.json

# earliest error span, with its git context
jq '[.spans[] | select(.status=="error")] | sort_by(.startMs) | .[0]
    | {id, name, kind, startMs, error, git}' trace.json
```

**Run the detector** on demand (it also runs automatically at ingest):

```bash
curl -s -X POST "${auth[@]}" "$CAUSAL_API_URL/api/v1/traces/$TRACE_ID/detect"
# -> the finding object, or {"identified": false} on a healthy trace
```

**Root-cause it and get a proposed fix** — needs a finding to exist first:

```bash
curl -s -X POST "${auth[@]}" "$CAUSAL_API_URL/api/v1/traces/$TRACE_ID/rca" | jq
```

```jsonc
{
  "rcaId": "...",
  "summary": "Tool failure — KeyError: 'change'",
  "commit": "3f9a1c05", "file": "app/x.py", "line": 27,
  "explanation": "…2-3 sentences…",
  "counterfactual": "If app/x.py:27 had read the renamed key, the run would have completed.",
  "confidence": 0.92,
  "hopsUpstream": 1,
  "fixTitle": "fix(booking-agent): guard tool.lookup",
  "fixDescription": "…",
  "fixDiff": [{ "kind": "meta", "text": "@@ app/x.py:27 @@" },
              { "kind": "del", "text": "…" },
              { "kind": "add", "text": "…" }],
  "prStatus": "proposed",       // "opened" once a GitHub App + repo mapping exist
  "prUrl": null, "prNumber": null
}
```

**Re-read the latest RCA** without re-running it (adds `id`, `status`, `model`, `createdAt`):

```bash
curl -s "${auth[@]}" "$CAUSAL_API_URL/api/v1/traces/$TRACE_ID/rca" | jq '{summary, commit, file, line, counterfactual, prStatus, prUrl}'
```

**Provenance** — tie the failing commit back to the session that authored it:

```bash
curl -s "${auth[@]}" "$CAUSAL_API_URL/api/v1/traces/$TRACE_ID/provenance" | jq
```

```jsonc
{
  "traceId": "trc_8f21c9",
  "execution": { "traceId": "trc_8f21c9", "service": "booking-agent", "status": "error" },
  "incident": { "detector": "tool_failure", "title": "Tool failure — KeyError: 'change'" },
  "code": { "commit": "3f9a1c05", "file": "app/x.py", "line": 27 },
  "linkedNodes": [{ "id": "…", "layer": "REASONING", "kind": "…", "sessionId": "…",
                    "timestamp": "…", "excerpt": "…" }],
  "linked": true
}
```

`linked: false` just means no authoring session referencing that commit was captured — it is not evidence about the commit.

`POST /api/v1/traces` is the ingest endpoint the SDK uses. Debugging never writes there; re-ingesting a `traceId` **replaces** that trace and its spans.

## 7. Troubleshooting

| Symptom | Cause | Do this |
| --- | --- | --- |
| `401 {"error":"Missing Authorization header"}` | no/!Bearer header | send `Authorization: Bearer $CAUSAL_API_KEY` |
| `401` with a key present | wrong key or wrong org | confirm `CAUSAL_API_KEY` matches the environment you're querying |
| `404 Trace not found` | the id belongs to another org, or the trace was re-ingested/never sent | re-list traces and copy the `id` field verbatim |
| `{"identified": false}` from `/detect` | no `error` or `warn` span in the trace | the failure never surfaced as a span status — instrument the failing path, don't reinterpret |
| `400 No finding to root-cause on this trace` | `/rca` called before a finding exists | `POST /detect` first, then `POST /rca` |
| `404 No RCA run for this trace` on `GET /rca` | RCA never ran | `POST /rca` |
| RCA cites a file/line that doesn't exist | it was generated from a span without git context | ignore that RCA's location; root-cause from `io` and code |
| Every span has `git: null` | the SDK isn't attaching git context | root-cause manually, and fix instrumentation so the next incident is one hop |
| `prStatus: "proposed"`, no `prUrl` | no GitHub App/repo mapping wired | open the PR yourself using `fixDiff` as a starting point, after reviewing it |
| Root span `error`, no child `error` | the failure was caught and re-raised without a child span | read the root's `io.output` and the parent code path; a hop is uninstrumented |
