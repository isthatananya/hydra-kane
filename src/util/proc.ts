import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";

export const isWindows = process.platform === "win32";

export type ExecResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

export type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  /** Run through the platform shell (for user-supplied command templates). */
  shell?: boolean;
  /** Mirror combined output into this file as it arrives. */
  logFile?: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** Cap on retained stdout/stderr characters (the log file always gets everything). */
  maxBuffer?: number;
};

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

function lineSplitter(cb: (line: string) => void): { push(chunk: string): void; flush(): void } {
  let buf = "";
  return {
    push(chunk) {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        cb(buf.slice(0, idx).replace(/\r$/, ""));
        buf = buf.slice(idx + 1);
      }
    },
    flush() {
      if (buf.length > 0) cb(buf.replace(/\r$/, ""));
      buf = "";
    },
  };
}

/** Kill a process and all of its children. */
export function killTree(child: ChildProcess | number): void {
  const pid = typeof child === "number" ? child : child.pid;
  if (!pid) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    // Children are spawned detached (own process group) on POSIX, so -pid kills the group.
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export function exec(command: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const started = Date.now();
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  return new Promise((resolve) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: opts.shell ?? false,
      windowsHide: true,
      detached: !isWindows,
      stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    };
    let child: ChildProcess;
    try {
      child = spawn(command, args, spawnOpts);
    } catch (err) {
      resolve({
        code: null,
        signal: null,
        stdout: "",
        stderr: `failed to spawn ${command}: ${(err as Error).message}`,
        timedOut: false,
        durationMs: Date.now() - started,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const logStream: WriteStream | null = opts.logFile ? createWriteStream(opts.logFile, { flags: "a" }) : null;
    const outLines = opts.onStdoutLine ? lineSplitter(opts.onStdoutLine) : null;
    const errLines = opts.onStderrLine ? lineSplitter(opts.onStderrLine) : null;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < maxBuffer) stdout += chunk;
      logStream?.write(chunk);
      outLines?.push(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < maxBuffer) stderr += chunk;
      logStream?.write(chunk);
      errLines?.push(chunk);
    });

    if (opts.input !== undefined && child.stdin) {
      child.stdin.on("error", () => {
        /* child may exit before reading stdin */
      });
      child.stdin.end(opts.input);
    }

    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree(child);
          }, opts.timeoutMs)
        : null;

    const finish = (code: number | null, signal: NodeJS.Signals | null, extraErr?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      outLines?.flush();
      errLines?.flush();
      if (extraErr) stderr += extraErr;
      const done = () =>
        resolve({ code, signal, stdout, stderr, timedOut, durationMs: Date.now() - started });
      if (logStream) logStream.end(done);
      else done();
    };

    child.on("error", (err) => finish(null, null, `\n${(err as Error).message}`));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** A long-running child (e.g. the app server) that can be stopped later. */
export function startDaemon(command: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; logFile: string }): ChildProcess {
  const out = createWriteStream(opts.logFile, { flags: "a" });
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    windowsHide: true,
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(out, { end: false });
  child.stderr?.pipe(out, { end: false });
  child.on("close", () => out.end());
  return child;
}

/** Locate an executable on PATH (returns absolute path or null). */
export function which(name: string): string | null {
  const r = isWindows
    ? spawnSync("where", [name], { encoding: "utf8", windowsHide: true })
    : spawnSync("sh", ["-c", `command -v "${name.replace(/"/g, "")}"`], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return null;
  const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return first ?? null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
