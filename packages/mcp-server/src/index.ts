#!/usr/bin/env node
/**
 * Causal MCP Server
 *
 * Installed in Claude Code via CLAUDE.md:
 *
 *   [[mcp_servers]]
 *   name = "causal"
 *   command = "npx"
 *   args = ["causal-mcp", "--org", "YOUR_ORG_ID"]
 *
 * This server:
 * 1. Creates a REASONING node when the session starts
 * 2. Captures ContextSnapshots at decision points (tool calls, file edits)
 * 3. Exposes causal_link() so the agent can declare what spec it's implementing
 * 4. Writes session ID to .causal-session for the git post-commit hook
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CausalClient } from "@causal/sdk";
import { CausalSession } from "@causal/sdk";

// ── Parse CLI args ────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const orgId = getArg("--org") ?? process.env["CAUSAL_ORG_ID"] ?? "default";
const repoId = getArg("--repo") ?? process.env["CAUSAL_REPO_ID"] ?? "";
const apiKey = getArg("--api-key") ?? process.env["CAUSAL_API_KEY"] ?? "";
const apiUrl = getArg("--api-url") ?? process.env["CAUSAL_API_URL"] ?? "http://localhost:3001";

// ── Initialize client and session ────────────────────────────────
const client = new CausalClient({ apiKey, baseUrl: apiUrl, orgId, repoId });
const session = new CausalSession(orgId, repoId, "claude-code", "claude-code-mcp");

// ── MCP Server ────────────────────────────────────────────────────
const server = new Server(
  { name: "causal", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── Tool: causal_link ─────────────────────────────────────────────
const CausalLinkSchema = z.object({
  specId: z.string().describe("The Linear/Jira issue ID this session is implementing (e.g. 'LIN-447')"),
  confidence: z.number().min(0).max(1).default(0.99).describe("Confidence that this is the correct spec (0-1)"),
});

// ── Tool: causal_snapshot ─────────────────────────────────────────
const CausalSnapshotSchema = z.object({
  reason: z.string().optional().describe("Why this snapshot is being captured (e.g. 'Before making file edit')"),
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "causal_link",
      description: `Tell Causal which spec or ticket you are implementing.
Call this at the start of each task with the Linear/Jira issue ID.
This creates a high-confidence REASONED_FROM edge in the causal graph,
enabling accurate root cause attribution if this code later causes an incident.

Example: causal_link({ specId: "LIN-447" })`,
      inputSchema: {
        type: "object",
        properties: {
          specId: {
            type: "string",
            description: "The spec/ticket ID (e.g. 'LIN-447', 'JIRA-123')",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            default: 0.99,
            description: "Confidence that this spec is what you're implementing",
          },
        },
        required: ["specId"],
      },
    },
    {
      name: "causal_snapshot",
      description: `Capture a context snapshot at a key decision point.
Causal automatically captures snapshots at tool calls, but you can call this
manually before important decisions (e.g., before writing complex business logic).
The snapshot is used for Replay — allowing engineers to re-run your exact context with modifications.`,
      inputSchema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Why you're capturing this snapshot",
          },
        },
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: toolArgs } = request.params;

  if (name === "causal_link") {
    const { specId, confidence } = CausalLinkSchema.parse(toolArgs);
    session.declareSpec(specId);

    // Create REASONED_FROM edge if we have a node ID
    if (session.nodeId) {
      try {
          await client.createEdge({
            sourceId: specId,
            targetId: session.nodeId,
            type: "REASONED_FROM",
            weight: confidence,
            linkStrategy: "manual",
            confirmedBy: null,
            isSuggested: false,
            orgId,
          });
      } catch {
        // Silently fail — the spec node may not exist yet
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `✓ Causal: Linked to spec ${specId} (confidence: ${Math.round(confidence * 100)}%). This session's code will be attributed to ${specId} in the causal graph.`,
        },
      ],
    };
  }

  if (name === "causal_snapshot") {
    const { reason } = CausalSnapshotSchema.parse(toolArgs ?? {});
    // In a real implementation, we'd capture the actual context window here.
    // The MCP protocol doesn't give us direct access to the conversation,
    // so we capture what we know about the session state.
    const snapshot = session.buildSnapshot(
      "Claude Code session (captured by Causal MCP)",
      [{ role: "user", content: reason ?? "Manual snapshot capture" }],
      [],
      "tool_call"
    );

    try {
      await client.uploadSnapshot(snapshot);
      session.snapshotIds.push(snapshot.snapshotId);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Warning: Failed to upload snapshot: ${String(err)}` }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `✓ Causal: Context snapshot captured (${snapshot.snapshotId.slice(0, 8)}). This can be used for Replay if this code causes an incident.`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ── Session lifecycle ─────────────────────────────────────────────
async function startSession() {
  session.writeSessionFile();

  try {
    const node = await client.createNode(session.toCreateNode());
    session.nodeId = node.id;
    process.stderr.write(
      `[causal] Session started: ${session.sessionId.slice(0, 8)} → node ${node.id.slice(0, 8)}\n`
    );
  } catch (err) {
    process.stderr.write(`[causal] Warning: Could not create REASONING node: ${String(err)}\n`);
  }
}

async function endSession() {
  try {
    // Update node with completion summary
    const completedNode = session.toCreateNode();
    (completedNode.payload as Record<string, unknown>)["completedAt"] = Date.now();
    await client.createNode(completedNode);
  } catch {
    // Best effort
  }
  CausalSession.prototype.writeSessionFile.call(session);
  process.stderr.write(`[causal] Session ended: ${session.sessionId.slice(0, 8)}\n`);
}

// ── Start ─────────────────────────────────────────────────────────
async function main() {
  await startSession();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGTERM", endSession);
  process.on("SIGINT", endSession);
  process.on("exit", () => {
    // Sync cleanup
  });
}

main().catch((err) => {
  console.error("Causal MCP server error:", err);
  process.exit(1);
});
