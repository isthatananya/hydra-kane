import type { Metadata } from "next";
import Link from "next/link";
import { SitePage } from "@/components/site";
import { SectionHeader } from "@/components/ui";
import { getLibrary, getRuns } from "@/lib/data";

export const metadata: Metadata = { title: "Bug library" };

export default async function Bugs() {
  const [library, runs] = await Promise.all([getLibrary(), getRuns()]);
  return (
    <SitePage>
      <SectionHeader as="h1" eyebrow="Bug library" title="Every bug chaos can plant" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3 px-[var(--pad-x)] py-10">
        {library.map((b) => {
          const mine = runs.filter((r) => r.bug.id === b.id && r.referee);
          const caught = mine.filter((r) => r.referee?.verdict === "CATCH").length;
          return (
            <Link key={b.id} href={`/bugs/${b.id}`} className="card row-link flex flex-col gap-3 p-6 hover:text-text">
              <span className="mono text-[15px] text-text">{b.id}</span>
              <p className="m-0 text-[15px] leading-[1.4] text-text-2">{b.description}</p>
              <div className="meta mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[12px]">
                <span>
                  {b.bugClass} · {b.surface}
                </span>
                <span>{mine.length ? `Kane caught ${caught}/${mine.length}` : "Kane catch rate: not played yet"}</span>
                <span>
                  {mine.length} {mine.length === 1 ? "match" : "matches"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </SitePage>
  );
}
