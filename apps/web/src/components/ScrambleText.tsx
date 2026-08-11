"use client";

import { useEffect, useRef } from "react";
import { useInView, useReducedMotion } from "framer-motion";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>[]{}=+*#$%&_";

interface ScrambleTextProps {
  text: string;
  className?: string;
  /** ms to fully resolve. */
  duration?: number;
  /** delay before starting once in view, ms. */
  delay?: number;
  as?: "span" | "div" | "p" | "h1" | "h2" | "h3";
}

/**
 * Resolves `text` out of flickering monospace glyph-noise, character by
 * character, like a decrypting terminal. Writes to textContent via one rAF —
 * never per-frame React state — so it's cheap and reflow-free in a mono font.
 * Under prefers-reduced-motion it renders the final string immediately.
 */
export function ScrambleText({
  text,
  className,
  duration = 700,
  delay = 0,
  as = "span",
}: ScrambleTextProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced || !inView) {
      if (reduced) el.textContent = text;
      return;
    }

    let raf = 0;
    let start = 0;
    let stopped = false;
    const chars = text.split("");
    // Each character locks in at a staggered point through the run.
    const lockAt = chars.map((_, i) => (i / Math.max(1, chars.length)) * 0.6);

    const tick = (now: number) => {
      if (stopped) return;
      if (!start) start = now + delay;
      const p = Math.max(0, Math.min(1, (now - start) / duration));
      let out = "";
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i]!;
        if (c === " " || c === " ") { out += c; continue; }
        if (p >= lockAt[i]! + 0.4 || p >= 1) {
          out += c;
        } else if (p < lockAt[i]!) {
          out += " "; // not yet revealed
        } else {
          out += GLYPHS[(Math.floor(now / 40) + i * 7) % GLYPHS.length];
        }
      }
      el.textContent = out;
      if (p >= 1) { el.textContent = text; return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [inView, reduced, text, duration, delay]);

  const Tag = as as "span";
  // Initial content = the real text (SSR / no-JS friendly); the effect takes over.
  return (
    <Tag ref={ref as React.Ref<HTMLSpanElement>} className={className}>
      {text}
    </Tag>
  );
}
