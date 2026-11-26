import type { Metadata } from "next";
import { PlayGame, type Shop } from "@/components/play-game";
import { SitePage } from "@/components/site";
import { Eyebrow } from "@/components/ui";
import { kaneEvidence } from "@/lib/arena";
import { getLibrary, getRun } from "@/lib/data";
import { SHOPS } from "@/lib/shops";

export const metadata: Metadata = { title: "Find the bug before Kane" };

export default async function Play() {
  const library = await getLibrary();
  const shops: Shop[] = await Promise.all(
    SHOPS.map(async (s) => {
      const run = await getRun(s.run);
      const k = run.referee?.kane;
      const ev = k ? kaneEvidence(k.summary) : "";
      return {
        slot: s.slot,
        url: s.url,
        bug: s.bug,
        bugText: library.find((b) => b.id === s.bug)?.description ?? s.bug,
        runId: s.run,
        kaneCaught: k?.verdict === "failed",
        kaneMs: k?.durationMs ?? 0,
        evidence: ev.length > 220 ? `${ev.slice(0, 220)}…` : ev,
      };
    }),
  );
  return (
    <SitePage>
      <div className="flex flex-col gap-8 px-[var(--pad-x)] py-[var(--section-y)]">
        <div>
          <Eyebrow>Play</Eyebrow>
          <h1 className="h2 mt-5">Find the bug before Kane</h1>
          <p className="mt-4 mb-0 max-w-[600px] text-[17px] leading-[1.5] text-text-2">
            Three live shops, one planted bug each. Follow the checkout, spot what&apos;s wrong, and beat Kane&apos;s recorded time.
          </p>
        </div>
        <PlayGame shops={shops} />
      </div>
    </SitePage>
  );
}
