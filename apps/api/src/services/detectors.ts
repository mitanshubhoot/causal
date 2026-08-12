import type { FastifyInstance } from "fastify";

/** Detector definitions for an org, with finding/run counts. */
export async function listDetectors(fastify: FastifyInstance, orgId: string): Promise<Array<Record<string, unknown>>> {
  const rows = (await fastify.pg`
    SELECT d.id, d.name, d.type, d.description, d.enabled,
           -- DISTINCT is required: joining findings AND runs on the same
           -- detector fans out, so a plain COUNT multiplies findings by the
           -- number of runs (3 findings x 200 runs reported 600).
           COUNT(DISTINCT f.id) FILTER (WHERE f.resolved_at IS NULL) AS open_findings,
           COUNT(DISTINCT f.id) AS total_findings,
           COUNT(DISTINCT r.id) AS total_runs
    FROM detectors d
    LEFT JOIN trace_findings f ON f.detector_id = d.id
    LEFT JOIN detector_runs   r ON r.detector_id = d.id
    WHERE d.org_id = ${orgId}
    GROUP BY d.id
    ORDER BY d.name ASC
  `) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r["id"],
    name: r["name"],
    type: r["type"],
    description: r["description"],
    enabled: r["enabled"],
    openFindings: Number(r["open_findings"]),
    totalFindings: Number(r["total_findings"]),
    totalRuns: Number(r["total_runs"]),
  }));
}

/** One detector with its findings history and run history. */
export async function getDetector(fastify: FastifyInstance, orgId: string, name: string): Promise<Record<string, unknown> | null> {
  const rows = (await fastify.pg`
    SELECT id, name, type, description, enabled FROM detectors
    WHERE org_id = ${orgId} AND name = ${name} LIMIT 1
  `) as Array<Record<string, unknown>>;
  const d = rows[0];
  if (!d) return null;

  const findings = (await fastify.pg`
    SELECT f.id, f.trace_id, f.title, f.severity, f.confidence, f.summary, f.created_at, f.resolved_at,
           t.service
    FROM trace_findings f
    LEFT JOIN traces t ON t.id = f.trace_id AND t.org_id = f.org_id
    WHERE f.org_id = ${orgId} AND f.detector_id = ${d["id"] as string}
    ORDER BY f.created_at DESC
    LIMIT 100
  `) as Array<Record<string, unknown>>;

  const runs = (await fastify.pg`
    SELECT r.id, r.trace_id, r.identified, r.judge_model, r.created_at, t.service
    FROM detector_runs r
    LEFT JOIN traces t ON t.id = r.trace_id AND t.org_id = r.org_id
    WHERE r.org_id = ${orgId} AND r.detector_id = ${d["id"] as string}
    ORDER BY r.created_at DESC
    LIMIT 200
  `) as Array<Record<string, unknown>>;

  return {
    id: d["id"],
    name: d["name"],
    type: d["type"],
    description: d["description"],
    enabled: d["enabled"],
    findings: findings.map((f) => ({
      findingId: f["id"],
      traceId: f["trace_id"],
      title: f["title"],
      severity: f["severity"],
      confidence: Number(f["confidence"]),
      summary: f["summary"],
      service: f["service"],
      timestamp: f["created_at"],
      resolved: f["resolved_at"] !== null,
    })),
    runs: runs.map((r) => ({
      traceId: r["trace_id"],
      identified: r["identified"],
      judgeModel: r["judge_model"],
      service: r["service"],
      timestamp: r["created_at"],
    })),
  };
}

/** Org-wide findings feed (dashboard). */
export async function listFindings(fastify: FastifyInstance, orgId: string, limit = 100): Promise<Array<Record<string, unknown>>> {
  const rows = (await fastify.pg`
    SELECT f.id, f.trace_id, f.detector, f.title, f.severity, f.confidence, f.summary,
           f.created_at, f.resolved_at, t.service
    FROM trace_findings f
    LEFT JOIN traces t ON t.id = f.trace_id AND t.org_id = f.org_id
    WHERE f.org_id = ${orgId}
    ORDER BY f.created_at DESC
    LIMIT ${limit}
  `) as Array<Record<string, unknown>>;
  return rows.map((f) => ({
    findingId: f["id"],
    traceId: f["trace_id"],
    detector: f["detector"],
    title: f["title"],
    severity: f["severity"],
    confidence: Number(f["confidence"]),
    summary: f["summary"],
    service: f["service"],
    timestamp: f["created_at"],
    resolved: f["resolved_at"] !== null,
  }));
}

/** Mark a finding resolved (or reopen it). */
export async function resolveFinding(fastify: FastifyInstance, orgId: string, findingId: string, resolved: boolean): Promise<boolean> {
  const rows = (await fastify.pg`
    UPDATE trace_findings SET resolved_at = ${resolved ? new Date() : null}
    WHERE id = ${findingId} AND org_id = ${orgId}
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}
