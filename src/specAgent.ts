/**
 * FR14: on a MISS, a third agent writes a new Kane flow aimed at the behaviour the existing
 * spec did not cover. Hydra only keeps the flow if Kane actually fails it on the buggy app
 * (proving it catches the bug) — the flow is then locked and joins the VERIFY suite.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HydraConfig } from "./config.js";
import { parseSpec, type Spec } from "./spec.js";
import { workspaceExclude } from "./anticheat.js";
import { copyTree, ensureDir, removeTree, sha256 } from "./util/fs.js";
import { exec } from "./util/proc.js";

export type SpecAgentResult = { ok: true; spec: Spec } | { ok: false; reason: string };

export async function writeCatchingSpec(
  cfg: HydraConfig,
  opts: { workspace: string; mainSpecPath: string; groundTruthFailure: string; scratchRoot: string; bugId: string },
): Promise<SpecAgentResult> {
  const scratch = join(opts.scratchRoot, "workspace");
  removeTree(opts.scratchRoot);
  ensureDir(scratch);
  copyTree(opts.workspace, scratch, { exclude: workspaceExclude });
  copyFileSync(opts.mainSpecPath, join(scratch, "existing.flow.md"));

  const prompt = `You write browser test flows for Kane CLI, an AI browser-testing agent that follows natural-language steps.

The checkout app in this directory has a behaviour problem that the existing flow (existing.flow.md) does not catch.
An independent scripted check reported: "${opts.groundTruthFailure}"

Write a NEW flow to the file new.flow.md that exercises that behaviour through the UI and contains explicit
verifications that fail when the problem is present and pass when the app behaves correctly.

Format of new.flow.md:
---
id: generated-${opts.bugId}
title: <short title>
role: generated
---
<numbered steps, one action or verification per line, quoting exact button labels and expected text>

Rules: only create new.flow.md; do not modify any other file. Steps must start from the store's home page.`;

  const logFile = join(opts.scratchRoot, "spec-agent.log");
  writeFileSync(join(opts.scratchRoot, "prompt.md"), prompt);
  const res = await exec(cfg.specAgent.command, [], {
    cwd: scratch,
    shell: true,
    input: prompt,
    timeoutMs: cfg.specAgent.timeoutSec * 1000,
    logFile,
    env: { ...process.env, CI: "1" },
  });
  if (res.timedOut) return { ok: false, reason: "spec agent timed out" };
  const produced = join(scratch, "new.flow.md");
  if (!existsSync(produced)) return { ok: false, reason: "spec agent did not write new.flow.md" };

  const text = readFileSync(produced, "utf8");
  const dir = ensureDir(join(cfg.root, cfg.specs.generatedDir));
  const dest = join(dir, `${opts.bugId}-${sha256(text).slice(0, 8)}.flow.md`);
  writeFileSync(dest, text);
  try {
    return { ok: true, spec: parseSpec(dest) };
  } catch (err) {
    return { ok: false, reason: `generated spec is invalid: ${(err as Error).message}` };
  }
}
