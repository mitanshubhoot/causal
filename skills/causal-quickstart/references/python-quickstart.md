# Python quickstart

Emits one nested trace from a standalone script. Python 3.10+.

## 1. Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install causal-sdk
```

Inside the Causal monorepo, install the local package instead: `pip install -e packages/sdk-python`.

## 2. Environment

```bash
export CAUSAL_API_KEY=causal_demo_key_2026     # public demo key
export CAUSAL_API_URL=http://localhost:3001    # default; point at the hosted API if remote
```

`CausalTracer` reads `CAUSAL_API_KEY`, `CAUSAL_API_URL`, and `CAUSAL_ORG_ID` from the environment, so the
script never holds a key.

## 3. `causal_quickstart.py`

Write this file as-is. It is a fake booking agent: it plans with an LLM, calls two tools, and the second
tool fails on purpose so the trace has something to root-cause.

```python
"""
Causal quickstart — one nested trace, shipped and verifiable.
Run: python causal_quickstart.py
"""
import asyncio
import os
import sys

from causal_sdk import CausalTracer

BASE_URL = os.environ.get("CAUSAL_API_URL", "http://localhost:3001")

# Only `service` is required; the rest mirror the TS options in snake_case.
tracer = CausalTracer(
    service="causal-quickstart",
    environment="development",
    model="claude-sonnet-4-5",
    repo="acme/storefront",
    git_ref="3f9a1c05",
    metadata=[{"label": "source", "value": "causal-quickstart"}],
)


async def main() -> None:
    if not os.environ.get("CAUSAL_API_KEY"):
        print("CAUSAL_API_KEY is not set. Try: export CAUSAL_API_KEY=causal_demo_key_2026")
        sys.exit(1)

    # Manual trace (not `async with tracer.trace(...)`) so a failed export raises
    # instead of being swallowed — during setup you want ingest errors to be loud.
    t = tracer.start_trace()
    root = t.span("booking_agent.run", "agent")

    # --- llm span: economics + io ------------------------------------------
    plan = root.child("llm.plan", "llm")
    await asyncio.sleep(0.12)                       # stand-in for the model call
    t.tokens_in += 1200
    t.tokens_out += 340
    t.cost += 0.014
    plan.end(
        status="ok",
        io={
            "input": "Book a window seat on the 8am flight to SFO.",
            "output": "Plan: 1) look up inventory 2) hold 12A 3) charge card",
        },
        attributes=[
            {"label": "model", "value": "claude-sonnet-4-5"},
            {"label": "tokensIn", "value": "1200"},
            {"label": "tokensOut", "value": "340"},
            {"label": "cost.usd", "value": "0.014"},
        ],
    )

    # --- tool span that succeeds: git context, because it runs app code -----
    lookup = plan.child("tool.lookup_inventory", "tool")
    await asyncio.sleep(0.045)
    lookup.end(
        status="ok",
        io={"input": '{"flight":"UA118","cabin":"economy"}', "output": '{"seats":["12A","14C"]}'},
        git={"file": "app/tools/inventory.py", "line": 41, "commit": "3f9a1c05"},
    )

    # --- tool span that FAILS: this is what a detector finding is built from -
    charge = plan.child("tool.charge_card", "tool")
    await asyncio.sleep(0.03)
    charge.end(
        status="error",
        error="KeyError: 'change' — booking payload missing fare-change amount",
        io={"input": '{"seat":"12A","fare":412.0}', "output": ""},
        git={"file": "app/tools/payments.py", "line": 27, "commit": "3f9a1c05"},
    )

    # End the root last: the first end() wins, so this is where root io/status live.
    root.end(
        status="error",
        io={
            "input": "Book a window seat on the 8am flight to SFO.",
            "output": "Booking failed at the payment step.",
        },
    )

    await t.flush()   # short-lived process: nothing ships without this

    print(f"trace id: {t.trace_id}")
    print(
        f'verify:   curl -s -H "Authorization: Bearer $CAUSAL_API_KEY" '
        f"{BASE_URL}/api/v1/traces/{t.trace_id}"
    )


if __name__ == "__main__":
    asyncio.run(main())
```

Once setup is proven, real agents use the context manager, which flushes on exit and fails open:

```python
async with tracer.trace("booking_agent.run") as t:
    span = t.span("llm.plan", "llm")
    span.end(status="ok", io={"input": "...", "output": "..."})
    t.tokens_in += 1200
# flushed here
```

## 4. Run

```bash
python causal_quickstart.py
```

Expected output:

```
trace id: 3a48324eff9e5a00
verify:   curl -s -H "Authorization: Bearer $CAUSAL_API_KEY" http://localhost:3001/api/v1/traces/3a48324eff9e5a00
```

## 5. Verify

Run the printed `verify` command, or open **Traces** in the Causal UI and search the trace id.

```bash
curl -s -H "Authorization: Bearer $CAUSAL_API_KEY" \
  "$CAUSAL_API_URL/api/v1/traces/<trace-id>" | head -60
```

The trace should come back with 4 spans in this shape:

```
booking_agent.run        agent   error
└─ llm.plan              llm     ok      tokens 1200/340, cost 0.014
   ├─ tool.lookup_inventory  tool ok     git app/tools/inventory.py:41 @3f9a1c05
   └─ tool.charge_card       tool error  git app/tools/payments.py:27 @3f9a1c05
```

## What makes this a good trace

| Line in the script                          | Why it matters                                               |
| ------------------------------------------- | ------------------------------------------------------------ |
| `root.child(...)` / `plan.child(...)`       | Real nesting (agent → llm → tool). Flat spans hide causality. |
| `t.tokens_in / tokens_out / cost`           | Trace economics — cost regressions become visible.            |
| `io={"input": …, "output": …}` on agent + llm | Lets the detector judge the behavior, not just the timing.   |
| `git={"file", "line", "commit"}` on tool spans | Root-causes a failure to a commit and enables a fix PR. Omit it and RCA degrades. |
| `status="error"` + a real error string      | Nothing is flagged without it.                                |

Keep secrets and PII out of `io` and `attributes` — the values are stored verbatim.

## Ingest contract

`POST {CAUSAL_API_URL}/api/v1/traces` with `Authorization: Bearer $CAUSAL_API_KEY`, returns
`201 {"traceId":"…","spanCount":N}`. Span kind is validated server-side; this quickstart uses
`agent`, `llm`, and `tool`. If an unusual kind ever returns 400, fall back to `function`.

## Troubleshooting

| Symptom                                    | Cause                                       | Fix                                                             |
| ------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- |
| Export fails with `401`                    | Missing or wrong key                        | `export CAUSAL_API_KEY=causal_demo_key_2026`; the header must be `Bearer <key>`. |
| Export fails with `400`                    | Payload rejected by the schema              | You edited a span — restore the script verbatim (check the span kind and that `git["line"]` is an int). |
| `ConnectError` / connection refused        | API not running, or wrong `CAUSAL_API_URL`  | Start the API (`http://localhost:3001`) or point at the hosted URL. Confirm with `curl $CAUSAL_API_URL/health`. |
| Script exits 0, nothing in Traces           | Process exited before the export finished   | Keep `await t.flush()` as the last statement; `async with tracer.trace(...)` flushes for you but swallows export errors by design. |
| Trace exists, but the UI list looks empty  | Filtered to a different service/environment | Look for service `causal-quickstart`, environment `development`. |
| `ModuleNotFoundError: causal_sdk`          | Not installed, or wrong venv                | `source .venv/bin/activate && pip install causal-sdk`.           |
| `ImportError: cannot import name 'CausalTracer'` | Installed version predates the tracer  | `pip install -U causal-sdk` (or `pip install -e packages/sdk-python` in the monorepo). |
| `RuntimeWarning: coroutine … never awaited` | Called `flush()` without `await`            | The script must run under `asyncio.run(main())`.                  |
| No detector finding on the trace           | Detectors disabled on the server            | The trace is still correct; enable detectors server-side to see findings. |
