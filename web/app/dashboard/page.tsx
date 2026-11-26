import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { CatchMap, FormLegend, FormSquares } from "@/components/arena";
import { MatchesTable, type MatchRow } from "@/components/matches-table";
import { ButtonLink, Card, cx } from "@/components/ui";
import { agentRow, arenaStats, builderName, catchMap, fmtDate, fmtDuration, fmtInt, formGuide, verdictOf } from "@/lib/arena";
import { getRuns } from "@/lib/data";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const runs = await getRuns();
  const stats = arenaStats(runs);
  const totalCredits = runs.reduce((s, r) => s + r.metrics.kaneCredits, 0);
  const rows: MatchRow[] = [...runs].reverse().map((r) => ({
    runId: r.runId,
    verdict: verdictOf(r.status),
    builder: builderName(r.builder),
    bug: r.bug.id,
    seed: r.seed,
    duration: fmtDuration(r.durationMs),
    rounds: r.metrics.roundsToGreen != null ? String(r.metrics.roundsToGreen) : "·",
    tokens: fmtInt(r.metrics.tokensTotal),
    started: fmtDate(r.startedAt),
    startedIso: r.startedAt,
  }));
  const form = formGuide(runs);
  const agents = form
    .map((f) => ({ ...agentRow(runs, f.builder), form: f.form }))
    .sort((a, b) => Number(a.cheat) - Number(b.cheat) || b.healed - a.healed);

  const kpis = [
    { label: "Kane catch rate", value: `${Math.round((stats.caught / stats.bugs) * 100)}%`, sub: `${stats.caught} of ${stats.bugs} hidden bugs`, cls: "text-kane" },
    { label: "Healed and shipped", value: String(stats.healed), sub: `of ${stats.runs} matches`, cls: "text-healed" },
    { label: "Cheats blocked", value: `${stats.cheatsBlocked}/${stats.cheats}`, sub: "at the gate", cls: "text-gate" },
    { label: "Fastest heal", value: fmtDuration(stats.fastest?.metrics.timeToHealMs), sub: stats.fastest ? builderName(stats.fastest.builder) : "", cls: "text-text" },
    { label: "Kane misses", value: String(stats.misses), sub: "logged, not hidden", cls: "text-chaos" },
  ];

  return (
    <AppShell
      active="overview"
      crumbs={["Dashboard", "Overview"]}
      aside={
        <div className="flex items-center gap-4">
          <span className="meta">Kane credits used · {fmtInt(totalCredits)}</span>
          <ButtonLink href="/run">New match</ButtonLink>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-[var(--pad-x)] py-8">
        <h1 className="m-0 mb-3 text-[38px] leading-[1.05] font-medium tracking-[-0.03em]">Overview</h1>
        <div className="grid grid-cols-5 gap-3 max-lg:grid-cols-3 max-sm:grid-cols-1">
          {kpis.map((k) => (
            <Card key={k.label} className="p-6">
              <div className="meta">{k.label}</div>
              <div className={cx("mt-3 text-[40px] leading-none font-medium tracking-[-0.04em]", k.cls)}>{k.value}</div>
              <div className="meta mt-2 text-[12px]">{k.sub}</div>
            </Card>
          ))}
        </div>

        <div id="matches" className="scroll-mt-4">
          <MatchesTable rows={rows} />
        </div>

        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Card className="flex flex-col gap-5 p-7">
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="m-0 text-[22px] font-medium tracking-[-0.02em]">Kane&apos;s catch map</h2>
              <span className="mono text-[12px] text-muted">bug × result · {stats.bugs} matches</span>
            </div>
            <CatchMap rows={catchMap(runs)} />
          </Card>
          <Card className="flex flex-col gap-5 p-7">
            <h2 className="m-0 text-[22px] font-medium tracking-[-0.02em]">Agents</h2>
            <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
              {agents.map((a, i) => (
                <li key={a.builder} className={cx("grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-4", a.cheat && "text-muted")}>
                  <span className={cx("mono text-[13px]", a.cheat ? "text-gate" : "text-muted")} aria-label={a.cheat ? "caught cheating, unranked" : `rank ${i + 1}`}>
                    {a.cheat ? "✕" : i + 1}
                  </span>
                  <span>{a.name}</span>
                  <span className="meta">{a.healed} healed</span>
                  <FormSquares form={a.form} />
                </li>
              ))}
            </ol>
            <FormLegend className="mt-auto" />
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
