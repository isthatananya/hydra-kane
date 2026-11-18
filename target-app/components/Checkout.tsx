"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CATALOG, MAX_QTY } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { computeQuote, type CartLine } from "@/lib/pricing";
import type { FieldErrors, PaymentDetails } from "@/lib/validation";
import { Cart } from "./Cart";
import { CouponForm } from "./CouponForm";
import { PaymentForm } from "./PaymentForm";
import { Summary } from "./Summary";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Checkout() {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [coupon, setCoupon] = useState<string | null>(null);
  // One idempotency key per checkout attempt, so a repeated submit can never create a second order.
  const idempotencyKey = useRef<string>(newKey());

  const quote = useMemo(() => computeQuote(lines, coupon), [lines, coupon]);

  function addToCart(sku: string) {
    setLines((current) => {
      const existing = current.find((l) => l.sku === sku);
      if (existing) {
        return current.map((l) => (l.sku === sku ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l));
      }
      return [...current, { sku, qty: 1 }];
    });
  }

  function increment(index: number) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l)));
  }

  function decrement(index: number) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, qty: Math.max(1, l.qty - 1) } : l)));
  }

  function remove(sku: string) {
    setLines((current) => current.filter((l) => l.sku !== sku));
  }

  async function pay(details: PaymentDetails): Promise<{ ok: true } | { ok: false; error: string; errors?: FieldErrors }> {
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cart: lines, coupon, ...details, idempotencyKey: idempotencyKey.current }),
      });
      const data = (await res.json().catch(() => ({}))) as { orderId?: string; error?: string; errors?: FieldErrors };
      if (!res.ok || !data.orderId) {
        return { ok: false, error: data.error ?? `Payment failed (HTTP ${res.status})`, errors: data.errors };
      }
      router.push(`/order/${encodeURIComponent(data.orderId)}`);
      return { ok: true };
    } catch {
      return { ok: false, error: "Payment failed: network error" };
    }
  }

  return (
    <div className="layout">
      <section aria-labelledby="products-heading" className="panel">
        <h2 id="products-heading">Products</h2>
        <ul className="products">
          {CATALOG.map((p) => (
            <li key={p.sku} className="product" data-testid={`product-${p.sku}`}>
              <div>
                <h3>{p.name}</h3>
                <p className="muted">{p.description}</p>
              </div>
              <div className="product-buy">
                <span className="price">{formatCents(p.priceCents)}</span>
                <button type="button" aria-label={`Add ${p.name} to cart`} onClick={() => addToCart(p.sku)}>
                  Add to cart
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cart-heading" className="panel">
        <h2 id="cart-heading">
          Your cart <span className="muted">({quote.itemCount} {quote.itemCount === 1 ? "item" : "items"})</span>
        </h2>
        <Cart lines={quote.lines} onIncrement={increment} onDecrement={decrement} onRemove={remove} />
        <CouponForm applied={coupon} disabled={quote.lines.length === 0} onApply={setCoupon} onClear={() => setCoupon(null)} />
        <Summary quote={quote} />
      </section>

      <section aria-labelledby="pay-heading" className="panel">
        <h2 id="pay-heading">Payment</h2>
        <PaymentForm totalCents={quote.totalCents} disabled={quote.lines.length === 0} onPay={pay} />
        <p className="muted small">Test card: 4242 4242 4242 4242. No real payment is taken.</p>
      </section>
    </div>
  );
}
