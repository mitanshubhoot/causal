# causal-sdk

Python SDK for [Causal](../../README.md) — capture an agent run as a trace of spans and ship it to
the Causal ingest endpoint (`POST /api/v1/traces`), where detectors judge it and RCA blames the
commit that broke it.

Two rules the SDK never breaks:

- **Telemetry never breaks the host app.** Every export error is swallowed; your function's return
  value and exceptions pass through untouched.
- **No API key, no network.** Spans are still recorded, they are simply dropped — so instrumentation
  stays exercised in tests without a credential.

Python 3.10+.

## Install

Not yet published to PyPI. Install the local package from a checkout of this repo:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e packages/sdk-python/
```

Framework adapters live behind extras, so nothing you do not use is imported:

```bash
pip install -e 'packages/sdk-python/[langgraph]'   # LangGraph / LangChain callback
pip install -e 'packages/sdk-python/[boto3]'       # Bedrock-backed Anthropic clients
pip install -e 'packages/sdk-python/[all]'
```

`openai`, `anthropic`, `crewai` and `llama-index` are not declared as dependencies at all — the
adapters wrap whatever version you already have.

## Configuration

`CausalTracer` reads the environment, so a key never has to live in your source:

| Variable | Default | What it does |
| --- | --- | --- |
| `CAUSAL_API_KEY` | — | Bearer key for ingest. **Unset → nothing is exported** (spans still record). |
| `CAUSAL_API_URL` | `http://localhost:3001` | API base URL. Correct for a local `@causal/api`, wrong for a hosted instance. |
| `CAUSAL_ORG_ID` | `default` | Sent as `x-causal-org-id`. The demo org is `org_demo_causal_001`. |
| `CAUSAL_SERVICE` | `python-agent` | Service name, when not passed to the constructor. |
| `CAUSAL_ENVIRONMENT` | `production` | Environment label on the trace. |
| `CAUSAL_MODEL` | — | Default model recorded on the trace. |
| `CAUSAL_REPO` / `CAUSAL_REPO_ID` | — | Repository slug. Without it RCA cannot blame a commit. |
| `CAUSAL_GIT_REF` | — | Commit sha or ref the run executed at. |
| `CAUSAL_USER` | — | Who or what triggered the run. |
| `CAUSAL_SESSION_ID` | — | Ties the trace to a REASONING node from the same session. |
| `CAUSAL_DISABLED` | — | `1`/`true`/`yes`/`on` records spans without exporting them. |

Constructor arguments win over the environment:

```python
from causal_sdk import CausalTracer

tracer = CausalTracer(
    service="booking-agent",
    environment="production",
    model="claude-sonnet-4-5",
    repo="acme/booking-agent",
    git_ref="a1b2c3d",
)
```

One tracer per service is enough — it holds configuration only, so it is safe to share across tasks
and threads. `tracer.enabled` tells you whether exports will actually leave the process.

## `@observe` — the short path

Decorate a function and every call becomes a span. Nesting is automatic: the decorator reads the
current trace and span from contextvars, so a decorated function called from another decorated
function becomes its child.

```python
from causal_sdk import CausalTracer, observe

tracer = CausalTracer(service="booking-agent")

@observe(kind="tool")
def search_flights(origin: str, dest: str) -> list[dict]:
    ...

@observe(kind="llm")
async def plan(prompt: str) -> str:
    ...

async with tracer.trace("booking_agent.run"):
    await plan("book me a flight")     # nested under the root span
```

| Argument | Default | Meaning |
| --- | --- | --- |
| `name` | the function's `__qualname__` | Span name. Bare `@observe` works — the callable is detected. |
| `kind` | `"function"` | One of the span kinds below. |
| `capture_io` | `True` | Record arguments and return value, clipped to 2,000 chars. Turn off for sensitive payloads. |

Sync functions, async functions, generators and async generators are all handled; for generators the
span covers the full iteration and a consumer that stops early closes it as `ok` rather than as a
failure.

Called **outside** a trace, `@observe` starts one with the default tracer and flushes it when the
outermost decorated call returns — a lone decorated function is still a complete, exportable trace.
Point that fallback at your own tracer with `causal_sdk.tracer.set_default_tracer(...)`.

## Explicit spans

When you want control over structure, timing or economics, open spans yourself.

```python
from causal_sdk import CausalTracer

tracer = CausalTracer(service="booking-agent")

async with tracer.trace("booking_agent.run") as t:
    plan = t.span("llm.plan", "llm")
    answer = await call_model(prompt)
    plan.end(io={"input": prompt, "output": answer}, tokens_in=812, tokens_out=210)

    tool = plan.child("tool.search_flights", "tool")
    tool.end(status="warn", attributes={"results": 0})
```

`tracer.trace(...)` is also a decorator, for async **and** sync functions:

```python
@tracer.trace("booking_agent.run")
async def run(prompt: str) -> str:
    ...
```

Non-async code uses the blocking twin, which exports on exit:

```python
with tracer.trace_sync("nightly_reconcile") as t:
    t.span("db.query", "db").end()
```

Either way the root span is closed as `error` if the block raises, and the exception is re-raised
untouched.

**Span kinds:** `agent`, `llm`, `tool`, `http`, `db`, `function`, `skill`, `workflow`, `search`,
`shell`. An unknown kind is coerced to `function`, so a typo drops one label instead of rejecting the
whole trace.

**`span.end(...)`** takes `status` (`ok` / `warn` / `error`), `error`, `attributes`, `io`, `git`,
`tokens_in`, `tokens_out` and `cost`. Passing `error` implies `status="error"` unless you explicitly
pass `"warn"`. Ending twice is a no-op, so an explicit `end()` inside a decorated function always
wins over the automatic one.

Anchor a span to source so RCA can walk from a failure to a commit:

```python
span.end(git={"file": "app/tools/flights.py", "line": 44, "sha": "a1b2c3d"})
```

For full manual control, `tracer.start_trace()` returns a trace you own — call `await t.flush()`
(or `t.flush_sync()`) yourself. Ingest is idempotent on `traceId`, so re-flushing replaces the stored
trace rather than duplicating it.

## Integrations

Drop-in adapters that make an existing client or framework emit spans without changing a call site.
Each takes a `CausalTracer`, a live trace, or a parent span. Prefer a trace or a span so model calls
land inside the run you are already tracing; a bare tracer opens and flushes a one-span trace per
call, which is only right for a script.

```python
from openai import OpenAI
from causal_sdk import CausalTracer
from causal_sdk.integrations import wrap_openai

tracer = CausalTracer(service="support-agent")
t = tracer.start_trace()
root = t.span("support_agent.run", "agent")

client = wrap_openai(OpenAI(), t, parent=root)   # the original client is never mutated
client.chat.completions.create(model="gpt-4o", messages=[...])   # emits an `llm` span

await t.flush()
```

| Export | Covers |
| --- | --- |
| `wrap_openai(client, target, *, parent=None, ...)` | `OpenAI` / `AsyncOpenAI` / `AzureOpenAI` |
| `wrap_anthropic(client, target, *, parent=None, ...)` | `Anthropic` / `AsyncAnthropic`, incl. Bedrock and Vertex |
| `attach_crewai(target, *, parent=None, ...)` | Registers a listener on CrewAI's event bus |
| `attach_llamaindex(target, *, parent=None, ...)` | Installs a handler on LlamaIndex's global callback manager, alongside existing ones |
| `CausalLangGraphCallback(client=..., spec_id=...)` | LangGraph `StateGraph` and raw LangChain chains |

Both `wrap_*` functions return a forwarding proxy, so an un-instrumented reference to the same
client keeps working and two tracers can wrap the same client independently. Token counts and cost
are read from the provider's usage payload; pass `prices=` to override the built-in per-1M-token
table. Submodules import lazily, so `import causal_sdk.integrations` never pulls in a framework the
host application does not use — and an adapter whose dependency is missing raises an `ImportError`
naming the pip extra.

LangGraph's `compile()` has no `callbacks` argument, so the callback is passed at invoke time:

```python
from causal_sdk import CausalClient
from causal_sdk.integrations.langgraph import CausalLangGraphCallback

client = CausalClient(api_key="causal_...", org_id="org_...")

app.invoke(
    initial_state,
    config={"callbacks": [CausalLangGraphCallback(client=client, spec_id="LIN-447")]},
)
```

## Provenance API

Traces answer *what happened*. The provenance API records *why* — the six-layer causal graph
(`INTENT → SPEC → REASONING → CODE → EXECUTION → INCIDENT`) that links an incident back to the
agent decision and commit behind it.

`AsyncCausalClient` is the implementation; `CausalClient` is a backwards-compatible alias. **Both are
async** — every request method must be awaited.

```python
import asyncio
from causal_sdk import AsyncCausalClient, CreateNode

async def main() -> None:
    async with AsyncCausalClient(api_key="causal_...", org_id="org_...") as client:
        node = await client.create_node(CreateNode(
            layer="REASONING",
            kind="agent_decision",
            timestamp=1_760_000_000_000,
            payload={"prompt": "...", "decision": "..."},
        ))
        chain = await client.get_trace(node.id, max_depth=6)

asyncio.run(main())
```

Methods: `create_node`, `create_nodes_batch`, `create_edge`, `upload_snapshot`, `get_node`,
`get_trace`, `aclose` (aliased as `close`). `org_id` and `repo_id` are filled in from the client when
the payload omits them, and default from `CAUSAL_ORG_ID` / `CAUSAL_REPO_ID`.

The `@trace` decorator wraps an **async** function to open a REASONING node on entry and update it on
completion, recording the error if it raised:

```python
from causal_sdk import trace, CausalClient

client = CausalClient(api_key="causal_...")

@trace(client=client, spec_id="LIN-447")
async def my_agent(prompt: str) -> str:
    ...
```

It also writes a `.causal-session` file, which the git hook below reads to link commits to the run
that produced them. Do not confuse it with `@observe` — `@trace` writes graph nodes, `@observe`
records spans.

## CLI

The install exposes a `causal` console script:

```bash
causal init                                    # install .git/hooks/post-commit
causal ingest commit --hash <sha> [--session <id>]
```

`causal init` installs the post-commit hook that sends each commit to the API as a CODE node,
linked to the active session when `.causal-session` exists. An existing hook is backed up to
`post-commit.pre-causal` and chained, never overwritten. It also reports whether `CAUSAL_API_KEY`
and `CAUSAL_ORG_ID` are set.

Commit ingest is deliberately non-fatal: a Causal outage prints a warning and exits `0` rather than
blocking your commit.

> The MCP snippet `causal init` prints references `npx causal-mcp`, which is not published yet —
> use the local `packages/mcp-server/dist/index.js` path from the [root README](../../README.md).

## Layout

| Module | Role |
| --- | --- |
| `causal_sdk/tracer.py` | `CausalTracer`, `CausalTrace`, `CausalSpan`, contextvars, export |
| `causal_sdk/observe.py` | `@observe` and its capture plumbing |
| `causal_sdk/client.py` | `AsyncCausalClient` / `CausalClient` HTTP client |
| `causal_sdk/decorators.py` | `@trace` — REASONING node capture |
| `causal_sdk/session.py` | `CausalSession` and the `.causal-session` file |
| `causal_sdk/models.py` | Pydantic models mirroring `@causal/types` |
| `causal_sdk/cli.py` | the `causal` console script |
| `causal_sdk/integrations/` | OpenAI, Anthropic, CrewAI, LlamaIndex, LangGraph adapters |

The wire format matches the TypeScript tracer in `@causal/sdk`, so both SDKs produce identical
traces.
