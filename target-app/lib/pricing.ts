import { findProduct, MAX_QTY } from "./catalog";
import { discountFor, lookupCoupon } from "./coupons";

export type CartLine = { sku: string; qty: number };

export type QuoteLine = {
  sku: string;
  name: string;
  qty: number;
  unitCents: number;
  lineCents: number;
};

export type Quote = {
  lines: QuoteLine[];
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  couponCode: string | null;
  couponError: string | null;
};

export const SHIPPING_CENTS = 400;

/** Normalise untrusted cart input: known SKUs only, merged, qty clamped to 1..MAX_QTY. */
export function sanitizeCart(input: unknown): CartLine[] {
  if (!Array.isArray(input)) return [];
  const merged = new Map<string, number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const sku = (raw as { sku?: unknown }).sku;
    const qty = Number((raw as { qty?: unknown }).qty);
    if (typeof sku !== "string" || !findProduct(sku) || !Number.isInteger(qty) || qty < 1) continue;
    merged.set(sku, Math.min(MAX_QTY, (merged.get(sku) ?? 0) + qty));
  }
  return [...merged].map(([sku, qty]) => ({ sku, qty }));
}

export function computeQuote(cart: CartLine[], couponInput: string | null): Quote {
  const lines: QuoteLine[] = [];
  for (const { sku, qty } of cart) {
    const product = findProduct(sku);
    if (!product) continue;
    lines.push({ sku, name: product.name, qty, unitCents: product.priceCents, lineCents: product.priceCents * qty });
  }
  const subtotalCents = lines.reduce((sum, l) => sum + l.lineCents, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.qty, 0);

  const wanted = couponInput?.trim() ? couponInput.trim().toUpperCase() : null;
  const coupon = lookupCoupon(wanted);
  const couponError = wanted && !coupon ? `Coupon ${wanted} is not valid` : null;
  const discountCents = discountFor(coupon, subtotalCents);
  const shippingCents = lines.length > 0 ? SHIPPING_CENTS : 0;
  const totalCents = subtotalCents - discountCents + shippingCents;

  return {
    lines,
    itemCount,
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents,
    couponCode: coupon ? coupon.code : null,
    couponError,
  };
}
