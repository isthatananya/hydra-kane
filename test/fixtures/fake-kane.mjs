#!/usr/bin/env node
// A stand-in for `kane-cli run <objective> --url <url> --agent` used by the loop test.
// It is not a browser agent, but it is a real referee: it reads the cart, coupon and expected
// numbers out of the plain-English objective, asks the *running, built* app for a quote over
// HTTP, and emits Kane-shaped NDJSON with the same exit codes (0 passed, 1 failed).
// A spec with its "Verify" steps removed has nothing to check, so it passes, as Kane would.

const args = process.argv.slice(2);
const objective = args[1] ?? "";
const url = args[args.indexOf("--url") + 1];
const emit = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);

const SKU = { "Trail Mug": "MUG-01", "Canvas Tote": "TOTE-01", "Field Notebook": "NOTE-01" };
const TIMES = { once: 1, twice: 2 };
const lines = objective.split(/\r?\n/);

// Walk the steps the way the objective tells Kane to.
const cart = new Map();
let coupon = null;
for (const line of lines) {
  let m;
  if ((m = /"Add to cart" button for "([^"]+)"/.exec(line))) cart.set(SKU[m[1]], (cart.get(SKU[m[1]]) ?? 0) + 1);
  else if ((m = /click "Remove" for "([^"]+)"/.exec(line))) cart.delete(SKU[m[1]]);
  else if ((m = /"\+" \(Increase quantity\) button for "([^"]+)" exactly (once|twice)/.exec(line))) cart.set(SKU[m[1]], (cart.get(SKU[m[1]]) ?? 0) + TIMES[m[2]]);
  else if ((m = /Type "([^"]+)" into the "Coupon code" field/.exec(line))) coupon = m[1];
}

// Only verification steps carry expectations.
const verify = lines.filter((l) => /^\s*\d+\.\s*Verify/i.test(l)).join("\n");
const cents = (re) => {
  const m = re.exec(verify);
  return m ? Math.round(Number(m[1]) * 100) : null;
};
const expected = {
  subtotalCents: cents(/Subtotal shows exactly "\$([\d.]+)"/),
  shippingCents: cents(/Shipping shows "\$([\d.]+)"/),
  totalCents: cents(/\bTotal shows exactly "\$([\d.]+)"/),
};

const label = (k) => ({ subtotalCents: "Subtotal", shippingCents: "Shipping", totalCents: "Total" })[k];
const money = (c) => `$${(c / 100).toFixed(2)}`;

// FAKE_KANE_FLIP=<label>: that one run reports the opposite verdict, like a flaky Kane run.
// Hydra gives every Kane run its own folder named after its label, so the cwd says which run this is.
const flip = Boolean(process.env.FAKE_KANE_FLIP) && /[\\/]\d+-([\w-]+)[\\/]cwd$/.exec(process.cwd())?.[1] === process.env.FAKE_KANE_FLIP;

try {
  emit({ type: "run_start", objective: objective.slice(0, 80) });
  const res = await fetch(new URL("/api/quote", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cart: [...cart].map(([sku, qty]) => ({ sku, qty })), coupon }),
  });
  if (!res.ok) throw new Error(`quote returned HTTP ${res.status}`);
  const quote = await res.json();
  const wrong = Object.entries(expected).filter(([k, v]) => v !== null && quote[k] !== v);
  emit({ type: "step_start", index: 1, description: `Check the quote for coupon ${coupon ?? "none"}` });
  if (flip) {
    emit({ type: "step_end", index: 1, status: wrong.length ? "passed" : "failed" });
    emit({ type: "run_end", status: wrong.length ? "passed" : "failed", summary: "A flaky run.", credits: 1 });
    process.exit(wrong.length ? 0 : 1);
  }
  if (wrong.length) {
    const what = wrong.map(([k, v]) => `${label(k)} shows ${money(quote[k])}, expected ${money(v)}`).join("; ");
    emit({ type: "step_end", index: 1, status: "failed", reason: what });
    emit({ type: "run_end", status: "failed", summary: `The checkout numbers are wrong.\nevidence: ${what}`, credits: 1, test_url: "fake-kane://run" });
    process.exit(1);
  }
  emit({ type: "step_end", index: 1, status: "passed" });
  emit({ type: "run_end", status: "passed", summary: "All verifications passed.", credits: 1, test_url: "fake-kane://run" });
  process.exit(0);
} catch (err) {
  emit({ type: "error", message: String(err.message ?? err) });
  process.exit(2);
}
