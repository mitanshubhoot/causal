import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listDatasets, createDataset, getDataset, addItem, deleteItem, promoteFinding,
} from "../services/datasets.js";
import { runEval, getEvalRun, listEvalRuns } from "../services/evals.js";

/**
 * Datasets & Evals — the loop that turns firefighting into a repeatable process:
 * a confirmed finding becomes a golden case, and every release is re-run against
 * the whole set so a fix is verified and a regression can't come back unnoticed.
 */

const CreateDatasetSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

// A golden case's input is opaque JSON (object, array, or plain text), but it
// must actually be there: a bare `z.unknown()` field is optional in zod, so
// POSTing `{}` used to file an empty case with no input into the dataset.
const nonEmptyJson = (v: unknown): boolean => {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
};

const AddItemSchema = z.object({
  input: z.unknown().refine(nonEmptyJson, "input is required"),
  expected: z.unknown().optional(),
  spanSignature: z.string().max(300).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  traceId: z.string().nullable().optional(),
  findingId: z.string().uuid().nullable().optional(),
});

// datasets/dataset_items/eval_runs ids are all uuid columns. Feeding Postgres a
// non-uuid raises 22P02, which surfaces to the client as a 500 — a malformed id
// is a 404 (or a 400 in a body), never a server error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string | null | undefined): boolean => !!value && UUID_RE.test(value);

const datasetsPlugin: FastifyPluginAsync = async (fastify) => {
  // ── Datasets ──────────────────────────────────────────────────────
  fastify.get("/datasets", async (request) => {
    const { orgId } = request.authUser;
    const datasets = await listDatasets(fastify, orgId);
    return { datasets, count: datasets.length };
  });

  fastify.post<{ Body: unknown }>("/datasets", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot create datasets");
    const parsed = CreateDatasetSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(parsed.error.issues[0]?.message ?? "invalid body");
    const dataset = await createDataset(fastify, orgId, {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    });
    return reply.code(201).send(dataset);
  });

  fastify.get<{ Params: { id: string } }>("/datasets/:id", async (request, reply) => {
    const { orgId } = request.authUser;
    if (!isUuid(request.params.id)) return reply.notFound("Dataset not found");
    const dataset = await getDataset(fastify, orgId, request.params.id);
    if (!dataset) return reply.notFound("Dataset not found");
    return dataset;
  });

  // ── Golden cases ──────────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: unknown }>("/datasets/:id/items", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot add cases");
    if (!isUuid(request.params.id)) return reply.notFound("Dataset not found");
    const parsed = AddItemSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(parsed.error.issues[0]?.message ?? "invalid body");
    const item = await addItem(fastify, orgId, request.params.id, parsed.data as never);
    if (!item) return reply.notFound("Dataset not found");
    return reply.code(201).send(item);
  });

  fastify.delete<{ Params: { id: string; itemId: string } }>("/datasets/:id/items/:itemId", async (request, reply) => {
    const { orgId, role } = request.authUser;
    if (role === "viewer") return reply.forbidden("Read-only credentials cannot delete cases");
    if (!isUuid(request.params.id) || !isUuid(request.params.itemId)) return reply.notFound("Case not found");
    const ok = await deleteItem(fastify, orgId, request.params.id, request.params.itemId);
    if (!ok) return reply.notFound("Case not found");
    return { itemId: request.params.itemId, deleted: true };
  });

  // THE ONE-CLICK PATH: a production finding becomes a golden case.
  fastify.post<{ Params: { id: string }; Body: { datasetId?: string | null } }>(
    "/findings/:id/promote",
    async (request, reply) => {
      const { orgId, role } = request.authUser;
      if (role === "viewer") return reply.forbidden("Read-only credentials cannot promote findings");
      if (!isUuid(request.params.id)) return reply.notFound("Finding not found");
      const datasetId = (request.body ?? {}).datasetId ?? null;
      if (datasetId !== null && !isUuid(datasetId)) return reply.badRequest("datasetId must be a uuid");
      const result = await promoteFinding(fastify, orgId, {
        findingId: request.params.id,
        datasetId,
      });
      if (!result) return reply.notFound("Finding not found");
      return reply.code(result.created ? 201 : 200).send(result);
    }
  );

  // ── Eval runs ─────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { name?: string | null } }>(
    "/datasets/:id/evals",
    async (request, reply) => {
      const { orgId, role } = request.authUser;
      if (role === "viewer") return reply.forbidden("Read-only credentials cannot start eval runs");
      if (!isUuid(request.params.id)) return reply.notFound("Dataset not found");
      const run = await runEval(fastify, orgId, {
        datasetId: request.params.id,
        name: (request.body ?? {}).name ?? null,
      });
      if (!run) return reply.notFound("Dataset not found");
      return reply.code(201).send(run);
    }
  );

  fastify.get<{ Querystring: { datasetId?: string; limit?: string } }>("/evals", async (request) => {
    const { orgId } = request.authUser;
    const limit = Math.min(Number(request.query.limit) || 100, 500);
    const datasetId = request.query.datasetId;
    // An unknown/garbage dataset filter has no runs — that's an empty list, not a crash.
    if (datasetId && !isUuid(datasetId)) return { runs: [], count: 0 };
    const runs = await listEvalRuns(fastify, orgId, datasetId ?? null, limit);
    return { runs, count: runs.length };
  });

  fastify.get<{ Params: { id: string } }>("/evals/:id", async (request, reply) => {
    const { orgId } = request.authUser;
    if (!isUuid(request.params.id)) return reply.notFound("Eval run not found");
    const run = await getEvalRun(fastify, orgId, request.params.id);
    if (!run) return reply.notFound("Eval run not found");
    return run;
  });
};

export default datasetsPlugin;
