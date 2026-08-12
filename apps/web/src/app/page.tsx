"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import {
  FEATURED_INCIDENT_ID,
  getMockPostMortem,
  getMockReplay,
  getMockTrace,
} from "@/lib/mock-data";
import { getDatasets, getRuns } from "@/lib/mock-evals";
import { getAllDemos, getDetectors, getTraceList } from "@/lib/mock-observability";
import {
  ASI_IDS,
  DETECTIONS,
  POSTURE,
  SECURITY_EVENTS,
  computeScore,
  getEvent,
} from "@/lib/mock-security";
import type { Origin } from "@/lib/security-types";
import { ScrambleText } from "@/components/ScrambleText";
import { LandingTraceDemo } from "@/components/LandingTraceDemo";
import { LandingCapabilityTour } from "@/components/LandingCapabilityTour";
import { FailureTicker } from "@/components/FailureTicker";
import { InstallWidget } from "@/components/InstallWidget";
import { MagneticButton } from "@/components/MagneticButton";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  GitBranch,
  Activity,
  Code2,
  Webhook,
  Search,
  Shield,
  Radar,
  Waypoints,
  Zap,
  FileText,
  Cpu,
  Database,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import {
  motion,
  MotionConfig,
  useMotionValue,
  useTransform,
  animate,
  useInView,
  useScroll,
  useSpring,
} from "framer-motion";

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION VARIANTS — shared across sections
// ─────────────────────────────────────────────────────────────────────────────

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.9, ease: EASE_OUT },
  },
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.8, ease: "easeOut" as const },
  },
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const staggerFast = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const cardVariant = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE_OUT },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGO
// ─────────────────────────────────────────────────────────────────────────────

function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" stroke="white" strokeWidth="1.5" opacity="0.9" />
      <circle cx="20" cy="20" r="11" stroke="white" strokeWidth="1" opacity="0.6" />
      <circle cx="20" cy="20" r="5" fill="white" opacity="0.8" />
      <path d="M20 2 L20 8" stroke="white" strokeWidth="1" opacity="0.4" />
      <path d="M20 32 L20 38" stroke="white" strokeWidth="1" opacity="0.4" />
      <path d="M2 20 L8 20" stroke="white" strokeWidth="1" opacity="0.4" />
      <path d="M32 20 L38 20" stroke="white" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAR FIELD
// ─────────────────────────────────────────────────────────────────────────────

function StarField() {
  const stars = Array.from({ length: 100 }).map((_, i) => {
    const seed = i * 7919;
    const x = ((seed * 13) % 10000) / 100;
    const y = ((seed * 17) % 10000) / 100;
    const size = 0.6 + ((seed * 3) % 12) / 10;
    const baseOpacity = 0.06 + ((seed * 11) % 30) / 100;
    const twinkle = i % 6 === 0;
    const delay = ((seed * 7) % 8000) / 1000;
    return { x, y, size, baseOpacity, twinkle, delay };
  });

  return (
    <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
      {stars.map(({ x, y, size, baseOpacity, twinkle, delay }, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: `${size}px`,
            height: `${size}px`,
            opacity: baseOpacity,
            ...(twinkle
              ? { animation: `star-twinkle ${4 + (i % 5)}s ease-in-out ${delay}s infinite` }
              : {}),
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV — with scroll progress bar
// ─────────────────────────────────────────────────────────────────────────────

function Nav() {
  const links = [
    { label: "PRODUCT", href: "#product" },
    { label: "HOW IT WORKS", href: "#how-it-works" },
    { label: "FEATURES", href: "#features" },
    { label: "INTEGRATIONS", href: "#integrations" },
    { label: "PRICING", href: "#pricing" },
  ];

  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });
  // The 1px rail bleeds through the six layer accents in order — scrolling the
  // site literally descends the causal model INTENT→…→INCIDENT.
  const railColor = useTransform(
    scrollYProgress,
    [0, 0.2, 0.4, 0.6, 0.8, 1],
    ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626"]
  );

  return (
    <>
      {/* Scroll progress bar */}
      <motion.div
        className="scroll-progress"
        style={{ scaleX, backgroundColor: railColor, width: "100%" }}
      />

      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-black/60 border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark size={28} />
            <span className="text-[15px] font-semibold text-white tracking-wide">Causal</span>
          </Link>

          <div className="hidden md:flex items-center gap-10">
            {links.map(({ label, href }) => (
              <Link
                key={label}
                href={href}
                className="font-mono text-[11px] tracking-[0.2em] text-white/40 hover:text-white transition-colors duration-300"
              >
                {label}
              </Link>
            ))}
          </div>

          <Link href="/incidents" className="xai-btn text-[11px]">
            GET STARTED
          </Link>
        </div>
      </nav>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAUSAL GRAPH BACKGROUND — full-screen animated graph network
// ─────────────────────────────────────────────────────────────────────────────

function CausalGraphBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Respect reduced-motion (draw one static frame, no loop) and pause the
    // loop when the hero scrolls off-screen or the tab is hidden.
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let running = true;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * DPR;
      canvas.height = window.innerHeight * DPR;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    const onMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    };
    window.addEventListener("mousemove", onMouse);

    // Deterministic pseudo-random — no Math.random() in hot path
    const sr = (seed: number) => {
      const x = Math.sin(seed * 9301 + 49297) * 233280;
      return x - Math.floor(x);
    };

    const layerX = [0.08, 0.22, 0.38, 0.55, 0.70, 0.84];
    // The real six-layer causal model — must match the product (was lying with
    // INFERENCE/LOGIC/STATE/FAILURE).
    const LAYER_LABELS = ["INTENT", "SPEC", "REASONING", "CODE", "EXECUTION", "INCIDENT"];
    // Real per-layer accents (LAYER_CONFIG / tailwind tokens), as rgb triples.
    const LAYER_RGB = [
      "124,58,237",  // INTENT   violet
      "37,99,235",   // SPEC     blue
      "8,145,178",   // REASONING cyan (the root-cause layer for the demo incident)
      "5,150,105",   // CODE     green
      "217,119,6",   // EXECUTION amber
      "220,38,38",   // INCIDENT red
    ];

    type NodeType = "start" | "normal" | "failure";
    interface GraphNode {
      id: number; layer: number; x: number; y: number;
      nodeType: NodeType; critical: boolean; label?: string;
      radius: number; phase: number; driftA: number;
    }

    const rawNodes: { layer: number; y: number; nodeType: NodeType; label?: string }[] = [
      { layer: 0, y: 0.46, nodeType: "start",   label: "entry"     },
      { layer: 1, y: 0.28, nodeType: "normal",  label: "spec.a"    },
      { layer: 1, y: 0.63, nodeType: "normal",  label: "spec.b"    },
      { layer: 2, y: 0.17, nodeType: "normal"                       },
      { layer: 2, y: 0.44, nodeType: "normal",  label: "llm.call"  },
      { layer: 2, y: 0.72, nodeType: "normal"                       },
      { layer: 3, y: 0.14, nodeType: "normal"                       },
      { layer: 3, y: 0.33, nodeType: "normal"                       },
      { layer: 3, y: 0.53, nodeType: "normal",  label: "eval"      },
      { layer: 3, y: 0.74, nodeType: "normal"                       },
      { layer: 4, y: 0.24, nodeType: "normal"                       },
      { layer: 4, y: 0.47, nodeType: "normal",  label: "state.read" },
      { layer: 4, y: 0.70, nodeType: "normal"                       },
      { layer: 5, y: 0.36, nodeType: "failure", label: "ERR_ROOT"  },
      { layer: 5, y: 0.62, nodeType: "failure", label: "ERR_SIDE"  },
    ];

    const criticalSet = new Set([0, 2, 4, 8, 11, 13]);
    const CRITICAL_PATH = [0, 2, 4, 8, 11, 13];

    const nodes: GraphNode[] = rawNodes.map((n, i) => ({
      id: i, layer: n.layer,
      x: layerX[n.layer], y: n.y,
      nodeType: n.nodeType, critical: criticalSet.has(i), label: n.label,
      radius: n.nodeType === "start" ? 6 : n.nodeType === "failure" ? 5 : 2.5 + sr(i) * 2,
      phase: sr(i + 100) * Math.PI * 2,
      driftA: sr(i + 200) * Math.PI * 2,
    }));

    const criticalEdgeKeys = new Set(["0-2", "2-4", "4-8", "8-11", "11-13"]);
    const edgePairs: [number, number][] = [
      [0, 1], [0, 2],
      [1, 3], [1, 4], [2, 4], [2, 5],
      [3, 6], [3, 7], [4, 7], [4, 8], [5, 8], [5, 9],
      [6, 10], [7, 10], [7, 11], [8, 11], [8, 12], [9, 12],
      [10, 13], [11, 13], [11, 14], [12, 14],
    ];

    const edges = edgePairs.map(([f, t], ei) => {
      const isCritical = criticalEdgeKeys.has(`${f}-${t}`);
      return {
        from: f, to: t, critical: isCritical,
        particles: Array.from({ length: isCritical ? 8 : 2 }, (_, pi) => ({
          t: sr(ei * 10 + pi),
          speed: isCritical
            ? 0.002 + sr(ei * 10 + pi + 500) * 0.0015
            : 0.0006 + sr(ei * 10 + pi + 500) * 0.0004,
        })),
      };
    });

    // Ordered critical edges for cascade
    const criticalEdgesOrdered = [
      edges.find(e => e.from === 0  && e.to === 2)!,
      edges.find(e => e.from === 2  && e.to === 4)!,
      edges.find(e => e.from === 4  && e.to === 8)!,
      edges.find(e => e.from === 8  && e.to === 11)!,
      edges.find(e => e.from === 11 && e.to === 13)!,
    ];

    // Ripple pool
    const ripples: { nodeIdx: number; t: number }[] = [];
    let nextRippleAt = 1.2;
    let animId: number;
    let time = 0;

    const draw = () => {
      time += 0.008;
      const W = canvas.width;
      const H = canvas.height;
      const m = mouseRef.current;
      const mx = (m.x - 0.5) * 0.025;
      const my = (m.y - 0.5) * 0.018;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);

      // ── Dot grid ──
      const gStep = Math.round(W / 28);
      for (let gx = gStep; gx < W; gx += gStep) {
        for (let gy = Math.round(gStep * 0.7); gy < H; gy += gStep) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.9, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.fill();
        }
      }

      // ── Slow horizontal scan beam ──
      const scanX = ((time * 0.055) % 1.25 - 0.1) * W;
      const scanG = ctx.createLinearGradient(scanX - 90, 0, scanX + 90, 0);
      scanG.addColorStop(0, "rgba(255,255,255,0)");
      scanG.addColorStop(0.5, "rgba(255,255,255,0.018)");
      scanG.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = scanG;
      ctx.fillRect(0, 0, W, H);

      // ── Ambient glow (right side) ──
      const ag = ctx.createRadialGradient(W * 0.65, H * 0.5, 0, W * 0.65, H * 0.5, W * 0.55);
      ag.addColorStop(0, "rgba(255,255,255,0.018)");
      ag.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ag;
      ctx.fillRect(0, 0, W, H);

      // Failure zone red bleed
      const pulseRed = 0.5 + 0.5 * Math.sin(time * 1.6);
      const rg = ctx.createRadialGradient(W * 0.86, H * 0.5, 0, W * 0.86, H * 0.5, W * 0.32);
      rg.addColorStop(0, `rgba(255,50,30,${0.038 + 0.022 * pulseRed})`);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);

      // ── Layer labels ──
      ctx.save();
      ctx.textAlign = "center";
      for (let li = 0; li < layerX.length; li++) {
        const lx = (layerX[li] + mx) * W;
        ctx.font = `600 ${10 * DPR}px ui-monospace, "SF Mono", monospace`;
        // Tint each column label with its real layer accent; incident brighter.
        const alpha = li === 5 ? 0.6 : 0.42;
        ctx.fillStyle = `rgba(${LAYER_RGB[li]},${alpha})`;
        ctx.fillText(LAYER_LABELS[li], lx, 46 * DPR);
      }
      ctx.restore();

      // ── Live node positions ──
      const pos = nodes.map((n) => {
        const drift = Math.sin(time * 0.18 + n.phase) * 0.007;
        return {
          cx: (n.x + Math.cos(n.driftA) * drift + mx) * W,
          cy: (n.y + Math.sin(n.driftA) * drift + my) * H,
        };
      });

      // ── Cascade timing (every ~9s, active for ~3s) ──
      const CASCADE_PERIOD = 4.5;
      const CASCADE_ACTIVE = 1.6;
      const tc = time % CASCADE_PERIOD;
      const cascadeT = tc < CASCADE_ACTIVE ? tc / CASCADE_ACTIVE : -1;

      // ── Spawn ripples ──
      if (time > nextRippleAt) {
        const ni = Math.floor(sr(Math.floor(time * 80)) * nodes.length);
        ripples.push({ nodeIdx: ni, t: 0 });
        nextRippleAt = time + 0.5 + sr(Math.floor(time * 80) + 777) * 0.7;
      }
      for (let ri = ripples.length - 1; ri >= 0; ri--) {
        ripples[ri].t += 0.022;
        if (ripples[ri].t > 1) ripples.splice(ri, 1);
      }

      // ── Non-critical edges ──
      for (const edge of edges) {
        if (edge.critical) continue;
        const { cx: x1, cy: y1 } = pos[edge.from];
        const { cx: x2, cy: y2 } = pos[edge.to];
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        for (const p of edge.particles) {
          p.t = (p.t + p.speed) % 1;
          const px = x1 + (x2 - x1) * p.t;
          const py = y1 + (y2 - y1) * p.t;
          const a = Math.sin(p.t * Math.PI) * 0.2;
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.fill();
        }
      }

      // ── Critical path edges (ordered, with cascade) ──
      for (let ei = 0; ei < criticalEdgesOrdered.length; ei++) {
        const edge = criticalEdgesOrdered[ei];
        const { cx: x1, cy: y1 } = pos[edge.from];
        const { cx: x2, cy: y2 } = pos[edge.to];
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.5);

        // Wide glow
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(255,255,255,${0.13 + 0.06 * pulse})`;
        ctx.lineWidth = 6;
        ctx.stroke();

        // Core bright line
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.1 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Animated dashes
        ctx.save();
        ctx.setLineDash([9, 9]);
        ctx.lineDashOffset = -(time * 22) % 18;
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(255,255,255,${0.38 + 0.12 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Cascade traveling orb
        if (cascadeT >= 0) {
          const edgeProgress = cascadeT * criticalEdgesOrdered.length - ei;
          if (edgeProgress > 0 && edgeProgress < 1) {
            const t = edgeProgress;
            const cpx = x1 + (x2 - x1) * t;
            const cpy = y1 + (y2 - y1) * t;
            // Bright leading orb
            const orbG = ctx.createRadialGradient(cpx, cpy, 0, cpx, cpy, 44);
            orbG.addColorStop(0,    "rgba(255,255,255,1)");
            orbG.addColorStop(0.12, "rgba(255,255,255,0.7)");
            orbG.addColorStop(0.45, "rgba(255,255,255,0.1)");
            orbG.addColorStop(1,    "rgba(255,255,255,0)");
            ctx.fillStyle = orbG;
            ctx.beginPath();
            ctx.arc(cpx, cpy, 44, 0, Math.PI * 2);
            ctx.fill();
            // Trailing streak
            const trailEnd = Math.max(0, t - 0.45);
            const tx = x1 + (x2 - x1) * trailEnd;
            const ty = y1 + (y2 - y1) * trailEnd;
            const trailG = ctx.createLinearGradient(tx, ty, cpx, cpy);
            trailG.addColorStop(0, "rgba(255,255,255,0)");
            trailG.addColorStop(1, "rgba(255,255,255,0.75)");
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(cpx, cpy);
            ctx.strokeStyle = trailG;
            ctx.lineWidth = 3.5;
            ctx.stroke();
          }
        }

        // Particles
        for (const p of edge.particles) {
          p.t = (p.t + p.speed) % 1;
          const px = x1 + (x2 - x1) * p.t;
          const py = y1 + (y2 - y1) * p.t;
          const a = Math.sin(p.t * Math.PI);
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${0.88 * a})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px, py, 9, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${0.13 * a})`;
          ctx.fill();
        }
      }

      // ── Ripples ──
      for (const rip of ripples) {
        const { cx, cy } = pos[rip.nodeIdx];
        const r = nodes[rip.nodeIdx].radius * DPR + 18 + rip.t * 32;
        const a = (1 - rip.t) * 0.3;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = nodes[rip.nodeIdx].nodeType === "failure"
          ? `rgba(255,90,70,${a})`
          : `rgba(255,255,255,${a * 0.55})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // ── Nodes ──
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const { cx, cy } = pos[i];
        const r = node.radius * DPR;
        const pulse = 0.5 + 0.5 * Math.sin(time * 1.3 + node.phase);

        // Cascade flash when orb reaches this node
        let cascadeFlash = 0;
        if (cascadeT >= 0 && node.critical) {
          const cni = CRITICAL_PATH.indexOf(i);
          if (cni >= 0) {
            const nT = cascadeT * criticalEdgesOrdered.length - (cni - 0.5);
            cascadeFlash = nT > 0 && nT < 1 ? Math.max(0, 1 - nT * 2) : 0;
          }
        }

        if (node.nodeType === "failure") {
          // Outer red halo
          const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 16);
          fg.addColorStop(0, `rgba(255,60,40,${0.24 + 0.1 * pulse + cascadeFlash * 0.5})`);
          fg.addColorStop(1, "rgba(255,60,40,0)");
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 16, 0, Math.PI * 2);
          ctx.fill();
          // Spinning arcs
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(time * 0.9);
          ctx.beginPath();
          ctx.arc(0, 0, r + 9, 0, Math.PI * 1.4);
          ctx.strokeStyle = `rgba(255,100,80,${0.5 + 0.2 * pulse})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.rotate(Math.PI);
          ctx.beginPath();
          ctx.arc(0, 0, r + 14, 0, Math.PI * 0.8);
          ctx.strokeStyle = `rgba(255,130,100,${0.28 * pulse})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
          // Core
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,85,65,${0.9 + 0.08 * pulse})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,210,190,0.95)";
          ctx.fill();
        } else if (node.critical) {
          // Multi-layer white glow
          for (const [gr, ga] of [
            [r * 22, 0.06 * pulse + cascadeFlash * 0.38],
            [r * 12, 0.15 * pulse + cascadeFlash * 0.48],
            [r * 5,  0.30 * pulse],
          ] as [number, number][]) {
            const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
            cg.addColorStop(0, `rgba(255,255,255,${ga})`);
            cg.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.arc(cx, cy, gr, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${0.92 + 0.07 * pulse})`;
          ctx.fill();
        } else {
          const ng = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 7);
          ng.addColorStop(0, `rgba(255,255,255,${0.1 * pulse})`);
          ng.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = ng;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${0.36 + 0.15 * pulse})`;
          ctx.fill();
        }

        // Start node — concentric rings
        if (node.nodeType === "start") {
          for (const [ringR, ringA] of [
            [r + 10, 0.20 + 0.09 * pulse],
            [r + 22, 0.08 + 0.04 * pulse],
            [r + 40, 0.025 * pulse],
          ] as [number, number][]) {
            ctx.beginPath();
            ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,255,255,${ringA})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        // Node label
        if (node.label) {
          ctx.save();
          ctx.textAlign = "center";
          ctx.font = `${8 * DPR}px ui-monospace, "SF Mono", monospace`;
          ctx.fillStyle = node.nodeType === "failure"
            ? `rgba(255,160,140,0.78)`
            : node.critical
              ? `rgba(255,255,255,0.58)`
              : `rgba(255,255,255,0.26)`;
          ctx.fillText(node.label, cx, cy + r + 14 * DPR);
          ctx.restore();
        }
      }

      if (!prefersReduced && running) animId = requestAnimationFrame(draw);
    };

    // Pause/resume the loop as the hero enters/leaves the viewport.
    const io = new IntersectionObserver(
      ([entry]) => {
        const wasRunning = running;
        running = !!entry?.isIntersecting;
        if (running && !wasRunning && !prefersReduced && !document.hidden) {
          cancelAnimationFrame(animId);
          animId = requestAnimationFrame(draw);
        }
      },
      { threshold: 0 }
    );
    io.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
      } else if (!prefersReduced) {
        running = true;
        cancelAnimationFrame(animId);
        animId = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    draw();
    return () => {
      cancelAnimationFrame(animId);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-56 bg-gradient-to-t from-black to-transparent" />
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black/50 to-transparent" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO — terminal-industries.com style: text AS the visual
// ─────────────────────────────────────────────────────────────────────────────

const heroLineVariant = {
  hidden: { opacity: 0, y: 48 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 1.1, ease: EASE_OUT },
  },
};

const heroLines = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.18, delayChildren: 0.3 } },
};

const capabilityVariant = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE_OUT },
  },
};

const capabilities = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 1.2 } },
};

function HeroSection() {
  const items = [
    "One decorator to instrument — OpenTelemetry Python & TS SDKs",
    "Correlated trace tree of every LLM call, tool call, and step",
    "Git context: each span linked to file, line, and commit",
    "LLM-as-judge detects failures, alerts Slack & email",
    "Trust boundaries: an origin and a capability on every span",
    "Agentic RCA ties the failure to the exact commit",
    "Auto-opens a fix PR on GitHub with a causal-replay check",
  ];

  return (
    <section className="relative min-h-screen overflow-hidden flex flex-col">
      {/* Causal graph — full section background */}
      <CausalGraphBackground />

      {/* Brand tag — top left, below nav */}
      <motion.div
        className="relative z-10 px-8 pt-28"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.1 }}
      >
        <ScrambleText
          text="Causal · Root Cause Intelligence"
          className="font-mono text-[11px] tracking-[0.3em] text-white/45 uppercase"
          duration={900}
        />
      </motion.div>

      {/* Main statement — fills the screen */}
      <div className="relative z-10 flex-1 flex flex-col justify-center px-8 pt-8 pb-0">
        <motion.h1
          variants={heroLines}
          initial="hidden"
          animate="visible"
          className="font-light text-white leading-[0.98] tracking-[-0.03em]"
          style={{ fontSize: "clamp(40px, 6.4vw, 88px)" }}
        >
          <motion.span variants={heroLineVariant} className="block">
            Trace every agent run.
          </motion.span>
          <motion.span variants={heroLineVariant} className="block text-white/60">
            Catch every failure.
          </motion.span>
          <motion.span variants={heroLineVariant} className="block gradient-text">
            Ship the fix automatically.
          </motion.span>
        </motion.h1>

        {/* Lead — what Causal is, in one breath */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 1.3, ease: EASE_OUT }}
          className="mt-8 max-w-2xl text-[16px] sm:text-[17px] text-white/55 leading-relaxed"
        >
          AI-native observability and self-healing for AI agents. Add one decorator: Causal
          traces every LLM and tool call, an LLM judge catches failures the moment they happen,
          and an AI agent root-causes each one to the exact commit — then opens the fix PR.
        </motion.p>

        {/* Numbered capability list */}
        <motion.div
          variants={capabilities}
          initial="hidden"
          animate="visible"
          className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-3 max-w-3xl"
        >
          {items.map((item, i) => (
            <motion.div
              key={i}
              variants={capabilityVariant}
              className="flex items-start gap-4"
            >
              <span className="font-mono text-[11px] tracking-[0.1em] text-white/20 shrink-0 mt-0.5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-[12px] tracking-[0.05em] text-white/45 leading-snug">
                {item}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* CTAs — pinned to bottom */}
      <motion.div
        className="relative z-10 px-8 pb-16 pt-12"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 1.9, ease: EASE_OUT }}
      >
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <MagneticButton>
            <Link href={`/incidents/${FEATURED_INCIDENT_ID}`} className="xai-btn xai-btn-primary">
              EXPLORE A LIVE INCIDENT <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </MagneticButton>
          <MagneticButton>
            <Link href="/incidents" className="xai-btn">
              BROWSE ALL INCIDENTS <ExternalLink className="w-3 h-3" />
            </Link>
          </MagneticButton>
        </div>
        <p className="mt-5 font-mono text-[11px] tracking-[0.15em] text-white/45 uppercase">
          Live product demo &nbsp;·&nbsp; No signup &nbsp;·&nbsp; Real traces, detectors &amp; fix PRs
        </p>
      </motion.div>

      {/* Scroll hint */}
      <motion.div
        className="absolute bottom-8 right-8 z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.2, duration: 1 }}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-white/15 uppercase">Scroll</span>
          <div className="w-5 h-8 rounded-full border border-white/20 flex items-start justify-center p-1.5">
            <div className="w-0.5 h-2 bg-white/40 rounded-full animate-bounce" />
          </div>
        </div>
      </motion.div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS — animated rolling counters
// ─────────────────────────────────────────────────────────────────────────────

function AnimatedCounter({
  value,
  suffix = "",
  prefix = "",
  decimals = 0,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) =>
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString()
  );

  useEffect(() => {
    if (isInView) {
      animate(count, value, { duration: 2.2, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] });
    }
  }, [isInView, value, count]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}

function StatsSection() {
  const stats = [
    { value: 1, label: "Decorator to instrument", prefix: "", suffix: "", decimals: 0 },
    { value: 6, label: "Layers, intent → incident", prefix: "", suffix: "", decimals: 0 },
    { value: 4, label: "Failure classes auto-detected", prefix: "", suffix: "", decimals: 0 },
    { value: 1, label: "Failing span → fix", prefix: "", suffix: " PR", decimals: 0 },
  ];

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-8 border-b border-white/[0.06]" id="product">
      {/* Ambient glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, rgba(255,255,255,0.015) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto w-full">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-24 text-center"
        >
          <motion.p variants={fadeUp} className="mb-5">
            <ScrambleText text="[ BY THE NUMBERS ]" className="font-mono text-[11px] tracking-[0.25em] text-white/45 uppercase" />
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-[40px] sm:text-[56px] font-light tracking-[-0.03em] text-white">
            The whole loop, automated
          </motion.h2>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-[1px] bg-white/[0.06]"
        >
          {stats.map(({ value, label, prefix, suffix, decimals }) => (
            <motion.div
              key={label}
              variants={cardVariant}
              className="bg-black p-10 flex flex-col gap-3 items-center text-center"
            >
              <div className="stat-number flex items-center">
                <AnimatedCounter value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
              </div>
              <p className="font-mono text-[11px] tracking-[0.1em] text-white/55 uppercase leading-relaxed">
                {label}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPTH — one trace, and every artifact it produced
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The section that answers "what else is in there".
 *
 * It sits immediately after the live trace explorer, which opens on the featured
 * incident, so the reader has just been clicking around the exact trace this
 * section counts. Part one is what that one trace produced — spans, prompts, a
 * verdict, a causal chain, a PR, a post-mortem, a replay, golden cases — each
 * tile linking to the surface that holds it. Part two is what lives on each of
 * the five product routes, stated as an inventory rather than an adjective.
 *
 * Rules this section holds itself to:
 *  - Every number is a reduction over the same modules the product reads
 *    (mock-observability / mock-data / mock-evals / mock-security). Nothing is
 *    typed in, including the zero — the featured trace raises no security event
 *    and the tile says so rather than borrowing another trace's count.
 *  - Every href is a route that exists under app/.
 *  - Security is described as labelling, detecting and explaining. Never
 *    blocking: there is no enforcement path in this product yet.
 */
function DepthSection() {
  // getAllDemos() is typed IncidentDemo[], so finding / rootCause / fixPr are
  // guaranteed present — unlike getObservabilityDemo(), whose healthy traces
  // legitimately have none of the three.
  const demo = getAllDemos().find((d) => d.incidentId === FEATURED_INCIDENT_ID);
  if (!demo) return null;

  const incident = `/incidents/${FEATURED_INCIDENT_ID}`;
  const graph = getMockTrace(FEATURED_INCIDENT_ID);
  const postMortem = getMockPostMortem(FEATURED_INCIDENT_ID);
  const replay = getMockReplay(FEATURED_INCIDENT_ID);

  // ── What this one trace carries ──────────────────────────────────────────
  const spanKinds = new Set(demo.spans.map((s) => s.kind)).size;
  const erroredSpans = demo.spans.filter((s) => s.status === "error").length;
  const ioSpans = demo.spans.filter((s) => Boolean(s.io?.input || s.io?.output)).length;
  const gitSpans = demo.spans.filter((s) => Boolean(s.git)).length;
  const checksPassed = demo.fixPr.checks.filter((c) => c.status === "pass").length;
  const files = demo.fixPr.filesChanged;

  // ── What it produced downstream ──────────────────────────────────────────
  const pmSections = (postMortem.markdown.match(/^##\s/gm) ?? []).length;
  const ticketLabels = ((postMortem.linearTicket as { labels?: string[] }).labels ?? []).length;
  const replayFidelity = Math.round(replay.fidelityScore * 100);
  const replayDiffLines = replay.diff?.length ?? 0;

  const cases = getDatasets()
    .flatMap((d) => d.items)
    .filter((i) => i.traceId === FEATURED_INCIDENT_ID);
  const caseAssertions = cases.reduce((n, c) => n + c.assertions.length, 0);
  const promotedFrom = cases[0]?.fromFinding;

  // The honest zero: no security event references this trace. Counting how many
  // demo traces do resolve to one keeps that zero readable as a fact rather
  // than as a hole in the data.
  const demos = getAllDemos();
  const eventsOnTrace = SECURITY_EVENTS.filter((e) => e.traceId === demo.traceId).length;
  const tracesWithEvents = demos.filter((d) =>
    SECURITY_EVENTS.some((e) => e.traceId === d.traceId)
  ).length;

  const artifacts: { label: string; value: string; detail: string; href: string; see: string }[] = [
    {
      label: "Trace",
      value: `${demo.spans.length} spans`,
      detail: `${spanKinds} span kinds, ${erroredSpans} of them errored — with tokens and spend rolled up through every parent.`,
      href: incident,
      see: "Open the tree",
    },
    {
      label: "Prompts",
      value: `${ioSpans} spans`,
      detail: "carry the input and the output the model actually saw. Copy either, or expand it to full height and read the whole thing.",
      href: incident,
      see: "Read one",
    },
    {
      label: "Git context",
      value: `${gitSpans} spans`,
      detail: `resolve to a file and line at commit ${demo.rootCause.commit}, copyable as file:line.`,
      href: incident,
      see: "See the source",
    },
    {
      label: "Verdict",
      value: demo.finding.detector.replace(/_/g, " "),
      detail: `confidence ${demo.finding.confidence.toFixed(2)}, judged by ${demo.finding.judgeModel} — with the span that triggered it named.`,
      href: "/detectors",
      see: "See the detector",
    },
    {
      label: "Causal chain",
      value: `${graph.nodes.length} nodes`,
      detail: `${graph.edges.length} edges from intent to incident, ${graph.criticalPath.length} of them on the critical path. The root cause sits ${demo.rootCause.hopsUpstream} hops upstream.`,
      href: incident,
      see: "Walk the graph",
    },
    {
      label: "Fix PR",
      value: `#${demo.fixPr.number}`,
      detail: `+${demo.fixPr.additions} −${demo.fixPr.deletions} across ${files} file${files === 1 ? "" : "s"}, ${checksPassed} of ${demo.fixPr.checks.length} checks passed including causal-replay.`,
      href: incident,
      see: "Read the diff",
    },
    {
      label: "Post-mortem",
      value: `${pmSections} sections`,
      detail: `written from the causal chain, plus a Linear ticket carrying ${ticketLabels} labels and a CLAUDE.md rule to paste into the repo so the agent does not repeat it.`,
      href: `${incident}/postmortem`,
      see: "Generate it",
    },
    {
      label: "Replay",
      value: `${replayFidelity}% fidelity`,
      detail: `the suggested fix re-run against the captured snapshot, scored against the original output across ${replayDiffLines} changed lines.`,
      href: `${incident}/replay`,
      see: "Run the sandbox",
    },
    {
      label: "Golden cases",
      value: `${cases.length} cases`,
      detail: promotedFrom
        ? `carrying ${caseAssertions} machine-checkable assertions, all promoted from finding ${promotedFrom} and re-run on every release since.`
        : `carrying ${caseAssertions} machine-checkable assertions, re-run on every release.`,
      href: "/evals",
      see: "Open the set",
    },
    {
      label: "Security events",
      value: `${eventsOnTrace}`,
      detail:
        eventsOnTrace === 0
          ? `nothing in the security corpus references this trace — ${tracesWithEvents} of the ${demos.length} demo traces do, and their span panel says which.`
          : `raised on this exact trace, listed in the span panel and stamped on the incident row.`,
      href: "/security",
      see: "Open the console",
    },
  ];

  // ── What lives on each surface ───────────────────────────────────────────
  const traces = getTraceList();
  const healthyTraces = traces.filter((t) => t.status === "ok").length;
  const flaggedTraces = traces.length - healthyTraces;

  const detectors = getDetectors();
  const detectorFindings = detectors.reduce((n, d) => n + d.findings.length, 0);
  const detectorRuns = detectors.reduce((n, d) => n + d.runs.length, 0);
  const cleanRuns = detectors.reduce(
    (n, d) => n + d.runs.filter((r) => !r.identified).length,
    0
  );

  const datasets = getDatasets();
  const goldenCases = datasets.flatMap((d) => d.items);
  const allAssertions = goldenCases.flatMap((c) => c.assertions);
  const assertionKinds = new Set(allAssertions.map((a) => a.kind)).size;
  const evalRuns = datasets.flatMap((d) => getRuns(d.id)).length;

  const occurrences = SECURITY_EVENTS.reduce((n, e) => n + e.occurrences, 0);
  const deterministic = DETECTIONS.filter((d) => !d.usesModel).length;
  const posture = computeScore(POSTURE);

  const surfaces = [
    {
      route: "/incidents",
      inventory: `${traces.length} traces · ${flaggedTraces} flagged · ${healthyTraces} healthy`,
      depth:
        "Open a healthy one and there is no banner, no actions, and a Copilot briefing that opens by saying no detector flagged this run. ⌘K reaches any trace, any view, any action from anywhere.",
    },
    {
      route: "/detectors",
      inventory: `${detectors.length} judges · ${detectorFindings} findings · ${detectorRuns} evaluation runs`,
      depth: `${cleanRuns} of those runs found nothing and are listed anyway — the record that every trace is graded, not only the ones that already threw.`,
    },
    {
      route: "/security",
      inventory: `${SECURITY_EVENTS.length} events · ${occurrences.toLocaleString()} occurrences · ${DETECTIONS.length} detections, ${deterministic} reading no natural language · ${ASI_IDS.length} ASI ids`,
      depth: `Containment scores ${posture.score} with its whole formula on screen, dimmed and marked UNPROVEN AT HEAD because the commit it was measured at is not HEAD. The flow map taints a path forward or backward through the graph and counts the nodes it reaches. It labels, detects and explains what got through — it does not block.`,
    },
    {
      route: "/evals",
      inventory: `${datasets.length} sets · ${goldenCases.length} golden cases · ${allAssertions.length} assertions across ${assertionKinds} kinds · ${evalRuns} runs`,
      depth:
        "Every case puts what the agent actually produced next to the judge's written reasoning, then a pass/fail block per release — so a regression has a date and a fix has proof it held.",
    },
    {
      route: "/dashboard",
      inventory: "Every figure above, reduced once",
      depth:
        "Observability and security on one screen, agreeing with each other because they are two readings of one corpus rather than two products stapled together.",
    },
  ];

  return (
    <section className="py-32 px-8 border-b border-white/[0.06]" id="depth">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-16"
        >
          <motion.p variants={fadeUp} className="mb-4">
            <ScrambleText
              text="[ WHAT THAT TRACE PRODUCED ]"
              className="font-mono text-[11px] tracking-[0.2em] text-white/45 uppercase"
            />
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white"
          >
            One run, and everything Causal made of it
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-[15px] text-white/45 max-w-2xl leading-relaxed">
            The tree above is {demo.externalId} — {demo.service}, {demo.spans.length} spans, {demo.model}.
            Every number below is counted off that same run rather than written here, and every tile
            opens the screen it came from.
          </motion.p>
        </motion.div>

        {/* 10 tiles: clean at 1, 2 and 5 columns, so no row is ever part-filled
            and the container's hairline background is never left showing. */}
        <motion.div
          variants={staggerFast}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-[1px] bg-white/[0.06]"
        >
          {artifacts.map(({ label, value, detail, href, see }) => (
            <motion.div key={label} variants={cardVariant} className="xai-card bg-black group">
              <Link href={href} className="flex flex-col h-full p-6">
                <p className="font-mono text-[9px] tracking-[0.2em] text-white/25 uppercase mb-3">
                  {label}
                </p>
                <p className="text-[19px] font-light tracking-[-0.02em] text-white mb-2.5 tabular-nums break-words">
                  {value}
                </p>
                <p className="text-[12px] text-white/28 leading-relaxed flex-1">{detail}</p>
                <span className="inline-flex items-center gap-1 mt-5 font-mono text-[9px] tracking-[0.14em] uppercase text-white/25 group-hover:text-white/70 transition-colors">
                  {see} <ArrowUpRight className="w-3 h-3" />
                </span>
              </Link>
            </motion.div>
          ))}
        </motion.div>

        {/* The surfaces themselves. A bordered list rather than a grid, so the
            row count never has to divide by anything. */}
        <motion.div
          variants={staggerFast}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-14"
        >
          <motion.p
            variants={fadeUp}
            className="font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase mb-5"
          >
            And what is waiting on each surface
          </motion.p>
          <div className="border border-white/[0.06] rounded-xl overflow-hidden">
            {surfaces.map(({ route, inventory, depth }, i) => (
              <motion.div key={route} variants={cardVariant}>
                <Link
                  href={route}
                  className={`group grid grid-cols-1 md:grid-cols-[190px_1fr] gap-x-8 gap-y-2 px-6 py-6 hover:bg-white/[0.02] transition-colors ${
                    i > 0 ? "border-t border-white/[0.06]" : ""
                  }`}
                >
                  <span className="font-mono text-[12px] text-white/60 group-hover:text-white transition-colors inline-flex items-center gap-1.5">
                    {route}
                    <ArrowUpRight className="w-3 h-3 text-white/25 group-hover:text-white/70 transition-colors" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[11px] text-white/40 tabular-nums leading-relaxed mb-2">
                      {inventory}
                    </span>
                    <span className="block text-[13px] text-white/28 leading-relaxed">{depth}</span>
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BENEFIT SECTIONS — full-screen 01 / 02 / 03
// ─────────────────────────────────────────────────────────────────────────────

function BenefitDagVisual() {
  const layers = [
    { label: "Intent", x: 80, nodes: [{ y: 280 }] },
    { label: "Spec", x: 230, nodes: [{ y: 200 }, { y: 360 }] },
    { label: "Reasoning", x: 410, nodes: [{ y: 150 }, { y: 280 }, { y: 420 }] },
    { label: "Code", x: 580, nodes: [{ y: 190 }, { y: 330 }, { y: 460 }] },
    { label: "Execution", x: 740, nodes: [{ y: 240 }, { y: 380 }] },
    { label: "Incident", x: 920, nodes: [{ y: 310 }] },
  ];

  const edges: { x1: number; y1: number; x2: number; y2: number; delay: number }[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const current = layers[i];
    const next = layers[i + 1];
    for (const fromNode of current.nodes) {
      for (const toNode of next.nodes) {
        if (Math.abs(fromNode.y - toNode.y) < 250) {
          edges.push({ x1: current.x, y1: fromNode.y, x2: next.x, y2: toNode.y, delay: edges.length * 0.3 });
        }
      }
    }
  }

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-xl border border-white/[0.06] overflow-hidden bg-white/[0.01]">
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <defs>
          <pattern id="dag-grid2" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <line x1="40" y1="0" x2="40" y2="40" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
            <line x1="0" y1="40" x2="40" y2="40" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dag-grid2)" />
      </svg>
      <div
        className="absolute top-0 bottom-0 w-[2px] z-20 pointer-events-none"
        style={{
          background: "linear-gradient(180deg, transparent 10%, rgba(255,255,255,0.12) 50%, transparent 90%)",
          animation: "scan-sweep 6s ease-in-out infinite",
        }}
      />
      <svg viewBox="0 0 1000 560" className="w-full h-full relative z-10" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="arrow2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.2)" />
          </marker>
          <filter id="node-glow2">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {edges.map(({ x1, y1, x2, y2, delay }, i) => {
          const midX = (x1 + x2) / 2;
          return (
            <path key={i} d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1"
              markerEnd="url(#arrow2)" strokeDasharray="4 4"
              style={{ animation: `edge-pulse 3s linear ${delay}s infinite` }} />
          );
        })}
        {layers.map(({ label, x }) => (
          <text key={label} x={x} y={70} textAnchor="middle" fill="rgba(255,255,255,0.3)"
            fontSize="11" fontFamily="ui-monospace,monospace" fontWeight="600" letterSpacing="0.15em">
            {label.toUpperCase()}
          </text>
        ))}
        {layers.map(({ label, x, nodes }, li) =>
          nodes.map((node, ni) => {
            const isFailure = label === "Incident";
            const isIntent = label === "Intent";
            const size = isFailure ? 9 : isIntent ? 8 : 5;
            return (
              <g key={`${li}-${ni}`} style={{ animation: `node-float ${4 + li * 0.6 + ni * 0.8}s ease-in-out ${li * 0.3 + ni * 0.5}s infinite` }}>
                <circle cx={x} cy={node.y} r={size + 14} fill="none"
                  stroke={isFailure ? "rgba(255,140,140,0.06)" : "rgba(255,255,255,0.03)"} strokeWidth="0.5"
                  style={{ animation: `node-breathe ${3 + ni}s ease-in-out ${li * 0.5}s infinite` }} />
                <circle cx={x} cy={node.y} r={size + 6} fill="none"
                  stroke={isFailure ? "rgba(255,180,180,0.1)" : "rgba(255,255,255,0.05)"} strokeWidth="0.5" />
                <circle cx={x} cy={node.y} r={size}
                  fill={isFailure ? "rgba(255,100,100,0.7)" : isIntent ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.45)"}
                  filter="url(#node-glow2)" />
                <circle cx={x} cy={node.y} r={2} fill="white" opacity={isFailure ? 1 : 0.7} />
              </g>
            );
          })
        )}
        {/* Highlighted critical path */}
        {[
          [{ x: 80, y: 280 }, { x: 230, y: 200 }],
          [{ x: 230, y: 200 }, { x: 410, y: 280 }],
          [{ x: 410, y: 280 }, { x: 580, y: 330 }],
          [{ x: 580, y: 330 }, { x: 740, y: 380 }],
          [{ x: 740, y: 380 }, { x: 920, y: 310 }],
        ].map(([from, to], i) => {
          const midX = (from.x + to.x) / 2;
          return (
            <path key={i} d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
              fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="2" strokeDasharray="8 4"
              style={{ animation: `edge-pulse 2.5s linear ${i * 0.4}s infinite` }} />
          );
        })}
      </svg>
      <div className="absolute bottom-4 right-6 flex items-center gap-2 z-20">
        <div className="w-2 h-2 rounded-full bg-red-400/60 animate-pulse" />
        <span className="font-mono text-[10px] tracking-[0.12em] text-white/25 uppercase">Root cause · L3 drift</span>
      </div>
    </div>
  );
}

function BenefitCodeVisual() {
  return (
    <div className="w-full rounded-xl overflow-hidden border border-white/[0.08]">
      <div className="bg-white/[0.02] border-b border-white/[0.06] px-5 py-3 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="ml-4 font-mono text-[11px] text-white/25 tracking-wider">BOOKING_AGENT.PY</span>
      </div>
      <div className="bg-black p-6 font-mono text-[13px] leading-[1.8]">
        <div><span className="text-white/30">from</span><span className="text-white/60"> causal </span><span className="text-white/30">import</span><span className="text-white/70"> trace</span></div>
        <div className="mt-3 text-white/15 italic"># One decorator. Full causal graph.</div>
        <div className="mt-1">
          <span className="text-white/50">@trace</span>
          <span className="text-white/20">(</span>
          <span className="text-white/30">session_id=</span>
          <span className="text-white/45">&quot;session-abc&quot;</span>
          <span className="text-white/20">)</span>
        </div>
        <div>
          <span className="text-white/30">async def</span>
          <span className="text-white/60"> booking_agent</span>
          <span className="text-white/20">(</span>
          <span className="text-white/40">user_request</span>
          <span className="text-white/20">: </span>
          <span className="text-white/50">str</span>
          <span className="text-white/20">) -&gt; </span>
          <span className="text-white/50">dict</span>
          <span className="text-white/20">:</span>
        </div>
        <div className="pl-8 text-white/15 italic">    # Every step captured automatically</div>
        <div className="pl-8">
          <span className="text-white/35">intent</span>
          <span className="text-white/15"> = </span>
          <span className="text-white/30">await</span>
          <span className="text-white/50"> analyze_intent</span>
          <span className="text-white/20">(user_request)</span>
        </div>
        <div className="pl-8">
          <span className="text-white/35">result</span>
          <span className="text-white/15"> = </span>
          <span className="text-white/30">await</span>
          <span className="text-white/50"> execute_booking</span>
          <span className="text-white/20">(intent)</span>
        </div>
        <div className="pl-8"><span className="text-white/30">return</span><span className="text-white/50"> result</span></div>
        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          <div className="text-white/15 italic"># → INTENT node created</div>
          <div className="text-white/15 italic"># → SPEC node created</div>
          <div className="text-white/15 italic"># → REASONING node created</div>
          <div className="text-white/20">graph.status <span className="text-white/30">=</span> <span className="text-white/40">&quot;assembling&quot;</span></div>
        </div>
      </div>
    </div>
  );
}

function BenefitPostmortemVisual() {
  return (
    <div className="w-full rounded-xl border border-white/[0.08] overflow-hidden">
      <div className="bg-white/[0.02] border-b border-white/[0.06] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        </div>
        <span className="font-mono text-[11px] text-white/25 tracking-wider">POSTMORTEM · INC-2847</span>
        <span className="font-mono text-[10px] text-white/15 tracking-wider">GENERATED BY CLAUDE</span>
      </div>
      <div className="bg-black p-6 space-y-5 text-[13px] leading-relaxed">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase mb-2">Root Cause</p>
          <p className="text-white/55">Spec ambiguity at intent layer caused L3 inference drift. The booking agent misinterpreted &quot;flexible dates&quot; as a constraint rather than a preference.</p>
        </div>
        <div className="glow-line" />
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase mb-2">Timeline</p>
          <div className="space-y-1.5">
            {["14:23:01 — Intent node created", "14:23:02 — Spec drift detected (confidence 0.71)", "14:23:04 — Logic node diverged from spec", "14:23:09 — Incident triggered"].map((t, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-white/20 font-mono text-[11px] shrink-0">→</span>
                <span className="text-white/35 font-mono text-[11px]">{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="glow-line" />
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase mb-2">Counterfactual</p>
          <p className="text-white/40">If spec had been disambiguated with explicit date range parsing, failure probability drops to 3%.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The eval loop, shown rather than asserted — a real golden set from the demo
 * data, its per-case verdicts, and the score climbing release over release.
 * Reads from the same module the product does, so the landing page can never
 * drift from what /evals actually shows.
 */
function BenefitEvalVisual() {
  const dataset = getDatasets()[0]!;
  const runs = getRuns(dataset.id).slice(0, 3);
  const latest = runs[0]!;
  const cases = dataset.items.slice(0, 4);

  return (
    <div className="w-full rounded-xl border border-white/[0.08] overflow-hidden">
      <div className="bg-white/[0.02] border-b border-white/[0.06] px-5 py-3 flex items-center justify-between">
        <span className="font-mono text-[11px] text-white/25 tracking-wider">
          GOLDEN SET · {dataset.name.toUpperCase()}
        </span>
        <span className="font-mono text-[10px] text-emerald-400/70 tracking-wider">
          {Math.round(latest.score * 100)}% · {latest.passed}/{latest.total}
        </span>
      </div>

      <div className="bg-black p-5">
        {/* Score per release — the trend is the product's promise. */}
        <p className="font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase mb-3">
          Score by release
        </p>
        <div className="flex items-end gap-2 mb-6">
          {[...runs].reverse().map((r) => (
            <div key={r.id} className="flex-1 flex flex-col items-center gap-2">
              <div className="w-full h-20 flex items-end">
                <motion.div
                  initial={{ height: 0 }}
                  whileInView={{ height: `${Math.max(r.score * 100, 6)}%` }}
                  transition={{ duration: 0.9, ease: EASE_OUT }}
                  viewport={{ once: true }}
                  className={`w-full rounded-t ${
                    r.score === 1 ? "bg-emerald-400/30" : r.score >= 0.6 ? "bg-amber-400/25" : "bg-red-400/25"
                  }`}
                />
              </div>
              <span className="font-mono text-[10px] text-white/40 tabular-nums">
                {Math.round(r.score * 100)}%
              </span>
              <span className="font-mono text-[9px] text-white/20 text-center leading-tight">
                {r.release.replace(/^[a-z-]+-/, "")}
              </span>
            </div>
          ))}
        </div>

        <div className="glow-line mb-4" />

        {/* Cases, with the assertions that make a verdict checkable. */}
        <p className="font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase mb-3">
          Cases · {latest.release}
        </p>
        <div className="space-y-2">
          {cases.map((item) => {
            const res = latest.results.find((r) => r.itemId === item.id);
            return (
              <div key={item.id} className="flex items-start gap-2.5">
                {res?.passed ? (
                  <Check className="w-3 h-3 text-emerald-400/80 mt-0.5 shrink-0" />
                ) : (
                  <span className="w-3 h-3 mt-0.5 shrink-0 font-mono text-[11px] text-red-400/80 leading-none">✕</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-white/45 truncate">{item.title}</span>
                  <span className="block font-mono text-[10px] text-white/20">
                    {item.assertions.length} assertions · {item.difficulty}
                  </span>
                </span>
              </div>
            );
          })}
          <p className="font-mono text-[10px] text-white/20 pt-1">
            +{dataset.items.length - cases.length} more cases
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Trust Boundaries, shown rather than asserted — one real flow from the security
 * fixtures, source → hop → sink, with the untrusted hops hatched and the hop that
 * crossed the boundary marked. Every string and every number here is a field on
 * the event or on its detection; nothing is authored in this file.
 *
 * SEC-1043 is the flow to show: the sink is a markdown image the reader's own
 * renderer fetches, so no http span exists in the trace at all. Nothing watching
 * network egress from the agent host sees it, and nothing reading the prompt sees
 * it either — only something holding the labelled span DAG does. It is also the
 * event the corpus did NOT stop, which keeps the page honest about what a
 * monitoring capability is.
 */
const TRUST_FLOW_EVENT_ID = "SEC-1043";

/**
 * The 4px diagonal hatch that marks untrusted bytes, matching the treatment the
 * security console uses. Trust is texture, not hue — colour stays on status.
 */
const UNTRUSTED_HATCH =
  "repeating-linear-gradient(45deg, rgba(245,158,11,0.16) 0, rgba(245,158,11,0.16) 1px, transparent 1px, transparent 4px)";

/** The console's short form for an origin — the label's last segment. */
function originShort(origin: Origin): string {
  return origin.split("_").pop() ?? origin;
}

function isUntrustedOrigin(origin: Origin): boolean {
  return origin === "UNTRUSTED_EXTERNAL" || origin === "UNTRUSTED_AGENT";
}

function BenefitSecurityVisual() {
  const ev = getEvent(TRUST_FLOW_EVENT_ID);
  if (!ev) return null;

  const rule = DETECTIONS.find((d) => d.id === ev.ruleId);
  const crossing = ev.flow.find((n) => n.violating) ?? ev.flow[ev.flow.length - 1];
  const blocked = ev.outcome === "blocked";
  const w = ev.witness;

  return (
    <div className="w-full rounded-xl border border-white/[0.08] overflow-hidden">
      <div className="bg-white/[0.02] border-b border-white/[0.06] px-5 py-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-white/25 tracking-wider">
          TRUST BOUNDARY · {ev.id}
        </span>
        <span
          className={`font-mono text-[10px] tracking-wider ${
            blocked ? "text-emerald-400/70" : "text-red-400/80"
          }`}
        >
          {ev.outcome.toUpperCase()}
        </span>
      </div>

      <div className="bg-black p-5">
        {/* The flow. Origin on the left, capability on the right — the two labels
            the predicate is made of, in the order it reads. */}
        <p className="font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase mb-4">
          Flow · trace {ev.traceId.slice(0, 8)}
        </p>

        <div className="relative pl-6 space-y-3">
          <div className="absolute left-[4px] top-2 bottom-2 w-px bg-white/[0.08]" aria-hidden />
          {ev.flow.map((node) => {
            const untrusted = isUntrustedOrigin(node.origin);
            const isCrossing = node === crossing;
            return (
              <div key={node.spanId} className="relative flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={`absolute -left-6 top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full border ${
                    isCrossing
                      ? blocked
                        ? "border-emerald-400/70 bg-emerald-400/40"
                        : "border-red-400/70 bg-red-400/40"
                      : "border-white/20 bg-black"
                  }`}
                />
                <span
                  style={untrusted ? { backgroundImage: UNTRUSTED_HATCH } : undefined}
                  className={`shrink-0 w-[74px] text-center font-mono text-[9px] tracking-[0.08em] px-1.5 py-1 rounded border ${
                    untrusted
                      ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-200/80"
                      : "border-white/[0.09] bg-white/[0.02] text-white/40"
                  }`}
                >
                  {originShort(node.origin)}
                </span>
                <span
                  className={`flex-1 min-w-0 truncate font-mono text-[11px] ${
                    isCrossing ? "text-white/70" : "text-white/40"
                  }`}
                >
                  {node.name}
                </span>
                {node.capability !== "NONE" && (
                  <span
                    className={`shrink-0 font-mono text-[9px] tracking-[0.08em] px-1.5 py-0.5 rounded border ${
                      isCrossing && !blocked
                        ? "border-red-400/40 bg-red-500/[0.08] text-red-300/90"
                        : "border-white/[0.09] text-white/35"
                    }`}
                  >
                    {node.capability}
                  </span>
                )}
                <span className="shrink-0 w-[56px] text-right font-mono text-[10px] text-white/25 tabular-nums">
                  {node.bytes === undefined ? "—" : `${node.bytes.toLocaleString()} B`}
                </span>
              </div>
            );
          })}
        </div>

        <div className="glow-line my-4" />

        {/* The predicate, resolved against this flow. */}
        <p className="font-mono text-[11px] text-white/45 leading-relaxed">
          reach(<span className="text-amber-200/70">{crossing.origin}</span>,{" "}
          <span className={blocked ? "text-emerald-400/70" : "text-red-400/80"}>{crossing.capability}</span>)
        </p>
        {/* Where the sink actually is. Both halves are counted off the flow: for
            SEC-1043 the capability is reached at an llm span and the trace holds
            no http span at all, which is the whole argument for owning the trace
            rather than watching the network. */}
        <p className="font-mono text-[10px] text-white/25 mt-1.5 leading-relaxed">
          sink at kind={crossing.kind} · {ev.flow.filter((n) => n.kind === "http").length} http spans in this trace
        </p>
        <p className="font-mono text-[10px] text-white/25 mt-1.5 leading-relaxed">
          {w.kind} witness
          {w.sourceSpanId && w.sinkSpanId && (
            <>
              {" · "}
              {w.sourceSpanId}
              {w.sourceOffset !== undefined && `:${w.sourceOffset}`} → {w.sinkSpanId}
              {w.sinkOffset !== undefined && `:${w.sinkOffset}`}
            </>
          )}
        </p>

        {rule && (
          <>
            <div className="glow-line my-4" />
            <div className="space-y-1.5">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[9px] tracking-[0.18em] text-white/20 uppercase w-[62px] shrink-0">Rule</span>
                <span className="font-mono text-[10px] text-white/40">
                  {rule.id} · {rule.name} · {rule.mode}
                </span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[9px] tracking-[0.18em] text-white/20 uppercase w-[62px] shrink-0">Signal</span>
                <span className="font-mono text-[10px] text-white/40">{rule.signal}</span>
              </div>
              {rule.backtest && (
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[9px] tracking-[0.18em] text-white/20 uppercase w-[62px] shrink-0">Backtest</span>
                  <span className="font-mono text-[10px] text-white/40 tabular-nums">
                    {rule.backtest.fires} fires · {rule.backtest.confirmed} confirmed · precision{" "}
                    {rule.backtest.precision.toFixed(2)} · {rule.backtest.windowDays}d
                  </span>
                </div>
              )}
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[9px] tracking-[0.18em] text-white/20 uppercase w-[62px] shrink-0">Model</span>
                <span className="font-mono text-[10px] text-white/40">
                  {rule.usesModel ? "judge" : "none — deterministic"}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BenefitSection({
  num,
  tag,
  headline,
  sub,
  body,
  cta,
  ctaHref,
  visual,
  flip = false,
}: {
  num: string;
  tag: string;
  headline: string;
  sub: string;
  body: string;
  cta: string;
  ctaHref: string;
  visual: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <section className="relative min-h-screen flex items-center border-b border-white/[0.06] overflow-hidden">
      {/* Giant ghost number */}
      <div
        className="benefit-number absolute pointer-events-none select-none"
        style={{ bottom: "-0.1em", right: flip ? "auto" : "-0.05em", left: flip ? "-0.05em" : "auto" }}
      >
        {num}
      </div>

      <div className="max-w-7xl mx-auto px-8 py-32 w-full">
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center ${flip ? "direction-ltr" : ""}`}>
          {/* Text side */}
          <motion.div
            className={flip ? "lg:order-2" : ""}
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
          >
            <motion.p variants={fadeUp} className="font-mono text-[11px] tracking-[0.25em] text-white/25 uppercase mb-6">
              {tag}
            </motion.p>
            <motion.h2
              variants={staggerContainer}
              className="text-[48px] sm:text-[60px] lg:text-[72px] font-light tracking-[-0.03em] leading-[1.02] text-white mb-8"
            >
              {headline.split("\n").map((line, i) => (
                <motion.span key={i} variants={fadeUp} className="block">
                  {line}
                </motion.span>
              ))}
            </motion.h2>
            <motion.p variants={fadeUp} className="text-[16px] text-white/35 leading-relaxed mb-4 max-w-lg">
              {sub}
            </motion.p>
            <motion.p variants={fadeUp} className="text-[14px] text-white/25 leading-relaxed mb-10 max-w-lg">
              {body}
            </motion.p>
            <motion.div variants={fadeUp}>
              <Link href={ctaHref} className="xai-btn">
                {cta} <ArrowUpRight className="w-3 h-3" />
              </Link>
            </motion.div>
          </motion.div>

          {/* Visual side */}
          <motion.div
            className={flip ? "lg:order-1" : ""}
            initial={{ opacity: 0, x: flip ? -40 : 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 1, ease: EASE_OUT, delay: 0.2 }}
            viewport={{ once: true, margin: "-100px" }}
          >
            {visual}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function BenefitSections() {
  // The deterministic/judge split is a property of the detection catalogue, not
  // a claim — count it rather than type it.
  const deterministic = DETECTIONS.filter((d) => !d.usesModel).length;

  return (
    <>
      <BenefitSection
        num="01"
        tag="[ 01 / OBSERVE ]"
        headline={"Every LLM call\nand tool call,\ntraced."}
        sub="Add @observe to any function and Causal captures a correlated trace tree and timeline for every run — token counts, cost, and latency on each span, and every span linked to the exact file, line, and commit that produced it."
        body="OpenTelemetry-based Python and TypeScript SDKs, with adapters for LangGraph, CrewAI, LlamaIndex, OpenAI Agents, and the Claude Agent SDK."
        cta="SEE HOW IT WORKS"
        ctaHref="#how-it-works"
        visual={<BenefitDagVisual />}
      />
      <BenefitSection
        num="02"
        tag="[ 02 / DETECT ]"
        headline={"An LLM judge\ngrades every\ntrace."}
        sub="Causal runs an LLM-as-judge over every trace, scoring for hallucination, tool and logic failures, intent drift, and safety violations. A failing verdict fires Slack and email alerts and auto-triggers root-cause analysis."
        body="No one has to notice first — detection runs continuously on every trace in production."
        cta="SEE HOW IT WORKS"
        ctaHref="#how-it-works"
        visual={<BenefitCodeVisual />}
        flip
      />
      <BenefitSection
        num="03"
        tag="[ 03 / SECURE ]"
        headline={"The attack is a\ntrust confusion,\nnot a string."}
        sub="Every span carries an origin — who authored these bytes — and a capability — what this node can do. Untrusted content reaching an egress-capable span with private data in scope stops being a string to scan and becomes a path in the trace: reach(untrusted_origin, capability_sink)."
        body={`Causal owns the trace, so the retrieved page, the tool return and the user's turn are separate rows before anything was concatenated — the authorship a prompt-scanning gateway no longer has by the time it observes a prompt. ${deterministic} of the ${DETECTIONS.length} detections never read natural language at all. The console runs on demo data: it labels, detects and explains — it does not block.`}
        cta="OPEN THE SECURITY CONSOLE"
        ctaHref="/security"
        visual={<BenefitSecurityVisual />}
      />
      <BenefitSection
        num="04"
        tag="[ 04 / HEAL ]"
        headline={"Root-caused\nto the commit.\nFixed in a PR."}
        sub="An AI agent clones your repo in a sandbox, correlates the failing span to the exact commit and git history, and explains the cause with a counterfactual. Then it writes the fix and opens the GitHub PR."
        body="Every pull request ships with a diff, a description, and a causal-replay check that runs your tests against the patch when sandbox verification is enabled — and says so plainly when it hasn't."
        cta="EXPLORE A LIVE INCIDENT"
        ctaHref={`/incidents/${FEATURED_INCIDENT_ID}`}
        visual={<BenefitPostmortemVisual />}
        flip
      />
      <BenefitSection
        num="05"
        tag="[ 05 / IMPROVE ]"
        headline={"Every fix,\nverified —\nand kept fixed."}
        sub="A confirmed failure becomes a golden case in one click. Every release is re-run against the whole set, so a fix is proven and a regression can't quietly come back."
        body="Online detection and offline evaluation in one loop — run from the CLI or from inside Claude Code, Cursor, or Codex. Release over release, your agent gets measurably more robust."
        cta="OPEN THE EVAL SETS"
        ctaHref="/evals"
        visual={<BenefitEvalVisual />}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOW IT WORKS — staggered steps with scroll triggers
// ─────────────────────────────────────────────────────────────────────────────

function HowItWorksSection() {
  const steps = [
    {
      num: "01",
      icon: Code2,
      title: "Instrument with @observe",
      description: "Wrap your agent in the SDK. Every LLM call, tool call, and step streams to Causal as a correlated trace — carrying the git commit that produced each span.",
      code: `from causal import observe\n\n@observe(session_id=session.id)\nasync def booking_agent(req: str):\n    ...`,
    },
    {
      num: "02",
      icon: Search,
      title: "The judge grades every trace",
      description: "An LLM-as-judge scores each trace for hallucination, tool and logic failures, drift, and safety. A failing verdict fires alerts and kicks off RCA automatically.",
      code: `# detector verdict\n✗ tool_failure   conf 0.94\n  span: search_flights (llm.call)\n→ alert sent · rca triggered`,
    },
    {
      num: "03",
      icon: Waypoints,
      title: "Trust boundaries on the same trace",
      description: "Each span is labelled with an origin — who authored these bytes — and a capability — what this node can do. Untrusted content reaching a capability sink is then a path in the trace, not a pattern in a prompt.",
      // Detection output, not an API surface — there is no security call to
      // write here that the SDK actually exposes. Fields are SEC-1043's.
      code: `# trust boundary · SEC-1043\n✗ TB-04  rendered-egress sink\n  llm.summarize  UNTRUSTED_EXTERNAL\n  capability EGRESS · 44 B tainted\n→ reach(untrusted_origin, EGRESS)`,
    },
    {
      num: "04",
      icon: GitBranch,
      title: "An agent finds the cause",
      description: "Causal clones your repo in a sandbox, correlates the failing span to the exact commit and git history, and explains the root cause plus the counterfactual.",
      code: `rca.run(incident_id)\n# commit a3f21c · date parsing\n# "if dates were ranged,\n#  this wouldn't have happened"`,
    },
    {
      num: "05",
      icon: Activity,
      title: "It opens the fix PR",
      description: "Causal writes the fix and opens a GitHub pull request — diff, description, and a causal-replay check that runs your tests against the patch when sandbox verification is enabled.",
      code: `gh pr: fix(agent): range-parse dates\n✓ causal-replay: suite passed in sandbox`,
    },
  ];

  return (
    <section className="py-32 px-8 border-b border-white/[0.06]" id="how-it-works">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-20"
        >
          <motion.p variants={fadeUp} className="mb-4">
            <ScrambleText text="[ METHODOLOGY ]" className="font-mono text-[11px] tracking-[0.2em] text-white/45 uppercase" />
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            From one decorator to a fix PR
          </motion.h2>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-white/[0.06]"
        >
          {steps.map(({ num, icon: Icon, title, description, code }, i) => {
            // The 1px "gaps" are this container's own background showing between
            // black cards, so an odd step count would paint the empty cell as a
            // grey block. Rather than pad with a blank card, the last step — the
            // fix PR, which is the point the other four build to — takes the
            // whole final row, and lays its prose beside its code so the wide
            // cell reads as emphasis instead of a stretched card.
            const wide = i === steps.length - 1 && steps.length % 2 !== 0;
            return (
              <motion.div
                key={num}
                variants={cardVariant}
                className={`xai-card bg-black p-8 ${wide ? "md:col-span-2" : ""}`}
              >
                <div className="flex items-start gap-5">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full border border-white/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-white/50" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="font-mono text-[10px] tracking-[0.15em] text-white/20">{num}</span>
                      <h3 className="text-[16px] font-medium text-white">{title}</h3>
                    </div>
                    <div className={wide ? "md:flex md:items-start md:gap-8" : ""}>
                      <p
                        className={`text-[13px] text-white/30 leading-relaxed mb-5 ${
                          wide ? "md:flex-1 md:mb-0" : ""
                        }`}
                      >
                        {description}
                      </p>
                      <div
                        className={`bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 font-mono text-[11px] text-white/25 leading-relaxed whitespace-pre overflow-x-auto ${
                          wide ? "md:flex-1 md:min-w-0" : ""
                        }`}
                      >
                        {code}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAUSAL MODEL STRIP
// ─────────────────────────────────────────────────────────────────────────────

function InstallSection() {
  return (
    <section className="py-24 px-8 border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-10 text-center"
        >
          <motion.p variants={fadeUp} className="mb-4">
            <ScrambleText text="[ GET INSTRUMENTED ]" className="font-mono text-[11px] tracking-[0.25em] text-white/45 uppercase" />
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-[34px] sm:text-[46px] font-light tracking-[-0.03em] text-white leading-tight">
            Instrumented in one line
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-3 text-[15px] text-white/45 max-w-xl mx-auto">
            Install the CLI, hand the prompt to your coding agent, or drop in the Agent Skills —
            your agent wires up tracing for you.
          </motion.p>
        </motion.div>
        <InstallWidget />
      </div>
    </section>
  );
}

function CausalModelStrip() {
  const layers = [
    { label: "INTENT", color: "#7c3aed" },
    { label: "SPEC", color: "#2563eb" },
    { label: "REASONING", color: "#0891b2" },
    { label: "CODE", color: "#059669" },
    { label: "EXECUTION", color: "#d97706" },
    { label: "INCIDENT", color: "#dc2626" },
  ];

  return (
    <section className="py-20 px-8 border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
          viewport={{ once: true, margin: "-60px" }}
          className="border border-white/[0.06] rounded-xl p-12 flex flex-col items-center bg-white/[0.01]"
        >
          <p className="font-mono text-[11px] tracking-[0.2em] text-white/25 uppercase mb-10">
            THE CAUSAL DIAGNOSTIC MODEL
          </p>
          <motion.div
            variants={staggerFast}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="flex flex-wrap justify-center items-center gap-3 sm:gap-5 mb-10 w-full"
          >
            {layers.map(({ label, color }, i) => (
              <motion.div key={label} variants={cardVariant} className="flex items-center gap-3 sm:gap-5">
                <span
                  className="font-mono text-[11px] tracking-[0.15em] border px-5 py-2.5 rounded-full"
                  style={{ color, borderColor: `${color}55`, backgroundColor: `${color}10` }}
                >
                  {label}
                </span>
                {i < layers.length - 1 && <span className="text-white/25">→</span>}
              </motion.div>
            ))}
          </motion.div>
          <p className="text-[14px] text-white/25 max-w-2xl leading-relaxed text-center">
            Six layers connect a user&apos;s intent to the incident it caused. Causal reconstructs
            the whole chain and walks it backward — turning a black-box failure into a specific commit.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURES GRID — staggered card entrance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 1px "gaps" in the grids below are the container's own background showing
 * between black cards, so a part-filled last row paints its empty cells as a
 * grey block. Rather than pad the row with a blank card — which reads as a bug —
 * the final card widens to close it. Keyed by cardCount % 3: a remainder of 1
 * leaves one card alone on the row (span 3), a remainder of 2 leaves two (the
 * last spans 2). At a clean multiple there is no key and nothing is applied.
 * Class names are written out in full so Tailwind's scanner emits them.
 */
const LAST_CARD_SPAN: Record<number, string | undefined> = {
  1: "lg:col-span-3",
  2: "lg:col-span-2",
};

function FeaturesSection() {
  // Every claim links to where it can actually be seen in the demo. A feature
  // grid that only asserts is a feature grid nobody believes.
  const incident = `/incidents/${FEATURED_INCIDENT_ID}`;
  const features = [
    { icon: Activity, title: "Trace tree + timeline", description: "Every run rendered as a correlated trace tree and timeline. Drill from the top-level agent step down to the raw LLM and tool call.", href: incident, see: "Open a trace" },
    { icon: GitBranch, title: "Git-linked spans", description: "Every span carries the file, line, and commit that produced it — so a failure is one click from the code that caused it.", href: incident, see: "See a git-linked span" },
    { icon: Search, title: "Signal, not noise", description: "Traces are scored on error, latency, cost, retry loops and whether a failure is actionable. The ones that matter surface; the rest are sampled away.", href: "/incidents", see: "Browse incidents" },
    { icon: Shield, title: "LLM-as-judge detectors", description: "Continuous evaluation for hallucination, tool and logic failures, intent drift, and safety violations — scored on every trace, not just the ones that already errored.", href: "/detectors", see: "See the detectors" },
    { icon: Waypoints, title: "Trust boundaries", description: "Every span is labelled with where its bytes came from and what it can do, so untrusted content reaching an egress tool with private data in scope is a path in the trace — not a pattern in a prompt. Blocked and succeeded are both on the record.", href: "/security", see: "Open the security console" },
    { icon: Radar, title: `${DETECTIONS.length} boundary detections`, description: `${DETECTIONS.filter((d) => !d.usesModel).length} of them never read natural language — they run on span shape, origin labels and byte provenance. Each one states what it catches, the signal it needs, and its backtest over stored traces.`, href: "/security", see: "See the detections" },
    { icon: Cpu, title: "Agentic RCA", description: "An AI agent works in a sandbox with your source: real git blame and pickaxe to find the commit that introduced the failure, explained with a counterfactual.", href: incident, see: "Read an RCA" },
    { icon: GitBranch, title: "Commits, PRs and issues", description: "A failure is correlated not just to the commit but to the pull request that shipped it, the issues it closed, and open issues that already describe it.", href: incident, see: "See the correlation" },
    { icon: Code2, title: "Verified fix PRs", description: "Causal writes the fix and opens a pull request — diff, description, and a causal-replay check that runs your tests against the patch before claiming it's resolved.", href: incident, see: "Open a fix PR" },
    { icon: RotateCcw, title: "Counterfactual replay", description: "Re-run a failed trace against its captured snapshot with the fix applied — or with your own system-prompt append — and read the original and modified output side by side, scored for fidelity with the changed lines counted.", href: `${incident}/replay`, see: "Open the replay sandbox" },
    { icon: Zap, title: "Causal Copilot", description: "Ask any trace a question — why did this fail, what's the fix, where did the cost go. Answers grounded in your spans, RCA and git history.", href: incident, see: "Ask the Copilot" },
    { icon: Database, title: "Datasets & evals", description: "Turn a production finding into a golden case in one click, then re-run every release against it — so a fix is verified and a regression can't come back unnoticed.", href: "/evals", see: "Open the eval sets" },
    { icon: FileText, title: "Token & cost accounting", description: "Tokens and spend recorded per span and rolled up through every parent, so you can see exactly which agent step, retry, or sub-agent burned the budget.", href: "/dashboard", see: "See the rollups" },
    { icon: Shield, title: "Bring your own model", description: "Anthropic, OpenAI, Gemini, xAI, DeepSeek, OpenRouter, Kimi, GLM or Bedrock — per workspace, per purpose. Keys are encrypted at rest and never leave your org." },
    { icon: Webhook, title: "Built for your stack", description: "OpenTelemetry-based SDKs with adapters for LangGraph, CrewAI, LlamaIndex, OpenAI Agents, Vercel AI, and Claude Agent SDK. GitHub, Slack, and email included.", href: "#integrations", see: "See integrations" },
  ];

  return (
    <section className="relative py-32 px-8 border-b border-white/[0.06]" id="features">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-20"
        >
          <motion.p variants={fadeUp} className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
            [ CAPABILITIES ]
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            One tool, the whole loop
          </motion.h2>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-[1px] bg-white/[0.06]"
        >
          {features.map(({ icon: Icon, title, description, href, see }, i) => {
            const inner = (
              <>
                <div className="w-10 h-10 rounded-full border border-white/[0.08] flex items-center justify-center mb-5 group-hover:border-white/25 transition-colors">
                  <Icon className="w-4 h-4 text-white/40 group-hover:text-white/70 transition-colors" />
                </div>
                <h3 className="text-[15px] font-medium text-white mb-2">{title}</h3>
                <p className="text-[13px] text-white/25 leading-relaxed">{description}</p>
                {see && (
                  <span className="inline-flex items-center gap-1 mt-4 font-mono text-[10px] tracking-[0.14em] uppercase text-white/25 group-hover:text-white/70 transition-colors">
                    {see} <ArrowUpRight className="w-3 h-3" />
                  </span>
                )}
              </>
            );
            return (
              <motion.div
                key={title}
                variants={cardVariant}
                className={`xai-card bg-black group hover:bg-white/[0.02] transition-colors ${
                  i === features.length - 1 ? LAST_CARD_SPAN[features.length % 3] ?? "" : ""
                }`}
              >
                {href ? (
                  <Link href={href} className="block p-8">{inner}</Link>
                ) : (
                  <div className="p-8">{inner}</div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATIONS — staggered reveal
// ─────────────────────────────────────────────────────────────────────────────

function IntegrationsSection() {
  const groups = [
    { label: "Agent Frameworks", items: ["LangGraph", "LangChain", "CrewAI", "LlamaIndex", "OpenAI Agents"] },
    { label: "LLM Providers", items: ["Anthropic", "OpenAI", "Gemini", "Mistral", "Bedrock"] },
    { label: "Code & Alerts", items: ["GitHub", "Slack", "Email", "Linear"] },
    { label: "Standards & SDKs", items: ["OpenTelemetry", "Python SDK", "TypeScript SDK", "Vercel AI SDK", "Claude Agent SDK"] },
  ];

  return (
    <section className="py-32 px-8 border-b border-white/[0.06]" id="integrations">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-20"
        >
          <motion.p variants={fadeUp} className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
            [ INTEGRATIONS ]
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            Works with your existing stack
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-[15px] text-white/30 max-w-lg">
            Drop Causal into your current workflow. No rearchitecting required.
          </motion.p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[1px] bg-white/[0.06]"
        >
          {groups.map(({ label, items }) => (
            <motion.div key={label} variants={cardVariant} className="xai-card bg-black p-8">
              <p className="font-mono text-[10px] tracking-[0.2em] text-white/20 uppercase mb-6">{label}</p>
              <motion.div
                variants={staggerFast}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="flex flex-col gap-3"
              >
                {items.map((item) => (
                  <motion.div key={item} variants={fadeIn} className="flex items-center gap-3">
                    <Check className="w-3 h-3 text-white/25 flex-shrink-0" />
                    <span className="text-[13px] text-white/40">{item}</span>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING — staggered slide-up
// ─────────────────────────────────────────────────────────────────────────────

function PricingSection() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "/ month",
      description: "For individuals and small projects",
      features: ["Up to 10,000 traces / month", "7-day trace retention", "1 project", "Community support", "Python SDK", "Basic RCA (5 / month)"],
      cta: "GET STARTED FREE",
      ctaHref: "/incidents",
      highlight: false,
    },
    {
      name: "Team",
      price: "$49",
      period: "/ month",
      description: "For growing engineering teams",
      features: ["Up to 500,000 traces / month", "30-day trace retention", "10 projects", "Slack + email support", "Unlimited RCA", "Webhook integrations", "AI postmortem generation", "MCP server access"],
      cta: "START FREE TRIAL",
      ctaHref: "/incidents",
      highlight: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "",
      description: "For large teams with advanced needs",
      features: ["Unlimited traces", "Custom retention", "Unlimited projects", "Dedicated support", "SSO / SAML", "SLA guarantee", "On-prem deployment", "Custom integrations"],
      cta: "CONTACT SALES",
      ctaHref: "mailto:sales@causal.dev",
      highlight: false,
    },
  ];

  return (
    <section className="py-32 px-8 border-b border-white/[0.06]" id="pricing">
      <div className="max-w-7xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="mb-20"
        >
          <motion.p variants={fadeUp} className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
            [ PRICING ]
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            Simple, transparent pricing
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-[15px] text-white/30">
            Start free. Upgrade when you need more.
          </motion.p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-white/[0.06]"
        >
          {plans.map(({ name, price, period, description, features, cta, ctaHref, highlight }) => (
            <motion.div
              key={name}
              variants={cardVariant}
              className={`bg-black p-8 flex flex-col relative ${highlight ? "" : "xai-card"}`}
            >
              {highlight && (
                <div className="absolute -top-px left-0 right-0 h-[1px] bg-white/30" />
              )}
              <div className="mb-8">
                <h3 className="font-mono text-[12px] tracking-[0.15em] text-white/50 uppercase mb-3">{name}</h3>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-[40px] font-light text-white tracking-tight">{price}</span>
                  <span className="text-[13px] text-white/25">{period}</span>
                </div>
                <p className="text-[13px] text-white/25">{description}</p>
              </div>
              <Link href={ctaHref} className={`xai-btn text-[11px] justify-center mb-8 ${highlight ? "xai-btn-primary" : ""}`}>
                {cta}
              </Link>
              <div className="flex flex-col gap-3 flex-1">
                {features.map((f) => (
                  <div key={f} className="flex items-start gap-3">
                    <Check className={`w-3 h-3 mt-0.5 flex-shrink-0 ${highlight ? "text-white/60" : "text-white/20"}`} />
                    <span className="text-[13px] text-white/35">{f}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA — full-screen dramatic finale
// ─────────────────────────────────────────────────────────────────────────────

function CTASection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-8 border-b border-white/[0.06] overflow-hidden">
      {/* Orbiting rings */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ perspective: "600px", transformStyle: "preserve-3d" }}>
        {[180, 260, 360, 480, 620].map((r, i) => (
          <div
            key={i}
            className="absolute rounded-full border border-solid"
            style={{
              width: `${r}px`,
              height: `${r}px`,
              top: "50%", left: "50%",
              marginTop: `-${r / 2}px`, marginLeft: `-${r / 2}px`,
              borderColor: `rgba(255,255,255,${0.07 - i * 0.011})`,
              animation: `accretion-spin ${55 + i * 15}s linear infinite${i % 2 === 0 ? "" : " reverse"}`,
              transformStyle: "preserve-3d",
            }}
          />
        ))}
      </div>

      {/* Ambient glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, rgba(255,255,255,0.02) 0%, transparent 65%)" }}
      />

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        className="relative z-10 max-w-3xl mx-auto text-center"
      >
        <motion.p variants={fadeUp} className="font-mono text-[11px] tracking-[0.25em] text-white/25 uppercase mb-8">
          [ GET STARTED ]
        </motion.p>

        <motion.h2
          variants={staggerContainer}
          className="text-[44px] sm:text-[64px] font-light tracking-[-0.04em] text-white leading-[1.05] mb-8"
        >
          <motion.span variants={fadeUp} className="block">
            Ship agents you can
          </motion.span>
          <motion.span variants={fadeUp} className="block gradient-text">
            actually fix.
          </motion.span>
        </motion.h2>

        <motion.p variants={fadeUp} className="text-[16px] text-white/30 mb-14 leading-relaxed max-w-md mx-auto font-light">
          Add one decorator and Causal takes it from there — tracing every run, catching the
          failures, and opening the fix PR. Explore a live incident, no signup required.
        </motion.p>

        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href={`/incidents/${FEATURED_INCIDENT_ID}`} className="xai-btn xai-btn-primary">
            EXPLORE A LIVE INCIDENT <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <a href="https://github.com/mitanshubhoot/causal" target="_blank" rel="noreferrer" className="xai-btn">
            READ THE DOCS <ArrowUpRight className="w-3 h-3" />
          </a>
        </motion.div>

        <motion.p variants={fadeUp} className="mt-10 font-mono text-[11px] tracking-[0.15em] text-white/45 uppercase">
          Live product demo &nbsp;·&nbsp; No signup &nbsp;·&nbsp; Real traces, detectors &amp; fix PRs
        </motion.p>
      </motion.div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────────────────────────────────────

function Footer() {
  // Every link here resolves to something that exists — a route in this app or a
  // path in the repo. The Blog/Status/Careers/Privacy columns were href="#": a
  // footer of links that go nowhere reads as an unfinished product, so they are
  // gone rather than stubbed.
  const REPO = "https://github.com/mitanshubhoot/causal";
  const columns = [
    {
      heading: "PRODUCT",
      links: [
        { label: "Live Demo", href: `/incidents/${FEATURED_INCIDENT_ID}` },
        { label: "Incidents", href: "/incidents" },
        { label: "Dashboard", href: "/dashboard" },
        { label: "Detectors", href: "/detectors" },
        { label: "Eval sets", href: "/evals" },
        { label: "Integrations", href: "/#integrations" },
      ],
    },
    {
      heading: "RESOURCES",
      links: [
        { label: "Documentation", href: `${REPO}#readme` },
        { label: "Architecture", href: `${REPO}/blob/main/docs/CAUSAL_V2_ARCHITECTURE.md` },
        { label: "Python SDK", href: `${REPO}/tree/main/packages/sdk-python` },
        { label: "TypeScript SDK", href: `${REPO}/tree/main/packages/sdk-typescript` },
        { label: "Agent Skills", href: `${REPO}/tree/main/skills` },
        { label: "GitHub", href: REPO },
      ],
    },
  ];

  return (
    <footer className="border-t border-white/[0.06] pt-16 pb-10 px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-16">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-3 mb-5">
              <LogoMark size={24} />
              <span className="text-[14px] font-medium text-white">Causal</span>
            </Link>
            <p className="text-[12px] text-white/20 leading-relaxed max-w-[160px]">
              Root cause intelligence for AI-agent engineering teams.
            </p>
          </div>
          {columns.map(({ heading, links }) => (
            <div key={heading}>
              <p className="font-mono text-[10px] tracking-[0.2em] text-white/25 mb-5">{heading}</p>
              <div className="flex flex-col gap-3">
                {links.map(({ label, href }) => (
                  <Link
                    key={label}
                    href={href}
                    {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="text-[13px] text-white/25 hover:text-white/60 transition-colors duration-300"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-white/[0.06] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-mono text-[11px] tracking-[0.1em] text-white/15">
            © 2026 CAUSAL. ALL RIGHTS RESERVED.
          </p>
          <div className="flex items-center gap-6">
            <Link
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] tracking-[0.15em] text-white/15 hover:text-white/40 transition-colors duration-300"
            >
              GITHUB
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-black text-white relative">
        <StarField />
        <Nav />
        <HeroSection />
        <FailureTicker />
        <InstallSection />
        <LandingTraceDemo />
        {/* The explorer lets you touch one trace; this walks that same trace
            through all five capabilities as real artifacts. Demonstration
            before argument. */}
        <LandingCapabilityTour />
        {/* Straight off the live explorer, which opens on the featured incident:
            the reader has just been clicking that trace, so counting what it
            produced and linking each artifact is a continuation rather than a
            new claim. It also lands before the benefit sections, so those read
            as detail on something already shown. */}
        <DepthSection />
        <StatsSection />
        <BenefitSections />
        <HowItWorksSection />
        <CausalModelStrip />
        <FeaturesSection />
        <IntegrationsSection />
        <PricingSection />
        <CTASection />
        <Footer />
      </div>
    </MotionConfig>
  );
}
