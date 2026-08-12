/**
 * `causal traces list` and `causal traces get <id>` — the span tree is the
 * point: indentation shows nesting, and every span carries its own duration,
 * economics and git anchor.
 */

import type { Command } from "commander";
import { contextFor, parseLimit, withCommonOptions } from "../options.js";
import { notFoundError } from "../errors.js";
import {
  color,
  formatCost,
  formatCount,
  formatDuration,
  formatWhen,
  out,
  printJson,
  renderFields,
  renderTable,
  statusLabel,
  statusMarker,
} from "../output.js";
import type { Span, TraceDetail, TracesListResponse } from "../types.js";

export function registerTraces(program: Command): void {
  const traces = program.command("traces").description("list and inspect traces");

  const list = traces
    .command("list")
    .description("list recent traces, newest first")
    .option("-n, --limit <n>", "how many traces to return (1-500)", "20")
    .action(async () => {
      await runList(list);
    });
  withCommonOptions(list);

  const get = traces
    .command("get")
    .description("show one trace as a span tree")
    .argument("<id>", "trace id")
    .action(async (id: string) => {
      await runGet(get, id);
    });
  withCommonOptions(get);
}

async function runList(command: Command): Promise<void> {
  const { api, json } = contextFor(command);
  api.requireKey();
  const limit = parseLimit(command.opts()["limit"] as string | undefined, 20);

  const response = await api.get<TracesListResponse>("/api/v1/traces", { limit });
  const traces = [...(response.traces ?? [])].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
  );

  if (json) {
    printJson({ traces, count: traces.length });
    return;
  }

  if (traces.length === 0) {
    out(color.dim("No traces yet — send one with the Causal SDK, then re-run this command."));
    return;
  }

  out(
    renderTable(
      [
        { header: "status" },
        { header: "trace id" },
        { header: "service", max: 24 },
        { header: "root span", max: 38 },
        { header: "spans", align: "right" },
        { header: "tokens", align: "right" },
        { header: "cost", align: "right" },
        { header: "started", align: "right" },
      ],
      traces.map((trace) => [
        `${statusMarker(trace.status)} ${statusLabel(trace.status)}`,
        trace.id,
        trace.service,
        trace.name ?? color.dim("-"),
        String(trace.spanCount),
        `${formatCount(trace.tokensIn)}→${formatCount(trace.tokensOut)}`,
        formatCost(trace.cost),
        formatWhen(trace.startedAt),
      ])
    )
  );
  out();
  out(color.dim(`${traces.length} trace(s) · causal traces get <id> for the span tree`));
}

async function runGet(command: Command, id: string): Promise<void> {
  const { api, json } = contextFor(command);
  api.requireKey();

  const trace = await api.get<TraceDetail>(`/api/v1/traces/${encodeURIComponent(id)}`);
  if (!trace || !trace.traceId) throw notFoundError(`trace ${id} not found`);

  if (json) {
    printJson(trace);
    return;
  }

  const spans = trace.spans ?? [];
  const totalMs = spans.reduce((max, span) => Math.max(max, span.startMs + span.durationMs), 0);

  const fields: Array<[string, string]> = [
    ["trace", color.bold(trace.traceId)],
    ["title", trace.title ?? color.dim("-")],
    ["status", `${statusMarker(trace.status)} ${statusLabel(trace.status)}`],
    ["service", `${trace.service} ${color.dim(`(${trace.environment})`)}`],
    ["model", trace.model ?? color.dim("-")],
    ["started", `${formatWhen(trace.startedAt)} ${color.dim(String(trace.startedAt))}`],
    ["duration", formatDuration(totalMs)],
    ["spans", String(spans.length)],
    ["tokens", `${formatCount(trace.tokensIn)} in → ${formatCount(trace.tokensOut)} out`],
    ["cost", formatCost(trace.cost)],
  ];
  if (trace.repo) fields.push(["repo", `${trace.repo}${trace.gitRef ? ` @ ${trace.gitRef.slice(0, 12)}` : ""}`]);
  if (trace.user) fields.push(["user", trace.user]);
  if (trace.sessionId) fields.push(["session", trace.sessionId]);
  for (const item of trace.metadata ?? []) fields.push([item.label, item.value]);

  out(renderFields(fields));

  if (trace.finding) {
    const finding = trace.finding;
    out();
    out(
      `${color.bold("FINDING")}  ${color.magenta(finding.detector)} ${color.dim("·")} ${finding.title} ` +
        `${color.dim(`(${finding.severity}, confidence ${finding.confidence.toFixed(2)})`)}`
    );
    if (finding.summary) out(indent(finding.summary, "  "));
  }

  out();
  if (spans.length === 0) {
    out(color.dim("This trace has no spans."));
    return;
  }
  out(renderSpanTree(spans));
}

function indent(text: string, prefix: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * Render spans as a tree. Spans whose parent is missing are treated as roots so
 * a partially-flushed trace still prints everything it holds.
 */
export function renderSpanTree(spans: Span[]): string {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const children = new Map<string, Span[]>();
  const roots: Span[] = [];

  for (const span of spans) {
    const parentId = span.parentId ?? null;
    if (parentId && byId.has(parentId) && parentId !== span.id) {
      const siblings = children.get(parentId);
      if (siblings) siblings.push(span);
      else children.set(parentId, [span]);
    } else {
      roots.push(span);
    }
  }

  const byStart = (a: Span, b: Span): number => a.startMs - b.startMs || a.name.localeCompare(b.name);
  roots.sort(byStart);
  for (const siblings of children.values()) siblings.sort(byStart);

  const rows: string[][] = [];
  const visited = new Set<string>();

  const walk = (span: Span, prefix: string, isLast: boolean, isRoot: boolean): void => {
    if (visited.has(span.id)) return; // defensive: a cycle must not hang the CLI
    visited.add(span.id);

    const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
    const label = `${prefix}${branch}${statusMarker(span.status)} ${span.name}`;
    const tokens =
      span.tokensIn === undefined && span.tokensOut === undefined
        ? ""
        : `${formatCount(span.tokensIn ?? 0)}→${formatCount(span.tokensOut ?? 0)}`;

    rows.push([
      label,
      color.dim(span.kind),
      formatDuration(span.durationMs),
      tokens,
      span.cost === undefined ? "" : formatCost(span.cost),
    ]);

    const childPrefix = isRoot ? "" : `${prefix}${isLast ? "   " : "│  "}`;
    const detailPrefix = `${childPrefix}${(children.get(span.id)?.length ?? 0) > 0 ? "│  " : "   "}`;

    if (span.error) rows.push([`${detailPrefix}${color.red(`error: ${oneLine(span.error, 160)}`)}`, "", "", "", ""]);
    if (span.git) {
      rows.push([
        `${detailPrefix}${color.dim(`${span.git.file}:${span.git.line} @ ${span.git.commit.slice(0, 7)}`)}`,
        "",
        "",
        "",
        "",
      ]);
    }

    const kids = children.get(span.id) ?? [];
    kids.forEach((child, index) => walk(child, childPrefix, index === kids.length - 1, false));
  };

  roots.forEach((root, index) => walk(root, "", index === roots.length - 1, true));

  return renderTable(
    [
      { header: "span" },
      { header: "kind" },
      { header: "duration", align: "right" },
      { header: "tokens", align: "right" },
      { header: "cost", align: "right" },
    ],
    rows
  );
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};
