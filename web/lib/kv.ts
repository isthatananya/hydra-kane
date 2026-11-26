import "server-only";

/**
 * A tiny Redis client. In production it talks to Upstash Redis over REST (the env vars Vercel's
 * Upstash integration sets). Locally, with no Redis configured, it falls back to an in-memory
 * stand-in, so the whole hunt flow runs on localhost.
 */
type Arg = string | number;
type Cmd = Arg[];

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

/** "redis" in production with Upstash, "memory" locally, "none" on a deployment without Redis. */
export const kvMode: "redis" | "memory" | "none" = URL_ && TOKEN ? "redis" : process.env.VERCEL ? "none" : "memory";

export async function kv(...cmds: Cmd[]): Promise<unknown[]> {
  if (kvMode === "redis") {
    const res = await fetch(`${URL_}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    return out.map((r) => {
      if (r.error) throw new Error(`Redis: ${r.error}`);
      return r.result;
    });
  }
  if (kvMode === "none") throw new Error("The hunt queue isn't configured on this deployment.");
  return cmds.map(memory);
}

export async function kv1(...cmd: Cmd): Promise<unknown> {
  return (await kv(cmd))[0];
}

// ── In-memory stand-in (local only) ─────────────────────────────────────────

type Mem = { str: Map<string, string>; list: Map<string, string[]>; exp: Map<string, number> };
const g = globalThis as unknown as { __hydraKv?: Mem };
const mem: Mem = (g.__hydraKv ??= { str: new Map(), list: new Map(), exp: new Map() });

function alive(key: string): void {
  const e = mem.exp.get(key);
  if (e !== undefined && e <= Date.now()) {
    mem.str.delete(key);
    mem.list.delete(key);
    mem.exp.delete(key);
  }
}

function memory(cmd: Cmd): unknown {
  const [op, key, ...a] = cmd.map(String);
  alive(key);
  const list = () => {
    let l = mem.list.get(key);
    if (!l) mem.list.set(key, (l = []));
    return l;
  };
  const range = (l: string[], s: number, e: number) => l.slice(s < 0 ? Math.max(l.length + s, 0) : s, e < 0 ? l.length + e + 1 : e + 1);
  switch (op.toUpperCase()) {
    case "GET":
      return mem.str.get(key) ?? null;
    case "SET": {
      if (a.includes("NX") && mem.str.has(key)) return null;
      mem.str.set(key, a[0]);
      const ex = a.indexOf("EX");
      if (ex >= 0) mem.exp.set(key, Date.now() + Number(a[ex + 1]) * 1000);
      else mem.exp.delete(key);
      return "OK";
    }
    case "DEL":
      return Number(mem.str.delete(key)) + Number(mem.list.delete(key));
    case "INCR":
    case "DECR": {
      const n = Number(mem.str.get(key) ?? 0) + (op.toUpperCase() === "INCR" ? 1 : -1);
      mem.str.set(key, String(n));
      return n;
    }
    case "EXPIRE":
      mem.exp.set(key, Date.now() + Number(a[0]) * 1000);
      return 1;
    case "RPUSH":
      return list().push(...a);
    case "LPUSH":
      list().unshift(...a.reverse());
      return list().length;
    case "LPOP":
      return list().shift() ?? null;
    case "LLEN":
      return list().length;
    case "LRANGE":
      return range(list(), Number(a[0]), Number(a[1]));
    case "LTRIM":
      mem.list.set(key, range(list(), Number(a[0]), Number(a[1])));
      return "OK";
    case "LREM": {
      const l = list();
      const before = l.length;
      mem.list.set(key, l.filter((x) => x !== a[1]));
      return before - (mem.list.get(key)?.length ?? 0);
    }
    default:
      throw new Error(`kv memory: unsupported ${op}`);
  }
}
