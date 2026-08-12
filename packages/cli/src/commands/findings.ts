/** `causal findings list` — the org-wide feed of what detectors flagged. */

import type { Command } from "commander";
import { contextFor, parseLimit, withCommonOptions } from "../options.js";
import { color, formatWhen, out, printJson, renderTable, severityLabel } from "../output.js";
import type { FindingsListResponse } from "../types.js";

export function registerFindings(program: Command): void {
  const findings = program.command("findings").description("inspect detector findings");

  const list = findings
    .command("list")
    .description("list findings across the org, newest first")
    .option("-n, --limit <n>", "how many findings to return (1-500)", "20")
    .action(async () => {
      await runList(list);
    });
  withCommonOptions(list);
}

async function runList(command: Command): Promise<void> {
  const { api, json } = contextFor(command);
  api.requireKey();
  const limit = parseLimit(command.opts()["limit"] as string | undefined, 20);

  const response = await api.get<FindingsListResponse>("/api/v1/findings", { limit });
  const findings = response.findings ?? [];

  if (json) {
    printJson({ findings, count: findings.length });
    return;
  }

  if (findings.length === 0) {
    out(color.dim("No findings — nothing has been flagged on this org's traces."));
    return;
  }

  out(
    renderTable(
      [
        { header: "severity" },
        { header: "state" },
        { header: "detector", max: 22 },
        { header: "title", max: 44 },
        { header: "service", max: 18 },
        { header: "trace id" },
        { header: "when", align: "right" },
      ],
      findings.map((finding) => [
        severityLabel(finding.severity),
        finding.resolved ? color.dim("resolved") : color.yellow("open"),
        finding.detector,
        finding.title,
        finding.service ?? color.dim("-"),
        finding.traceId,
        formatWhen(finding.timestamp),
      ])
    )
  );
  out();
  out(color.dim(`${findings.length} finding(s) · causal traces get <trace id> to see the span tree`));
}
