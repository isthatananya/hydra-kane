import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import picomatch from "picomatch";
import { createTwoFilesPatch } from "diff";
import { ensureDir, manifest, removeTree, walkFiles } from "./util/fs.js";
import { exec } from "./util/proc.js";

/** Never part of a builder diff: build output, deps, VCS metadata, Hydra's evidence drop. */
const IGNORED_DIRS = new Set([".next", "node_modules", ".git", ".hydra-evidence", ".turbo"]);
const IGNORED_FILES = new Set(["next-env.d.ts", "tsconfig.tsbuildinfo"]);

export function workspaceExclude(rel: string, isDir: boolean): boolean {
  const top = rel.split("/")[0]!;
  if (IGNORED_DIRS.has(top)) return true;
  if (!isDir && IGNORED_FILES.has(rel)) return true;
  return false;
}

export type Snapshot = { dir: string; files: Map<string, string> };

/** Copy the workspace's source (not build output) somewhere the builder cannot reach. */
export function takeSnapshot(workspace: string, snapshotDir: string): Snapshot {
  removeTree(snapshotDir);
  ensureDir(snapshotDir);
  for (const rel of walkFiles(workspace, { exclude: workspaceExclude })) {
    const dest = join(snapshotDir, rel);
    ensureDir(dirname(dest));
    copyFileSync(join(workspace, rel), dest);
  }
  return { dir: snapshotDir, files: manifest(snapshotDir) };
}

export type FileChange = { path: string; kind: "added" | "modified" | "deleted"; allowed: boolean };
export type DiffResult = { changes: FileChange[]; patch: string; violations: FileChange[] };

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

export function diffAgainstSnapshot(snapshot: Snapshot, workspace: string, allowlist: string[]): DiffResult {
  const isAllowed = picomatch(allowlist, { dot: true });
  const after = manifest(workspace, { exclude: workspaceExclude });
  const changes: FileChange[] = [];
  for (const [path, hash] of after) {
    const before = snapshot.files.get(path);
    if (before === undefined) changes.push({ path, kind: "added", allowed: isAllowed(path) });
    else if (before !== hash) changes.push({ path, kind: "modified", allowed: isAllowed(path) });
  }
  for (const path of snapshot.files.keys()) {
    if (!after.has(path)) changes.push({ path, kind: "deleted", allowed: isAllowed(path) });
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));

  let patch = "";
  for (const ch of changes) {
    const beforeBuf = ch.kind === "added" ? Buffer.alloc(0) : readFileSync(join(snapshot.dir, ch.path));
    const afterBuf = ch.kind === "deleted" ? Buffer.alloc(0) : readFileSync(join(workspace, ch.path));
    if (isBinary(beforeBuf) || isBinary(afterBuf)) {
      patch += `Binary file ${ch.path} ${ch.kind}\n`;
      continue;
    }
    patch += createTwoFilesPatch(
      ch.kind === "added" ? "/dev/null" : `a/${ch.path}`,
      ch.kind === "deleted" ? "/dev/null" : `b/${ch.path}`,
      beforeBuf.toString("utf8").replace(/\r\n/g, "\n"),
      afterBuf.toString("utf8").replace(/\r\n/g, "\n"),
      "",
      "",
      { context: 3 },
    );
  }
  return { changes, patch, violations: changes.filter((c) => !c.allowed) };
}

/** Undo changes the builder was not allowed to make, restoring them from the snapshot. */
export function revertChanges(snapshot: Snapshot, workspace: string, changes: FileChange[]): void {
  for (const ch of changes) {
    const target = join(workspace, ch.path);
    if (ch.kind === "added") {
      rmSync(target, { force: true });
    } else {
      ensureDir(dirname(target));
      copyFileSync(join(snapshot.dir, ch.path), target);
    }
  }
}

/**
 * Replace the workspace's git history with a single commit of the current tree, so there is
 * never a pre-chaos commit for a builder to revert to. Many coding agents expect a git repo.
 */
export async function squashHistory(workspace: string, message: string): Promise<void> {
  removeTree(join(workspace, ".git"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "hydra",
    GIT_AUTHOR_EMAIL: "hydra@localhost",
    GIT_COMMITTER_NAME: "hydra",
    GIT_COMMITTER_EMAIL: "hydra@localhost",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
  const git = (args: string[]) => exec("git", args, { cwd: workspace, env, timeoutMs: 60000 });
  const init = await git(["init", "-q", "-b", "main"]);
  if (init.code !== 0) throw new Error(`git init failed in workspace: ${init.stderr}`);
  await git(["config", "core.autocrlf", "false"]);
  await git(["config", "commit.gpgsign", "false"]);
  await git(["add", "-A"]);
  const commit = await git(["commit", "-q", "--no-verify", "-m", message]);
  if (commit.code !== 0) throw new Error(`git commit failed in workspace: ${commit.stderr}`);
}

/** Count commits; anything other than 1 after a squash means history leaked. */
export async function commitCount(workspace: string): Promise<number> {
  if (!existsSync(join(workspace, ".git"))) return 0;
  const r = await exec("git", ["rev-list", "--count", "HEAD"], { cwd: workspace, timeoutMs: 30000 });
  return r.code === 0 ? Number(r.stdout.trim()) : 0;
}

export const WORKSPACE_GITIGNORE = [".next/", "node_modules/", ".hydra-evidence/", "next-env.d.ts", ""].join("\n");
