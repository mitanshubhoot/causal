# Root-cause patterns

Six failures cover most AI-agent incidents. Match the **trace signature** first, confirm it by reading the code at the origin span's `git.file:line`, then write the counterfactual. A pattern that matches the signature but not the code is not your bug — keep walking the tree.

## Index

| Trace signature | Pattern | Section |
| --- | --- | --- |
| `tool`/`function` errors with `AttributeError`/`KeyError`, healthy before commit N | removed or renamed symbol | [1](#1-removed-or-renamed-symbol-after-a-refactor) |
| `http` span `ok` (200), the span that parses it errors | provider field rename | [2](#2-provider-field-rename) |
| intermittent wrong answer, or `IndexError` on the same input | positional-index lookup | [3](#3-positional-index-lookup-bug) |
| a guard span present in healthy traces is **missing**; parent duration pinned at the budget | guard skipped under a latency budget | [4](#4-confirmationguard-skipped-under-a-latency-budget) |
| N identical sibling spans, gaps doubling, all `error` with a timeout | retry storm on an unhandled timeout | [5](#5-retry-storm-on-an-unhandled-timeout) |
| `llm` span `ok`, output contains a number absent from every upstream `io.output` | hallucinated statistic | [6](#6-hallucinated-statistic-from-a-locally-computed-number) |

---

## 1. Removed or renamed symbol after a refactor

**Trace signature**

- The earliest `error` span is `tool` or `function` and carries `git: {file, line, commit}`.
- `error` reads `KeyError: 'change'`, `AttributeError: 'Booking' object has no attribute 'change'`, or `TypeError: x.change is not a function`.
- Every ancestor span re-raises a wrapped version of the same message.
- Traces on the previous `gitRef` are clean; the failure starts at one deploy and is 100% reproducible.
- `git log -L <line>,<line>:<file>` on the origin's commit shows the rename.

**Root cause** — a refactor renamed a field, key, or method, and one consumer was missed. The missed consumer is almost always a *dynamic* access (dict key, `getattr`, string-keyed dispatch, JSON payload) that no type checker sees.

**Counterfactual** — "had `app/x.py:27` read `delta`, the run would have completed."

**Fix shape** — update the consumer to the new name at the origin. If the payload crosses a producer/consumer version boundary, accept both for one migration window and fail loudly when neither key is present. Never silently default.

```python
# before — app/x.py:27
change = payload["change"]

# after — new name first, old name tolerated during migration, explicit failure otherwise
if "delta" in payload:
    change = payload["delta"]
elif "change" in payload:            # producers older than 3f9a1c05
    change = payload["change"]
else:
    raise ValueError(f"booking payload missing 'delta': keys={sorted(payload)}")
```

**Verify** — the regression test feeds the exact (redacted) `io.input` from the failing span and fails on the pre-fix code. Grep the repo for other reads of the old name before closing; a rename that missed one caller usually missed two.

---

## 2. Provider field rename

**Trace signature**

- The `http` span is `ok` with a 200 — the request succeeded.
- The span that parses its result (`function`, `tool`, or the `llm` span's caller) is `error`: `KeyError: 'total'`, `TypeError: Cannot read properties of undefined (reading 'amount')`.
- Or worse, nothing errors: the parsed value becomes `None`/`undefined`, a `warn` appears downstream, and the run returns a confidently wrong answer.
- `git blame` on the parsing line shows code unchanged for months, and no deploy of ours lines up with the start time. The `http` span's `io.output` shows the new payload shape.

**Root cause** — the provider changed its response shape (or you moved to a new API version) and the parser encoded the old shape as an assumption. The "commit that introduced it" is the commit that wrote the assumption, not a recent one — provenance and blame will point at old, blameless code. Confirm against the provider's changelog before blaming a teammate's commit.

**Counterfactual** — "had the quote parser validated the payload shape, the run would have failed at the boundary with `total.amount missing` instead of propagating `undefined` into the itinerary."

**Fix shape** — validate at the boundary, name the missing field in the error, and pin the provider's API version where one exists.

```ts
import { z } from "zod";

const Quote = z.object({
  total: z.object({ amount: z.number(), currency: z.string() }),
});

const http = t.span("http.quote", "http");
const res = await fetch(url, { headers: { "X-Api-Version": "2026-05-01" } });
const body = await res.json();
http.end({ status: res.ok ? "ok" : "error", io: { output: JSON.stringify(body).slice(0, 2000) } });

const parsed = Quote.safeParse(body);
if (!parsed.success) {
  const field = parsed.error.issues[0]?.path.join(".") ?? "<root>";
  // Name the drifted field in the span error — the next incident is then one hop.
  http.child("parse.quote", "function").end({
    status: "error",
    error: `quote schema drift: ${field}`,
    git: { file: "src/quotes.ts", line: 41, commit: process.env.GIT_SHA ?? "" },
  });
  throw new Error(`quote schema drift: ${field}`);
}
const { amount, currency } = parsed.data.total;
```

**Verify** — replay the captured `io.output` through the parser in a test. The fixed trace must fail at the parse span with the field name, not three hops later with `undefined`.

---

## 3. Positional-index lookup bug

**Trace signature**

- Intermittent: identical inputs produce clean traces and broken ones. Trace shape is the same either way.
- A `search`, `db`, `http`, or `tool` span returns a collection; the next span consumes `[0]` or `parts[2]`.
- Failure mode is either a silently wrong entity (no `error` at all, maybe a `warn`, detector says `intent_drift`) or `IndexError: list index out of range` / `TypeError: undefined` when the collection is empty.
- Comparing two traces shows the same query returning results in a different order.

**Root cause** — the code relies on result *position* instead of selecting by identity. Ordering is not part of most APIs' contracts, so a provider re-rank, a new index, or a cache warm-up silently changes which row is `[0]`.

**Counterfactual** — "had the lookup selected the row whose `id` matched the requested booking, the agent would have rescheduled the right flight regardless of result order."

**Fix shape** — select by key, assert cardinality, handle empty explicitly.

```python
# before
booking = results[0]                       # assumes the match is returned first

# after
matches = [r for r in results if r["id"] == booking_id]
if len(matches) != 1:
    raise LookupError(f"expected exactly 1 booking {booking_id}, got {len(matches)}")
booking = matches[0]
```

The string-parsing variant is the same bug:

```python
# before: "flight:BK-9:2026-08-11".split(":")[2]   -> breaks when a field contains ':'
_, booking_id, departs = value.split(":", 2)       # bound the split, name the parts
```

**Verify** — the regression test shuffles the result order and must still pass. In the fixed trace, record the selection criterion (`attributes: [{label: "selected_by", value: "id"}]`) so the next reader sees intent, not an index.

---

## 4. Confirmation/guard skipped under a latency budget

**Trace signature**

- A span that exists in healthy traces (`guard.confirm`, `tool.approve`, `policy.check`) is **absent** here. Absence is the signal — diff the tree against a known-good trace.
- The parent span's `durationMs` sits suspiciously close to a round budget (2000ms, 5000ms).
- Status is `ok` or `warn`, not `error`; the run "succeeded" while doing something it shouldn't have.
- The detector fires `safety` or `intent_drift`, and the finding points at the parent, not at any real cause.

**Root cause** — a timeout race treats "budget exceeded" as "proceed". `Promise.race` with a `sleep` that resolves truthy, or `asyncio.wait_for` wrapped in an `except TimeoutError: pass`, turns a guard into an optional step under load. It is invisible in code review because the happy path reads fine.

**Counterfactual** — "had confirmation timing out aborted the booking instead of defaulting to approved, the unconfirmed charge would not have happened."

**Fix shape** — fail closed, and emit a span for the skip so it is visible next time.

```ts
// before — budget expiry silently continues
const confirmed = await Promise.race([confirm(req), sleep(budgetMs).then(() => true)]);
if (confirmed) await book(req);

// after — budget expiry aborts, and the guard is always recorded
const g = t.span("guard.confirm", "tool");
const outcome = await Promise.race([
  confirm(req),                                  // true | false
  sleep(budgetMs).then(() => "timeout" as const),
]);
if (outcome !== true) {
  g.end({
    status: "error",
    error: outcome === "timeout" ? "confirmation timed out — aborting" : "user declined",
    git: { file: "src/booking.ts", line: 88, commit: process.env.GIT_SHA ?? "" },
  });
  throw new ConfirmationRequiredError(req.id);
}
g.end({ status: "ok", attributes: [{ label: "confirmed_by", value: req.userId }] });
await book(req);
```

```python
# python equivalent — the except branch must raise, never pass
try:
    confirmed = await asyncio.wait_for(confirm(req), timeout=budget_s)
except asyncio.TimeoutError as exc:
    raise ConfirmationRequired(req.id) from exc     # fail closed
if not confirmed:
    raise ConfirmationRequired(req.id)
```

**Verify** — a test that stubs `confirm()` to hang must raise, not book. In the fixed trace the guard span is present on *every* path, `ok` or `error`.

---

## 5. Retry storm on an unhandled timeout

**Trace signature**

- 3+ sibling spans with identical `name` and `kind`, gaps roughly doubling (250ms, 500ms, 1000ms…), all `error` with `ReadTimeout`, `ETIMEDOUT`, `ECONNRESET`, or `503`.
- Trace `durationMs` and `cost` far above the median for that service; `llm` spans continue after the first failure because the agent re-planned and repeated the whole subtree.
- The final sibling's error is what propagates upward, so the finding names the last attempt, not the first.

**Root cause** — the retry wrapper treats timeouts as retryable without a cap, a total deadline, or a circuit breaker; often the inner call has no timeout smaller than the outer budget, so each attempt burns the full window. The agent layer then retries the retrying tool, multiplying attempts.

**Counterfactual** — "had the quote call been bounded to 3 attempts inside an 8-second deadline, the run would have failed once in 8s with a clear provider-timeout error instead of burning 40s and $0.42 in re-planning."

**Fix shape** — bounded attempts, a total deadline, jitter, and error classification (retry only what is safe to repeat).

```python
import asyncio, random, time

RETRYABLE = (asyncio.TimeoutError, ConnectionError)

async def call_with_retry(fn, *, attempts=3, deadline_s=8.0, base=0.25):
    """Bounded retry: at most `attempts` tries, never past `deadline_s` total."""
    started = time.monotonic()
    last: BaseException | None = None
    for attempt in range(attempts):
        remaining = deadline_s - (time.monotonic() - started)
        if remaining <= 0:
            break
        try:
            return await asyncio.wait_for(fn(), timeout=remaining)
        except RETRYABLE as exc:                    # 4xx and validation errors: don't retry
            last = exc
            backoff = min(base * (2 ** attempt), max(remaining - 0.05, 0))
            await asyncio.sleep(backoff * (0.5 + random.random() / 2))   # jitter
    raise TimeoutError(f"provider quote failed after {attempts} attempts / {deadline_s}s") from last
```

Also cap the layer above: an agent that can re-plan must count tool failures per run and stop, rather than restarting the subtree indefinitely.

**Verify** — the fixed trace has at most `attempts` sibling spans and exactly one terminal `error`; no `llm` span starts after it. Compare trace `cost` against the pre-fix trace and state the delta in the writeup.

---

## 6. Hallucinated statistic from a locally computed number

**Trace signature**

- The `llm` span is `ok`; nothing in the trace is `error`.
- Its `io.output` contains a figure that appears in **no** upstream span's `io.output` — often plausible and close to the true value (a rounded sum, an off-by-one count).
- Upstream there is a `search`/`db`/`tool` span whose output holds the raw rows the number should have come from — or, worse, one that returned nothing.
- The detector fires `hallucination` and points at the `llm` span.

**Root cause** — arithmetic or aggregation was delegated to the model. Given rows and asked for a total, a model produces a number shaped like an answer. This is a prompt/architecture bug, not a model defect; "use a better model" moves the error rate, not the failure mode.

**Counterfactual** — "had the total been summed in code and passed into the prompt as a fixed string, the report would have shown $4,182.55 instead of $4,180."

**Fix shape** — compute in code, hand the model the number, and validate that the number survived into the output.

```python
total = sum(r["amount"] for r in rows)               # arithmetic belongs in code
figure = f"{total:.2f}"

span = t.span("llm.summarize", "llm")
prompt = (
    f"Write a one-paragraph refund summary for {len(rows)} bookings.\n"
    f"Use this exact total, unchanged: {figure}. Do not compute any other figure."
)
answer = await model(prompt)

if figure not in answer:
    # Ungrounded output is an error, not a warning — surface it in the trace.
    span.end(status="error", error=f"ungrounded figure: expected {figure} in summary",
             io={"input": prompt, "output": answer})
    raise ValueError("summary did not carry the computed total")

span.end(status="ok", io={"input": prompt, "output": answer},
         attributes=[{"label": "grounded_total", "value": figure}])
```

If the retrieval span returned zero rows, the fix is upstream: an empty retrieval must fail or say "no data", never reach a model that will fill the gap.

**Verify** — the regression test asserts the exact computed figure appears in the output and that an empty `rows` input raises rather than summarizing. In the fixed trace, every number in the final output traces back to an upstream `io.output` or a `grounded_*` attribute.

---

## Fixes that are not fixes

| Tempting change | What it actually does |
| --- | --- |
| Broad `try/except` / `catch` around the failing call | converts a crash into a silently wrong answer — next week's `intent_drift` incident, with no error span to find |
| Raising the retry count or the timeout | multiplies a storm and raises cost; the terminal-failure branch is still missing |
| Adding "be accurate, do not make up numbers" to the prompt | leaves the arithmetic in the model; the failure returns at a lower rate |
| Deleting the assertion or guard that fired | removes the only evidence; the unsafe action stays |
| Changing the model to make the symptom disappear | changes the error rate, not the mechanism, and invalidates every trace you compared against |
| Editing instrumentation so the span reports `ok` | makes the dashboard green and the next incident undiagnosable |

## When no pattern matches

1. Diff the failing trace against the most recent clean trace of the same `service` and root name: which spans exist in one and not the other, and where do durations diverge?
2. Bisect by `gitRef`: `git log --oneline <clean gitRef>..<failing gitRef>` and look for commits touching the origin span's file or its callers.
3. If the origin span has no `git` context, stop root-causing and fix the instrumentation first — every future incident on that path costs the same manual walk.
4. If the trace has no `error` or `warn` span at all yet the behaviour was wrong, the failing branch is uninstrumented. Add spans around it, reproduce, and debug the new trace — do not guess from code alone.
