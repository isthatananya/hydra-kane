"use client";

import { useState } from "react";
import { SegmentedToggle } from "./segmented-toggle";
import { Redacted } from "./ui";

type View = "builder" | "god";

/** Bento tile: the injected diff, which the builder never sees. */
export function GodViewTile({ del, add, file }: { del: string; add: string; file: string }) {
  const [view, setView] = useState<View>("god");
  const god = view === "god";
  return (
    <div className="card col-span-2 col-start-1 row-span-2 row-start-1 flex flex-col gap-6 p-8 max-sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="meta">God view</span>
        <SegmentedToggle
          label="Whose view"
          value={view}
          onChange={setView}
          segments={[
            { value: "builder", label: "Builder's view" },
            { value: "god", label: "God view" },
          ]}
        />
      </div>
      <h3 className="m-0 max-w-[440px] text-[32px] leading-[1.1] font-medium tracking-[-0.03em]">See exactly what the builder was never shown</h3>
      <div className="mono flex flex-1 flex-col justify-center rounded-inner border border-line bg-frame p-5 text-[13px] leading-[2] [overflow-wrap:anywhere]">
        <div className="text-muted">injected diff · {file || "from run data"}</div>
        <div className="text-chaos">
          - <Redacted revealed={god}>{del}</Redacted>
        </div>
        <div className="text-healed">
          + <Redacted revealed={god}>{add}</Redacted>
        </div>
        <div className="mt-4 text-muted">builder saw</div>
        <div>
          <Redacted>the injected diff, hidden</Redacted>
        </div>
        <div>
          <Redacted>bug name hidden</Redacted> <span className="text-muted">· only Kane&apos;s report</span>
        </div>
      </div>
    </div>
  );
}
