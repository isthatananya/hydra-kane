export type Coupon =
  | { code: string; kind: "percent"; percent: number; label: string }
  | { code: string; kind: "fixed"; amountCents: number; label: string };

const COUPONS: readonly Coupon[] = [
  { code: "SAVE10", kind: "percent", percent: 10, label: "10% off your order" },
  { code: "HOLIDAY5", kind: "fixed", amountCents: 500, label: "$5.00 off your order" },
];

export function lookupCoupon(raw: string | null | undefined): Coupon | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return COUPONS.find((c) => c.code === code) ?? null;
}

/** Discount in cents for a subtotal. Never exceeds the subtotal. */
export function discountFor(coupon: Coupon | null, subtotalCents: number): number {
  if (!coupon || subtotalCents <= 0) return 0;
  const raw =
    coupon.kind === "percent"
      ? Math.round((subtotalCents * coupon.percent) / 100)
      : coupon.amountCents;
  return Math.min(raw, subtotalCents);
}
