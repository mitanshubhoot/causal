# Causal — Root Cause Intelligence for AI-Agent Engineering Teams

> Automatically trace production incidents back through agent reasoning, code decisions, and specs — in 2 minutes instead of 2 days.
<img width="1470" height="838" alt="image" src="https://github.com/user-attachments/assets/bec597a0-1c25-4023-a0bd-fcd758c7234d" />


## What Is This?

When an AI agent causes a production incident, Causal answers: **why did the agent do what it did?**

It builds a **six-layer causal graph** connecting:

```
INTENT → SPEC → REASONING → CODE → EXECUTION → INCIDENT
```

And surfaces the critical path automatically when something breaks.

<img width="1460" height="799" alt="image" src="https://github.com/user-attachments/assets/d6d4673b-2a64-4081-b870-1fb0c810d014" />

## Quick Start (Local Dev)

### 1. Prerequisites

- Node.js 22 (`apps/api` pins `engines.node` to `22.x`; CI runs 22), pnpm 10+
- Docker + Docker Compose
- Python 3.11+ (RCA engine; the Python SDK itself needs only 3.10+)

### 2. Start infrastructure

```bash
cp .env.example .env
pnpm infra:up
# Starts: Neo4j, PostgreSQL+TimescaleDB+pgvector, Redis, MinIO (S3-compatible)
```

No model-provider key is required to boot. Without one, detectors, RCA and the
copilot degrade gracefully instead of failing — see [LLM providers](#llm-providers-byok).

### 3. Install dependencies

```bash
pnpm install
```

### 4. Create the database schema

```bash
pnpm db:migrate    # applies infra/postgres/migrations/*.sql in order; safe to re-run
pnpm db:seed       # demo org, API key, and a causal graph to click through
pnpm db:seed-traces  # optional: traces + detector findings for the v2 views
```

`db:migrate` tracks applied files in `schema_migrations`, so re-running it is a no-op.

### 5. Start the API

```bash
pnpm --filter @causal/api dev
# Running at http://localhost:3001
```

### 6. Start the RCA engine

```bash
cd apps/rca
python -m venv .venv && source .venv/bin/activate
pip install -e .
python -m rca.main
# Running at http://localhost:8001 (override with RCA_PORT)
```

### 7. Start the frontend

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @causal/web dev
# Running at http://localhost:3000
```

**Do not skip the `.env.local` copy.** Next.js inlines `NEXT_PUBLIC_*` at build time
and does not read the root `.env`. With no `NEXT_PUBLIC_API_URL`, the web app
silently serves mock fixtures that are indistinguishable from live data.

### 8. Install the Python SDK and init the git hook

```bash
pip install -e packages/sdk-python/
causal init   # installs .git/hooks/post-commit
```

See [`packages/sdk-python/README.md`](packages/sdk-python/README.md) for the SDK itself.

## Claude Code Integration (MCP Server)

The MCP server ships in this repo (`packages/mcp-server`). Build it, then add it
to your project's `.mcp.json` (Claude Code reads JSON, not TOML):

```bash
pnpm --filter causal-mcp build
```

```jsonc
// .mcp.json
{
  "mcpServers": {
    "causal": {
      "command": "node",
      "args": [
        "packages/mcp-server/dist/index.js",
        "--org", "YOUR_ORG_ID",
        "--api-key", "YOUR_API_KEY"
      ]
    }
  }
}
```

Now every Claude Code session auto-creates a REASONING node. Every commit auto-links to it via session ID. When an incident fires, Causal traces the full chain.

> The package is not yet published to npm, so use the local `dist` path above
> rather than `npx causal-mcp`.

## LangGraph Integration

For teams building agents with LangGraph:

```python
from causal_sdk import CausalClient
from causal_sdk.integrations.langgraph import CausalLangGraphCallback

client = CausalClient(api_key="...", org_id="...")

app = graph.compile(checkpointer=MemorySaver())

# Callbacks are passed at invoke time (LangGraph's compile() has no callbacks arg):
app.invoke(
    initial_state,
    config={"callbacks": [CausalLangGraphCallback(client=client, spec_id="LIN-447")]},
)
```

Zero changes to your agent logic. Causal captures every state transition and tool call.

## Project Structure

```
causal/
├── packages/
│   ├── types/              # Shared TypeScript types + Zod schemas
│   ├── sdk-typescript/     # @causal/sdk — TypeScript SDK + tracer
│   ├── sdk-python/         # causal-sdk — Python SDK, tracer, integrations
│   ├── cli/                # @causal/cli — `causal` terminal client
│   └── mcp-server/         # causal-mcp — Claude Code MCP server
├── apps/
│   ├── api/                # Fastify 5 REST API (Node.js + TypeScript, ESM)
│   ├── rca/                # LangGraph RCA engine (Python microservice)
│   └── web/                # Next.js 14 frontend
├── infra/
│   ├── neo4j/              # Graph schema + indexes
│   ├── postgres/           # TimescaleDB + pgvector migrations + migrate.js
│   └── docker-compose.yml
├── skills/                 # Agent skills: quickstart, instrument, debug
├── docs/                   # Architecture notes
└── .env.example
```

None of `@causal/sdk`, `@causal/cli`, `causal-mcp` or `causal-sdk` is published to a
registry yet. Inside the monorepo they resolve as workspace dependencies; from
outside, install them from a checkout by path (each package's README has the exact
commands).

## Repo Scripts

| Script | Does |
|--------|------|
| `pnpm infra:up` / `infra:down` / `infra:logs` | Docker Compose stack |
| `pnpm db:migrate` | Apply `infra/postgres/migrations/*.sql` in order (idempotent) |
| `pnpm db:seed` | Demo org, API key, and a causal graph |
| `pnpm db:seed-traces` | Traces + detector findings for the v2 views |
| `pnpm lint` | ESLint (flat config at the repo root) |
| `pnpm type-check` / `pnpm test` / `pnpm build` | Across all workspaces via Turborepo |

## Detectors

An LLM-as-judge reads each ingested trace and flags failures no assertion would have
caught: `hallucination`, `tool_failure`, `intent_drift`, `safety`. A finding carries a
severity, a confidence, and the span it came from.

Set `ENABLE_DETECTORS=true` to run the judge inline on ingest (fire-and-forget), and
`ENABLE_AUTO_RCA=true` to root-cause and propose a fix automatically whenever one
fires. Both are off by default because both spend model tokens.

| Endpoint | Does |
|----------|------|
| `POST /api/v1/traces/:id/detect` | Run the judge on one trace on demand |
| `GET /api/v1/detectors` | Detector definitions and their finding counts |
| `GET /api/v1/findings` | Org-wide findings feed |
| `POST /api/v1/findings/:id/resolve` | Resolve or reopen a finding |
| `POST /api/v1/traces/:id/rca` | Run agentic RCA over a trace |
| `POST /api/v1/traces/:id/ask` | Ask Causal Copilot about one trace |

The judge's JSON is treated as untrusted and validated before it is stored — an
out-of-enum detector or a nonsense confidence is rejected, never persisted.

## Datasets & Evals

The loop that turns firefighting into a repeatable process: promote a confirmed
finding to a golden case, then re-run the whole set against every release so a fix is
verified and a regression cannot come back unnoticed.

| Endpoint | Does |
|----------|------|
| `GET/POST /api/v1/datasets` | List or create datasets |
| `POST /api/v1/datasets/:id/items` | Add a case |
| `POST /api/v1/datasets/:id/promote` | Promote a finding to a golden case |
| `POST /api/v1/datasets/:id/run` | Run an eval over the dataset |
| `GET /api/v1/evals`, `GET /api/v1/evals/:id` | Eval runs and results |

## LLM Providers (BYOK)

Causal is not tied to one vendor. Nine providers are supported — Anthropic, OpenAI,
Google Gemini, xAI Grok, DeepSeek, OpenRouter, Moonshot (Kimi), Zhipu GLM and AWS
Bedrock — all spoken over plain `fetch`, with no vendor SDKs added as dependencies.

Keys resolve per workspace, most specific first:

1. A key stored for the org in `provider_keys`, **encrypted at rest** with AES-256-GCM
   under `CAUSAL_ENCRYPTION_KEY`.
2. The server-wide key in the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `GOOGLE_API_KEY`, …).
3. Nothing — the feature degrades and says so rather than inventing an answer.

Models are chosen per purpose (`DETECTOR_MODEL`, `RCA_MODEL`, `COPILOT_MODEL`), and a
workspace can override each one.

Without `CAUSAL_ENCRYPTION_KEY`, BYOK reads and writes return a clear 503 and the
server-wide keys keep working — Causal never stores a customer key in plaintext.
Generate one with `openssl rand -base64 32`.

| Endpoint | Does |
|----------|------|
| `GET /api/v1/providers` | Providers, which have a key, and where it came from |
| `PUT /api/v1/providers/:provider` | Store a key (validated against the provider first) |
| `DELETE /api/v1/providers/:provider` | Remove a stored key |
| `GET /api/v1/providers/:provider/models` | Models available for a provider |
| `GET/PUT /api/v1/providers/settings` | Per-purpose model selection |

## OpenTelemetry Ingest

You do not need the Causal SDK. The API accepts **OTLP/HTTP+JSON** at the standard
collector path, so any OpenTelemetry SDK can export straight to it:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3001
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer causal_demo_key_2026"
```

`gen_ai.*` semantic-convention attributes (model, tokens, prompt/completion) are
mapped automatically, as are `code.filepath` / `code.lineno` for git context. JSON
encoding only — protobuf would require a decoder dependency.

## The Three UI Views

| View | When to Use |
|------|-------------|
| **Provenance Explorer** | During/after incidents — navigate the causal DAG |
| **Replay Sandbox** | After root cause identified — verify fix prevents recurrence |
| **Post-Mortem Generator** | After resolution — generate structured doc + Linear ticket |

## Auto-Link Strategies

| Strategy | Trigger | Confidence |
|----------|---------|-----------|
| Session ID | Commit trailer matches REASONING node | 0.97 |
| Stack Trace | Sentry frame → git blame → commit | 0.85–0.95 |
| Time Window | Temporal + semantic proximity | 0.60–0.80 |
| Vector Similarity | pgvector cosine search (fallback) | 0.30–0.60 |

## Webhooks

| Source | Endpoint | Creates |
|--------|----------|---------|
| GitHub | `POST /api/v1/webhooks/github` | CODE node on push |
| PagerDuty | `POST /api/v1/webhooks/pagerduty` | INCIDENT node |
| Sentry | `POST /api/v1/webhooks/sentry` | INCIDENT + stack trace |
| Datadog | `POST /api/v1/webhooks/datadog` | EXECUTION node |
| Linear | `POST /api/v1/webhooks/linear` | SPEC node |
| LangSmith | `POST /api/v1/webhooks/langsmith` | REASONING node |

## Tech Stack

- **API**: Fastify 5 + TypeScript + Node.js 22
- **Graph DB**: Neo4j (Cypher ancestor traversal, APOC)
- **Time-series + Vector**: PostgreSQL 16 + TimescaleDB + pgvector
- **Object Storage**: S3-compatible (MinIO for local dev)
- **RCA Engine**: LangGraph StateGraph (Python, local-only)
- **LLM**: 9 pluggable providers, per-workspace BYOK — see below
- **Embeddings**: OpenAI text-embedding-3-small (1536 dims)
- **Background work**: in-process (`setImmediate`) — no external queue yet
- **Frontend**: Next.js 14 + react-flow + Tailwind CSS
- **Auth**: Bearer API keys (SHA-256 hashed) + a public demo key
