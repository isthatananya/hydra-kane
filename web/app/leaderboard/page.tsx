import type { Metadata } from "next";
import { CatchMap, FormLegend, FormSquares } from "@/components/arena";
import { SitePage } from "@/components/site";
import { Card, cx, SectionHeader } from "@/components/ui";
import { agentRow, arenaStats, catchMap, fmtDuration, fmtInt, formGuide } from "@/lib/arena";
import { getRuns } from "@/lib/data";

export const metadata: Metadata = { title: "Leaderboard" };

export default async function Leaderboard() {
  const runs = await getRuns();
  const stats = arenaStats(runs);
  const agents = formGuide(runs)
    .map((f) => ({ ...agentRow(runs, f.builder), form: f.form }))
    .sort((a, b) => Number(a.cheat) - Number(b.cheat) || b.healed - a.healed || (a.timeToHealMs ?? 1e12) - (b.timeToHealMs ?? 1e12));
  const th = "py-3 pr-5 text-left font-normal whitespace-nowrap";
  const td = "py-4 pr-5 whitespace-nowrap";
  let rank = 0;
  return (
    <SitePage>
      <SectionHeader
        as="h1"
        eyebrow="Leaderboard"
        maxWidth={820}
        title={
          <>
            Who heals. Who cheats.
            <br />
            What Kane misses.
          </>
        }
      />
      <div className="flex flex-col gap-3 px-[var(--pad-x)] py-10">
        <p className="meta m-0">{stats.runs} recorded matches · small sample · every match replayable</p>
        <Card>
          <div className="border-b border-line px-6 py-4">
            <h2 className="m-0 text-[22px] font-medium tracking-[-0.02em]">Coding agents</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-[15px]">
              <thead className="mono text-[12px] text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className={`${th} pl-6`}>rank</th>
                  <th scope="col" className={th}>agent</th>
                  <th scope="col" className={th}>runs</th>
                  <th scope="col" className={th}>healed and shipped</th>
                  <th scope="col" className={th}>caught cheating</th>
                  <th scope="col" className={th}>rounds to green</th>
                  <th scope="col" className={th}>time to heal</th>
                  <th scope="col" className={th}>tokens per heal</th>
                  <th scope="col" className={th}>Kane credits per run</th>
                  <th scope="col" className={`${th} pr-6`}>form</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.builder} className={cx("border-b border-line last:border-b-0", a.cheat && "text-muted")}>
                    <td className={`${td} mono pl-6`}>
                      {a.cheat ? (
                        <span className="text-gate" aria-label="caught cheating, unranked">
                          ✕
                        </span>
                      ) : (
                        ++rank
                      )}
                    </td>
                    <td className={td}>
                      {a.name}
                      {a.cheat && <span className="mono ml-2 rounded-pill border border-line px-2 py-0.5 text-[12px]">cheat</span>}
                    </td>
                    <td className={`${td} meta`}>{a.runs}</td>
                    <td className={`${td} meta`}>{a.healed}</td>
                    <td className={`${td} meta`}>{a.caughtCheating}</td>
                    <td className={`${td} meta`}>{a.roundsToGreen == null ? "·" : a.roundsToGreen.toFixed(1)}</td>
                    <td className={`${td} meta`}>{fmtDuration(a.timeToHealMs)}</td>
                    <td className={`${td} meta`}>{fmtInt(a.tokensPerHeal)}</td>
                    <td className={`${td} meta`}>{fmtInt(a.creditsPerRun)}</td>
                    <td className={`${td} pr-6`}>
                      <FormSquares form={a.form} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-6 py-4">
            <FormLegend />
          </div>
        </Card>
        <Card className="flex flex-col gap-5 p-7">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="m-0 text-[22px] font-medium tracking-[-0.02em]">Kane&apos;s catch map</h2>
            <span className="mono text-[12px] text-muted">bug × result · {stats.bugs} matches</span>
          </div>
          <CatchMap rows={catchMap(runs)} />
          <p className="meta m-0">No Elo or confidence intervals until there are at least 30 matches per agent.</p>
        </Card>
      </div>
    </SitePage>
  );
}
