"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
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
  Zap,
  FileText,
  Cpu,
  ExternalLink,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// LOGO — Causal Mark
// ─────────────────────────────────────────────────────────────────────────────

function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
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
// STAR FIELD (global background)
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
// NAV — x.ai style (ALL CAPS monospace)
// ─────────────────────────────────────────────────────────────────────────────

function Nav() {
  const links = [
    { label: "PRODUCT", href: "#product" },
    { label: "HOW IT WORKS", href: "#how-it-works" },
    { label: "FEATURES", href: "#features" },
    { label: "INTEGRATIONS", href: "#integrations" },
    { label: "PRICING", href: "#pricing" },
  ];

  return (
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

        <Link
          href="/incidents"
          className="xai-btn text-[11px]"
        >
          GET STARTED
        </Link>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERSTELLAR BLACKHOLE — Procedural canvas-based blackhole with particles
// ─────────────────────────────────────────────────────────────────────────────

function InterstellarBlackhole() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const nx = (e.clientX - window.innerWidth / 2) * 0.02;
      const ny = (e.clientY - window.innerHeight / 2) * 0.02;
      mousePosRef.current = { x: nx, y: ny };
      setMousePos({ x: nx, y: ny });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resize = () => {
      canvas.width = window.innerWidth * 2; // 2x for retina
      canvas.height = window.innerHeight * 2;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    // Create particles
    interface Particle {
      angle: number;
      radius: number;
      speed: number;
      size: number;
      brightness: number;
      tilt: number; // 3D tilt of orbit plane
      phase: number; // offset for vertical oscillation
    }

    const particles: Particle[] = [];
    const PARTICLE_COUNT = 2000;
    const EVENT_HORIZON = 550; // px at 2x scale — huge, dramatic sphere

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Distribution: very dense near event horizon, sparse far out
      const t = Math.random();
      const radius = EVENT_HORIZON + 15 + Math.pow(t, 0.45) * 750;
      const speed = (0.1 + Math.random() * 0.22) / (1 + (radius - EVENT_HORIZON) * 0.0015);

      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius,
        speed: speed * (Math.random() > 0.5 ? 1 : -1),
        size: 0.6 + Math.random() * 4.0,
        brightness: 0.5 + Math.random() * 0.5,
        tilt: -0.1 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
      });
    }

    let animId: number;
    let time = 0;

    const draw = () => {
      time += 0.003; // Very slow — drifting near the blackhole
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h * 0.42; // blackhole slightly above center

      // Mouse offset for parallax
      const mouse = mousePosRef.current;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // ── Background: deep space with faint stars ──
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);

      // ── Accretion disk glow (soft bloom behind particles) ──
      const mox = mouse.x * 12;
      const moy = mouse.y * 12;
      const glowGrad = ctx.createRadialGradient(
        cx + mox, cy + moy,
        EVENT_HORIZON * 0.9,
        cx + mox, cy + moy,
        EVENT_HORIZON * 3.5
      );
      glowGrad.addColorStop(0, "rgba(200,200,220,0.0)");
      glowGrad.addColorStop(0.1, "rgba(240,240,255,0.12)");
      glowGrad.addColorStop(0.25, "rgba(230,230,245,0.09)");
      glowGrad.addColorStop(0.4, "rgba(210,210,230,0.06)");
      glowGrad.addColorStop(0.6, "rgba(190,190,210,0.03)");
      glowGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);

      // ── Draw particles (accretion disk) ──
      for (const p of particles) {
        p.angle += p.speed * 0.003;

        // 3D-ish orbit: elliptical with vertical oscillation for depth
        const rx = p.radius;
        const ry = p.radius * 0.38; // flatten for disk perspective
        const x = cx + Math.cos(p.angle) * rx + mouse.x * (8 + p.radius * 0.012);
        const y = cy + Math.sin(p.angle) * ry + Math.sin(p.angle + p.phase) * p.tilt * p.radius + mouse.y * (8 + p.radius * 0.012);

        // Particles behind the blackhole are occluded
        const behindBlackhole = Math.sin(p.angle) > 0;
        const distFromCenter = Math.sqrt(
          Math.pow(x - cx - mouse.x * 8, 2) + Math.pow(y - cy - mouse.y * 8, 2)
        );

        if (behindBlackhole && distFromCenter < EVENT_HORIZON * 1.1) continue;

        // Brightness varies: brighter on the approach side (Doppler-like)
        const doppler = 0.6 + 0.4 * Math.cos(p.angle);
        const alpha = p.brightness * doppler * (behindBlackhole ? 0.3 : 1);

        // Color: warm inner, cool outer
        const innerFactor = 1 - Math.min((p.radius - EVENT_HORIZON) / 600, 1);
        const r = Math.floor(220 + innerFactor * 35);
        const g = Math.floor(215 + innerFactor * 30);
        const b = Math.floor(230 - innerFactor * 25);

        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.95})`;
        ctx.fill();

        // Larger glow halos on bigger particles
        if (p.size > 1.2 && alpha > 0.3) {
          ctx.beginPath();
          ctx.arc(x, y, p.size * 5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.1})`;
          ctx.fill();
        }
        // Extra bloom on the brightest particles
        if (p.size > 2.5 && alpha > 0.5) {
          ctx.beginPath();
          ctx.arc(x, y, p.size * 8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.04})`;
          ctx.fill();
        }
      }

      // ── Event Horizon — crisp dark sphere ──
      const ehx = cx + mouse.x * 8;
      const ehy = cy + mouse.y * 8;
      const ehGrad = ctx.createRadialGradient(
        ehx, ehy, 0,
        ehx, ehy, EVENT_HORIZON * 1.2
      );
      ehGrad.addColorStop(0, "rgba(0,0,0,1)");
      ehGrad.addColorStop(0.75, "rgba(0,0,0,1)");
      ehGrad.addColorStop(0.9, "rgba(0,0,0,0.9)");
      ehGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ehGrad;
      ctx.beginPath();
      ctx.arc(ehx, ehy, EVENT_HORIZON * 1.2, 0, Math.PI * 2);
      ctx.fill();

      // ── Thin photon ring at edge of event horizon ──
      ctx.beginPath();
      ctx.arc(ehx, ehy, EVENT_HORIZON * 1.02, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(240,240,250,${0.12 + 0.04 * Math.sin(time * 8)})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // ── Subtle second ring ──
      ctx.beginPath();
      ctx.arc(ehx, ehy, EVENT_HORIZON * 1.08, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(230,230,240,${0.05 + 0.02 * Math.sin(time * 6)})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // ── Faint gravitational lensing band ──
      ctx.beginPath();
      ctx.arc(ehx, ehy, EVENT_HORIZON * 1.25, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(220,220,230,${0.02 + 0.01 * Math.sin(time * 4)})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const { x: mx, y: my } = mousePos;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      {/* Canvas particles */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0"
        style={{ opacity: 1 }}
      />

      {/* ── CSS glow layers on top of canvas for extra depth ── */}

      {/* Warm glow behind the accretion disk */}
      <div
        className="absolute"
        style={{
          top: "42%",
          left: "50%",
          width: "800px",
          height: "400px",
          transform: `translate(-50%, -50%) translate(${mx * 6}px, ${my * 6}px)`,
          transition: "transform 0.5s ease-out",
          background:
            "radial-gradient(ellipse 100% 60% at 50% 50%, rgba(210,210,230,0.04) 0%, rgba(200,200,220,0.02) 30%, transparent 55%)",
          filter: "blur(50px)",
          animation: "cosmic-breathe 10s ease-in-out infinite",
        }}
      />

      {/* Cool mist left side */}
      <div
        className="absolute"
        style={{
          top: "35%",
          left: "30%",
          width: "500px",
          height: "350px",
          transform: `translate(-50%, -50%) translate(${mx * 3}px, ${my * 2}px)`,
          transition: "transform 0.6s ease-out",
          background:
            "radial-gradient(ellipse at center, rgba(100,130,200,0.03) 0%, transparent 50%)",
          filter: "blur(70px)",
          animation: "cosmic-breathe 14s ease-in-out 2s infinite",
        }}
      />

      {/* ── Edges: fade to pure black ── */}
      <div className="absolute bottom-0 left-0 right-0 h-72 bg-gradient-to-t from-black via-black/80 to-transparent" />
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute top-0 left-0 bottom-0 w-24 bg-gradient-to-r from-black/40 to-transparent" />
      <div className="absolute top-0 right-0 bottom-0 w-24 bg-gradient-to-l from-black/40 to-transparent" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO SECTION — Giant wordmark + Interstellar blackhole
// ─────────────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <InterstellarBlackhole />

      {/* Giant semi-transparent wordmark behind content (like "Grok" on x.ai) */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] pointer-events-none select-none hero-glow-text"
        style={{
          fontSize: "clamp(120px, 18vw, 260px)",
          fontWeight: 200,
          letterSpacing: "-0.03em",
          color: "rgba(255,255,255,0.07)",
          whiteSpace: "nowrap",
          lineHeight: 1,
        }}
      >
        Causal
      </div>

      {/* Main content — overlaid on top */}
      <div className="relative z-10 text-center px-6 max-w-3xl mx-auto">
        <h1
          className="text-[48px] sm:text-[64px] md:text-[80px] font-light tracking-[-0.04em] leading-[1.05] mb-8 text-white"
        >
          Agent failures shouldn&apos;t{" "}
          <span className="gradient-text font-normal">be a black box.</span>
        </h1>

        <p className="text-[16px] sm:text-[18px] text-white/40 max-w-[480px] mx-auto leading-relaxed mb-14 font-light">
          Trace incidents back to the exact prompt, inference step, or logic flaw that caused them.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/incidents" className="xai-btn xai-btn-primary">
            DEPLOY INSTRUMENTATION <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link href="/traces" className="xai-btn">
            ACCESS SANDBOX <ExternalLink className="w-3 h-3" />
          </Link>
        </div>

        <p className="mt-8 font-mono text-[11px] tracking-[0.15em] text-white/20 uppercase">
          No credit card required &nbsp;·&nbsp; Free tier &nbsp;·&nbsp; Setup in 5 min
        </p>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10">
        <div className="w-5 h-8 rounded-full border border-white/20 flex items-start justify-center p-1.5">
          <div className="w-0.5 h-2 bg-white/40 rounded-full animate-bounce" />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT CARDS — "Trace" / "Diagnose" / "Resolve" (x.ai card style)
// ─────────────────────────────────────────────────────────────────────────────

function ProductCardsSection() {
  const cards = [
    {
      title: "Trace",
      description:
        "Add the @trace decorator to your agent functions. Every inference, tool call, and reasoning step is captured into a deterministic causal graph — automatically.",
      illustration: (
        <svg viewBox="0 0 200 140" fill="none" className="w-full h-full opacity-30">
          <circle cx="100" cy="70" r="50" stroke="white" strokeWidth="0.5" />
          <circle cx="100" cy="70" r="30" stroke="white" strokeWidth="0.5" />
          <circle cx="100" cy="70" r="10" fill="white" opacity="0.3" />
          <line x1="100" y1="20" x2="100" y2="120" stroke="white" strokeWidth="0.3" opacity="0.3" />
          <line x1="50" y1="70" x2="150" y2="70" stroke="white" strokeWidth="0.3" opacity="0.3" />
        </svg>
      ),
      cta: "EXPLORE",
      href: "/traces",
    },
    {
      title: "Diagnose",
      description:
        "When an incident fires, Causal walks the knowledge graph backwards from the failure node. LLM evaluators score counterfactual derivations at every step to find the root cause.",
      illustration: (
        <svg viewBox="0 0 200 140" fill="none" className="w-full h-full opacity-30">
          <path d="M30 120 L100 30 L170 120" stroke="white" strokeWidth="0.5" fill="none" />
          <circle cx="100" cy="30" r="4" fill="white" opacity="0.5" />
          <circle cx="30" cy="120" r="3" fill="white" opacity="0.3" />
          <circle cx="170" cy="120" r="3" fill="white" opacity="0.3" />
          <line x1="65" y1="75" x2="135" y2="75" stroke="white" strokeWidth="0.3" strokeDasharray="3 3" />
          <circle cx="65" cy="75" r="2" fill="white" opacity="0.4" />
          <circle cx="135" cy="75" r="2" fill="white" opacity="0.4" />
        </svg>
      ),
      cta: "LEARN MORE",
      href: "#how-it-works",
    },
    {
      title: "Resolve",
      description:
        "Generate AI-powered postmortems, counterfactual scenarios, and concrete remediation steps. Stop repeating the same agent failures across deployments.",
      illustration: (
        <svg viewBox="0 0 200 140" fill="none" className="w-full h-full opacity-30">
          <rect x="40" y="20" width="120" height="100" rx="4" stroke="white" strokeWidth="0.5" />
          <line x1="55" y1="45" x2="145" y2="45" stroke="white" strokeWidth="0.3" opacity="0.4" />
          <line x1="55" y1="60" x2="130" y2="60" stroke="white" strokeWidth="0.3" opacity="0.3" />
          <line x1="55" y1="75" x2="140" y2="75" stroke="white" strokeWidth="0.3" opacity="0.3" />
          <line x1="55" y1="90" x2="110" y2="90" stroke="white" strokeWidth="0.3" opacity="0.2" />
          <line x1="55" y1="105" x2="125" y2="105" stroke="white" strokeWidth="0.3" opacity="0.2" />
        </svg>
      ),
      cta: "LEARN MORE",
      href: "#features",
    },
  ];

  return (
    <section className="relative py-32 px-8" id="product">
      <div className="max-w-7xl mx-auto">
        <p className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
          [ PRODUCTS ]
        </p>
        <h2 className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white mb-20">
          Root cause intelligence
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-white/[0.06]">
          {cards.map(({ title, description, illustration, cta, href }) => (
            <div
              key={title}
              className="xai-card bg-black flex flex-col"
            >
              {/* Text area */}
              <div className="p-8 pb-6">
                <h3 className="text-[20px] font-medium text-white mb-3">{title}</h3>
                <p className="text-[14px] text-white/35 leading-relaxed">{description}</p>
              </div>

              {/* Illustration area */}
              <div className="flex-1 flex items-center justify-center px-8 py-6 min-h-[200px]">
                {illustration}
              </div>

              {/* CTA */}
              <div className="p-8 pt-4">
                <Link href={href} className="xai-btn text-[11px]">
                  {cta} <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAUSAL GRAPH — Interactive DAG Visualization (unique to Causal)
// ─────────────────────────────────────────────────────────────────────────────

function CausalGraphSection() {
  // DAG nodes: each layer of the causal diagnostic model
  const layers = [
    { label: "Intent", x: 80, nodes: [{ y: 280 }] },
    { label: "Spec", x: 230, nodes: [{ y: 200 }, { y: 360 }] },
    { label: "Inference", x: 410, nodes: [{ y: 150 }, { y: 280 }, { y: 420 }] },
    { label: "Logic", x: 580, nodes: [{ y: 190 }, { y: 330 }, { y: 460 }] },
    { label: "State", x: 740, nodes: [{ y: 240 }, { y: 380 }] },
    { label: "Failure", x: 920, nodes: [{ y: 310 }] },
  ];

  // Generate edges between adjacent layers
  const edges: { x1: number; y1: number; x2: number; y2: number; delay: number }[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const current = layers[i];
    const next = layers[i + 1];
    for (const fromNode of current.nodes) {
      for (const toNode of next.nodes) {
        const dist = Math.abs(fromNode.y - toNode.y);
        if (dist < 250) {
          edges.push({
            x1: current.x,
            y1: fromNode.y,
            x2: next.x,
            y2: toNode.y,
            delay: edges.length * 0.3,
          });
        }
      }
    }
  }

  return (
    <section className="relative py-32 px-8 overflow-hidden border-t border-white/[0.06]" id="causal-graph">
      <div className="max-w-7xl mx-auto relative">
        <p className="font-mono text-[12px] tracking-[0.25em] text-white/30 uppercase mb-6 text-center">
          [ THE CAUSAL GRAPH ]
        </p>

        {/* Centered heading — bold and readable */}
        <h2 className="text-center mb-6">
          <span className="text-[52px] sm:text-[72px] font-light tracking-[-0.03em] text-white">
            Trace{" "}
          </span>
          <span className="text-[52px] sm:text-[72px] font-light tracking-[-0.03em] text-white/40">
            The Root Cause
          </span>
        </h2>

        <p className="text-[15px] text-white/30 max-w-2xl mx-auto mb-20 leading-relaxed text-center">
          Every agent execution builds a directed acyclic graph. When a failure occurs,
          Causal walks backwards from the terminal fault through every decision node,
          scoring counterfactual derivations to isolate the exact semantic deviation.
        </p>

        {/* SVG DAG visualization */}
        <div className="relative w-full rounded-2xl border border-white/[0.06] overflow-hidden bg-white/[0.01]" style={{ height: "560px" }}>
          {/* Subtle grid in background */}
          <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
            <defs>
              <pattern id="dag-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <line x1="40" y1="0" x2="40" y2="40" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
                <line x1="0" y1="40" x2="40" y2="40" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dag-grid)" />
          </svg>

          {/* Scanning line — sweeps left to right to show root cause tracing */}
          <div
            className="absolute top-0 bottom-0 w-[2px] z-20 pointer-events-none"
            style={{
              background: "linear-gradient(180deg, transparent 10%, rgba(255,255,255,0.12) 50%, transparent 90%)",
              boxShadow: "0 0 20px rgba(255,255,255,0.06), 0 0 60px rgba(255,255,255,0.03)",
              animation: "scan-sweep 6s ease-in-out infinite",
            }}
          />

          <svg viewBox="0 0 1000 560" className="w-full h-full relative z-10" preserveAspectRatio="xMidYMid meet">
            <defs>
              {/* Arrow marker */}
              <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.2)" />
              </marker>
              {/* Glow filter for active nodes */}
              <filter id="node-glow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* Stronger glow for highlighted nodes */}
              <filter id="node-glow-strong">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Edges — curved paths with animated dashes */}
            {edges.map(({ x1, y1, x2, y2, delay }, i) => {
              const midX = (x1 + x2) / 2;
              const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
              return (
                <path
                  key={`edge-${i}`}
                  d={path}
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                  markerEnd="url(#arrow)"
                  strokeDasharray="4 4"
                  style={{
                    animation: `edge-pulse 3s linear ${delay}s infinite`,
                  }}
                />
              );
            })}

            {/* Layer labels — bolder and larger */}
            {layers.map(({ label, x }) => (
              <text
                key={`label-${label}`}
                x={x}
                y={70}
                textAnchor="middle"
                fill="rgba(255,255,255,0.35)"
                fontSize="13"
                fontFamily="ui-monospace, monospace"
                fontWeight="600"
                letterSpacing="0.2em"
              >
                {label.toUpperCase()}
              </text>
            ))}

            {/* Nodes — larger with floating animation */}
            {layers.map(({ label, x, nodes }, layerIdx) =>
              nodes.map((node, nodeIdx) => {
                const isFailure = label === "Failure";
                const isIntent = label === "Intent";
                const size = isFailure ? 9 : isIntent ? 8 : 5;
                const floatDuration = 4 + layerIdx * 0.6 + nodeIdx * 0.8;
                const floatDelay = layerIdx * 0.3 + nodeIdx * 0.5;
                return (
                  <g
                    key={`node-${layerIdx}-${nodeIdx}`}
                    style={{
                      animation: `node-float ${floatDuration}s ease-in-out ${floatDelay}s infinite`,
                    }}
                  >
                    {/* Outer pulse ring */}
                    <circle
                      cx={x}
                      cy={node.y}
                      r={size + 14}
                      fill="none"
                      stroke={isFailure ? "rgba(255,140,140,0.06)" : "rgba(255,255,255,0.03)"}
                      strokeWidth="0.5"
                      style={{
                        animation: `node-breathe ${3 + nodeIdx}s ease-in-out ${layerIdx * 0.5}s infinite`,
                      }}
                    />
                    {/* Inner glow ring */}
                    <circle
                      cx={x}
                      cy={node.y}
                      r={size + 6}
                      fill="none"
                      stroke={isFailure ? "rgba(255,180,180,0.1)" : "rgba(255,255,255,0.05)"}
                      strokeWidth="0.5"
                    />
                    {/* Node circle */}
                    <circle
                      cx={x}
                      cy={node.y}
                      r={size}
                      fill={isFailure ? "rgba(255,100,100,0.7)" : isIntent ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.45)"}
                      filter={isFailure || isIntent ? "url(#node-glow-strong)" : "url(#node-glow)"}
                    />
                    {/* Center dot */}
                    <circle
                      cx={x}
                      cy={node.y}
                      r={2}
                      fill="white"
                      opacity={isFailure ? 1 : 0.7}
                    />
                    {/* Node label below */}
                    {(isFailure || isIntent) && (
                      <text
                        x={x}
                        y={node.y + size + 20}
                        textAnchor="middle"
                        fill={isFailure ? "rgba(255,140,140,0.5)" : "rgba(255,255,255,0.3)"}
                        fontSize="9"
                        fontFamily="ui-monospace, monospace"
                        letterSpacing="0.1em"
                      >
                        {isIntent ? "START" : "FAULT"}
                      </text>
                    )}
                  </g>
                );
              })
            )}

            {/* Highlight path — the "root cause" trace */}
            {(() => {
              const path = [
                { x: 80, y: 280 },
                { x: 230, y: 200 },
                { x: 410, y: 280 },
                { x: 580, y: 330 },
                { x: 740, y: 380 },
                { x: 920, y: 310 },
              ];
              const segments = [];
              for (let i = 0; i < path.length - 1; i++) {
                const from = path[i];
                const to = path[i + 1];
                const midX = (from.x + to.x) / 2;
                const d = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
                segments.push(
                  <path
                    key={`highlight-${i}`}
                    d={d}
                    fill="none"
                    stroke="rgba(255,255,255,0.22)"
                    strokeWidth="2"
                    strokeDasharray="8 4"
                    style={{
                      animation: `edge-pulse 2.5s linear ${i * 0.4}s infinite`,
                    }}
                  />
                );
              }
              return segments;
            })()}
          </svg>

          {/* "Root cause found" overlay label */}
          <div className="absolute bottom-6 right-8 flex items-center gap-3 z-20">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/60 animate-pulse" />
            <span className="font-mono text-[11px] tracking-[0.15em] text-white/30 uppercase font-medium">
              Root cause identified · L3 inference drift
            </span>
          </div>

          {/* Left side label */}
          <div className="absolute top-6 left-8 z-20">
            <span className="font-mono text-[10px] tracking-[0.15em] text-white/15 uppercase">
              Execution Trace · 12 nodes · 18 edges
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CODE SNIPPET — Quick setup showcase
// ─────────────────────────────────────────────────────────────────────────────

function CodeSnippet() {
  return (
    <div className="max-w-2xl mx-auto rounded-xl overflow-hidden border border-white/[0.08]">
      <div className="bg-white/[0.02] border-b border-white/[0.06] px-5 py-3 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="ml-4 font-mono text-[11px] text-white/25 tracking-wider">BOOKING_AGENT.PY</span>
      </div>
      <div className="bg-black p-6 font-mono text-[13px] leading-[1.8]">
        <div>
          <span className="text-white/30">from</span>
          <span className="text-white/60"> causal </span>
          <span className="text-white/30">import</span>
          <span className="text-white/70"> trace</span>
        </div>
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
        <div className="pl-8 text-white/15 italic">    # Intent, reasoning, tool calls — all captured</div>
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
        <div className="pl-8">
          <span className="text-white/30">return</span>
          <span className="text-white/50"> result</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOW IT WORKS — 4 steps, x.ai card styling
// ─────────────────────────────────────────────────────────────────────────────

function HowItWorksSection() {
  const steps = [
    {
      num: "01",
      icon: Code2,
      title: "Instrument your agents",
      description:
        "Add the @trace decorator to your agent functions. Works with LangChain, LangGraph, AutoGen, and any Python-based agent framework.",
      code: `from causal import trace

@trace(session_id=session.id)
async def my_agent(prompt: str):
    ...`,
    },
    {
      num: "02",
      icon: GitBranch,
      title: "Graph Propagation",
      description:
        "Every execution trace populates a deterministic Neo4j knowledge graph linking the initial spec, inference steps, tool decisions, and terminal failure states.",
      code: `# Causal structural mapping:
# INTENT → SPEC → INFERENCE
# → LOGIC → STATE → FAILURE`,
    },
    {
      num: "03",
      icon: Search,
      title: "Telemetry Ingestion",
      description:
        "When standard observability raises a symptom, Causal maps the stack trace to the exact graph session using temporal similarity and vector search.",
      code: `# Webhook ingestion:
POST /webhooks/datadog
→ session mapping: abc123
→ graph assembly: 1.2s`,
    },
    {
      num: "04",
      icon: Activity,
      title: "Automated Hypothesis Testing",
      description:
        "A LangGraph evaluator traverses the graph retrospectively from the failure node, utilizing LLM evaluators to score counterfactual derivations at each step.",
      code: `pca = await perform_pca(symptom_id)
# fault_node: "L3 inference drift"
# derivation: "Spec ambiguity line 47"`,
    },
  ];

  return (
    <section className="py-32 px-8 border-t border-white/[0.06]" id="how-it-works">
      <div className="max-w-7xl mx-auto">
        <div className="mb-20">
          <p className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
            [ METHODOLOGY ]
          </p>
          <h2 className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            Continuous Causal Inference
          </h2>
        </div>

        {/* Code snippet */}
        <div className="mb-20">
          <CodeSnippet />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-white/[0.06]">
          {steps.map(({ num, icon: Icon, title, description, code }) => (
            <div
              key={num}
              className="xai-card bg-black p-8"
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
                  <p className="text-[13px] text-white/30 leading-relaxed mb-5">{description}</p>
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 font-mono text-[11px] text-white/25 leading-relaxed whitespace-pre">
                    {code}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAUSAL MODEL STRIP
// ─────────────────────────────────────────────────────────────────────────────

function CausalModelStrip() {
  const layers = [
    { label: "INTENT", color: "border-white/10 text-white/50" },
    { label: "SPEC", color: "border-white/10 text-white/45" },
    { label: "INFERENCE", color: "border-white/10 text-white/40" },
    { label: "LOGIC", color: "border-white/10 text-white/35" },
    { label: "STATE", color: "border-white/10 text-white/30" },
    { label: "FAILURE", color: "border-white/10 text-white/25" },
  ];

  return (
    <section className="py-20 px-8 border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto">
        <div className="border border-white/[0.06] rounded-xl p-12 flex flex-col items-center bg-white/[0.01]">
          <p className="font-mono text-[11px] tracking-[0.2em] text-white/25 uppercase mb-10">
            THE CAUSAL DIAGNOSTIC MODEL
          </p>
          <div className="flex flex-wrap justify-center items-center gap-3 sm:gap-5 mb-10 w-full">
            {layers.map(({ label, color }, i) => (
              <div key={label} className="flex items-center gap-3 sm:gap-5">
                <span className={`font-mono text-[11px] tracking-[0.15em] border px-5 py-2.5 rounded-full ${color}`}>
                  {label}
                </span>
                {i < layers.length - 1 && (
                  <span className="text-white/15">→</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[14px] text-white/25 max-w-2xl leading-relaxed text-center">
            Non-deterministic failures propagate linearly. Causal maps this topology,
            allowing deterministic backwards-evaluation from the final fault to the semantic deviation origin.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURES GRID
// ─────────────────────────────────────────────────────────────────────────────

function FeaturesSection() {
  const features = [
    {
      icon: GitBranch,
      title: "Knowledge Graph",
      description:
        "Neo4j-backed causal model links every incident to the exact intent, spec, reasoning step, and line of code. Query with natural language or Cypher.",
    },
    {
      icon: Cpu,
      title: "LangGraph RCA Engine",
      description:
        "A LangGraph StateGraph walks your causal graph backward from incident, using Claude to explain each node and generate counterfactual scenarios.",
    },
    {
      icon: Code2,
      title: "Python SDK",
      description:
        "@trace decorator with LangGraph, LangChain, and AutoGen adapters. Zero-config instrumentation captures reasoning steps, tool calls, and context snapshots.",
    },
    {
      icon: Webhook,
      title: "Webhook Integrations",
      description:
        "Ingest incidents from PagerDuty, Sentry, Datadog, and GitHub. Auto-link via session IDs, stack trace matching, or semantic similarity.",
    },
    {
      icon: FileText,
      title: "AI Postmortems",
      description:
        "Generate postmortems with a single click. Claude writes the timeline, root cause summary, contributing factors, and remediation steps.",
    },
    {
      icon: Search,
      title: "Auto-Linking",
      description:
        "Session ID propagation, stack trace parsing, time-window similarity, and vector search. Incidents find their traces — no manual tagging.",
    },
    {
      icon: Shield,
      title: "MCP Server",
      description:
        "Query your causal knowledge graph directly from Claude Code. Ask \"why did this agent fail\" inside your coding environment.",
    },
    {
      icon: Activity,
      title: "Replay & Timeline",
      description:
        "Step through a full incident replay — every reasoning decision, tool call, and state transition, visualized as an interactive DAG.",
    },
    {
      icon: Zap,
      title: "Counterfactual Analysis",
      description:
        "For every root cause, Causal generates \"what if\" scenarios — helping you understand blast radius and verify fixes actually work.",
    },
  ];

  return (
    <section className="relative py-32 px-8 border-t border-white/[0.06]" id="features">
      <div className="max-w-7xl mx-auto">
        <div className="mb-20">
          <p className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
            [ CAPABILITIES ]
          </p>
          <h2 className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            Comprehensive observability
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[1px] bg-white/[0.06]">
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="xai-card bg-black p-8">
              <div className="w-10 h-10 rounded-full border border-white/[0.08] flex items-center justify-center mb-5">
                <Icon className="w-4 h-4 text-white/40" />
              </div>
              <h3 className="text-[15px] font-medium text-white mb-2">{title}</h3>
              <p className="text-[13px] text-white/25 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATIONS
// ─────────────────────────────────────────────────────────────────────────────

function IntegrationsSection() {
  const groups = [
    { label: "Agent Frameworks", items: ["LangChain", "LangGraph", "AutoGen", "CrewAI", "Haystack"] },
    { label: "LLM Providers", items: ["Anthropic", "OpenAI", "Mistral", "Cohere", "Gemini"] },
    { label: "Incident Sources", items: ["PagerDuty", "Sentry", "Datadog", "GitHub", "Linear"] },
    { label: "Observability", items: ["LangSmith", "Langfuse", "OpenTelemetry", "Prometheus", "Grafana"] },
  ];

  return (
    <section className="py-32 px-8 border-t border-white/[0.06]" id="integrations">
      <div className="max-w-7xl mx-auto">
        <div className="mb-20">
          <p className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
            [ INTEGRATIONS ]
          </p>
          <h2 className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            Works with your existing stack
          </h2>
          <p className="mt-4 text-[15px] text-white/30 max-w-lg">
            Drop Causal into your current workflow. No rearchitecting required.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[1px] bg-white/[0.06]">
          {groups.map(({ label, items }) => (
            <div key={label} className="xai-card bg-black p-8">
              <p className="font-mono text-[10px] tracking-[0.2em] text-white/20 uppercase mb-6">{label}</p>
              <div className="flex flex-col gap-3">
                {items.map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <Check className="w-3 h-3 text-white/25 flex-shrink-0" />
                    <span className="text-[13px] text-white/40">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING
// ─────────────────────────────────────────────────────────────────────────────

function PricingSection() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "/ month",
      description: "For individuals and small projects",
      features: [
        "Up to 10,000 traces / month",
        "7-day trace retention",
        "1 project",
        "Community support",
        "Python SDK",
        "Basic RCA (5 / month)",
      ],
      cta: "GET STARTED FREE",
      ctaHref: "/incidents",
      highlight: false,
    },
    {
      name: "Team",
      price: "$49",
      period: "/ month",
      description: "For growing engineering teams",
      features: [
        "Up to 500,000 traces / month",
        "30-day trace retention",
        "10 projects",
        "Slack + email support",
        "Unlimited RCA",
        "Webhook integrations",
        "AI postmortem generation",
        "MCP server access",
      ],
      cta: "START FREE TRIAL",
      ctaHref: "/incidents",
      highlight: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "",
      description: "For large teams with advanced needs",
      features: [
        "Unlimited traces",
        "Custom retention",
        "Unlimited projects",
        "Dedicated support",
        "SSO / SAML",
        "SLA guarantee",
        "On-prem deployment",
        "Custom integrations",
      ],
      cta: "CONTACT SALES",
      ctaHref: "mailto:sales@causal.dev",
      highlight: false,
    },
  ];

  return (
    <section className="py-32 px-8 border-t border-white/[0.06]" id="pricing">
      <div className="max-w-7xl mx-auto">
        <div className="mb-20">
          <p className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
            [ PRICING ]
          </p>
          <h2 className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-[15px] text-white/30">
            Start free. Upgrade when you need more.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-white/[0.06]">
          {plans.map(({ name, price, period, description, features, cta, ctaHref, highlight }) => (
            <div
              key={name}
              className={`bg-black p-8 flex flex-col ${highlight ? "relative" : "xai-card"}`}
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

              <Link
                href={ctaHref}
                className={`xai-btn text-[11px] justify-center mb-8 ${highlight ? "xai-btn-primary" : ""}`}
              >
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
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA SECTION
// ─────────────────────────────────────────────────────────────────────────────

function CTASection() {
  return (
    <section className="relative py-40 px-8 border-t border-white/[0.06] overflow-hidden">
      {/* Mini blackhole echo rings */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ perspective: "600px", transformStyle: "preserve-3d" }}>
        {[180, 260, 360, 480].map((r, i) => (
          <div
            key={i}
            className="absolute rounded-full border border-solid"
            style={{
              width: `${r}px`,
              height: `${r}px`,
              top: "50%",
              left: "50%",
              marginTop: `-${r / 2}px`,
              marginLeft: `-${r / 2}px`,
              borderColor: `rgba(255,255,255,${0.06 - i * 0.012})`,
              animation: `accretion-spin ${55 + i * 15}s linear infinite${i % 2 === 0 ? "" : " reverse"}`,
              transformStyle: "preserve-3d",
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto text-center">
        <h2 className="text-[44px] sm:text-[64px] font-light tracking-[-0.04em] text-white leading-[1.05] mb-8">
          Start tracing your agents today
        </h2>
        <p className="text-[16px] text-white/30 mb-14 leading-relaxed max-w-md mx-auto font-light">
          Add one decorator. Get the full causal graph.
          Stop spending days diagnosing agent failures.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/incidents" className="xai-btn xai-btn-primary">
            GET STARTED FREE <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link href="#" className="xai-btn">
            READ THE DOCS <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOTER — x.ai minimal style
// ─────────────────────────────────────────────────────────────────────────────

function Footer() {
  const columns = [
    {
      heading: "PRODUCT",
      links: [
        { label: "Incidents", href: "/incidents" },
        { label: "Traces", href: "/traces" },
        { label: "RCA Engine", href: "#" },
        { label: "MCP Server", href: "#" },
        { label: "Changelog", href: "#" },
      ],
    },
    {
      heading: "INTEGRATIONS",
      links: [
        { label: "LangGraph", href: "#" },
        { label: "LangChain", href: "#" },
        { label: "PagerDuty", href: "#" },
        { label: "Sentry", href: "#" },
        { label: "Datadog", href: "#" },
      ],
    },
    {
      heading: "RESOURCES",
      links: [
        { label: "Documentation", href: "#" },
        { label: "Python SDK", href: "#" },
        { label: "API Reference", href: "#" },
        { label: "Blog", href: "#" },
        { label: "Status", href: "#" },
      ],
    },
    {
      heading: "COMPANY",
      links: [
        { label: "About", href: "#" },
        { label: "Careers", href: "#" },
        { label: "Contact", href: "#" },
        { label: "Privacy", href: "#" },
        { label: "Terms", href: "#" },
      ],
    },
  ];

  return (
    <footer className="border-t border-white/[0.06] pt-16 pb-10 px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-16">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-3 mb-5">
              <LogoMark size={24} />
              <span className="text-[14px] font-medium text-white">Causal</span>
            </Link>
            <p className="text-[12px] text-white/20 leading-relaxed max-w-[160px]">
              Root cause intelligence for AI-agent engineering teams.
            </p>
          </div>

          {/* Link columns */}
          {columns.map(({ heading, links }) => (
            <div key={heading}>
              <p className="font-mono text-[10px] tracking-[0.2em] text-white/25 mb-5">{heading}</p>
              <div className="flex flex-col gap-3">
                {links.map(({ label, href }) => (
                  <Link
                    key={label}
                    href={href}
                    className="text-[13px] text-white/25 hover:text-white/60 transition-colors duration-300"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/[0.06] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-mono text-[11px] tracking-[0.1em] text-white/15">
            © 2026 CAUSAL. ALL RIGHTS RESERVED.
          </p>
          <div className="flex items-center gap-6">
            {["TWITTER", "GITHUB", "DISCORD"].map((s) => (
              <Link
                key={s}
                href="#"
                className="font-mono text-[11px] tracking-[0.15em] text-white/15 hover:text-white/40 transition-colors duration-300"
              >
                {s}
              </Link>
            ))}
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
    <div className="min-h-screen bg-black text-white relative">
      <StarField />
      <Nav />
      <HeroSection />
      <ProductCardsSection />
      <CausalGraphSection />
      <HowItWorksSection />
      <CausalModelStrip />
      <FeaturesSection />
      <IntegrationsSection />
      <PricingSection />
      <CTASection />
      <Footer />
    </div>
  );
}
