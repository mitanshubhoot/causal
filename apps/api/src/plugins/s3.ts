import fp from "fastify-plugin";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "crypto";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import type { ContextSnapshot } from "@causal/types";

export interface S3Service {
  uploadSnapshot(snapshot: ContextSnapshot): Promise<{ key: string; contentHash: string }>;
  getSnapshot(key: string): Promise<ContextSnapshot>;
  deleteSnapshot(key: string): Promise<void>;
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  snapshotExists(key: string): Promise<boolean>;
}

declare module "fastify" {
  interface FastifyInstance {
    s3: S3Service;
  }
}

const s3Plugin: FastifyPluginAsync = async (fastify) => {
  const client = new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!config.S3_ENDPOINT,  // required for MinIO
  });

  const bucket = config.S3_BUCKET;

  function snapshotKey(snapshotId: string): string {
    // Partition by first 4 chars for S3 prefix optimization
    return `snapshots/${snapshotId.slice(0, 4)}/${snapshotId}.json`;
  }

  async function uploadSnapshot(
    snapshot: ContextSnapshot
  ): Promise<{ key: string; contentHash: string }> {
    const body = JSON.stringify(snapshot);
    const contentHash = createHash("sha256").update(body).digest("hex");

    const snapshotWithHash = { ...snapshot, contentHash };
    const finalBody = JSON.stringify(snapshotWithHash);
    const key = snapshotKey(snapshot.snapshotId);

    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: finalBody,
        ContentType: "application/json",
        Metadata: {
          nodeId: snapshot.nodeId,
          modelId: snapshot.modelId,
          contentHash,
        },
      },
    });

    await upload.done();
    return { key, contentHash };
  }

  async function getSnapshot(key: string): Promise<ContextSnapshot> {
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    if (!res.Body) throw new Error(`Empty S3 response for key: ${key}`);

    const body = await res.Body.transformToString();
    const snapshot = JSON.parse(body) as ContextSnapshot;

    // Verify integrity
    const { contentHash, ...rest } = snapshot;
    const computed = createHash("sha256")
      .update(JSON.stringify({ ...rest, contentHash }))
      .digest("hex");

    if (computed !== contentHash) {
      fastify.log.warn({ key, expected: contentHash, computed }, "Snapshot integrity check failed");
    }

    return snapshot;
  }

  async function deleteSnapshot(key: string): Promise<void> {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn }
    );
  }

  async function snapshotExists(key: string): Promise<boolean> {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  fastify.decorate("s3", {
    uploadSnapshot,
    getSnapshot,
    deleteSnapshot,
    getPresignedUrl,
    snapshotExists,
  });
};

export default fp(s3Plugin, { name: "s3" });
