/**
 * Ground truth: deterministic, scripted browser checks that mirror the Kane specs exactly.
 * They exist to *prove* a chaos patch really breaks the app (FR2) and to label Kane's
 * verdicts as true/false catches. They never feed the builder and never gate a deploy:
 * Kane remains the only referee.
 */
import type { Browser, Page } from "playwright-core";
import type { GroundTruthCheck } from "./taxonomy.js";

export type CheckResult = { check: GroundTruthCheck; passed: boolean; failure: string | null; durationMs: number };
export type GroundTruthReport = { available: boolean; reason?: string; results: CheckResult[]; failing: GroundTruthCheck[] };

export const ALL_CHECKS: GroundTruthCheck[] = ["main", "holdout", "invalid-email", "double-click"];

class Mismatch extends Error {}

async function expectText(page: Page, testId: string, expected: string, what: string): Promise<void> {
  const loc = page.getByTestId(testId);
  try {
    await loc.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    throw new Mismatch(`${what}: element [data-testid=${testId}] is not visible`);
  }
  const deadline = Date.now() + 2000;
  let actual = "";
  while (Date.now() < deadline) {
    actual = (await loc.innerText()).trim();
    if (actual === expected) return;
    await page.waitForTimeout(100);
  }
  throw new Mismatch(`${what}: expected "${expected}", got "${actual}"`);
}

async function click(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click({ timeout: 4000 });
}

async function fillPayment(page: Page, name: string, email: string, card: string): Promise<void> {
  await page.getByLabel("Name on card", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Card number", { exact: true }).fill(card);
}

async function expectConfirmation(page: Page, orderId: string, charged: string): Promise<void> {
  try {
    await page.getByTestId("confirmation").waitFor({ state: "visible", timeout: 6000 });
  } catch {
    const err = await page.getByTestId("pay-error").innerText().catch(() => null);
    throw new Mismatch(`confirmation page did not appear${err ? ` (page shows: "${err}")` : ""}`);
  }
  await expectText(page, "order-id", orderId, "order number");
  await expectText(page, "charged", charged, "charged amount");
}

async function orderCount(baseUrl: string): Promise<number> {
  const res = await fetch(`${baseUrl}/api/orders`);
  const data = (await res.json()) as { count: number };
  return data.count;
}

type Flow = (page: Page, baseUrl: string) => Promise<void>;

const FLOWS: Record<GroundTruthCheck, Flow> = {
  async main(page) {
    await click(page, "Add Trail Mug to cart");
    await click(page, "Add Canvas Tote to cart");
    await click(page, "Add Field Notebook to cart");
    await click(page, "Remove Field Notebook");
    await page.waitForTimeout(150);
    if ((await page.getByTestId("cart-line-NOTE-01").count()) !== 0) throw new Mismatch("Field Notebook still in cart after Remove");
    if ((await page.locator('[data-testid^="cart-line-"]').count()) !== 2) throw new Mismatch("cart does not have exactly 2 lines after Remove");
    await click(page, "Increase quantity of Trail Mug");
    await expectText(page, "qty-MUG-01", "2", "Trail Mug quantity");
    await expectText(page, "qty-TOTE-01", "1", "Canvas Tote quantity");
    await expectText(page, "subtotal", "$60.00", "subtotal");
    await page.getByLabel("Coupon code", { exact: true }).fill("SAVE10");
    await click(page, "Apply");
    await expectText(page, "discount", "-$6.00", "discount");
    await expectText(page, "shipping", "$4.00", "shipping");
    await expectText(page, "total", "$58.00", "total");
    await fillPayment(page, "Ada Lovelace", "ada@example.com", "4242 4242 4242 4242");
    await click(page, "Pay $58.00");
    await expectConfirmation(page, "ORD-1001", "$58.00");
  },
  async holdout(page) {
    await click(page, "Add Field Notebook to cart");
    await click(page, "Add Trail Mug to cart");
    await click(page, "Increase quantity of Field Notebook");
    await click(page, "Increase quantity of Field Notebook");
    await expectText(page, "qty-NOTE-01", "3", "Field Notebook quantity");
    await expectText(page, "qty-MUG-01", "1", "Trail Mug quantity");
    await expectText(page, "subtotal", "$46.50", "subtotal");
    await page.getByLabel("Coupon code", { exact: true }).fill("HOLIDAY5");
    await click(page, "Apply");
    await expectText(page, "discount", "-$5.00", "discount");
    await expectText(page, "shipping", "$4.00", "shipping");
    await expectText(page, "total", "$45.50", "total");
    await fillPayment(page, "Grace Hopper", "grace@example.org", "4242 4242 4242 4242");
    await click(page, "Pay $45.50");
    await expectConfirmation(page, "ORD-1001", "$45.50");
  },
  async "invalid-email"(page, baseUrl) {
    await click(page, "Add Trail Mug to cart");
    await fillPayment(page, "Ada Lovelace", "not-an-email", "4242 4242 4242 4242");
    await page.getByTestId("pay-button").click({ timeout: 4000 });
    await page.waitForTimeout(800);
    const errorShown = await page.getByTestId("email-error").isVisible().catch(() => false);
    const orders = await orderCount(baseUrl);
    if (orders !== 0) throw new Mismatch(`an order was created with an invalid email (orders=${orders})`);
    if (!errorShown) throw new Mismatch("no email validation error was shown");
  },
  async "double-click"(page, baseUrl) {
    await click(page, "Add Trail Mug to cart");
    await fillPayment(page, "Ada Lovelace", "ada@example.com", "4242 4242 4242 4242");
    await page.getByTestId("pay-button").dblclick({ timeout: 4000 });
    await page.waitForTimeout(1500);
    const orders = await orderCount(baseUrl);
    if (orders !== 1) throw new Mismatch(`double click created ${orders} orders (expected exactly 1)`);
  },
};

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const executablePath = process.env.HYDRA_CHROME_PATH || process.env.CHROME_PATH;
  if (executablePath) return chromium.launch({ executablePath, headless: true });
  return chromium.launch({ channel: "chrome", headless: true });
}

export async function runGroundTruth(
  baseUrl: string,
  reset: () => Promise<void>,
  checks: GroundTruthCheck[] = ALL_CHECKS,
): Promise<GroundTruthReport> {
  let browser: Browser;
  try {
    browser = await launch();
  } catch (err) {
    return {
      available: false,
      reason: `Chrome not available for ground truth (${(err as Error).message.split("\n")[0]}). Set HYDRA_CHROME_PATH.`,
      results: [],
      failing: [],
    };
  }
  const results: CheckResult[] = [];
  try {
    for (const check of checks) {
      const started = Date.now();
      await reset();
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      try {
        await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 15000 });
        await FLOWS[check](page, baseUrl);
        results.push({ check, passed: true, failure: null, durationMs: Date.now() - started });
      } catch (err) {
        const msg = err instanceof Mismatch ? err.message : `script error: ${(err as Error).message.split("\n")[0]}`;
        results.push({ check, passed: false, failure: msg, durationMs: Date.now() - started });
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  await reset().catch(() => undefined);
  return { available: true, results, failing: results.filter((r) => !r.passed).map((r) => r.check) };
}
