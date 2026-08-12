/**
 * A tiny stand-in for `fastify.pg` (porsager/postgres).
 *
 * The service layer talks to Postgres exclusively through the tagged-template
 * API, so a callable object that records what it was asked to run — and hands
 * back fixture rows — is enough to test the pure logic (status rollup, span
 * economics, verdict coercion) without a database.
 *
 * It supports the three call shapes the services actually use:
 *   sql`SELECT ...`                 → tagged template, resolves to fixture rows
 *   sql(rows, ...columns)           → porsager's bulk-insert helper
 *   sql.json(value) / sql.begin(fn) → jsonb wrapper / transaction
 */
import type { FastifyInstance } from "fastify";

export type Row = Record<string, unknown>;

/** One query the code under test asked us to run. */
export interface RecordedQuery {
  /** The SQL with every `${}` interpolation replaced by `?`. */
  text: string;
  /** The interpolated values, in order. */
  values: unknown[];
}

/** Marker returned by `sql.json(v)` — porsager sends this as jsonb. */
export interface JsonValue {
  readonly __json: unknown;
}

/** Marker returned by `sql(rows, ...columns)` — porsager's bulk insert. */
export interface BulkValue {
  readonly __bulk: Row[];
  readonly __columns: string[];
}

/** Decide which fixture rows a query resolves to. Return `[]` for writes. */
export type Responder = (query: RecordedQuery) => Row[];

export interface PgStub {
  /** The `fastify.pg` replacement. */
  sql: FastifyInstance["pg"];
  /** Every query, in the order it was issued. */
  queries: RecordedQuery[];
  /** First query whose text matches `pattern`. */
  find(pattern: RegExp): RecordedQuery | undefined;
  /** All queries whose text matches `pattern`. */
  findAll(pattern: RegExp): RecordedQuery[];
  /**
   * Column → value map for the first `INSERT INTO <table>` recorded. Relies on
   * the INSERT listing its columns and one `?` placeholder per column, which is
   * how every write in the service layer is written.
   */
  insertInto(table: string): Row | undefined;
}

const isTemplate = (v: unknown): v is TemplateStringsArray =>
  Array.isArray(v) && Array.isArray((v as unknown as { raw?: unknown }).raw);

export const isJson = (v: unknown): v is JsonValue =>
  typeof v === "object" && v !== null && "__json" in v;

export const isBulk = (v: unknown): v is BulkValue =>
  typeof v === "object" && v !== null && "__bulk" in v;

/** Unwrap a `sql.json()` marker back to the value that was wrapped. */
export function unwrapJson(v: unknown): unknown {
  return isJson(v) ? v.__json : v;
}

export function createPgStub(respond: Responder = () => []): PgStub {
  const queries: RecordedQuery[] = [];

  function sql(first: unknown, ...rest: unknown[]): unknown {
    if (isTemplate(first)) {
      const query: RecordedQuery = { text: first.raw.join("?"), values: rest };
      queries.push(query);
      return Promise.resolve(respond(query));
    }
    // sql(rows, ...columns) — bulk insert helper.
    return { __bulk: first as Row[], __columns: rest as string[] } satisfies BulkValue;
  }

  sql.json = (value: unknown): JsonValue => ({ __json: value });
  sql.begin = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(sql);

  const find = (pattern: RegExp): RecordedQuery | undefined => queries.find((q) => pattern.test(q.text));
  const findAll = (pattern: RegExp): RecordedQuery[] => queries.filter((q) => pattern.test(q.text));

  return {
    sql: sql as unknown as FastifyInstance["pg"],
    queries,
    find,
    findAll,
    insertInto(table: string): Row | undefined {
      const q = find(new RegExp(`INSERT INTO ${table}\\b`, "i"));
      if (!q) return undefined;
      const cols = /\(([^)]*)\)\s*VALUES/i.exec(q.text)?.[1];
      if (!cols) return undefined;
      const names = cols.split(",").map((c) => c.trim());
      // Only zip when every column is interpolated; a literal in the VALUES
      // list (e.g. `false`) would silently shift the mapping.
      if (names.length !== q.values.length) return undefined;
      const row: Row = {};
      names.forEach((name, i) => {
        row[name] = q.values[i];
      });
      return row;
    },
  };
}

/** A `FastifyInstance` with just the surface the services touch. */
export function createFastifyStub(respond?: Responder): { fastify: FastifyInstance; pg: PgStub } {
  const pg = createPgStub(respond);
  const noop = (): void => {};
  const fastify = {
    pg: pg.sql,
    log: { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop },
  } as unknown as FastifyInstance;
  return { fastify, pg };
}
