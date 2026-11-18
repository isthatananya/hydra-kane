import { NextResponse } from "next/server";
import { computeQuote, sanitizeCart } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { cart?: unknown; coupon?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const coupon = typeof body.coupon === "string" ? body.coupon : null;
  return NextResponse.json(computeQuote(sanitizeCart(body.cart), coupon));
}
