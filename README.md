# Causal — Root Cause Intelligence for AI-Agent Engineering Teams

> Automatically trace production incidents back through agent reasoning, code decisions, and specs — in 2 minutes instead of 2 days.

## What Is This?

When an AI agent causes a production incident, Causal answers: **why did the agent do what it did?**

It builds a **six-layer causal graph** connecting:

```
INTENT → SPEC → REASONING → CODE → EXECUTION → INCIDENT
```

And surfaces the critical path automatically when something breaks.

## Quick Start (Local Dev)

### 1. Prerequisites

- Node.js 20+, pnpm 10+
- Docker + Docker Compose
- Python 3.11+ (for RCA engine and Python SDK)

### 2. Start infrastructure

```bash
cp .env.example .env
# Edit .env with your API keys (Anthropic is required; others are optional for local dev)

pnpm infra:up
# Starts: Neo4j, PostgreSQL+TimescaleDB+pgvector, Redis, MinIO (S3-compatible)
```

### 3. Install dependencies

```bash
pnpm install
```

### 4. Start the API

```bash
pnpm --filter @causal/api dev
# Running at http://localhost:3001
```

### 5. Start the RCA engine

```bash
cd apps/rca
python -m venv .venv && source .venv/bin/activate
pip install -e .
python -m rca.main
# Running at http://localhost:8001
```

### 6. Start the frontend

```bash
pnpm --filter @causal/web dev
# Running at http://localhost:3000
```

### 7. Install the Python SDK and init git hook

```bash
pip install -e packages/sdk-python/
causal init   # installs .git/hooks/post-commit
```

## Claude Code Integration (MCP Server)

Add to your `CLAUDE.md` or `.claude/settings.json`:

```toml
[[mcp_servers]]
name = "causal"
command = "npx"
args = ["causal-mcp", "--org", "YOUR_ORG_ID", "--api-key", "YOUR_API_KEY"]
```

Now every Claude Code session auto-creates a REASONING node. Every commit auto-links to it via session ID. When an incident fires, Causal traces the full chain.

## LangGraph Integration

For teams building agents with LangGraph:

```python
from causal_sdk import CausalClient
from causal_sdk.integrations.langgraph import CausalLangGraphCallback

client = CausalClient(api_key="...", org_id="...")

app = graph.compile(
    checkpointer=MemorySaver(),
    callbacks=[CausalLangGraphCallback(client=client, spec_id="LIN-447")]
)
```

Zero changes to your agent logic. Causal captures every state transition and tool call.

## Project Structure

```
causal/
├── packages/
│   ├── types/              # Shared TypeScript types + Zod schemas
│   ├── sdk-typescript/     # @causal/sdk — TypeScript SDK
│   ├── sdk-python/         # causal-sdk — Python SDK + LangGraph integration
│   └── mcp-server/         # causal-mcp — Claude Code MCP server
├── apps/
│   ├── api/                # Fastify REST API (Node.js + TypeScript)
│   ├── rca/                # LangGraph RCA engine (Python microservice)
│   └── web/                # Next.js 14 frontend
├── infra/
│   ├── neo4j/              # Graph schema + indexes
│   ├── postgres/           # TimescaleDB + pgvector migrations
│   └── docker-compose.yml
└── .env.example
```

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

- **API**: Fastify + TypeScript + Node.js 20
- **Graph DB**: Neo4j (Cypher ancestor traversal)
- **Time-series + Vector**: PostgreSQL 16 + TimescaleDB + pgvector
- **Object Storage**: S3-compatible (MinIO for local dev)
- **RCA Engine**: LangGraph StateGraph (Python)
- **LLM**: Claude claude-sonnet-4-6 (Anthropic API)
- **Embeddings**: OpenAI text-embedding-3-small (1536 dims)
- **Queue**: Redis Streams
- **Frontend**: Next.js 14 + react-flow + Tailwind CSS
- **Auth**: Clerk
