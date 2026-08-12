"use client";

import { useMemo, useState } from "react";
import {
  getDatasets, getRuns, latestRun,
  type Dataset, type DatasetItem, type EvalRun, type EvalResult, type CaseAssertion,
} from "@/lib/mock-evals";
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

function DeltaBadge({ delta }: { delta?: EvalResult["delta"] }) {
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
function Sparkline({ runs }: { runs: EvalRun[] }) {
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
function DatasetsIndex({ datasets, onOpen }: { datasets: Dataset[]; onOpen: (d: Dataset) => void }) {
  const totals = useMemo(() => {
    const cases = datasets.reduce((a, d) => a + d.items.length, 0);
    const runs = datasets.reduce((a, d) => a + getRuns(d.id).length, 0);
    const latest = datasets.map((d) => latestRun(d.id)).filter(Boolean) as EvalRun[];
    const failing = latest.reduce((a, r) => a + r.failed, 0);
    const regressed = latest.reduce(
      (a, r) => a + r.results.filter((x) => x.delta === "regressed").length, 0
    );
    return { cases, runs, failing, regressed };
  }, [datasets]);

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
          { label: "Regressed", value: String(totals.regressed), sub: "vs previous run", tone: totals.regressed ? "text-red-400" : "text-zinc-100" },
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
          const runs = getRuns(d.id);
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
                    <span className="font-mono text-[9px] tracking-[0.08em] uppercase text-zinc-500 border border-white/10 rounded px-1.5 py-0.5">
                      {d.service}
                    </span>
                    <span className="font-mono text-[10.5px] text-zinc-600">{d.items.length} cases</span>
                  </div>
                  <p className="text-[12.5px] text-zinc-500 mt-1 line-clamp-2">{d.description}</p>
                  {last && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="font-mono text-[10.5px] text-zinc-600">
                        {last.release} · <GitCommit className="w-2.5 h-2.5 inline -mt-px" /> {last.commit}
                      </span>
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
  dataset, onBack, onOpenCase,
}: {
  dataset: Dataset;
  onBack: () => void;
  onOpenCase: (item: DatasetItem, result: EvalResult | undefined, run: EvalRun) => void;
}) {
  const runs = useMemo(() => getRuns(dataset.id), [dataset.id]);
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const run = runs.find((r) => r.id === runId) ?? runs[0];
  const [filter, setFilter] = useState<"all" | "failing" | "moved">("all");

  const rows = useMemo(() => {
    return dataset.items
      .map((item) => ({ item, result: run?.results.find((r) => r.itemId === item.id) }))
      .filter(({ result }) => {
        if (filter === "failing") return result && !result.passed;
        if (filter === "moved") return result?.delta === "fixed" || result?.delta === "regressed";
        return true;
      });
  }, [dataset, run, filter]);

  if (!run) return null;

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300">
          <ChevronLeft className="w-3.5 h-3.5" /> Datasets
        </button>
        <span className="text-zinc-700">/</span>
        <span className="font-mono text-[13px] text-zinc-100">{dataset.name}</span>
        <span className="font-mono text-[9px] tracking-[0.08em] uppercase text-zinc-500 border border-white/10 rounded px-1.5 py-0.5">
          {dataset.service}
        </span>
      </div>

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
                <span className="font-mono text-[11.5px] text-zinc-200">{r.release}</span>
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
          { Icon: Clock, label: "Duration", value: `${(run.durationMs / 1000).toFixed(1)}s`, sub: `${run.total} cases` },
          { Icon: DollarSign, label: "Cost", value: `$${run.costUsd.toFixed(4)}`, sub: run.model },
          { Icon: Gavel, label: "Judge", value: run.judgeModel.split("-").slice(0, 2).join("-"), sub: run.judgeModel },
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
        <span className="font-mono text-[10.5px] text-zinc-600 ml-auto">
          commit {run.commit}
        </span>
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
                {item.id} · {item.spanSignature}
              </span>
              {result && !result.passed && (
                <span className="block text-[11.5px] text-red-400/80 mt-1 line-clamp-2">{result.reason}</span>
              )}
            </span>
            <span className="flex-shrink-0 flex items-center gap-3 pt-0.5">
              <span className="hidden sm:block font-mono text-[10.5px] text-zinc-600 tabular-nums text-right">
                {result && (
                  <>
                    {(result.latencyMs / 1000).toFixed(1)}s
                    <span className="block">${result.costUsd.toFixed(4)}</span>
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
  result: EvalResult | undefined;
  run: EvalRun;
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
      <div className="rounded-lg border border-white/[0.06] p-3 mb-5 flex items-center gap-3 flex-wrap">
        <MonoLabel>Promoted from</MonoLabel>
        <span className="font-mono text-[11.5px] text-zinc-300">{item.fromFinding}</span>
        <span className="text-zinc-700">·</span>
        <span className="font-mono text-[11.5px] text-zinc-500">{item.addedAt}</span>
        <button
          onClick={() => onOpenTrace(item.traceId)}
          className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-indigo-300 border border-indigo-400/25 rounded-md px-2 py-1 hover:bg-indigo-500/[0.08] transition-colors"
        >
          Open originating trace <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

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
              <MonoLabel>Actual — {run.release}</MonoLabel>
              <span className="ml-auto font-mono text-[10px] text-zinc-600 tabular-nums">
                {(result.latencyMs / 1000).toFixed(1)}s · ${result.costUsd.toFixed(4)}
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

      {/* Release history — proof the fix held, or the moment it stopped holding. */}
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
  );
}

// ── shell ───────────────────────────────────────────────────────────
export function EvalsView({ onOpenTrace }: { onOpenTrace: (id: string) => void }) {
  const datasets = useMemo(() => getDatasets(), []);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [openCase, setOpenCase] = useState<{ item: DatasetItem; result?: EvalResult; run: EvalRun } | null>(null);

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
            onBack={() => setDataset(null)}
            onOpenCase={(item, result, run) => setOpenCase({ item, result, run })}
          />
        ) : (
          <DatasetsIndex datasets={datasets} onOpen={setDataset} />
        )}
      </div>
    </div>
  );
}
