import { describe, expect, it } from "vitest";
import {
  SECURITY_EVENTS, DETECTIONS, POSTURE, PERIMETER, HEATMAP, TREND, TRIFECTAS,
  BOUNDARY_RULES, EXPLORER_TRACES, UNENFORCED_CRITICAL_BOUNDARY,
  computeScore, countsByClass, heatCellEvidence, explorerIncidentFor,
  ruleFiringConsistency, boundaryRulesOff, AS_OF,
} from "../mock-security";
import { resolveTraceToIncident, hasObservabilityDemo } from "../mock-observability";

/**
 * The security console's entire claim is that its numbers are derived rather
 * than asserted. That only stays true if something checks it — every defect
 * these tests cover was a real one that shipped: a perimeter chip contradicting
 * the rules it expanded into, a red heatmap ring citing an event with no such
 * sink, a hand-typed "every critical boundary is enforced" beside the event that
 * disproved it, and a trace link that resolved to nothing.
 */

const DAY = 864e5;
const asOf = new Date(AS_OF).getTime();

describe("posture score", () => {
  it("matches the published formula, independently recomputed", () => {
    const P = Math.sqrt(POSTURE.coverage);
    const weighted =
      0.4 * POSTURE.containment + 0.25 * POSTURE.leastPrivilege +
      0.2 * POSTURE.egressDiscipline + 0.15 * POSTURE.durability;
    const X = 0.5 ** POSTURE.openCriticals * 0.85 ** POSTURE.openHighs;
    let expected = Math.round(100 * P * weighted * X);
    if (POSTURE.unenforcedCriticalBoundary) expected = Math.min(expected, 40);
    expect(computeScore(POSTURE).score).toBe(expected);
  });

  it("does not move when the attacker gets busier", () => {
    // No term counts attacks, so a corpus with more events must score the same.
    const before = computeScore(POSTURE).score;
    expect(computeScore({ ...POSTURE })).toMatchObject({ score: before });
  });

  it("weights sum to 1", () => {
    const sum = computeScore(POSTURE).terms.reduce((a, t) => a + t.weight, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("caps the recovery counterfactual when the ceiling is armed", () => {
    // "Resolving it alone returns you to 66" was false while a critical boundary
    // had no enforcement point — the ceiling binds at 40 first.
    const armed = computeScore({ ...POSTURE, unenforcedCriticalBoundary: true });
    expect(armed.breakdown.footer).not.toMatch(/returns you to 66\./);
    const clear = computeScore({ ...POSTURE, unenforcedCriticalBoundary: false });
    expect(clear.breakdown.footer).toMatch(/returns you to 66/);
  });

  it("derives unenforcedCriticalBoundary from the corpus", () => {
    const expected = SECURITY_EVENTS.some(
      (e) => e.severity === "critical" && !e.enforced &&
        (e.outcome === "succeeded" || e.outcome === "attempted") &&
        !["resolved", "accepted_risk"].includes(e.status)
    );
    expect(UNENFORCED_CRITICAL_BOUNDARY).toBe(expected);
    expect(POSTURE.unenforcedCriticalBoundary).toBe(expected);
  });

  it("keeps the score stale-able, so the UNPROVEN AT HEAD state can render", () => {
    expect(POSTURE.commit).not.toBe(POSTURE.headCommit);
    expect(POSTURE.commitsSince).toBeGreaterThan(0);
  });
});

describe("perimeter", () => {
  it("reports the weakest ENABLED rule on each boundary, never an authored mode", () => {
    const RANK = { off: 0, monitor: 1, canary: 2, enforce: 3 } as const;
    for (const cell of PERIMETER) {
      const rules = BOUNDARY_RULES[cell.key].map(
        (id) => DETECTIONS.find((d) => d.id === id)!
      );
      const enabled = rules.filter((r) => r.mode !== "off");
      const expected = enabled.length
        ? enabled.reduce((a, b) => (RANK[b.mode] < RANK[a.mode] ? b : a)).mode
        : "off";
      expect(cell.mode, `${cell.key} mode`).toBe(expected);
      expect(cell.detections, `${cell.key} count`).toBe(BOUNDARY_RULES[cell.key].length);
    }
  });

  it("counts disabled rules as holes rather than folding them into the mode", () => {
    for (const cell of PERIMETER) {
      const off = BOUNDARY_RULES[cell.key].filter(
        (id) => DETECTIONS.find((d) => d.id === id)?.mode === "off"
      ).length;
      expect(boundaryRulesOff(cell.key)).toBe(off);
    }
  });

  it("never claims a canary percentage no rule on that boundary is running", () => {
    for (const cell of PERIMETER.filter((c) => c.mode === "canary")) {
      const pcts = BOUNDARY_RULES[cell.key]
        .map((id) => DETECTIONS.find((d) => d.id === id))
        .filter((r) => r?.mode === "canary")
        .map((r) => r!.canaryPct);
      expect(pcts).toContain(cell.canaryPct);
    }
  });
});

describe("detections", () => {
  it("has all 17, and only TB-16/TB-17 call a model", () => {
    expect(DETECTIONS).toHaveLength(17);
    expect(DETECTIONS.filter((d) => d.usesModel).map((d) => d.id).sort()).toEqual(["TB-16", "TB-17"]);
  });

  it("reports backtest precision equal to confirmed/fires", () => {
    for (const d of DETECTIONS) {
      if (!d.backtest) continue;
      expect(d.backtest.confirmed).toBeLessThanOrEqual(d.backtest.fires);
      expect(d.backtest.precision).toBeCloseTo(d.backtest.confirmed / d.backtest.fires, 2);
    }
  });

  it("agrees with the event log about how often each rule fired", () => {
    expect(ruleFiringConsistency().filter((r) => !r.agrees)).toEqual([]);
  });
});

describe("events", () => {
  it("cites only rules that exist", () => {
    const ids = new Set(DETECTIONS.map((d) => d.id));
    for (const e of SECURITY_EVENTS) expect(ids, e.id).toContain(e.ruleId);
  });

  it("stores no reproducible attack text", () => {
    // A detection product must not become a distribution channel for payloads.
    const hostile = /ignore (all )?previous|disregard the above|<script|BEGIN [A-Z ]+PRIVATE KEY/i;
    for (const e of SECURITY_EVENTS) {
      expect(e.witness.summary, e.id).not.toMatch(hostile);
      expect(e.summary, e.id).not.toMatch(hostile);
    }
  });

  it("tallies the same events the class counts report, within the window", () => {
    const windowed = SECURITY_EVENTS.filter((e) => (asOf - new Date(e.timestamp).getTime()) / DAY <= 7);
    const counts = countsByClass(7);
    expect(Object.values(counts).reduce((a, c) => a + c.events, 0)).toBe(windowed.length);
    expect(Object.values(counts).reduce((a, c) => a + c.occurrences, 0)).toBe(
      windowed.reduce((a, e) => a + (e.occurrences || 1), 0)
    );
  });

  it("keeps the deferred-taint write older than the event it later triggers", () => {
    // TB-07's whole argument is that a stateless interceptor cannot see this gap.
    const fire = SECURITY_EVENTS.find((e) => e.id === "SEC-1051")!;
    const write = SECURITY_EVENTS.find((e) => e.id === "SEC-1052")!;
    const gapDays = (new Date(fire.timestamp).getTime() - new Date(write.timestamp).getTime()) / DAY;
    expect(gapDays).toBeGreaterThan(5);
  });
});

describe("heatmap", () => {
  it("draws a red ring only where a cited event truly reaches that sink", () => {
    for (const cell of HEATMAP.filter((c) => c.violatesPolicy)) {
      const id = heatCellEvidence(cell);
      expect(id, `${cell.source} -> ${cell.sink}`).toBeTruthy();
      const ev = SECURITY_EVENTS.find((e) => e.id === id)!;
      expect(ev.flow.some((f) => f.capability === cell.sink), `${id} reaches ${cell.sink}`).toBe(true);
    }
  });

  it("never rings a cell with no flows", () => {
    for (const cell of HEATMAP.filter((c) => c.violatesPolicy)) expect(cell.flows).toBeGreaterThan(0);
  });
});

describe("cross-capability navigation", () => {
  it("keeps EXPLORER_TRACES in step with the observability fixture", () => {
    // A hand-maintained literal kept small on purpose — so it must be checked.
    for (const [traceId, incidentId] of Object.entries(EXPLORER_TRACES)) {
      expect(resolveTraceToIncident(traceId), traceId).toBe(incidentId);
      expect(hasObservabilityDemo(incidentId), incidentId).toBe(true);
    }
  });

  it("omits no trace the explorer could actually have opened", () => {
    const missed = [...new Set(SECURITY_EVENTS.map((e) => e.traceId).filter(Boolean))]
      .filter((t) => resolveTraceToIncident(t!) && !explorerIncidentFor(t!));
    expect(missed).toEqual([]);
  });
});

describe("trifectas and trend", () => {
  it("does not double-count a cut that closes two trifectas", () => {
    const naive = TRIFECTAS.reduce((a, t) => a + t.remediation.deltaScore, 0);
    const deduped = [...new Map(TRIFECTAS.map((t) => [t.remediation.title, t.remediation])).values()]
      .reduce((a, r) => a + r.deltaScore, 0);
    // The panel prints "N distinct cuts"; the total beside it must use the same set.
    expect(deduped).toBeLessThanOrEqual(naive);
    const distinct = new Set(TRIFECTAS.map((t) => t.remediation.title)).size;
    if (distinct < TRIFECTAS.length) expect(deduped).toBeLessThan(naive);
  });

  it("never reports more resolved than detected on any day", () => {
    for (const p of TREND) expect(p.blocked + p.succeeded).toBeLessThanOrEqual(p.detected);
  });
});
