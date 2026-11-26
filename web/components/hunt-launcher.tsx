"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, cx } from "./ui";

export type HuntLauncherProps = { shops: { slot: string; label: string }[]; minutes: string; credits: number; dailyLimit: number };
type Runner = { configured: boolean; online: boolean; queued: number };

/** Polls whether the runner machine is online. */
export function useRunner(): Runner | null {
  const [runner, setRunner] = useState<Runner | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/runner/status", { cache: "no-store" })
        .then((r) => r.json())
        .then((r: Runner) => live && setRunner(r))
        .catch(() => live && setRunner({ configured: false, online: false, queued: 0 }));
    load();
    const t = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return runner;
}

export function RunnerBadge({ runner }: { runner: Runner | null }) {
  const [dot, text] = !runner
    ? ["bg-faint", "Checking the runner…"]
    : !runner.configured
      ? ["bg-faint", "Live hunts aren't switched on for this deployment yet."]
      : runner.online
        ? ["bg-healed", runner.queued ? `Runner online · ${runner.queued} hunt${runner.queued === 1 ? "" : "s"} waiting` : "Runner online · no queue"]
        : ["bg-faint", "Runner offline right now. Hunts open again when it's back."];
  return (
    <span className="meta inline-flex items-center gap-2">
      <span aria-hidden="true" className={cx("size-2 rounded-full", dot, runner?.online && "animate-pulse")} />
      {text}
    </span>
  );
}

export function HuntLauncher({ shops, minutes, credits, dailyLimit }: HuntLauncherProps) {
  const session = useSession();
  const router = useRouter();
  const runner = useRunner();
  const [shop, setShop] = useState("sealed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; id?: string } | null>(null);
  const options = [...shops, { slot: "sealed", label: "Sealed" }];

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/hunts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shop }) });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.ok && body.id) {
        router.push(`/hunts/${body.id}`);
        return;
      }
      setError({ text: body.error ?? `Couldn't start the hunt (HTTP ${res.status}).`, id: body.id });
    } catch {
      setError({ text: "Couldn't reach the site. Check your connection and try again." });
    }
    setBusy(false);
  }

  return (
    <Card className="max-w-[720px] p-8">
      <h2 className="m-0 text-[26px] font-medium tracking-[-0.02em]">Run a live Kane hunt</h2>
      <p className="mt-2 mb-6 text-[15px] leading-[1.45] text-text-2">
        Pick a shop. Each one has a bug planted in it, and you aren&apos;t told which. Kane CLI walks the whole checkout in a real browser on the Hydra runner, and you
        watch every step as it happens.
      </p>

      <fieldset className="m-0 border-0 p-0">
        <legend className="meta mb-2 block">Shop</legend>
        <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
          {options.map((o) => (
            <label
              key={o.slot}
              className={cx(
                "flex cursor-pointer flex-col gap-1 rounded-btn border px-3 py-3 transition-colors",
                shop === o.slot ? "border-kane bg-kane-tint" : "border-line bg-frame hover:bg-inset",
              )}
            >
              <input type="radio" name="shop" value={o.slot} checked={shop === o.slot} onChange={() => setShop(o.slot)} className="sr-only" />
              <span className="text-[15px] font-medium">{o.label}</span>
              <span className="meta text-[12px]">{o.slot === "sealed" ? "random, revealed at the end" : "one hidden bug"}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <dl className="mt-6 mb-0 grid grid-cols-3 gap-3 border-t border-line pt-5 max-sm:grid-cols-1">
        <div>
          <dt className="meta">Takes about</dt>
          <dd className="m-0 mt-1 text-[20px] font-medium">{minutes} min</dd>
        </div>
        <div>
          <dt className="meta">Kane credits</dt>
          <dd className="m-0 mt-1 text-[20px] font-medium">about {credits}</dd>
          <dd className="meta m-0 mt-1 text-[12px]">covered by Hydra</dd>
        </div>
        <div>
          <dt className="meta">Daily limit</dt>
          <dd className="m-0 mt-1 text-[20px] font-medium">{dailyLimit} per person</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-3">
        <RunnerBadge runner={runner} />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={start} disabled={busy || !runner?.online}>
            {busy ? "Starting…" : "Start the hunt"}
          </Button>
          <span className="meta">
            {session.status === "authenticated" ? `Signed in as ${session.data.user.login ?? session.data.user.name}` : "No sign-in needed"}
          </span>
        </div>
        {error && (
          <p role="alert" className="mono m-0 rounded-chip bg-chaos-tint px-3 py-2.5 text-[13px] text-chaos">
            {error.text}
            {error.id && (
              <>
                {" "}
                <Link href={`/hunts/${error.id}`} className="text-chaos underline underline-offset-[3px]">
                  Open it
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </Card>
  );
}
