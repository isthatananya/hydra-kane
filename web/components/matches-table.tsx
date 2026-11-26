"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Verdict } from "@/lib/types";
import { SegmentedToggle } from "./segmented-toggle";
import { VerdictPill } from "./ui";

export type MatchRow = {
  runId: string;
  verdict: Verdict;
  builder: string;
  bug: string;
  seed: number;
  duration: string;
  rounds: string;
  tokens: string;
  started: string;
  startedIso: string;
};

type Filter = "all" | "healed" | "rejected" | "missed";

export function MatchesTable({ rows }: { rows: MatchRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === "all" || r.verdict === filter) &&
        (!needle || [r.builder, r.bug, `seed ${r.seed}`, r.verdict, r.runId].some((s) => s.toLowerCase().includes(needle))),
    );
  }, [rows, filter, q]);

  const th = "py-3 pr-4 text-left font-normal whitespace-nowrap";
  const td = "py-3.5 pr-4 whitespace-nowrap";
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <h2 className="m-0 mr-auto text-[22px] font-medium tracking-[-0.02em]">Matches</h2>
        <SegmentedToggle
          label="Filter by verdict"
          value={filter}
          onChange={setFilter}
          segments={[
            { value: "all", label: "All" },
            { value: "healed", label: "Healed" },
            { value: "rejected", label: "Rejected" },
            { value: "missed", label: "Missed" },
          ]}
        />
        <label className="relative">
          <span className="sr-only">Search matches</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search builder, bug, seed"
            className="mono w-[220px] rounded-btn border border-line bg-frame px-3 py-2 text-[13px] text-text placeholder:text-muted"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-[14px]">
          <thead className="mono text-[12px] text-muted">
            <tr className="border-b border-line">
              <th scope="col" className={`${th} pl-6`}>verdict</th>
              <th scope="col" className={th}>builder</th>
              <th scope="col" className={th}>bug</th>
              <th scope="col" className={th}>seed</th>
              <th scope="col" className={th}>duration</th>
              <th scope="col" className={th}>rounds to green</th>
              <th scope="col" className={th}>tokens</th>
              <th scope="col" className={th}>started</th>
              <th scope="col" className={`${th} pr-6 text-right`}>replay</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.runId}
                className="row-link cursor-pointer border-b border-line last:border-b-0"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  router.push(`/matches/${r.runId}`);
                }}
              >
                <td className={`${td} pl-6`}>
                  <VerdictPill verdict={r.verdict} />
                </td>
                <td className={td}>{r.builder}</td>
                <td className={`${td} mono text-[13px]`}>{r.bug}</td>
                <td className={`${td} meta`}>{r.seed}</td>
                <td className={`${td} meta`}>{r.duration}</td>
                <td className={`${td} meta`}>{r.rounds}</td>
                <td className={`${td} meta`}>{r.tokens}</td>
                <td className={`${td} meta`}>
                  <time dateTime={r.startedIso}>{r.started}</time>
                </td>
                <td className={`${td} pr-6 text-right`}>
                  <Link href={`/matches/${r.runId}`} className="text-kane underline underline-offset-[3px]" aria-label={`Replay ${r.builder}, ${r.bug}, seed ${r.seed}`}>
                    Replay →
                  </Link>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={9} className="meta px-6 py-10 text-center">
                  No matches fit that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
