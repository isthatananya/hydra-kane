"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SegmentedToggle } from "./segmented-toggle";
import { Button, cx, Redacted } from "./ui";

export type Shop = {
  slot: "a" | "b" | "c";
  url: string;
  bug: string;
  bugText: string;
  runId: string;
  kaneCaught: boolean;
  kaneMs: number;
  evidence: string;
};

const OPTIONS: [string, string][] = [
  ["wrong-total", "Shipping is charged per item instead of once per order"],
  ["stale-cart", "Removing an item doesn't take it out of the cart"],
  ["validation-bypass", "Payment goes through with an invalid email"],
  ["coupon-ignored", "The coupon says it applied, but the total ignores it"],
  ["dead-pay-button", "The Pay button does nothing"],
  ["off-by-one-qty", "The + button changes the wrong item's quantity"],
  ["currency-format", "Prices are formatted wrong (like $58.0)"],
  ["confirmation-amount", "The confirmation shows the wrong amount charged"],
];

const TASK = [
  'Add "Trail Mug", "Canvas Tote" and "Field Notebook" to the cart.',
  'Remove "Field Notebook". The cart should list only the mug and the tote.',
  'Click + once for "Trail Mug". Quantities: mug 2, tote 1. Subtotal $60.00.',
  "Apply the coupon SAVE10. Discount -$6.00, shipping $4.00, total $58.00.",
  "Pay with any name, an email and card 4242 4242 4242 4242.",
  'The confirmation should say "Charged $58.00".',
];

type Result = { pick: string; correct: boolean; ms: number };
const KEY = "hydra-play-v1";
const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function PlayGame({ shops }: { shops: Shop[] }) {
  const [slot, setSlot] = useState<Shop["slot"]>("a");
  const [saved, setSaved] = useState<Record<string, Result>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [pick, setPick] = useState("");
  const live = useRef<HTMLParagraphElement>(null);
  const shop = shops.find((s) => s.slot === slot)!;
  const result = saved[slot];

  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
    } catch {
      /* private mode */
    }
    const m = /shop-([abc])/.exec(location.hash);
    if (m) setSlot(m[1] as Shop["slot"]);
  }, []);

  useEffect(() => {
    if (startedAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const choose = (s: Shop["slot"]) => {
    setSlot(s);
    setStartedAt(null);
    setPick("");
    history.replaceState(null, "", `#shop-${s}`);
  };
  const persist = (next: Record<string, Result>) => {
    setSaved(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const elapsed = startedAt != null ? now - startedAt : 0;
  const won = result && result.correct && (!shop.kaneCaught || result.ms < shop.kaneMs);
  const headline = !result ? "" : result.correct ? (shop.kaneCaught ? (result.ms < shop.kaneMs ? "You beat Kane" : "Kane was faster") : "You caught what Kane missed") : "Not this one";
  const done = shops.filter((s) => saved[s.slot]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <SegmentedToggle
          label="Shop"
          value={slot}
          onChange={choose}
          segments={shops.map((s) => ({ value: s.slot, label: `Shop ${s.slot.toUpperCase()}${saved[s.slot] ? (saved[s.slot].correct ? " · found" : " · missed") : ""}` }))}
        />
        <span className="meta">{done.length ? `You found ${done.filter((s) => saved[s.slot].correct).length} of ${done.length}` : "3 shops, 1 bug each"}</span>
      </div>

      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 max-lg:grid-cols-1">
        <section className="card flex min-h-[640px] flex-col" aria-label={`Shop ${slot.toUpperCase()}`}>
          <div className="flex items-center gap-3 border-b border-line px-[18px] py-3">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-faint" />
            <span className="meta min-w-0 flex-1 truncate">{shop.url.replace(/^https:\/\//, "").replace(/\/$/, "")}</span>
            <a href={shop.url} target="_blank" rel="noopener noreferrer" className="meta text-kane underline underline-offset-[3px]">
              Open in a new tab
            </a>
          </div>
          <iframe key={slot} src={shop.url} title={`Shop ${slot.toUpperCase()}, a checkout with one hidden bug`} className="w-full flex-1 border-0 bg-text" />
        </section>

        <section className="card flex flex-col gap-5 p-6" aria-label="Your round">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="meta">your time</div>
              <div className="mt-1 text-[48px] leading-none font-medium tracking-[-0.04em] tabular-nums">{fmt(result ? result.ms : elapsed)}</div>
            </div>
            <div className="text-right">
              <div className="meta">Kane&apos;s time to beat</div>
              <div className="mt-1 text-[24px] font-medium tracking-[-0.02em] text-kane">{shop.kaneCaught ? fmt(shop.kaneMs) : "Kane missed it"}</div>
            </div>
          </div>

          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-[1.4] text-text-2">
            {TASK.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>

          {!result && startedAt == null && (
            <Button size="lg" onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}>
              Start the clock
            </Button>
          )}

          {!result && startedAt != null && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!pick) return;
                const r = { pick, correct: pick === shop.bug, ms: Date.now() - startedAt };
                persist({ ...saved, [slot]: r });
                setStartedAt(null);
                if (live.current) live.current.textContent = `${r.correct ? "Right" : "Not this one"}. The bug was: ${shop.bugText}.`;
              }}
            >
              <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="meta mb-2">What&apos;s broken?</legend>
                {OPTIONS.map(([id, text]) => (
                  <label key={id} className={cx("flex cursor-pointer items-start gap-3 rounded-btn border px-3 py-2.5 text-[14px] transition-colors", pick === id ? "border-kane bg-kane-tint" : "border-line hover:bg-inset")}>
                    <input type="radio" name="pick" value={id} checked={pick === id} onChange={() => setPick(id)} className="mt-0.5 accent-[var(--kane)]" />
                    {text}
                  </label>
                ))}
              </fieldset>
              <Button type="submit" size="lg" disabled={!pick}>
                Lock in my answer
              </Button>
            </form>
          )}

          {result && (
            <div className="flex flex-col gap-3">
              <p className={cx("m-0 text-[28px] font-medium tracking-[-0.03em]", result.correct ? (won ? "text-healed" : "text-kane") : "text-chaos")}>{headline}</p>
              <p className="m-0 text-[15px] text-text-2">
                The bug was: <Redacted revealed>{shop.bugText}</Redacted>.
              </p>
              <dl className="mono m-0 grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <dt className="text-muted">You</dt>
                  <dd className="m-0 text-[20px]">{result.correct ? fmt(result.ms) : "wrong answer"}</dd>
                </div>
                <div>
                  <dt className="text-kane">Kane</dt>
                  <dd className="m-0 text-[20px]">{shop.kaneCaught ? fmt(shop.kaneMs) : "missed it"}</dd>
                </div>
              </dl>
              {shop.kaneCaught && shop.evidence && <p className="meta m-0 leading-[1.5]">Kane: &ldquo;{shop.evidence}&rdquo;</p>}
              <div className="flex flex-wrap gap-3">
                <Link href={`/matches/${shop.runId}`} className="btn btn-primary">
                  {shop.kaneCaught ? "Watch Kane catch it" : "See Kane's miss"}
                </Link>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const next = { ...saved };
                    delete next[slot];
                    persist(next);
                    setPick("");
                  }}
                >
                  Try again
                </Button>
              </div>
            </div>
          )}
          {!result && startedAt == null && (
            <p className="meta m-0 mt-auto">Hidden until you answer: <Redacted>{shop.bugText}</Redacted></p>
          )}
          <p ref={live} aria-live="polite" className="sr-only" />
        </section>
      </div>
    </div>
  );
}
