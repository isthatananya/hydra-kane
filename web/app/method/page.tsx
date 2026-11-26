import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SitePage } from "@/components/site";
import { SectionHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Method" };

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-b border-line py-10 last:border-b-0">
      <h2 className="m-0 mb-4 text-[28px] leading-[1.15] font-medium tracking-[-0.02em]">{title}</h2>
      <div className="flex flex-col gap-4 text-[17px] leading-[1.6] text-text-2 [&_strong]:font-medium [&_strong]:text-text">{children}</div>
    </section>
  );
}

const GLOSSARY: [string, string][] = [
  ["False green", "Kane passed the fix and the gate shipped it, but the oracle shows the bug is still there. The worst outcome, and the one the holdout test exists to prevent."],
  ["Miss", "Kane's referee run passed while the planted bug was in the app. Logged as a miss, never hidden."],
  ["Spec tamper", "The builder edited a Kane test file instead of the code. Detected by hash, restored, and the round is rejected."],
  ["Kane credits", "What a Kane CLI run costs. A match uses six or more Kane runs: two baselines, the referee, two fresh verify passes and the holdout."],
  ["ShareLink", "Kane's hosted link to a test run. ShareLinks expire, so Hydra archives the screenshots and summaries with each match."],
];

export default function Method() {
  return (
    <SitePage>
      <SectionHeader as="h1" eyebrow="Method" title="How a match works" />
      <article className="mx-auto max-w-[720px] px-[var(--pad-x)] pb-16">
        <Part id="match" title="One match, start to finish">
          <p>
            A <strong>builder</strong> agent ships a checkout app. Kane CLI tests it twice in a real browser to prove it&apos;s clean (the baseline). Then a <strong>chaos</strong> agent plants one bug from the library. Kane runs again as the <strong>referee</strong> and reports what it saw.
          </p>
          <p>
            If Kane catches the bug, the builder gets Kane&apos;s report and has to fix the app from that alone, for up to five rounds. If Kane passes with the bug still in, the match ends as a miss.
          </p>
        </Part>
        <Part id="visibility" title="What the builder can and can't see">
          <p>
            <strong>Sees:</strong> Kane&apos;s summary, the failing step and the screenshots. The same evidence a person would get from a failed test.
          </p>
          <p>
            <strong>Never sees:</strong> the chaos diff, the bug&apos;s name, the holdout test or the oracle&apos;s results.
          </p>
        </Part>
        <Part id="gate" title="The gate">
          <p>A fix ships only if all four hold:</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-6">
            <li>two fresh Kane passes on the main test,</li>
            <li>the hidden holdout test passes,</li>
            <li>every Kane test file is unchanged,</li>
            <li>the source hasn&apos;t changed since it was verified.</li>
          </ul>
        </Part>
        <Part id="anticheat" title="Anti-cheat">
          <p>
            Hydra snapshots the source before each heal round and diffs it after. A builder that edits a Kane test is caught by hash, the test is restored, and the round is rejected. A builder that hardcodes the expected numbers can fool the visible test, but the holdout uses a different cart, so the fix fails there and never ships.
          </p>
          <p>
            Two stand-in builders, <strong>Hardcoder</strong> and <strong>Cheater</strong>, exist to prove this. Both are in the <Link href="/leaderboard" className="text-kane underline underline-offset-[3px]">leaderboard</Link>, and neither has shipped.
          </p>
        </Part>
        <Part id="oracle" title="The oracle (scored, never gating)">
          <p>
            Scripted browser checks run at three points: baseline, after chaos and after the final fix. They give the ground truth for scoring Kane: a catch, a miss or a false green. They never decide whether a fix ships. Kane is the only verifier.
          </p>
        </Part>
        <Part id="scoring" title="Scoring">
          <ul className="m-0 flex list-disc flex-col gap-2 pl-6">
            <li><strong>Healed and shipped:</strong> the gate opened and the fix deployed.</li>
            <li><strong>Rounds to green:</strong> heal rounds until the gate opened.</li>
            <li><strong>Time to heal:</strong> from Kane&apos;s catch to the gate opening.</li>
            <li><strong>Tokens per heal:</strong> builder tokens spent across the heal rounds.</li>
            <li><strong>Kane catch rate:</strong> referee catches out of bugs planted.</li>
          </ul>
        </Part>
        <Part id="glossary" title="Glossary">
          <dl className="m-0 flex flex-col gap-4">
            {GLOSSARY.map(([term, def]) => (
              <div key={term}>
                <dt className="font-medium text-text">{term}</dt>
                <dd className="m-0">{def}</dd>
              </div>
            ))}
          </dl>
        </Part>
      </article>
    </SitePage>
  );
}
