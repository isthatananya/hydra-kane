import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/site";
import { Card, SectionHeader, VerdictPill } from "@/components/ui";
import { builderName, fmtDuration, story, verdictOf } from "@/lib/arena";
import { getLibrary, getRuns } from "@/lib/data";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getLibrary()).map((b) => ({ id: b.id }));
}

export async function generateMetadata({ params }: PageProps<"/bugs/[id]">): Promise<Metadata> {
  return { title: `Bug · ${(await params).id}` };
}

export default async function BugPage({ params }: PageProps<"/bugs/[id]">) {
  const { id } = await params;
  const [library, runs] = await Promise.all([getLibrary(), getRuns()]);
  const bug = library.find((b) => b.id === id);
  if (!bug) notFound();
  const mine = runs.filter((r) => r.bug.id === id);
  return (
    <SitePage>
      <SectionHeader as="h1" eyebrow={`Bug library · ${bug.bugClass} · ${bug.surface}`} title={bug.title} />
      <div className="flex max-w-[960px] flex-col gap-3 px-[var(--pad-x)] py-10">
        <p className="m-0 text-[17px] leading-[1.5] text-text-2">{bug.description}</p>
        <p className="meta m-0 leading-[1.6]">
          Breaks: {bug.breaks.join(", ")} · expected from Kane: {bug.kaneHypothesis} · {bug.rationale}
        </p>
        <Card className="p-6">
          <h2 className="m-0 mb-4 text-[22px] font-medium tracking-[-0.02em]">The diff</h2>
          {bug.edits.map((e, i) => (
            <pre key={i} className="m-0 mb-3 overflow-x-auto rounded-inner border border-line bg-frame p-4 text-[12px] leading-[1.7] last:mb-0">
              <div className="text-muted">{e.file}</div>
              {e.find.split("\n").map((l, j) => (
                <div key={`f${j}`} className="text-chaos">
                  - {l}
                </div>
              ))}
              {e.replace.split("\n").map((l, j) => (
                <div key={`r${j}`} className="text-healed">
                  + {l}
                </div>
              ))}
            </pre>
          ))}
        </Card>
        <Card>
          <h2 className="m-0 border-b border-line px-6 py-4 text-[22px] font-medium tracking-[-0.02em]">Matches</h2>
          {mine.length ? (
            mine.map((r) => (
              <Link
                key={r.runId}
                href={`/matches/${r.runId}`}
                className="row-link grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-6 py-4 last:border-b-0 max-sm:grid-cols-1"
              >
                <VerdictPill verdict={verdictOf(r.status)} />
                <span>{story(r)}</span>
                <span className="meta">
                  {builderName(r.builder)} · seed {r.seed} · {fmtDuration(r.durationMs)}
                </span>
              </Link>
            ))
          ) : (
            <p className="meta m-0 px-6 py-6">No recorded match has planted this bug yet.</p>
          )}
        </Card>
      </div>
    </SitePage>
  );
}
