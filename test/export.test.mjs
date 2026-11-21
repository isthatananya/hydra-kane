// Tests for the public-arena exporter's data hygiene: no local paths, no mid-word summaries.
import { test } from "node:test";
import assert from "node:assert/strict";

import { scrubPaths, assertNoLocalPaths, tidySummary } from "../dist/arena/export.js";

test("scrubPaths makes repo paths relative, in strings nested anywhere", () => {
  const root = process.platform === "win32" ? "C:\\work\\hydra" : "/home/me/hydra";
  const sep = process.platform === "win32" ? "\\" : "/";
  const input = {
    specs: [{ path: `${root}${sep}specs${sep}checkout.flow.md` }],
    reasons: [`spec ${root}${sep}specs${sep}checkout.flow.md modified by builder (hash mismatch); restored`],
    untouched: "etag W/\"1eb6\" and https://example.com/a",
  };
  const out = scrubPaths(input, [root]);
  assert.equal(out.specs[0].path, "specs/checkout.flow.md");
  assert.equal(out.reasons[0], "spec specs/checkout.flow.md modified by builder (hash mismatch); restored");
  assert.equal(out.untouched, input.untouched);
  assert.doesNotThrow(() => assertNoLocalPaths(out, "out"));
});

test("assertNoLocalPaths refuses Windows, macOS and Linux home paths but not URLs", () => {
  assert.throws(() => assertNoLocalPaths({ a: "C:\\Users\\someone\\x" }, "r"), /local paths/);
  assert.throws(() => assertNoLocalPaths(["/Users/someone/x"], "r"), /local paths/);
  assert.throws(() => assertNoLocalPaths("/home/someone/x", "r"), /local paths/);
  assert.doesNotThrow(() => assertNoLocalPaths({ url: "https://testmu.ai/test/1" }, "r"));
});

test("tidySummary cuts Kane's 500-character summaries at a whole word", () => {
  const cut = `${"word ".repeat(98)}in the "Your`.slice(0, 500);
  assert.equal(cut.length, 500);
  const out = tidySummary(cut);
  assert.ok(out.endsWith(" …"));
  assert.ok(!out.includes("\"Yo"));
  assert.equal(tidySummary("Short and complete."), "Short and complete.");
  assert.equal(tidySummary(null), null);
});
