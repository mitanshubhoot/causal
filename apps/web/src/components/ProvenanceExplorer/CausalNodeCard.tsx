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
      <Handle type="target" position={Position.Left} className="!bg-white/20 !border-white/10 !w-1.5 !h-1.5" />

      <div
        className={`
          w-64 rounded-xl border transition-all duration-200
          ${selected
            ? "shadow-lg border-violet-400/40"
            : isOnCriticalPath
            ? "border-violet-400/20"
            : "border-white/[0.08]"}
          ${isRootCause ? "ring-1 ring-offset-1 ring-offset-black" : ""}
          bg-black hover:border-white/[0.15]
        `}
        style={{
          ...(isRootCause ? { boxShadow: `0 0 20px ${color}15, 0 0 0 1px ${color}30` } : {}),
          ...(selected ? { boxShadow: `0 0 30px rgba(167,139,250,0.1)` } : {}),
        }}
      >
        {/* Layer header */}
        <div
          className="px-3 py-2 rounded-t-xl flex items-center gap-2"
          style={{ backgroundColor: `${color}08`, borderBottom: `1px solid ${color}15` }}
        >
          <span style={{ color: `${color}90` }}><Icon className="w-3.5 h-3.5 flex-shrink-0" /></span>
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase" style={{ color: `${color}aa` }}>
            {node.layer}
          </span>
          {isRootCause && confidence !== undefined && (
            <span className="ml-auto font-mono text-[9px] tracking-[0.1em] text-white/60 bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded-full">
              {Math.round(confidence * 100)}%
            </span>
          )}
        </div>

        {/* Content */}
        <div className="px-3 py-3">
          <p className="text-[12px] font-medium text-white/80 leading-tight line-clamp-2">{title}</p>
          {subtitle && (
            <p className="mt-1 text-[10px] text-white/20 font-mono truncate">{subtitle}</p>
          )}
        </div>

        {/* Critical path indicator */}
        {isOnCriticalPath && (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.12em] text-violet-400/50 uppercase">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400/50 animate-pulse" />
              Critical path
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-white/20 !border-white/10 !w-1.5 !h-1.5" />
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
