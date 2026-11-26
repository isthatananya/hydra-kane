import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Replay, type ReplayData } from "@/components/replay";
import { Frame, Header } from "@/components/site";
import { builderName, failingStep, isCheat, kaneEvidence, matchLog, parsePatch, phaseSpans, verdictOf } from "@/lib/arena";
import { fileExists, fileUrl, getEvents, getIndex, getPatch, getRun } from "@/lib/data";
import type { KaneRun } from "@/lib/types";

export const dynamicParams = false;

export async function generateStaticParams() {
  const index = await getIndex();
  return index.runs.map((r) => ({ id: r.runId }));
}

export async function generateMetadata({ params }: PageProps<"/matches/[id]">): Promise<Metadata> {
  const { id } = await params;
  const run = await getRun(id);
  return { title: `Match · ${builderName(run.builder)} · seed ${run.seed}` };
}

export default async function MatchPage({ params }: PageProps<"/matches/[id]">) {
  const { id } = await params;
  const index = await getIndex();
  if (!index.runs.some((r) => r.runId === id)) notFound();
  const [run, events, chaosPatch] = await Promise.all([getRun(id), getEvents(id), getPatch(id, (await getRun(id)).chaosDiff)]);

  const kaneAll: KaneRun[] = [...run.baseline, ...(run.referee ? [run.referee.kane] : []), ...run.rounds.flatMap((r) => r.verify)];
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  for (const e of events) {
    if (e.type === "kane_start") starts.set(String(e.label), e.t);
    if (e.type === "kane_end") ends.set(String(e.label), e.t);
  }
  const step = failingStep(run);
  const kane = kaneAll
    .filter((k) => starts.has(k.label))
    .map((k) => {
      const fail = k === run.referee?.kane ? step : failingStep(run, k);
      return {
        label: k.label,
        spec: k.spec,
        start: starts.get(k.label)!,
        end: ends.get(k.label) ?? starts.get(k.label)!,
        verdict: k.verdict,
        failStep: fail?.step ?? null,
        failShot: fail && fileExists(id, fail.shot) ? fileUrl(id, fail.shot) : null,
        failAction: fail?.action ?? null,
        shots: k.screenshots.filter((s) => fileExists(id, s)).map((s) => ({ src: fileUrl(id, s), caption: run.captions[s] ?? "" })),
      };
    });

  const verdictEvent = events.find((e) => e.type === "verdict");
  const data: ReplayData = {
    runId: id,
    seed: run.seed,
    builder: builderName(run.builder),
    cheat: isCheat(run.builder),
    bug: { id: run.bug.id, title: run.bug.title, description: run.bug.description, surface: run.bug.surface },
    verdict: verdictOf(run.status),
    statusReason: run.statusReason,
    total: events.at(-1)?.t ?? run.durationMs,
    times: [...new Set(events.map((e) => e.t))].sort((a, b) => a - b),
    eventTimes: events.map((e) => e.t),
    catchT: verdictEvent?.verdict === "CATCH" ? verdictEvent.t : null,
    log: matchLog(run, events),
    spans: phaseSpans(events),
    kane,
    chaosDiff: parsePatch(chaosPatch),
    evidence: run.referee
      ? {
          verdict: run.referee.kane.verdict,
          summary: run.referee.kane.summary,
          line: kaneEvidence(run.referee.kane.summary),
          step: step?.step ?? null,
          action: step?.action ?? null,
          shot: step && fileExists(id, step.shot) ? fileUrl(id, step.shot) : null,
        }
      : null,
    gate: run.gate,
    oracle: ["baseline", "chaos", "final"].map((phase) => {
      const p = run.groundTruth[phase as "baseline" | "chaos" | "final"];
      return { phase, available: p?.available ?? false, results: p?.results ?? [] };
    }),
    credits: run.metrics.kaneCredits,
    kaneRuns: run.metrics.kaneRuns,
  };

  return (
    <Frame>
      <Header />
      <Replay data={data} />
    </Frame>
  );
}
