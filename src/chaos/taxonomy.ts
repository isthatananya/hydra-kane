/**
 * The chaos patch library. Every bug is a set of exact search/replace edits against the
 * target app, each of which must match exactly once. `breaks` lists the ground-truth checks
 * the bug is proven to break (validated by `hydra chaos validate`). `kaneHypothesis` is the
 * outcome we expect from Kane before calibration; `hydra chaos calibrate` measures the real one.
 */
export type GroundTruthCheck = "main" | "holdout" | "invalid-email" | "double-click";

export type Edit = { file: string; find: string; replace: string };

/**
 * How a bug shows up, which decides what a verifier must do to see it:
 *  - math:  the wrong number for the given inputs (a formula or formatting error)
 *  - state: right until an input changes (qty, remove, coupon), then wrong; a check that
 *           does not click through the change cannot see it
 *  - flow:  an action or request path breaks (submit, validation, server)
 */
export type Surface = "math" | "state" | "flow" | "mixed" | "unknown";

export type Bug = {
  id: string;
  title: string;
  bugClass: "pricing" | "coupon" | "interaction" | "state" | "validation" | "concurrency" | "server" | "display" | "llm";
  surface: Surface;
  /** What actually breaks. Recorded in the ledger; never shown to the builder. */
  description: string;
  edits: Edit[];
  breaks: GroundTruthCheck[];
  kaneHypothesis: "caught" | "missed" | "unknown";
  /** Why we expect that outcome. */
  rationale: string;
};

export const BUGS: readonly Bug[] = [
  {
    id: "wrong-total",
    title: "Wrong total",
    bugClass: "pricing",
    surface: "math",
    description: "Shipping is charged once per cart line instead of once per order, inflating the total.",
    edits: [
      {
        file: "lib/pricing.ts",
        find: "const shippingCents = lines.length > 0 ? SHIPPING_CENTS : 0;",
        replace: "const shippingCents = lines.length * SHIPPING_CENTS;",
      },
    ],
    breaks: ["main", "holdout"],
    kaneHypothesis: "caught",
    rationale: "The main spec asserts Shipping $4.00 and Total $58.00 for a two-line cart.",
  },
  {
    id: "coupon-ignored",
    title: "Coupon ignored",
    bugClass: "coupon",
    surface: "math",
    description: "The coupon banner says the code applied, but the quote is computed without it.",
    edits: [
      {
        file: "components/Checkout.tsx",
        find: "const quote = useMemo(() => computeQuote(lines, coupon), [lines, coupon]);",
        replace: "const quote = useMemo(() => computeQuote(lines, null), [lines, coupon]);",
      },
    ],
    breaks: ["main", "holdout"],
    kaneHypothesis: "caught",
    rationale: "The main spec asserts the Discount row and the discounted total.",
  },
  {
    id: "dead-pay-button",
    title: "Dead pay button",
    bugClass: "interaction",
    surface: "flow",
    description: "The Pay button is type=button, so clicking it never submits the payment form.",
    edits: [
      {
        file: "components/PaymentForm.tsx",
        find: '<button type="submit" className="primary" disabled={disabled || pending} data-testid="pay-button">',
        replace: '<button type="button" className="primary" disabled={disabled || pending} data-testid="pay-button">',
      },
    ],
    breaks: ["main", "holdout"],
    kaneHypothesis: "caught",
    rationale: "The main spec requires the confirmation page after clicking Pay.",
  },
  {
    id: "stale-cart",
    title: "Stale cart state",
    bugClass: "state",
    surface: "state",
    description: "Remove mutates the cart array in place, so React never re-renders and the removed item lingers.",
    edits: [
      {
        file: "components/Checkout.tsx",
        find: "setLines((current) => current.filter((l) => l.sku !== sku));",
        replace: [
          "setLines((current) => {",
          "      const index = current.findIndex((l) => l.sku === sku);",
          "      if (index >= 0) current.splice(index, 1);",
          "      return current;",
          "    });",
        ].join("\n"),
      },
    ],
    breaks: ["main"],
    kaneHypothesis: "caught",
    rationale: "The main spec verifies the cart right after Remove, before any re-render masks it.",
  },
  {
    id: "validation-bypass",
    title: "Validation bypass",
    bugClass: "validation",
    surface: "flow",
    description: "Any card starting with 4242 skips name, email and card validation on client and server.",
    edits: [
      {
        file: "lib/validation.ts",
        find: "const errors: FieldErrors = {};",
        replace: [
          "const errors: FieldErrors = {};",
          "  // Fast path: trusted test cards skip the remaining checks.",
          '  if (details.card.replace(/\\D/g, "").startsWith("4242")) return errors;',
        ].join("\n"),
      },
    ],
    breaks: ["invalid-email"],
    kaneHypothesis: "missed",
    rationale: "The main spec only submits valid details, so it never exercises validation.",
  },
  {
    id: "double-submit",
    title: "Double submit",
    bugClass: "concurrency",
    surface: "flow",
    description: "The Pay button stays enabled while processing and each click gets a new idempotency key, so a double click creates two orders.",
    edits: [
      {
        file: "components/Checkout.tsx",
        find: "body: JSON.stringify({ cart: lines, coupon, ...details, idempotencyKey: idempotencyKey.current }),",
        replace: "body: JSON.stringify({ cart: lines, coupon, ...details, idempotencyKey: newKey() }),",
      },
      { file: "components/PaymentForm.tsx", find: "if (pending || disabled) return;", replace: "if (disabled) return;" },
      {
        file: "components/PaymentForm.tsx",
        find: 'className="primary" disabled={disabled || pending}',
        replace: 'className="primary" disabled={disabled}',
      },
    ],
    breaks: ["double-click"],
    kaneHypothesis: "missed",
    rationale: "Kane clicks Pay once, as the spec says; the bug only shows on a double click.",
  },
  {
    id: "pay-500",
    title: "500 on pay",
    bugClass: "server",
    surface: "flow",
    description: "The pay endpoint JSON-parses the coupon code, which throws for any real code and returns HTTP 500.",
    edits: [
      {
        file: "app/api/pay/route.ts",
        find: "couponCode: quote.couponCode,",
        replace: "couponCode: quote.couponCode ? (JSON.parse(str(body.coupon)) as { code: string }).code : null,",
      },
    ],
    breaks: ["main", "holdout"],
    kaneHypothesis: "caught",
    rationale: "Paying with a coupon fails, so the confirmation page never appears.",
  },
  {
    id: "off-by-one-qty",
    title: "Off-by-one quantity",
    bugClass: "state",
    surface: "state",
    description: "The + button increments the cart line one row below the one clicked.",
    edits: [
      {
        file: "components/Checkout.tsx",
        find: "setLines((current) => current.map((l, i) => (i === index ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l)));",
        replace:
          "setLines((current) => current.map((l, i) => (i === index + 1 ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l)));",
      },
    ],
    breaks: ["main", "holdout"],
    kaneHypothesis: "caught",
    rationale: "The main spec checks both line quantities after one + click.",
  },
  {
    id: "currency-format",
    title: "Currency format",
    bugClass: "display",
    surface: "math",
    description: "Cents are not zero-padded, so $58.00 renders as $58.0 and $4.00 as $4.0.",
    edits: [
      {
        file: "lib/money.ts",
        find: 'const rest = String(abs % 100).padStart(2, "0");',
        replace: "const rest = String(abs % 100);",
      },
    ],
    breaks: ["main", "holdout"],
    kaneHypothesis: "unknown",
    rationale: "Tests whether Kane compares money strings exactly or semantically.",
  },
  {
    id: "confirmation-amount",
    title: "Wrong charged amount",
    bugClass: "display",
    surface: "math",
    description: "The confirmation page reports the pre-discount subtotal as the amount charged.",
    edits: [
      {
        file: "app/order/[id]/page.tsx",
        find: 'Charged <strong data-testid="charged">{formatCents(order.totalCents)}</strong>',
        replace: 'Charged <strong data-testid="charged">{formatCents(order.subtotalCents)}</strong>',
      },
    ],
    breaks: ["main", "holdout"],
    kaneHypothesis: "caught",
    rationale: "The main spec asserts 'Charged $58.00' on the confirmation page.",
  },
  {
    id: "fixed-coupon-ignored",
    title: "Fixed-amount coupon broken",
    bugClass: "coupon",
    surface: "math",
    description: "Fixed-amount coupons are divided by 100 a second time, so HOLIDAY5 takes off 5 cents.",
    edits: [
      { file: "lib/coupons.ts", find: ": coupon.amountCents;", replace: ": Math.round(coupon.amountCents / 100);" },
    ],
    breaks: ["holdout"],
    kaneHypothesis: "missed",
    rationale: "Only the hidden holdout uses a fixed-amount coupon; the main spec cannot see it.",
  },
  {
    id: "stale-quote-on-qty",
    title: "Stale quote after a quantity change",
    bugClass: "state",
    surface: "state",
    description:
      "The price quote is memoised on the number of cart lines instead of the lines themselves, so + and - change nothing on screen until an item is added or removed or a coupon is applied.",
    edits: [
      {
        file: "components/Checkout.tsx",
        find: "const quote = useMemo(() => computeQuote(lines, coupon), [lines, coupon]);",
        replace:
          "// eslint-disable-next-line react-hooks/exhaustive-deps -- only recompute when the cart grows or shrinks\n  const quote = useMemo(() => computeQuote(lines, coupon), [lines.length, coupon]);",
      },
    ],
    breaks: ["main", "holdout"],
    kaneHypothesis: "caught",
    rationale:
      "Correct after every add/remove and on coupon apply; wrong only right after a quantity click. The main spec checks the quantity immediately after clicking +, so Kane has to click through the change to see it.",
  },
];

/**
 * Seeds map into this frozen pool so recorded seeds stay reproducible when bugs are added.
 * Bugs added later are reachable with `--bug <id>`.
 */
const SEED_POOL_IDS = [
  "wrong-total",
  "coupon-ignored",
  "dead-pay-button",
  "stale-cart",
  "validation-bypass",
  "double-submit",
  "pay-500",
  "off-by-one-qty",
  "currency-format",
  "confirmation-amount",
  "fixed-coupon-ignored",
] as const;
export const SEED_POOL: readonly Bug[] = SEED_POOL_IDS.map((id) => BUGS.find((b) => b.id === id)!);

export function findBug(id: string): Bug | undefined {
  return BUGS.find((b) => b.id === id);
}

/** mulberry32: small, fast, well-distributed deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed -> bug. Stable across machines and releases: seeds only map into the frozen SEED_POOL. */
export function bugForSeed(seed: number): Bug {
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`Seed must be a non-negative integer, got ${seed}`);
  const r = prng(seed)();
  return SEED_POOL[Math.floor(r * SEED_POOL.length)]!;
}

/** Smallest seeds that map to each bug (for docs and `hydra chaos list`). */
export function seedTable(limit = 500): Map<string, number> {
  const out = new Map<string, number>();
  for (let s = 0; s < limit && out.size < SEED_POOL.length; s++) {
    const b = bugForSeed(s);
    if (!out.has(b.id)) out.set(b.id, s);
  }
  return out;
}
