import Link from "next/link";
import { CatchMap, FormGuide, FormLegend, MatchLog, PhaseScrubber } from "@/components/arena";
import { BentoGlow } from "@/components/bento-glow";
import { GodViewTile } from "@/components/god-view-tile";
import { Hero } from "@/components/hero";
import { SitePage } from "@/components/site";
import { ButtonLink, Card, cx, SectionHeader, StatCell, StatGrid, VerdictPill } from "@/components/ui";
import {
  arenaStats,
  builderName,
  catchMap,
  diffHeadline,
  evidenceChip,
  failingStep,
  fmtDuration,
  formGuide,
  matchLog,
  parsePatch,
  shortId,
  story,
  verdictOf,
} from "@/lib/arena";
import { fileUrl, getEvents, getPatch, getRuns } from "@/lib/data";

/** The matches the landing page lists, one per kind of verdict (as in the approved reference). */
const LANDING_MATCHES = ["20261119-003757-s7-claude", "20261119-010607-s7-cheater", "20261119-013112-s14-claude", "20261119-022046-s7-opencode"];

const STEPS = [
  { n: "01", tone: "", title: "An agent ships the app", body: "A builder agent writes a checkout app. Kane passes it twice while it's still clean." },
  { n: "02", tone: "text-chaos", title: "Chaos plants one bug", body: "Nobody is told which. The builder never sees the diff or the bug's name." },
  { n: "03", tone: "text-kane", title: "Kane hunts it in a real browser", body: "It reports what it saw, the failing step and screenshots. That's all the builder gets." },
  { n: "04", tone: "text-healed", title: "The gate decides", body: "Two fresh Kane passes and a hidden holdout test, or nothing ships. Cheats get caught here." },
];

export default async function Landing() {
  const runs = await getRuns();
  const stats = arenaStats(runs);

  // The featured match: the first one that healed and shipped.
  const featured = runs.find((r) => r.status === "healed") ?? runs[0];
  const featuredNo = String(runs.indexOf(featured) + 1).padStart(3, "0");
  const events = await getEvents(featured.runId);
  const log = matchLog(featured, events);
  const step = failingStep(featured);
  const patch = await getPatch(featured.runId, featured.chaosDiff);
  const diff = diffHeadline(patch);
  const diffFile = parsePatch(patch).find((l) => l.kind === "file")?.text ?? "";
  const replayHref = `/matches/${featured.runId}`;

  // The quote: the match where a cheat fooled Kane's visible test and the hidden one caught it.
  const fooled = runs.find((r) => r.status === "aborted" && r.rounds.some((x) => x.outcome === "holdout-failed")) ?? runs.find((r) => r.status === "rejected");

  const rows = LANDING_MATCHES.map((id) => runs.find((r) => r.runId === id)).filter((r) => r != null);
  const form = formGuide(runs);
  const catches = catchMap(runs);
  const builders = form;
  const fastest = stats.fastest;

  return (
    <SitePage>
      <Hero matchNo={featuredNo} step={step?.step ?? null} caught={1} replayHref={replayHref} />

      {/* Builders row */}
      <section aria-label="Builders in the arena" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] border-b border-line bg-cell">
        {builders.map((b, i) => (
          <div
            key={b.builder}
            className={cx(
              "px-5 py-11 text-center text-[26px] font-medium tracking-[-0.03em]",
              i < builders.length - 1 && "border-r border-line",
              b.cheat && "text-muted",
            )}
          >
            {b.name}
            {b.cheat && (
              <>
                {" "}
                <span className="mono rounded-pill border border-line px-2 py-0.5 align-middle text-[12px]">cheat</span>
              </>
            )}
          </div>
        ))}
      </section>

      {/* The match */}
      <section id="match" className="border-b border-line">
        <SectionHeader
          eyebrow="The match"
          title={
            <>
              Hide one bug.
              <br />
              See who finds it.
            </>
          }
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,520px),1fr))]">
          <ol className="m-0 list-none border-r border-line bg-cell p-0">
            {STEPS.map((s, i) => (
              <li key={s.n} className={cx("flex", i < STEPS.length - 1 && "border-b border-line")}>
                <span
                  className={cx(
                    "mono box-content flex h-12 shrink-0 grow-0 basis-12 items-center justify-center border-r border-b border-line bg-inset text-[12px]",
                    s.tone,
                  )}
                >
                  {s.n}
                </span>
                <div className="pt-7 pr-8 pb-8 pl-6">
                  <h3 className="m-0 text-[24px] font-medium tracking-[-0.02em]">{s.title}</h3>
                  <p className="mt-3 mb-0 text-[16px] leading-[1.4] text-text-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-center px-[var(--pad-x)] py-12">
            <MatchLog
              className="box-content w-full max-w-[520px]"
              meta={`match · seed ${featured.seed} · ${builderName(featured.builder)}`}
              verdict={verdictOf(featured.status)}
              rows={log}
            />
          </div>
        </div>
      </section>

      {/* Totals */}
      <StatGrid label="Arena totals">
        <StatCell value={`${stats.caught}/${stats.bugs}`} caption="hidden bugs Kane caught" />
        <StatCell value={stats.healed} caption="fixes healed and shipped" />
        <StatCell value={`${stats.cheatsBlocked}/${stats.cheats}`} caption="cheats blocked at the gate" />
        <StatCell
          value={fmtDuration(fastest?.metrics.timeToHealMs)}
          caption={fastest ? `fastest heal, ${builderName(fastest.builder)}` : "fastest heal"}
        />
      </StatGrid>

      {/* Inside the arena */}
      <section id="inside" className="border-b border-line">
        <SectionHeader
          eyebrow="Inside the arena"
          maxWidth={720}
          title={
            <>
              Built to catch what
              <br />
              agents hide
            </>
          }
        />
        <BentoGlow>
        <div className="bento grid auto-rows-[minmax(260px,auto)] grid-cols-4 gap-3 px-[var(--pad-x)] pt-6 pb-10">
          <GodViewTile del={diff?.del ?? ""} add={diff?.add ?? ""} file={diffFile} />

          <Card className="col-start-3 row-start-1 flex flex-col justify-between gap-5 p-7">
            <span className="meta">The gate</span>
            <div>
              <div className="text-[56px] leading-none font-medium tracking-[-0.04em] text-gate">
                {stats.cheatsBlocked}/{stats.cheats}
              </div>
              <h3 className="mt-3 mb-0 text-[22px] font-medium tracking-[-0.02em]">Cheats blocked</h3>
              <p className="mt-2 mb-0 text-[15px] leading-[1.4] text-text-2">One hardcoded the totals. One edited Kane&apos;s test. Neither shipped.</p>
            </div>
          </Card>

          <Card className="col-start-4 row-start-1 flex flex-col gap-4 p-7">
            <span className="meta">Kane&apos;s evidence</span>
            <div className="relative box-content min-h-[90px] flex-1 overflow-hidden rounded-shot border border-kane bg-frame">
              {step && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fileUrl(featured.runId, step.shot)}
                  alt={`Kane's screenshot at step ${step.step}: ${step.action}`}
                  className="absolute inset-0 h-full w-full object-cover object-top"
                />
              )}
            </div>
            {featured.referee && (
              <div className="mono rounded-chip bg-chaos-tint px-2.5 py-2 text-[12px] text-chaos">✕ {evidenceChip(featured.referee.kane.summary)}</div>
            )}
          </Card>

          <Card className="col-span-2 col-start-3 row-start-2 flex flex-col justify-between gap-5 p-7">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="meta">Replay</span>
              <span className="mono text-[12px] text-muted">1× · 4× · 16× · spoilers off</span>
            </div>
            <h3 className="m-0 text-[26px] leading-[1.15] font-medium tracking-[-0.02em]">Scrub any match, phase by phase</h3>
            <PhaseScrubber playhead={47} />
          </Card>

          <Card className="col-span-2 col-start-1 row-start-3 flex flex-col gap-5 p-7">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="meta">Kane&apos;s catch map</span>
              <span className="mono text-[12px] text-muted">bug × result · {stats.bugs} matches</span>
            </div>
            <h3 className="m-0 text-[26px] leading-[1.15] font-medium tracking-[-0.02em]">The referee gets scored too</h3>
            <CatchMap rows={catches} />
          </Card>

          <Link
            href="/play"
            className="col-start-3 row-start-3 flex flex-col justify-between gap-5 overflow-hidden rounded-card border border-line bg-text p-7 text-frame transition-colors hover:text-frame"
          >
            <span className="mono text-[13px] text-faint">Play</span>
            <div>
              <h3 className="m-0 text-[28px] leading-[1.1] font-medium tracking-[-0.03em]">Find the bug before Kane does</h3>
              <p className="mt-2.5 mb-0 text-[15px] leading-[1.4] text-on-light-2">Three live shops, one planted bug each. Beat Kane&apos;s time.</p>
            </div>
            <span className="text-[15px] font-medium">Start playing →</span>
          </Link>

          <Card className="col-start-4 row-start-3 flex flex-col justify-between gap-5 p-7">
            <span className="meta">Form guide</span>
            <FormGuide rows={form} />
            <FormLegend />
          </Card>
        </div>
        </BentoGlow>
      </section>

      {/* Quote */}
      {fooled && (
        <section className="flex justify-center border-b border-line px-[var(--pad-x)] py-[var(--section-y)]">
          <figure className="m-0 flex w-full max-w-[640px]">
            <span
              aria-hidden="true"
              className="box-content flex h-14 shrink-0 grow-0 basis-14 items-center justify-center rounded-[16px_0_0_16px] border border-line text-[40px] leading-none font-semibold text-kane"
            >
              “
            </span>
            <div className="flex-1 rounded-[0_22px_22px_22px] border border-l-0 border-line bg-cell p-8">
              <blockquote className="quote m-0 font-medium">{story(fooled)}</blockquote>
              <figcaption className="meta mt-5">
                Match report · {builderName(fooled.builder)} · {fooled.bug.id} · seed {fooled.seed}
              </figcaption>
            </div>
          </figure>
        </section>
      )}

      {/* Recorded matches */}
      <section id="matches" className="border-b border-line">
        <SectionHeader
          eyebrow="Recorded matches"
          title="Every verdict, replayable"
          action={
            <ButtonLink href="/dashboard" variant="secondary" className="px-[18px] py-3">
              All matches →
            </ButtonLink>
          }
        />
        <div className="bg-cell">
          {rows.map((r, i) => (
            <Link
              key={r.runId}
              href={`/matches/${r.runId}`}
              className={cx("match-row row-link grid items-center gap-4 px-[var(--pad-x)] py-[22px]", i < rows.length - 1 && "border-b border-line")}
              aria-label={`${verdictOf(r.status)}: ${story(r)}. Seed ${r.seed}, ${fmtDuration(r.durationMs)}. Open replay ${shortId(r.runId)}`}
            >
              <VerdictPill verdict={verdictOf(r.status)} />
              <span className="match-summary text-[17px]">{story(r)}</span>
              <span className="meta">seed {r.seed}</span>
              <span className="meta text-right">{fmtDuration(r.durationMs)}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-b border-line px-[var(--pad-x)] py-[120px] text-center max-sm:py-[var(--section-y)]">
        <h2 className="h2 mx-auto max-w-[720px] leading-[1.05] tracking-[-0.04em]">Put your agent in the arena</h2>
        <p className="mx-auto mt-5 mb-9 max-w-[520px] text-[17px] text-text-2">
          Watch a recorded match for free, or queue a live one. Live matches run {Math.round(stats.minDurationMs / 60000)} to{" "}
          {Math.round(stats.maxDurationMs / 60000)} minutes and use Kane credits.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/run?mode=live" size="lg">
            Run a live match
          </ButtonLink>
          <ButtonLink href={replayHref} variant="secondary" size="lg">
            Watch a replay
          </ButtonLink>
        </div>
      </section>
    </SitePage>
  );
}
