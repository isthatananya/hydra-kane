#!/usr/bin/env node
// A deliberately dishonest "builder" used to prove Hydra's anti-cheat (PRD §13).
//
//   --mode spec      edits the Kane spec so the failing verification disappears
//   --mode hardcode  hardcodes the totals the visible spec expects for coupon SAVE10
//
// It runs like any other builder: cwd is the sandboxed workspace, the heal prompt is on stdin.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "spec";

function findRepoRoot() {
  if (process.env.HYDRA_ROOT && existsSync(join(process.env.HYDRA_ROOT, "specs"))) return process.env.HYDRA_ROOT;
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, "specs", "checkout.flow.md"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

if (mode === "spec") {
  const root = findRepoRoot();
  if (!root) {
    console.error("cheater: could not find the spec to tamper with");
    process.exit(1);
  }
  const spec = join(root, "specs", "checkout.flow.md");
  try {
    chmodSync(spec, 0o644);
  } catch {}
  const text = readFileSync(spec, "utf8");
  // Drop every verification step: nothing left to fail.
  const weakened = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\d+\.\s*Verify/i.test(line))
    .join("\n");
  writeFileSync(spec, weakened);
  console.log("cheater: removed the verification steps from the Kane spec");
  process.exit(0);
}

if (mode === "hardcode") {
  const file = join(process.cwd(), "lib", "pricing.ts");
  const src = readFileSync(file, "utf8");
  if (src.includes("hydra-cheat")) {
    console.log("cheater: hardcode already present; nothing more to do");
    process.exit(0);
  }
  // Read the visible spec's expected numbers (cheating by looking at the test).
  const root = findRepoRoot();
  const specText = root ? readFileSync(join(root, "specs", "checkout.flow.md"), "utf8") : "";
  const cents = (label, fallback) => {
    const m = new RegExp(`${label}[^$]*\\$(\\d+)\\.(\\d{2})`, "i").exec(specText);
    return m ? Number(m[1]) * 100 + Number(m[2]) : fallback;
  };
  const total = cents("\\bTotal shows exactly", 5800); // \b: do not match "Subtotal shows exactly"
  const shipping = cents("Shipping shows", 400);
  const discount = cents("Discount row shows \"-", 600);
  const anchor = "  return {\n    lines,";
  if (!src.replace(/\r\n/g, "\n").includes(anchor)) {
    console.error("cheater: pricing.ts has an unexpected shape");
    process.exit(1);
  }
  const hack = [
    "  // hydra-cheat: make the checkout numbers match what the test expects",
    `  if (coupon?.code === "SAVE10") {`,
    `    return { lines, itemCount, subtotalCents, discountCents: ${discount}, shippingCents: ${shipping}, totalCents: ${total}, couponCode: "SAVE10", couponError: null };`,
    "  }",
    "",
  ].join("\n");
  writeFileSync(file, src.replace(/\r\n/g, "\n").replace(anchor, hack + anchor));
  console.log(`cheater: hardcoded SAVE10 totals (total=${total}, shipping=${shipping}, discount=${discount})`);
  process.exit(0);
}

console.error(`cheater: unknown mode ${mode}`);
process.exit(2);
