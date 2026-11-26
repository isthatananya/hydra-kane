"use client";

import { useEffect, useRef, type ReactNode } from "react";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Wraps the bento grid. As the page scrolls, a light streak sweeps across each card and a single
 * Kane-blue glow drifts behind the grid. Progress is written to CSS variables; CSS does the drawing.
 */
export function BentoGlow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = [...root.querySelectorAll<HTMLElement>(".bento > *")];
    let frame = 0;

    const update = () => {
      frame = 0;
      const vh = innerHeight;
      const r = root.getBoundingClientRect();
      const p = clamp((vh - r.top) / (vh + r.height));
      root.style.setProperty("--p", p.toFixed(4));
      root.style.setProperty("--peak", (1 - Math.abs(p * 2 - 1)).toFixed(4));
      for (const el of cards) {
        const b = el.getBoundingClientRect();
        const s = clamp((vh - b.top) / (vh + b.height));
        el.style.setProperty("--shine", s.toFixed(4));
        el.style.setProperty("--glint", (1 - Math.abs(s * 2 - 1)).toFixed(4));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <div ref={ref} className="bento-stage">
      <div aria-hidden="true" className="bento-glow">
        <span />
        <span />
        <span />
      </div>
      {children}
    </div>
  );
}
