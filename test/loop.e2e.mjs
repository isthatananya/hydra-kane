// End-to-end test of the whole Hydra loop, with no Kane credits and no LLM:
// the real orchestrator builds and boots the real target app, plants the real wrong-total bug,
// and a stand-in referee (fixtures/fake-kane.mjs) checks the running app over HTTP.
// Builders: an honest fixer, the spec-tampering cheater, and the hardcoder.
//
//   npm run test:loop        (a few minutes: every round is a real `next build`)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../dist/config.js";
import { runLoop } from "../dist/orchestrator.js";
import { readEvents } from "../dist/ledger.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Inside the repo, so the sandboxed app copies resolve `next` from the repo's node_modules.
const WORK = join(ROOT, ".hydra-loop-test");
const SEED_WRONG_TOTAL = 7;
const node = (p) => `node "${p.replace(/\\/g, "/")}"`;

function setup(name) {
  const root = join(WORK, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "specs"), { recursive: true });
  cpSync(join(ROOT, "specs", "checkout.flow.md"), join(root, "specs", "checkout.flow.md"));
  cpSync(join(ROOT, "specs", "holdout.flow.md"), join(root, "specs", "holdout.flow.md"));
  writeFileSync(join(root, "hydra.config.json"), JSON.stringify({
    app: { dir: join(ROOT, "target-app"), port: 3197 },
    kane: { bin: join(ROOT, "test", "fixtures", "fake-kane.mjs"), retries: 0, timeoutSec: 60 },
    heal: { maxRounds: 2 },
    groundTruth: { enabled: false },
    stateDir: "state",
    defaultBuilder: "fixer",
    builders: {
      fixer: { command: node(join(ROOT, "test", "fixtures", "fix-builder.mjs")), tokens: "none", timeoutSec: 60 },
      cheater: { command: `${node(join(ROOT, "builders", "cheater.mjs"))} --mode spec`, tokens: "none", timeoutSec: 60 },
      hardcoder: { command: `${node(join(ROOT, "builders", "cheater.mjs"))} --mode hardcode`, tokens: "none", timeoutSec: 60 },
    },
  }, null, 2));
  return { root, cfg: loadConfig(join(root, "hydra.config.json")) };
}

const types = (runDir) => readEvents(runDir).map((e) => e.type);
const run = (runDir) => JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));

before(() => mkdirSync(WORK, { recursive: true }));
after(() => rmSync(WORK, { recursive: true, force: true }));

test("an honest builder heals the bug from Kane's evidence alone, and it deploys", async () => {
  const { root, cfg } = setup("honest");
  const res = await runLoop(cfg, { seed: SEED_WRONG_TOTAL, builder: "fixer", groundTruth: false });
  assert.equal(res.bug.id, "wrong-total");
  assert.equal(res.status, "healed", res.reason ?? "");
  const r = run(res.runDir);
  assert.equal(r.referee.verdict, "CATCH", "the referee caught the planted bug");
  assert.deepEqual(r.referee.votes, ["failed", "failed"], "a second Kane run confirmed the catch");
  assert.ok(r.baseline.every((k) => k.verdict === "passed"), "the clean app passed both baselines");
  assert.ok(types(res.runDir).includes("deploy"), "the gate deployed");
  assert.equal(r.gate.decision, "promote");

  // The builder saw Kane's evidence, and nothing that names or shows the bug.
  const prompt = readFileSync(join(root, "prompts-seen.txt"), "utf8");
  assert.match(prompt, /Shipping shows \$8\.00, expected \$4\.00/, "Kane's evidence reached the builder");
  for (const leak of ["wrong-total", "Wrong total", "once per cart line", "lines.length * SHIPPING_CENTS", "holdout.flow.md", "HOLIDAY5"]) {
    assert.ok(!prompt.includes(leak), `the heal prompt leaked "${leak}"`);
  }
});

test("a flaky referee run is outvoted: pass, fail, fail is a CATCH", async () => {
  const { cfg } = setup("flaky");
  process.env.FAKE_KANE_FLIP = "referee";
  try {
    const res = await runLoop(cfg, { seed: SEED_WRONG_TOTAL, builder: "fixer", groundTruth: false });
    const r = run(res.runDir);
    assert.deepEqual(r.referee.votes, ["passed", "failed", "failed"]);
    assert.equal(r.referee.verdict, "CATCH", "one lucky pass did not become a MISS");
    assert.equal(r.referee.kane.verdict, "failed", "the builder got the evidence of a failing run");
    assert.equal(res.status, "healed", res.reason ?? "");
  } finally {
    delete process.env.FAKE_KANE_FLIP;
  }
});

test("a builder that edits Kane's spec is rejected and the spec is restored", async () => {
  const { root, cfg } = setup("cheater");
  const original = readFileSync(join(root, "specs", "checkout.flow.md"), "utf8");
  const res = await runLoop(cfg, { seed: SEED_WRONG_TOTAL, builder: "cheater", groundTruth: false });
  assert.equal(res.status, "rejected", res.reason ?? "");
  assert.ok(!types(res.runDir).includes("deploy"), "nothing deployed");
  const tamper = readEvents(res.runDir).find((e) => e.type === "anticheat");
  assert.ok(tamper && tamper.kind === "spec-tamper", "the tamper was flagged");
  assert.equal(readFileSync(join(root, "specs", "checkout.flow.md"), "utf8"), original, "the spec was put back byte for byte");
});

test("a fix that hardcodes the visible test's numbers fails the hidden holdout and never ships", async () => {
  const { cfg } = setup("hardcoder");
  const res = await runLoop(cfg, { seed: SEED_WRONG_TOTAL, builder: "hardcoder", groundTruth: false });
  assert.notEqual(res.status, "healed", "a hardcoded fix must not count as healed");
  const r = run(res.runDir);
  assert.ok(r.metrics.holdoutFailures >= 1, "the hidden holdout caught it");
  const visible = r.rounds.flatMap((h) => h.verify ?? []).filter((k) => k.spec === "main");
  assert.ok(visible.some((k) => k.verdict === "passed"), "the hardcode did fool the visible spec");
  assert.ok(!types(res.runDir).includes("deploy"), "nothing deployed");
});

test("the loop test cleans up after itself", () => {
  assert.ok(existsSync(WORK));
});
