/** Export recorded runs as a static site (GitHub Pages etc.) — the public, no-backend arena. */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { aggregate, bugSurface, listRuns, readEvents, type RunRecord } from "../ledger.js";
import { copyTree, ensureDir, removeTree, writeJsonAtomic } from "../util/fs.js";
import { ARENA_UI_DIR } from "./server.js";

/** Fill in fields older recordings lack, so the published arena shows them. */
function withSurface(r: RunRecord): RunRecord {
  return r.bug ? { ...r, bug: { ...r.bug, surface: bugSurface(r.bug) } } : r;
}

const LOCAL_PATH = /(?<![A-Za-z])[A-Za-z]:[\\/]|\/Users\/|\/home\//;

/** Rewrite absolute paths under the repo (or state dir) as repo-relative, forward-slash paths. */
export function scrubPaths<T>(value: T, roots: string[]): T {
  const variants = [...new Set(roots.flatMap((r) => [resolve(r), resolve(r).replace(/\\/g, "/")]))].sort((a, b) => b.length - a.length);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:${variants.map(esc).join("|")})[\\\\/]?([^\\s"'<>|;,)]*)`, "gi");
  const fix = (s: string) => s.replace(pattern, (_m, rest: string) => rest.replace(/\\/g, "/") || ".");
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return fix(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Throw if any string in `value` still looks like an absolute local path. */
export function assertNoLocalPaths(value: unknown, where: string): void {
  const hits: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (typeof v === "string") {
      if (LOCAL_PATH.test(v)) hits.push(`${at}: ${v.slice(0, 120)}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(value, where);
  if (hits.length) throw new Error(`Refusing to export local paths:\n  ${hits.slice(0, 10).join("\n  ")}`);
}

/**
 * Kane caps its summary at 500 characters, often mid-word. Cut back to the last whole word and
 * mark the cut, rather than to the last sentence, which would drop the whole `evidence:` line.
 */
export function tidySummary(s: string | null | undefined): string | null | undefined {
  if (!s || s.length < 500 || /[.!?)"]\s*$/.test(s)) return s;
  const space = s.search(/\s\S*$/);
  return `${(space > 0 ? s.slice(0, space) : s).replace(/[\s,;:("'“]+$/, "")} …`;
}

function tidyKane<T extends { summary?: string | null }>(k: T): T {
  return k && "summary" in k ? { ...k, summary: tidySummary(k.summary) } : k;
}

function tidyRun(r: RunRecord): RunRecord {
  return {
    ...r,
    baseline: r.baseline.map(tidyKane),
    referee: r.referee ? { ...r.referee, kane: tidyKane(r.referee.kane) } : r.referee,
    rounds: r.rounds.map((h) => ({ ...h, verify: h.verify.map(tidyKane) })),
  };
}

/** A caption per exported screenshot, from Kane's step.json next to it: "Step 14 · PASS · Click Apply". */
function screenshotCaptions(runDir: string, r: RunRecord): Record<string, string> {
  const out: Record<string, string> = {};
  const kanes = [...r.baseline, ...(r.referee ? [r.referee.kane] : []), ...r.rounds.flatMap((h) => h.verify)];
  for (const k of kanes) {
    for (const shot of k.screenshots.slice(-6)) {
      const meta = join(runDir, dirname(shot), "step.json");
      if (!existsSync(meta)) continue;
      try {
        const m = JSON.parse(readFileSync(meta, "utf8")) as Record<string, unknown>;
        const n = typeof m.ordinal === "number" ? m.ordinal : Number(/(\d+)-\d+-\d+$/.exec(dirname(shot))?.[1] ?? NaN);
        const parts = [Number.isFinite(n) ? `Step ${n}` : "Step", typeof m.status === "string" ? m.status.toUpperCase() : "", typeof m.summary === "string" ? m.summary : ""];
        out[shot] = parts.filter(Boolean).join(" · ");
      } catch {
        /* no caption */
      }
    }
  }
  return out;
}

function referencedFiles(r: RunRecord): string[] {
  const files = new Set<string>();
  const add = (p: string | null | undefined) => p && files.add(p);
  const kanes = [...r.baseline, ...(r.referee ? [r.referee.kane] : []), ...(r.specAgent?.kane ? [r.specAgent.kane] : []), ...r.rounds.flatMap((h) => h.verify)];
  for (const k of kanes) {
    add(k.video);
    for (const shot of k.screenshots.slice(-6)) {
      add(shot);
      add(join(dirname(shot), "step.json").replace(/\\/g, "/")); // the screenshot's caption source
    }
  }
  for (const h of r.rounds) {
    add(h.diff);
    add(h.prompt);
  }
  if (r.chaosDiff) add(r.chaosDiff);
  return [...files];
}

/**
 * Bundle finished runs as a slim state dir (`<outDir>/runs/<id>/…`) that `hydra demo` and
 * `hydra replay --state` can serve. Keeps the ledger, events and only the evidence the arena
 * shows; drops build workspaces, snapshots and full Kane packs.
 */
export function packRecording(stateDir: string, outDir: string, runIds: string[]): { runs: number; files: number } {
  const runs = listRuns(stateDir).filter((r) => runIds.includes(r.runId));
  const missing = runIds.filter((id) => !runs.some((r) => r.runId === id));
  if (missing.length) throw new Error(`Unknown or unfinished run(s): ${missing.join(", ")}`);
  let fileCount = 0;
  for (const r of runs) {
    if (r.status === "running") throw new Error(`Run ${r.runId} is still running`);
    const src = join(stateDir, "runs", r.runId);
    const dest = join(outDir, "runs", r.runId);
    removeTree(dest);
    ensureDir(dest);
    // demo/ is committed to a public repo: same path scrub as the static export.
    const roots = [resolve(stateDir, ".."), resolve(stateDir), process.cwd()];
    const run = scrubPaths(withSurface(r), roots);
    const events = scrubPaths(readEvents(src), roots);
    assertNoLocalPaths(run, `${r.runId}/run.json`);
    assertNoLocalPaths(events, `${r.runId}/events.jsonl`);
    writeJsonAtomic(join(dest, "run.json"), run);
    writeFileSync(join(dest, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    for (const rel of referencedFiles(r)) {
      const from = join(src, rel);
      if (!existsSync(from)) continue;
      const to = join(dest, rel);
      ensureDir(dirname(to));
      copyFileSync(from, to);
      fileCount++;
    }
  }
  return { runs: runs.length, files: fileCount };
}

/** Kane's measured detection over the whole chaos library (`hydra chaos calibrate`), if it was run. */
function calibrationSummary(): { caught: number; total: number } | null {
  const file = resolve("chaos", "calibration.json");
  if (!existsSync(file)) return null;
  try {
    const rows = (JSON.parse(readFileSync(file, "utf8")) as { rows?: Array<{ kane?: string }> }).rows ?? [];
    return rows.length ? { caught: rows.filter((r) => r.kane === "caught").length, total: rows.length } : null;
  } catch {
    return null;
  }
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
  const roots = [resolve(stateDir, ".."), resolve(stateDir), process.cwd()];
  for (const r of runs) {
    const src = join(stateDir, "runs", r.runId);
    const dest = ensureDir(join(outDir, "data", "runs", r.runId));
    const run = scrubPaths({ ...tidyRun(withSurface(r)), captions: screenshotCaptions(src, r) }, roots);
    const events = scrubPaths(
      readEvents(src).map((ev) => (ev.type === "kane_end" ? tidyKane(ev as { summary?: string | null }) : ev)),
      roots,
    );
    assertNoLocalPaths(run, `${r.runId}/run.json`);
    assertNoLocalPaths(events, `${r.runId}/events.json`);
    writeJsonAtomic(join(dest, "run.json"), run);
    writeJsonAtomic(join(dest, "events.json"), events);
    for (const rel of referencedFiles(r)) {
      if (rel.endsWith("step.json")) continue; // already folded into run.json captions
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
      bug: r.bug ? { id: r.bug.id, bugClass: r.bug.bugClass, surface: bugSurface(r.bug) } : null,
      verdict: r.referee?.verdict ?? null,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      rounds: r.rounds.length,
      holdoutFailures: r.metrics?.holdoutFailures ?? 0,
    })),
    calibration: calibrationSummary(),
  });
  writeFileSync(join(outDir, ".nojekyll"), "");
  return { runs: runs.length, files: fileCount };
}
