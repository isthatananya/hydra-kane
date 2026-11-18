/** Export recorded runs as a static site (GitHub Pages etc.) — the public, no-backend arena. */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { aggregate, listRuns, readEvents, type RunRecord } from "../ledger.js";
import { copyTree, ensureDir, removeTree, writeJsonAtomic } from "../util/fs.js";
import { ARENA_UI_DIR } from "./server.js";

function referencedFiles(r: RunRecord): string[] {
  const files = new Set<string>();
  const add = (p: string | null | undefined) => p && files.add(p);
  const kanes = [...r.baseline, ...(r.referee ? [r.referee.kane] : []), ...(r.specAgent?.kane ? [r.specAgent.kane] : []), ...r.rounds.flatMap((h) => h.verify)];
  for (const k of kanes) {
    add(k.video);
    k.screenshots.slice(-6).forEach(add);
  }
  for (const h of r.rounds) {
    add(h.diff);
    add(h.prompt);
  }
  if (r.chaosDiff) add(r.chaosDiff);
  return [...files];
}

export function exportArena(stateDir: string, outDir: string, opts: { runIds?: string[] } = {}): { runs: number; files: number } {
  removeTree(outDir);
  ensureDir(outDir);
  copyTree(ARENA_UI_DIR, outDir);
  const html = readFileSync(join(outDir, "index.html"), "utf8").replace(
    '<script src="app.js"></script>',
    '<script>window.HYDRA_STATIC = true;</script>\n  <script src="app.js"></script>',
  );
  writeFileSync(join(outDir, "index.html"), html);

  let runs = listRuns(stateDir).filter((r) => r.status !== "running");
  if (opts.runIds?.length) runs = runs.filter((r) => opts.runIds!.includes(r.runId));
  let fileCount = 0;
  for (const r of runs) {
    const src = join(stateDir, "runs", r.runId);
    const dest = ensureDir(join(outDir, "data", "runs", r.runId));
    writeJsonAtomic(join(dest, "run.json"), r);
    writeJsonAtomic(join(dest, "events.json"), readEvents(src));
    for (const rel of referencedFiles(r)) {
      const from = join(src, rel);
      if (!existsSync(from)) continue;
      const to = join(dest, "files", rel);
      ensureDir(dirname(to));
      copyFileSync(from, to);
      fileCount++;
    }
  }
  writeJsonAtomic(join(outDir, "data", "runs.json"), {
    stats: aggregate(runs),
    runs: runs.map((r) => ({
      runId: r.runId,
      seed: r.seed,
      builder: r.builder,
      status: r.status,
      bug: r.bug ? { id: r.bug.id, bugClass: r.bug.bugClass } : null,
      verdict: r.referee?.verdict ?? null,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      rounds: r.rounds.length,
    })),
  });
  writeFileSync(join(outDir, ".nojekyll"), "");
  return { runs: runs.length, files: fileCount };
}
