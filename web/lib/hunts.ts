import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { kv, kv1, kvMode } from "./kv";
import { SHOPS, shopBySlot } from "./shops";

/**
 * Live Kane hunts. A signed-in judge queues one; `hydra worker` (on the runner machine) claims it,
 * runs Kane CLI against a live shop and streams the steps back here.
 */

export type HuntState = "queued" | "running" | "caught" | "missed" | "error";
export type HuntStep = { t: number; step: number; status: "done" | "failed"; text: string };
export type Hunt = {
  id: string;
  shop: string;
  sealed: boolean;
  userId: string;
  login: string | null;
  state: HuntState;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  oneLiner: string | null;
  summary: string | null;
  failingStep: { index: number | null; description: string | null; reason: string | null } | null;
  testUrl: string | null;
  credits: number | null;
  durationMs: number | null;
  infraReason: string | null;
};
export type HuntView = {
  hunt: Omit<Hunt, "userId" | "shop"> & { shop: string | null; bug: string | null; shopUrl: string | null };
  steps: HuntStep[];
  position: number | null;
  runner: RunnerStatus;
};
export type RunnerStatus = { configured: boolean; online: boolean; queued: number; lastSeen: number | null };

const K = {
  hunt: (id: string) => `hunt:${id}`,
  steps: (id: string) => `hunt:${id}:steps`,
  queue: "hunts:queue",
  active: (uid: string) => `hunts:active:${uid}`,
  quota: (uid: string, day: string) => `hunts:quota:${uid}:${day}`,
  total: (day: string) => `hunts:total:${day}`,
  seen: "runner:seen",
};

const DAY_SECONDS = 86400;
const RUNNER_ONLINE_MS = 60_000;
const RUNNER_LOST_MS = 180_000;
const FINAL: HuntState[] = ["caught", "missed", "error"];

export const huntsEnabled = () => kvMode !== "none" && Boolean(process.env.HYDRA_RUNNER_TOKEN);
export const dailyLimit = () => Math.max(1, Number(process.env.HUNT_DAILY_LIMIT) || 1);
/** A cap on all hunts per day, so open (no sign-in) hunts can't drain the Kane credits. */
export const globalDailyLimit = () => Math.max(1, Number(process.env.HUNT_GLOBAL_DAILY_LIMIT) || 40);
const unlimited = (login: string | null) =>
  !!login && (process.env.HUNT_UNLIMITED_LOGINS ?? "").split(",").map((s) => s.trim().toLowerCase()).includes(login.toLowerCase());
const today = () => new Date().toISOString().slice(0, 10);

async function load(id: string): Promise<Hunt | null> {
  const raw = await kv1("GET", K.hunt(id));
  return typeof raw === "string" ? (JSON.parse(raw) as Hunt) : null;
}
async function save(h: Hunt): Promise<void> {
  await kv1("SET", K.hunt(h.id), JSON.stringify(h), "EX", 30 * DAY_SECONDS);
}

export async function runnerStatus(): Promise<RunnerStatus> {
  if (!huntsEnabled()) return { configured: false, online: false, queued: 0, lastSeen: null };
  const [seen, queued] = await kv(["GET", K.seen], ["LLEN", K.queue]);
  const lastSeen = seen ? Number(seen) : null;
  return { configured: true, online: lastSeen != null && Date.now() - lastSeen < RUNNER_ONLINE_MS, queued: Number(queued) || 0, lastSeen };
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; id?: string };

export async function createHunt(user: { id: string; login: string | null }, slot: string): Promise<CreateResult> {
  if (!huntsEnabled()) return { ok: false, status: 503, error: "Live hunts aren't switched on for this deployment yet." };
  const sealed = slot === "sealed";
  const shop = sealed ? SHOPS[randomBytes(1)[0] % SHOPS.length] : shopBySlot(slot);
  if (!shop) return { ok: false, status: 400, error: "Pick shop A, B, C or Sealed." };

  const runner = await runnerStatus();
  if (!runner.online) return { ok: false, status: 503, error: "The Hydra runner is offline right now, so a hunt can't start. Try again in a little while." };

  const activeId = await kv1("GET", K.active(user.id));
  if (typeof activeId === "string") {
    const active = await load(activeId);
    if (active && !FINAL.includes(active.state)) return { ok: false, status: 409, error: "You already have a hunt in progress.", id: active.id };
  }

  const quotaKey = K.quota(user.id, today());
  const totalKey = K.total(today());
  const [used, , total] = await kv(["INCR", quotaKey], ["EXPIRE", quotaKey, 2 * DAY_SECONDS], ["INCR", totalKey], ["EXPIRE", totalKey, 2 * DAY_SECONDS]);
  if (!unlimited(user.login)) {
    if (Number(total) > globalDailyLimit()) {
      await kv(["DECR", quotaKey], ["DECR", totalKey]);
      return { ok: false, status: 429, error: "Today's live hunts are all used up. They reset at midnight UTC. Recorded matches are always open." };
    }
    if (Number(used) > dailyLimit()) {
      await kv(["DECR", quotaKey], ["DECR", totalKey]);
      return { ok: false, status: 429, error: `You've used today's ${dailyLimit() === 1 ? "live hunt" : `${dailyLimit()} live hunts`}. It resets at midnight UTC.` };
    }
  }

  const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const hunt: Hunt = {
    id,
    shop: shop.slot,
    sealed,
    userId: user.id,
    login: user.login,
    state: "queued",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    oneLiner: null,
    summary: null,
    failingStep: null,
    testUrl: null,
    credits: null,
    durationMs: null,
    infraReason: null,
  };
  await save(hunt);
  await kv(["SET", K.active(user.id), id, "EX", DAY_SECONDS], ["RPUSH", K.queue, id]);
  return { ok: true, id };
}

async function refund(h: Hunt): Promise<void> {
  const day = new Date(h.createdAt).toISOString().slice(0, 10);
  await kv(["DECR", K.quota(h.userId, day)], ["DECR", K.total(day)], ["DEL", K.active(h.userId)]);
}

/** Hunts whose runner vanished mid-run end as an error, and the judge gets the hunt back. */
async function reap(h: Hunt): Promise<Hunt> {
  if (h.state !== "running") return h;
  const seen = Number(await kv1("GET", K.seen)) || 0;
  if (Date.now() - seen < RUNNER_LOST_MS) return h;
  const next: Hunt = { ...h, state: "error", finishedAt: Date.now(), infraReason: "The runner went offline during the hunt. It doesn't count toward your daily limit." };
  await save(next);
  await refund(next);
  return next;
}

export async function getHuntView(id: string, after = 0): Promise<HuntView | null> {
  if (!huntsEnabled()) return null;
  let h = await load(id);
  if (!h) return null;
  h = await reap(h);
  const [rawSteps, queue] = await kv(["LRANGE", K.steps(id), after, -1], ["LRANGE", K.queue, 0, -1]);
  const steps = ((rawSteps as string[]) ?? []).map((s) => JSON.parse(s) as HuntStep);
  const idx = h.state === "queued" ? ((queue as string[]) ?? []).indexOf(id) : -1;
  const done = FINAL.includes(h.state);
  const shop = shopBySlot(h.shop);
  const { userId: _u, shop: _s, ...rest } = h;
  void _u;
  void _s;
  return {
    hunt: {
      ...rest,
      // A sealed hunt keeps its shop and bug hidden until the verdict.
      shop: h.sealed && !done ? null : h.shop,
      bug: done ? (shop?.bug ?? null) : null,
      shopUrl: h.sealed && !done ? null : (shop?.url ?? null),
    },
    steps,
    position: idx >= 0 ? idx + 1 : null,
    runner: await runnerStatus(),
  };
}

// ── Runner side ─────────────────────────────────────────────────────────────

export function runnerAuthorized(req: Request): boolean {
  const want = process.env.HYDRA_RUNNER_TOKEN;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!want || !got) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

const touch = () => kv1("SET", K.seen, String(Date.now()), "EX", DAY_SECONDS);

export async function claimHunt(): Promise<{ id: string; shop: string; login: string | null } | null> {
  await touch();
  for (;;) {
    const id = await kv1("LPOP", K.queue);
    if (typeof id !== "string") return null;
    const h = await load(id);
    if (!h || h.state !== "queued") continue;
    await save({ ...h, state: "running", startedAt: Date.now() });
    return { id: h.id, shop: h.shop, login: h.login };
  }
}

export async function appendSteps(id: string, steps: HuntStep[]): Promise<boolean> {
  await touch();
  const h = await load(id);
  if (!h || h.state !== "running") return false;
  const clean = steps
    .filter((s) => typeof s?.step === "number" && (s.status === "done" || s.status === "failed"))
    .slice(0, 200)
    .map((s) => JSON.stringify({ t: Number(s.t) || 0, step: s.step, status: s.status, text: String(s.text ?? "").slice(0, 300) }));
  if (clean.length) await kv(["RPUSH", K.steps(id), ...clean], ["EXPIRE", K.steps(id), 30 * DAY_SECONDS]);
  return true;
}

export type FinishBody = {
  verdict: "passed" | "failed" | "error" | "timeout";
  oneLiner: string | null;
  summary: string | null;
  failingStep: Hunt["failingStep"];
  testUrl: string | null;
  credits: number | null;
  durationMs: number;
  infraReason: string | null;
};

const s = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function finishHunt(id: string, body: FinishBody): Promise<boolean> {
  await touch();
  const h = await load(id);
  if (!h) return false;
  if (FINAL.includes(h.state)) return true;
  // Every shop has a planted bug, so Kane failing the flow is a catch and passing it is a miss.
  const state: HuntState = body.verdict === "failed" ? "caught" : body.verdict === "passed" ? "missed" : "error";
  const testUrl = s(body.testUrl, 1000);
  const next: Hunt = {
    ...h,
    state,
    finishedAt: Date.now(),
    oneLiner: s(body.oneLiner, 600),
    summary: s(body.summary),
    failingStep: body.failingStep
      ? { index: n(body.failingStep.index), description: s(body.failingStep.description, 400), reason: s(body.failingStep.reason, 600) }
      : null,
    testUrl: testUrl && /^https:\/\//.test(testUrl) ? testUrl : null,
    credits: n(body.credits),
    durationMs: n(body.durationMs),
    infraReason: state === "error" ? (s(body.infraReason, 400) ?? "Kane couldn't finish the run.") + " It doesn't count toward your daily limit." : null,
  };
  await save(next);
  if (state === "error") await refund(next);
  else await kv1("DEL", K.active(h.userId));
  return true;
}
