/**
 * Embeddings service — OpenAI text-embedding-3-small
 * 1536 dims, $0.02/1M tokens, populated async after node creation.
 */

import OpenAI from "openai";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return openaiClient;
}

export async function embedText(text: string): Promise<number[]> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000),   // truncate to safe input length
    dimensions: 1536,
  });
  return response.data[0]!.embedding;
}

export async function populateNodeEmbedding(
  fastify: FastifyInstance,
  nodeId: string
): Promise<void> {
  if (!config.ENABLE_VECTOR_EMBEDDINGS || !config.OPENAI_API_KEY) return;

  const rows = await fastify.pg`
    SELECT payload_text FROM causal_nodes WHERE id = ${nodeId} AND embedding IS NULL
  ` as Array<{ payload_text: string | null }>;

  if (!rows.length || !rows[0]?.payload_text) return;

  try {
    const embedding = await embedText(rows[0].payload_text);
    await fastify.pg`
      UPDATE causal_nodes SET embedding = ${JSON.stringify(embedding)}::vector WHERE id = ${nodeId}
    `;
  } catch (err) {
    fastify.log.warn({ nodeId, err }, "Failed to populate embedding");
  }
}

// ── Async batch embedding job (called from queue) ─────────────────
export async function batchPopulateEmbeddings(
  fastify: FastifyInstance,
  limit = 50
): Promise<number> {
  if (!config.ENABLE_VECTOR_EMBEDDINGS) return 0;

  const rows = await fastify.pg`
    SELECT id, payload_text FROM causal_nodes
    WHERE embedding IS NULL AND payload_text IS NOT NULL
    ORDER BY created_at ASC
    LIMIT ${limit}
  ` as Array<{ id: string; payload_text: string }>;

  let count = 0;
  for (const row of rows) {
    try {
      await populateNodeEmbedding(fastify, row.id);
      count++;
    } catch {
      // Continue on individual failures
    }
  }

  return count;
}
