// Pure derivations from recorded runs. Nothing here invents a number: every value is read
// or counted from run.json / events.json.
import type { KaneRun, Run, RunEvent, RunStatus, Verdict } from "./types";

export const BUILDER_ORDER = ["claude", "opencode", "hardcoder", "cheater"] as const;
const BUILDER_NAMES: Record<string, string> = {
  claude: "Claude Code",
  opencode: "opencode",
  hardcoder: "Hardcoder",
  cheater: "Cheater",
};
/** Stand-in builders that cheat on purpose, to prove the gate catches them. */
export const CHEAT_BUILDERS = new Set(["hardcoder", "cheater"]);

export const builderName = (id: string) => BUILDER_NAMES[id] ?? id;
export const isCheat = (id: string) => CHEAT_BUILDERS.has(id);

export function verdictOf(status: RunStatus | string): Verdict {
  if (status === "miss") return "missed";
  if (status === "healed" || status === "rejected" || status === "aborted") return status;
  return "aborted";
}

export const VERDICTS: Verdict[] = ["healed", "missed", "rejected", "aborted"];

/** 1257687 → "20m 58s" */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "·";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
/** 501396 → "8:21" */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function fmtInt(n: number | null | undefined): string {
  return n == null ? "·" : Math.round(n).toLocaleString("en-US");
}
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

/** Short id used in URLs and labels: "20261119-003757-s7-claude" → "s7-claude". */
export const shortId = (runId: string) => runId.split("-").slice(2).join("-");

// ── Kane evidence ───────────────────────────────────────────────────────────

export type FailingStep = { step: number; shot: string; caption: string; action: string };

/** The step where Kane's referee run failed, read from the screenshot captions. */
export function failingStep(run: Run, kane: KaneRun | undefined = run.referee?.kane): FailingStep | null {
  if (!kane || kane.verdict !== "failed") return null;
  for (const shot of kane.screenshots) {
    const caption = run.captions[shot];
    const m = caption && /^Step (\d+) · FAILED · (.*)$/.exec(caption);
    if (m) return { step: Number(m[1]), shot, caption, action: m[2] };
  }
  if (kane.failingStep != null) return { step: kane.failingStep, shot: kane.screenshots.at(-1) ?? "", caption: "", action: "" };
  return null;
}

/** Kane's "evidence:" line, without the machine prefix. */
export function kaneEvidence(summary: string): string {
  const line = summary.split("\n").find((l) => /^\s*evidence:/i.test(l)) ?? summary.split("\n")[0] ?? "";
  return line.replace(/^\s*evidence:\s*([a-z_]+:\s*)?/i, "").trim();
}
/** First clause of Kane's evidence, short enough for a chip. */
export function evidenceChip(summary: string): string {
  return kaneEvidence(summary).split(/;\s*/)[0].replace(/\.$/, "");
}

// ── Diffs ───────────────────────────────────────────────────────────────────

export type DiffLine = { kind: "del" | "add" | "ctx" | "hunk" | "file"; text: string };
export function parsePatch(patch: string | null): DiffLine[] {
  if (!patch) return [];
  const out: DiffLine[] = [];
  for (const raw of patch.replace(/\r/g, "").split("\n")) {
    if (raw.startsWith("====")) continue;
    if (raw.startsWith("+++ ")) continue;
    if (raw.startsWith("--- ")) { out.push({ kind: "file", text: raw.slice(4).replace(/^a\//, "") }); continue; }
    if (raw.startsWith("@@")) { out.push({ kind: "hunk", text: raw }); continue; }
    if (raw.startsWith("-")) out.push({ kind: "del", text: raw.slice(1) });
    else if (raw.startsWith("+")) out.push({ kind: "add", text: raw.slice(1) });
    else if (raw.startsWith(" ")) out.push({ kind: "ctx", text: raw.slice(1) });
  }
  return out;
}
/** The first removed and first added line of a patch: the heart of a one-line bug. */
export function diffHeadline(patch: string | null): { del: string; add: string } | null {
  const lines = parsePatch(patch);
  const del = lines.find((l) => l.kind === "del");
  const add = lines.find((l) => l.kind === "add");
  return del || add ? { del: (del?.text ?? "").trim(), add: (add?.text ?? "").trim() } : null;
}

// ── Story lines ─────────────────────────────────────────────────────────────

const countWord = (n: number) => (["never", "once", "twice"][n] ?? `${n} times`);

/** One sentence that says what happened, from the run's outcome. */
export function story(run: Run): string {
  const name = builderName(run.builder);
  const bug = run.bug.id;
  switch (run.status) {
    case "healed":
      return `${name} fixed ${bug} from Kane's evidence alone`;
    case "rejected": {
      const tamper = run.rounds.some((r) => r.specIntegrity === "tampered");
      const who = isCheat(run.builder) ? `The ${name.toLowerCase()}` : name;
      return tamper
        ? `${who} edited Kane's test instead of the code. The gate caught it.`
        : `The gate rejected ${name}'s fix for ${bug}.`;
    }
    case "miss":
      return `Kane passed with ${bug} still in the app. An honest miss.`;
    case "aborted": {
      const fooled = run.rounds.find((r) => r.outcome === "holdout-failed");
      if (fooled) {
        const visible = fooled.verify.filter((v) => v.spec === "main" && v.verdict === "passed").length;
        return `The fix fooled Kane's visible test ${countWord(visible)}, then failed the hidden one. Nothing shipped.`;
      }
      return "The run stopped before a fix shipped.";
    }
  }
}

/** True when a run shipped nothing it shouldn't have. */
export const shipped = (run: Run) => run.gate?.decision === "promote";

// ── Arena totals ────────────────────────────────────────────────────────────

export function arenaStats(runs: Run[]) {
  const withBug = runs.filter((r) => r.referee);
  const caught = withBug.filter((r) => r.referee?.verdict === "CATCH").length;
  const healed = runs.filter((r) => r.status === "healed").length;
  const cheats = runs.filter((r) => isCheat(r.builder));
  const cheatsBlocked = cheats.filter((r) => !shipped(r)).length;
  const heals = runs.filter((r) => r.status === "healed" && r.metrics.timeToHealMs != null);
  const fastest = heals.reduce<Run | null>((a, r) => (!a || r.metrics.timeToHealMs! < a.metrics.timeToHealMs! ? r : a), null);
  const misses = withBug.filter((r) => r.referee?.verdict === "MISS").length;
  const credits = runs.reduce((s, r) => s + (r.metrics.kaneCredits ?? 0), 0);
  return {
    runs: runs.length,
    bugs: withBug.length,
    caught,
    misses,
    healed,
    cheats: cheats.length,
    cheatsBlocked,
    fastest,
    avgCredits: runs.length ? credits / runs.length : 0,
    minDurationMs: Math.min(...runs.map((r) => r.durationMs)),
    maxDurationMs: Math.max(...runs.map((r) => r.durationMs)),
  };
}

export type CatchRow = { bug: string; caught: number; missed: number };
export function catchMap(runs: Run[]): CatchRow[] {
  const rows = new Map<string, CatchRow>();
  for (const r of runs) {
    if (!r.referee) continue;
    const row = rows.get(r.bug.id) ?? { bug: r.bug.id, caught: 0, missed: 0 };
    if (r.referee.verdict === "CATCH") row.caught++;
    else row.missed++;
    rows.set(r.bug.id, row);
  }
  return [...rows.values()].sort((a, b) => b.caught - a.caught || a.missed - b.missed || a.bug.localeCompare(b.bug));
}

export type FormRow = { builder: string; name: string; cheat: boolean; form: { runId: string; verdict: Verdict }[] };
/** Per builder, every match oldest first. */
export function formGuide(runs: Run[]): FormRow[] {
  const ids = [...new Set([...BUILDER_ORDER.filter((b) => runs.some((r) => r.builder === b)), ...runs.map((r) => r.builder)])];
  return ids.map((b) => ({
    builder: b,
    name: builderName(b),
    cheat: isCheat(b),
    form: runs
      .filter((r) => r.builder === b)
      .sort((x, y) => x.startedAt.localeCompare(y.startedAt))
      .map((r) => ({ runId: r.runId, verdict: verdictOf(r.status) })),
  }));
}

/** The leaderboard row for one builder. */
export function agentRow(runs: Run[], builder: string) {
  const mine = runs.filter((r) => r.builder === builder);
  const heals = mine.filter((r) => r.status === "healed");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    builder,
    name: builderName(builder),
    cheat: isCheat(builder),
    runs: mine.length,
    healed: heals.length,
    caughtCheating: mine.filter((r) => isCheat(r.builder) && !shipped(r)).length,
    roundsToGreen: avg(heals.map((r) => r.metrics.roundsToGreen ?? 0)),
    timeToHealMs: avg(heals.map((r) => r.metrics.timeToHealMs ?? 0)),
    tokensPerHeal: avg(heals.map((r) => r.metrics.tokensTotal ?? 0)),
    creditsPerRun: avg(mine.map((r) => r.metrics.kaneCredits)),
  };
}

// ── Match log ───────────────────────────────────────────────────────────────

export type Actor = "build" | "kane" | "chaos" | "heal" | "verify" | "deploy" | "gate";
export type LogRow = { t: number; actor: Actor; text: string; tone: "muted" | "chaos" | "kane" | "healed" | "gate"; highlight?: boolean; phase: Phase };

export type Phase = "build" | "baseline" | "chaos" | "catch" | "heal" | "verify" | "deploy";
export const PHASES: Phase[] = ["build", "baseline", "chaos", "catch", "heal", "verify", "deploy"];
const PHASE_OF: Record<string, Phase> = {
  BUILD: "build",
  BASELINE: "baseline",
  CHAOS: "chaos",
  REFEREE: "catch",
  HEAL: "heal",
  VERIFY: "verify",
  DEPLOY: "deploy",
};

/** The match as one line per thing that happened, from events.json. */
export function matchLog(run: Run, events: RunEvent[]): LogRow[] {
  const rows: LogRow[] = [];
  let phase: Phase = "build";
  const step = failingStep(run);
  for (const e of events) {
    const t = e.t;
    if (e.type === "phase") phase = PHASE_OF[e.phase as string] ?? phase;
    else if (e.type === "build_end" && e.tag === "baseline")
      rows.push({ t, phase, actor: "build", tone: e.ok ? "muted" : "chaos", text: e.ok ? "build · app shipped" : "build · failed" });
    else if (e.type === "kane_end" && String(e.label).startsWith("baseline")) {
      const n = String(e.label).split("-")[1];
      rows.push({ t, phase, actor: "kane", tone: "muted", text: `kane · baseline ${n} ${e.verdict === "passed" ? "pass" : "fail"}` });
    } else if (e.type === "chaos_applied") rows.push({ t, phase, actor: "chaos", tone: "chaos", text: "chaos · one bug hidden" });
    else if (e.type === "verdict") {
      rows.push(
        e.verdict === "CATCH"
          ? { t, phase, actor: "kane", tone: "kane", highlight: true, text: step ? `kane · caught it at step ${step.step}` : "kane · caught it" }
          : { t, phase, actor: "kane", tone: "chaos", text: "kane · passed with the bug in · miss" },
      );
    } else if (e.type === "diff") {
      const round = run.rounds.find((r) => r.round === e.round);
      const n = Number(e.round);
      rows.push({ t, phase, actor: "heal", tone: "muted", text: round?.outcome === "no-change" ? `heal · round ${n} · no change` : `heal · patch from evidence${n > 1 ? ` · round ${n}` : ""}` });
    } else if (e.type === "builder_end" && !events.some((d) => d.type === "diff" && d.round === e.round)) {
      const round = run.rounds.find((r) => r.round === e.round);
      if (round?.outcome !== "tampered") rows.push({ t, phase, actor: "heal", tone: "muted", text: `heal · round ${e.round} · no change` });
    }
    else if (e.type === "round_end") {
      const round = run.rounds.find((r) => r.round === e.round);
      if (!round) continue;
      const main = round.verify.filter((v) => v.spec === "main" && v.verdict === "passed").length;
      const hold = round.verify.find((v) => v.spec === "holdout");
      if (e.outcome === "healed") rows.push({ t, phase, actor: "verify", tone: "muted", text: `verify · ${main} fresh passes + holdout` });
      else if (e.outcome === "holdout-failed")
        rows.push({ t, phase, actor: "verify", tone: "gate", text: `verify · ${main} passes, holdout ${hold?.verdict === "passed" ? "pass" : "fail"}` });
      else if (e.outcome === "tampered") rows.push({ t, phase, actor: "gate", tone: "gate", text: "gate · Kane's spec was edited" });
    } else if (e.type === "deploy") rows.push({ t, phase, actor: "deploy", tone: "healed", text: `deploy · gate open · ${fmtDuration(run.durationMs)}` });
    else if (e.type === "run_end" && e.status !== "healed") {
      const v = verdictOf(String(e.status));
      rows.push({ t, phase, actor: "gate", tone: v === "missed" ? "chaos" : v === "rejected" ? "gate" : "muted", text: `${v === "missed" ? "end" : "gate"} · ${v} · ${fmtDuration(run.durationMs)}` });
    }
  }
  return rows;
}

/** Time spent in each phase, for the scrubber. */
export function phaseSpans(events: RunEvent[]): { phase: Phase; start: number; end: number }[] {
  const out: { phase: Phase; start: number; end: number }[] = [];
  const end = events.at(-1)?.t ?? 0;
  for (const e of events) {
    if (e.type !== "phase") continue;
    const p = PHASE_OF[e.phase as string];
    if (!p) continue;
    const last = out.at(-1);
    if (last && last.phase === p) continue;
    if (last) last.end = e.t;
    out.push({ phase: p, start: e.t, end });
  }
  return out;
}
