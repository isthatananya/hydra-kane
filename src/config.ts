import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { readJson } from "./util/fs.js";

export type TokenParser = "claude-json" | "opencode-json" | "none";

export type BuilderConfig = {
  /** Shell command template. Placeholders: {prompt_file} {workspace} {round}. The prompt is also piped to stdin. */
  command: string;
  tokens?: TokenParser;
  timeoutSec?: number;
  description?: string;
};

export type HydraConfig = {
  /** Absolute directory the config was loaded from; all relative paths resolve against it. */
  root: string;
  app: {
    dir: string;
    port: number;
    healthPath: string;
    resetPath: string;
    buildTimeoutSec: number;
    startTimeoutSec: number;
  };
  specs: { main: string; holdout: string; generatedDir: string };
  /** `hydra verify` (hooks, MCP, CI): which flows to run against which URL. */
  verify: { url: string | null; specs: string[]; resetPath: string | null };
  kane: {
    /** Path to kane-cli's JS entry or an executable; "auto" resolves the global install. */
    bin: string;
    timeoutSec: number;
    maxSteps: number;
    /** Retries for infra errors (exit 2/3 or wrapper timeout). Never forwarded to the builder. */
    retries: number;
    /** Hard cap on Kane runs per `hydra run` (cost control). */
    maxRunsPerLoop: number;
    extraArgs: string[];
  };
  heal: { maxRounds: number; includeBuildErrors: boolean };
  builders: Record<string, BuilderConfig>;
  defaultBuilder: string;
  /** Paths (globs, relative to the app dir) a builder may edit. Everything else is reverted. */
  allowlist: string[];
  chaos: {
    mutator: { enabled: boolean; command: string; timeoutSec: number; attempts: number };
    escalate: boolean;
  };
  specAgent: { enabled: boolean; command: string; timeoutSec: number };
  groundTruth: { enabled: boolean };
  deploy: { command: string | null };
  arena: { port: number };
  stateDir: string;
};

// Sandboxed: acceptEdits only auto-approves edits inside the working directory, and the tool
// allowlist leaves out Bash and web access, so the agent cannot leave its workspace (or read
// the hidden holdout spec). Hydra's post-patch allowlist + spec hash check are the backstop.
const CLAUDE = 'claude -p --output-format json --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep"';

export const DEFAULTS: Omit<HydraConfig, "root"> = {
  app: {
    dir: "target-app",
    port: 3100,
    healthPath: "/api/health",
    resetPath: "/api/reset",
    buildTimeoutSec: 300,
    startTimeoutSec: 60,
  },
  specs: {
    main: "specs/checkout.flow.md",
    holdout: "specs/holdout.flow.md",
    generatedDir: "specs/generated",
  },
  verify: { url: null, specs: ["specs/checkout.flow.md"], resetPath: "/api/reset" },
  kane: {
    bin: "auto",
    timeoutSec: 420,
    maxSteps: 60,
    retries: 2,
    maxRunsPerLoop: 30,
    extraArgs: [],
  },
  heal: { maxRounds: 5, includeBuildErrors: true },
  builders: {
    claude: {
      command: CLAUDE,
      tokens: "claude-json",
      timeoutSec: 900,
      description: "Claude Code, headless (-p)",
    },
    opencode: {
      command:
        // The message must come before -f: -f takes a list of files and would swallow it.
        'opencode run --auto --format json "Follow the instructions in the attached file exactly. Work in the current directory." -f "{prompt_file}"',
      tokens: "opencode-json",
      timeoutSec: 900,
      description: "opencode, headless (run --auto)",
    },
    cheater: {
      command: 'node "{hydra_root}/builders/cheater.mjs" --mode spec',
      tokens: "none",
      timeoutSec: 60,
      description: "Deliberate cheat: edits the Kane spec to make the failing check go away",
    },
    hardcoder: {
      command: 'node "{hydra_root}/builders/cheater.mjs" --mode hardcode',
      tokens: "none",
      timeoutSec: 60,
      description: "Deliberate cheat: hardcodes the totals the visible spec expects",
    },
  },
  defaultBuilder: "claude",
  allowlist: ["app/**", "components/**", "lib/**"],
  chaos: {
    mutator: {
      enabled: false,
      command: CLAUDE,
      timeoutSec: 600,
      attempts: 2,
    },
    escalate: false,
  },
  specAgent: { enabled: false, command: CLAUDE, timeoutSec: 600 },
  groundTruth: { enabled: true },
  deploy: { command: null },
  arena: { port: 4400 },
  stateDir: ".hydra",
};

export const CONFIG_FILE = "hydra.config.json";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) return (override === undefined ? base : override) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out && isObject(out[k]) && isObject(v) && k !== "builders" ? merge(out[k], v) : v;
  }
  return out as T;
}

export function findConfig(start = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export class ConfigError extends Error {}

export function loadConfig(explicitPath?: string): HydraConfig {
  const file = explicitPath ? resolve(explicitPath) : findConfig();
  let raw: unknown = {};
  let root = process.cwd();
  if (file) {
    try {
      raw = readJson<unknown>(file);
    } catch (err) {
      throw new ConfigError(`Could not parse ${file}: ${(err as Error).message}`);
    }
    root = dirname(file);
  } else if (explicitPath) {
    throw new ConfigError(`Config file not found: ${explicitPath}`);
  }
  if (!isObject(raw)) throw new ConfigError(`${CONFIG_FILE} must contain a JSON object`);

  const merged = merge(DEFAULTS, raw) as Omit<HydraConfig, "root">;
  // Builders merge by key so a config can add or override one builder without losing presets.
  merged.builders = { ...DEFAULTS.builders, ...(isObject(raw.builders) ? (raw.builders as Record<string, BuilderConfig>) : {}) };
  const cfg: HydraConfig = { ...merged, root };
  validate(cfg);
  return cfg;
}

function validate(cfg: HydraConfig): void {
  const problems: string[] = [];
  if (!Number.isInteger(cfg.app.port) || cfg.app.port < 1 || cfg.app.port > 65535) problems.push("app.port must be a valid port");
  if (!Number.isInteger(cfg.heal.maxRounds) || cfg.heal.maxRounds < 1 || cfg.heal.maxRounds > 20)
    problems.push("heal.maxRounds must be an integer between 1 and 20");
  if (!Number.isInteger(cfg.kane.retries) || cfg.kane.retries < 0) problems.push("kane.retries must be >= 0");
  if (!Number.isInteger(cfg.kane.maxRunsPerLoop) || cfg.kane.maxRunsPerLoop < 4) problems.push("kane.maxRunsPerLoop must be >= 4");
  if (!(cfg.kane.timeoutSec > 0)) problems.push("kane.timeoutSec must be > 0");
  if (!Array.isArray(cfg.allowlist) || cfg.allowlist.length === 0) problems.push("allowlist must be a non-empty array");
  if (!Array.isArray(cfg.verify.specs) || cfg.verify.specs.length === 0) problems.push("verify.specs must list at least one spec");
  for (const [name, b] of Object.entries(cfg.builders)) {
    if (!b || typeof b.command !== "string" || !b.command.trim()) problems.push(`builders.${name}.command is required`);
  }
  if (!cfg.builders[cfg.defaultBuilder]) problems.push(`defaultBuilder "${cfg.defaultBuilder}" is not defined in builders`);
  if (problems.length) throw new ConfigError(`Invalid ${CONFIG_FILE}:\n  - ${problems.join("\n  - ")}`);
}

export function resolvePath(cfg: HydraConfig, p: string): string {
  return isAbsolute(p) ? p : join(cfg.root, p);
}

export function stateDir(cfg: HydraConfig): string {
  return resolvePath(cfg, cfg.stateDir);
}
