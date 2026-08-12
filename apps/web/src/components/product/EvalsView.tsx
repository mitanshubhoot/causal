"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDatasets, getRuns,
  type Dataset, type DatasetItem, type EvalRun, type EvalResult, type CaseAssertion,
} from "@/lib/mock-evals";
import {
  LIVE_TRACES, fetchDatasets, fetchDataset, fetchEvalRuns, fetchEvalRun,
  type LiveDatasetDetail, type LiveDatasetItem, type LiveEvalResult, type LiveEvalRun,
} from "@/lib/traces-api";
import { MonoLabel, CopyButton } from "./ui";
import {
  Database, ChevronRight, ChevronLeft, Check, X, TrendingUp, TrendingDown,
  Minus, Play, Clock, DollarSign, GitCommit, Gavel, Target, ArrowUpRight,
} from "lucide-react";

/**
 * Datasets & Evals.
 *
 * Three levels, mirroring how the trace explorer drills down:
 *   datasets  → a run's cases → one case's assertions
 * Every claim is backed by the same evidence a trace is: which assertion
 * failed and why, what the agent actually produced, the judge's reasoning,
 * latency and cost, and how the case has behaved release over release.
 */

/**
 * The demo types promise a number for every measurement. A live run may not
 * have one — an unfinished run has no duration, and the harness reports a cost
 * it did not measure as null — so the view widens both and renders the gap as
 * "—". A fabricated $0.0000 would read as a measurement.
 */
type ViewResult = Omit<EvalResult, "latencyMs" | "costUsd"> & {
  latencyMs: number | null;
  costUsd: number | null;
};
type ViewRun = Omit<EvalRun, "durationMs" | "costUsd" | "results" | "status"> & {
  status: string;
  durationMs: number | null;
  costUsd: number | null;
  results: ViewResult[];
};

// ── shared bits ─────────────────────────────────────────────────────
const SEVERITY_TONE: Record<DatasetItem["severity"], string> = {
  critical: "text-red-400 border-red-500/25 bg-red-500/[0.08]",
  high: "text-amber-400 border-amber-500/25 bg-amber-500/[0.08]",
  medium: "text-zinc-400 border-white/10 bg-white/[0.03]",
};

const DIFFICULTY_LABEL: Record<DatasetItem["difficulty"], string> = {
  regression: "regression",
  "edge-case": "edge case",
  adversarial: "adversarial",
};

const ASSERTION_LABEL: Record<CaseAssertion["kind"], string> = {
  must_not_raise: "must not raise",
  must_contain: "must contain",
  must_not_contain: "must not contain",
  must_call_tool: "must call tool",
  must_confirm: "must confirm",
  latency_under_ms: "latency under",
  cost_under_usd: "cost under",
  no_unsourced_number: "no unsourced number",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function secs(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function usd(cost: number | null): string {
  return cost === null ? "—" : `$${cost.toFixed(4)}`;
}

function Verdict({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-emerald-400">
      <Check className="w-3 h-3" /> pass
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-red-400">
      <X className="w-3 h-3" /> fail
    </span>
  );
}

function DeltaBadge({ delta }: { delta?: ViewResult["delta"] }) {
  if (!delta || delta === "unchanged") return null;
  const fixed = delta === "fixed";
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded border ${
        fixed
          ? "text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.08]"
          : "text-red-300 border-red-500/30 bg-red-500/[0.1]"
      }`}
    >
      {fixed ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {delta}
    </span>
  );
}

/** Score-over-releases sparkline — the whole point of keeping a golden set. */
function Sparkline({ runs }: { runs: ViewRun[] }) {
  const pts = [...runs].reverse();
  if (pts.length < 2) return null;
  const W = 88, H = 22;
  const step = W / (pts.length - 1);
  const d = pts
    .map((r, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - r.score * H).toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const up = last.score >= first.score;
  return (
    <svg width={W} height={H} className="overflow-visible flex-shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={up ? "#34d399" : "#f87171"} strokeWidth="1.25" strokeLinejoin="round" />
      {pts.map((r, i) => (
        <circle
          key={r.id}
          cx={i * step}
          cy={H - r.score * H}
          r={i === pts.length - 1 ? 2.4 : 1.4}
          fill={r.score === 1 ? "#34d399" : r.score >= 0.6 ? "#fbbf24" : "#f87171"}
        />
      ))}
    </svg>
  );
}

// ── level 1: datasets index ─────────────────────────────────────────
function DatasetsIndex({
  datasets, runsFor, onOpen,
}: {
  datasets: Dataset[];
  runsFor: (datasetId: string) => ViewRun[];
  onOpen: (d: Dataset) => void;
}) {
  const totals = useMemo(() => {
    const cases = datasets.reduce((a, d) => a + d.items.length, 0);
    const runs = datasets.reduce((a, d) => a + runsFor(d.id).length, 0);
    const latest = datasets.map((d) => runsFor(d.id)[0]).filter(Boolean) as ViewRun[];
    const failing = latest.reduce((a, r) => a + r.failed, 0);
    // The runs list carries no per-case results, so a count can only be stated
    // once every newest run has been opened — otherwise it would report 0
    // regressions on evidence it does not have.
    const judged = latest.length > 0 && latest.every((r) => r.results.length > 0);
    const regressed = judged
      ? latest.reduce((a, r) => a + r.results.filter((x) => x.delta === "regressed").length, 0)
      : null;
    return { cases, runs, failing, regressed };
  }, [datasets, runsFor]);

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <Database className="w-4 h-4 text-zinc-400" />
        <h1 className="text-[16px] text-zinc-100 font-medium">Datasets &amp; Evals</h1>
      </div>
      <p className="text-[13px] text-zinc-500 mb-5 max-w-2xl">
        Every production finding can be promoted to a golden case in one click. Each case carries
        machine-checkable assertions, and every release re-runs the whole set — so the bug that
        caused an incident can never quietly return.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Golden cases", value: String(totals.cases), sub: `across ${datasets.length} datasets` },
          { label: "Eval runs", value: String(totals.runs), sub: "release-gated" },
          { label: "Failing now", value: String(totals.failing), sub: "in the newest run", tone: totals.failing ? "text-red-400" : "text-emerald-400" },
          { label: "Regressed", value: totals.regressed === null ? "—" : String(totals.regressed), sub: "vs previous run", tone: totals.regressed ? "text-red-400" : "text-zinc-100" },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-white/[0.06] p-4">
            <MonoLabel>{t.label}</MonoLabel>
            <p className={`text-[26px] font-light tracking-tight tabular-nums mt-1.5 ${t.tone ?? "text-zinc-100"}`}>{t.value}</p>
            <p className="text-[11px] text-zinc-600 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>

      <MonoLabel className="block mb-2">Datasets</MonoLabel>
      <div className="space-y-2">
        {datasets.map((d) => {
          const runs = runsFor(d.id);
          const last = runs[0];
          const regressed = last?.results.filter((r) => r.delta === "regressed").length ?? 0;
          const fixed = last?.results.filter((r) => r.delta === "fixed").length ?? 0;
          return (
            <button
              key={d.id}
              onClick={() => onOpen(d)}
              className="w-full text-left rounded-lg border border-white/[0.06] p-4 hover:border-white/15 hover:bg-white/[0.02] transition-colors group"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[13px] text-zinc-100">{d.name}</span>
                    {d.service && (
                      <span className="font-mono text-[9px] tracking-[0.08em] uppercase text-zinc-500 border border-white/10 rounded px-1.5 py-0.5">
                        {d.service}
                      </span>
                    )}
                    <span className="font-mono text-[10.5px] text-zinc-600">{d.items.length} cases</span>
                  </div>
                  <p className="text-[12.5px] text-zinc-500 mt-1 line-clamp-2">{d.description}</p>
                  {last && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {(last.release || last.commit) && (
                        <span className="font-mono text-[10.5px] text-zinc-600">
                          {last.release}
                          {last.release && last.commit ? " · " : ""}
                          {last.commit && (
                            <>
                              <GitCommit className="w-2.5 h-2.5 inline -mt-px" /> {last.commit}
                            </>
                          )}
                        </span>
                      )}
                      {fixed > 0 && <DeltaBadge delta="fixed" />}
                      {regressed > 0 && <DeltaBadge delta="regressed" />}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Sparkline runs={runs} />
                  {last && (
                    <div className="text-right">
                      <p className={`text-[20px] font-light tabular-nums leading-none ${
                        last.score === 1 ? "text-emerald-400" : last.score >= 0.6 ? "text-amber-400" : "text-red-400"
                      }`}>
                        {pct(last.score)}
                      </p>
                      <p className="font-mono text-[10px] text-zinc-600 mt-1">{last.passed}/{last.total}</p>
                    </div>
                  )}
                  <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── level 2: one dataset, one run ───────────────────────────────────
function DatasetView({
  dataset, runsFor, onLoadRun, onBack, onOpenCase,
}: {
  dataset: Dataset;
  runsFor: (datasetId: string) => ViewRun[];
  onLoadRun?: (runId: string) => void;
  onBack: () => void;
  onOpenCase: (item: DatasetItem, result: ViewResult | undefined, run: ViewRun) => void;
}) {
  const runs = useMemo(() => runsFor(dataset.id), [dataset.id, runsFor]);
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const run = runs.find((r) => r.id === runId) ?? runs[0];
  const [filter, setFilter] = useState<"all" | "failing" | "moved">("all");

  // A run from the list endpoint has no per-case results — ask for them when
  // it's the one on screen.
  useEffect(() => {
    if (run && run.results.length === 0) onLoadRun?.(run.id);
  }, [run, onLoadRun]);

  const rows = useMemo(() => {
    return dataset.items
      .map((item) => ({ item, result: run?.results.find((r) => r.itemId === item.id) }))
      .filter(({ result }) => {
        if (filter === "failing") return result && !result.passed;
        if (filter === "moved") return result?.delta === "fixed" || result?.delta === "regressed";
        return true;
      });
  }, [dataset, run, filter]);

  const breadcrumb = (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <button onClick={onBack} className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300">
        <ChevronLeft className="w-3.5 h-3.5" /> Datasets
      </button>
      <span className="text-zinc-700">/</span>
      <span className="font-mono text-[13px] text-zinc-100">{dataset.name}</span>
      {dataset.service && (
        <span className="font-mono text-[9px] tracking-[0.08em] uppercase text-zinc-500 border border-white/10 rounded px-1.5 py-0.5">
          {dataset.service}
        </span>
      )}
    </div>
  );

  // A dataset can exist before anything has gated on it.
  if (!run) {
    return (
      <>
        {breadcrumb}
        <p className="rounded-lg border border-white/[0.06] px-4 py-8 text-center font-mono text-[12px] text-zinc-600">
          No eval runs yet — {dataset.items.length} case{dataset.items.length === 1 ? "" : "s"} waiting on the next release.
        </p>
      </>
    );
  }

  return (
    <>
      {breadcrumb}

      <p className="text-[12.5px] text-zinc-500 mb-4 max-w-3xl">{dataset.description}</p>

      {/* Run selector — every release that gated on this set. */}
      <MonoLabel className="block mb-2">Runs</MonoLabel>
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
        {runs.map((r) => {
          const active = r.id === run.id;
          return (
            <button
              key={r.id}
              onClick={() => setRunId(r.id)}
              className={`flex-shrink-0 text-left rounded-md border px-3 py-2 transition-colors ${
                active ? "border-indigo-400/40 bg-indigo-500/[0.07]" : "border-white/[0.06] hover:border-white/15"
              }`}
            >
              <span className="flex items-center gap-2">
                <Play className="w-3 h-3 text-zinc-600" />
                <span className="font-mono text-[11.5px] text-zinc-200">{r.release || r.name}</span>
                <span className={`font-mono text-[11px] tabular-nums ${
                  r.score === 1 ? "text-emerald-400" : r.score >= 0.6 ? "text-amber-400" : "text-red-400"
                }`}>
                  {pct(r.score)}
                </span>
              </span>
              <span className="block font-mono text-[10px] text-zinc-600 mt-0.5">
                {r.passed}/{r.total} passed · {r.startedAt}
              </span>
            </button>
          );
        })}
      </div>

      {/* What this run cost and who judged it. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { Icon: Target, label: "Score", value: pct(run.score), sub: `${run.passed} passed · ${run.failed} failed` },
          { Icon: Clock, label: "Duration", value: secs(run.durationMs), sub: `${run.total} cases` },
          { Icon: DollarSign, label: "Cost", value: usd(run.costUsd), sub: run.model },
          { Icon: Gavel, label: "Judge", value: run.judgeModel ? run.judgeModel.split("-").slice(0, 2).join("-") : "—", sub: run.judgeModel },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-white/[0.06] p-3">
            <div className="flex items-center gap-1.5">
              <s.Icon className="w-3 h-3 text-zinc-600" strokeWidth={1.75} />
              <MonoLabel>{s.label}</MonoLabel>
            </div>
            <p className="text-[17px] font-light tabular-nums text-zinc-100 mt-1">{s.value}</p>
            <p className="font-mono text-[10px] text-zinc-600 truncate">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <MonoLabel>Cases</MonoLabel>
        <div className="flex items-center gap-1">
          {(["all", "failing", "moved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`font-mono text-[10.5px] px-2 py-0.5 rounded border transition-colors ${
                filter === f
                  ? "text-zinc-200 border-white/20 bg-white/[0.05]"
                  : "text-zinc-600 border-transparent hover:text-zinc-400"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {run.commit && (
          <span className="font-mono text-[10.5px] text-zinc-600 ml-auto">
            commit {run.commit}
          </span>
        )}
      </div>

      <div className="rounded-lg border border-white/[0.06] overflow-hidden">
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center font-mono text-[12px] text-zinc-600">
            No cases match this filter.
          </p>
        )}
        {rows.map(({ item, result }) => (
          <button
            key={item.id}
            onClick={() => onOpenCase(item, result, run)}
            className="w-full flex items-start gap-3 px-4 py-3 text-left border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.03] transition-colors group"
          >
            <span className="w-14 flex-shrink-0 pt-0.5">
              {result ? <Verdict passed={result.passed} /> : <span className="font-mono text-[10px] text-zinc-700">—</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="text-[12.5px] text-zinc-200">{item.title}</span>
                <span className={`font-mono text-[9px] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded border ${SEVERITY_TONE[item.severity]}`}>
                  {item.severity}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-zinc-500 border border-white/10 rounded px-1.5 py-0.5">
                  {DIFFICULTY_LABEL[item.difficulty]}
                </span>
                {result && <DeltaBadge delta={result.delta} />}
              </span>
              <span className="block font-mono text-[10.5px] text-zinc-600 mt-1 truncate">
                {item.id}{item.spanSignature ? ` · ${item.spanSignature}` : ""}
              </span>
              {result && !result.passed && (
                <span className="block text-[11.5px] text-red-400/80 mt-1 line-clamp-2">{result.reason}</span>
              )}
            </span>
            <span className="flex-shrink-0 flex items-center gap-3 pt-0.5">
              <span className="hidden sm:block font-mono text-[10.5px] text-zinc-600 tabular-nums text-right">
                {result && (
                  <>
                    {secs(result.latencyMs)}
                    <span className="block">{usd(result.costUsd)}</span>
                  </>
                )}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

// ── level 3: one case ───────────────────────────────────────────────
function CaseView({
  item, result, run, dataset, onBack, onOpenTrace,
}: {
  item: DatasetItem;
  result: ViewResult | undefined;
  run: ViewRun;
  dataset: Dataset;
  onBack: () => void;
  onOpenTrace: (id: string) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300">
          <ChevronLeft className="w-3.5 h-3.5" /> {dataset.name}
        </button>
        <span className="text-zinc-700">/</span>
        <span className="font-mono text-[12px] text-zinc-400">{item.id}</span>
        {result && <Verdict passed={result.passed} />}
        {result && <DeltaBadge delta={result.delta} />}
      </div>

      <h2 className="text-[15px] text-zinc-100 mb-1">{item.title}</h2>
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <span className={`font-mono text-[9px] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded border ${SEVERITY_TONE[item.severity]}`}>
          {item.severity}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-zinc-500 border border-white/10 rounded px-1.5 py-0.5">
          {DIFFICULTY_LABEL[item.difficulty]}
        </span>
        {item.tags.map((t) => (
          <span key={t} className="font-mono text-[10px] text-zinc-500 bg-white/[0.03] rounded px-1.5 py-0.5">#{t}</span>
        ))}
      </div>

      {/* Where this case came from — the loop, made concrete. */}
      {(item.fromFinding || item.traceId) && (
        <div className="rounded-lg border border-white/[0.06] p-3 mb-5 flex items-center gap-3 flex-wrap">
          <MonoLabel>Promoted from</MonoLabel>
          {item.fromFinding && <span className="font-mono text-[11.5px] text-zinc-300">{item.fromFinding}</span>}
          {item.fromFinding && item.addedAt && <span className="text-zinc-700">·</span>}
          {item.addedAt && <span className="font-mono text-[11.5px] text-zinc-500">{item.addedAt}</span>}
          {item.traceId && (
            <button
              onClick={() => onOpenTrace(item.traceId)}
              className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-indigo-300 border border-indigo-400/25 rounded-md px-2 py-1 hover:bg-indigo-500/[0.08] transition-colors"
            >
              Open originating trace <ArrowUpRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mb-5">
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-9 border-b border-white/[0.06] bg-white/[0.02]">
            <MonoLabel>Input</MonoLabel>
            <CopyButton value={item.input} className="ml-auto" />
          </div>
          <pre className="p-3 font-mono text-[11.5px] text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-72 overflow-auto">
            {item.input}
          </pre>
        </div>
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-9 border-b border-white/[0.06] bg-white/[0.02]">
            <MonoLabel>Expected</MonoLabel>
          </div>
          <p className="p-3 text-[12.5px] text-zinc-300 leading-relaxed max-h-72 overflow-auto">{item.expected}</p>
        </div>
      </div>

      {/* The assertions are what make this checkable rather than vibes. */}
      <MonoLabel className="block mb-2">Assertions ({item.assertions.length})</MonoLabel>
      <div className="rounded-lg border border-white/[0.06] overflow-hidden mb-5">
        {item.assertions.length === 0 && (
          <p className="px-4 py-6 text-center font-mono text-[12px] text-zinc-600">
            No assertions on this case — it is judged on signature recurrence alone.
          </p>
        )}
        {item.assertions.map((a) => {
          const ar = result?.assertionResults.find((x) => x.id === a.id);
          return (
            <div key={a.id} className="flex items-start gap-3 px-4 py-3 border-b border-white/[0.03] last:border-b-0">
              <span className="w-14 flex-shrink-0 pt-0.5">
                {ar ? <Verdict passed={ar.passed} /> : <span className="font-mono text-[10px] text-zinc-700">—</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-indigo-300/70 border border-indigo-400/20 rounded px-1.5 py-0.5">
                    {ASSERTION_LABEL[a.kind]}
                  </span>
                  <span className="text-[12.5px] text-zinc-300">{a.description}</span>
                </div>
                <p className="font-mono text-[10.5px] text-zinc-600 mt-1 break-all">{a.target}</p>
                {ar && (
                  <p className={`font-mono text-[11px] mt-1.5 ${ar.passed ? "text-emerald-400/70" : "text-red-400/85"}`}>
                    {ar.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {result && (
        <div className="grid lg:grid-cols-2 gap-4 mb-5">
          <div className="rounded-lg border border-white/[0.06] overflow-hidden">
            <div className="flex items-center gap-2 px-3 h-9 border-b border-white/[0.06] bg-white/[0.02]">
              <MonoLabel>Actual — {run.release || run.name}</MonoLabel>
              <span className="ml-auto font-mono text-[10px] text-zinc-600 tabular-nums">
                {secs(result.latencyMs)} · {usd(result.costUsd)}
              </span>
            </div>
            <p className="p-3 text-[12.5px] text-zinc-300 leading-relaxed">{result.actual}</p>
          </div>
          <div className={`rounded-lg border overflow-hidden ${result.passed ? "border-white/[0.06]" : "border-red-500/20"}`}>
            <div className="flex items-center gap-2 px-3 h-9 border-b border-white/[0.06] bg-white/[0.02]">
              <Gavel className="w-3 h-3 text-zinc-600" />
              <MonoLabel>Judge reasoning</MonoLabel>
              <span className="ml-auto font-mono text-[10px] text-zinc-600">{run.judgeModel}</span>
            </div>
            <p className="p-3 text-[12.5px] text-zinc-300 leading-relaxed">{result.reason}</p>
          </div>
        </div>
      )}

      {/* Release history — proof the fix held, or the moment it stopped holding.
          No response carries it, so live mode omits the section rather than
          showing the demo's history next to real verdicts. */}
      {item.history.length > 0 && (
        <>
          <MonoLabel className="block mb-2">History</MonoLabel>
          <div className="rounded-lg border border-white/[0.06] p-4">
            <div className="flex items-end gap-1 flex-wrap">
              {item.history.map((h, i) => {
                const prev = item.history[i - 1];
                const moved = prev && prev.passed !== h.passed;
                return (
                  <div key={h.release} className="flex flex-col items-center gap-1.5 min-w-[92px]">
                    <span
                      className={`w-full h-8 rounded flex items-center justify-center font-mono text-[10px] border ${
                        h.passed
                          ? "bg-emerald-500/[0.1] border-emerald-500/25 text-emerald-300"
                          : "bg-red-500/[0.1] border-red-500/30 text-red-300"
                      }`}
                    >
                      {h.passed ? "pass" : "fail"} {pct(h.score)}
                    </span>
                    <span className="font-mono text-[9.5px] text-zinc-600 text-center leading-tight">
                      {h.release}
                      <span className="block text-zinc-700">{h.date}</span>
                    </span>
                    {moved && (
                      <span className={`font-mono text-[9px] uppercase ${h.passed ? "text-emerald-400" : "text-red-400"}`}>
                        {h.passed ? "fixed" : "regressed"}
                      </span>
                    )}
                    {!moved && <Minus className="w-2.5 h-2.5 text-zinc-800" />}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── live mapping ────────────────────────────────────────────────────

/** The API returns timestamps as ISO strings; the view renders the demo's format. */
function stamp(value: string | null | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function firstLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const line = value.split("\n")[0]!.trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** A promoted case has no title of its own — fall back to what it demonstrably
 *  is (its request, its failure signature, its id), never to an invented label. */
function caseTitle(item: LiveDatasetItem): string {
  return item.title ?? firstLine(item.input["request"], 120) ?? item.spanSignature ?? item.id;
}

function mapItem(item: LiveDatasetItem): DatasetItem {
  const behaviour = item.expected["behaviour"];
  return {
    id: item.id,
    traceId: item.traceId ?? "",
    fromFinding: item.findingId ?? "",
    title: caseTitle(item),
    // Stored input/expected are structured evidence, not prose. Shown as they
    // are rather than paraphrased into something the case never said.
    input: JSON.stringify(item.input, null, 2),
    expected: typeof behaviour === "string" ? behaviour : JSON.stringify(item.expected, null, 2),
    spanSignature: item.spanSignature ?? "",
    assertions: item.assertions,
    tags: item.tags,
    severity: item.severity,
    difficulty: item.difficulty,
    addedAt: stamp(item.createdAt),
    history: [],
  };
}

function mapResult(result: LiveEvalResult): ViewResult {
  return {
    itemId: result.datasetItemId ?? "",
    passed: result.passed,
    score: result.score,
    actual: result.actual ? JSON.stringify(result.actual) : "",
    reason: result.reason ?? "",
    assertionResults: result.assertionResults,
    latencyMs: result.latencyMs,
    costUsd: result.costUsd,
    delta: result.delta,
  };
}

function mapRun(run: LiveEvalRun): ViewRun {
  const started = Date.parse(run.startedAt);
  const finished = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
  return {
    id: run.id,
    datasetId: run.datasetId,
    name: run.name ?? run.datasetName ?? run.id,
    status: run.status,
    model: run.model ?? "",
    judgeModel: run.judgeModel ?? "",
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    score: run.score,
    startedAt: stamp(run.startedAt),
    // A run still going has no duration to report.
    durationMs: Number.isNaN(started) || Number.isNaN(finished) ? null : finished - started,
    costUsd: run.costUsd,
    release: run.release ?? "",
    commit: run.commit ?? "",
    results: (run.results ?? []).map(mapResult),
  };
}

function mapDataset(dataset: LiveDatasetDetail): Dataset {
  // Datasets carry no service of their own; a promoted case records the service
  // it came from, and nothing else can substantiate one.
  const service = dataset.items.map((i) => i.input["service"]).find((s) => typeof s === "string" && s.length > 0);
  return {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description ?? "",
    service: typeof service === "string" ? service : "",
    items: dataset.items.map(mapItem),
    createdAt: stamp(dataset.createdAt),
  };
}

// ── shell ───────────────────────────────────────────────────────────
export function EvalsView({ onOpenTrace }: { onOpenTrace: (id: string) => void }) {
  const mock = useMemo(() => getDatasets(), []);
  const [datasets, setDatasets] = useState<Dataset[]>(mock);
  // Null while on the mock: runs then come from the mock registry.
  const [liveRuns, setLiveRuns] = useState<Record<string, ViewRun[]> | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [openCase, setOpenCase] = useState<{ item: DatasetItem; result?: ViewResult; run: ViewRun } | null>(null);
  // Runs already asked for, so a run that genuinely judged nothing is not
  // re-fetched on every render.
  const requested = useRef<Set<string>>(new Set());

  // Live mode: real datasets and the runs that gated on them. Any failure
  // leaves the mock in place so the demo never breaks.
  useEffect(() => {
    if (!LIVE_TRACES) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchDatasets();
        if (cancelled || list.length === 0) return;
        // The list carries no items, so each dataset is read in full.
        const [details, runs] = await Promise.all([
          Promise.all(list.map((d) => fetchDataset(d.id))),
          fetchEvalRuns(),
        ]);
        if (cancelled) return;
        const mapped = details.filter((d): d is LiveDatasetDetail => d !== null).map(mapDataset);
        if (mapped.length === 0) return;
        const byDataset: Record<string, ViewRun[]> = {};
        for (const run of runs) (byDataset[run.datasetId] ??= []).push(mapRun(run));
        setDatasets(mapped);
        setLiveRuns(byDataset);
      } catch {
        // Mock data stays on screen.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runsFor = useCallback(
    (datasetId: string): ViewRun[] => (liveRuns ? (liveRuns[datasetId] ?? []) : getRuns(datasetId)),
    [liveRuns]
  );

  // `GET /evals` omits per-case results; only `GET /evals/:id` has them.
  const loadRun = useCallback(
    (runId: string) => {
      if (!liveRuns || requested.current.has(runId)) return;
      requested.current.add(runId);
      void fetchEvalRun(runId)
        .then((full) => {
          if (!full) return;
          const run = mapRun(full);
          setLiveRuns((prev) =>
            prev
              ? { ...prev, [run.datasetId]: (prev[run.datasetId] ?? []).map((r) => (r.id === run.id ? run : r)) }
              : prev
          );
        })
        .catch(() => undefined);
    },
    [liveRuns]
  );

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        {openCase && dataset ? (
          <CaseView
            item={openCase.item}
            result={openCase.result}
            run={openCase.run}
            dataset={dataset}
            onBack={() => setOpenCase(null)}
            onOpenTrace={onOpenTrace}
          />
        ) : dataset ? (
          <DatasetView
            dataset={dataset}
            runsFor={runsFor}
            onLoadRun={liveRuns ? loadRun : undefined}
            onBack={() => setDataset(null)}
            onOpenCase={(item, result, run) => setOpenCase({ item, result, run })}
          />
        ) : (
          <DatasetsIndex datasets={datasets} runsFor={runsFor} onOpen={setDataset} />
        )}
      </div>
    </div>
  );
}
