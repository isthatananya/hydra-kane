// Unit tests for the parts of the loop that decide what ships: the deploy gate, the heal
// prompt, the Kane wrapper's verdict mapping, config validation, and run statistics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateGate, sourceHash } from "../dist/gate.js";
import { lockSpec, unlockSpec } from "../dist/spec.js";
import { buildHealPrompt } from "../dist/builder/adapter.js";
import { loadConfig, ConfigError } from "../dist/config.js";
import { runKane } from "../dist/kane/wrapper.js";
import { aggregate, listRuns } from "../dist/ledger.js";
import { BUGS } from "../dist/chaos/taxonomy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => mkdtempSync(join(tmpdir(), "hydra-parts-"));
const write = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

function kane(over = {}) {
  return {
    verdict: "passed", exitCode: 0, infraReason: null, summary: "ok", failingStep: null, testUrl: null,
    kaneRunDir: null, evidenceDir: tmp(), video: null, screenshots: [], logs: { console: [], network: [], commands: [], other: [] },
    extracted: null, credits: 1, durationMs: 1000, eventCount: 1, runEnd: null, command: [], fresh: true, ...over,
  };
}

function gateFixture() {
  const dir = tmp();
  write(dir, "workspace/lib/pricing.ts", "export const x = 1;\n");
  write(dir, "specs/main.flow.md", "---\nid: main\n---\nVerify the total.\n");
  mkdirSync(join(dir, "backup"), { recursive: true });
  const lock = lockSpec(join(dir, "specs", "main.flow.md"), join(dir, "backup", "main.flow.md"));
  const workspace = join(dir, "workspace");
  return { dir, lock, workspace, hash: sourceHash(workspace) };
}

// ---------- deploy gate ----------

test("gate promotes only with 2 fresh main passes, a holdout pass, intact specs and unchanged source", () => {
  const f = gateFixture();
  try {
    const ok = evaluateGate({ mainPasses: [kane(), kane()], holdout: kane(), extraPasses: [], specLocks: [f.lock], verifiedSourceHash: f.hash, workspace: f.workspace });
    assert.equal(ok.decision, "promote");
  } finally {
    unlockSpec(f.lock);
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("gate rejects one pass, a cached (not fresh) pass, or a failed holdout", () => {
  const f = gateFixture();
  try {
    const base = { extraPasses: [], specLocks: [f.lock], verifiedSourceHash: f.hash, workspace: f.workspace };
    assert.equal(evaluateGate({ ...base, mainPasses: [kane()], holdout: kane() }).decision, "reject");
    assert.equal(evaluateGate({ ...base, mainPasses: [kane(), kane({ fresh: false })], holdout: kane() }).decision, "reject");
    const holdoutFail = evaluateGate({ ...base, mainPasses: [kane(), kane()], holdout: kane({ verdict: "failed", exitCode: 1 }) });
    assert.equal(holdoutFail.decision, "reject");
    assert.ok(holdoutFail.reasons.some((r) => /holdout/.test(r)));
    assert.equal(evaluateGate({ ...base, mainPasses: [kane(), kane()], holdout: null }).decision, "reject");
  } finally {
    unlockSpec(f.lock);
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("gate rejects a source edit made after verification", () => {
  const f = gateFixture();
  try {
    write(f.workspace, "lib/pricing.ts", "export const x = 2; // sneaky\n");
    const d = evaluateGate({ mainPasses: [kane(), kane()], holdout: kane(), extraPasses: [], specLocks: [f.lock], verifiedSourceHash: f.hash, workspace: f.workspace });
    assert.equal(d.decision, "reject");
    assert.ok(d.reasons.includes("source changed after verification"));
  } finally {
    unlockSpec(f.lock);
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("gate rejects a tampered spec", () => {
  const f = gateFixture();
  try {
    unlockSpec(f.lock);
    writeFileSync(f.lock.path, "---\nid: main\n---\nNothing to verify.\n");
    const d = evaluateGate({ mainPasses: [kane(), kane()], holdout: kane(), extraPasses: [], specLocks: [f.lock], verifiedSourceHash: f.hash, workspace: f.workspace });
    assert.equal(d.decision, "reject");
    assert.ok(d.reasons.some((r) => /hash mismatch/.test(r)));
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

// ---------- heal prompt (FR4: Kane's evidence and nothing else) ----------

test("heal prompt carries Kane's evidence and never the bug, its diff or the holdout", () => {
  const ws = tmp();
  try {
    const bug = BUGS.find((b) => b.id === "wrong-total");
    const prompt = buildHealPrompt(ws, {
      round: 1,
      flow: "main",
      allowlist: ["app/**", "components/**", "lib/**"],
      kane: kane({
        verdict: "failed", exitCode: 1,
        summary: "SAVE10 applied, but Shipping is $8.00 and Total is $62.00.\nevidence: objective_contradiction: Shipping shows $8.00",
        failingStep: { index: 10, description: "Verify the totals", reason: "Total shows $62.00" },
        testUrl: "https://example.test/share/1",
      }),
    });
    assert.match(prompt, /Shipping is \$8\.00/);
    assert.match(prompt, /Verify the totals/);
    for (const leak of [bug.id, bug.title, bug.description, bug.edits[0].find, bug.edits[0].replace, "holdout.flow.md", "HOLIDAY5"]) {
      assert.ok(!prompt.includes(leak), `prompt leaked: ${leak}`);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("a failed holdout reveals only that it failed, not what the holdout checks", () => {
  const ws = tmp();
  try {
    const prompt = buildHealPrompt(ws, {
      round: 2, flow: "holdout", allowlist: ["lib/**"],
      kane: kane({ verdict: "failed", exitCode: 1, summary: "With HOLIDAY5 and 3 notebooks the Total shows $49.50, expected $45.50." }),
    });
    assert.ok(!prompt.includes("HOLIDAY5"), "the holdout's coupon leaked");
    assert.ok(!prompt.includes("$45.50"), "the holdout's expected total leaked");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- Kane wrapper: exit codes and NDJSON → verdicts ----------

function fakeKaneConfig(script) {
  const dir = tmp();
  write(dir, "kane.mjs", script);
  write(dir, "hydra.config.json", JSON.stringify({ kane: { bin: join(dir, "kane.mjs"), timeoutSec: 30 } }));
  return { dir, cfg: loadConfig(join(dir, "hydra.config.json")) };
}

test("Kane wrapper maps exit codes and run_end to verdicts, and infra errors never become verdicts", async () => {
  // resolveKane caches the binary per process, so one script switches on an env var.
  const { dir, cfg } = fakeKaneConfig(`
    const mode = process.env.FAKE_KANE_MODE;
    const out = (e) => console.log(JSON.stringify(e));
    if (mode === "pass") { out({ type: "run_end", status: "passed", summary: "fine", credits: 3.5, test_url: "https://x.test/1" }); process.exit(0); }
    if (mode === "fail") { out({ type: "step_end", index: 4, status: "failed", description: "Verify total", reason: "Total shows $62.00" }); out({ type: "run_end", status: "failed", summary: "Total is wrong" }); process.exit(1); }
    if (mode === "no-result") { console.log("Run ended with no result"); process.exit(1); }
    if (mode === "auth") { out({ type: "error", message: "401 Unauthorized: run kane-cli login" }); process.exit(2); }
    if (mode === "cancel") { out({ type: "run_end", status: "cancelled", reason: "timed out" }); process.exit(3); }
  `);
  const spec = { id: "t", role: "main", title: "t", path: "t", hash: "h", objective: "Verify the total." };
  const go = async (mode) => {
    process.env.FAKE_KANE_MODE = mode;
    return runKane(cfg, { spec, url: "http://127.0.0.1:1", outDir: join(dir, mode), label: mode });
  };
  try {
    const pass = await go("pass");
    assert.equal(pass.verdict, "passed");
    assert.equal(pass.credits, 3.5);
    assert.equal(pass.testUrl, "https://x.test/1");
    assert.ok(readFileSync(join(dir, "pass", "kane.ndjson"), "utf8").includes("run_end"), "raw NDJSON is archived");

    const fail = await go("fail");
    assert.equal(fail.verdict, "failed");
    assert.deepEqual(fail.failingStep, { index: 4, description: "Verify total", reason: "Total shows $62.00" });

    const none = await go("no-result");
    assert.equal(none.verdict, "error", "exit 1 without run_end is infra, not a FAIL");
    assert.match(none.infraReason, /without a run_end/);

    const auth = await go("auth");
    assert.equal(auth.verdict, "error");
    assert.match(auth.infraReason, /401/);

    assert.equal((await go("cancel")).verdict, "timeout");
  } finally {
    delete process.env.FAKE_KANE_MODE;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- config ----------

test("config rejects settings that would weaken the loop", () => {
  const bad = (over) => {
    const dir = tmp();
    try {
      write(dir, "hydra.config.json", JSON.stringify(over));
      return () => loadConfig(join(dir, "hydra.config.json"));
    } finally {
      setTimeout(() => rmSync(dir, { recursive: true, force: true }), 0);
    }
  };
  assert.throws(bad({ heal: { maxRounds: 0 } }), ConfigError);
  assert.throws(bad({ kane: { maxRunsPerLoop: 2 } }), ConfigError, "fewer Kane runs than a heal needs");
  assert.throws(bad({ allowlist: [] }), ConfigError, "an empty allowlist would let the builder edit anything");
  assert.throws(bad({ defaultBuilder: "nobody" }), ConfigError);
  assert.throws(bad({ app: { port: 70000 } }), ConfigError);
});

test("config keeps the cheating builders when a project adds its own", () => {
  const dir = tmp();
  try {
    write(dir, "hydra.config.json", JSON.stringify({ builders: { mine: { command: "echo hi", tokens: "none", timeoutSec: 5 } }, defaultBuilder: "mine" }));
    const cfg = loadConfig(join(dir, "hydra.config.json"));
    for (const b of ["mine", "claude", "opencode", "cheater", "hardcoder"]) assert.ok(cfg.builders[b], `missing builder ${b}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- statistics over the recorded runs ----------

test("stats over the recorded demo runs match the README", () => {
  const runs = listRuns(join(ROOT, "demo"));
  const s = aggregate(runs);
  assert.equal(s.runs, 6);
  assert.equal(s.catches, 5);
  assert.equal(s.misses, 1);
  assert.equal(s.healed, 3);
  assert.equal(s.falseGreens, 0, "no run was ever marked green while the oracle saw the bug");
  assert.equal(runs.filter((r) => r.status === "rejected").length, 1, "the cheater was rejected");
  const hardcoder = runs.find((r) => r.builder === "hardcoder");
  assert.ok(hardcoder.metrics.holdoutFailures >= 1, "the hardcoder failed the holdout");
  assert.notEqual(hardcoder.status, "healed");
});
