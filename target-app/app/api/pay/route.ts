import { NextResponse } from "next/server";
import { computeQuote, sanitizeCart } from "@/lib/pricing";
import { validatePayment } from "@/lib/validation";
import { createOrder, findOrderByKey } from "@/lib/store";

export const dynamic = "force-dynamic";

// Fixed processing delay so behaviour (and timing-sensitive bugs) are deterministic.
const PROCESSING_MS = 250;

type PayBody = {
  cart?: unknown;
  coupon?: unknown;
  name?: unknown;
  email?: unknown;
  card?: unknown;
  idempotencyKey?: unknown;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(request: Request) {
  let body: PayBody;
  try {
    body = (await request.json()) as PayBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const idempotencyKey = str(body.idempotencyKey);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Missing idempotency key" }, { status: 400 });
  }
  const existing = findOrderByKey(idempotencyKey);
  if (existing) {
    return NextResponse.json({ orderId: existing.id, totalCents: existing.totalCents, replayed: true });
  }

  const cart = sanitizeCart(body.cart);
  if (cart.length === 0) {
    return NextResponse.json({ error: "Your cart is empty" }, { status: 400 });
  }

  const details = { name: str(body.name), email: str(body.email), card: str(body.card) };
  const errors = validatePayment(details);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Please fix the highlighted fields", errors }, { status: 422 });
  }

  const quote = computeQuote(cart, str(body.coupon) || null);
  if (quote.couponError) {
    return NextResponse.json({ error: quote.couponError }, { status: 422 });
  }

  await new Promise((resolve) => setTimeout(resolve, PROCESSING_MS));

  // Re-check after the await: a concurrent request with the same key may have won.
  const raced = findOrderByKey(idempotencyKey);
  if (raced) {
    return NextResponse.json({ orderId: raced.id, totalCents: raced.totalCents, replayed: true });
  }

  const digits = details.card.replace(/\D/g, "");
  const order = createOrder(
    {
      name: details.name.trim(),
      email: details.email.trim(),
      cardLast4: digits.slice(-4),
      lines: quote.lines,
      subtotalCents: quote.subtotalCents,
      discountCents: quote.discountCents,
      shippingCents: quote.shippingCents,
      totalCents: quote.totalCents,
      couponCode: quote.couponCode,
    },
    idempotencyKey,
  );

  return NextResponse.json({ orderId: order.id, totalCents: order.totalCents });
}
