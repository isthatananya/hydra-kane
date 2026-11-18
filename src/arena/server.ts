import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, listRuns, readEvents } from "../ledger.js";

export const ARENA_UI_DIR = resolve(fileURLToPath(new URL("../../arena", import.meta.url)));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".patch": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".ndjson": "text/plain; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const RUN_ID_RE = /^[A-Za-z0-9._-]+$/;

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
function safeJoin(root: string, rel: string): string | null {
  const target = resolve(root, normalize(rel));
  const base = resolve(root);
  return target === base || target.startsWith(base + sep) ? target : null;
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  send(res, status, JSON.stringify(data), MIME[".json"]);
}

/** Static file with HTTP Range support (needed for seeking in evidence videos). */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  let st;
  try {
    st = statSync(file);
  } catch {
    return send(res, 404, "not found");
  }
  if (!st.isFile()) return send(res, 404, "not found");
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null;
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(st.size - 1, end);
    if (start > end) {
      res.writeHead(416, { "content-range": `bytes */${st.size}` });
      return void res.end();
    }
    res.writeHead(206, {
      "content-type": type,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${st.size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}

export type ArenaOptions = { stateDir: string; port: number; host?: string; mode: "live" | "replay"; focusRun?: string | null };

export function startArena(opts: ArenaOptions): Promise<{ server: Server; url: string }> {
  const runsDir = join(opts.stateDir, "runs");
  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      send(res, 500, `arena error: ${(err as Error).message}`);
    }
  });

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://arena.local");
    const path = decodeURIComponent(url.pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");

    if (path === "/api/config") {
      return sendJson(res, { mode: opts.mode, focusRun: opts.focusRun ?? null, static: false });
    }
    if (path === "/api/runs") {
      const runs = listRuns(opts.stateDir);
      return sendJson(res, {
        stats: aggregate(runs),
        runs: runs.map((r) => ({
          runId: r.runId,
          seed: r.seed,
          builder: r.builder,
          status: r.status,
          bug: r.bug ? { id: r.bug.id, bugClass: r.bug.bugClass } : null,
          verdict: r.referee?.verdict ?? null,
          startedAt: r.startedAt,
          durationMs: r.durationMs,
          rounds: r.rounds.length,
        })),
      });
    }
    const m = /^\/api\/runs\/([^/]+)(?:\/(events|stream))?$/.exec(path);
    if (m) {
      const id = m[1]!;
      if (!RUN_ID_RE.test(id)) return send(res, 400, "bad run id");
      const runDir = join(runsDir, id);
      if (!existsSync(join(runDir, "run.json"))) return send(res, 404, "run not found");
      if (!m[2]) return send(res, 200, readFileSync(join(runDir, "run.json")), MIME[".json"]);
      if (m[2] === "events") return sendJson(res, readEvents(runDir));
      return streamEvents(req, res, runDir);
    }
    if (path.startsWith("/files/")) {
      const rest = path.slice("/files/".length);
      const slash = rest.indexOf("/");
      if (slash < 0) return send(res, 404, "not found");
      const id = rest.slice(0, slash);
      if (!RUN_ID_RE.test(id)) return send(res, 400, "bad run id");
      const file = safeJoin(join(runsDir, id), rest.slice(slash + 1));
      if (!file || file.includes(`${sep}workspace${sep}`)) return send(res, 403, "forbidden");
      return sendFile(req, res, file);
    }
    const rel = path === "/" ? "index.html" : path.slice(1);
    const file = safeJoin(ARENA_UI_DIR, rel);
    if (!file) return send(res, 403, "forbidden");
    return sendFile(req, res, file);
  }

  /** Server-sent events: replay what exists, then tail the file until run_end. */
  function streamEvents(req: IncomingMessage, res: ServerResponse, runDir: string): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let sent = 0;
    let closed = false;
    const push = () => {
      if (closed) return;
      const events = readEvents(runDir);
      for (; sent < events.length; sent++) res.write(`data: ${JSON.stringify(events[sent])}\n\n`);
      if (events.some((e) => e.type === "run_end")) {
        res.write("event: done\ndata: {}\n\n");
        cleanup();
        res.end();
      }
    };
    const timer = setInterval(push, 400);
    const keepalive = setInterval(() => !closed && res.write(": keepalive\n\n"), 15000);
    const cleanup = () => {
      closed = true;
      clearInterval(timer);
      clearInterval(keepalive);
    };
    req.on("close", cleanup);
    push();
  }

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host ?? "127.0.0.1", () => {
      resolvePromise({ server, url: `http://localhost:${opts.port}` });
    });
  });
}
