"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { HuntLauncher, type HuntLauncherProps } from "./hunt-launcher";
import { SegmentedToggle } from "./segmented-toggle";
import { Button, ButtonLink, Card, cx } from "./ui";

export type RecordedPick = { runId: string; builder: string; builderName: string; bug: string; seed: number };
export type RunFormProps = {
  recorded: RecordedPick[];
  builders: { value: string; label: string }[];
  bugs: string[];
  minMinutes: number;
  maxMinutes: number;
  avgCredits: number;
  minCredits: number;
  maxCredits: number;
  hunt: HuntLauncherProps;
};

const field = "mono w-full rounded-btn border border-line bg-frame px-3 py-2.5 text-[14px] text-text";
const label = "meta mb-2 block";

export function RunForm(p: RunFormProps) {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<"instant" | "live">(params.get("mode") === "live" ? "live" : "instant");

  // Instant: only builder × bug pairs that were actually recorded.
  const recordedBuilders = useMemo(() => [...new Map(p.recorded.map((r) => [r.builder, r.builderName])).entries()], [p.recorded]);
  const [iBuilder, setIBuilder] = useState(recordedBuilders[0]?.[0] ?? "");
  const bugsFor = p.recorded.filter((r) => r.builder === iBuilder);
  const [iRun, setIRun] = useState(bugsFor[0]?.runId ?? "");
  const pick = p.recorded.find((r) => r.runId === iRun && r.builder === iBuilder) ?? bugsFor[0];

  // Live.
  const wanted = params.get("builder");
  const [lBuilder, setLBuilder] = useState(p.builders.some((b) => b.value === wanted) ? wanted! : p.builders[0].value);
  const [lBug, setLBug] = useState("sealed");
  const [seed, setSeed] = useState(7);
  const cli = `node bin/hydra.js run --seed ${seed}${lBuilder !== "custom" ? ` --builder ${lBuilder}` : ""}${lBug !== "sealed" ? ` --bug ${lBug}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <SegmentedToggle
        label="Match type"
        value={mode}
        onChange={setMode}
        className="self-start"
        segments={[
          { value: "instant", label: "Instant · free" },
          { value: "live", label: "Live · Kane hunt" },
        ]}
      />

      {mode === "instant" ? (
        <Card className="max-w-[720px] p-8">
          <h2 className="m-0 text-[26px] font-medium tracking-[-0.02em]">Watch a recorded match</h2>
          <p className="mt-2 mb-6 text-[15px] leading-[1.4] text-text-2">Free, no sign-in. It opens the replay with spoilers off, so the bug and the verdict stay hidden until the end.</p>
          <form
            className="grid grid-cols-2 gap-4 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (pick) router.push(`/matches/${pick.runId}`);
            }}
          >
            <div>
              <label htmlFor="i-builder" className={label}>Builder</label>
              <select
                id="i-builder"
                className={field}
                value={iBuilder}
                onChange={(e) => {
                  setIBuilder(e.target.value);
                  setIRun(p.recorded.find((r) => r.builder === e.target.value)?.runId ?? "");
                }}
              >
                {recordedBuilders.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="i-bug" className={label}>Bug</label>
              <select id="i-bug" className={field} value={pick?.runId ?? ""} onChange={(e) => setIRun(e.target.value)}>
                {bugsFor.map((r) => (
                  <option key={r.runId} value={r.runId}>{r.bug} · seed {r.seed}</option>
                ))}
              </select>
            </div>
            <div className="col-span-full mt-2">
              <Button type="submit" size="lg">Open the replay</Button>
            </div>
          </form>
        </Card>
      ) : (
        <>
          <HuntLauncher {...p.hunt} />
          <Card className="max-w-[720px] p-8">
            <h2 className="m-0 text-[22px] font-medium tracking-[-0.02em]">Run a full match on your machine</h2>
            <p className="mt-2 mb-6 text-[15px] leading-[1.4] text-text-2">
              A full match builds the app, plants a bug, has Kane referee it and lets your agent heal it from Kane&apos;s evidence alone. It runs {p.minMinutes}–{p.maxMinutes} minutes and uses about {p.avgCredits} Kane credits ({p.minCredits}–{p.maxCredits} in recorded matches), so it runs with your own Kane login.
            </p>
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <div>
                <label htmlFor="l-builder" className={label}>Builder</label>
                <select id="l-builder" className={field} value={lBuilder} onChange={(e) => setLBuilder(e.target.value)}>
                  {p.builders.map((b) => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="l-bug" className={label}>Bug</label>
                <select id="l-bug" className={field} value={lBug} onChange={(e) => setLBug(e.target.value)}>
                  <option value="sealed">Sealed · random, hidden until the verdict</option>
                  {p.bugs.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-full">
                <label htmlFor="l-seed" className={label}>Seed</label>
                <div className="flex gap-2">
                  <input id="l-seed" type="number" min={1} className={field} value={seed} onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} />
                  <Button variant="secondary" onClick={() => setSeed(1 + Math.floor(Math.random() * 999))}>Randomise</Button>
                </div>
              </div>
            </div>
            <div className="mt-6 rounded-inner border border-line bg-frame p-4">
              <div className="meta mb-2">After npm install, npm run build and kane-cli login</div>
              <code className="block text-[13px] break-all text-text">{cli}</code>
            </div>
            <p className={cx("meta mt-4 mb-0")}>
              Or <Link href="/dashboard" className="text-kane underline underline-offset-[3px]">watch a recorded match</Link>.
            </p>
          </Card>
        </>
      )}
      <div>
        <ButtonLink href="/method" variant="secondary">How a match works</ButtonLink>
      </div>
    </div>
  );
}
