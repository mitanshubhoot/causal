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
import {
  motion,
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

  return (
    <>
      {/* Scroll progress bar */}
      <motion.div
        className="scroll-progress"
        style={{ scaleX, width: "100%" }}
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
// BLACKHOLE CANVAS
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

    const resize = () => {
      canvas.width = window.innerWidth * 2;
      canvas.height = window.innerHeight * 2;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    interface Particle {
      angle: number;
      radius: number;
      speed: number;
      size: number;
      brightness: number;
      tilt: number;
      phase: number;
    }

    const particles: Particle[] = [];
    const PARTICLE_COUNT = 2000;
    const EVENT_HORIZON = 550;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
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
      time += 0.003;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h * 0.42;
      const mouse = mousePosRef.current;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);

      const mox = mouse.x * 12;
      const moy = mouse.y * 12;
      const glowGrad = ctx.createRadialGradient(cx + mox, cy + moy, EVENT_HORIZON * 0.9, cx + mox, cy + moy, EVENT_HORIZON * 3.5);
      glowGrad.addColorStop(0, "rgba(200,200,220,0.0)");
      glowGrad.addColorStop(0.1, "rgba(240,240,255,0.12)");
      glowGrad.addColorStop(0.25, "rgba(230,230,245,0.09)");
      glowGrad.addColorStop(0.4, "rgba(210,210,230,0.06)");
      glowGrad.addColorStop(0.6, "rgba(190,190,210,0.03)");
      glowGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);

      for (const p of particles) {
        p.angle += p.speed * 0.003;
        const rx = p.radius;
        const ry = p.radius * 0.38;
        const x = cx + Math.cos(p.angle) * rx + mouse.x * (8 + p.radius * 0.012);
        const y = cy + Math.sin(p.angle) * ry + Math.sin(p.angle + p.phase) * p.tilt * p.radius + mouse.y * (8 + p.radius * 0.012);
        const behindBlackhole = Math.sin(p.angle) > 0;
        const distFromCenter = Math.sqrt(Math.pow(x - cx - mouse.x * 8, 2) + Math.pow(y - cy - mouse.y * 8, 2));
        if (behindBlackhole && distFromCenter < EVENT_HORIZON * 1.1) continue;
        const doppler = 0.6 + 0.4 * Math.cos(p.angle);
        const alpha = p.brightness * doppler * (behindBlackhole ? 0.3 : 1);
        const innerFactor = 1 - Math.min((p.radius - EVENT_HORIZON) / 600, 1);
        const r = Math.floor(220 + innerFactor * 35);
        const g = Math.floor(215 + innerFactor * 30);
        const b = Math.floor(230 - innerFactor * 25);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.95})`;
        ctx.fill();
        if (p.size > 1.2 && alpha > 0.3) {
          ctx.beginPath();
          ctx.arc(x, y, p.size * 5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.1})`;
          ctx.fill();
        }
        if (p.size > 2.5 && alpha > 0.5) {
          ctx.beginPath();
          ctx.arc(x, y, p.size * 8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.04})`;
          ctx.fill();
        }
      }

      const ehx = cx + mouse.x * 8;
      const ehy = cy + mouse.y * 8;
      const ehGrad = ctx.createRadialGradient(ehx, ehy, 0, ehx, ehy, EVENT_HORIZON * 1.2);
      ehGrad.addColorStop(0, "rgba(0,0,0,1)");
      ehGrad.addColorStop(0.75, "rgba(0,0,0,1)");
      ehGrad.addColorStop(0.9, "rgba(0,0,0,0.9)");
      ehGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ehGrad;
      ctx.beginPath();
      ctx.arc(ehx, ehy, EVENT_HORIZON * 1.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ehx, ehy, EVENT_HORIZON * 1.02, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(240,240,250,${0.12 + 0.04 * Math.sin(time * 8)})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ehx, ehy, EVENT_HORIZON * 1.08, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(230,230,240,${0.05 + 0.02 * Math.sin(time * 6)})`;
      ctx.lineWidth = 1;
      ctx.stroke();

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
      <canvas ref={canvasRef} className="absolute top-0 left-0" />
      <div
        className="absolute"
        style={{
          top: "42%", left: "50%", width: "800px", height: "400px",
          transform: `translate(-50%, -50%) translate(${mx * 6}px, ${my * 6}px)`,
          transition: "transform 0.5s ease-out",
          background: "radial-gradient(ellipse 100% 60% at 50% 50%, rgba(210,210,230,0.04) 0%, rgba(200,200,220,0.02) 30%, transparent 55%)",
          filter: "blur(50px)",
          animation: "cosmic-breathe 10s ease-in-out infinite",
        }}
      />
      <div
        className="absolute"
        style={{
          top: "35%", left: "30%", width: "500px", height: "350px",
          transform: `translate(-50%, -50%) translate(${mx * 3}px, ${my * 2}px)`,
          transition: "transform 0.6s ease-out",
          background: "radial-gradient(ellipse at center, rgba(100,130,200,0.03) 0%, transparent 50%)",
          filter: "blur(70px)",
          animation: "cosmic-breathe 14s ease-in-out 2s infinite",
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 h-72 bg-gradient-to-t from-black via-black/80 to-transparent" />
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute top-0 left-0 bottom-0 w-24 bg-gradient-to-r from-black/40 to-transparent" />
      <div className="absolute top-0 right-0 bottom-0 w-24 bg-gradient-to-l from-black/40 to-transparent" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO — staggered line-by-line reveal
// ─────────────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <InterstellarBlackhole />

      {/* Ghost wordmark */}
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

      {/* Staggered text reveal */}
      <motion.div
        className="relative z-10 text-center px-6 max-w-3xl mx-auto"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.p
          variants={fadeUp}
          className="font-mono text-[11px] tracking-[0.25em] text-white/30 uppercase mb-8"
        >
          Root Cause Intelligence for AI Agents
        </motion.p>

        <motion.h1
          variants={staggerContainer}
          className="text-[48px] sm:text-[64px] md:text-[80px] font-light tracking-[-0.04em] leading-[1.05] mb-8 text-white"
        >
          <motion.span variants={fadeUp} className="block">
            Agent failures
          </motion.span>
          <motion.span variants={fadeUp} className="block">
            shouldn&apos;t be a{" "}
            <span className="gradient-text font-normal">black box.</span>
          </motion.span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="text-[16px] sm:text-[18px] text-white/40 max-w-[480px] mx-auto leading-relaxed mb-14 font-light"
        >
          Trace incidents back to the exact prompt, inference step, or logic flaw that caused them.
        </motion.p>

        <motion.div
          variants={fadeUp}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link href="/incidents" className="xai-btn xai-btn-primary">
            DEPLOY INSTRUMENTATION <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link href="/traces" className="xai-btn">
            ACCESS SANDBOX <ExternalLink className="w-3 h-3" />
          </Link>
        </motion.div>

        <motion.p
          variants={fadeUp}
          className="mt-8 font-mono text-[11px] tracking-[0.15em] text-white/20 uppercase"
        >
          No credit card required &nbsp;·&nbsp; Free tier &nbsp;·&nbsp; Setup in 5 min
        </motion.p>
      </motion.div>

      {/* Scroll hint */}
      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 1 }}
      >
        <div className="w-5 h-8 rounded-full border border-white/20 flex items-start justify-center p-1.5">
          <div className="w-0.5 h-2 bg-white/40 rounded-full animate-bounce" />
        </div>
      </motion.div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TICKER — horizontal marquee
// ─────────────────────────────────────────────────────────────────────────────

function TickerSection() {
  const words = ["TRACE", "DIAGNOSE", "RESOLVE", "UNDERSTAND", "PREVENT", "INSTRUMENT", "ANALYSE", "REMEDIATE"];
  const repeated = [...words, ...words]; // double for seamless loop

  return (
    <div className="relative py-6 border-y border-white/[0.06] overflow-hidden bg-black/40">
      <div className="flex ticker-track" style={{ width: "max-content" }}>
        {repeated.map((word, i) => (
          <span
            key={i}
            className="font-mono text-[11px] tracking-[0.3em] text-white/20 uppercase whitespace-nowrap px-8"
          >
            {word}
            <span className="ml-8 opacity-40">·</span>
          </span>
        ))}
      </div>
    </div>
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
    { value: 2400000, display: "2.4M+", label: "Traces captured per month", prefix: "", suffix: "" },
    { value: 1.8, display: "< 1.8s", label: "Average root-cause resolution", prefix: "< ", suffix: "s", decimals: 1 },
    { value: 6, display: "6", label: "Causal model layers", prefix: "", suffix: "" },
    { value: 99.9, display: "99.9%", label: "Graph assembly accuracy", prefix: "", suffix: "%", decimals: 1 },
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
          <motion.p variants={fadeUp} className="font-mono text-[11px] tracking-[0.25em] text-white/30 uppercase mb-5">
            [ BY THE NUMBERS ]
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-[40px] sm:text-[56px] font-light tracking-[-0.03em] text-white">
            Built for production-scale AI
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
              className="bg-black p-10 flex flex-col gap-3"
            >
              <div className="stat-number">
                <AnimatedCounter value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
              </div>
              <p className="font-mono text-[11px] tracking-[0.1em] text-white/30 uppercase leading-relaxed">
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
// BENEFIT SECTIONS — full-screen 01 / 02 / 03
// ─────────────────────────────────────────────────────────────────────────────

function BenefitDagVisual() {
  const layers = [
    { label: "Intent", x: 80, nodes: [{ y: 280 }] },
    { label: "Spec", x: 230, nodes: [{ y: 200 }, { y: 360 }] },
    { label: "Inference", x: 410, nodes: [{ y: 150 }, { y: 280 }, { y: 420 }] },
    { label: "Logic", x: 580, nodes: [{ y: 190 }, { y: 330 }, { y: 460 }] },
    { label: "State", x: 740, nodes: [{ y: 240 }, { y: 380 }] },
    { label: "Failure", x: 920, nodes: [{ y: 310 }] },
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
            const isFailure = label === "Failure";
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
    <section className="relative min-h-screen flex items-center border-b border-white/[0.06] overflow-hidden" id="product">
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
  return (
    <>
      <BenefitSection
        num="01"
        tag="[ BENEFIT 01 / TRACE ]"
        headline={"Every decision\nyour agent makes,\ncaptured."}
        sub="Add @trace to any Python agent function. Every inference step, tool call, and reasoning node is automatically woven into a deterministic causal graph."
        body="Works with LangChain, LangGraph, AutoGen, CrewAI, and any async Python-based agent framework — no architecture changes required."
        cta="EXPLORE SDK"
        ctaHref="#how-it-works"
        visual={<BenefitDagVisual />}
      />
      <BenefitSection
        num="02"
        tag="[ BENEFIT 02 / DIAGNOSE ]"
        headline={"Root cause\nfound in\nseconds."}
        sub="When an incident fires, Causal walks the knowledge graph backwards from the failure node, scoring counterfactual derivations at every hop."
        body="A LangGraph evaluator uses Claude to explain each deviation and assign a probability to each root-cause hypothesis — no manual digging."
        cta="SEE HOW IT WORKS"
        ctaHref="#how-it-works"
        visual={<BenefitCodeVisual />}
        flip
      />
      <BenefitSection
        num="03"
        tag="[ BENEFIT 03 / RESOLVE ]"
        headline={"AI postmortems,\ninstantly\ngenerated."}
        sub="Click one button. Claude writes the full postmortem: timeline, root cause, contributing factors, counterfactual, and concrete remediation steps."
        body="Export to Markdown or JSON. Create Linear tickets directly. Stop repeating the same agent failures across deployments."
        cta="VIEW EXAMPLE"
        ctaHref="#features"
        visual={<BenefitPostmortemVisual />}
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
      title: "Instrument your agents",
      description: "Add the @trace decorator to your agent functions. Works with LangChain, LangGraph, AutoGen, and any Python-based agent framework.",
      code: `from causal import trace\n\n@trace(session_id=session.id)\nasync def my_agent(prompt: str):\n    ...`,
    },
    {
      num: "02",
      icon: GitBranch,
      title: "Graph Propagation",
      description: "Every execution trace populates a deterministic Neo4j knowledge graph linking the initial spec, inference steps, tool decisions, and terminal failure states.",
      code: `# Causal structural mapping:\n# INTENT → SPEC → INFERENCE\n# → LOGIC → STATE → FAILURE`,
    },
    {
      num: "03",
      icon: Search,
      title: "Telemetry Ingestion",
      description: "When standard observability raises a symptom, Causal maps the stack trace to the exact graph session using temporal similarity and vector search.",
      code: `# Webhook ingestion:\nPOST /webhooks/datadog\n→ session mapping: abc123\n→ graph assembly: 1.2s`,
    },
    {
      num: "04",
      icon: Activity,
      title: "Automated Hypothesis Testing",
      description: "A LangGraph evaluator traverses the graph retrospectively from the failure node, utilizing LLM evaluators to score counterfactual derivations at each step.",
      code: `pca = await perform_pca(symptom_id)\n# fault_node: "L3 inference drift"\n# derivation: "Spec ambiguity line 47"`,
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
          <motion.p variants={fadeUp} className="font-mono text-[11px] tracking-[0.2em] text-white/30 uppercase mb-4">
            [ METHODOLOGY ]
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-[36px] sm:text-[48px] font-light tracking-[-0.03em] text-white">
            Continuous Causal Inference
          </motion.h2>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-white/[0.06]"
        >
          {steps.map(({ num, icon: Icon, title, description, code }) => (
            <motion.div key={num} variants={cardVariant} className="xai-card bg-black p-8">
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
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAUSAL MODEL STRIP
// ─────────────────────────────────────────────────────────────────────────────

function CausalModelStrip() {
  const layers = [
    { label: "INTENT" },
    { label: "SPEC" },
    { label: "INFERENCE" },
    { label: "LOGIC" },
    { label: "STATE" },
    { label: "FAILURE" },
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
            {layers.map(({ label }, i) => (
              <motion.div key={label} variants={cardVariant} className="flex items-center gap-3 sm:gap-5">
                <span className="font-mono text-[11px] tracking-[0.15em] border border-white/10 text-white/40 px-5 py-2.5 rounded-full">
                  {label}
                </span>
                {i < layers.length - 1 && <span className="text-white/15">→</span>}
              </motion.div>
            ))}
          </motion.div>
          <p className="text-[14px] text-white/25 max-w-2xl leading-relaxed text-center">
            Non-deterministic failures propagate linearly. Causal maps this topology,
            allowing deterministic backwards-evaluation from the final fault to the semantic deviation origin.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURES GRID — staggered card entrance
// ─────────────────────────────────────────────────────────────────────────────

function FeaturesSection() {
  const features = [
    { icon: GitBranch, title: "Knowledge Graph", description: "Neo4j-backed causal model links every incident to the exact intent, spec, reasoning step, and line of code. Query with natural language or Cypher." },
    { icon: Cpu, title: "LangGraph RCA Engine", description: "A LangGraph StateGraph walks your causal graph backward from incident, using Claude to explain each node and generate counterfactual scenarios." },
    { icon: Code2, title: "Python SDK", description: "@trace decorator with LangGraph, LangChain, and AutoGen adapters. Zero-config instrumentation captures reasoning steps, tool calls, and context snapshots." },
    { icon: Webhook, title: "Webhook Integrations", description: "Ingest incidents from PagerDuty, Sentry, Datadog, and GitHub. Auto-link via session IDs, stack trace matching, or semantic similarity." },
    { icon: FileText, title: "AI Postmortems", description: "Generate postmortems with a single click. Claude writes the timeline, root cause summary, contributing factors, and remediation steps." },
    { icon: Search, title: "Auto-Linking", description: "Session ID propagation, stack trace parsing, time-window similarity, and vector search. Incidents find their traces — no manual tagging." },
    { icon: Shield, title: "MCP Server", description: "Query your causal knowledge graph directly from Claude Code. Ask \"why did this agent fail\" inside your coding environment." },
    { icon: Activity, title: "Replay & Timeline", description: "Step through a full incident replay — every reasoning decision, tool call, and state transition, visualized as an interactive DAG." },
    { icon: Zap, title: "Counterfactual Analysis", description: "For every root cause, Causal generates \"what if\" scenarios — helping you understand blast radius and verify fixes actually work." },
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
            Comprehensive observability
          </motion.h2>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[1px] bg-white/[0.06]"
        >
          {features.map(({ icon: Icon, title, description }) => (
            <motion.div key={title} variants={cardVariant} className="xai-card bg-black p-8">
              <div className="w-10 h-10 rounded-full border border-white/[0.08] flex items-center justify-center mb-5">
                <Icon className="w-4 h-4 text-white/40" />
              </div>
              <h3 className="text-[15px] font-medium text-white mb-2">{title}</h3>
              <p className="text-[13px] text-white/25 leading-relaxed">{description}</p>
            </motion.div>
          ))}
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
    { label: "Agent Frameworks", items: ["LangChain", "LangGraph", "AutoGen", "CrewAI", "Haystack"] },
    { label: "LLM Providers", items: ["Anthropic", "OpenAI", "Mistral", "Cohere", "Gemini"] },
    { label: "Incident Sources", items: ["PagerDuty", "Sentry", "Datadog", "GitHub", "Linear"] },
    { label: "Observability", items: ["LangSmith", "Langfuse", "OpenTelemetry", "Prometheus", "Grafana"] },
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
            Start tracing your
          </motion.span>
          <motion.span variants={fadeUp} className="block gradient-text">
            agents today.
          </motion.span>
        </motion.h2>

        <motion.p variants={fadeUp} className="text-[16px] text-white/30 mb-14 leading-relaxed max-w-md mx-auto font-light">
          Add one decorator. Get the full causal graph.
          Stop spending days diagnosing agent failures.
        </motion.p>

        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/incidents" className="xai-btn xai-btn-primary">
            GET STARTED FREE <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link href="#" className="xai-btn">
            READ THE DOCS <ArrowUpRight className="w-3 h-3" />
          </Link>
        </motion.div>

        <motion.p variants={fadeUp} className="mt-10 font-mono text-[11px] tracking-[0.15em] text-white/15 uppercase">
          No credit card required &nbsp;·&nbsp; Free tier &nbsp;·&nbsp; Setup in 5 min
        </motion.p>
      </motion.div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOTER
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
          <div className="col-span-2 md:col-span-1">
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
                  <Link key={label} href={href} className="text-[13px] text-white/25 hover:text-white/60 transition-colors duration-300">
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
            {["TWITTER", "GITHUB", "DISCORD"].map((s) => (
              <Link key={s} href="#" className="font-mono text-[11px] tracking-[0.15em] text-white/15 hover:text-white/40 transition-colors duration-300">
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
      <TickerSection />
      <StatsSection />
      <BenefitSections />
      <TickerSection />
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
