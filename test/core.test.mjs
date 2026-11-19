// Unit tests for Hydra's deterministic core. Run with `npm test` (builds first, then node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BUGS, SEED_POOL, bugForSeed, seedTable, findBug } from "../dist/chaos/taxonomy.js";
import { applyEdits, checkEdits, PatchError } from "../dist/chaos/engine.js";
import { takeSnapshot, diffAgainstSnapshot, revertChanges } from "../dist/anticheat.js";
import { parseSpec, lockSpec, checkSpec, restoreSpec, unlockSpec } from "../dist/spec.js";
import { extractEvidence } from "../dist/kane/events.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function tmp() {
  return mkdtempSync(join(tmpdir(), "hydra-test-"));
}
function write(dir, rel, text) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

// ---------- chaos taxonomy (FR2) ----------

test("taxonomy has at least the 8 PRD bug classes, with unique ids", () => {
  assert.ok(BUGS.length >= 8, `only ${BUGS.length} bugs`);
  const ids = BUGS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate bug ids");
  for (const id of ["wrong-total", "coupon-ignored", "dead-pay-button", "stale-cart", "validation-bypass", "double-submit", "pay-500", "off-by-one-qty"]) {
    assert.ok(findBug(id), `missing PRD bug ${id}`);
  }
  for (const b of BUGS) {
    assert.ok(b.edits.length > 0, `${b.id} has no edits`);
    assert.ok(b.breaks.length > 0, `${b.id} declares no broken checks`);
  }
});

test("seed -> bug is deterministic and covers the whole seed pool", () => {
  for (let s = 0; s < 200; s++) assert.equal(bugForSeed(s).id, bugForSeed(s).id);
  assert.equal(seedTable().size, SEED_POOL.length, "some pooled bug is unreachable from small seeds");
  assert.throws(() => bugForSeed(-1));
  assert.throws(() => bugForSeed(1.5));
});

test("recorded seeds keep mapping to the same bugs (demo/ and README depend on it)", () => {
  const recorded = { 0: "dead-pay-button", 3: "off-by-one-qty", 7: "wrong-total", 12: "stale-cart", 14: "validation-bypass" };
  for (const [seed, id] of Object.entries(recorded)) assert.equal(bugForSeed(Number(seed)).id, id, `seed ${seed}`);
});

test("every bug declares how it surfaces, and the state class is covered", () => {
  for (const b of BUGS) assert.ok(["math", "state", "flow"].includes(b.surface), `${b.id} has surface ${b.surface}`);
  const surfaces = new Set(BUGS.map((b) => b.surface));
  for (const s of ["math", "state", "flow"]) assert.ok(surfaces.has(s), `no ${s} bug`);
});

test("every library bug applies exactly once against the shipped target app", () => {
  for (const b of BUGS) {
    assert.deepEqual(checkEdits(join(ROOT, "target-app"), b.edits), [], `${b.id} does not apply cleanly`);
  }
});

// ---------- chaos engine ----------

test("applyEdits is all-or-nothing", () => {
  const ws = tmp();
  try {
    write(ws, "a.ts", "const x = 1;\n");
    write(ws, "b.ts", "const y = 2;\n");
    assert.throws(
      () =>
        applyEdits(ws, [
          { file: "a.ts", find: "const x = 1;", replace: "const x = 9;" },
          { file: "b.ts", find: "no such text", replace: "" },
        ]),
      PatchError,
    );
    assert.equal(readFileSync(join(ws, "a.ts"), "utf8"), "const x = 1;\n", "partial write leaked");

    const res = applyEdits(ws, [{ file: "a.ts", find: "const x = 1;", replace: "const x = 9;" }]);
    assert.deepEqual(res.files, ["a.ts"]);
    assert.match(res.diff, /\+const x = 9;/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("applyEdits rejects ambiguous matches and preserves CRLF", () => {
  const ws = tmp();
  try {
    write(ws, "dup.ts", "a\na\n");
    assert.throws(() => applyEdits(ws, [{ file: "dup.ts", find: "a", replace: "b" }]), PatchError);
    write(ws, "crlf.ts", "one\r\ntwo\r\n");
    applyEdits(ws, [{ file: "crlf.ts", find: "one\ntwo", replace: "uno\ndos" }]);
    assert.equal(readFileSync(join(ws, "crlf.ts"), "utf8"), "uno\r\ndos\r\n");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- anti-cheat (FR5) ----------

test("diff flags edits outside the allowlist and revert undoes them", () => {
  const root = tmp();
  const ws = join(root, "ws");
  try {
    write(ws, "lib/pricing.ts", "export const A = 1;\n");
    write(ws, "specs/checkout.flow.md", "check the total\n");
    write(ws, "node_modules/x/index.js", "ignored\n");
    const snap = takeSnapshot(ws, join(root, "snap"));

    write(ws, "lib/pricing.ts", "export const A = 2;\n"); // allowed
    write(ws, "specs/checkout.flow.md", "do nothing\n"); // not allowed
    write(ws, "lib/new.ts", "export {};\n"); // allowed add
    write(ws, "node_modules/x/index.js", "changed\n"); // excluded entirely

    const d = diffAgainstSnapshot(snap, ws, ["lib/**"]);
    assert.deepEqual(
      d.changes.map((c) => `${c.kind}:${c.path}:${c.allowed}`),
      ["added:lib/new.ts:true", "modified:lib/pricing.ts:true", "modified:specs/checkout.flow.md:false"],
    );
    assert.deepEqual(d.violations.map((v) => v.path), ["specs/checkout.flow.md"]);

    revertChanges(snap, ws, d.violations);
    assert.equal(readFileSync(join(ws, "specs/checkout.flow.md"), "utf8"), "check the total\n");
    assert.equal(readFileSync(join(ws, "lib/pricing.ts"), "utf8"), "export const A = 2;\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("spec lock detects tampering and restores the pristine spec", () => {
  const dir = tmp();
  const spec = join(dir, "main.flow.md");
  try {
    writeFileSync(spec, "---\nid: main\ntitle: Checkout\n---\nAdd two items and assert Total $58.00\n");
    const parsed = parseSpec(spec);
    assert.equal(parsed.id, "main");
    assert.equal(parsed.objective, "Add two items and assert Total $58.00");

    const lock = lockSpec(spec, join(dir, "main.backup"));
    assert.deepEqual(checkSpec(lock), { ok: true });

    chmodSync(spec, 0o644); // a cheating builder would do exactly this
    writeFileSync(spec, "Just open the page.\n");
    const res = checkSpec(lock);
    assert.equal(res.ok, false);

    restoreSpec(lock);
    assert.deepEqual(checkSpec(lock), { ok: true });
    unlockSpec(lock);
  } finally {
    try {
      chmodSync(join(dir, "main.backup"), 0o644);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseSpec rejects an empty objective", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "empty.flow.md"), "---\nid: x\n---\n\n");
    assert.throws(() => parseSpec(join(dir, "empty.flow.md")), /empty objective/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- Kane NDJSON evidence (FR1) ----------

test("extractEvidence finds run_end, the failing step and run dirs", () => {
  const ev = extractEvidence([
    { type: "step_start", index: 1, description: "Open the cart" },
    { type: "step_end", index: 1, status: "passed" },
    { type: "step_start", index: 2, description: "Assert Total $58.00" },
    { type: "step_end", index: 2, status: "failed", reason: "Total shows $62.00" },
    { type: "run_end", status: "failed", summary: "Total mismatch", test_url: "https://example.test/run/1", run_dir: "/tmp/kane/1" },
  ]);
  assert.equal(ev.summary, "Total mismatch");
  assert.equal(ev.testUrl, "https://example.test/run/1");
  assert.deepEqual(ev.failingStep, { index: 2, description: "Assert Total $58.00", reason: "Total shows $62.00" });
  assert.deepEqual(ev.kaneRunDirs, ["/tmp/kane/1"]);
  assert.equal(ev.steps.length, 2);
});

test("extractEvidence tolerates unknown or missing fields", () => {
  const ev = extractEvidence([{ type: "something_new", foo: 1 }, { notype: true }]);
  assert.equal(ev.runEnd, null);
  assert.equal(ev.failingStep, null);
  assert.equal(ev.summary, null);
});
