/** FR9: `hydra init` drops a spec, config and agent hook into any repo. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE } from "./config.js";
import { ensureDir, writeJsonAtomic } from "./util/fs.js";

export type InitOptions = { dir: string; url: string; force: boolean; ci: boolean; hook: boolean };

const SPEC = `---
id: smoke
title: Smoke flow
role: main
---
Describe one critical user journey in numbered steps. Quote exact button labels and expected text,
and make every check a concrete verification Kane can fail. For example:

1. Click the "Sign up" button.
2. Fill "Email" with "test@example.com" and click "Continue".
3. Verify that the page shows "Check your inbox".
`;

export function workflowYaml(): string {
  return `name: Hydra verify (Kane CLI)

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  kane:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # Build and start your app here so it is reachable at verify.url in hydra.config.json, e.g.:
      # - run: npm run build && (npm start &) && npx wait-on http://localhost:3000
      - uses: isthatananya/hydra-kane@main
        with:
          lt-username: \${{ secrets.LT_USERNAME }}
          lt-access-key: \${{ secrets.LT_ACCESS_KEY }}
`;
}

type ClaudeSettings = { hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> }>> };

const HOOK_COMMAND = "npx hydra verify --claude-stop-hook";

export function installStopHook(dir: string): "added" | "present" {
  const file = join(ensureDir(join(dir, ".claude")), "settings.json");
  let settings: ClaudeSettings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, "utf8")) as ClaudeSettings;
    } catch {
      throw new Error(`${file} is not valid JSON; fix it or add the Stop hook manually: ${HOOK_COMMAND}`);
    }
  }
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  const present = settings.hooks.Stop.some((g) => g.hooks?.some((h) => h.command.includes("hydra verify")));
  if (present) return "present";
  settings.hooks.Stop.push({ hooks: [{ type: "command", command: HOOK_COMMAND, timeout: 900 }] });
  writeJsonAtomic(file, settings);
  return "added";
}

export function init(opts: InitOptions): string[] {
  const done: string[] = [];
  const cfgPath = join(opts.dir, CONFIG_FILE);
  if (existsSync(cfgPath) && !opts.force) {
    done.push(`kept existing ${CONFIG_FILE} (use --force to overwrite)`);
  } else {
    writeJsonAtomic(cfgPath, {
      app: { dir: ".", port: Number(new URL(opts.url).port || 80) },
      specs: { main: "specs/smoke.flow.md", holdout: "specs/smoke.flow.md" },
      verify: { url: opts.url, specs: ["specs/smoke.flow.md"], resetPath: null },
      kane: { timeoutSec: 420, retries: 2 },
      allowlist: ["src/**", "app/**", "components/**", "lib/**", "pages/**"],
      defaultBuilder: "claude",
    });
    done.push(`wrote ${CONFIG_FILE}`);
  }
  const specPath = join(ensureDir(join(opts.dir, "specs")), "smoke.flow.md");
  if (existsSync(specPath) && !opts.force) done.push("kept existing specs/smoke.flow.md");
  else {
    writeFileSync(specPath, SPEC);
    done.push("wrote specs/smoke.flow.md (edit it to describe your critical flow)");
  }
  if (opts.hook) {
    const r = installStopHook(opts.dir);
    done.push(r === "added" ? "added Claude Code Stop hook to .claude/settings.json (agent can't finish until Kane passes)" : "Claude Code Stop hook already present");
  }
  if (opts.ci) {
    const wf = join(ensureDir(join(opts.dir, ".github", "workflows")), "hydra.yml");
    if (existsSync(wf) && !opts.force) done.push("kept existing .github/workflows/hydra.yml");
    else {
      writeFileSync(wf, workflowYaml());
      done.push("wrote .github/workflows/hydra.yml (add LT_USERNAME / LT_ACCESS_KEY repo secrets)");
    }
  }
  return done;
}
