import type { CSSProperties } from "react";
import { HeroPicker } from "./hero-picker";

// ── Chrome shapes ───────────────────────────────────────────────────────────
// CSS stand-ins for rendered chrome. To swap in Spline/Blender renders later, replace each
// <span> with a next/image (priority) at the same position and size; the layout won't change.

type Shape = { kind: "sphere" | "torus"; style: CSSProperties; small?: boolean; float: string };
const SHAPES: Shape[] = [
  { kind: "sphere", style: { top: 44, right: "24%", width: 150, height: 150 }, float: "float-a 12s ease-in-out 0s infinite alternate" },
  { kind: "sphere", small: true, style: { top: "47%", right: 12, width: 96, height: 96 }, float: "float-b 11s ease-in-out -3s infinite alternate" },
  { kind: "torus", style: { bottom: 18, left: "40%", width: 600, height: 230, transform: "rotate(-8deg)" }, float: "float-b 14s ease-in-out -6s infinite alternate" },
  { kind: "torus", style: { top: "44%", left: -70, width: 240, height: 240, transform: "rotate(24deg)" }, float: "float-a 13s ease-in-out -2s infinite alternate" },
  { kind: "sphere", small: true, style: { bottom: 96, left: 56, width: 58, height: 58 }, float: "float-a 10s ease-in-out -5s infinite alternate" },
];

export function ChromeShapes() {
  return (
    <div aria-hidden="true" className="chrome">
      {SHAPES.map((s, i) => (
        <span
          key={i}
          className={`chrome-${s.kind}${s.small ? " chrome-small" : ""}`}
          style={{ ...s.style, animation: s.float }}
        />
      ))}
    </div>
  );
}

// ── Test-step bars ──────────────────────────────────────────────────────────

const BUG_INDEX = 78;
const BARS = Array.from({ length: 110 }, (_, i) => {
  const t = i / 110;
  const bug = i === BUG_INDEX;
  const h = bug ? 200 : t < 0.38 ? 12 + ((i * 53) % 170) : 150 + ((i * 7) % 3) * 2;
  const o = bug ? 1 : t < 0.38 ? Math.min(0.12 + t * 1.2, 0.9) : 0.85;
  return { h, o, bug };
});
const LAST_DELAY = BARS.length * 8;

export function HeroBars({ step, caught }: { step: number | null; caught: number }) {
  const label = step != null ? `${caught} hidden bug caught · step ${step}` : `${caught} hidden bug caught`;
  return (
    <div
      className="hero-bars-col relative box-content flex items-center"
      role="img"
      aria-label={`Kane's test steps across a match, with one red step where the hidden bug was caught${step != null ? ` at step ${step}` : ""}`}
      style={{ "--bug-frac": BUG_INDEX / BARS.length } as CSSProperties}
    >
      <div
        className="hero-label mono fade-in absolute rounded-pill border px-3 py-[5px] text-[12px] whitespace-nowrap"
        style={{ animationDelay: `${LAST_DELAY + 600}ms`, borderColor: "var(--glass-pill-border)", background: "var(--glass-pill-bg)" }}
      >
        {label}
      </div>
      <div className="hero-connector fade-in absolute h-12 w-px bg-text" style={{ animationDelay: `${LAST_DELAY + 600}ms` }} />
      <div className="hero-bars flex h-[200px] w-full items-center">
        {BARS.map((b, i) => (
          <span
            key={i}
            className={`hero-bar rounded-[2px] ${b.bug ? "bg-chaos" : "bg-text"}`}
            data-bug={b.bug || undefined}
            style={{ height: b.h, opacity: b.o, "--bar-delay": `${b.bug ? LAST_DELAY : i * 8}ms`, animationDelay: `${b.bug ? LAST_DELAY : i * 8}ms` } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

// ── The glass hero ──────────────────────────────────────────────────────────

export function Hero({ matchNo, step, caught, replayHref }: { matchNo: string; step: number | null; caught: number; replayHref: string }) {
  return (
    <section id="top" className="hero relative overflow-hidden border-b border-line">
      <ChromeShapes />
      <div className="glass hero-glass box-content relative z-[1] mx-auto max-w-[1240px]">
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-[.14] mix-blend-overlay">
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
        <div className="relative flex items-center gap-2 border-b border-glass-line px-6 py-4">
          <span aria-hidden="true" className="size-3 rounded-full bg-faint" />
          <span aria-hidden="true" className="size-3 rounded-full bg-faint" />
          <span aria-hidden="true" className="size-3 rounded-full bg-faint" />
          <span className="mono flex-1 text-center text-[13px] text-muted">hydra.arena/match/{matchNo} · kane is watching</span>
          <span className="w-[52px] max-sm:hidden" />
        </div>
        <div className="relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))]">
          <div className="hero-copy">
            <h1 className="hero-h1 m-0 font-medium">
              The <span className="text-kane">referee</span> for
              <br />
              coding agents
            </h1>
            <p className="mt-6 mb-10 max-w-[480px] text-[17px] leading-[1.5] text-text-2">
              Hydra hides one bug in a working app. Kane CLI hunts it in a real browser. Your agent has to fix it from Kane&apos;s evidence alone, and a
              hidden test decides if the fix ships.
            </p>
            <HeroPicker />
            <div className="mono mt-3.5 text-[13px] text-muted">
              Or{" "}
              <a href={replayHref} className="text-kane underline underline-offset-[3px]">
                watch a recorded match
              </a>
              , free, no sign-in.
            </div>
          </div>
          <HeroBars step={step} caught={caught} />
        </div>
      </div>
    </section>
  );
}
