// Shapes of the recorded run data exported by `hydra export-arena` (schema 1).

export type RunStatus = "healed" | "rejected" | "miss" | "aborted";
export type Verdict = "healed" | "rejected" | "missed" | "aborted";

export type Bug = {
  id: string;
  title: string;
  bugClass: string;
  surface: string;
  description: string;
  breaks: string[];
  kaneHypothesis: string;
};

export type KaneRun = {
  label: string;
  spec: "main" | "holdout";
  attempt: number;
  verdict: "passed" | "failed" | "error";
  exitCode: number;
  infraReason: string | null;
  summary: string;
  failingStep: number | null;
  testUrl: string | null;
  evidenceDir: string;
  video: string | null;
  screenshots: string[];
  durationMs: number;
  credits: number;
  fresh: boolean;
};

export type CheckResult = { check: string; passed: boolean; failure: string | null; durationMs: number };
export type GroundTruthPhase = { available: boolean; results: CheckResult[]; failing: string[] };

export type Round = {
  round: number;
  flowFed: string;
  startedAt: string;
  durationMs: number;
  builder: {
    exitCode: number;
    timedOut: boolean;
    durationMs: number;
    tokens: { total: number; costUsd?: number } | null;
  } | null;
  diff: string | null;
  filesChanged: string[];
  specIntegrity: string;
  verify: KaneRun[];
  outcome: string;
};

export type Metrics = {
  kaneRuns: number;
  kaneCredits: number;
  healRounds?: number;
  roundsToGreen: number | null;
  timeToHealMs: number | null;
  tokensTotal: number | null;
  tokensPerHeal?: number | null;
  holdoutFailures?: number;
  falseGreen: boolean;
};

export type Run = {
  schema: 1;
  runId: string;
  seed: number;
  builder: string;
  status: RunStatus;
  statusReason: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  bug: Bug;
  chaosDiff: string | null;
  baseline: KaneRun[];
  referee: { kane: KaneRun; verdict: "CATCH" | "MISS" } | null;
  rounds: Round[];
  gate: { decision: "promote" | "reject"; reasons: string[]; checkedAt: string } | null;
  groundTruth: { baseline: GroundTruthPhase; chaos: GroundTruthPhase; final: GroundTruthPhase };
  metrics: Metrics;
  captions: Record<string, string>;
};

export type RunSummary = {
  runId: string;
  seed: number;
  builder: string;
  status: RunStatus;
  bug: { id: string; bugClass: string; surface: string };
  verdict: "CATCH" | "MISS";
  startedAt: string;
  durationMs: number;
  rounds: number;
  holdoutFailures: number;
  metrics: {
    roundsToGreen: number | null;
    timeToHealMs: number | null;
    tokensTotal: number | null;
    kaneRuns: number;
    kaneCredits: number;
    falseGreen: boolean;
  };
  specTamper: boolean;
};

export type RunsIndex = {
  stats: {
    runs: number;
    bugsInjected: number;
    catches: number;
    misses: number;
    detectionRate: number;
    healed: number;
    avgTimeToHealMs: number;
    avgTokensPerHeal: number;
    falseGreens: number;
  };
  runs: RunSummary[];
};

export type RunEvent = { seq: number; t: number; ts: string; type: string; [k: string]: unknown };

export type LibraryBug = {
  id: string;
  title: string;
  bugClass: string;
  surface: string;
  description: string;
  edits: { file: string; find: string; replace: string }[];
  breaks: string[];
  kaneHypothesis: string;
  rationale: string;
};
