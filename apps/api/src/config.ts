import { z } from "zod";

// z.coerce.boolean() coerces ANY non-empty string (including "false") to true,
// so a flag could never be turned off via env. This parses real booleans.
const boolEnv = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === "") return def;
    if (typeof v === "boolean") return v;
    return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
  }, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default("0.0.0.0"),

  // Neo4j
  NEO4J_URI: z.string().default("bolt://localhost:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().default("causal_dev_password"),

  // Postgres — host port 5433 matches docker-compose.yml's "5433:5432" mapping
  // and seed-demo.ts's default, so the API, seed, and compose all agree.
  POSTGRES_URL: z.string().default("postgres://causal:causal_dev_password@localhost:5433/causal"),

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
  DATADOG_WEBHOOK_SECRET: z.string().optional(),
  LINEAR_WEBHOOK_SECRET: z.string().optional(),
  LANGSMITH_WEBHOOK_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  // Services
  RCA_SERVICE_URL: z.string().default("http://localhost:8001"),
  APP_URL: z.string().default("http://localhost:3000"),

  // Feature flags
  ENABLE_VECTOR_EMBEDDINGS: boolEnv(false),
  ENABLE_SLACK_NOTIFICATIONS: boolEnv(true),
  MIN_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.5),

  // v2 observability — detectors + agentic RCA
  ENABLE_DETECTORS: boolEnv(false),      // run the LLM-as-judge on ingest
  ENABLE_AUTO_RCA: boolEnv(false),       // auto-run RCA when a detector fires
  DETECTOR_MODEL: z.string().default("claude-haiku-4-5"),
  RCA_MODEL: z.string().default("claude-sonnet-4-5"),
  COPILOT_MODEL: z.string().default("claude-sonnet-4-5"),
  SLACK_INCIDENT_CHANNEL: z.string().optional(),

  // Email alerting (Resend or SendGrid — whichever key is present)
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  ALERT_EMAIL_TO: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().default("alerts@causal.dev"),
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
