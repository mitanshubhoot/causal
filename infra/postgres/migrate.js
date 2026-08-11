#!/usr/bin/env node
/**
 * Minimal Postgres migration runner.
 *
 * Applies infra/postgres/migrations/*.sql in sorted order against POSTGRES_URL,
 * tracking applied files in a schema_migrations table so it is safe to re-run
 * against an existing database (the compose initdb mount only runs on first
 * boot of a fresh volume).
 *
 * Usage: node infra/postgres/migrate.js   (or `pnpm db:migrate`)
 *
 * Note: 002_timescale.sql only does `CREATE EXTENSION timescaledb` and is
 * skipped automatically when the extension is unavailable (e.g. Neon/Supabase),
 * since nothing depends on a hypertable (the conversion is commented out).
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

const url =
  process.env.POSTGRES_URL ??
  "postgres://causal:causal_dev_password@localhost:5433/causal";

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`• skip   ${file} (already applied)`);
      continue;
    }
    const ddl = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await sql.unsafe(ddl);
      await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      console.log(`✓ apply  ${file}`);
      ran++;
    } catch (err) {
      const msg = String(err?.message ?? err);
      // TimescaleDB is optional — don't fail the whole run when it's absent.
      if (file.includes("timescale") && /timescaledb/i.test(msg)) {
        console.warn(`⚠ skip   ${file} (timescaledb unavailable: ${msg.split("\n")[0]})`);
        await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
        continue;
      }
      console.error(`✗ failed ${file}: ${msg}`);
      throw err;
    }
  }

  console.log(ran ? `\nDone — applied ${ran} migration(s).` : "\nDatabase already up to date.");
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    await sql.end();
    console.error(err);
    process.exit(1);
  });
