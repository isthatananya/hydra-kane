/**
 * `hydra verify`: one Kane pass/fail over the configured specs against a running app.
 * Used directly, by the MCP tool, by the GitHub Action, and as a Claude Code Stop hook
 * (so a coding agent cannot finish until a real browser agrees).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePath, stateDir, type HydraConfig } from "./config.js";
import { runKane, type KaneResult } from "./kane/wrapper.js";
import { parseSpec } from "./spec.js";
import { ensureDir, readJsonOr, writeJsonAtomic } from "./util/fs.js";

export type VerifyReport = {
  ok: boolean;
  /** "passed" | "failed" | "error" (infra: auth, timeout, app unreachable). */
  outcome: "passed" | "failed" | "error";
  url: string;
  results: Array<{ spec: string; verdict: KaneResult["verdict"]; exitCode: number | null; summary: string | null; failingStep: KaneResult["failingStep"]; testUrl: string | null; evidenceDir: string; video: string | null; infraReason: string | null }>;
  outDir: string;
};

export function verifyUrl(cfg: HydraConfig, override?: string): string {
  return override ?? cfg.verify.url ?? `http://localhost:${cfg.app.port}`;
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function verify(cfg: HydraConfig, opts: { specs?: string[]; url?: string; outDir?: string; resetPath?: string | null } = {}): Promise<VerifyReport> {
  const url = verifyUrl(cfg, opts.url);
  const specPaths = (opts.specs?.length ? opts.specs : cfg.verify.specs).map((p) => resolvePath(cfg, p));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = ensureDir(opts.outDir ?? join(stateDir(cfg), "verify", stamp));
  const report: VerifyReport = { ok: false, outcome: "error", url, results: [], outDir };

  if (!(await reachable(url))) {
    report.results.push({ spec: "-", verdict: "error", exitCode: null, summary: null, failingStep: null, testUrl: null, evidenceDir: outDir, video: null, infraReason: `App is not reachable at ${url}` });
    writeJsonAtomic(join(outDir, "report.json"), report);
    return report;
  }

  let anyFailed = false;
  let anyError = false;
  for (const [i, path] of specPaths.entries()) {
    const spec = parseSpec(path);
    const reset = opts.resetPath === undefined ? cfg.verify.resetPath : opts.resetPath;
    if (reset) await fetch(new URL(reset, url), { method: "POST" }).catch(() => undefined);
    let result: KaneResult | null = null;
    for (let attempt = 0; attempt <= cfg.kane.retries; attempt++) {
      result = await runKane(cfg, { spec, url, outDir: join(outDir, `${i + 1}-${spec.id}${attempt ? `-retry${attempt}` : ""}`), label: spec.id });
      if (result.verdict === "passed" || result.verdict === "failed") break;
    }
    const r = result!;
    if (r.verdict === "failed") anyFailed = true;
    if (r.verdict === "error" || r.verdict === "timeout") anyError = true;
    report.results.push({
      spec: path,
      verdict: r.verdict,
      exitCode: r.exitCode,
      summary: r.summary,
      failingStep: r.failingStep,
      testUrl: r.testUrl,
      evidenceDir: r.evidenceDir,
      video: r.video ? join(r.evidenceDir, r.video) : null,
      infraReason: r.infraReason,
    });
  }
  report.outcome = anyFailed ? "failed" : anyError ? "error" : "passed";
  report.ok = report.outcome === "passed";
  writeJsonAtomic(join(outDir, "report.json"), report);
  return report;
}

export function formatReport(report: VerifyReport): string {
  const lines = [`Hydra verify (${report.url}): ${report.outcome.toUpperCase()}`];
  for (const r of report.results) {
    lines.push(`- ${r.spec}: ${r.verdict}${r.exitCode !== null ? ` (Kane exit ${r.exitCode})` : ""}`);
    if (r.summary) lines.push(`  summary: ${r.summary}`);
    if (r.failingStep) lines.push(`  failing step: ${r.failingStep.index ?? "?"} ${r.failingStep.description ?? ""}${r.failingStep.reason ? ` — ${r.failingStep.reason}` : ""}`);
    if (r.testUrl) lines.push(`  ShareLink: ${r.testUrl}`);
    if (r.video) lines.push(`  video: ${r.video}`);
    if (r.infraReason) lines.push(`  infra: ${r.infraReason}`);
  }
  lines.push(`evidence: ${report.outDir}`);
  return lines.join("\n");
}

const HOOK_MAX_BLOCKS = 3;

/**
 * Claude Code Stop hook. Exit 2 + stderr blocks the stop and hands Kane's evidence to the
 * agent. Infra problems and repeated failures never trap the agent: they exit 0.
 */
export async function runStopHook(cfg: HydraConfig): Promise<number> {
  let input: { session_id?: string; stop_hook_active?: boolean } = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    /* no stdin */
  }
  const statePath = join(ensureDir(stateDir(cfg)), "hook-state.json");
  const hookState = readJsonOr<Record<string, number>>(statePath, {});
  const key = input.session_id ?? "default";
  const blocks = hookState[key] ?? 0;
  if (blocks >= HOOK_MAX_BLOCKS) {
    process.stderr.write(`Hydra: Kane still failing after ${HOOK_MAX_BLOCKS} attempts; allowing stop. Re-run \`hydra verify\` to check.\n`);
    delete hookState[key];
    writeJsonAtomic(statePath, hookState);
    return 0;
  }
  const report = await verify(cfg);
  if (report.outcome === "failed") {
    hookState[key] = blocks + 1;
    writeJsonAtomic(statePath, hookState);
    process.stderr.write(
      `Kane CLI (real browser) says the app is NOT working yet. You cannot finish until it passes.\n\n${formatReport(report)}\n\n` +
        "Fix the root cause in the app (do not edit the Kane spec files), then stop again to re-verify.\n",
    );
    return 2;
  }
  delete hookState[key];
  writeJsonAtomic(statePath, hookState);
  if (report.outcome === "error") {
    process.stderr.write(`Hydra: Kane could not verify (${report.results.map((r) => r.infraReason).filter(Boolean).join("; ")}); not blocking.\n`);
  }
  return 0;
}
