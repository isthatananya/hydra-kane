/** FR12: run the same seeds across several builders and tabulate comparable ledger entries. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir, type HydraConfig } from "./config.js";
import { listRuns, type RunRecord } from "./ledger.js";
import { runLoop } from "./orchestrator.js";
import { ensureDir, writeJsonAtomic } from "./util/fs.js";
import { log } from "./util/log.js";

const secs = (ms: number | null) => (ms === null ? "—" : `${Math.round(ms / 1000)}s`);

export function benchTable(runs: RunRecord[]): string {
  const header = "| seed | bug | builder | Kane referee | outcome | rounds to green | time to heal | tokens | Kane runs | holdout fails |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|";
  const rows = runs.map((r) =>
    [
      r.seed,
      r.bug?.id ?? "—",
      r.builder,
      r.referee?.verdict ?? "—",
      r.status,
      r.metrics.roundsToGreen ?? "—",
      secs(r.metrics.timeToHealMs),
      r.metrics.tokensTotal?.toLocaleString() ?? "—",
      r.metrics.kaneRuns,
      r.metrics.holdoutFailures,
    ].join(" | "),
  );
  return [header, sep, ...rows.map((r) => `| ${r} |`)].join("\n");
}

export async function bench(cfg: HydraConfig, seeds: number[], builders: string[], opts: { maxHeals?: number }): Promise<string> {
  const ids: string[] = [];
  for (const seed of seeds) {
    for (const builder of builders) {
      log.info(`── bench: seed ${seed} × ${builder} ──`);
      const res = await runLoop(cfg, { seed, builder, maxHeals: opts.maxHeals });
      ids.push(res.runId);
    }
  }
  const all = listRuns(stateDir(cfg));
  const runs = ids.map((id) => all.find((r) => r.runId === id)).filter((r): r is RunRecord => !!r);
  runs.sort((a, b) => a.seed - b.seed || a.builder.localeCompare(b.builder));
  const table = benchTable(runs);
  const dir = ensureDir(join(stateDir(cfg), "bench"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(dir, `${stamp}.md`), `# Hydra builder benchmark\n\nSeeds: ${seeds.join(", ")} · Builders: ${builders.join(", ")}\n\n${table}\n`);
  writeJsonAtomic(join(dir, `${stamp}.json`), { seeds, builders, runIds: ids });
  return table;
}
