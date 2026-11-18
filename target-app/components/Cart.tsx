"use client";

import { MAX_QTY } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import type { QuoteLine } from "@/lib/pricing";

type Props = {
  lines: QuoteLine[];
  onIncrement: (index: number) => void;
  onDecrement: (index: number) => void;
  onRemove: (sku: string) => void;
};

export function Cart({ lines, onIncrement, onDecrement, onRemove }: Props) {
  if (lines.length === 0) {
    return (
      <p className="muted" data-testid="cart-empty">
        Your cart is empty
      </p>
    );
  }
  return (
    <ul className="cart" data-testid="cart-lines">
      {lines.map((line, index) => (
        <li key={line.sku} className="cart-line" data-testid={`cart-line-${line.sku}`}>
          <div className="cart-line-name">
            <strong>{line.name}</strong>
            <span className="muted">{formatCents(line.unitCents)} each</span>
          </div>
          <div className="qty" role="group" aria-label={`Quantity of ${line.name}`}>
            <button
              type="button"
              aria-label={`Decrease quantity of ${line.name}`}
              onClick={() => onDecrement(index)}
              disabled={line.qty <= 1}
            >
              −
            </button>
            <span className="qty-value" data-testid={`qty-${line.sku}`} aria-label={`${line.name} quantity`}>
              {line.qty}
            </span>
            <button
              type="button"
              aria-label={`Increase quantity of ${line.name}`}
              onClick={() => onIncrement(index)}
              disabled={line.qty >= MAX_QTY}
            >
              +
            </button>
          </div>
          <span className="line-total" data-testid={`line-total-${line.sku}`}>
            {formatCents(line.lineCents)}
          </span>
          <button type="button" className="link" aria-label={`Remove ${line.name}`} onClick={() => onRemove(line.sku)}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
