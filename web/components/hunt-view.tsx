"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { HuntStep, HuntView as View } from "@/lib/hunts";
import { RunnerBadge } from "./hunt-launcher";
import { Button, ButtonLink, Card, cx, Eyebrow } from "./ui";

type BugInfo = Record<string, { title: string; description: string; run: string }>;

const FINAL = ["caught", "missed", "error"];
const POLL_MS = 1500;

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function HuntView({ id, bugs }: { id: string; bugs: BugInfo }) {
  const [view, setView] = useState<View | null>(null);
  const [steps, setSteps] = useState<HuntStep[]>([]);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const count = useRef(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/hunts/${encodeURIComponent(id)}?after=${count.current}`, { cache: "no-store" });
        if (res.status === 404) {
          if (live) setMissing(true);
          return;
        }
        if (res.ok) {
          const v = (await res.json()) as View;
          if (!live) return;
          count.current += v.steps.length;
          if (v.steps.length) setSteps((prev) => [...prev, ...v.steps]);
          setView(v);
          if (FINAL.includes(v.hunt.state)) return;
        }
      } catch {
        /* keep polling */
      }
      if (live) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id]);

  const running = view?.hunt.state === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (missing) {
    return (
      <section className="px-[var(--pad-x)] py-[var(--section-y)]">
        <h1 className="h2">No such hunt</h1>
        <p className="mt-4 text-text-2">The link may be wrong, or the hunt is older than 30 days.</p>
        <ButtonLink href="/run?mode=live" className="mt-6">Run a hunt</ButtonLink>
      </section>
    );
  }
  if (!view) {
    return (
      <section className="px-[var(--pad-x)] py-[var(--section-y)]">
        <p className="meta">Loading the hunt…</p>
      </section>
    );
  }

  const h = view.hunt;
  const done = FINAL.includes(h.state);
  const shopName = h.shop ? `Shop ${h.shop.toUpperCase()}` : "Sealed shop";
  const elapsed = h.startedAt ? (h.finishedAt ?? now) - h.startedAt : 0;
  const bug = h.bug ? bugs[h.bug] : null;

  const title =
    h.state === "queued" ? "Waiting in line" : h.state === "running" ? "Kane is hunting" : h.state === "caught" ? "Kane caught the bug" : h.state === "missed" ? "Kane missed the bug" : "The hunt didn't finish";
  const tone = h.state === "caught" ? "text-kane" : h.state === "missed" ? "text-chaos" : "";

  return (
    <>
      <section className="border-b border-line px-[var(--pad-x)] pt-[var(--section-y)] pb-12">
        <Eyebrow>
          Live Kane hunt · {shopName}
          {h.login ? ` · run by ${h.login}` : ""}
        </Eyebrow>
        <h1 className={cx("h2 mt-5", tone)}>{title}</h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          {h.state === "queued" && (
            <>
              <span className="meta">{view.position ? `#${view.position} in the queue` : "About to start"} · starts when the runner is free</span>
              <RunnerBadge runner={view.runner} />
            </>
          )}
          {h.state === "running" && (
            <span className="meta inline-flex items-center gap-2">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-kane" />
              {clock(elapsed)} elapsed · {steps.length} step{steps.length === 1 ? "" : "s"} so far
            </span>
          )}
          {done && h.state !== "error" && (
            <span className="meta">
              {clock(h.durationMs ?? elapsed)} · {steps.length} steps{h.credits != null ? ` · ${Math.round(h.credits)} Kane credits` : ""}
            </span>
          )}
          <CopyLink />
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-6 px-[var(--pad-x)] py-10 max-md:grid-cols-1">
        <Card className="self-start p-0">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <span className="meta">Kane CLI · real browser · checkout main flow</span>
            {running && <span className="mono text-[12px] text-kane">live</span>}
          </div>
          <ol className="m-0 list-none p-0" aria-live="polite">
            {steps.length === 0 && (
              <li className="meta px-6 py-5">{h.state === "queued" ? "Kane's steps will appear here once the hunt starts." : h.state === "running" ? "Kane is starting a real browser and planning the test. The first step usually shows up within two or three minutes." : "No steps were recorded."}</li>
            )}
            {steps.map((s, i) => (
              <li key={`${s.step}-${i}`} className="row-in grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line px-6 py-3 last:border-b-0">
                <span className="mono text-[12px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span className={cx("text-[14px] leading-[1.4]", s.status === "failed" ? "text-chaos" : "text-text")}>{s.text}</span>
                <span className="mono flex items-center gap-2 text-[12px] text-muted">
                  {clock(s.t)}
                  <span aria-label={s.status === "failed" ? "failed" : "passed"} className={s.status === "failed" ? "text-chaos" : "text-healed"}>
                    {s.status === "failed" ? "✕" : "✓"}
                  </span>
                </span>
              </li>
            ))}
            {running && (
              <li className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 px-6 py-3">
                <span aria-hidden="true" className="mt-1.5 size-2 animate-pulse rounded-full bg-kane" />
                <span className="meta">Kane is working on the next step…</span>
              </li>
            )}
          </ol>
        </Card>

        <div className="flex flex-col gap-4">
          {!done ? (
            <Card className="p-7">
              <span className="meta">What&apos;s happening</span>
              <ul className="mt-4 mb-0 flex list-none flex-col gap-3 p-0 text-[15px] leading-[1.45] text-text-2">
                <li>Kane CLI gets the same plain-English test a person would: add items, remove one, change a quantity, apply a coupon, pay.</li>
                <li>Nobody tells it what the bug is. It has to notice something wrong on its own.</li>
                <li>If a check fails, that&apos;s a catch. If the whole flow passes with the bug still in, it&apos;s a miss, and that gets logged too.</li>
              </ul>
            </Card>
          ) : h.state === "error" ? (
            <Card className="p-7">
              <span className="meta">What went wrong</span>
              <p className="mt-3 mb-0 text-[16px] leading-[1.45] text-text-2">{h.infraReason}</p>
              <ButtonLink href="/run?mode=live" className="mt-6">Try again</ButtonLink>
            </Card>
          ) : (
            <>
              <Card className="p-7">
                <span className="meta">Kane&apos;s verdict</span>
                <p className={cx("mt-3 mb-0 text-[22px] leading-[1.25] font-medium tracking-[-0.02em]", tone)}>
                  {h.oneLiner ?? h.summary ?? (h.state === "missed" ? "Every check passed." : "A check failed.")}
                </p>
                {h.failingStep && (h.failingStep.description || h.failingStep.reason) && (
                  <p className="mono mt-4 mb-0 rounded-chip bg-chaos-tint px-3 py-2.5 text-[12px] leading-[1.5] text-chaos">
                    ✕ {h.failingStep.reason ?? h.failingStep.description}
                  </p>
                )}
                {h.testUrl && (
                  <a href={h.testUrl} target="_blank" rel="noreferrer" className="mt-5 inline-block text-[15px] text-kane underline underline-offset-[3px]">
                    Kane&apos;s full report, with screenshots ↗
                  </a>
                )}
              </Card>
              {bug && (
                <Card className="p-7">
                  <span className="meta">The planted bug</span>
                  <h2 className="mt-3 mb-0 text-[22px] font-medium tracking-[-0.02em] text-chaos">{bug.title}</h2>
                  <p className="mt-2 mb-0 text-[15px] leading-[1.45] text-text-2">{bug.description}</p>
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
                    {h.shopUrl && (
                      <a href={h.shopUrl} target="_blank" rel="noreferrer" className="text-kane underline underline-offset-[3px]">
                        Find it yourself in {shopName} ↗
                      </a>
                    )}
                    <Link href={`/matches/${bug.run}`} className="text-kane underline underline-offset-[3px]">
                      Watch the full match on this bug
                    </Link>
                  </div>
                </Card>
              )}
              <div className="flex flex-wrap gap-3">
                <ButtonLink href="/play" variant="secondary">Beat Kane&apos;s time</ButtonLink>
                <ButtonLink href="/dashboard" variant="secondary">Recorded matches</ButtonLink>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      className="px-3 py-1.5 text-[13px]"
      onClick={() => {
        void navigator.clipboard?.writeText(location.href).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}
