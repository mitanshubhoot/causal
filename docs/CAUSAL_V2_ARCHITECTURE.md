# Causal v2 — Architecture Spec

> AI-native observability + self-healing for AI-agent software.
> Instrument in a few lines → see every LLM call, tool call, and agent decision →
> detect failures automatically → root-cause them against your source and git
> history → open a verified fix PR.

This is the plan to evolve Causal from the current demo (six-layer causal graph on
mock data) into a real product at feature parity with — and improving on —
TraceRoot (YC S25), reusing the existing monorepo. It is a **clean-room** design:
architecture and ideas learned from TraceRoot's Apache-2.0 repo, implemented as
Causal's own code. We do not copy TraceRoot source or strip attribution, and we
never touch their enterprise (`ee/`) code.

---

## 1. Product & wedge

**Who:** AI engineers and platform teams running LLM/agent software in production.

**The loop we own end to end (nobody else does all four):**

```
INSTRUMENT ──▶ OBSERVE ──▶ DETECT ──▶ ROOT-CAUSE ──▶ FIX
 (SDK)         (traces)    (LLM       (agent +       (verified
                           judge)     git history)    PR)
```

**Go-to-market sequencing** (the discipline we lacked in v1):
1. **Land on observability** — `pip install`, `@observe`, see your traces. Day-one,
   single-player, no incident required. This is the Friday install.
2. **Expand to detectors** — an LLM-as-judge watches every trace and alerts.
3. **Expand to self-healing** — the RCA agent explains failures and opens fix PRs.

**Our differentiator vs TraceRoot:** they observe the *runtime* agent. Because Causal
also has the MCP/SDK capture at *authoring* time, we can tie a coding agent's
decision → the code it produced → the production outcome. That authoring→outcome
loop is a lane TraceRoot's runtime-only model can't reach, and it's where the
compounding "which agent decisions cause incidents" dataset lives.

---

## 2. Feature parity checklist (match TraceRoot)

- [ ] OpenTelemetry-based SDKs (Python + TypeScript), decorator instrumentation (`@observe`).
- [ ] Ingest endpoint (OTLP/HTTP) → trace store; large payloads to object storage.
- [ ] Trace explorer: nested tree + timeline, span detail (Input/Output, attributes),
      token/cost, **git context** (span → file:line:commit). *(UI already built in the demo.)*
- [ ] Detectors: LLM-as-judge over each trace for hallucination / tool failure /
      intent drift / safety → Slack + email alerts.
- [ ] Agentic RCA: clone repo in a sandbox, correlate failing span to source + git
      history, produce explanation + counterfactual.
- [ ] Automated fix PRs on GitHub (branch, diff, description, checks).
- [ ] Datasets / evals from production findings.
- [ ] Open-source core + self-host + managed cloud.

## 3. Where we improve on TraceRoot (their teardown flagged these)

| TraceRoot weakness | Causal v2 |
|---|---|
| Split Python (FastAPI+Celery) **and** TS (Next+workers) stacks glued by a Node BullMQ queue driven from Python — a fragile seam | **One TypeScript stack** end to end (already a pnpm/turbo TS monorepo). One queue, one language. |
| 4 datastores + 5 services; heavy self-host | **Postgres-first**: pgvector for search, JSONB/partitioned tables for spans. ClickHouse is an *optional* adapter at high volume, not required. Single-process **dev mode**. |
| Stateful, non-scalable agent (in-process `Map` session cache) | **Stateless agent**; session state in Postgres/Redis → horizontally scalable. |
| Core agent loop coupled to a young single-vendor framework ("Pi") | **First-party agent loop** on the Anthropic SDK (+ optional LangGraph, which `apps/rca` already uses). No single-vendor lock-in. |
| Runtime-only; no authoring provenance | Reuse Causal's **MCP + SDK capture** to link authoring decisions → code → incident. |

## 4. System architecture

```
                          ┌────────────────────────────────────────────┐
   your app / agent       │                 Causal                     │
  ┌───────────────┐  OTLP │  ┌───────────┐   enqueue   ┌─────────────┐  │
  │ @causal/sdk   │──HTTP─┼─▶│  ingest   │────────────▶│  detector   │  │
  │ (py / ts)     │       │  │ (Fastify) │   (queue)   │ LLM-as-judge│  │
  └───────────────┘       │  └─────┬─────┘             └──────┬──────┘  │
        │ git context     │        │ write                    │ finding │
        ▼                 │        ▼                          ▼         │
  ┌───────────────┐       │  ┌───────────┐  on failure ┌─────────────┐  │
  │ .causal-      │       │  │ Postgres  │◀────────────│  RCA agent  │  │
  │  session /MCP │       │  │ +pgvector │  read/write │ (sandbox +  │  │
  └───────────────┘       │  │ + object  │             │  git +      │  │
                          │  │   store   │             │  fix PR)    │  │
                          │  └───────────┘             └──────┬──────┘  │
                          │        ▲                          │         │
                          │  ┌─────┴─────┐  Slack/email  ┌────▼──────┐  │
                          │  │  web UI   │◀──alerts──────│  GitHub   │  │
                          │  │ (Next 14) │               │  App (PR) │  │
                          │  └───────────┘               └───────────┘  │
                          └────────────────────────────────────────────┘
```

**Components (mapped to the monorepo):**

- **`@causal/sdk` (TS) + `causal-sdk` (Python)** — extend the existing SDKs into
  OpenTelemetry span exporters. Add an `@observe` decorator, auto-instrumentation
  for common agent frameworks (LangChain/LangGraph, OpenAI/Anthropic SDKs), and
  `git_context` capture. Export OTLP/HTTP straight to the ingest endpoint (no
  collector to run — TraceRoot's one genuinely clean idea; adopt it).
- **Ingest** — a new route group in **`apps/api`** (Fastify): `POST /v1/traces`
  (OTLP), auth by workspace API key (reuse `api_keys`), normalize spans, write to
  Postgres, push large blobs to object storage, enqueue detector jobs.
- **Queue** — Redis (already a plugin) with BullMQ, or Postgres-backed jobs
  (`pg-boss`) for the light path. One language (TS), so no cross-runtime seam.
- **Detector worker** — a new `apps/worker` (TS): consumes jobs, runs a **single
  structured LLM call** (cheap model, forced tool-call verdict) per trace against a
  detector definition, writes findings, fires Slack/email, and on failure enqueues
  RCA. (Reuse the two-tier idea: cheap judge → deep agent.)
- **RCA agent** — a stateless agent service (TS on the Anthropic SDK, or reuse/port
  `apps/rca`'s LangGraph). Tools: GitHub read, git clone into a **Docker sandbox**,
  query traces, propose + open a fix PR. Session state persisted, not in-memory.
- **Web** — **`apps/web`** already renders the product surface (trace tree, span
  detail with git context, detectors, RCA, fix-PR, Causal Copilot). Swap mock data
  for live API calls; keep the mock path as the public demo.

## 5. Data model (Postgres-first)

- `workspaces`, `projects`, `api_keys` — reuse existing tables.
- `traces` — id, project_id, root span name, service, status, tokens_in/out, cost,
  started_at, duration_ms.
- `spans` — id, trace_id, parent_id, name, kind, start_ms, duration_ms, status,
  attributes (JSONB), io (JSONB), git (file/line/commit), error. Partition by
  `started_at`; index `(trace_id)`, `(project_id, started_at)`.
- `detectors` — id, project_id, type, definition/prompt, model, sampling, enabled.
- `findings` — id, trace_id, detector_id, identified, severity, confidence, summary,
  data (JSONB), cost. Index `(project_id, created_at)`.
- `rca_runs` — id, finding_id, status, root_cause (JSONB), commit, explanation,
  counterfactual, fix_pr_url, thread state.
- `snapshots` / object storage — full I/O payloads and context snapshots (reuse S3
  plugin + `snapshot_meta`).
- Vector search on span/finding text via **pgvector** (already provisioned) for
  "similar past failures" — reuse `find_similar_nodes()`.

The current demo's `mock-observability.ts` shapes (spans, findings, root cause, fix
PR) are deliberately the wire shapes the API will emit — the UI won't change when
the backend goes live.

## 6. Tech-stack decisions

- **Language:** TypeScript everywhere (SDK-py stays Python). Kills TraceRoot's
  Python↔TS seam.
- **API/ingest:** Fastify (existing `apps/api`), OTLP/HTTP.
- **Store:** Postgres 16 + pgvector (existing). Object storage via S3/MinIO
  (existing) or Vercel Blob/R2 in prod. **ClickHouse only as an optional high-volume
  adapter.** Neo4j becomes optional — the causal graph can be served from Postgres
  recursive CTEs at this scale (graphs are tiny).
- **Queue:** Redis + BullMQ (heavy) or `pg-boss` (light/dev).
- **LLM:** Anthropic SDK first-party; provider-agnostic adapter + BYOK (encrypted
  per-workspace keys). Cheap model for the judge, stronger model for RCA.
- **Sandbox:** ephemeral Docker container per RCA run for `git clone` + edits.
- **Web:** Next.js 14 (existing).

## 7. Deployment (light by default)

- **Dev:** `docker compose up` → Postgres + Redis + MinIO; `pnpm dev` runs api + worker
  + web. Optionally a single-process mode (`pg-boss`, no Redis) for laptops.
- **Managed demo (live, not mock):** Neon/Supabase (Postgres+pgvector), Upstash
  (Redis), R2/Vercel Blob (objects), Vercel (web + api). Run `seed-demo` against it so
  the deployed demo is real data, with the mock path as the always-works fallback.
- **Self-host:** Helm chart (api, worker, agent, web) + Postgres/Redis/object store.
  Far lighter than TraceRoot's 5-service/4-store footprint.
- **CI:** add GitHub Actions (build, type-check, test) — the repo currently has none.

## 8. Phased build plan

- **Phase 1 — Observability wedge (land):** SDK OTLP export + ingest + trace store +
  the trace explorer on live data. Ship the `@observe` quickstart. *Value on the first
  trace, no incident needed.*
- **Phase 2 — Detectors:** detector worker (LLM-as-judge) + findings + Slack/email
  alerts + the Detectors view.
- **Phase 3 — Self-healing (expand):** RCA agent (sandbox + git) + automated fix PRs +
  the Causal Copilot wired to real analysis.
- **Phase 4 — Authoring loop (differentiate):** tie MCP/SDK authoring capture to
  findings; "this agent decision caused this incident"; datasets/evals; the
  compounding cross-org dataset.
- **Cross-cutting:** managed-infra live demo, CI, first 10 tests (ingest, detector
  verdict parsing, auth, RCA tool contracts).

## 8b. Phase 1 — landed in this repo

The observability wedge (ingest → store → serve traces) is now real code:

- **Schema** — `infra/postgres/migrations/004_traces.sql`: `traces`, `spans`
  (kind/status/attributes/io/git/error, PK `(trace_id, id)`), and `trace_findings`
  (for the Phase-2 detector). Postgres-first, org-scoped, indexed for list-by-org.
- **API** — `apps/api/src/routes/traces.ts` + `services/traces.ts`, registered at
  `/api/v1/traces`:
  - `POST /api/v1/traces` — OTLP-lite ingest (zod-validated `{traceId, service, spans[]}`),
    idempotent per trace id, bulk-inserts spans in a transaction.
  - `GET /api/v1/traces` — recent traces for the org.
  - `GET /api/v1/traces/:id` — a trace with its spans + finding, in the exact
    camelCase shape the web product surface already renders.
- **SDK** — `packages/sdk-typescript/src/tracer.ts` (`CausalTracer`): a
  dependency-free span collector that exports to the ingest endpoint.

  ```ts
  const tracer = new CausalTracer({ service: "booking-agent" });
  await tracer.trace("booking_agent.run", async (t) => {
    const plan = t.span("llm.plan", "llm");
    // ... call the model ...
    plan.end({ status: "ok", io: { input, output } });
  });
  ```

The wire shapes deliberately match `apps/web/src/lib/mock-observability.ts`, so the
web explorer can switch from the mock to `GET /api/v1/traces/:id` with no UI change
once traces are flowing.

**Phase 1.5 — seed:** `apps/api/src/seed-traces.ts` (`pnpm db:seed-traces`) ingests a
failing + a healthy trace and runs the detector/RCA, so the endpoints return live data
locally. Flipping the deployed web demo to live is a config switch (kept on mock by
default so the demo always works).

**Phase 2 — detectors (landed):** `services/detector.ts` — an LLM-as-judge
(`DETECTOR_MODEL`, default Haiku) scores each trace for hallucination / tool_failure /
intent_drift / safety and writes `trace_findings`, with a **heuristic fallback** so it
still fires in demo mode (no API key). Runs inline on ingest when `ENABLE_DETECTORS=1`
(fire-and-forget — no separate worker/queue, our "lighter than TraceRoot" choice), or
via `POST /api/v1/traces/:id/detect`. Fires a Slack alert and (if `ENABLE_AUTO_RCA=1`)
triggers RCA.

**Phase 3 — agentic RCA + fix (landed):** `services/rca.ts` — root cause (explanation +
counterfactual, tied to the failing commit) and a proposed fix diff, via `RCA_MODEL`
(default Sonnet) with a heuristic fallback. Stored in `rca_runs`; `POST/GET
/api/v1/traces/:id/rca`. Opening a real GitHub PR needs a repo→installation mapping
(Octokit client already exists in `services/github.ts`); until wired, the fix is stored
as `proposed`.

**Phase 4 — authoring→outcome link (landed):** `services/provenance.ts` +
`GET /api/v1/traces/:id/provenance` — ties the trace's failing commit back to the
six-layer causal nodes (REASONING/CODE/SPEC/INTENT) that produced it, bridging the new
observability data to the original causal graph.

**Remaining to run in prod:** managed infra + migrations, real Anthropic key (else the
heuristic paths run), a repo→installation mapping to open live PRs, and flipping the web
explorer to the live API.

## 9. Licensing / clean-room note

TraceRoot core is Apache-2.0 (permissive) — we may study it and even reuse code **if
we keep its LICENSE/NOTICE/attribution** in any copied file. Default posture: build
Causal's own implementation. OpenTelemetry is an open standard (free to use). We do
not replicate TraceRoot branding/copy, and we never use their enterprise-licensed
code. Attribution, where any file is reused, lives in source headers/`NOTICE` and is
invisible to product users — branding stays 100% Causal.
