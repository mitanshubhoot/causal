import type { CausalNode, CausalEdge, CreateNode, CreateEdge, TraceGraph, ContextSnapshot } from "@causal/types";

export interface CausalClientOptions {
  apiKey?: string;
  baseUrl?: string;
  orgId?: string;
  repoId?: string;
  timeout?: number;
}

export class CausalClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  readonly orgId: string;
  readonly repoId: string;
  private readonly timeout: number;

  constructor(options: CausalClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env["CAUSAL_API_KEY"] ?? "";
    this.baseUrl = (options.baseUrl ?? process.env["CAUSAL_API_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
    this.orgId = options.orgId ?? process.env["CAUSAL_ORG_ID"] ?? "default";
    this.repoId = options.repoId ?? process.env["CAUSAL_REPO_ID"] ?? "";
    this.timeout = options.timeout ?? 10000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "@causal/sdk/0.1.0",
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Causal API error ${response.status}: ${text}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  async createNode(node: CreateNode): Promise<CausalNode> {
    return this.request<CausalNode>("/api/v1/nodes", {
      method: "POST",
      body: JSON.stringify({ ...node, orgId: node.orgId || this.orgId, repoId: node.repoId || this.repoId }),
    });
  }

  async createNodesBatch(nodes: CreateNode[]): Promise<{ created: number; nodes: CausalNode[] }> {
    return this.request("/api/v1/nodes/batch", {
      method: "POST",
      body: JSON.stringify(nodes.map((n) => ({
        ...n,
        orgId: n.orgId || this.orgId,
        repoId: n.repoId || this.repoId,
      }))),
    });
  }

  async createEdge(edge: CreateEdge): Promise<CausalEdge> {
    return this.request<CausalEdge>("/api/v1/edges", {
      method: "POST",
      body: JSON.stringify({ ...edge, orgId: edge.orgId || this.orgId }),
    });
  }

  async uploadSnapshot(snapshot: ContextSnapshot): Promise<{ snapshotId: string; key: string }> {
    return this.request("/api/v1/snapshots", {
      method: "POST",
      body: JSON.stringify(snapshot),
    });
  }

  async getNode(id: string): Promise<CausalNode> {
    return this.request<CausalNode>(`/api/v1/nodes/${id}`);
  }

  async getTrace(rootNodeId: string, options: { maxDepth?: number; minWeight?: number } = {}): Promise<TraceGraph> {
    return this.request<TraceGraph>("/api/v1/trace", {
      method: "POST",
      body: JSON.stringify({ rootNodeId, ...options }),
    });
  }

  async confirmEdge(edgeId: string, confirmed: boolean, userId: string): Promise<void> {
    await this.request(`/api/v1/edges/${edgeId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmed, userId }),
    });
  }
}
