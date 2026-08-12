# Python — instrumenting with `causal-sdk`

Runnable recipes. Every snippet is additive: delete it and the app behaves identically.

## 1. Install

`causal-sdk` is **not yet published to PyPI**. Install it from a checkout by path:

```bash
git clone https://github.com/mitanshubhoot/causal
pip install -e /path/to/causal/packages/sdk-python/   # or: uv pip install -e <path>
```

Pin it the same way in your project — a local path or VCS reference in
`requirements.txt` / `pyproject.toml`, not a version range:

```
causal-sdk @ file:///path/to/causal/packages/sdk-python
```

Environment:

```bash
CAUSAL_API_KEY=causal_...            # required
CAUSAL_API_URL=http://localhost:3001 # default; set to your hosted Causal
CAUSAL_ORG_ID=org_123                # optional
```

Keep them in an untracked `.env` and in the deployment's secret store. Never commit a key.

## 2. One tracer config, one module

Create `app/observability/causal.py`. This is the only module that constructs a tracer.

```python
# app/observability/causal.py
from __future__ import annotations

import inspect
import os
import subprocess
from pathlib import Path

from causal_sdk import CausalTracer

REPO_ROOT = Path(__file__).resolve().parents[2]   # adjust to your layout


def _head_commit() -> str:
    """HEAD sha, resolved ONCE at import. Never shell out per span."""
    for key in ("CAUSAL_GIT_COMMIT", "GITHUB_SHA", "VERCEL_GIT_COMMIT_SHA"):
        value = os.environ.get(key)
        if value:
            return value
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=2
        )
        return proc.stdout.strip() or "unknown"
    except Exception:
        return "unknown"          # fail open: a missing sha must never break import


COMMIT = _head_commit()

BASE = dict(
    service="booking-agent",                        # one per deployable service
    environment=os.getenv("ENV", "development"),
    model="claude-sonnet-4-5",                      # the service's default model
    repo="acme/booking",                            # owner/name
    git_ref=COMMIT,
    # api_key / base_url / org_id fall back to CAUSAL_API_KEY / CAUSAL_API_URL / CAUSAL_ORG_ID
)

#: Default tracer for background work with no end user attached.
tracer = CausalTracer(**BASE)


def tracer_for(*, user: str | None = None, session_id: str | None = None) -> CausalTracer:
    """Same config, per-request identity. A tracer is a plain object — no connection, no cost."""
    return CausalTracer(**BASE, user=user, session_id=session_id)


def here() -> dict:
    """git context for the CALLER's file and line — nothing to keep in sync by hand."""
    frame = inspect.currentframe().f_back          # cheap; do NOT use inspect.stack()
    filename = Path(frame.f_code.co_filename).resolve()
    try:
        rel = str(filename.relative_to(REPO_ROOT))
    except ValueError:
        rel = filename.name
    return {"file": rel, "line": frame.f_lineno, "commit": COMMIT}
```

Containers and serverless images ship without `.git`: set `CAUSAL_GIT_COMMIT` at build time so `COMMIT` stays real.

## 3. Wrap the entry point — one traced run per user-visible run

`async with tracer.trace(name) as t` opens the run, times it, and flushes on exit — including when the body raises.

```python
# app/api/routes.py
import json

from fastapi import APIRouter, Request

from app.observability.causal import tracer_for, here
from app.agent import run_booking_agent

router = APIRouter()


@router.post("/book")
async def book(body: BookRequest, request: Request):
    tracer = tracer_for(user=request.state.user_id, session_id=body.conversation_id)

    async with tracer.trace("booking_agent.run") as t:
        agent = t.span("booking_agent", "agent")     # everything else nests under this
        try:
            result = await run_booking_agent(body.message, t, agent)
        except Exception as exc:
            agent.end(status="error", error=f"{type(exc).__name__}: {exc}", git=here())
            raise                                     # tracing never swallows an error
        agent.end(
            status="ok",
            io={"input": redact(body.message), "output": redact(json.dumps(result))[:4000]},
        )
        return result
```

`redact()` is your own helper — strip keys, tokens, emails and card numbers before anything reaches `io`.

Rules of thumb:

- One `trace()` per request/job/CLI invocation — never one per tool call.
- Pass `t` and the parent span down explicitly, or use a `ContextVar` (§7) when a framework owns the call stack.
- Do not wrap `trace()` in `try/except` for telemetry's sake; it records the error and re-raises it.

## 4. Nest spans

`t.span(name, kind)` opens a span in the run; `span.child(name, kind)` nests under it. Nesting is what makes a trace readable: agent → sub-agent → llm/tool.

```python
# app/agent.py
import json

from app.observability.causal import here


async def run_booking_agent(message: str, t, agent):
    # 1. plan with the model
    plan = agent.child("llm.plan", "llm")
    planned = await call_model(message, t, plan)     # ends `plan` with tokens/cost — see §6

    # 2. tools the model chose — nested UNDER the llm span that chose them
    results = []
    for call in planned.tool_calls:
        span = plan.child(f"tool.{call.name}", "tool")
        try:
            results.append(await run_tool(call))
            span.end(status="ok", io={"input": json.dumps(call.args)[:2000]}, git=here())
        except Exception as exc:
            span.end(status="error", error=f"{type(exc).__name__}: {exc}", git=here())
            raise

    # 3. a sub-agent gets its own agent span, with its work nested beneath it
    summarizer = agent.child("subagent.summarize", "agent")
    summary = await summarize(results, t, summarizer)
    summarizer.end(status="ok", io={"output": summary[:4000]})

    return {"summary": summary, "results": results}
```

### A reusable step helper

Ends the span exactly once — fill `end` inside the block instead of calling `end()` yourself.

```python
# app/observability/step.py
from contextlib import asynccontextmanager

from .causal import here


@asynccontextmanager
async def step(parent, name: str, kind: str, git: dict | None = None):
    """Usage:
        async with step(agent, "tool.lookup", "tool", git=here()) as (span, end):
            rows = await lookup(...)
            end["io"] = {"output": str(rows)[:2000]}
    """
    span = parent.child(name, kind)
    end: dict = {}
    try:
        yield span, end
    except Exception as exc:
        end.pop("status", None)
        end.setdefault("error", f"{type(exc).__name__}: {exc}")
        span.end(status="error", git=git, **end)
        raise
    else:
        span.end(status=end.pop("status", "ok"), git=git, **end)
```

## 5. Git context — the part that makes RCA work

Attach `git={"file", "line", "commit"}` to every span that executes **your** code: tools, parsers, validators, business rules, graph nodes. Causal uses it to blame a commit and open a fix PR.

```python
parse = plan.child("parse.itinerary", "function")
try:
    itinerary = parse_itinerary(raw)
    parse.end(status="ok", git=here())
except Exception as exc:
    parse.end(
        status="error",
        error=f"{type(exc).__name__}: {exc}",
        git=here(),          # ← file + line + commit Causal will blame
    )
    raise
```

- **`here()` beats literals.** It reports the caller's real file and line, so refactors cannot rot the pointer.
- **Repo-relative paths.** `app/parse/itinerary.py`, never `/srv/app/...` — check `REPO_ROOT` matches your layout.
- **Real commit.** `"unknown"` gets you a file but no blame; set `CAUSAL_GIT_COMMIT` in images without `.git`.
- Skip `git` on `llm` and `http` spans: that failure belongs to the provider, not to a commit.

## 6. Tokens and cost

Trace-level economics live on the trace object; per-call detail lives on the `llm` span.

```python
# app/observability/usage.py

# Fill in your provider's current rates — USD per million tokens.
RATES = {
    "claude-sonnet-4-5": {"in": 0.0, "out": 0.0},
}


def record_usage(t, span, model: str, tokens_in: int, tokens_out: int, io: dict | None = None):
    rate = RATES.get(model, {"in": 0.0, "out": 0.0})
    cost = tokens_in / 1e6 * rate["in"] + tokens_out / 1e6 * rate["out"]

    t.tokens_in += tokens_in
    t.tokens_out += tokens_out
    t.cost += cost

    span.end(
        status="ok",
        io=io,
        attributes=[
            {"label": "model", "value": model},
            {"label": "tokens_in", "value": str(tokens_in)},
            {"label": "tokens_out", "value": str(tokens_out)},
            {"label": "cost_usd", "value": f"{cost:.6f}"},
        ],
    )
```

Read usage from the provider response — never estimate by counting characters. Streaming calls expose it on the final event.

## 7. Framework notes

### Anthropic SDK

```python
from anthropic import AsyncAnthropic

client = AsyncAnthropic()

span = agent.child("llm.answer", "llm")
res = await client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": prompt}],
)
text = "".join(b.text for b in res.content if b.type == "text")
record_usage(t, span, res.model, res.usage.input_tokens, res.usage.output_tokens,
             io={"input": prompt, "output": text})
```

### OpenAI SDK

```python
from openai import AsyncOpenAI

client = AsyncOpenAI()

span = agent.child("llm.answer", "llm")
res = await client.chat.completions.create(model=model, messages=messages)
usage = res.usage
record_usage(t, span, model,
             getattr(usage, "prompt_tokens", 0), getattr(usage, "completion_tokens", 0),
             io={"input": json.dumps(messages)[:4000],
                 "output": res.choices[0].message.content or ""})
```

### LangGraph / LangChain

The graph owns the call stack, so carry the current span in a `ContextVar`.

```python
# app/observability/context.py
import functools
from contextvars import ContextVar

from .causal import COMMIT

_current: ContextVar[tuple | None] = ContextVar("causal_current", default=None)


def set_current(t, span):
    return _current.set((t, span))


def reset_current(token):
    _current.reset(token)


def traced_node(name: str, file: str):
    """Wrap a LangGraph node: one agent span per node, nested under whatever is current."""
    def deco(fn):
        @functools.wraps(fn)
        async def wrapper(state, *args, **kwargs):
            ctx = _current.get()
            if ctx is None:
                return await fn(state, *args, **kwargs)      # fail open: no trace, no tracing
            t, parent = ctx
            span = parent.child(f"node.{name}", "agent")
            token = _current.set((t, span))
            git = {"file": file, "line": 1, "commit": COMMIT}
            try:
                out = await fn(state, *args, **kwargs)
                span.end(status="ok", git=git)
                return out
            except Exception as exc:
                span.end(status="error", error=f"{type(exc).__name__}: {exc}", git=git)
                raise
            finally:
                _current.reset(token)
        return wrapper
    return deco
```

```python
# registration is unchanged apart from the wrapper
graph.add_node("plan", traced_node("plan", "app/graph/plan.py")(plan_node))

# entry point
async with tracer.trace("support_graph.run") as t:
    root = t.span("support_graph", "agent")
    token = set_current(t, root)
    try:
        result = await graph.ainvoke(payload)
        root.end(status="ok", io={"input": redact(payload["message"]), "output": redact(str(result))[:4000]})
    except Exception as exc:
        root.end(status="error", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        reset_current(token)
```

For plain LangChain runnables, span the `.ainvoke()` call and read `response.usage_metadata["input_tokens"] / ["output_tokens"]` off the returned `AIMessage`. Callback handlers work too, but wrapping the call site survives version bumps.

## 8. Short-lived processes must flush

The `async with` form flushes for you. Use the explicit form when the trace has to outlive one block — scripts, CLIs, cron jobs, workers:

```python
# scripts/reindex.py
import asyncio

from app.observability.causal import tracer, here


async def main() -> None:
    t = tracer.start_trace()
    root = t.span("nightly_reindex", "agent")
    try:
        await reindex(t, root)
        root.end(status="ok")
    except Exception as exc:
        root.end(status="error", error=f"{type(exc).__name__}: {exc}", git=here())
        raise
    finally:
        await t.flush()          # the process is about to exit — this must be awaited


if __name__ == "__main__":
    asyncio.run(main())
```

- **Sync codebases (Celery, RQ, cron):** put the traced section in an `async def` and call `asyncio.run(...)` once at the task boundary. Do not create a fresh event loop per span.
- **Lambda / Cloud Functions:** `await` the traced run before returning. Fire-and-forget loses traces when the container freezes.
- **Long-lived servers:** stay on `async with tracer.trace(...)`; it already flushes once per run.
- **`sys.exit()` / `os._exit()`:** flush first, or the trace dies in the buffer.

## 9. What to instrument

**Prioritize**

| Instrument | Kind | Why |
| --- | --- | --- |
| The agent entry point | `agent` | One root per user-visible run |
| Every model call | `llm` | Tokens, cost, prompt/response |
| Every tool the model can choose | `tool` | Where agents actually fail |
| Sub-agents and graph nodes | `agent` | Gives the trace its shape |
| Retrieval / vector / SQL queries | `db` | Bad context is a top root cause |
| Outbound third-party API calls | `http` | Latency and 5xx attribution |
| Parsing, validation, business rules | `function` | Carries the `git` that powers RCA |
| Retry / fallback branches | `function` | Silent degradation shows up nowhere else |

**Avoid**

- Per-token or per-chunk spans in a streaming loop — one `llm` span for the whole call.
- Pure helpers: formatters, properties, dataclass constructors, tight numeric loops.
- Library internals you do not own.
- Anything inside a loop that runs thousands of times — span the loop, put the count in an attribute.
- Prompts or tool args containing secrets or PII — redact before `io`.
- Traces beyond a few hundred spans; ingest rejects payloads over 2000 spans.

## 10. Fail-open checklist

- No instrumentation helper raises: `here()`, `record_usage()`, `step()` only touch local objects.
- `_head_commit()` is wrapped in `try/except` and runs once at import.
- No new blocking call on a hot path; `subprocess` runs once at import, never per span.
- Exceptions are recorded, then re-raised — never swallowed.
- A missing `CAUSAL_API_KEY` degrades to a failed export, not a failed request.
