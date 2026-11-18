import { chmodSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { hashFile, sha256 } from "./util/fs.js";

export type Spec = {
  id: string;
  title: string;
  role: string;
  path: string;
  /** The natural-language objective handed verbatim to Kane. */
  objective: string;
  hash: string;
};

/** Parse a `*.flow.md` spec: optional `---` frontmatter (key: value), body is the Kane objective. */
export function parseSpec(path: string): Spec {
  if (!existsSync(path)) throw new Error(`Spec not found: ${path}`);
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const meta: Record<string, string> = {};
  let body = text;
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    for (const line of fm[1]!.split("\n")) {
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
      if (m) meta[m[1]!] = m[2]!.trim();
    }
    body = text.slice(fm[0].length);
  }
  const objective = body.trim();
  if (!objective) throw new Error(`Spec ${path} has an empty objective`);
  return {
    id: meta.id ?? basename(path).replace(/\.(flow\.)?md$/, ""),
    title: meta.title ?? basename(path),
    role: meta.role ?? "main",
    path,
    objective,
    hash: sha256(readFileSync(path)),
  };
}

export type SpecLock = { path: string; hash: string; backup: string };

/**
 * Lock a spec for the duration of a run: record its hash, keep a pristine backup outside
 * the builder's reach, and mark the file read-only. Read-only is a speed bump; the hash
 * check after every patch is the actual guarantee.
 */
export function lockSpec(path: string, backupPath: string): SpecLock {
  copyFileSync(path, backupPath);
  chmodSync(backupPath, 0o444);
  const hash = hashFile(path);
  try {
    chmodSync(path, 0o444);
  } catch {
    /* best effort */
  }
  return { path, hash, backup: backupPath };
}

export type IntegrityResult = { ok: true } | { ok: false; path: string; expected: string; actual: string | null };

export function checkSpec(lock: SpecLock): IntegrityResult {
  const actual = existsSync(lock.path) ? hashFile(lock.path) : null;
  return actual === lock.hash ? { ok: true } : { ok: false, path: lock.path, expected: lock.hash, actual };
}

/** Put the pristine spec back after tampering was detected. */
export function restoreSpec(lock: SpecLock): void {
  try {
    chmodSync(lock.path, 0o644);
  } catch {
    /* may not exist */
  }
  copyFileSync(lock.backup, lock.path);
  chmodSync(lock.path, 0o444);
}

export function unlockSpec(lock: SpecLock): void {
  try {
    chmodSync(lock.path, 0o644);
  } catch {
    /* ignore */
  }
}
