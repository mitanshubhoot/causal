"use client";

import { useMemo, useState } from "react";
import {
  getDatasets, getEvalRuns, latestRunFor, scoreTrend,
  type Dataset, type EvalRun,
} from "@/lib/mock-evals";
import { MonoLabel, fmtDuration } from "./ui";
import {
  Database, ChevronRight, ChevronLeft, CheckCircle2, XCircle, TrendingUp, Play, Sparkles,
} from "lucide-react";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 0.99 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
      : score >= 0.6 ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
        : "text-red-400 border-red-500/30 bg-red-500/10";
  return (
    <span className={`inline-flex items-center font-mono text-[10px] tracking-[0.08em] font-semibold px-1.5 py-0.5 rounded border tabular-nums ${tone}`}>
      {pct(score)}
    </span>
  );
}

/** Sparkline of eval score across releases — robustness over time. */
function Trend({ datasetId }: { datasetId: string }) {
  const points = scoreTrend(datasetId);
  if (points.length < 2) return <span className="font-mono text-[10px] text-zinc-600">—</span>;
  const w = 68, h = 18;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - p.score * h}`)
    .join(" ");
  const improving = (points[points.length - 1]?.score ?? 0) >= (points[0]?.score ?? 0);
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={d}
        fill="none"
        strokeWidth="1.5"
        className={improving ? "stroke-emerald-400/80" : "stroke-red-400/80"}
      />
      {points.map((p, i) => (
        <circle key={i} cx={(i / (points.length - 1)) * w} cy={h - p.score * h} r="1.8"
          className={improving ? "fill-emerald-400" : "fill-red-400"} />
      ))}
    </svg>
  );
}

function DatasetList({ datasets, onOpen }: { datasets: Dataset[]; onOpen: (d: Dataset) => void }) {
  return (
    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
      <div className="hidden sm:grid grid-cols-[1fr_80px_110px_90px_28px] gap-3 px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <MonoLabel>Dataset</MonoLabel>
        <MonoLabel>Cases</MonoLabel>
        <MonoLabel>Latest score</MonoLabel>
        <MonoLabel>Trend</MonoLabel>
        <span />
      </div>
      {datasets.map((d) => {
        const latest = latestRunFor(d.id);
        return (
          <button
            key={d.id}
            onClick={() => onOpen(d)}
            className="w-full grid grid-cols-[1fr_80px_110px_90px_28px] gap-3 px-4 py-3 items-center text-left border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
          >
            <span className="min-w-0">
              <span className="block font-mono text-[12.5px] text-zinc-100 truncate">{d.name}</span>
              <span className="block text-[11.5px] text-zinc-600 truncate">{d.description}</span>
            </span>
            <span className="font-mono text-[12px] text-zinc-400 tabular-nums">{d.items.length}</span>
            <span>{latest ? <ScoreBadge score={latest.score} /> : <span className="font-mono text-[11px] text-zinc-600">no runs</span>}</span>
            <span><Trend datasetId={d.id} /></span>
            <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors justify-self-end" />
          </button>
        );
      })}
    </div>
  );
}

function DatasetDetail({ dataset, onBack, onOpenTrace }: { dataset: Dataset; onBack: () => void; onOpenTrace: (id: string) => void }) {
  const [tab, setTab] = useState<"cases" | "runs">("cases");
  const runs = useMemo(() => getEvalRuns(dataset.id), [dataset.id]);
  const [openRun, setOpenRun] = useState<EvalRun | null>(null);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <button onClick={onBack} className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300">
          <ChevronLeft className="w-3.5 h-3.5" /> Datasets
        </button>
        <span className="text-zinc-700">/</span>
        <span className="font-mono text-[13px] text-zinc-100">{dataset.name}</span>
      </div>
      <p className="text-[12.5px] text-zinc-500 mb-4">{dataset.description}</p>

      <div className="flex items-center gap-4 border-b border-white/[0.06] mb-3">
        {(["cases", "runs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setOpenRun(null); }}
            className={`text-[12.5px] capitalize py-2 -mb-px border-b-2 transition-colors ${
              tab === t ? "border-indigo-400/80 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "cases" ? `Golden cases (${dataset.items.length})` : `Eval runs (${runs.length})`}
          </button>
        ))}
      </div>

      {tab === "cases" ? (
        <div className="space-y-2">
          {dataset.items.map((it) => (
            <div key={it.id} className="rounded-md border border-white/[0.06] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.02]">
                <Sparkles className="w-3 h-3 text-indigo-300/70" />
                <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-zinc-500">promoted from</span>
                <button onClick={() => onOpenTrace(it.traceId)} className="font-mono text-[11px] text-indigo-300/80 hover:text-indigo-200 truncate">
                  {it.fromFinding}
                </button>
                <span className="ml-auto font-mono text-[10px] text-zinc-600">{it.addedAt}</span>
              </div>
              <div className="px-3 py-2 space-y-2">
                <div>
                  <MonoLabel className="block mb-1">Input</MonoLabel>
                  <p className="font-mono text-[11.5px] text-zinc-300 leading-relaxed">{it.input}</p>
                </div>
                <div>
                  <MonoLabel className="block mb-1">Expected</MonoLabel>
                  <p className="text-[12px] text-zinc-400 leading-relaxed">{it.expected}</p>
                </div>
                <div className="flex items-center gap-2">
                  <MonoLabel>Signature</MonoLabel>
                  <code className="font-mono text-[10.5px] text-zinc-500 bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5">{it.spanSignature}</code>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : openRun ? (
        <div>
          <button onClick={() => setOpenRun(null)} className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300 mb-3">
            <ChevronLeft className="w-3.5 h-3.5" /> Runs
          </button>
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-[12.5px] text-zinc-100">{openRun.name}</span>
            <ScoreBadge score={openRun.score} />
            <span className="font-mono text-[11px] text-zinc-600">{openRun.passed}/{openRun.total} passed · {fmtDuration(openRun.durationMs)} · {openRun.model}</span>
          </div>
          <div className="rounded-lg border border-white/[0.06] overflow-hidden">
            {openRun.results.map((r) => {
              const item = dataset.items.find((i) => i.id === r.itemId);
              return (
                <div key={r.itemId} className="px-4 py-3 border-b border-white/[0.03]">
                  <div className="flex items-center gap-2 mb-1">
                    {r.passed
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                    <span className="font-mono text-[11.5px] text-zinc-300 truncate">{item?.spanSignature ?? r.itemId}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-600 tabular-nums">{pct(r.score)}</span>
                  </div>
                  <p className="text-[12px] text-zinc-400 leading-relaxed">{r.actual}</p>
                  <p className="text-[11.5px] text-zinc-600 leading-relaxed mt-0.5">{r.reason}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_90px_100px_130px_28px] gap-3 px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
            <MonoLabel>Run</MonoLabel>
            <MonoLabel>Score</MonoLabel>
            <MonoLabel>Passed</MonoLabel>
            <MonoLabel>Started</MonoLabel>
            <span />
          </div>
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => setOpenRun(r)}
              className="w-full grid grid-cols-[1fr_90px_100px_130px_28px] gap-3 px-4 py-3 items-center text-left border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
            >
              <span className="min-w-0">
                <span className="block text-[12.5px] text-zinc-200 truncate">{r.release}</span>
                <span className="block font-mono text-[10.5px] text-zinc-600">{r.model}</span>
              </span>
              <ScoreBadge score={r.score} />
              <span className="font-mono text-[11.5px] text-zinc-400 tabular-nums">{r.passed}/{r.total}</span>
              <span className="font-mono text-[11px] text-zinc-500">{r.startedAt}</span>
              <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors justify-self-end" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EvalsView({ onOpenTrace }: { onOpenTrace: (id: string) => void }) {
  const datasets = useMemo(() => getDatasets(), []);
  const [selected, setSelected] = useState<Dataset | null>(null);

  const allRuns = getEvalRuns();
  const cases = datasets.reduce((a, d) => a + d.items.length, 0);
  const latest = datasets.map((d) => latestRunFor(d.id)).filter(Boolean) as EvalRun[];
  const avg = latest.length ? latest.reduce((a, r) => a + r.score, 0) / latest.length : 0;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        {!selected ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-zinc-400" />
              <h1 className="text-[16px] text-zinc-100 font-medium">Datasets &amp; Evals</h1>
            </div>
            <p className="text-[13px] text-zinc-500 mb-5">
              Production findings become golden cases in one click. Every release is re-run against them, so a fix is verified and a regression can&apos;t come back unnoticed.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="rounded-lg border border-white/[0.06] p-4">
                <div className="flex items-center gap-1.5 mb-2"><Database className="w-3.5 h-3.5 text-zinc-600" /><MonoLabel>Datasets</MonoLabel></div>
                <p className="text-[26px] font-light tracking-tight tabular-nums text-zinc-100">{datasets.length}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] p-4">
                <div className="flex items-center gap-1.5 mb-2"><Sparkles className="w-3.5 h-3.5 text-zinc-600" /><MonoLabel>Golden cases</MonoLabel></div>
                <p className="text-[26px] font-light tracking-tight tabular-nums text-zinc-100">{cases}</p>
                <p className="text-[11px] text-zinc-600 mt-0.5">promoted from findings</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] p-4">
                <div className="flex items-center gap-1.5 mb-2"><Play className="w-3.5 h-3.5 text-zinc-600" /><MonoLabel>Eval runs</MonoLabel></div>
                <p className="text-[26px] font-light tracking-tight tabular-nums text-zinc-100">{allRuns.length}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] p-4">
                <div className="flex items-center gap-1.5 mb-2"><TrendingUp className="w-3.5 h-3.5 text-zinc-600" /><MonoLabel>Latest score</MonoLabel></div>
                <p className={`text-[26px] font-light tracking-tight tabular-nums ${avg >= 0.9 ? "text-emerald-400" : "text-amber-400"}`}>{pct(avg)}</p>
                <p className="text-[11px] text-zinc-600 mt-0.5">across datasets</p>
              </div>
            </div>

            <DatasetList datasets={datasets} onOpen={setSelected} />
          </>
        ) : (
          <DatasetDetail dataset={selected} onBack={() => setSelected(null)} onOpenTrace={onOpenTrace} />
        )}
      </div>
    </div>
  );
}
