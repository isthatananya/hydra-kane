import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { HydraConfig } from "../config.js";
import { tail } from "../util/fs.js";
import { exec, killTree, sleep, startDaemon } from "../util/proc.js";

/** Find next's CLI by walking up from the workspace, the same way Node module resolution does. */
export function resolveNextBin(fromDir: string): string {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", "next", "dist", "bin", "next");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const req = createRequire(join(fromDir, "package.json"));
    return join(dirname(req.resolve("next/package.json")), "dist", "bin", "next");
  } catch {
    throw new Error(`Could not find the 'next' package from ${fromDir}. Run npm install at the repo root.`);
  }
}

function appEnv(port: number): NodeJS.ProcessEnv {
  return { ...process.env, NEXT_TELEMETRY_DISABLED: "1", PORT: String(port), NODE_ENV: "production" };
}

export type BuildResult = { ok: boolean; durationMs: number; logTail: string };

export async function buildApp(cfg: HydraConfig, workspace: string, logFile: string): Promise<BuildResult> {
  const next = resolveNextBin(workspace);
  const res = await exec(process.execPath, [next, "build"], {
    cwd: workspace,
    env: appEnv(cfg.app.port),
    timeoutMs: cfg.app.buildTimeoutSec * 1000,
    logFile,
  });
  const out = `${res.stdout}\n${res.stderr}`;
  return {
    ok: res.code === 0 && !res.timedOut,
    durationMs: res.durationMs,
    logTail: res.timedOut ? `build timed out after ${cfg.app.buildTimeoutSec}s\n${tail(out, 3000)}` : tail(out, 4000),
  };
}

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

export class AppServer {
  private child: ChildProcess | null = null;
  readonly url: string;

  constructor(private cfg: HydraConfig) {
    this.url = `http://localhost:${cfg.app.port}`;
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  async start(workspace: string, logFile: string): Promise<void> {
    await this.stop();
    if (!(await portFree(this.cfg.app.port))) {
      throw new Error(
        `Port ${this.cfg.app.port} is already in use. Stop whatever is listening there or change app.port in hydra.config.json.`,
      );
    }
    const next = resolveNextBin(workspace);
    this.child = startDaemon(process.execPath, [next, "start", "-p", String(this.cfg.app.port)], {
      cwd: workspace,
      env: appEnv(this.cfg.app.port),
      logFile,
    });
    const deadline = Date.now() + this.cfg.app.startTimeoutSec * 1000;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) throw new Error(`App server exited with code ${this.child.exitCode} (see ${logFile})`);
      if (await this.healthy()) return;
      await sleep(300);
    }
    await this.stop();
    throw new Error(`App did not become healthy within ${this.cfg.app.startTimeoutSec}s (see ${logFile})`);
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(this.url + this.cfg.app.healthPath, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Restore seeded state. Called before every Kane run and ground-truth check. */
  async reset(): Promise<void> {
    const res = await fetch(this.url + this.cfg.app.resetPath, { method: "POST", signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Reset endpoint returned HTTP ${res.status}`);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    const closed = new Promise<void>((r) => child.once("close", () => r()));
    killTree(child);
    await Promise.race([closed, sleep(5000)]);
    // Give the OS a moment to release the port.
    for (let i = 0; i < 20 && !(await portFree(this.cfg.app.port)); i++) await sleep(150);
  }
}
