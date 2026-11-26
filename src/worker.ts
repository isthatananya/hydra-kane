/**
 * `hydra worker`: runs the Kane hunts that judges queue on the Hydra site.
 *
 * The site holds the queue; this process only makes outbound HTTPS calls, so it runs on any
 * machine with a Kane login (a laptop behind NAT is fine). Each hunt is one Kane CLI run of the
 * main checkout flow against a live shop that has one planted bug. Kane's steps stream back to
 * the site as they happen, so the judge watches the hunt live.
 */
import { join } from "node:path";
import { resolvePath, stateDir, type HydraConfig } from "./config.js";
import { runKane, type KaneResult } from "./kane/wrapper.js";
import { parseSpec } from "./spec.js";
import { ensureDir } from "./util/fs.js";
import { log } from "./util/log.js";

/** The only URLs a hunt can target. The site sends a slot, never a URL. */
export const HUNT_SHOPS = {
  a: "https://hydra-shop-a.vercel.app/",
  b: "https://hydra-shop-b.vercel.app/",
  c: "https://hydra-shop-c.vercel.app/",
} as const;
export type ShopSlot = keyof typeof HUNT_SHOPS;

type Job = { id: string; shop: string; login?: string | null };
type Step = { t: number; step: number; status: "done" | "failed"; text: string };
export type HuntResult = {
  verdict: KaneResult["verdict"];
  oneLiner: string | null;
  summary: string | null;
  failingStep: KaneResult["failingStep"];
  testUrl: string | null;
  credits: number | null;
  durationMs: number;
  infraReason: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = 4000;
const FLUSH_MS = 1500;
const HEARTBEAT_MS = 15000;

class RunnerAuthError extends Error {}

function client(site: string, token: string) {
  return async (path: string, body: unknown = {}): Promise<Response> => {
    const res = await fetch(new URL(path, site), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401) throw new RunnerAuthError("The site rejected HYDRA_RUNNER_TOKEN. Use the same value the site has.");
    return res;
  };
}

export async function runWorker(cfg: HydraConfig, opts: { site: string; token: string; once?: boolean }): Promise<void> {
  const post = client(opts.site, opts.token);
  log.ok(`worker online for ${opts.site} · waiting for hunts (Ctrl+C to stop)`);
  let idle = 0;
  for (;;) {
    let job: Job | null = null;
    try {
      const res = await post("/api/runner/claim");
      if (res.status === 200) job = (await res.json()) as Job;
      else if (res.status !== 204) log.warn(`claim: HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof RunnerAuthError) throw err;
      log.warn(`claim failed: ${(err as Error).message}`);
    }
    if (!job) {
      if (++idle % 75 === 0) log.info("still waiting for hunts");
      await sleep(POLL_MS);
      continue;
    }
    idle = 0;
    await runJob(cfg, post, job);
    if (opts.once) return;
  }
}

async function runJob(cfg: HydraConfig, post: ReturnType<typeof client>, job: Job): Promise<void> {
  const url = HUNT_SHOPS[job.shop as ShopSlot];
  log.step("HUNT", `${job.id} · shop ${job.shop}${job.login ? ` · for ${job.login}` : ""}`);
  if (!url) {
    await finish(post, job.id, { verdict: "error", oneLiner: null, summary: null, failingStep: null, testUrl: null, credits: null, durationMs: 0, infraReason: `Unknown shop "${job.shop}"` });
    return;
  }

  // Kane's flow expects a fresh store (the order number is ORD-1001).
  await fetch(new URL("api/reset", url), { method: "POST", signal: AbortSignal.timeout(10000) }).catch(() => undefined);

  const started = Date.now();
  let pending: Step[] = [];
  let lastSent = Date.now();
  const flush = async (force = false) => {
    if (!pending.length && !force) return;
    const steps = pending;
    pending = [];
    lastSent = Date.now();
    try {
      await post(`/api/runner/hunts/${encodeURIComponent(job.id)}/steps`, { steps });
    } catch (err) {
      if (err instanceof RunnerAuthError) throw err;
      pending = [...steps, ...pending]; // retry on the next tick
    }
  };
  const timer = setInterval(() => {
    void flush(Date.now() - lastSent > HEARTBEAT_MS).catch(() => undefined);
  }, FLUSH_MS);

  let result: KaneResult | null = null;
  let crash: string | null = null;
  try {
    result = await runKane(cfg, {
      spec: parseSpec(resolvePath(cfg, cfg.specs.main)),
      url,
      outDir: ensureDir(join(stateDir(cfg), "hunts", job.id)),
      label: "hunt",
      onEvent: (ev) => {
        const status = ev.status;
        if (typeof ev.step !== "number" || (status !== "done" && status !== "failed")) return;
        const text = typeof ev.remark === "string" ? ev.remark.slice(0, 300) : `Step ${ev.step}`;
        pending.push({ t: Date.now() - started, step: ev.step, status, text });
      },
    });
  } catch (err) {
    crash = (err as Error).message;
  } finally {
    clearInterval(timer);
  }
  await flush().catch(() => undefined);

  const oneLiner = result?.runEnd && typeof result.runEnd.one_liner === "string" ? result.runEnd.one_liner : null;
  await finish(post, job.id, {
    verdict: result?.verdict ?? "error",
    oneLiner,
    summary: result?.summary ?? null,
    failingStep: result?.failingStep ?? null,
    testUrl: result?.testUrl ?? null,
    credits: result?.credits ?? null,
    durationMs: result?.durationMs ?? Date.now() - started,
    infraReason: crash ?? result?.infraReason ?? null,
  });
  const v = result?.verdict;
  const line = `${job.id} · ${v === "failed" ? "CATCH" : v === "passed" ? "MISS" : `ERROR (${crash ?? result?.infraReason ?? "unknown"})`}`;
  if (v === "failed" || v === "passed") log.ok(line);
  else log.error(line);
}

async function finish(post: ReturnType<typeof client>, id: string, result: HuntResult): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await post(`/api/runner/hunts/${encodeURIComponent(id)}/finish`, result);
      if (res.ok) return;
      log.warn(`finish: HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof RunnerAuthError) throw err;
      log.warn(`finish failed: ${(err as Error).message}`);
    }
    await sleep(2000 * (attempt + 1));
  }
}
