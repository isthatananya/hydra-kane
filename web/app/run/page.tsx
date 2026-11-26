import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { RunForm } from "@/components/run-form";
import { arenaStats, builderName, isCheat } from "@/lib/arena";
import { getLibrary, getRuns } from "@/lib/data";

export const metadata: Metadata = { title: "New match" };

export default async function RunPage() {
  const [runs, library] = await Promise.all([getRuns(), getLibrary()]);
  const stats = arenaStats(runs);
  const credits = runs.map((r) => r.metrics.kaneCredits);
  return (
    <AppShell active="run" crumbs={["Dashboard", "New match"]}>
      <div className="flex flex-col gap-6 px-[var(--pad-x)] py-8">
        <h1 className="m-0 text-[38px] leading-[1.05] font-medium tracking-[-0.03em]">New match</h1>
        <Suspense>
          <RunForm
            recorded={runs.map((r) => ({ runId: r.runId, builder: r.builder, builderName: builderName(r.builder), bug: r.bug.id, seed: r.seed }))}
            builders={[
              ...[...new Set(runs.map((r) => r.builder))].filter((b) => !isCheat(b)).map((b) => ({ value: b, label: builderName(b) })),
              { value: "custom", label: "Your agent" },
            ]}
            bugs={library.map((b) => b.id)}
            minMinutes={Math.round(stats.minDurationMs / 60000)}
            maxMinutes={Math.round(stats.maxDurationMs / 60000)}
            avgCredits={Math.round(stats.avgCredits)}
            minCredits={Math.round(Math.min(...credits))}
            maxCredits={Math.round(Math.max(...credits))}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}
