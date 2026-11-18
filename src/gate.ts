/**
 * FR7 deploy gate. There is deliberately no override flag: promotion requires two fresh main
 * passes and a holdout pass against the exact source being promoted, with specs intact.
 */
import { join } from "node:path";
import type { HydraConfig } from "./config.js";
import type { KaneResult } from "./kane/wrapper.js";
import { checkSpec, type SpecLock } from "./spec.js";
import { workspaceExclude } from "./anticheat.js";
import { copyTree, ensureDir, manifest, removeTree, sha256, writeJsonAtomic } from "./util/fs.js";
import { exec } from "./util/proc.js";

export type GateInput = {
  mainPasses: KaneResult[];
  holdout: KaneResult | null;
  extraPasses: KaneResult[];
  specLocks: SpecLock[];
  /** Source hash captured right before VERIFY started. */
  verifiedSourceHash: string;
  workspace: string;
};

export type GateDecision = { decision: "promote" | "reject"; reasons: string[] };

export function sourceHash(workspace: string): string {
  const m = manifest(workspace, { exclude: workspaceExclude });
  return sha256([...m].map(([p, h]) => `${p}\0${h}`).join("\n"));
}

export function evaluateGate(input: GateInput): GateDecision {
  const reasons: string[] = [];
  const fresh = input.mainPasses.filter((r) => r.verdict === "passed" && r.exitCode === 0 && r.fresh);
  if (fresh.length < 2) reasons.push(`needs 2 fresh main-spec passes, got ${fresh.length}`);
  if (!input.holdout || input.holdout.verdict !== "passed" || input.holdout.exitCode !== 0 || !input.holdout.fresh) {
    reasons.push("holdout flow did not pass");
  }
  for (const r of input.extraPasses) {
    if (r.verdict !== "passed") reasons.push("a generated spec did not pass");
  }
  for (const lock of input.specLocks) {
    const res = checkSpec(lock);
    if (!res.ok) reasons.push(`spec ${lock.path} was modified (hash mismatch)`);
  }
  const now = sourceHash(input.workspace);
  if (now !== input.verifiedSourceHash) reasons.push("source changed after verification");
  return reasons.length ? { decision: "reject", reasons } : { decision: "promote", reasons: ["2 fresh main passes", "holdout passed", "specs intact", "source unchanged since verify"] };
}

export type DeployResult = { dir: string; manifest: string; command: string | null; exitCode: number | null };

/** Promote verified source to a release directory and run the optional deploy command. */
export async function promote(
  cfg: HydraConfig,
  stateDir: string,
  info: { runId: string; workspace: string; testUrls: string[]; specHashes: Record<string, string>; bugId: string | null },
): Promise<DeployResult> {
  const releaseDir = join(stateDir, "deployments", info.runId);
  removeTree(releaseDir);
  const sourceDir = ensureDir(join(releaseDir, "source"));
  copyTree(info.workspace, sourceDir, { exclude: workspaceExclude });
  const manifestPath = join(releaseDir, "manifest.json");
  const m = {
    runId: info.runId,
    promotedAt: new Date().toISOString(),
    sourceHash: sourceHash(sourceDir),
    healedBug: info.bugId,
    verifiedBy: info.testUrls,
    specHashes: info.specHashes,
  };
  writeJsonAtomic(manifestPath, m);
  writeJsonAtomic(join(stateDir, "deployments", "current.json"), { ...m, dir: releaseDir });

  let exitCode: number | null = null;
  const command = cfg.deploy.command;
  if (command) {
    const res = await exec(command, [], {
      cwd: sourceDir,
      shell: true,
      timeoutMs: 15 * 60 * 1000,
      logFile: join(releaseDir, "deploy.log"),
      env: { ...process.env, HYDRA_DEPLOY_DIR: sourceDir, HYDRA_RUN_ID: info.runId },
    });
    exitCode = res.code;
  }
  return { dir: releaseDir, manifest: manifestPath, command, exitCode };
}
