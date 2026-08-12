/**
 * Terminal rendering helpers: colors, human numbers/durations, and a tiny
 * column-aligned table. Everything degrades to plain ASCII when stdout is not
 * a TTY or NO_COLOR is set, so output stays readable when piped.
 */

const COLOR_ENABLED =
  Boolean(process.stdout.isTTY) &&
  !process.env["NO_COLOR"] &&
  process.env["TERM"] !== "dumb";

const wrap = (open: string, close: string) => (s: string): string =>
  COLOR_ENABLED ? `\u001b[${open}m${s}\u001b[${close}m` : s;

export const color = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  blue: wrap("34", "39"),
  magenta: wrap("35", "39"),
  cyan: wrap("36", "39"),
  gray: wrap("90", "39"),
};

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;

export const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");
export const visibleLength = (s: string): number => stripAnsi(s).length;

/** Pad to `width` counting only visible characters. */
export function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  const gap = Math.max(0, width - visibleLength(s));
  return align === "right" ? " ".repeat(gap) + s : s + " ".repeat(gap);
}

/** Ellipsize to `max` visible characters. Colored strings pass through
 *  untouched — cutting one would strip its reset sequence and bleed color. */
export function truncate(s: string, max: number): string {
  if (max <= 1 || visibleLength(s) <= max) return s;
  if (s !== stripAnsi(s)) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** 910ms · 8.4s · 1m 24s · 2h 05m */
export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${seconds}s`;
}

/** 812 · 1.2k · 3.4M */
export function formatCount(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "-";
  if (Math.abs(n) < 1000) return String(Math.round(n));
  if (Math.abs(n) < 1_000_000) return `${trimZero((n / 1000).toFixed(1))}k`;
  return `${trimZero((n / 1_000_000).toFixed(1))}M`;
}

const trimZero = (s: string): string => (s.endsWith(".0") ? s.slice(0, -2) : s);

/** $0.0412 — 4dp below $100, 2dp above, so wide traces stay aligned. */
export function formatCost(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "-";
  if (n === 0) return "$0";
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

/** "3m ago" / "4h ago" / "2026-08-01" for anything older than a week. */
export function formatWhen(value: unknown): string {
  if (typeof value !== "string" && !(value instanceof Date)) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const deltaMs = Date.now() - d.getTime();
  if (deltaMs < 0) return d.toISOString().slice(0, 16).replace("T", " ");
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export type Status = "ok" | "warn" | "error" | string;

/** Colored single-character status marker. */
export function statusMarker(status: Status | undefined): string {
  switch (status) {
    case "ok":
      return color.green("✓");
    case "warn":
      return color.yellow("!");
    case "error":
      return color.red("✗");
    default:
      return color.gray("·");
  }
}

export function statusLabel(status: Status | undefined): string {
  switch (status) {
    case "ok":
      return color.green("ok");
    case "warn":
      return color.yellow("warn");
    case "error":
      return color.red("error");
    default:
      return color.gray(String(status ?? "-"));
  }
}

export function severityLabel(severity: string | undefined): string {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return color.red(color.bold("critical"));
    case "high":
      return color.red("high");
    case "medium":
      return color.yellow("medium");
    case "low":
      return color.blue("low");
    default:
      return color.gray(severity ?? "-");
  }
}

export interface Column {
  header: string;
  align?: "left" | "right";
  /** Hard cap on cell width; longer cells are ellipsized. */
  max?: number;
}

/** Column-aligned table. Rows are pre-formatted strings (ANSI allowed). */
export function renderTable(columns: Column[], rows: string[][]): string {
  const cells = rows.map((row) =>
    columns.map((col, i) => {
      const raw = row[i] ?? "";
      return col.max ? truncate(raw, col.max) : raw;
    })
  );
  const widths = columns.map((col, i) =>
    Math.max(visibleLength(col.header), ...cells.map((row) => visibleLength(row[i] ?? "")), 0)
  );
  const header = columns
    .map((col, i) => color.dim(pad(col.header.toUpperCase(), widths[i], col.align)))
    .join("  ")
    .trimEnd();
  const body = cells.map((row) =>
    columns
      .map((col, i) => pad(row[i] ?? "", widths[i], col.align))
      .join("  ")
      .trimEnd()
  );
  return [header, ...body].join("\n");
}

/** Aligned `label  value` block used by status/doctor/trace headers. */
export function renderFields(fields: Array<[string, string]>): string {
  const width = Math.max(0, ...fields.map(([label]) => label.length));
  return fields.map(([label, value]) => `${color.dim(pad(label, width))}  ${value}`).join("\n");
}

export const out = (line = ""): void => {
  process.stdout.write(`${line}\n`);
};

export const err = (line = ""): void => {
  process.stderr.write(`${line}\n`);
};

/** The one machine-readable document a --json run is allowed to print. */
export function printJson(doc: unknown): void {
  process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
}
