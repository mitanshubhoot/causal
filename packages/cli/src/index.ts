#!/usr/bin/env node
/**
 * causal — the Causal CLI.
 *
 * Exit codes: 0 ok · 1 internal · 2 usage · 3 auth · 4 not_found · 5 network.
 * With --json, stdout carries exactly one JSON document and every error goes to
 * stderr as a single line, so any command stays safe to pipe into jq.
 */

import { Command, CommanderError } from "commander";
import { EXIT_CODES, toCliError } from "./errors.js";
import { color, err } from "./output.js";
import { withCommonOptions } from "./options.js";
import { registerLogin } from "./commands/login.js";
import { registerStatus } from "./commands/status.js";
import { registerTraces } from "./commands/traces.js";
import { registerDetectors } from "./commands/detectors.js";
import { registerFindings } from "./commands/findings.js";
import { registerAsk } from "./commands/ask.js";
import { registerInstrument } from "./commands/instrument.js";
import { registerDoctor } from "./commands/doctor.js";

const VERSION = "0.1.0";

// --json may appear anywhere, including after a subcommand that failed before
// its options were parsed — read it off argv so error formatting is never wrong.
const WANTS_JSON = process.argv.includes("--json");

const program = new Command();

program
  .name("causal")
  .description("Causal — AI-native observability and self-healing for AI agents")
  .version(VERSION, "-v, --version", "print the CLI version")
  .showHelpAfterError("(run `causal --help` for usage)")
  .configureOutput({
    // Under --json the only thing allowed on stderr is the one-line error doc,
    // so commander's own message and usage dump are suppressed there.
    writeErr: (str) => {
      if (!WANTS_JSON) process.stderr.write(str);
    },
  })
  .exitOverride();

withCommonOptions(program);

registerLogin(program);
registerStatus(program);
registerTraces(program);
registerDetectors(program);
registerFindings(program);
registerAsk(program);
registerInstrument(program);
registerDoctor(program);

program.addHelpText(
  "after",
  `
Examples:
  $ causal login --host https://api.causal.dev
  $ causal traces list --limit 10
  $ causal traces get tr_9f2c1a --json | jq '.spans[] | select(.status == "error")'
  $ causal ask tr_9f2c1a "why did the booking agent fail?"
  $ causal instrument --print
  $ causal doctor

Configuration precedence: flags > CAUSAL_API_KEY / CAUSAL_API_URL > ./.causal/config.json > ./.env
Exit codes: 0 ok, 1 internal, 2 usage, 3 auth, 4 not_found, 5 network`
);

// The exit code is set, never forced with process.exit(), so buffered stdout /
// stderr writes are not truncated when the CLI is piped.
try {
  await program.parseAsync(process.argv);
} catch (thrown) {
  if (thrown instanceof CommanderError) {
    // Help and version are successful exits that commander routes through throw.
    if (thrown.exitCode !== 0) {
      // Commander already wrote the human message (suppressed under --json).
      if (WANTS_JSON) {
        const raw = thrown.message.replace(/^error:\s*/, "").trim();
        // A command group invoked with no subcommand surfaces as "(outputHelp)".
        writeJsonError("usage", raw === "(outputHelp)" ? "a subcommand is required" : raw);
      }
      process.exitCode = EXIT_CODES.usage;
    }
  } else {
    const error = toCliError(thrown);
    if (WANTS_JSON) {
      writeJsonError(error.code, error.message);
    } else {
      err(`${color.red("error")} ${error.message}`);
      if (error.hint) err(color.dim(error.hint));
    }
    process.exitCode = error.exitCode;
  }
}

function writeJsonError(code: string, message: string): void {
  process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
}
