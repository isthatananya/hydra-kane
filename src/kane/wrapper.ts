import { existsSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { HydraConfig } from "../config.js";
import type { Spec } from "../spec.js";
import { copyTree, ensureDir, relPosix, walkFiles, writeJsonAtomic } from "../util/fs.js";
import { exec, isWindows, which } from "../util/proc.js";
import { extractZip } from "../util/zip.js";
import { extractEvidence, type KaneEvent } from "./events.js";

/** Kane's documented exit codes, plus 3 (cancel/timeout) which kane-cli 0.10 emits. */
export const KANE_EXIT = { PASSED: 0, FAILED: 1, ERROR: 2, CANCELLED: 3 } as const;

export type KaneVerdict = "passed" | "failed" | "error" | "timeout";

export type KaneResult = {
  verdict: KaneVerdict;
  exitCode: number | null;
  /** Human-readable reason when verdict is error/timeout. */
  infraReason: string | null;
  summary: string | null;
  failingStep: { index: number | null; description: string | null; reason: string | null } | null;
  /** Dashboard ShareLink from run_end (expires after ~7 days, hence the local evidence copy). */
  testUrl: string | null;
  /** Kane's own run directory (outside Hydra). */
  kaneRunDir: string | null;
  /** Local, permanent copy of the evidence. */
  evidenceDir: string;
  video: string | null;
  screenshots: string[];
  logs: { console: string[]; network: string[]; commands: string[]; other: string[] };
  extracted: unknown;
  credits: number | null;
  durationMs: number;
  eventCount: number;
  runEnd: Record<string, unknown> | null;
  command: string[];
  /** True when Kane authored the run from scratch (no cached replay). Always true for `kane-cli run`. */
  fresh: boolean;
};

let cachedEntry: { command: string; prefix: string[] } | null = null;

/** Resolve how to launch kane-cli without going through a .cmd shim (which mangles multi-line args on Windows). */
export function resolveKane(cfg: HydraConfig): { command: string; prefix: string[] } {
  if (cachedEntry) return cachedEntry;
  const configured = cfg.kane.bin;
  if (configured && configured !== "auto") {
    const p = resolve(cfg.root, configured);
    cachedEntry = /\.(c?js|mjs)$/.test(p) ? { command: process.execPath, prefix: [p] } : { command: p, prefix: [] };
    return cachedEntry;
  }
  const candidates: string[] = [];
  // On Windows npm is a .cmd shim and needs a shell; pass one command string (args + shell is deprecated, DEP0190).
  const npmRoot = isWindows
    ? spawnSync("npm root -g", { encoding: "utf8", shell: true, windowsHide: true })
    : spawnSync("npm", ["root", "-g"], { encoding: "utf8", windowsHide: true });
  if (npmRoot.status === 0 && npmRoot.stdout.trim()) {
    candidates.push(join(npmRoot.stdout.trim(), "@testmuai", "kane-cli", "bin", "kane-cli.cjs"));
  }
  const onPath = which("kane-cli");
  if (onPath) {
    candidates.push(join(dirname(onPath), "node_modules", "@testmuai", "kane-cli", "bin", "kane-cli.cjs"));
    candidates.push(join(dirname(onPath), "..", "lib", "node_modules", "@testmuai", "kane-cli", "bin", "kane-cli.cjs"));
  }
  const entry = candidates.find((c) => existsSync(c));
  if (entry) {
    cachedEntry = { command: process.execPath, prefix: [entry] };
    return cachedEntry;
  }
  if (onPath && !isWindows) {
    cachedEntry = { command: onPath, prefix: [] };
    return cachedEntry;
  }
  throw new Error("kane-cli not found. Install it with: npm install -g @testmuai/kane-cli, then run: kane-cli login");
}

export type RunKaneOptions = {
  spec: Spec;
  url: string;
  /** Directory that receives this run's local evidence copy. */
  outDir: string;
  label: string;
  timeoutSec?: number;
  onEvent?: (ev: KaneEvent) => void;
};

function credentialArgs(): string[] {
  const user = process.env.LT_USERNAME ?? process.env.KANE_USERNAME;
  const key = process.env.LT_ACCESS_KEY ?? process.env.KANE_ACCESS_KEY;
  return user && key ? ["--username", user, "--access-key", key] : [];
}

function redact(args: string[]): string[] {
  const out = [...args];
  for (let i = 0; i < out.length; i++) if (out[i] === "--access-key" && i + 1 < out.length) out[i + 1] = "***";
  return out;
}

export async function runKane(cfg: HydraConfig, opts: RunKaneOptions): Promise<KaneResult> {
  const { command, prefix } = resolveKane(cfg);
  const outDir = ensureDir(opts.outDir);
  // Kane writes evidence packs and reads local context relative to its cwd; give each run its own.
  const cwd = ensureDir(join(outDir, "cwd"));
  const timeoutSec = opts.timeoutSec ?? cfg.kane.timeoutSec;
  const args = [
    ...prefix,
    "run",
    opts.spec.objective,
    "--url",
    opts.url,
    "--headless",
    "--agent",
    "--timeout",
    String(timeoutSec),
    "--max-steps",
    String(cfg.kane.maxSteps),
    ...cfg.kane.extraArgs,
    ...credentialArgs(),
  ];

  const ndjsonPath = join(outDir, "kane.ndjson");
  const stderrPath = join(outDir, "kane.stderr.log");
  writeFileSync(ndjsonPath, "");
  const events: KaneEvent[] = [];
  const res = await exec(command, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    // Kane enforces --timeout itself; this outer guard only catches a wedged process.
    timeoutMs: (timeoutSec + 120) * 1000,
    onStdoutLine: (line) => {
      appendFileSync(ndjsonPath, line + "\n");
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const ev = JSON.parse(trimmed) as KaneEvent;
        events.push(ev);
        opts.onEvent?.(ev);
      } catch {
        /* non-JSON noise */
      }
    },
  });
  writeFileSync(stderrPath, res.stderr);

  const evidence = extractEvidence(events);
  const runEnd = evidence.runEnd;
  const exitCode = res.timedOut ? null : res.code;

  let verdict: KaneVerdict;
  let infraReason: string | null = null;
  if (res.timedOut) {
    verdict = "timeout";
    infraReason = `kane-cli did not exit within ${timeoutSec + 120}s and was killed`;
  } else if (exitCode === KANE_EXIT.CANCELLED) {
    verdict = "timeout";
    infraReason = String(runEnd?.reason ?? "Kane reported cancel/timeout (exit 3)");
  } else if (exitCode === KANE_EXIT.PASSED && runEnd?.status === "passed") {
    verdict = "passed";
  } else if (exitCode === KANE_EXIT.FAILED && runEnd && runEnd.status === "failed") {
    verdict = "failed";
  } else if (exitCode === KANE_EXIT.FAILED && !runEnd) {
    // kane-cli exits 1 with "Run ended with no result" when the runner dies; that is infra, not a verdict.
    verdict = "error";
    infraReason = "Kane exited 1 without a run_end event (no verdict)";
  } else if (exitCode === KANE_EXIT.ERROR) {
    verdict = "error";
    infraReason = firstLine(evidence.errorMessage) ?? firstLine(res.stderr) ?? "Kane exit 2 (CLI error, e.g. auth)";
  } else {
    verdict = "error";
    infraReason = `Unexpected Kane outcome: exit=${String(exitCode)} run_end.status=${String(runEnd?.status ?? "none")}`;
  }

  const local = archiveEvidence(cwd, outDir, evidence.kaneRunDirs);

  const result: KaneResult = {
    verdict,
    exitCode,
    infraReason,
    summary: evidence.summary,
    failingStep: evidence.failingStep,
    testUrl: evidence.testUrl,
    kaneRunDir: evidence.kaneRunDirs[0] ?? null,
    evidenceDir: outDir,
    video: local.video,
    screenshots: local.screenshots,
    logs: local.logs,
    extracted: evidence.extracted,
    credits: evidence.credits,
    durationMs: res.durationMs,
    eventCount: events.length,
    runEnd,
    command: [command === process.execPath ? "node" : command, ...redact(args)],
    fresh: true,
  };
  writeJsonAtomic(join(outDir, "result.json"), result);
  return result;
}

function firstLine(s: string | null | undefined): string | null {
  if (!s) return null;
  const line = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, 500) : null;
}

const VIDEO_EXT = new Set([".webm", ".mp4", ".mov"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * Copy everything Kane produced into the local evidence folder. ShareLinks expire, so the
 * local copy is the permanent record (and what replay mode serves).
 */
function archiveEvidence(
  kaneCwd: string,
  outDir: string,
  kaneRunDirs: string[],
): { video: string | null; screenshots: string[]; logs: KaneResult["logs"] } {
  const packDest = join(outDir, "pack");
  const sources: Array<{ src: string; dest: string }> = [];
  const packRoot = join(kaneCwd, ".testmuai", "evidence");
  if (existsSync(packRoot)) sources.push({ src: packRoot, dest: join(packDest, "evidence") });
  kaneRunDirs.forEach((dir, i) => {
    if (dir && existsSync(dir) && statSync(dir).isDirectory()) sources.push({ src: dir, dest: join(packDest, `run-${i}`) });
  });
  for (const { src, dest } of sources) {
    try {
      copyTree(src, dest, { exclude: (rel) => rel.endsWith(".lock") });
    } catch {
      /* evidence copy is best-effort; the result still records the ShareLink */
    }
  }

  // Kane packs screenshots, HAR, console/action logs and step JSON into `.evidence` zips.
  // Unpack each next to itself (`<name>.evidence` -> `<name>/`) so replay can serve them.
  if (existsSync(packDest)) {
    for (const f of walkFiles(packDest)) {
      if (!f.endsWith(".evidence")) continue;
      try {
        extractZip(join(packDest, f), join(packDest, f.slice(0, -".evidence".length)));
      } catch {
        /* a corrupt pack still leaves the zip itself and the ShareLink */
      }
    }
  }

  const files = existsSync(packDest) ? walkFiles(packDest) : [];
  const rel = (f: string) => relPosix(outDir, join(packDest, f));
  const largest = (list: string[]) =>
    list.sort((a, b) => statSync(join(packDest, b)).size - statSync(join(packDest, a)).size)[0] ?? null;

  const videos = files.filter((f) => VIDEO_EXT.has(extname(f).toLowerCase()));
  // One image per step folder, preferring Kane's annotated frame (it marks the element acted on).
  const byDir = new Map<string, string>();
  for (const f of files.filter((x) => IMAGE_EXT.has(extname(x).toLowerCase()))) {
    const d = dirname(f);
    const prev = byDir.get(d);
    if (!prev || (/annotated/i.test(f) && !/annotated/i.test(prev))) byDir.set(d, f);
  }
  const shots = [...byDir.values()];
  const textLogs = files.filter((f) => /\.(log|ndjson|jsonl|json|txt|har)$/i.test(f));
  const logs: KaneResult["logs"] = { console: [], network: [], commands: [], other: [] };
  for (const f of textLogs) {
    const lower = f.toLowerCase();
    if (lower.includes("console")) logs.console.push(rel(f));
    else if (lower.includes("network") || lower.endsWith(".har")) logs.network.push(rel(f));
    else if (lower.includes("command") || lower.includes("action")) logs.commands.push(rel(f));
    else logs.other.push(rel(f));
  }
  const video = largest(videos);
  return {
    video: video ? rel(video) : null,
    screenshots: shots.sort(naturalCompare).map(rel),
    logs,
  };
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** True when the CLI can authenticate (stored login or env credentials). */
export function kaneAuthStatus(cfg: HydraConfig): { ok: boolean; detail: string } {
  if (credentialArgs().length) return { ok: true, detail: "credentials from LT_USERNAME / LT_ACCESS_KEY" };
  try {
    const { command, prefix } = resolveKane(cfg);
    const r = spawnSync(command, [...prefix, "whoami"], { encoding: "utf8", windowsHide: true, env: { ...process.env, NO_COLOR: "1" } });
    const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (/not logged in/i.test(text) || /Token\s+missing/i.test(text)) return { ok: false, detail: "kane-cli is not logged in" };
    return { ok: r.status === 0, detail: r.status === 0 ? "logged in" : firstLine(text) ?? "kane-cli whoami failed" };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

export function listDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
