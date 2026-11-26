import type { ReactNode } from "react";
import type { CatchRow, FormRow, LogRow, Phase } from "@/lib/arena";
import type { Verdict } from "@/lib/types";
import { cx, VERDICT_BG, VERDICT_TEXT } from "./ui";

// ── MatchLog ────────────────────────────────────────────────────────────────

const TONE: Record<LogRow["tone"], string> = {
  muted: "text-muted",
  chaos: "text-chaos",
  kane: "text-kane",
  healed: "text-healed",
  gate: "text-gate",
};

export function MatchLog({
  meta,
  verdict,
  rows,
  className,
  current,
  future,
  listRef,
}: {
  meta: ReactNode;
  verdict: Verdict | null;
  rows: LogRow[];
  className?: string;
  /** Index of the row under the playhead (replay). */
  current?: number;
  /** Rows after this index are not reached yet and render as faint placeholders. */
  future?: number;
  listRef?: React.Ref<HTMLOListElement>;
}) {
  return (
    <div className={cx("card", className)}>
      <div className="mono flex justify-between gap-3 border-b border-line px-[18px] py-3.5 text-[12px] text-muted">
        <span>{meta}</span>
        {verdict ? <span className={cx("whitespace-nowrap", VERDICT_TEXT[verdict])}>● {verdict}</span> : <span>● in play</span>}
      </div>
      <ol ref={listRef} className="mono m-0 list-none py-2.5 text-[13px] leading-[1.5]">
        {rows.map((r, i) => {
          const pending = future != null && i > future;
          const hl = !pending && (r.highlight || i === current);
          return (
            <li
              key={`${r.t}-${i}`}
              aria-current={i === current ? "step" : undefined}
              className={cx(
                hl ? "border-l-2 border-kane bg-kane-tint px-4 py-2 text-text" : "px-[18px] py-2",
                !hl && (pending ? "text-faint" : TONE[r.tone]),
                future != null && !pending && "row-in",
              )}
            >
              {pending ? <span aria-hidden="true">{r.text.replace(/[^·\s]/g, "·").slice(0, 24)}</span> : r.text}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── PhaseScrubber ───────────────────────────────────────────────────────────

const PHASE_BAR: Record<Phase, string> = {
  build: "bg-text",
  baseline: "bg-kane opacity-50",
  chaos: "bg-chaos",
  catch: "bg-kane",
  heal: "bg-healed opacity-70",
  verify: "bg-healed opacity-45",
  deploy: "bg-healed",
};
const PHASE_LABEL: Partial<Record<Phase, string>> = { chaos: "text-chaos", catch: "text-kane" };

export type ScrubSegment = { phase: Phase; weight: number };
/** The reference proportions, used when a scrubber illustrates a match rather than seeking one. */
export const DEFAULT_SEGMENTS: ScrubSegment[] = [
  { phase: "build", weight: 1 },
  { phase: "baseline", weight: 2 },
  { phase: "chaos", weight: 1 },
  { phase: "catch", weight: 1 },
  { phase: "heal", weight: 1.4 },
  { phase: "verify", weight: 1.2 },
  { phase: "deploy", weight: 2 },
];

export function PhaseScrubber({
  segments = DEFAULT_SEGMENTS,
  playhead,
  onPointer,
}: {
  segments?: ScrubSegment[];
  /** 0..100 */
  playhead: number;
  onPointer?: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const lastIdx = segments.length - 1;
  return (
    <div>
      <div className={cx("relative flex h-2.5 gap-[3px]", onPointer && "cursor-pointer touch-none")} onPointerDown={onPointer}>
        {segments.map((s, i) => (
          <span key={i} className={PHASE_BAR[s.phase]} style={{ flex: s.weight }} />
        ))}
        <span aria-hidden="true" className="absolute -top-[7px] h-6 w-0.5 bg-text" style={{ left: `${playhead}%` }} />
      </div>
      <div className="scrub-labels mono mt-2.5 flex gap-[3px] text-[11px] text-muted">
        {segments.map((s, i) => (
          <span key={i} className={cx(PHASE_LABEL[s.phase], i === lastIdx && "text-right", "min-w-0 overflow-hidden")} style={{ flex: s.weight }}>
            {s.phase}
          </span>
        ))}
      </div>
      <div className="scrub-legend mono mt-2.5 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {segments.map((s, i) => (
          <span key={i} className={PHASE_LABEL[s.phase]}>
            {s.phase}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── CatchMap ────────────────────────────────────────────────────────────────

const caughtAlpha = (n: number) => 22 + ((Math.min(n, 4) - 1) / 3) * 28;

export function CatchMap({ rows }: { rows: CatchRow[] }) {
  const cell = "px-3 py-2.5";
  return (
    <div className="mono grid grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))] gap-1 text-[13px]" role="table" aria-label="Kane's catches and misses per bug">
      <div role="row" className="contents">
        <span role="columnheader" className="text-[12px] text-muted">bug</span>
        <span role="columnheader" className="text-[12px] text-muted">caught</span>
        <span role="columnheader" className="text-[12px] text-muted">missed</span>
      </div>
      {rows.map((r) => (
        <div role="row" className="contents" key={r.bug}>
          <span role="rowheader" className="py-2.5">{r.bug}</span>
          <span
            role="cell"
            className={cx(cell, !r.caught && "bg-inset text-muted")}
            style={r.caught ? { background: `color-mix(in srgb, var(--kane) ${caughtAlpha(r.caught)}%, transparent)` } : undefined}
          >
            {r.caught}
          </span>
          <span
            role="cell"
            className={cx(cell, !r.missed && "bg-inset text-muted")}
            style={r.missed ? { background: "color-mix(in srgb, var(--chaos) 35%, transparent)" } : undefined}
          >
            {r.missed}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── FormGuide ───────────────────────────────────────────────────────────────

export function FormSquares({ form }: { form: FormRow["form"] }) {
  return (
    <span className="flex gap-1">
      {form.map((f) => (
        <span key={f.runId} aria-hidden="true" className={cx("size-2.5", VERDICT_BG[f.verdict])} />
      ))}
      <span className="sr-only">{form.map((f) => f.verdict).join(", ")}</span>
    </span>
  );
}

export function FormGuide({ rows }: { rows: FormRow[] }) {
  return (
    <div className="mono grid gap-3 text-[13px]">
      {rows.map((r) => (
        <div key={r.builder} className={cx("flex items-center justify-between", r.cheat && "text-muted")}>
          <span>{r.name}</span>
          <FormSquares form={r.form} />
        </div>
      ))}
    </div>
  );
}

export function FormLegend({ className }: { className?: string }) {
  const items: Verdict[] = ["healed", "missed", "rejected", "aborted"];
  return (
    <span className={cx("mono text-[11px] text-muted", className)}>
      {items.map((v, i) => (
        <span key={v}>
          {i > 0 && " "}
          <span className={VERDICT_TEXT[v]} aria-hidden="true">■</span> {v}
        </span>
      ))}
    </span>
  );
}
