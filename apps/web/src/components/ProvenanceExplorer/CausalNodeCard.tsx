"use client";

import { memo } from "react";
import { Handle, Position } from "reactflow";
import type { NodeProps } from "reactflow";
import { GitCommit, Brain, FileCode, Zap, AlertTriangle, Target } from "lucide-react";
import type { CausalNode } from "@causal/types";

const LAYER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  INTENT:    Target,
  SPEC:      FileCode,
  REASONING: Brain,
  CODE:      GitCommit,
  EXECUTION: Zap,
  INCIDENT:  AlertTriangle,
};

interface NodeData {
  node: CausalNode;
  isOnCriticalPath: boolean;
  isRootCause: boolean;
  confidence?: number;
  color: string;
}

export const CausalNodeCard = memo(function CausalNodeCard({
  data,
  selected,
}: NodeProps<NodeData>) {
  const { node, isOnCriticalPath, isRootCause, confidence, color } = data;
  const Icon = LAYER_ICONS[node.layer] ?? FileCode;

  const title = getNodeTitle(node);
  const subtitle = getNodeSubtitle(node);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-gray-600 !border-gray-500" />

      <div
        className={`
          w-64 rounded-xl border transition-all duration-150
          ${selected
            ? "shadow-lg shadow-violet-500/20 border-violet-500"
            : isOnCriticalPath
            ? "border-violet-700"
            : "border-gray-700"}
          ${isRootCause ? "ring-2 ring-offset-1 ring-offset-gray-950" : ""}
          bg-gray-900 hover:border-gray-600
        `}
        style={isRootCause ? { boxShadow: `0 0 0 2px ${color}40` } : {}}
      >
        {/* Layer header */}
        <div
          className="px-3 py-2 rounded-t-xl flex items-center gap-2"
          style={{ backgroundColor: `${color}20`, borderBottom: `1px solid ${color}30` }}
        >
          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>
            {node.layer}
          </span>
          {isRootCause && confidence !== undefined && (
            <span className="ml-auto text-xs font-medium text-white bg-gray-700 px-1.5 py-0.5 rounded-full">
              {Math.round(confidence * 100)}%
            </span>
          )}
        </div>

        {/* Content */}
        <div className="px-3 py-3">
          <p className="text-sm font-medium text-white leading-tight line-clamp-2">{title}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-gray-500 font-mono truncate">{subtitle}</p>
          )}
        </div>

        {/* Critical path indicator */}
        {isOnCriticalPath && (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-1.5 text-xs text-violet-400">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
              Critical path
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-gray-600 !border-gray-500" />
    </>
  );
});

function getNodeTitle(node: CausalNode): string {
  const p = node.payload as Record<string, unknown>;
  return (
    (p["title"] as string) ??
    (p["commitMessage"] as string)?.split("\n")[0]?.slice(0, 60) ??
    (p["externalId"] as string) ??
    (p["summary"] as string)?.slice(0, 60) ??
    (p["operation"] as string) ??
    node.kind
  );
}

function getNodeSubtitle(node: CausalNode): string {
  const p = node.payload as Record<string, unknown>;
  switch (node.layer) {
    case "CODE":      return (p["commitHash"] as string)?.slice(0, 8) ?? "";
    case "REASONING": return (p["modelId"] as string) ?? (p["modelVersion"] as string) ?? "";
    case "SPEC":      return (p["externalId"] as string) ?? "";
    case "EXECUTION": return (p["spanId"] as string)?.slice(0, 12) ?? "";
    case "INCIDENT":  return (p["severity"] as string) ?? "";
    default:          return "";
  }
}
