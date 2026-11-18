import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function readJsonOr<T>(file: string, fallback: T): T {
  try {
    return readJson<T>(file);
  } catch {
    return fallback;
  }
}

/** Write JSON atomically (temp file + rename) so readers never see a torn file. */
export function writeJsonAtomic(file: string, data: unknown): void {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      // Windows can briefly lock a file that a reader has open; retry a few times.
      if (attempt >= 10) throw err;
      const until = Date.now() + 25 * (attempt + 1);
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashFile(file: string): string {
  return sha256(readFileSync(file));
}

/** Forward-slash relative path, stable across platforms. */
export function relPosix(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

export type WalkOptions = { exclude?: (relPath: string, isDir: boolean) => boolean };

/** Recursively list files (relative, posix-style). */
export function walkFiles(root: string, opts: WalkOptions = {}): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relPosix(root, abs);
      const isDir = entry.isDirectory();
      if (opts.exclude?.(rel, isDir)) continue;
      if (isDir) visit(abs);
      else if (entry.isFile()) out.push(rel);
    }
  };
  visit(root);
  return out.sort();
}

export function copyTree(src: string, dest: string, opts: WalkOptions = {}): number {
  const files = walkFiles(src, opts);
  for (const rel of files) {
    const target = join(dest, rel);
    ensureDir(dirname(target));
    copyFileSync(join(src, rel), target);
  }
  return files.length;
}

/** Map of relative path -> sha256 for a directory tree. */
export function manifest(root: string, opts: WalkOptions = {}): Map<string, string> {
  const m = new Map<string, string>();
  for (const rel of walkFiles(root, opts)) m.set(rel, hashFile(join(root, rel)));
  return m;
}

export function removeTree(path: string): void {
  if (!existsSync(path)) return;
  // Clear read-only bits first: git object files are read-only on Windows.
  const clear = (p: string) => {
    try {
      const st = statSync(p);
      chmodSync(p, st.isDirectory() ? 0o755 : 0o644);
      if (st.isDirectory()) for (const e of readdirSync(p)) clear(join(p, e));
    } catch {
      /* ignore */
    }
  };
  clear(path);
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function tail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `…${text.slice(text.length - maxChars)}`;
}
