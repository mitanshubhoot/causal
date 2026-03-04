import { uuidv7 } from "uuidv7";
import type { FastifyPluginAsync } from "fastify";
import { ContextSnapshotSchema } from "@causal/types";

const snapshotsPlugin: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/snapshots — upload a context snapshot
  fastify.post("/", async (request, reply) => {
    const { orgId } = request.authUser;
    const snapshot = ContextSnapshotSchema.parse(request.body);

    // Verify the node belongs to this org
    const nodeRows = await fastify.pg`
      SELECT id FROM causal_nodes WHERE id = ${snapshot.nodeId} AND org_id = ${orgId}
    ` as Array<{ id: string }>;

    if (!nodeRows.length) {
      return reply.notFound(`Node ${snapshot.nodeId} not found`);
    }

    // Upload to S3
    const { key, contentHash } = await fastify.s3.uploadSnapshot(snapshot);

    // Store metadata in Postgres
    await fastify.pg`
      INSERT INTO snapshot_meta (
        snapshot_id, node_id, org_id, s3_key, content_hash,
        model_id, token_count, decision_type, timestamp
      ) VALUES (
        ${snapshot.snapshotId},
        ${snapshot.nodeId},
        ${orgId},
        ${key},
        ${contentHash},
        ${snapshot.modelId},
        ${snapshot.tokenCount ?? null},
        ${snapshot.decisionType},
        ${new Date(snapshot.timestamp)}
      )
      ON CONFLICT (snapshot_id) DO NOTHING
    `;

    // Update the REASONING node's contextSnapId if not already set
    await fastify.neo4j.run(
      `MATCH (n:CausalNode {id: $nodeId, orgId: $orgId})
       WHERE n.contextSnapId IS NULL
       SET n.contextSnapId = $snapshotId`,
      { nodeId: snapshot.nodeId, orgId, snapshotId: snapshot.snapshotId }
    );

    return reply.code(201).send({
      snapshotId: snapshot.snapshotId,
      key,
      contentHash,
    });
  });

  // GET /api/v1/snapshots/:id
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const metaRows = await fastify.pg`
      SELECT s.s3_key FROM snapshot_meta s
      WHERE s.snapshot_id = ${request.params.id}
        AND s.org_id = ${request.authUser.orgId}
    ` as Array<{ s3_key: string }>;

    if (!metaRows.length) return reply.notFound();
    const snapshot = await fastify.s3.getSnapshot(metaRows[0]!.s3_key);
    return snapshot;
  });
};

export default snapshotsPlugin;
