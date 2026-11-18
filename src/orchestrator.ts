import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePath, stateDir as getStateDir, type HydraConfig } from "./config.js";
import { AppServer, buildApp } from "./app/server.js";
import {
  commitCount,
  diffAgainstSnapshot,
  revertChanges,
  squashHistory,
  takeSnapshot,
  WORKSPACE_GITIGNORE,
  workspaceExclude,
} from "./anticheat.js";
import { buildHealPrompt, getBuilder, runBuilder } from "./builder/adapter.js";
import { applyBug } from "./chaos/engine.js";
import { runGroundTruth, type GroundTruthReport } from "./chaos/groundtruth.js";
import { adoptMutation, mutate } from "./chaos/mutator.js";
import { bugForSeed, findBug, type Bug } from "./chaos/taxonomy.js";
import { evaluateGate, promote, sourceHash } from "./gate.js";
import { runKane, type KaneResult } from "./kane/wrapper.js";
import { RunRecorder, type BugInfo, type HealRound, type KaneRef, type RunStatus } from "./ledger.js";
import { checkSpec, lockSpec, parseSpec, restoreSpec, unlockSpec, type Spec, type SpecLock } from "./spec.js";
import { writeCatchingSpec } from "./specAgent.js";
import { copyTree, ensureDir } from "./util/fs.js";
import { log } from "./util/log.js";

export type LoopOptions = {
  seed: number;
  builder: string;
  /** Force a specific library bug instead of the seed mapping (or a pre-built compound bug). */
  bug?: Bug;
  bugId?: string;
  mutator?: boolean;
  maxHeals?: number;
  groundTruth?: boolean;
  onRecorder?: (rec: RunRecorder) => void;
};

export type LoopResult = { runId: string; runDir: string; status: RunStatus; reason: string | null; bug: BugInfo | null };

class Abort extends Error {
  constructor(
    readonly status: RunStatus,
    message: string,
  ) {
    super(message);
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function bugInfo(bug: Bug, source: BugInfo["source"]): BugInfo {
  return {
    id: bug.id,
    title: bug.title,
    bugClass: bug.bugClass,
    description: bug.description,
    source,
    kaneHypothesis: bug.kaneHypothesis,
    breaks: [...bug.breaks],
  };
}

export async function runLoop(cfg: HydraConfig, opts: LoopOptions): Promise<LoopResult> {
  getBuilder(cfg, opts.builder); // fail fast on unknown builder
  const state = ensureDir(getStateDir(cfg));
  const app = new AppServer(cfg);
  const runId = `${stamp()}-s${opts.seed}-${opts.builder}`;
  const rec = new RunRecorder(state, { runId, seed: opts.seed, builder: opts.builder, appUrl: app.url });
  opts.onRecorder?.(rec);
  const R = rec.record;
  const dir = rec.runDir;
  const workspace = join(dir, "workspace");
  const logs = ensureDir(join(dir, "logs"));
  const maxHeals = opts.maxHeals ?? cfg.heal.maxRounds;
  const useGroundTruth = opts.groundTruth ?? cfg.groundTruth.enabled;

  const mainSpec = parseSpec(resolvePath(cfg, cfg.specs.main));
  const holdoutSpec = parseSpec(resolvePath(cfg, cfg.specs.holdout));
  const generated: Spec[] = [];
  const locks: SpecLock[] = [];
  const backups = ensureDir(join(dir, "spec-backup"));
  for (const s of [mainSpec, holdoutSpec]) {
    locks.push(lockSpec(s.path, join(backups, `${s.id}.flow.md`)));
    R.specs.push({ id: s.id, role: s.role, path: s.path, hash: s.hash });
  }

  let kaneSeq = 0;
  let creditsSeen = false;

  /** One referee call: reset state, fresh Kane run, infra retries that never reach the builder. */
  async function kane(label: string, spec: Spec, role: string): Promise<{ result: KaneResult; ref: KaneRef }> {
    for (let attempt = 0; attempt <= cfg.kane.retries; attempt++) {
      if (R.metrics.kaneRuns >= cfg.kane.maxRunsPerLoop) {
        throw new Abort("budget-exceeded", `Kane run budget of ${cfg.kane.maxRunsPerLoop} exhausted (kane.maxRunsPerLoop)`);
      }
      for (const lock of locks) {
        const integrity = checkSpec(lock);
        if (!integrity.ok) throw new Abort("rejected", `Spec ${lock.path} changed before a Kane run`);
      }
      R.metrics.kaneRuns++;
      kaneSeq++;
      await app.reset();
      const outDir = join(dir, "kane", `${String(kaneSeq).padStart(2, "0")}-${label}${attempt ? `-retry${attempt}` : ""}`);
      rec.event("kane_start", { label, spec: role, attempt });
      log.step("KANE", `${label} (${role}${attempt ? `, retry ${attempt}` : ""})…`);
      const result = await runKane(cfg, { spec, url: app.url, outDir, label });
      if (result.credits !== null) {
        R.metrics.kaneCredits = (R.metrics.kaneCredits ?? 0) + result.credits;
        creditsSeen = true;
      }
      const ref = rec.kaneRef(label, role, attempt, result);
      rec.event("kane_end", { ...ref });
      if (result.verdict === "passed" || result.verdict === "failed") {
        const tag = result.verdict === "passed" ? "PASS" : "FAIL";
        log.step("KANE", `${label}: ${tag} (exit ${result.exitCode}, ${(result.durationMs / 1000).toFixed(0)}s)${result.summary ? ` — ${result.summary.slice(0, 140)}` : ""}`);
        return { result, ref };
      }
      R.metrics.kaneInfraRetries++;
      log.warn(`Kane infra error on ${label}: ${result.infraReason ?? result.verdict}. Not forwarded to the builder.`);
      rec.event("kane_infra", { label, reason: result.infraReason, verdict: result.verdict, attempt });
      if (result.exitCode === 2 && /auth|login|token|credential|401|403/i.test(result.infraReason ?? "")) {
        throw new Abort("infra-error", `Kane authentication failed: ${result.infraReason}. Run: kane-cli login`);
      }
    }
    throw new Abort("infra-error", `Kane failed with infra errors ${cfg.kane.retries + 1} times on ${label}`);
  }

  async function groundTruth(phase: "baseline" | "chaos" | "final"): Promise<GroundTruthReport | null> {
    if (!useGroundTruth) return null;
    const report = await runGroundTruth(app.url, () => app.reset());
    R.groundTruth[phase] = report;
    rec.event("ground_truth", { phase, available: report.available, failing: report.failing, results: report.results });
    if (!report.available) log.warn(report.reason ?? "ground truth unavailable");
    else log.info(`ground truth (${phase}): ${report.failing.length ? `failing ${report.failing.join(", ")}` : "all checks pass"}`);
    rec.save();
    return report;
  }

  async function rebuildAndStart(tag: string): Promise<{ ok: boolean; durationMs: number; logTail: string }> {
    await app.stop();
    rec.event("build_start", { tag });
    const build = await buildApp(cfg, workspace, join(logs, `build-${tag}.log`));
    rec.event("build_end", { tag, ok: build.ok, durationMs: build.durationMs });
    if (build.ok) await app.start(workspace, join(logs, `app-${tag}.log`));
    return build;
  }

  const phase = (name: string, extra: Record<string, unknown> = {}) => {
    rec.event("phase", { phase: name, ...extra });
  };

  let status: RunStatus = "error";
  let reason: string | null = null;
  try {
    rec.event("run_start", { runId, seed: opts.seed, builder: opts.builder, maxHeals, specs: R.specs.map((s) => ({ id: s.id, role: s.role })) });

    // ── BUILD ───────────────────────────────────────────────────────────────
    phase("BUILD");
    log.step("BUILD", `workspace ${workspace}`);
    const appDir = resolvePath(cfg, cfg.app.dir);
    if (!existsSync(join(appDir, "package.json"))) throw new Abort("error", `App directory not found: ${appDir}`);
    copyTree(appDir, workspace, { exclude: workspaceExclude });
    writeFileSync(join(workspace, ".gitignore"), WORKSPACE_GITIGNORE);
    await squashHistory(workspace, "snapshot");
    const b0 = await rebuildAndStart("baseline");
    if (!b0.ok) throw new Abort("error", `Baseline app failed to build:\n${b0.logTail}`);
    log.ok(`app up at ${app.url} (build ${(b0.durationMs / 1000).toFixed(0)}s)`);
    await groundTruth("baseline");

    // ── BASELINE: Kane must pass the main spec twice ───────────────────────
    phase("BASELINE");
    for (const label of ["baseline-1", "baseline-2"]) {
      const { result, ref } = await kane(label, mainSpec, "main");
      R.baseline.push(ref);
      rec.save();
      if (result.verdict !== "passed") {
        throw new Abort("invalid-baseline", `Kane failed the unmodified app on ${label}; the round is invalid. ${result.summary ?? ""}`.trim());
      }
    }

    // ── CHAOS ───────────────────────────────────────────────────────────────
    phase("CHAOS");
    await app.stop();
    let bug: Bug | null = null;
    let chaosDiff = "";
    if (opts.mutator ?? cfg.chaos.mutator.enabled) {
      for (let attempt = 1; attempt <= cfg.chaos.mutator.attempts && !bug; attempt++) {
        log.step("CHAOS", `LLM mutator attempt ${attempt}…`);
        const m = await mutate(cfg, workspace, join(dir, "mutator"), attempt);
        rec.event("mutator", { attempt, ok: m.ok, reason: m.ok ? null : m.reason });
        if (m.ok) {
          adoptMutation(m.scratch, workspace, m.files);
          bug = m.bug;
          chaosDiff = m.diff;
          R.bug = bugInfo(m.bug, "mutator");
        } else log.warn(`mutation rejected: ${m.reason}`);
      }
      if (!bug) log.warn("LLM mutator produced no valid bug; falling back to the seeded patch library");
    }
    if (!bug) {
      bug = opts.bug ?? (opts.bugId ? findBug(opts.bugId) ?? null : null) ?? bugForSeed(opts.seed);
      if (!bug) throw new Abort("error", `Unknown bug id ${opts.bugId}`);
      chaosDiff = applyBug(workspace, bug).diff;
      R.bug = bugInfo(bug, "library");
    }
    R.chaosDiff = "chaos.patch";
    writeFileSync(join(dir, "chaos.patch"), chaosDiff);
    // History now holds only the broken tree: there is no clean commit to revert to.
    await squashHistory(workspace, "snapshot");
    if ((await commitCount(workspace)) !== 1) throw new Abort("error", "workspace history was not squashed");
    rec.event("chaos_applied", { bug: R.bug, diff: chaosDiff });
    log.step("CHAOS", `injected ${bug.id} (${bug.bugClass}) — hidden from the builder`);
    const bc = await rebuildAndStart("chaos");
    if (!bc.ok) throw new Abort("error", `Chaos patch ${bug.id} broke the build (patch library is out of date):\n${bc.logTail}`);
    await groundTruth("chaos");
    rec.save();

    // ── REFEREE ─────────────────────────────────────────────────────────────
    phase("REFEREE");
    const referee = await kane("referee", mainSpec, "main");
    let lastFail: { result: KaneResult; flow: "main" | "holdout" } | null = null;
    if (referee.result.verdict === "passed") {
      R.referee = { kane: referee.ref, verdict: "MISS" };
      rec.event("verdict", { verdict: "MISS", bug: R.bug });
      log.step("REFEREE", `MISS — Kane passed with ${bug.id} present`);
      rec.save();

      if (cfg.specAgent.enabled && R.groundTruth.chaos?.available && R.groundTruth.chaos.failing.length) {
        phase("SPEC_AGENT");
        const failure = R.groundTruth.chaos.results.find((r) => !r.passed)?.failure ?? "unknown behaviour problem";
        log.step("SPEC", "spec agent writing a flow for the missed behaviour…");
        const written = await writeCatchingSpec(cfg, { workspace, mainSpecPath: mainSpec.path, groundTruthFailure: failure, scratchRoot: join(dir, "spec-agent"), bugId: bug.id });
        R.specAgent = { attempted: true, spec: written.ok ? written.spec.path : null, caught: false, kane: null };
        if (written.ok) {
          const probe = await kane("spec-agent", written.spec, "generated");
          R.specAgent.kane = probe.ref;
          if (probe.result.verdict === "failed") {
            R.specAgent.caught = true;
            generated.push(written.spec);
            locks.push(lockSpec(written.spec.path, join(backups, `${written.spec.id}.flow.md`)));
            lastFail = { result: probe.result, flow: "main" };
            rec.event("spec_agent", { caught: true, spec: written.spec.path });
            log.ok(`generated flow catches ${bug.id}; escalating to HEAL`);
          } else {
            rec.event("spec_agent", { caught: false, spec: written.spec.path });
          }
        } else {
          rec.event("spec_agent", { caught: false, reason: written.reason });
        }
        rec.save();
      }
      if (!lastFail) throw new Abort("miss", `Kane did not catch ${bug.id}; logged as a MISS`);
    } else {
      R.referee = { kane: referee.ref, verdict: "CATCH" };
      rec.event("verdict", { verdict: "CATCH", bug: R.bug });
      log.step("REFEREE", `CATCH — Kane exit 1 on ${bug.id}`);
      lastFail = { result: referee.result, flow: "main" };
      rec.save();
    }

    // ── HEAL → VERIFY ───────────────────────────────────────────────────────
    const healStarted = Date.now();
    let buildError: string | null = null;
    let reverted: string[] = [];
    for (let round = 1; round <= maxHeals; round++) {
      phase("HEAL", { round });
      const roundStart = Date.now();
      const snapshot = takeSnapshot(workspace, join(dir, "snapshots", `round-${round}`));
      const prompt = buildHealPrompt(workspace, {
        round,
        kane: lastFail.result,
        flow: lastFail.flow,
        buildError: cfg.heal.includeBuildErrors ? buildError : null,
        allowlist: cfg.allowlist,
        reverted,
      });
      const promptFile = join(ensureDir(join(dir, "prompts")), `heal-${round}.md`);
      rec.event("heal_start", { round, flow: lastFail.flow, prompt });
      log.step("HEAL", `round ${round}/${maxHeals}: ${opts.builder} patching from Kane evidence…`);
      const run = await runBuilder(cfg, opts.builder, { workspace, prompt, promptFile, round, logFile: join(logs, `builder-${round}.log`) });
      rec.event("builder_end", { round, exitCode: run.exitCode, timedOut: run.timedOut, durationMs: run.durationMs, tokens: run.tokens });

      const h: HealRound = {
        round,
        flowFed: lastFail.flow,
        startedAt: new Date(roundStart).toISOString(),
        durationMs: 0,
        builder: { exitCode: run.exitCode, timedOut: run.timedOut, durationMs: run.durationMs, tokens: run.tokens, log: rec.rel(run.logFile) },
        prompt: rec.rel(promptFile),
        diff: null,
        filesChanged: [],
        reverted: [],
        specIntegrity: "ok",
        build: null,
        verify: [],
        outcome: "no-change",
      };
      R.rounds.push(h);
      R.metrics.healRounds = round;
      const closeRound = (outcome: HealRound["outcome"]) => {
        h.outcome = outcome;
        h.durationMs = Date.now() - roundStart;
        rec.event("round_end", { round, outcome });
        rec.save();
      };

      // Anti-cheat 1: spec integrity (the referee's rulebook must be untouched).
      const tampered = locks.filter((l) => !checkSpec(l).ok);
      if (tampered.length) {
        for (const l of tampered) restoreSpec(l);
        h.specIntegrity = "tampered";
        rec.event("anticheat", { round, kind: "spec-tamper", files: tampered.map((l) => l.path) });
        R.gate = { decision: "reject", reasons: tampered.map((l) => `spec ${l.path} modified by builder (hash mismatch); restored`), checkedAt: new Date().toISOString() };
        rec.event("gate", { ...R.gate });
        closeRound("tampered");
        throw new Abort("rejected", "Builder modified a Kane spec. Gate rejected the round.");
      }

      // Anti-cheat 2: path allowlist. Out-of-bounds edits are reverted, never built.
      let diff = diffAgainstSnapshot(snapshot, workspace, cfg.allowlist);
      reverted = diff.violations.map((v) => v.path);
      if (reverted.length) {
        revertChanges(snapshot, workspace, diff.violations);
        rec.event("anticheat", { round, kind: "allowlist", files: reverted });
        log.warn(`reverted out-of-allowlist edits: ${reverted.join(", ")}`);
        diff = diffAgainstSnapshot(snapshot, workspace, cfg.allowlist);
      }
      h.reverted = reverted;
      h.filesChanged = diff.changes.map((c) => c.path);
      if (diff.patch) {
        const diffFile = join(ensureDir(join(dir, "diffs")), `round-${round}.patch`);
        writeFileSync(diffFile, diff.patch);
        h.diff = rec.rel(diffFile);
      }
      rec.event("diff", { round, files: h.filesChanged, patch: diff.patch, reverted });

      if (run.timedOut || run.exitCode !== 0) {
        log.warn(`builder ${run.timedOut ? "timed out" : `exited ${run.exitCode}`} with ${diff.changes.length} allowed change(s)`);
      }
      if (diff.changes.length === 0) {
        closeRound(run.timedOut || run.exitCode !== 0 ? "builder-failed" : "no-change");
        if (run.exitCode === 0 && !run.timedOut) log.warn("builder made no allowed changes");
        continue;
      }

      await squashHistory(workspace, "snapshot");
      const build = await rebuildAndStart(`heal-${round}`);
      h.build = { ok: build.ok, durationMs: build.durationMs };
      if (!build.ok) {
        buildError = build.logTail;
        closeRound("build-failed");
        log.warn("patched app failed to build");
        continue;
      }
      buildError = null;

      // ── VERIFY: two fresh main passes, generated flows, then the hidden holdout ──
      phase("VERIFY", { round });
      const verifiedHash = sourceHash(workspace);
      const mainPasses: KaneResult[] = [];
      let failed: { result: KaneResult; flow: "main" | "holdout" } | null = null;
      for (const label of ["a", "b"]) {
        const v = await kane(`verify-${round}${label}`, mainSpec, "main");
        h.verify.push(v.ref);
        if (v.result.verdict !== "passed") {
          failed = { result: v.result, flow: "main" };
          break;
        }
        mainPasses.push(v.result);
      }
      const extraPasses: KaneResult[] = [];
      if (!failed) {
        for (const g of generated) {
          const v = await kane(`verify-${round}-${g.id}`, g, "generated");
          h.verify.push(v.ref);
          if (v.result.verdict !== "passed") {
            failed = { result: v.result, flow: "main" };
            break;
          }
          extraPasses.push(v.result);
        }
      }
      let holdout: KaneResult | null = null;
      if (!failed) {
        const v = await kane(`holdout-${round}`, holdoutSpec, "holdout");
        h.verify.push(v.ref);
        holdout = v.result;
        if (v.result.verdict !== "passed") {
          failed = { result: v.result, flow: "holdout" };
          R.metrics.holdoutFailures++;
          R.gate = {
            decision: "reject",
            reasons: ["main spec passed twice but the hidden holdout failed: the fix does not generalise (possible hardcoding)"],
            checkedAt: new Date().toISOString(),
          };
          rec.event("gate", { ...R.gate, round });
        }
      }
      if (failed) {
        lastFail = failed;
        closeRound(failed.flow === "holdout" ? "holdout-failed" : "verify-failed");
        log.step("VERIFY", `round ${round} not green (${failed.flow} failed)`);
        continue;
      }

      // ── DEPLOY GATE ─────────────────────────────────────────────────────────
      phase("DEPLOY", { round });
      const decision = evaluateGate({ mainPasses, holdout, extraPasses, specLocks: locks, verifiedSourceHash: verifiedHash, workspace });
      R.gate = { ...decision, checkedAt: new Date().toISOString() };
      rec.event("gate", { ...R.gate });
      if (decision.decision !== "promote") {
        closeRound("verify-failed");
        throw new Abort("rejected", `Gate rejected: ${decision.reasons.join("; ")}`);
      }
      closeRound("healed");
      R.metrics.roundsToGreen = round;
      R.metrics.timeToHealMs = Date.now() - healStarted;
      const deploy = await promote(cfg, state, {
        runId,
        workspace,
        bugId: bug.id,
        testUrls: [...mainPasses, holdout!].map((r) => r.testUrl).filter((u): u is string => !!u),
        specHashes: Object.fromEntries(locks.map((l) => [l.path, l.hash])),
      });
      R.deploy = { dir: rec.rel(deploy.dir), manifest: rec.rel(deploy.manifest), command: deploy.command, exitCode: deploy.exitCode };
      rec.event("deploy", { ...R.deploy });
      log.ok(`DEPLOYED ${runId} → ${deploy.dir}`);
      if (deploy.command && deploy.exitCode !== 0) log.warn(`deploy command exited ${deploy.exitCode}`);

      const final = await groundTruth("final");
      if (final?.available) R.metrics.falseGreen = bug.breaks.some((c) => final.failing.includes(c));
      status = "healed";
      reason = `Healed in ${round} round(s)`;
      break;
    }
    if (status !== "healed") {
      status = "aborted";
      reason = `Heal cap of ${maxHeals} rounds reached without a green VERIFY`;
      log.error(reason);
    }
  } catch (err) {
    if (err instanceof Abort) {
      status = err.status;
      reason = err.message;
      if (status === "miss") log.step("MISS", reason);
      else log.error(reason);
    } else {
      status = "error";
      reason = (err as Error).stack ?? String(err);
      log.error(`run failed: ${(err as Error).message}`);
    }
  } finally {
    await app.stop().catch(() => undefined);
    for (const l of locks) unlockSpec(l);
    const tokens = R.rounds.map((r) => r.builder.tokens?.total).filter((t): t is number => typeof t === "number");
    R.metrics.tokensTotal = tokens.length ? tokens.reduce((a, b) => a + b, 0) : null;
    R.metrics.tokensPerHeal = tokens.length ? Math.round(R.metrics.tokensTotal! / tokens.length) : null;
    if (!creditsSeen) R.metrics.kaneCredits = null;
    rec.finish(status, reason);
  }
  return { runId, runDir: dir, status, reason, bug: R.bug };
}
