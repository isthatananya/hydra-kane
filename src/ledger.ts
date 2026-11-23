import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KaneResult } from "./kane/wrapper.js";
import type { Tokens } from "./builder/adapter.js";
import type { GroundTruthReport } from "./chaos/groundtruth.js";
import { findBug } from "./chaos/taxonomy.js";
import { ensureDir, readJsonOr, relPosix, writeJsonAtomic } from "./util/fs.js";

export type RunStatus =
  | "running"
  | "healed" // CATCH -> patched -> verified -> deployed
  | "miss" // Kane passed with the bug present
  | "aborted" // heal cap reached
  | "rejected" // anti-cheat: spec tampering
  | "invalid-baseline"
  | "infra-error"
  | "budget-exceeded"
  | "error";

export type KaneRef = {
  label: string;
  spec: string;
  attempt: number;
  verdict: KaneResult["verdict"];
  exitCode: number | null;
  infraReason: string | null;
  summary: string | null;
  failingStep: KaneResult["failingStep"];
  testUrl: string | null;
  /** Paths relative to the run directory. */
  evidenceDir: string;
  video: string | null;
  screenshots: string[];
  durationMs: number;
  credits: number | null;
  fresh: boolean;
};

export type HealRound = {
  round: number;
  flowFed: "main" | "holdout";
  startedAt: string;
  durationMs: number;
  builder: { exitCode: number | null; timedOut: boolean; durationMs: number; tokens: Tokens | null; log: string };
  prompt: string;
  diff: string | null;
  filesChanged: string[];
  reverted: string[];
  specIntegrity: "ok" | "tampered";
  build: { ok: boolean; durationMs: number } | null;
  verify: KaneRef[];
  outcome: "healed" | "verify-failed" | "holdout-failed" | "build-failed" | "no-change" | "tampered" | "builder-failed";
};

export type BugInfo = {
  id: string;
  title: string;
  bugClass: string;
  /** math | state | flow. Optional: runs recorded before it existed are looked up by bug id. */
  surface?: string;
  description: string;
  source: "library" | "mutator";
  kaneHypothesis: string;
  breaks: string[];
};

export type RunRecord = {
  schema: 1;
  runId: string;
  seed: number;
  builder: string;
  status: RunStatus;
  statusReason: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  appUrl: string;
  bug: BugInfo | null;
  chaosDiff: string | null;
  specs: Array<{ id: string; role: string; path: string; hash: string }>;
  baseline: KaneRef[];
  /** `votes`: every referee run's verdict when the verdict was confirmed (kane.confirm). */
  referee: { kane: KaneRef; verdict: "CATCH" | "MISS"; votes?: Array<KaneRef["verdict"]> } | null;
  specAgent: { attempted: boolean; spec: string | null; caught: boolean; kane: KaneRef | null } | null;
  rounds: HealRound[];
  gate: { decision: "promote" | "reject"; reasons: string[]; checkedAt: string } | null;
  deploy: { dir: string; manifest: string; command: string | null; exitCode: number | null } | null;
  groundTruth: { baseline: GroundTruthReport | null; chaos: GroundTruthReport | null; final: GroundTruthReport | null };
  metrics: RunMetrics;
};

export type RunMetrics = {
  kaneRuns: number;
  kaneInfraRetries: number;
  kaneCredits: number | null;
  healRounds: number;
  roundsToGreen: number | null;
  timeToHealMs: number | null;
  tokensTotal: number | null;
  tokensPerHeal: number | null;
  holdoutFailures: number;
  /** Kane passed but ground truth says the bug is still there. */
  falseGreen: boolean | null;
};

export type HydraEvent = { seq: number; t: number; ts: string; type: string; [k: string]: unknown };

export function emptyMetrics(): RunMetrics {
  return {
    kaneRuns: 0,
    kaneInfraRetries: 0,
    kaneCredits: null,
    healRounds: 0,
    roundsToGreen: null,
    timeToHealMs: null,
    tokensTotal: null,
    tokensPerHeal: null,
    holdoutFailures: 0,
    falseGreen: null,
  };
}

export class RunRecorder {
  readonly runDir: string;
  readonly record: RunRecord;
  private seq = 0;
  private readonly started = Date.now();
  private readonly eventsFile: string;
  private listeners: Array<(e: HydraEvent) => void> = [];

  constructor(
    readonly stateDir: string,
    init: { runId: string; seed: number; builder: string; appUrl: string },
  ) {
    this.runDir = ensureDir(join(stateDir, "runs", init.runId));
    this.eventsFile = join(this.runDir, "events.jsonl");
    this.record = {
      schema: 1,
      runId: init.runId,
      seed: init.seed,
      builder: init.builder,
      status: "running",
      statusReason: null,
      startedAt: new Date(this.started).toISOString(),
      endedAt: null,
      durationMs: null,
      appUrl: init.appUrl,
      bug: null,
      chaosDiff: null,
      specs: [],
      baseline: [],
      referee: null,
      specAgent: null,
      rounds: [],
      gate: null,
      deploy: null,
      groundTruth: { baseline: null, chaos: null, final: null },
      metrics: emptyMetrics(),
    };
    this.save();
  }

  rel(abs: string): string {
    return relPosix(this.runDir, abs);
  }

  onEvent(cb: (e: HydraEvent) => void): void {
    this.listeners.push(cb);
  }

  event(type: string, data: Record<string, unknown> = {}): HydraEvent {
    const ev: HydraEvent = { seq: ++this.seq, t: Date.now() - this.started, ts: new Date().toISOString(), type, ...data };
    appendFileSync(this.eventsFile, JSON.stringify(ev) + "\n");
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        /* listener errors never break the loop */
      }
    }
    return ev;
  }

  kaneRef(label: string, spec: string, attempt: number, r: KaneResult): KaneRef {
    return {
      label,
      spec,
      attempt,
      verdict: r.verdict,
      exitCode: r.exitCode,
      infraReason: r.infraReason,
      summary: r.summary,
      failingStep: r.failingStep,
      testUrl: r.testUrl,
      evidenceDir: this.rel(r.evidenceDir),
      video: r.video ? this.rel(join(r.evidenceDir, r.video)) : null,
      screenshots: r.screenshots.map((s) => this.rel(join(r.evidenceDir, s))),
      durationMs: r.durationMs,
      credits: r.credits,
      fresh: r.fresh,
    };
  }

  save(): void {
    writeJsonAtomic(join(this.runDir, "run.json"), this.record);
  }

  finish(status: RunStatus, reason: string | null): void {
    const end = Date.now();
    this.record.status = status;
    this.record.statusReason = reason;
    this.record.endedAt = new Date(end).toISOString();
    this.record.durationMs = end - this.started;
    this.save();
    this.appendLedger();
    this.event("run_end", { status, reason, metrics: this.record.metrics });
  }

  /** FR6: one ledger line per round (referee = round 0, heals = 1..n). */
  private appendLedger(): void {
    const r = this.record;
    const file = join(this.stateDir, "ledger.jsonl");
    const base = { runId: r.runId, seed: r.seed, builder: r.builder, bugId: r.bug?.id ?? null, bugClass: r.bug?.bugClass ?? null, runStatus: r.status };
    const lines: unknown[] = [];
    if (r.referee) {
      lines.push({
        ...base,
        round: 0,
        phase: "referee",
        verdict: r.referee.verdict,
        exitCode: r.referee.kane.exitCode,
        diff: r.chaosDiff ? "chaos.patch" : null,
        video: r.referee.kane.video,
        testUrl: r.referee.kane.testUrl,
        durationMs: r.referee.kane.durationMs,
        tokens: null,
      });
    }
    for (const h of r.rounds) {
      const last = h.verify[h.verify.length - 1];
      lines.push({
        ...base,
        round: h.round,
        phase: "heal",
        verdict: h.outcome,
        exitCode: last?.exitCode ?? null,
        diff: h.diff,
        video: last?.video ?? null,
        testUrl: last?.testUrl ?? null,
        durationMs: h.durationMs,
        builderMs: h.builder.durationMs,
        tokens: h.builder.tokens?.total ?? null,
      });
    }
    if (lines.length === 0) lines.push({ ...base, round: null, phase: "setup", verdict: r.status, exitCode: null, tokens: null });
    appendFileSync(file, lines.map((l) => JSON.stringify({ ts: r.endedAt, ...(l as object) })).join("\n") + "\n");
  }
}

export function listRuns(stateDir: string): RunRecord[] {
  const dir = join(stateDir, "runs");
  if (!existsSync(dir)) return [];
  const out: RunRecord[] = [];
  for (const name of readdirSync(dir)) {
    const rec = readJsonOr<RunRecord | null>(join(dir, name, "run.json"), null);
    if (rec && rec.schema === 1) out.push(rec);
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function readEvents(runDir: string): HydraEvent[] {
  const file = join(runDir, "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as HydraEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is HydraEvent => e !== null);
}

/** Aggregate PRD metrics across a set of runs. */
export function aggregate(runs: RunRecord[]) {
  const injected = runs.filter((r) => r.referee);
  const catches = injected.filter((r) => r.referee?.verdict === "CATCH");
  const misses = injected.filter((r) => r.referee?.verdict === "MISS");
  const healed = runs.filter((r) => r.status === "healed");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const holdoutRuns = runs.reduce((n, r) => n + r.rounds.filter((h) => h.verify.some((v) => v.spec === "holdout")).length, 0);
  const holdoutFails = runs.reduce((n, r) => n + r.metrics.holdoutFailures, 0);
  const byClass: Record<string, { injected: number; caught: number; missed: number; healed: number }> = {};
  const bySurface: Record<string, { injected: number; caught: number; missed: number; healed: number }> = {};
  for (const r of injected) {
    const k = r.bug?.bugClass ?? "unknown";
    byClass[k] ??= { injected: 0, caught: 0, missed: 0, healed: 0 };
    byClass[k].injected++;
    if (r.referee?.verdict === "CATCH") byClass[k].caught++;
    else byClass[k].missed++;
    if (r.status === "healed") byClass[k].healed++;
    const sk = bugSurface(r.bug);
    bySurface[sk] ??= { injected: 0, caught: 0, missed: 0, healed: 0 };
    bySurface[sk].injected++;
    if (r.referee?.verdict === "CATCH") bySurface[sk].caught++;
    else bySurface[sk].missed++;
    if (r.status === "healed") bySurface[sk].healed++;
  }
  return {
    runs: runs.length,
    bugsInjected: injected.length,
    catches: catches.length,
    misses: misses.length,
    detectionRate: injected.length ? catches.length / injected.length : null,
    healed: healed.length,
    avgRoundsToGreen: avg(healed.map((r) => r.metrics.roundsToGreen ?? 0)),
    avgTimeToHealMs: avg(healed.map((r) => r.metrics.timeToHealMs ?? 0)),
    avgTokensPerHeal: avg(runs.map((r) => r.metrics.tokensPerHeal).filter((x): x is number => x !== null)),
    holdoutFailRate: holdoutRuns ? holdoutFails / holdoutRuns : null,
    falseGreens: runs.filter((r) => r.metrics.falseGreen === true).length,
    byClass,
    bySurface,
  };
}

/** The bug's surface, falling back to the taxonomy for runs recorded before the field existed. */
export function bugSurface(bug: BugInfo | null | undefined): string {
  if (!bug) return "unknown";
  return bug.surface ?? bug.id.split("+").map((id) => findBug(id)?.surface ?? "unknown").reduce((a, b) => (a === b ? a : "mixed"));
}
