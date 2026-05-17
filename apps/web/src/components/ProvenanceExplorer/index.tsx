"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import type { TraceGraph, CausalNode, CausalEdge } from "@causal/types";
import { CausalNodeCard } from "./CausalNodeCard";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { LAYER_ORDER } from "@causal/types";

interface ProvenanceExplorerProps {
  traceGraph: TraceGraph;
}

const LAYER_X: Record<string, number> = {
  INTENT:    0,
  SPEC:      1,
  REASONING: 2,
  CODE:      3,
  EXECUTION: 4,
  INCIDENT:  5,
};

const LAYER_COLORS: Record<string, string> = {
  INTENT:    "#7c3aed",
  SPEC:      "#2563eb",
  REASONING: "#0891b2",
  CODE:      "#059669",
  EXECUTION: "#d97706",
  INCIDENT:  "#dc2626",
};

const nodeTypes = { causal: CausalNodeCard };

export function ProvenanceExplorer({ traceGraph }: ProvenanceExplorerProps) {
  return (
    <ReactFlowProvider>
      <ProvenanceExplorerInner traceGraph={traceGraph} />
    </ReactFlowProvider>
  );
}

function ProvenanceExplorerInner({ traceGraph }: ProvenanceExplorerProps) {
  const [selectedNode, setSelectedNode] = useState<CausalNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<CausalEdge | null>(null);

  // ── Build react-flow nodes from trace graph ─────────────────────
  const initialNodes: Node[] = useMemo(() => {
    const layerGroups: Record<string, CausalNode[]> = {};
    for (const node of traceGraph.nodes) {
      if (!layerGroups[node.layer]) layerGroups[node.layer] = [];
      layerGroups[node.layer]!.push(node);
    }

    const result: Node[] = [];
    for (const [layer, layerNodes] of Object.entries(layerGroups)) {
      layerNodes.forEach((node, i) => {
        const isOnCriticalPath = traceGraph.criticalPath.includes(node.id);
        const isRootCause = traceGraph.rootCauses.some((rc) => rc.nodeId === node.id);

        result.push({
          id: node.id,
          type: "causal",
          position: {
            x: (LAYER_X[layer] ?? 0) * 320,
            y: i * 160,
          },
          data: {
            node,
            isOnCriticalPath,
            isRootCause,
            confidence: traceGraph.rootCauses.find((rc) => rc.nodeId === node.id)?.probability,
            color: LAYER_COLORS[layer] ?? "#6b7280",
          },
        });
      });
    }
    return result;
  }, [traceGraph]);

  // ── Build react-flow edges from trace graph ─────────────────────
  const initialEdges: Edge[] = useMemo(() => {
    return traceGraph.edges.map((edge) => {
      const isOnCriticalPath =
        traceGraph.criticalPath.includes(edge.sourceId) &&
        traceGraph.criticalPath.includes(edge.targetId);

      return {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: "smoothstep",
        animated: isOnCriticalPath,
        style: {
          stroke: isOnCriticalPath ? "#a78bfa" : "rgba(255,255,255,0.08)",
          strokeWidth: isOnCriticalPath ? 2.5 : 1,
          opacity: edge.isSuggested ? 0.5 : 1,
        },
        label: `${edge.type.toLowerCase().replace("_", " ")} (${Math.round(edge.weight * 100)}%)`,
        labelStyle: {
          fontSize: 9,
          fill: "rgba(255,255,255,0.25)",
          fontFamily: "JetBrains Mono, monospace",
          letterSpacing: "0.05em",
        },
        labelBgStyle: { fill: "#000000", fillOpacity: 0.9 },
        markerEnd: { type: MarkerType.ArrowClosed, color: isOnCriticalPath ? "#a78bfa" : "rgba(255,255,255,0.15)" },
        data: { edge },
      };
    });
  }, [traceGraph]);

  // ── ReactFlow state hooks — these manage internal positioning ───
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when trace graph data changes
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNode(node.data.node as CausalNode);
    setSelectedEdge(null);
  }, []);

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedEdge(edge.data?.edge as CausalEdge);
    setSelectedNode(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  return (
    <div className="flex h-full" style={{ width: '100%', height: '100%' }}>
      {/* Graph */}
      <div className="flex-1" style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          nodesDraggable={true}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          className="!bg-black"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={0.5}
            color="rgba(255,255,255,0.04)"
          />
          <Controls className="!bg-black !border-white/[0.08] !rounded-lg [&>button]:!bg-black [&>button]:!border-white/[0.06] [&>button]:!text-white/30 [&>button:hover]:!bg-white/[0.04]" />
          <MiniMap
            nodeColor={(node) => LAYER_COLORS[node.data?.node?.layer as string] ?? "#6b7280"}
            className="!bg-black !border-white/[0.08] !rounded-lg"
            maskColor="rgba(0,0,0,0.8)"
          />

          {/* Layer legend */}
          <div className="absolute top-4 left-4 border border-white/[0.06] rounded-xl p-4 text-xs space-y-2" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}>
            <p className="font-mono text-[9px] tracking-[0.2em] text-white/20 uppercase mb-2">Layers</p>
            {LAYER_ORDER.map((layer) => (
              <div key={layer} className="flex items-center gap-2.5">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: LAYER_COLORS[layer] }}
                />
                <span className="font-mono text-[10px] tracking-[0.1em] text-white/30 uppercase">{layer}</span>
              </div>
            ))}
          </div>

          {/* Critical path indicator */}
          {traceGraph.criticalPath.length > 0 && (
            <div className="absolute top-4 right-4 border border-violet-400/20 rounded-xl p-4 text-xs" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}>
              <div className="flex items-center gap-2 text-violet-400/60 font-mono text-[10px] tracking-[0.15em] uppercase mb-1">
                <div className="w-3 h-0.5 bg-violet-400/60" />
                Critical Path
              </div>
              <span className="font-mono text-[10px] text-white/20">{traceGraph.criticalPath.length} nodes</span>
            </div>
          )}
        </ReactFlow>
      </div>

      {/* Detail panel */}
      {(selectedNode || selectedEdge) && (
        <div className="w-96 border-l border-white/[0.06] overflow-y-auto flex-shrink-0">
          <NodeDetailPanel
            node={selectedNode}
            edge={selectedEdge}
            rootCauses={traceGraph.rootCauses}
            onClose={() => { setSelectedNode(null); setSelectedEdge(null); }}
          />
        </div>
      )}
    </div>
  );
}
