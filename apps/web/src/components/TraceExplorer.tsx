"use client";

import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Brain,
  FileCode,
  GitCommit,
  Zap,
  Target,
  Clock,
  Copy,
  CheckCircle,
  ExternalLink,
} from "lucide-react";
import type { TraceGraph, CausalNode, CausalEdge, RootCause } from "@causal/types";

// ── Layer config ─────────────────────────────────────────────────
const LAYER_CONFIG: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
}> = {
  INTENT:    { icon: Target,        color: "#7c3aed", label: "Intent" },
  SPEC:      { icon: FileCode,      color: "#2563eb", label: "Spec" },
  REASONING: { icon: Brain,         color: "#0891b2", label: "Reasoning" },
  CODE:      { icon: GitCommit,     color: "#059669", label: "Code" },
  EXECUTION: { icon: Zap,           color: "#d97706", label: "Execution" },
  INCIDENT:  { icon: AlertTriangle, color: "#dc2626", label: "Incident" },
};

const LAYER_ORDER = ["INTENT", "SPEC", "REASONING", "CODE", "EXECUTION", "INCIDENT"];

interface TraceExplorerProps {
  traceGraph: TraceGraph;
}

// ── Build tree structure from flat nodes ──────────────────────────
interface TreeNode {
  node: CausalNode;
  children: TreeNode[];
  edge?: CausalEdge;
  depth: number;
  hasError: boolean;
}

function buildTree(nodes: CausalNode[], edges: CausalEdge[]): TreeNode[] {
  // Sort nodes by layer order, then by timestamp
  const sorted = [...nodes].sort((a, b) => {
    const layerDiff = LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer);
    if (layerDiff !== 0) return layerDiff;
    return a.timestamp - b.timestamp;
  });

  // Build parent-child relationships from edges
  const childMap = new Map<string, { nodeId: string; edge: CausalEdge }[]>();
  for (const edge of edges) {
    if (!childMap.has(edge.sourceId)) childMap.set(edge.sourceId, []);
    childMap.get(edge.sourceId)!.push({ nodeId: edge.targetId, edge });
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set<string>();

  function buildSubtree(nodeId: string, edge: CausalEdge | undefined, depth: number): TreeNode | null {
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) return null;

    const childEntries = childMap.get(nodeId) ?? [];
    const children: TreeNode[] = [];
    for (const { nodeId: childId, edge: childEdge } of childEntries) {
      const child = buildSubtree(childId, childEdge, depth + 1);
      if (child) children.push(child);
    }

    const payload = node.payload as Record<string, unknown>;
    const hasError = node.layer === "INCIDENT" ||
      !!(payload["error"] as string) ||
      !!(payload["stackTrace"] as string);

    return { node, children, edge, depth, hasError };
  }

  // Find root nodes (INTENT layer, or nodes with no incoming edges)
  const targetIds = new Set(edges.map(e => e.targetId));
  const rootNodeIds = sorted
    .filter(n => !targetIds.has(n.id))
    .map(n => n.id);

  // If no roots found, use the first node by layer order
  if (rootNodeIds.length === 0 && sorted.length > 0) {
    rootNodeIds.push(sorted[0]!.id);
  }

  const tree: TreeNode[] = [];
  for (const rootId of rootNodeIds) {
    const root = buildSubtree(rootId, undefined, 0);
    if (root) tree.push(root);
  }

  // Add any unvisited nodes as standalone entries
  for (const node of sorted) {
    if (!visited.has(node.id)) {
      const payload = node.payload as Record<string, unknown>;
      tree.push({
        node,
        children: [],
        edge: undefined,
        depth: 0,
        hasError: node.layer === "INCIDENT" || !!(payload["error"] as string),
      });
    }
  }

  return tree;
}

// ── Node title/subtitle helpers ──────────────────────────────────
function getNodeTitle(node: CausalNode): string {
  const p = node.payload as Record<string, unknown>;
  return (
    (p["title"] as string) ??
    (p["commitMessage"] as string)?.split("\n")[0]?.slice(0, 50) ??
    (p["operation"] as string) ??
    (p["summary"] as string)?.slice(0, 50) ??
    (p["externalId"] as string) ??
    node.kind
  );
}

function getNodeMeta(node: CausalNode): string {
  const p = node.payload as Record<string, unknown>;
  const parts: string[] = [];
  if (p["latencyMs"]) parts.push(`${p["latencyMs"]}ms`);
  if (p["totalTokens"]) parts.push(`${p["totalTokens"]} tok`);
  if (p["modelId"] || node.modelVersion) parts.push((p["modelId"] as string) ?? node.modelVersion ?? "");
  if (p["commitHash"]) parts.push((p["commitHash"] as string).slice(0, 8));
  return parts.join(" · ");
}

function getTimeStr(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── Tree Node Component ──────────────────────────────────────────
function TreeNodeRow({
  treeNode,
  selectedId,
  onSelect,
  criticalPath,
  rootCauseIds,
  defaultExpanded = true,
}: {
  treeNode: TreeNode;
  selectedId: string | null;
  onSelect: (node: CausalNode) => void;
  criticalPath: string[];
  rootCauseIds: string[];
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { node, children, hasError } = treeNode;
  const config = LAYER_CONFIG[node.layer] ?? LAYER_CONFIG.INCIDENT!;
  const isSelected = selectedId === node.id;
  const isOnCriticalPath = criticalPath.includes(node.id);
  const isRootCause = rootCauseIds.includes(node.id);
  const title = getNodeTitle(node);
  const meta = getNodeMeta(node);

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-2 px-2 cursor-pointer transition-colors duration-150 group rounded-md mx-1.5 ${
          isSelected
            ? "bg-white/10"
            : "hover:bg-white/[0.04]"
        }`}
        style={{ paddingLeft: `${treeNode.depth * 18 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        {/* Expand/collapse */}
        {children.length > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="text-white/40 hover:text-white/80 transition-colors flex-shrink-0 w-4 h-4 flex items-center justify-center"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <div className="w-4 flex-shrink-0" />
        )}

        {/* Icon + root cause marker */}
        <span className="flex-shrink-0 relative">
          <span style={{ color: config.color }}>
            <config.icon className="w-4 h-4" />
          </span>
          {isRootCause && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-violet-400 rounded-full border border-black" />
          )}
        </span>

        {/* Title */}
        <span className={`text-[13px] truncate flex-1 ${isSelected ? "text-white font-medium" : "text-white/85"} ${isOnCriticalPath && !isSelected ? "font-medium" : ""}`}>
          {title}
        </span>

        {/* Root cause badge */}
        {isRootCause && (
          <span className="font-mono text-[9px] tracking-[0.1em] uppercase bg-violet-500/20 text-violet-300 border border-violet-500/40 px-1.5 py-0.5 rounded flex-shrink-0 font-semibold">
            ROOT CAUSE
          </span>
        )}

        {/* Meta (duration, tokens) */}
        {meta && !isRootCause && (
          <span className="font-mono text-[10px] text-white/45 flex-shrink-0 truncate max-w-[140px]">
            {meta}
          </span>
        )}

        {/* Error badge */}
        {hasError && (
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase bg-red-500/20 text-red-300 border border-red-500/40 px-1.5 py-0.5 rounded flex-shrink-0 font-semibold">
            ERROR
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && children.map((child) => (
        <TreeNodeRow
          key={child.node.id}
          treeNode={child}
          selectedId={selectedId}
          onSelect={onSelect}
          criticalPath={criticalPath}
          rootCauseIds={rootCauseIds}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </div>
  );
}

// ── Detail Panel ─────────────────────────────────────────────────
function DetailPanel({
  node,
  rootCauses,
  edges,
}: {
  node: CausalNode;
  rootCauses: RootCause[];
  edges: CausalEdge[];
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const config = LAYER_CONFIG[node.layer] ?? LAYER_CONFIG.INCIDENT!;
  const rootCause = rootCauses.find(rc => rc.nodeId === node.id);
  const payload = node.payload as Record<string, unknown>;

  const copyText = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  // Find connected edges
  const inEdges = edges.filter(e => e.targetId === node.id);
  const outEdges = edges.filter(e => e.sourceId === node.id);

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2.5 mb-2">
          <span style={{ color: config.color }}>
            <config.icon className="w-[18px] h-[18px]" />
          </span>
          <h2 className="text-[16px] font-semibold text-white tracking-tight">{config.label}</h2>
          <button
            onClick={() => copyText(node.id, "id")}
            className="text-white/40 hover:text-white/80 transition-colors ml-1"
            title="Copy node ID"
          >
            {copiedField === "id" ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="font-mono text-[11px] text-white/55">{getTimeStr(node.timestamp)}</p>

        {/* Meta pills */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="font-mono text-[10px] tracking-[0.08em] text-white/55 uppercase">
            Kind: <span className="text-white/90 font-medium">{node.kind}</span>
          </span>
          {node.modelVersion && (
            <span className="font-mono text-[10px] tracking-[0.04em] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
              {node.modelVersion}
            </span>
          )}
          {(payload["modelId"] as string) && (
            <span className="font-mono text-[10px] tracking-[0.04em] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
              {payload["modelId"] as string}
            </span>
          )}
          {payload["latencyMs"] !== undefined && (
            <span className="font-mono text-[10px] text-white/70">
              ⏱ {String(payload["latencyMs"])}ms
            </span>
          )}
          {!!payload["totalTokens"] && (
            <span className="font-mono text-[10px] text-white/70">
              ⊙ {String(payload["totalTokens"])} tokens
            </span>
          )}
          {(payload["severity"] as string) && (
            <span className={`font-mono text-[10px] tracking-[0.08em] uppercase px-2 py-0.5 rounded border font-semibold ${
              payload["severity"] === "P1" ? "text-red-300 bg-red-500/15 border-red-500/40" :
              payload["severity"] === "P2" ? "text-amber-300 bg-amber-500/15 border-amber-500/40" :
              "text-yellow-300 bg-yellow-500/15 border-yellow-500/40"
            }`}>
              {payload["severity"] as string}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Root cause section */}
        {rootCause && (
          <div className="px-6 py-5 border-b border-white/10">
            <h3 className="font-mono text-[11px] tracking-[0.18em] text-violet-300 uppercase mb-3 font-semibold">Root Cause Analysis</h3>
            <p className="text-[14px] text-white/95 leading-relaxed mb-3">{rootCause.explanation}</p>
            {rootCause.counterfactual && (
              <div className="bg-white/[0.04] border border-white/10 rounded-lg p-4 mt-3">
                <p className="font-mono text-[10px] tracking-[0.15em] text-cyan-300 uppercase mb-1.5 font-semibold">Counterfactual</p>
                <p className="text-[13px] text-white/80 leading-relaxed">{rootCause.counterfactual}</p>
              </div>
            )}
            {rootCause.interventionPoint && (
              <div className="mt-3">
                <span className="font-mono text-[10px] tracking-[0.1em] text-white/60 uppercase font-semibold">Fix: </span>
                <span className="text-[13px] text-white/85">{rootCause.interventionPoint}</span>
              </div>
            )}
          </div>
        )}

        {/* Error section */}
        {(payload["error"] as string) && (
          <div className="px-6 py-5 border-b border-white/10">
            <h3 className="font-mono text-[11px] tracking-[0.18em] text-red-300 uppercase mb-2.5 font-semibold">Error</h3>
            <div className="bg-red-500/[0.08] border border-red-500/25 rounded-lg p-4">
              <p className="font-mono text-[12px] text-red-200 leading-relaxed">{payload["error"] as string}</p>
            </div>
          </div>
        )}

        {/* Stack trace */}
        {(payload["stackTrace"] as string) && (
          <div className="px-6 py-5 border-b border-white/10">
            <h3 className="font-mono text-[11px] tracking-[0.18em] text-white/65 uppercase mb-2.5 font-semibold">Stack Trace</h3>
            <pre className="font-mono text-[12px] text-white/85 bg-white/[0.04] border border-white/10 rounded-lg p-4 overflow-x-auto leading-relaxed">
              {payload["stackTrace"] as string}
            </pre>
          </div>
        )}

        {/* Payload */}
        <div className="px-6 py-5 border-b border-white/10">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="font-mono text-[11px] tracking-[0.18em] text-white/65 uppercase font-semibold">Payload</h3>
            <button
              onClick={() => copyText(JSON.stringify(payload, null, 2), "payload")}
              className="text-white/40 hover:text-white/80 transition-colors"
              title="Copy payload JSON"
            >
              {copiedField === "payload" ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <pre className="font-mono text-[12px] text-white/75 bg-white/[0.04] border border-white/10 rounded-lg p-4 overflow-x-auto leading-relaxed max-h-[320px]">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>

        {/* Connections */}
        {(inEdges.length > 0 || outEdges.length > 0) && (
          <div className="px-6 py-5 border-b border-white/10">
            <h3 className="font-mono text-[11px] tracking-[0.18em] text-white/65 uppercase mb-3 font-semibold">Connections</h3>
            <div className="space-y-1.5">
              {inEdges.map(e => (
                <div key={e.id} className="flex items-center gap-2 text-[12px]">
                  <span className="text-white/55 font-mono w-3">←</span>
                  <span className="font-mono text-white/85">{e.type.toLowerCase().replace("_", " ")}</span>
                  <span className="font-mono text-white/65">{Math.round(e.weight * 100)}%</span>
                  <span className="font-mono text-[11px] text-white/45">{e.linkStrategy}</span>
                </div>
              ))}
              {outEdges.map(e => (
                <div key={e.id} className="flex items-center gap-2 text-[12px]">
                  <span className="text-white/55 font-mono w-3">→</span>
                  <span className="font-mono text-white/85">{e.type.toLowerCase().replace("_", " ")}</span>
                  <span className="font-mono text-white/65">{Math.round(e.weight * 100)}%</span>
                  <span className="font-mono text-[11px] text-white/45">{e.linkStrategy}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Node metadata */}
        <div className="px-6 py-5">
          <h3 className="font-mono text-[11px] tracking-[0.18em] text-white/65 uppercase mb-3 font-semibold">Metadata</h3>
          <div className="space-y-2">
            <MetaRow label="Node ID" value={node.id} mono />
            <MetaRow label="Layer" value={node.layer} />
            <MetaRow label="Kind" value={node.kind} />
            {node.sessionId && <MetaRow label="Session" value={node.sessionId} mono />}
            {node.agentId && <MetaRow label="Agent" value={node.agentId} />}
            {node.modelVersion && <MetaRow label="Model" value={node.modelVersion} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-mono text-[10px] tracking-[0.1em] text-white/55 uppercase flex-shrink-0 w-20 pt-0.5 font-semibold">{label}</span>
      <span className={`text-[12px] text-white/90 break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

// ── Root Cause Summary Banner ────────────────────────────────────
function RootCauseBanner({ rootCauses, nodes }: { rootCauses: RootCause[]; nodes: CausalNode[] }) {
  const primary = rootCauses[0];
  if (!primary) return null;
  const rcNode = nodes.find(n => n.id === primary.nodeId);
  const rcConfig = LAYER_CONFIG[rcNode?.layer ?? "INCIDENT"] ?? LAYER_CONFIG.INCIDENT!;

  return (
    <div className="px-6 py-5 border-b border-violet-400/20 bg-violet-500/[0.06] flex-shrink-0">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-2 h-2 rounded-full bg-violet-400 ring-2 ring-violet-400/30" />
        <span className="font-mono text-[11px] tracking-[0.18em] text-violet-200 uppercase font-semibold">
          Root Cause · {rcConfig.label}
        </span>
        <span className="font-mono text-[11px] text-violet-300/80 ml-auto font-medium">
          {Math.round(primary.probability * 100)}% confidence
        </span>
      </div>
      <p className="text-[14px] text-white/95 leading-relaxed mb-3">{primary.explanation}</p>
      {primary.counterfactual && (
        <div className="bg-white/[0.04] border border-white/10 rounded-lg p-4 mt-3">
          <p className="font-mono text-[10px] tracking-[0.15em] text-cyan-300 uppercase mb-1.5 font-semibold">
            What would have prevented this
          </p>
          <p className="text-[13px] text-white/85 leading-relaxed">{primary.counterfactual}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────
export function TraceExplorer({ traceGraph }: TraceExplorerProps) {
  const [selectedNode, setSelectedNode] = useState<CausalNode | null>(null);

  const tree = useMemo(
    () => buildTree(traceGraph.nodes, traceGraph.edges),
    [traceGraph]
  );

  const rootCauseIds = useMemo(
    () => traceGraph.rootCauses.map(rc => rc.nodeId),
    [traceGraph]
  );

  // Auto-select the incident node initially
  const incidentNode = useMemo(
    () => traceGraph.nodes.find(n => n.layer === "INCIDENT") ?? traceGraph.nodes[0] ?? null,
    [traceGraph]
  );

  const activeNode = selectedNode ?? incidentNode;

  return (
    <div className="flex h-full bg-black">
      {/* Left panel — Trace tree */}
      <div className="w-[340px] border-r border-white/10 flex flex-col flex-shrink-0">
        {/* Tree header */}
        <div className="px-4 py-3.5 border-b border-white/10 flex items-center gap-2.5">
          <span className="font-mono text-[11px] tracking-[0.18em] text-white/85 uppercase font-semibold">
            Trace
          </span>
          <span className="font-mono text-[10px] text-white/55">
            {traceGraph.id.slice(0, 12)}
          </span>
        </div>

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto py-2">
          {tree.map((treeNode) => (
            <TreeNodeRow
              key={treeNode.node.id}
              treeNode={treeNode}
              selectedId={activeNode?.id ?? null}
              onSelect={setSelectedNode}
              criticalPath={traceGraph.criticalPath}
              rootCauseIds={rootCauseIds}
            />
          ))}
        </div>

        {/* Tree footer stats */}
        <div className="px-4 py-3 border-t border-white/10 flex items-center gap-4 bg-white/[0.02]">
          <span className="font-mono text-[11px] text-white/70">
            {traceGraph.nodes.length} nodes
          </span>
          <span className="font-mono text-[11px] text-white/70">
            {traceGraph.edges.length} edges
          </span>
          {traceGraph.confidence !== undefined && (
            <span className="font-mono text-[11px] text-emerald-300 font-medium ml-auto">
              {Math.round(traceGraph.confidence * 100)}% conf
            </span>
          )}
        </div>
      </div>

      {/* Right panel — Root cause banner + detail view */}
      <div className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* Always-visible root cause summary */}
        <RootCauseBanner rootCauses={traceGraph.rootCauses} nodes={traceGraph.nodes} />

        {/* Selected node detail */}
        <div className="flex-1 overflow-hidden">
          {activeNode ? (
            <DetailPanel
              node={activeNode}
              rootCauses={traceGraph.rootCauses}
              edges={traceGraph.edges}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="font-mono text-[12px] text-white/55 tracking-[0.1em] uppercase">
                Select a node to view details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
