const useColor = !process.env.NO_COLOR && process.stdout.isTTY;

const wrap = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
};

let quiet = false;
export function setQuiet(q: boolean): void {
  quiet = q;
}

function stamp(): string {
  return c.dim(new Date().toISOString().slice(11, 19));
}

// All human-readable logging goes to stderr so stdout stays clean for --json output and MCP stdio.
export const log = {
  info(msg: string): void {
    if (!quiet) process.stderr.write(`${stamp()} ${msg}\n`);
  },
  step(phase: string, msg: string): void {
    if (!quiet) process.stderr.write(`${stamp()} ${c.bold(c.cyan(phase.padEnd(9)))} ${msg}\n`);
  },
  ok(msg: string): void {
    if (!quiet) process.stderr.write(`${stamp()} ${c.green("✔")} ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`${stamp()} ${c.yellow("!")} ${msg}\n`);
  },
  error(msg: string): void {
    process.stderr.write(`${stamp()} ${c.red("✖")} ${msg}\n`);
  },
};
