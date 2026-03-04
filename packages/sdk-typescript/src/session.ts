import { uuidv7 } from "uuidv7";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import type { CreateNode, ContextSnapshot } from "@causal/types";

const SESSION_FILE = ".causal-session";

export class CausalSession {
  readonly sessionId: string;
  readonly startedAt: number;
  nodeId: string | null = null;
  snapshotIds: string[] = [];
  toolsCalled: string[] = [];
  filesModified: string[] = [];
  specIds: string[] = [];

  constructor(
    readonly orgId: string,
    readonly repoId: string,
    readonly modelId: string = "unknown",
    readonly agentId: string | null = null
  ) {
    this.sessionId = uuidv7();
    this.startedAt = Date.now();
  }

  writeSessionFile(path = SESSION_FILE): void {
    writeFileSync(path, this.sessionId, "utf-8");
  }

  toCreateNode(): CreateNode {
    return {
      layer: "REASONING",
      kind: "agent_session",
      timestamp: this.startedAt,
      agentId: this.agentId,
      modelVersion: this.modelId,
      sessionId: this.sessionId,
      contextSnapId: null,
      payload: {
        sessionId: this.sessionId,
        modelId: this.modelId,
        toolsCalled: this.toolsCalled,
        filesModified: this.filesModified,
        specIds: this.specIds,
        snapshotIds: this.snapshotIds,
        source: "causal_sdk_ts",
      },
      orgId: this.orgId,
      repoId: this.repoId,
    };
  }

  buildSnapshot(
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    toolsAvailable: unknown[] = [],
    decisionType: ContextSnapshot["decisionType"] = "tool_call",
    tokenCount?: number
  ): ContextSnapshot {
    const snapshotId = uuidv7();
    const headCommit = getGitHead();

    const data = {
      snapshotId,
      nodeId: this.nodeId ?? this.sessionId,
      timestamp: Date.now(),
      modelId: this.modelId,
      systemPrompt,
      messages: messages as import("@causal/types").ContextMessage[],
      toolsAvailable: toolsAvailable as import("@causal/types").ToolDefinition[],
      repoState: { headCommit, openFiles: this.filesModified.slice() },
      contentHash: "",
      decisionType,
      tokenCount: tokenCount ?? undefined,
    };

    const contentHash = createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");

    return { ...data, contentHash };
  }

  declareSpec(specId: string): void {
    if (!this.specIds.includes(specId)) this.specIds.push(specId);
  }
}

export function readSessionFile(path = SESSION_FILE): string | null {
  try {
    return readFileSync(path, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export function clearSessionFile(path = SESSION_FILE): void {
  try {
    unlinkSync(path);
  } catch {
    // File may not exist
  }
}

function getGitHead(): string {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}
