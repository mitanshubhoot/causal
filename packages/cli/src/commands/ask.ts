/**
 * `causal ask <traceId> <question>` — Causal Copilot, grounded in one trace.
 * Prints the markdown answer verbatim so it pipes into a pager or a file.
 */

import type { Command } from "commander";
import { contextFor, withCommonOptions } from "../options.js";
import { usageError } from "../errors.js";
import { color, out, printJson } from "../output.js";
import type { AskResponse } from "../types.js";

export function registerAsk(program: Command): void {
  const command = program
    .command("ask")
    .description("ask a question about one trace and print the answer")
    .argument("<traceId>", "trace id to ground the answer in")
    .argument("<question...>", "the question (quote it, or pass it as trailing words)")
    .action(async (traceId: string, question: string[]) => {
      await runAsk(command, traceId, question);
    });
  withCommonOptions(command);
}

async function runAsk(command: Command, traceId: string, questionParts: string[]): Promise<void> {
  const { api, json } = contextFor(command);
  api.requireKey();

  const question = questionParts.join(" ").trim();
  if (!question) throw usageError("a question is required", 'Example: causal ask tr_123 "why did this fail?"');
  if (question.length > 2000) throw usageError("question must be 2000 characters or fewer");

  const response = await api.post<AskResponse>(
    `/api/v1/traces/${encodeURIComponent(traceId)}/ask`,
    { question }
  );

  if (json) {
    printJson({
      traceId,
      question,
      answer: response.answer,
      model: response.model,
      grounded: response.grounded,
    });
    return;
  }

  out(response.answer.trimEnd());
  out();
  out(color.dim(`— ${response.model}${response.grounded ? ", grounded in trace " : ", ungrounded "}${traceId}`));
}
