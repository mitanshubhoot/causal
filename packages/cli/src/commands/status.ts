/**
 * `causal status` — the identity the next command will use. Purely local: no
 * request is made, so it always answers, even offline.
 */

import { relative } from "node:path";
import type { Command } from "commander";
import { describeSource, keyHint } from "../config.js";
import { color, out, printJson, renderFields } from "../output.js";
import { contextFor, withCommonOptions } from "../options.js";

export function registerStatus(program: Command): void {
  const command = program
    .command("status")
    .description("show the resolved host, key hint and where each value came from")
    .action(() => {
      runStatus(command);
    });
  withCommonOptions(command);
}

function runStatus(command: Command): void {
  const { config, json } = contextFor(command);
  const authenticated = config.apiKey.length > 0;

  if (json) {
    printJson({
      host: config.host,
      hostSource: config.sources.host,
      apiKey: {
        present: authenticated,
        hint: authenticated ? keyHint(config.apiKey) : null,
        source: config.sources.apiKey,
      },
      orgId: config.orgId ?? null,
      orgIdSource: config.sources.orgId,
      projectRoot: config.projectRoot,
      configPath: config.configPath ?? null,
      dotenvPath: config.dotenvPath ?? null,
    });
    return;
  }

  const short = (path: string): string => relative(process.cwd(), path) || path;

  out(
    renderFields([
      ["host", `${config.host}  ${color.dim(`(${describeSource(config, config.sources.host)})`)}`],
      [
        "api key",
        authenticated
          ? `${keyHint(config.apiKey)}  ${color.dim(`(${describeSource(config, config.sources.apiKey)})`)}`
          : color.yellow("not set"),
      ],
      [
        "org id",
        config.orgId
          ? `${config.orgId}  ${color.dim(`(${describeSource(config, config.sources.orgId)})`)}`
          : color.dim("derived from the API key"),
      ],
      ["project", short(config.projectRoot)],
      ["config", config.configPath ? short(config.configPath) : color.dim("none")],
      ["dotenv", config.dotenvPath ? short(config.dotenvPath) : color.dim("none")],
    ])
  );

  if (!authenticated) {
    out();
    out(color.yellow("No API key resolved. Run `causal login` or set CAUSAL_API_KEY."));
  }
}
