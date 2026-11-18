/**
 * `hydra chaos validate`: prove every library bug applies, builds, boots and breaks exactly
 * the ground-truth checks it claims (FR2 "pre-validated patch, confirmed to break the app").
 * `hydra chaos calibrate`: run Kane's main spec against each bug to measure the real
 * caught/missed outcome (PRD open question 2). Results land in chaos/calibration.json.
 */
import { join } from "node:path";
import { resolvePath, stateDir, type HydraConfig } from "../config.js";
import { AppServer, buildApp } from "../app/server.js";
import { workspaceExclude } from "../anticheat.js";
import { runKane } from "../kane/wrapper.js";
import { parseSpec } from "../spec.js";
import { copyTree, ensureDir, readJsonOr, removeTree, writeJsonAtomic } from "../util/fs.js";
import { c, log } from "../util/log.js";
import { applyBug } from "./engine.js";
import { ALL_CHECKS, runGroundTruth } from "./groundtruth.js";
import { BUGS, type Bug } from "./taxonomy.js";

export type ValidationRow = {
  bug: string;
  applies: boolean;
  builds: boolean;
  failing: string[];
  declared: string[];
  confirmed: boolean;
  note: string | null;
};

async function withBuggyApp<T>(
  cfg: HydraConfig,
  bug: Bug | null,
  scratchRoot: string,
  fn: (app: AppServer) => Promise<T>,
): Promise<{ applies: boolean; builds: boolean; value: T | null; note: string | null }> {
  const ws = join(scratchRoot, bug?.id ?? "baseline", "workspace");
  removeTree(join(scratchRoot, bug?.id ?? "baseline"));
  ensureDir(ws);
  copyTree(resolvePath(cfg, cfg.app.dir), ws, { exclude: workspaceExclude });
  if (bug) {
    try {
      applyBug(ws, bug);
    } catch (err) {
      return { applies: false, builds: false, value: null, note: (err as Error).message };
    }
  }
  const build = await buildApp(cfg, ws, join(ws, "..", "build.log"));
  if (!build.ok) return { applies: true, builds: false, value: null, note: build.logTail.slice(-600) };
  const app = new AppServer(cfg);
  try {
    await app.start(ws, join(ws, "..", "app.log"));
    return { applies: true, builds: true, value: await fn(app), note: null };
  } finally {
    await app.stop();
  }
}

export async function validateBugs(cfg: HydraConfig, ids?: string[]): Promise<{ baselineOk: boolean; rows: ValidationRow[] }> {
  const scratch = ensureDir(join(stateDir(cfg), "chaos-validate"));
  const bugs = ids?.length ? BUGS.filter((b) => ids.includes(b.id)) : [...BUGS];
  log.step("CHAOS", "validating the unmodified app against ground truth…");
  const base = await withBuggyApp(cfg, null, scratch, (app) => runGroundTruth(app.url, () => app.reset()));
  if (!base.value?.available) throw new Error(base.value?.reason ?? base.note ?? "baseline app did not build");
  const baselineOk = base.value.failing.length === 0;
  if (!baselineOk) log.error(`baseline app fails ground truth: ${base.value.results.filter((r) => !r.passed).map((r) => `${r.check}: ${r.failure}`).join("; ")}`);
  else log.ok(`baseline passes all ${ALL_CHECKS.length} ground-truth checks`);

  const rows: ValidationRow[] = [];
  for (const bug of bugs) {
    log.step("CHAOS", `${bug.id}…`);
    const r = await withBuggyApp(cfg, bug, scratch, (app) => runGroundTruth(app.url, () => app.reset()));
    const failing = r.value?.failing ?? [];
    const confirmed = r.builds && bug.breaks.every((b) => failing.includes(b)) && failing.length > 0;
    const extra = failing.filter((f) => !bug.breaks.includes(f));
    const row: ValidationRow = {
      bug: bug.id,
      applies: r.applies,
      builds: r.builds,
      failing,
      declared: bug.breaks,
      confirmed,
      note: r.note ?? (extra.length ? `also breaks: ${extra.join(", ")}` : null),
    };
    rows.push(row);
    const mark = confirmed ? c.green("confirmed") : c.red("NOT confirmed");
    log.info(`  ${bug.id.padEnd(22)} ${mark}  breaks: ${failing.join(", ") || "nothing"}${row.note ? c.dim(`  (${row.note.split("\n")[0]})`) : ""}`);
  }
  const outFile = resolvePath(cfg, "chaos/validation.json");
  writeJsonAtomic(outFile, { validatedAt: new Date().toISOString(), baselineOk, rows });
  return { baselineOk, rows };
}

export type CalibrationRow = { bug: string; hypothesis: string; kane: "caught" | "missed" | "error"; exitCode: number | null; summary: string | null; testUrl: string | null; measuredAt: string };

export async function calibrate(cfg: HydraConfig, ids?: string[]): Promise<CalibrationRow[]> {
  const scratch = ensureDir(join(stateDir(cfg), "chaos-calibrate"));
  const spec = parseSpec(resolvePath(cfg, cfg.specs.main));
  const bugs = ids?.length ? BUGS.filter((b) => ids.includes(b.id)) : [...BUGS];
  const file = resolvePath(cfg, "chaos/calibration.json");
  const existing = readJsonOr<{ rows: CalibrationRow[] }>(file, { rows: [] });
  const rows = new Map(existing.rows.map((r) => [r.bug, r]));
  for (const bug of bugs) {
    log.step("KANE", `calibrating ${bug.id} (hypothesis: ${bug.kaneHypothesis})…`);
    const r = await withBuggyApp(cfg, bug, scratch, async (app) => {
      let result = null;
      for (let attempt = 0; attempt <= cfg.kane.retries; attempt++) {
        await app.reset();
        result = await runKane(cfg, { spec, url: app.url, outDir: join(scratch, bug.id, `kane${attempt ? `-retry${attempt}` : ""}`), label: bug.id });
        if (result.verdict === "passed" || result.verdict === "failed") break;
      }
      return result!;
    });
    const k = r.value;
    const row: CalibrationRow = {
      bug: bug.id,
      hypothesis: bug.kaneHypothesis,
      kane: !k ? "error" : k.verdict === "failed" ? "caught" : k.verdict === "passed" ? "missed" : "error",
      exitCode: k?.exitCode ?? null,
      summary: k?.summary ?? r.note,
      testUrl: k?.testUrl ?? null,
      measuredAt: new Date().toISOString(),
    };
    rows.set(bug.id, row);
    writeJsonAtomic(file, { calibratedWith: "kane-cli run (fresh, headless)", rows: [...rows.values()] });
    const match = row.hypothesis === "unknown" || row.hypothesis === row.kane;
    log.info(`  ${bug.id.padEnd(22)} Kane ${row.kane === "caught" ? c.green("caught") : row.kane === "missed" ? c.yellow("missed") : c.red("error")}${match ? "" : c.dim(" (differs from hypothesis)")}`);
  }
  return [...rows.values()];
}
