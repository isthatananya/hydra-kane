"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffLine, LogRow, Phase } from "@/lib/arena";
import type { Verdict } from "@/lib/types";
import { MatchLog, PhaseScrubber, type ScrubSegment } from "./arena";
import { SegmentedToggle } from "./segmented-toggle";
import { cx, Redacted, VERDICT_TEXT } from "./ui";

export type ReplayKane = {
  label: string;
  spec: string;
  start: number;
  end: number;
  verdict: string;
  failStep: number | null;
  failShot: string | null;
  failAction: string | null;
  shots: { src: string; caption: string }[];
};

export type ReplayData = {
  runId: string;
  seed: number;
  builder: string;
  cheat: boolean;
  bug: { id: string; title: string; description: string; surface: string };
  verdict: Verdict;
  statusReason: string;
  total: number;
  times: number[];
  eventTimes: number[];
  catchT: number | null;
  log: LogRow[];
  spans: { phase: Phase; start: number; end: number }[];
  kane: ReplayKane[];
  chaosDiff: DiffLine[];
  evidence: { verdict: string; summary: string; line: string; step: number | null; action: string | null; shot: string | null } | null;
  gate: { decision: string; reasons: string[] } | null;
  oracle: { phase: string; available: boolean; results: { check: string; passed: boolean; failure: string | null }[] }[];
  credits: number;
  kaneRuns: number;
};

type Speed = "1" | "4" | "16";
const TICK: Record<Speed, number> = { "1": 1200, "4": 300, "16": 75 };
const PHASE_WORD: Record<Phase, { word: string; cls: string }> = {
  build: { word: "Building", cls: "text-text" },
  baseline: { word: "Baseline", cls: "text-kane" },
  chaos: { word: "Chaos", cls: "text-chaos" },
  catch: { word: "Kane hunts", cls: "text-kane" },
  heal: { word: "Healing", cls: "text-healed" },
  verify: { word: "Verifying", cls: "text-healed" },
  deploy: { word: "Gate", cls: "text-healed" },
};
const VERDICT_WORD: Record<Verdict, string> = { healed: "Healed", rejected: "Rejected", missed: "Missed", aborted: "Aborted" };

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Scrubber segments: real phase durations, with a floor so short phases stay visible and clickable. */
function useSegments(spans: ReplayData["spans"], total: number) {
  return useMemo(() => {
    const min = total * 0.05;
    const segs: (ScrubSegment & { start: number; end: number })[] = spans.map((s) => ({
      phase: s.phase,
      start: s.start,
      end: s.end,
      weight: Math.max(s.end - s.start, min),
    }));
    const sum = segs.reduce((a, s) => a + s.weight, 0) || 1;
    let acc = 0;
    const bounds = segs.map((s) => {
      const p0 = (acc / sum) * 100;
      acc += s.weight;
      return { ...s, p0, p1: (acc / sum) * 100 };
    });
    const toPct = (t: number) => {
      if (!bounds.length) return 0;
      if (t <= bounds[0].start) return 0;
      const b = bounds.find((x) => t >= x.start && t <= x.end) ?? bounds.at(-1)!;
      const f = b.end > b.start ? (t - b.start) / (b.end - b.start) : 1;
      return Math.min(100, b.p0 + Math.min(1, f) * (b.p1 - b.p0));
    };
    const toT = (pct: number) => {
      const b = bounds.find((x) => pct >= x.p0 && pct <= x.p1) ?? bounds.at(-1);
      if (!b) return 0;
      return b.start + ((pct - b.p0) / (b.p1 - b.p0 || 1)) * (b.end - b.start);
    };
    return { segments: segs.map(({ phase, weight }) => ({ phase, weight })), bounds, toPct, toT };
  }, [spans, total]);
}

export function Replay({ data }: { data: ReplayData }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("4");
  const [spoilers, setSpoilers] = useState(false);
  const [view, setView] = useState<"builder" | "god">("builder");
  const [help, setHelp] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);

  const { segments, bounds, toPct, toT } = useSegments(data.spans, data.total);
  const atEnd = t >= data.total;
  const god = view === "god";
  const revealed = spoilers || atEnd || god;
  const verdictShown = spoilers || atEnd;

  const phase = [...data.spans].reverse().find((s) => t >= s.start)?.phase ?? "build";
  const eventsSoFar = data.eventTimes.filter((x) => x <= t).length;
  const rowIdx = data.log.reduce((acc, r, i) => (r.t <= t ? i : acc), -1);

  // Kane's browser: the run under the playhead, or the last one that finished.
  const live = data.kane.find((k) => t >= k.start && t < k.end);
  const last = [...data.kane].reverse().find((k) => t >= k.end);
  const k = live ?? last;
  let shot: { src: string; caption: string } | null = null;
  let failing = false;
  if (k) {
    if (live) {
      const f = (t - k.start) / Math.max(1, k.end - k.start);
      shot = k.shots[Math.min(k.shots.length - 1, Math.floor(f * k.shots.length))] ?? null;
    } else if (k.failShot) {
      shot = { src: k.failShot, caption: k.shots.find((s) => s.src === k.failShot)?.caption ?? "" };
      failing = true;
    } else shot = k.shots.at(-1) ?? null;
  }
  const isCatch = data.catchT != null && t >= data.catchT && k?.label === "referee" && failing;

  // ── Playback ──
  const next = useCallback((dir: 1 | -1) => {
    setT((cur) => {
      if (dir === 1) return data.times.find((x) => x > cur) ?? data.total;
      return [...data.times].reverse().find((x) => x < cur) ?? 0;
    });
  }, [data.times, data.total]);
  const nextPhase = useCallback((dir: 1 | -1) => {
    setT((cur) => {
      if (dir === 1) return bounds.find((b) => b.start > cur)?.start ?? data.total;
      const before = bounds.filter((b) => b.start < cur);
      const cutoff = before.at(-1);
      if (cutoff && cur - cutoff.start > 1500) return cutoff.start;
      return before.at(-2)?.start ?? 0;
    });
  }, [bounds, data.total]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((cur) => {
        const n = data.times.find((x) => x > cur);
        if (n == null) {
          setPlaying(false);
          return data.total;
        }
        return n;
      });
    }, TICK[speed]);
    return () => clearInterval(id);
  }, [playing, speed, data.times, data.total]);

  // Keep the current log row in view.
  useEffect(() => {
    const el = logRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    el?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [rowIdx]);

  useEffect(() => {
    const d = helpRef.current;
    if (!d) return;
    if (help && !d.open) d.showModal();
    if (!help && d.open) d.close();
  }, [help]);

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === " " && tag !== "BUTTON") {
        e.preventDefault();
        setPlaying((p) => (atEnd ? (setT(0), true) : !p));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) nextPhase(1);
        else next(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) nextPhase(-1);
        else next(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setT(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setT(data.total);
      } else if (e.key === "1" || e.key === "2" || e.key === "3") setSpeed((["1", "4", "16"] as Speed[])[Number(e.key) - 1]);
      else if (e.key === "?") setHelp((h) => !h);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atEnd, data.total, next, nextPhase]);

  const onScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const seek = (x: number) => {
      const r = el.getBoundingClientRect();
      setT(Math.round(toT(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)))));
    };
    seek(e.clientX);
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const word = verdictShown ? { word: VERDICT_WORD[data.verdict], cls: VERDICT_TEXT[data.verdict] } : PHASE_WORD[phase];

  return (
    <main>
      <div className="replay-top flex flex-col gap-3 px-[var(--pad-x)] py-4">
        {/* Scoreboard */}
        <section aria-label="Scoreboard" className="glass grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-card px-6 py-4 max-md:grid-cols-1 max-md:text-center">
          <div>
            <div className="meta">builder</div>
            <div className="mt-1 text-[24px] font-medium tracking-[-0.02em]">
              {data.builder}
              {data.cheat && <span className="mono ml-2 rounded-pill border border-line px-2 py-0.5 align-middle text-[12px] text-muted">cheat</span>}
            </div>
          </div>
          <div className="text-center">
            <div className="meta">Kane referees · seed {data.seed}</div>
            <div aria-live="polite" className={cx("my-0.5 text-[34px] leading-[1.1] font-medium tracking-[-0.03em]", word.cls)}>
              {word.word}
            </div>
            <div className="meta">
              event {eventsSoFar}/{data.eventTimes.length} · {clock(Math.min(t, data.total))} / {clock(data.total)}
            </div>
          </div>
          <div className="md:text-right">
            <div className="meta">chaos bug</div>
            <div className="mono mt-1 text-[18px]">
              <Redacted revealed={revealed}>{data.bug.id}</Redacted>
            </div>
          </div>
        </section>

        <div className="replay-mid grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-3 max-md:grid-cols-1">
          {/* Stage */}
          <section aria-label="Kane's browser" className="card flex min-h-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-[18px] py-3">
              <span className="meta">
                Kane&apos;s browser{k ? ` · ${k.label}${live ? " · testing" : ` · ${k.verdict}`}` : ""}
              </span>
              <SegmentedToggle
                label="Whose view"
                value={view}
                onChange={setView}
                segments={[
                  { value: "builder", label: "Builder's view" },
                  { value: "god", label: "God view" },
                ]}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <div
                key={isCatch ? "catch" : "frame"}
                className={cx(
                  "relative min-h-[220px] flex-1 overflow-hidden rounded-inner border bg-frame",
                  isCatch ? "flash-kane border-kane" : "border-line",
                )}
              >
                {shot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shot.src} alt={shot.caption || "Kane's screenshot"} className="absolute inset-0 h-full w-full object-contain" />
                ) : (
                  <div className="meta absolute inset-0 grid place-items-center p-6 text-center">
                    {phase === "build" ? "The builder is shipping the app. Kane hasn't opened it yet." : "Waiting for Kane."}
                  </div>
                )}
                {!live && k && (phase === "chaos" || phase === "heal") && (
                  <div className="mono absolute right-3 bottom-3 left-3 rounded-chip bg-frame/90 px-3 py-2 text-[12px] text-muted">
                    {phase === "chaos" ? "Chaos is planting one bug. Kane's last look:" : "The builder is patching from Kane's evidence. Kane's last look:"} {k.label}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="mono min-w-0 truncate text-[12px] text-muted">{shot?.caption}</span>
                {failing && k?.failStep != null && (
                  <span className="mono shrink-0 rounded-chip bg-chaos-tint px-2.5 py-1.5 text-[12px] text-chaos">✕ failed at step {k.failStep}</span>
                )}
              </div>
            </div>
          </section>

          {/* Event log */}
          <section aria-label="Event log" className="flex min-h-0 flex-col">
            <MatchLog
              className="replay-log flex min-h-0 flex-1 flex-col [&>ol]:min-h-0 [&>ol]:flex-1 [&>ol]:overflow-y-auto"
              listRef={logRef}
              meta={`match · seed ${data.seed} · ${data.builder}`}
              verdict={verdictShown ? data.verdict : null}
              rows={data.log}
              current={rowIdx}
              future={rowIdx}
            />
          </section>
        </div>

        {/* Playback bar */}
        <section aria-label="Playback" className="card flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary size-10 p-0"
              aria-label={playing ? "Pause" : atEnd ? "Replay from the start" : "Play"}
              onClick={() => (atEnd ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))}
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor" /></svg>
              )}
            </button>
            <SegmentedToggle
              label="Speed"
              value={speed}
              onChange={setSpeed}
              segments={[
                { value: "1", label: "1×" },
                { value: "4", label: "4×" },
                { value: "16", label: "16×" },
              ]}
            />
            <button type="button" className="btn btn-secondary px-4 py-2.5" onClick={() => { setPlaying(false); setT(data.total); }}>
              Skip to verdict
            </button>
            <button type="button" className="meta cursor-pointer underline-offset-4 hover:underline" onClick={() => setHelp(true)}>
              Shortcuts ?
            </button>
            <span className="flex-1" />
            <button
              type="button"
              aria-pressed={spoilers}
              onClick={() => setSpoilers((s) => !s)}
              className={cx("mono cursor-pointer rounded-toggle border border-line px-3 py-2 text-[12px] transition-colors", spoilers ? "bg-text text-frame" : "text-muted hover:text-text")}
            >
              {spoilers ? "Spoilers on" : "Spoilers off"}
            </button>
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Match timeline"
            aria-valuemin={0}
            aria-valuemax={Math.round(data.total / 1000)}
            aria-valuenow={Math.round(t / 1000)}
            aria-valuetext={`${clock(t)} of ${clock(data.total)}, ${phase}`}
            className="rounded-chip"
          >
            <PhaseScrubber segments={segments} playhead={toPct(t)} onPointer={onScrub} />
          </div>
        </section>
      </div>

      {/* Below the fold */}
      <div className="grid grid-cols-3 gap-3 border-t border-line px-[var(--pad-x)] py-10 max-lg:grid-cols-1">
        <section className="card flex flex-col gap-4 p-6" aria-labelledby="hidden-h">
          <div className="flex items-center justify-between gap-2">
            <h2 id="hidden-h" className="m-0 text-[22px] font-medium tracking-[-0.02em]">Hidden from builder</h2>
            <span className="meta">{revealed ? "revealed" : "redacted"}</span>
          </div>
          <p className="m-0 text-[15px] leading-[1.4] text-text-2">
            The planted bug: <Redacted revealed={revealed}>{data.bug.title}</Redacted>.{" "}
            <Redacted revealed={revealed}>{data.bug.description}</Redacted>
          </p>
          <pre className="m-0 overflow-x-auto rounded-inner border border-line bg-frame p-4 text-[12px] leading-[1.7]">
            {data.chaosDiff.map((l, i) => (
              <div
                key={i}
                className={cx(
                  l.kind === "del" && "text-chaos",
                  l.kind === "add" && "text-healed",
                  (l.kind === "ctx" || l.kind === "hunk" || l.kind === "file") && "text-muted",
                )}
              >
                {l.kind === "file" ? (
                  l.text
                ) : l.kind === "del" || l.kind === "add" ? (
                  <>
                    {l.kind === "del" ? "- " : "+ "}
                    <Redacted revealed={revealed}>{l.text || " "}</Redacted>
                  </>
                ) : (
                  `${l.kind === "ctx" ? "  " : ""}${l.text}`
                )}
              </div>
            ))}
          </pre>
        </section>

        <section className="card flex flex-col gap-4 p-6" aria-labelledby="got-h">
          <div className="flex items-center justify-between gap-2">
            <h2 id="got-h" className="m-0 text-[22px] font-medium tracking-[-0.02em]">What the builder got</h2>
            <span className="meta">Kane&apos;s evidence</span>
          </div>
          {data.evidence?.verdict === "failed" ? (
            <>
              {data.evidence.shot && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.evidence.shot} alt={`Kane's screenshot at step ${data.evidence.step}`} className="w-full rounded-shot border border-kane" />
              )}
              {data.evidence.step != null && (
                <div className="mono rounded-chip bg-chaos-tint px-2.5 py-2 text-[12px] text-chaos">
                  ✕ step {data.evidence.step} · {data.evidence.action}
                </div>
              )}
              <p className="m-0 text-[15px] leading-[1.5] whitespace-pre-line text-text-2">{data.evidence.summary}</p>
            </>
          ) : (
            <p className="m-0 text-[15px] leading-[1.5] text-text-2">
              Kane&apos;s test passed, so the builder got nothing to fix. The oracle shows what Kane missed.
            </p>
          )}
          {data.gate && (
            <div className="mt-auto border-t border-line pt-4">
              <div className="meta mb-2">gate · {data.gate.decision === "promote" ? "open" : "closed"}</div>
              <ul className="mono m-0 list-none p-0 text-[12px] leading-[1.7] text-muted">
                {data.gate.reasons.map((r) => (
                  <li key={r}>
                    <Redacted revealed={revealed}>{r}</Redacted>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card flex flex-col gap-4 p-6" aria-labelledby="oracle-h">
          <div className="flex items-center justify-between gap-2">
            <h2 id="oracle-h" className="m-0 text-[22px] font-medium tracking-[-0.02em]">Ground truth · oracle</h2>
            <span className="meta">scored, never gating</span>
          </div>
          <table className="mono w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-muted">
                <th scope="col" className="py-2 text-left font-normal">check</th>
                {data.oracle.map((o) => (
                  <th key={o.phase} scope="col" className="py-2 text-left font-normal">{o.phase}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.oracle[0]?.results ?? []).map((r) => (
                <tr key={r.check} className="border-t border-line">
                  <th scope="row" className="py-2.5 pr-2 text-left font-normal">{r.check}</th>
                  {data.oracle.map((o) => {
                    const res = o.results.find((x) => x.check === r.check);
                    const cell = !o.available || !res ? <span className="text-muted">n/a</span> : res.passed ? <span className="text-healed">pass</span> : <span className="text-chaos" title={res.failure ?? undefined}>fail</span>;
                    return (
                      <td key={o.phase} className="py-2.5">
                        {o.phase === "baseline" ? cell : <Redacted revealed={revealed}>{cell}</Redacted>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta m-0 mt-auto">
            {data.kaneRuns} Kane runs · {Math.round(data.credits)} Kane credits · <Link href="/method#oracle" className="text-kane underline underline-offset-[3px]">how the oracle works</Link>
          </p>
        </section>
      </div>

      <dialog
        ref={helpRef}
        onClose={() => setHelp(false)}
        className="card m-auto max-w-[420px] p-6 text-text backdrop:bg-page/70"
        aria-labelledby="keys-h"
      >
        <h2 id="keys-h" className="m-0 mb-4 text-[22px] font-medium tracking-[-0.02em]">Keyboard</h2>
        <dl className="mono m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          {[
            ["Space", "play / pause"],
            ["← →", "previous / next event"],
            ["Shift + ← →", "previous / next phase"],
            ["Home / End", "start / verdict"],
            ["1 2 3", "speed 1× 4× 16×"],
            ["?", "this help"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-kane">{k}</dt>
              <dd className="m-0 text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <form method="dialog" className="mt-6">
          <button className="btn btn-secondary">Close</button>
        </form>
      </dialog>
    </main>
  );
}
