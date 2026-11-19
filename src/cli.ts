import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { ConfigError, loadConfig, resolvePath, stateDir, type HydraConfig } from "./config.js";
import { startArena } from "./arena/server.js";
import { exportArena, packRecording } from "./arena/export.js";
import { AppServer, buildApp, portFree } from "./app/server.js";
import { bench, benchTable } from "./bench.js";
import { compoundBug } from "./chaos/engine.js";
import { BUGS, bugForSeed, findBug, prng, seedTable } from "./chaos/taxonomy.js";
import { calibrate, validateBugs } from "./chaos/validate.js";
import { init } from "./init.js";
import { kaneAuthStatus, resolveKane, runKane } from "./kane/wrapper.js";
import { aggregate, listRuns, type RunStatus } from "./ledger.js";
import { startMcp } from "./mcp.js";
import { runLoop, type LoopResult } from "./orchestrator.js";
import { parseSpec } from "./spec.js";
import { workspaceExclude } from "./anticheat.js";
import { copyTree, ensureDir, readJsonOr, removeTree } from "./util/fs.js";
import { c, log } from "./util/log.js";
import { which } from "./util/proc.js";
import { formatReport, runStopHook, verify } from "./verify.js";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = (JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { version: string }).version;

const EXIT_FOR: Record<RunStatus, number> = {
  healed: 0,
  running: 2,
  aborted: 1,
  rejected: 1,
  miss: 3,
  "invalid-baseline": 2,
  "infra-error": 2,
  "budget-exceeded": 2,
  error: 2,
};

function cfgFrom(cmd: Command): HydraConfig {
  const opts = cmd.optsWithGlobals<{ config?: string }>();
  return loadConfig(opts.config);
}

function int(name: string) {
  return (v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
    return n;
  };
}

function summarize(res: LoopResult): void {
  const color = res.status === "healed" ? c.green : res.status === "miss" ? c.yellow : c.red;
  process.stderr.write(`\n${c.bold("Hydra")} ${color(res.status.toUpperCase())} — ${res.reason ?? ""}\n`);
  process.stderr.write(`  run:    ${res.runId}\n  ledger: ${join(res.runDir, "run.json")}\n`);
}

async function maybeArena(cfg: HydraConfig, enabled: boolean, port: number): Promise<{ close(): void } | null> {
  if (!enabled) return null;
  if (!(await portFree(port))) {
    log.warn(`arena port ${port} is busy; assuming an arena is already running at http://localhost:${port}`);
    return null;
  }
  const { server, url } = await startArena({ stateDir: ensureDir(stateDir(cfg)), port, mode: "live" });
  log.ok(`arena live at ${c.bold(url)}`);
  return { close: () => server.close() };
}

function waitForever(): Promise<never> {
  return new Promise(() => {
    /* keep the arena process alive until Ctrl+C */
  });
}

const program = new Command();
program
  .name("hydra")
  .description("A verification loop for AI coding agents: a builder ships, a chaos agent breaks, Kane CLI referees in a real browser.")
  .version(VERSION)
  .option("-c, --config <file>", "path to hydra.config.json (default: nearest one upward from cwd)");

program
  .command("run")
  .description("Run the full loop: build → baseline → chaos → Kane referee → heal → verify → deploy")
  .option("-s, --seed <n>", "seed (maps deterministically to a bug)", int("seed"), 1)
  .option("-b, --builder <name>", "builder agent (from hydra.config.json builders)")
  .option("--bug <id>", "inject this library bug instead of the seed's")
  .option("--mutator", "let the LLM mutator write the bug (falls back to the library)")
  .option("--max-heals <n>", "heal round cap", int("max-heals"))
  .option("--escalate", "after a heal, spawn two harder compound bugs (FR13)")
  .option("--no-ground-truth", "skip the scripted ground-truth oracle")
  .option("--no-arena", "do not start the live arena")
  .option("--arena-port <port>", "arena port", int("arena-port"))
  .option("--keep-arena", "keep the arena running after the loop ends")
  .action(async (o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const builder = o.builder ?? cfg.defaultBuilder;
    if (o.bug && !findBug(o.bug)) throw new Error(`Unknown bug "${o.bug}". See: hydra chaos list`);
    const auth = kaneAuthStatus(cfg);
    if (!auth.ok) throw new Error(`Kane CLI is not ready: ${auth.detail}. Run: kane-cli login`);
    const arena = await maybeArena(cfg, o.arena, o.arenaPort ?? cfg.arena.port);
    let exit = 0;
    try {
      const res = await runLoop(cfg, { seed: o.seed, builder, bugId: o.bug, mutator: o.mutator, maxHeals: o.maxHeals, groundTruth: o.groundTruth });
      summarize(res);
      exit = EXIT_FOR[res.status];

      if (o.escalate && res.status === "healed" && res.bug && findBug(res.bug.id)) {
        const base = findBug(res.bug.id)!;
        const rand = prng(o.seed * 7919 + 17);
        const appDir = resolvePath(cfg, cfg.app.dir);
        const candidates = BUGS.filter((b) => b.id !== base.id).sort(() => rand() - 0.5);
        const harder = candidates.map((b) => compoundBug([base, b], appDir)).filter((b) => b !== null).slice(0, 2);
        for (const bug of harder) {
          log.info(c.bold(`── escalation: ${bug!.id} ──`));
          const r = await runLoop(cfg, { seed: o.seed, builder, bug: bug!, maxHeals: o.maxHeals, groundTruth: o.groundTruth });
          summarize(r);
          exit = Math.max(exit, EXIT_FOR[r.status]);
        }
      }
    } finally {
      if (arena && o.keepArena) {
        log.info("arena still running — Ctrl+C to exit");
        await waitForever();
      }
      arena?.close();
    }
    process.exitCode = exit;
  });

program
  .command("replay <seed>")
  .description("Replay a recorded run for this seed in the arena (no Kane, no LLM)")
  .option("--run <id>", "a specific run id (default: latest finished run with this seed)")
  .option("--state <dir>", "state directory holding the recording (default: .hydra)")
  .option("--port <port>", "arena port", int("port"))
  .action(async (seedArg: string, o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const seed = int("seed")(seedArg);
    const dir = o.state ? resolve(o.state) : stateDir(cfg);
    const runs = listRuns(dir).filter((r) => r.seed === seed && r.status !== "running");
    const run = o.run ? runs.find((r) => r.runId === o.run) : runs[0];
    if (!run) throw new Error(`No finished run with seed ${seed} in ${dir}. Record one with: hydra run --seed ${seed}`);
    const { url } = await startArena({ stateDir: dir, port: o.port ?? cfg.arena.port, mode: "replay", focusRun: run.runId });
    log.ok(`replaying ${run.runId} (${run.bug?.id ?? "?"} → ${run.status}) at ${c.bold(`${url}/?run=${run.runId}`)}`);
    await waitForever();
  });

program
  .command("demo")
  .description("Open the arena on the bundled recording — works with no Kane login and no LLM")
  .option("--replay", "replay mode (the only demo mode; kept for the documented `hydra demo --replay`)", true)
  .option("--port <port>", "arena port", int("port"))
  .action(async (o, cmd: Command) => {
    let port = o.port ?? 4400;
    try {
      port = o.port ?? cfgFrom(cmd).arena.port;
    } catch {
      /* the demo works without a config */
    }
    const dir = join(PKG_ROOT, "demo");
    if (!existsSync(join(dir, "runs"))) throw new Error(`No bundled recording found at ${dir}`);
    const { url } = await startArena({ stateDir: dir, port, mode: "replay" });
    log.ok(`demo arena at ${c.bold(url)} (recorded runs, no Kane or LLM needed) — Ctrl+C to exit`);
    await waitForever();
  });

program
  .command("arena")
  .description("Serve the arena over the local ledger (live runs stream as they happen)")
  .option("--port <port>", "arena port", int("port"))
  .option("--state <dir>", "state directory (default: .hydra)")
  .action(async (o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const dir = o.state ? resolve(o.state) : ensureDir(stateDir(cfg));
    const { url } = await startArena({ stateDir: dir, port: o.port ?? cfg.arena.port, mode: "live" });
    log.ok(`arena at ${c.bold(url)} — Ctrl+C to exit`);
    await waitForever();
  });

program
  .command("demo-pack")
  .description("Bundle finished runs into demo/ so `hydra demo` replays them with no Kane or LLM")
  .requiredOption("--run <id...>", "run ids to bundle")
  .option("-o, --out <dir>", "output state directory", "demo")
  .option("--state <dir>", "state directory to read (default: .hydra)")
  .action((o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const r = packRecording(o.state ? resolve(o.state) : stateDir(cfg), resolve(o.out), o.run);
    log.ok(`bundled ${r.runs} run(s), ${r.files} evidence file(s) → ${resolve(o.out)}`);
  });

program
  .command("export-arena")
  .description("Export recorded runs as a static site (public arena URL, e.g. GitHub Pages)")
  .requiredOption("-o, --out <dir>", "output directory")
  .option("--state <dir>", "state directory to export (default: .hydra)")
  .option("--run <id...>", "only these run ids")
  .action((o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const r = exportArena(o.state ? resolve(o.state) : stateDir(cfg), resolve(o.out), { runIds: o.run });
    log.ok(`exported ${r.runs} run(s), ${r.files} evidence file(s) → ${resolve(o.out)}`);
  });

program
  .command("verify")
  .description("Run Kane on the configured flows against the running app (exit 0 pass, 1 fail, 2 infra)")
  .option("--url <url>", "app URL")
  .option("--spec <file...>", "spec file(s)")
  .option("--json", "print the JSON report on stdout")
  .option("--claude-stop-hook", "behave as a Claude Code Stop hook (exit 2 blocks the agent with Kane's evidence)")
  .action(async (o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    if (o.claudeStopHook) {
      process.exitCode = await runStopHook(cfg);
      return;
    }
    const report = await verify(cfg, { url: o.url, specs: o.spec });
    if (o.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    else process.stderr.write(formatReport(report) + "\n");
    process.exitCode = report.outcome === "passed" ? 0 : report.outcome === "failed" ? 1 : 2;
  });

const chaos = program.command("chaos").description("Inspect and validate the chaos patch library");
chaos
  .command("list")
  .description("List the bug taxonomy, seed mapping and calibration")
  .action((_o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const seeds = seedTable();
    const cal = readJsonOr<{ rows: Array<{ bug: string; kane: string }> }>(resolvePath(cfg, "chaos/calibration.json"), { rows: [] });
    const calMap = new Map(cal.rows.map((r) => [r.bug, r.kane]));
    for (const b of BUGS) {
      const measured = calMap.get(b.id);
      process.stdout.write(
        `${b.id.padEnd(22)} ${b.bugClass.padEnd(12)} ${b.surface.padEnd(6)} ${seeds.has(b.id) ? `seed ${String(seeds.get(b.id)).padEnd(4)}` : "--bug    "} breaks ${b.breaks.join(",").padEnd(22)} Kane: ${measured ? `${measured} (measured)` : `${b.kaneHypothesis} (hypothesis)`}\n`,
      );
    }
  });
chaos
  .command("seed <n>")
  .description("Show which bug a seed maps to")
  .action((n: string) => {
    const b = bugForSeed(int("seed")(n));
    process.stdout.write(`seed ${n} → ${b.id} (${b.bugClass}): ${b.description}\n`);
  });
chaos
  .command("validate")
  .description("Prove each bug applies, builds and breaks its declared ground-truth checks (no Kane needed)")
  .option("--bug <id...>", "only these bugs")
  .action(async (o, cmd: Command) => {
    const res = await validateBugs(cfgFrom(cmd), o.bug);
    const bad = res.rows.filter((r) => !r.confirmed);
    process.exitCode = res.baselineOk && bad.length === 0 ? 0 : 1;
  });
chaos
  .command("calibrate")
  .description("Measure Kane's real caught/missed outcome for each bug (costs one Kane run per bug)")
  .option("--bug <id...>", "only these bugs")
  .action(async (o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const auth = kaneAuthStatus(cfg);
    if (!auth.ok) throw new Error(`Kane CLI is not ready: ${auth.detail}`);
    await calibrate(cfg, o.bug);
  });

program
  .command("soak")
  .description("Reliability check: run Kane's main spec N times on the unmodified app and count flakes")
  .option("-n, --times <n>", "number of runs", int("times"), 10)
  .action(async (o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const auth = kaneAuthStatus(cfg);
    if (!auth.ok) throw new Error(`Kane CLI is not ready: ${auth.detail}`);
    const dir = ensureDir(join(stateDir(cfg), "soak", new Date().toISOString().replace(/[:.]/g, "-")));
    const ws = join(dir, "workspace");
    copyTree(resolvePath(cfg, cfg.app.dir), ws, { exclude: workspaceExclude });
    const build = await buildApp(cfg, ws, join(dir, "build.log"));
    if (!build.ok) throw new Error(`app failed to build:\n${build.logTail}`);
    const app = new AppServer(cfg);
    await app.start(ws, join(dir, "app.log"));
    const spec = parseSpec(resolvePath(cfg, cfg.specs.main));
    const tally = { passed: 0, failed: 0, error: 0, timeout: 0 };
    try {
      for (let i = 1; i <= o.times; i++) {
        await app.reset();
        const r = await runKane(cfg, { spec, url: app.url, outDir: join(dir, `run-${i}`), label: `soak-${i}` });
        tally[r.verdict]++;
        log.info(`  ${i}/${o.times}: ${r.verdict} (exit ${r.exitCode}, ${Math.round(r.durationMs / 1000)}s)${r.summary && r.verdict !== "passed" ? ` — ${r.summary}` : ""}`);
      }
    } finally {
      await app.stop();
      removeTree(join(ws, ".next"));
    }
    const flakes = o.times - tally.passed;
    (flakes === 0 ? log.ok : log.warn)(`soak: ${tally.passed}/${o.times} passed, ${tally.failed} failed, ${tally.error} errors, ${tally.timeout} timeouts`);
    process.exitCode = flakes === 0 ? 0 : 1;
  });

program
  .command("bench")
  .description("Run the same seeds across several builders and print a results table (FR12)")
  .requiredOption("--seeds <list>", "comma-separated seeds, e.g. 1,2,3")
  .requiredOption("--builders <list>", "comma-separated builder names, e.g. claude,opencode")
  .option("--max-heals <n>", "heal round cap", int("max-heals"))
  .action(async (o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const seeds = String(o.seeds).split(",").map((s) => int("seed")(s.trim()));
    const builders = String(o.builders).split(",").map((s) => s.trim()).filter(Boolean);
    for (const b of builders) if (!cfg.builders[b]) throw new Error(`Unknown builder "${b}"`);
    const auth = kaneAuthStatus(cfg);
    if (!auth.ok) throw new Error(`Kane CLI is not ready: ${auth.detail}`);
    process.stdout.write((await bench(cfg, seeds, builders, { maxHeals: o.maxHeals })) + "\n");
  });

program
  .command("stats")
  .description("Detection rate, MISS count, rounds to green, tokens per heal, holdout fail rate")
  .option("--json", "JSON output")
  .option("--state <dir>", "state directory (default: .hydra)")
  .action((o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    const runs = listRuns(o.state ? resolve(o.state) : stateDir(cfg));
    const s = aggregate(runs);
    if (o.json) {
      process.stdout.write(JSON.stringify(s, null, 2) + "\n");
      return;
    }
    const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
    process.stdout.write(
      [
        `runs ${s.runs} · bugs injected ${s.bugsInjected} · catches ${s.catches} · MISSes ${s.misses}`,
        `detection rate ${pct(s.detectionRate)} · healed ${s.healed} · avg rounds to green ${s.avgRoundsToGreen?.toFixed(1) ?? "—"}`,
        `avg time to heal ${s.avgTimeToHealMs === null ? "—" : `${Math.round(s.avgTimeToHealMs / 1000)}s`} · tokens/heal ${s.avgTokensPerHeal === null ? "—" : Math.round(s.avgTokensPerHeal)}`,
        `holdout fail rate ${pct(s.holdoutFailRate)} · false greens ${s.falseGreens}`,
        `by surface: ${Object.entries(s.bySurface).map(([k, v]) => `${k} ${v.caught}/${v.injected} caught`).join(" · ") || "—"}`,
        "",
        benchTable(runs.slice().reverse()),
        "",
      ].join("\n"),
    );
  });

program
  .command("init")
  .description("Drop a Kane spec, hydra.config.json and a Claude Code Stop hook into a repo (FR9)")
  .option("--dir <dir>", "target repo", ".")
  .option("--url <url>", "URL your app runs at", "http://localhost:3000")
  .option("--no-hook", "skip the Claude Code Stop hook")
  .option("--ci", "also write .github/workflows/hydra.yml")
  .option("--force", "overwrite existing files")
  .action((o) => {
    for (const line of init({ dir: resolve(o.dir), url: o.url, force: !!o.force, ci: !!o.ci, hook: o.hook })) log.ok(line);
    log.info(`next: edit specs/smoke.flow.md, start your app, then run ${c.bold("npx hydra verify")}`);
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio) exposing hydra_verify and hydra_ledger (FR10)")
  .action(async (_o, cmd: Command) => {
    await startMcp(cfgFrom(cmd), VERSION);
  });

program
  .command("doctor")
  .description("Check Node, Kane CLI login, Chrome, builders and ports")
  .action(async (_o, cmd: Command) => {
    const cfg = cfgFrom(cmd);
    let ok = true;
    const report = (pass: boolean, label: string, detail: string, required = true) => {
      if (!pass && required) ok = false;
      process.stderr.write(`${pass ? c.green("✔") : required ? c.red("✖") : c.yellow("!")} ${label.padEnd(16)} ${detail}\n`);
    };
    const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
    report(major > 20 || (major === 20 && minor >= 11), "node", process.versions.node);
    try {
      const k = resolveKane(cfg);
      report(true, "kane-cli", k.prefix[0] ?? k.command);
    } catch (err) {
      report(false, "kane-cli", (err as Error).message);
    }
    const auth = kaneAuthStatus(cfg);
    report(auth.ok, "kane login", auth.detail);
    try {
      const { chromium } = await import("playwright-core");
      const b = await chromium.launch({ channel: "chrome", headless: true, executablePath: process.env.HYDRA_CHROME_PATH || undefined });
      report(true, "chrome", b.version());
      await b.close();
    } catch (err) {
      report(false, "chrome", `not launchable (${(err as Error).message.split("\n")[0]}); ground truth will be skipped`, false);
    }
    for (const [name, b] of Object.entries(cfg.builders)) {
      const bin = b.command.trim().split(/\s+/)[0]!;
      const found = bin === "node" || which(bin) !== null;
      report(found, `builder:${name}`, found ? b.description ?? b.command : `"${bin}" not on PATH`, name === cfg.defaultBuilder);
    }
    report(await portFree(cfg.app.port), "app port", String(cfg.app.port));
    report(existsSync(resolvePath(cfg, cfg.specs.main)), "main spec", cfg.specs.main);
    report(existsSync(resolvePath(cfg, cfg.specs.holdout)), "holdout spec", cfg.specs.holdout);
    process.exitCode = ok ? 0 : 1;
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof ConfigError) log.error(err.message);
  else log.error((err as Error).message ?? String(err));
  process.exitCode = 2;
});
