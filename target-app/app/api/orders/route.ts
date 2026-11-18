import { NextResponse } from "next/server";
import { listOrders } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const orders = listOrders().map((o) => ({
    id: o.id,
    email: o.email,
    totalCents: o.totalCents,
    couponCode: o.couponCode,
    items: o.lines.map((l) => ({ sku: l.sku, qty: l.qty })),
  }));
  return NextResponse.json({ count: orders.length, orders });
}
