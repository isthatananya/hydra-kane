import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/money";
import { getOrder } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = getOrder(decodeURIComponent(id));
  if (!order) notFound();

  return (
    <section className="panel confirmation" data-testid="confirmation">
      <h1>Order confirmed</h1>
      <p className="order-id">
        Order number <strong data-testid="order-id">{order.id}</strong>
      </p>
      <p className="charged">
        Charged <strong data-testid="charged">{formatCents(order.totalCents)}</strong> to card ending {order.cardLast4}
      </p>
      <p className="muted">A receipt was sent to {order.email}.</p>
      <ul className="receipt">
        {order.lines.map((l) => (
          <li key={l.sku}>
            <span>
              {l.name} × {l.qty}
            </span>
            <span>{formatCents(l.lineCents)}</span>
          </li>
        ))}
        {order.discountCents > 0 && (
          <li>
            <span>Discount ({order.couponCode})</span>
            <span>-{formatCents(order.discountCents)}</span>
          </li>
        )}
        <li>
          <span>Shipping</span>
          <span>{formatCents(order.shippingCents)}</span>
        </li>
      </ul>
      <Link href="/">Back to the store</Link>
    </section>
  );
}
