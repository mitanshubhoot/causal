/** `causal detectors list` — the judges that run over ingested traces. */

import type { Command } from "commander";
import { contextFor, withCommonOptions } from "../options.js";
import { color, formatCount, out, printJson, renderTable } from "../output.js";
import type { DetectorsListResponse } from "../types.js";

export function registerDetectors(program: Command): void {
  const detectors = program.command("detectors").description("inspect detectors");

  const list = detectors
    .command("list")
    .description("list detectors with their open and total finding counts")
    .action(async () => {
      await runList(list);
    });
  withCommonOptions(list);
}

async function runList(command: Command): Promise<void> {
  const { api, json } = contextFor(command);
  api.requireKey();

  const response = await api.get<DetectorsListResponse>("/api/v1/detectors");
  const detectors = response.detectors ?? [];

  if (json) {
    printJson({ detectors, count: detectors.length });
    return;
  }

  if (detectors.length === 0) {
    out(color.dim("No detectors configured for this org."));
    return;
  }

  out(
    renderTable(
      [
        { header: "name", max: 28 },
        { header: "type", max: 16 },
        { header: "enabled" },
        { header: "open", align: "right" },
        { header: "findings", align: "right" },
        { header: "runs", align: "right" },
        { header: "description", max: 52 },
      ],
      detectors.map((detector) => [
        detector.name,
        detector.type,
        detector.enabled ? color.green("yes") : color.dim("no"),
        detector.openFindings > 0 ? color.yellow(String(detector.openFindings)) : "0",
        formatCount(detector.totalFindings),
        formatCount(detector.totalRuns),
        detector.description ?? "",
      ])
    )
  );
  out();
  out(color.dim(`${detectors.length} detector(s) · causal findings list to see what they fired on`));
}
