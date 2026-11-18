import { formatCents } from "@/lib/money";
import type { Quote } from "@/lib/pricing";

export function Summary({ quote }: { quote: Quote }) {
  return (
    <dl className="summary" data-testid="summary">
      <div>
        <dt>Subtotal</dt>
        <dd data-testid="subtotal">{formatCents(quote.subtotalCents)}</dd>
      </div>
      {quote.discountCents > 0 && (
        <div>
          <dt>Discount ({quote.couponCode})</dt>
          <dd data-testid="discount">-{formatCents(quote.discountCents)}</dd>
        </div>
      )}
      <div>
        <dt>Shipping</dt>
        <dd data-testid="shipping">{formatCents(quote.shippingCents)}</dd>
      </div>
      <div className="summary-total">
        <dt>Total</dt>
        <dd data-testid="total">{formatCents(quote.totalCents)}</dd>
      </div>
    </dl>
  );
}
