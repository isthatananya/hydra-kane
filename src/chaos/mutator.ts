/**
 * FR3: LLM chaos mutator. It works in a scratch copy of the app (it sees the code, never the
 * Kane specs). A candidate bug is only used after it applies cleanly inside the allowlist,
 * builds, boots, and provably breaks at least one ground-truth check. Otherwise Hydra falls
 * back to the seeded patch library.
 */
import { copyFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HydraConfig } from "../config.js";
import { AppServer, buildApp } from "../app/server.js";
import { diffAgainstSnapshot, takeSnapshot, workspaceExclude } from "../anticheat.js";
import { copyTree, ensureDir, removeTree, sha256 } from "../util/fs.js";
import { exec } from "../util/proc.js";
import { runGroundTruth } from "./groundtruth.js";
import type { Bug, GroundTruthCheck } from "./taxonomy.js";

const PROMPT = (allowlist: string[]) => `You are the chaos agent in a resilience exercise for a Next.js checkout app (the current directory).

Introduce exactly ONE realistic, functional bug of the kind a developer could ship by accident:
a wrong calculation, an off-by-one, a state-update mistake, a broken handler, a server error on a
specific path, or a validation gap. It must change what a customer sees or is charged.

Rules:
- Edit only files matching: ${allowlist.join(", ")}.
- The app must still compile (TypeScript) and the home page must still load.
- Do not add comments, names or strings that reveal the bug.
- Keep the change small (one to five lines).
- When done, reply with a single line: BUG: <one-sentence description of what is now broken>.`;

export type MutationOutcome =
  | { ok: true; bug: Bug; diff: string; files: Array<{ path: string; deleted: boolean }>; scratch: string; failing: GroundTruthCheck[] }
  | { ok: false; reason: string };

function describe(stdout: string): string | null {
  // Claude Code json output: { result: "..." }; fall back to scanning plain text.
  try {
    const s = stdout.indexOf("{");
    const obj = JSON.parse(stdout.slice(s, stdout.lastIndexOf("}") + 1)) as { result?: string };
    const m = /BUG:\s*(.+)/.exec(obj.result ?? "");
    if (m) return m[1]!.trim();
  } catch {
    /* not json */
  }
  const m = /BUG:\s*(.+)/.exec(stdout);
  return m ? m[1]!.trim().slice(0, 400) : null;
}

export async function mutate(cfg: HydraConfig, baseWorkspace: string, scratchRoot: string, attempt: number): Promise<MutationOutcome> {
  const scratch = join(scratchRoot, `attempt-${attempt}`, "workspace");
  removeTree(dirname(scratch));
  ensureDir(scratch);
  copyTree(baseWorkspace, scratch, { exclude: workspaceExclude });
  const snap = takeSnapshot(scratch, join(scratchRoot, `attempt-${attempt}`, "snapshot"));
  const logFile = join(scratchRoot, `attempt-${attempt}`, "mutator.log");
  const prompt = PROMPT(cfg.allowlist);
  writeFileSync(join(scratchRoot, `attempt-${attempt}`, "prompt.md"), prompt);

  const m = cfg.chaos.mutator;
  const res = await exec(m.command, [], { cwd: scratch, shell: true, input: prompt, timeoutMs: m.timeoutSec * 1000, logFile, env: { ...process.env, CI: "1" } });
  if (res.timedOut) return { ok: false, reason: "mutator timed out" };
  if (res.code !== 0) return { ok: false, reason: `mutator exited ${res.code}` };

  const diff = diffAgainstSnapshot(snap, scratch, cfg.allowlist);
  if (diff.changes.length === 0) return { ok: false, reason: "mutator made no changes" };
  if (diff.violations.length) return { ok: false, reason: `mutator edited outside the allowlist: ${diff.violations.map((v) => v.path).join(", ")}` };

  // Validate: build, smoke, and prove it breaks something.
  const build = await buildApp(cfg, scratch, join(scratchRoot, `attempt-${attempt}`, "build.log"));
  if (!build.ok) return { ok: false, reason: "mutated app does not build" };
  const app = new AppServer(cfg);
  try {
    await app.start(scratch, join(scratchRoot, `attempt-${attempt}`, "app.log"));
    const home = await fetch(app.url, { signal: AbortSignal.timeout(10000) });
    if (!home.ok) return { ok: false, reason: `smoke failed: home page HTTP ${home.status}` };
    const gt = await runGroundTruth(app.url, () => app.reset());
    if (!gt.available) return { ok: false, reason: gt.reason ?? "ground truth unavailable" };
    if (gt.failing.length === 0) return { ok: false, reason: "mutation did not break any ground-truth check" };
    const description = describe(res.stdout) ?? "LLM-generated mutation";
    const id = `llm-${sha256(diff.patch).slice(0, 8)}`;
    return {
      ok: true,
      bug: {
        id,
        title: "LLM mutation",
        bugClass: "llm",
        description,
        edits: [],
        breaks: gt.failing,
        kaneHypothesis: gt.failing.includes("main") ? "caught" : "missed",
        rationale: `Ground truth failing: ${gt.failing.join(", ")}`,
      },
      diff: diff.patch,
      files: diff.changes.map((c) => ({ path: c.path, deleted: c.kind === "deleted" })),
      scratch,
      failing: gt.failing,
    };
  } catch (err) {
    return { ok: false, reason: `smoke failed: ${(err as Error).message}` };
  } finally {
    await app.stop();
  }
}

/** Copy the mutated files from the scratch workspace into the real workspace. */
export function adoptMutation(scratch: string, workspace: string, files: Array<{ path: string; deleted: boolean }>): void {
  for (const f of files) {
    const dest = join(workspace, f.path);
    if (f.deleted) {
      rmSync(dest, { force: true });
      continue;
    }
    ensureDir(dirname(dest));
    copyFileSync(join(scratch, f.path), dest);
  }
}
