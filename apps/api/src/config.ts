import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default("0.0.0.0"),

  // Neo4j
  NEO4J_URI: z.string().default("bolt://localhost:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("causal_dev_password"),

  // Postgres (matches docker-compose.yml)
  POSTGRES_URL: z.string().default("postgres://causal:causal_dev_password@localhost:5432/causal"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // S3 / MinIO (matches docker-compose.yml)
  S3_BUCKET: z.string().default("causal-snapshots"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_ACCESS_KEY_ID: z.string().default("minioadmin"),
  S3_SECRET_ACCESS_KEY: z.string().default("minioadmin"),

  // LLMs
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().optional(),

  // Auth (Clerk)
  CLERK_SECRET_KEY: z.string().optional(),

  // GitHub App
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Integrations
  PAGERDUTY_WEBHOOK_SECRET: z.string().optional(),
  SENTRY_WEBHOOK_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // Services
  RCA_SERVICE_URL: z.string().default("http://localhost:8001"),
  APP_URL: z.string().default("http://localhost:3000"),

  // Feature flags
  ENABLE_VECTOR_EMBEDDINGS: z.coerce.boolean().default(false),
  ENABLE_SLACK_NOTIFICATIONS: z.coerce.boolean().default(true),
  MIN_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.5),
});

function loadConfig() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    // In dev mode, warn but don't crash — defaults will be used
    if (process.env["NODE_ENV"] !== "production") {
      console.warn(`⚠️  Missing env vars (using defaults): ${missing}`);
      // Re-parse with defaults filled in
      return EnvSchema.parse({
        ...Object.fromEntries(
          result.error.issues.map((i) => [i.path.join("."), undefined])
        ),
        ...process.env,
      });
    }
    throw new Error(`Missing or invalid environment variables: ${missing}`);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
