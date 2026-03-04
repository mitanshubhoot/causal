"use client";

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import type { TraceGraph, CausalNode, CausalEdge, RootCause } from "@causal/types";
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
  const [selectedNode, setSelectedNode] = useState<CausalNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<CausalEdge | null>(null);

  // ── Convert CausalNodes → react-flow nodes ──────────────────────
  const rfNodes: Node[] = useMemo(() => {
    const layerGroups: Record<string, CausalNode[]> = {};
    for (const node of traceGraph.nodes) {
      if (!layerGroups[node.layer]) layerGroups[node.layer] = [];
      layerGroups[node.layer]!.push(node);
    }

    const nodes: Node[] = [];
    for (const [layer, layerNodes] of Object.entries(layerGroups)) {
      layerNodes.forEach((node, i) => {
        const isOnCriticalPath = traceGraph.criticalPath.includes(node.id);
        const isRootCause = traceGraph.rootCauses.some((rc) => rc.nodeId === node.id);

        nodes.push({
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
          selected: selectedNode?.id === node.id,
        });
      });
    }
    return nodes;
  }, [traceGraph, selectedNode]);

  // ── Convert CausalEdges → react-flow edges ──────────────────────
  const rfEdges: Edge[] = useMemo(() => {
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
          stroke: isOnCriticalPath ? "#a78bfa" : "#4b5563",
          strokeWidth: isOnCriticalPath ? 2.5 : 1.5,
          opacity: edge.isSuggested ? 0.5 : 1,
        },
        label: `${edge.type.toLowerCase().replace("_", " ")} (${Math.round(edge.weight * 100)}%)`,
        labelStyle: {
          fontSize: 10,
          fill: "#9ca3af",
          fontFamily: "JetBrains Mono, monospace",
        },
        labelBgStyle: { fill: "#111827", fillOpacity: 0.8 },
        markerEnd: { type: MarkerType.ArrowClosed, color: isOnCriticalPath ? "#a78bfa" : "#6b7280" },
        data: { edge },
      };
    });
  }, [traceGraph]);

  const [nodes, , onNodesChange] = useNodesState(rfNodes);
  const [edges, , onEdgesChange] = useEdgesState(rfEdges);

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
    <div className="flex h-full">
      {/* Graph */}
      <div className="flex-1 h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          className="bg-gray-950"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#1f2937"
          />
          <Controls className="!bg-gray-900 !border-gray-700" />
          <MiniMap
            nodeColor={(node) => LAYER_COLORS[node.data?.node?.layer as string] ?? "#6b7280"}
            className="!bg-gray-900 !border-gray-700"
          />

          {/* Layer legend */}
          <div className="absolute top-4 left-4 bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs space-y-1.5">
            {LAYER_ORDER.map((layer) => (
              <div key={layer} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: LAYER_COLORS[layer] }}
                />
                <span className="text-gray-400">{layer}</span>
              </div>
            ))}
          </div>

          {/* Critical path indicator */}
          {traceGraph.criticalPath.length > 0 && (
            <div className="absolute top-4 right-4 bg-gray-900 border border-violet-800 rounded-lg p-3 text-xs">
              <div className="flex items-center gap-1.5 text-violet-400 font-medium mb-1">
                <div className="w-2 h-0.5 bg-violet-400" />
                Critical Path
              </div>
              <span className="text-gray-500">{traceGraph.criticalPath.length} nodes</span>
            </div>
          )}
        </ReactFlow>
      </div>

      {/* Detail panel */}
      {(selectedNode || selectedEdge) && (
        <div className="w-96 border-l border-gray-800 overflow-y-auto flex-shrink-0">
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
