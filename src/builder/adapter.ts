import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { BuilderConfig, HydraConfig, TokenParser } from "../config.js";
import type { KaneResult } from "../kane/wrapper.js";
import { ensureDir, removeTree, tail } from "../util/fs.js";
import { exec } from "../util/proc.js";

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; costUsd: number | null };

export type BuilderRun = {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  tokens: Tokens | null;
  logFile: string;
};

export type HealContext = {
  round: number;
  kane: KaneResult;
  /** Which flow failed. The holdout is hidden: only its verdict is revealed. */
  flow: "main" | "holdout";
  buildError?: string | null;
  allowlist: string[];
  reverted?: string[];
};

const MAX_LOG_EXCERPT = 2500;

function excerpt(file: string): string | null {
  try {
    const text = readFileSync(file, "utf8").trim();
    return text ? tail(text, MAX_LOG_EXCERPT) : null;
  } catch {
    return null;
  }
}

/**
 * Copy the evidence a builder needs into the workspace (agents are sandboxed to it) and
 * return workspace-relative paths. Excluded from diffs and the allowlist.
 */
function stageEvidence(workspace: string, round: number, kane: KaneResult): { screenshots: string[]; video: string | null; logs: Array<{ kind: string; path: string; abs: string }> } {
  const dropRel = `.hydra-evidence/round-${round}`;
  const drop = join(workspace, dropRel);
  removeTree(drop);
  ensureDir(drop);
  const stage = (relFromEvidence: string): { rel: string; abs: string } | null => {
    const src = join(kane.evidenceDir, relFromEvidence);
    if (!existsSync(src)) return null;
    const name = relFromEvidence.replace(/[\\/]/g, "_");
    copyFileSync(src, join(drop, name));
    return { rel: `${dropRel}/${name}`, abs: join(drop, name) };
  };
  // The last few screenshots show the failure state; earlier ones are mostly setup.
  const screenshots = kane.screenshots.slice(-4).map(stage).filter((x): x is { rel: string; abs: string } => x !== null).map((x) => x.rel);
  const video = kane.video ? stage(kane.video)?.rel ?? null : null;
  const logs: Array<{ kind: string; path: string; abs: string }> = [];
  for (const [kind, list] of Object.entries(kane.logs) as Array<[string, string[]]>) {
    for (const f of list.slice(0, 3)) {
      const staged = stage(f);
      if (staged) logs.push({ kind, path: staged.rel, abs: staged.abs });
    }
  }
  return { screenshots, video, logs };
}

/** FR4: the heal prompt carries Kane's evidence and nothing else about the bug. */
export function buildHealPrompt(workspace: string, ctx: HealContext): string {
  const { kane, round } = ctx;
  const lines: string[] = [];
  lines.push(`# Hydra heal request — round ${round}`);
  lines.push("");
  lines.push(
    "A real-browser verification of this web app (a Next.js checkout) failed. The verifier is Kane CLI. " +
      "The evidence below is the only information available about the failure.",
  );
  lines.push("");

  if (ctx.flow === "holdout") {
    lines.push("## Kane verdict");
    lines.push("- Flow: hidden holdout acceptance flow (its steps are intentionally not shown)");
    lines.push(`- Status: failed (Kane exit code ${kane.exitCode})`);
    lines.push("");
    lines.push(
      "Your previous change made the visible checkout flow pass, but an independent flow with different products, " +
        "quantities and coupon failed. Fix the underlying behaviour in general, not for specific values.",
    );
  } else {
    lines.push("## Kane verdict");
    lines.push(`- Status: failed (Kane exit code ${kane.exitCode})`);
    if (kane.summary) lines.push(`- Summary: ${kane.summary}`);
    if (kane.failingStep) {
      const fs = kane.failingStep;
      const label = fs.index !== null ? `step ${fs.index}` : "a step";
      lines.push(`- Failing step: ${label}${fs.description ? ` — ${fs.description}` : ""}`);
      if (fs.reason) lines.push(`- Failure reason: ${fs.reason}`);
    }
    if (kane.testUrl) lines.push(`- Kane run (ShareLink): ${kane.testUrl}`);
    if (kane.extracted && (typeof kane.extracted !== "object" || Object.keys(kane.extracted as object).length > 0)) {
      lines.push(`- Values Kane extracted: ${JSON.stringify(kane.extracted).slice(0, 800)}`);
    }

    const staged = stageEvidence(workspace, round, kane);
    if (staged.screenshots.length || staged.video || staged.logs.length) {
      lines.push("");
      lines.push("## Evidence files (paths relative to the current directory)");
      for (const s of staged.screenshots) lines.push(`- Screenshot: ${s}`);
      if (staged.video) lines.push(`- Video: ${staged.video}`);
      for (const l of staged.logs) lines.push(`- ${l.kind} log: ${l.path}`);
    }
    for (const l of staged.logs.filter((x) => x.kind === "console" || x.kind === "network")) {
      const text = excerpt(l.abs);
      if (!text) continue;
      lines.push("");
      lines.push(`### ${l.kind} log excerpt (${basename(l.path)})`);
      lines.push("```");
      lines.push(text);
      lines.push("```");
    }
  }

  if (ctx.buildError) {
    lines.push("");
    lines.push("## Your previous patch did not build");
    lines.push("```");
    lines.push(tail(ctx.buildError, 3000));
    lines.push("```");
  }
  if (ctx.reverted?.length) {
    lines.push("");
    lines.push(`## Reverted edits\nThese files are outside the editable area and your changes to them were undone: ${ctx.reverted.join(", ")}`);
  }

  lines.push("");
  lines.push("## Rules");
  lines.push("- Find and fix the root cause in the application source code.");
  lines.push("- Do not special-case, hardcode or detect the specific values, names or codes mentioned above.");
  lines.push(`- Only edit files matching: ${ctx.allowlist.join(", ")}. Changes anywhere else are reverted.`);
  lines.push("- The verification flows are not part of this workspace. Do not create or modify tests to make the check pass.");
  lines.push("- Do not install packages, start servers or run the app. Hydra rebuilds the app and re-runs Kane after you finish.");
  lines.push("- Keep the change minimal. When you are done, stop.");
  lines.push("");
  return lines.join("\n");
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}

function parseTokens(parser: TokenParser | undefined, stdout: string): Tokens | null {
  if (!parser || parser === "none") return null;
  const t: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: null };
  if (parser === "claude-json") {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
    const u = (obj.usage ?? {}) as Record<string, number>;
    t.input = Number(u.input_tokens ?? 0);
    t.output = Number(u.output_tokens ?? 0);
    t.cacheRead = Number(u.cache_read_input_tokens ?? 0);
    t.cacheWrite = Number(u.cache_creation_input_tokens ?? 0);
    t.costUsd = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : null;
  } else if (parser === "opencode-json") {
    let found = false;
    for (const line of stdout.split(/\r?\n/)) {
      const s = line.trim();
      if (!s.startsWith("{")) continue;
      let ev: unknown;
      try {
        ev = JSON.parse(s);
      } catch {
        continue;
      }
      // Sum token blocks from step-finish style events: { tokens: { input, output, cache: { read, write } }, cost }
      const visit = (node: unknown, depth: number): void => {
        if (!node || typeof node !== "object" || depth > 6) return;
        const o = node as Record<string, unknown>;
        const tok = o.tokens as Record<string, unknown> | undefined;
        if (tok && typeof tok === "object" && typeof tok.input === "number" && typeof tok.output === "number") {
          found = true;
          t.input += tok.input;
          t.output += tok.output;
          const cache = (tok.cache ?? {}) as Record<string, number>;
          t.cacheRead += Number(cache.read ?? 0);
          t.cacheWrite += Number(cache.write ?? 0);
          if (typeof o.cost === "number") t.costUsd = (t.costUsd ?? 0) + o.cost;
          return;
        }
        for (const v of Object.values(o)) visit(v, depth + 1);
      };
      visit(ev, 0);
    }
    if (!found) return null;
  }
  t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
  return t;
}

export function getBuilder(cfg: HydraConfig, name: string): BuilderConfig {
  const b = cfg.builders[name];
  if (!b) throw new Error(`Unknown builder "${name}". Defined builders: ${Object.keys(cfg.builders).join(", ")}`);
  return b;
}

export async function runBuilder(
  cfg: HydraConfig,
  name: string,
  opts: { workspace: string; prompt: string; promptFile: string; round: number; logFile: string },
): Promise<BuilderRun> {
  const builder = getBuilder(cfg, name);
  writeFileSync(opts.promptFile, opts.prompt);
  const vars = { prompt_file: opts.promptFile, workspace: opts.workspace, round: String(opts.round), hydra_root: cfg.root };
  const command = fill(builder.command, vars);
  writeFileSync(opts.logFile, `$ ${command}\n\n`);
  const res = await exec(command, [], {
    cwd: opts.workspace,
    shell: true,
    input: opts.prompt,
    timeoutMs: (builder.timeoutSec ?? 900) * 1000,
    logFile: opts.logFile,
    env: {
      ...process.env,
      HYDRA_ROUND: String(opts.round),
      HYDRA_PROMPT_FILE: opts.promptFile,
      HYDRA_WORKSPACE: opts.workspace,
      HYDRA_ROOT: cfg.root,
      CI: "1",
    },
  });
  return {
    exitCode: res.code,
    timedOut: res.timedOut,
    durationMs: res.durationMs,
    tokens: parseTokens(builder.tokens, res.stdout),
    logFile: opts.logFile,
  };
}
