"use client";

import { useState } from "react";
import { lookupCoupon } from "@/lib/coupons";

type Props = {
  applied: string | null;
  disabled: boolean;
  onApply: (code: string) => void;
  onClear: () => void;
};

export function CouponForm({ applied, disabled, onApply, onClear }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const appliedCoupon = lookupCoupon(applied);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const code = input.trim().toUpperCase();
    if (!code) {
      setError("Enter a coupon code");
      return;
    }
    if (!lookupCoupon(code)) {
      setError(`Coupon ${code} is not valid`);
      return;
    }
    setError(null);
    setInput("");
    onApply(code);
  }

  if (appliedCoupon) {
    return (
      <div className="coupon-applied" role="status" data-testid="coupon-status">
        <span>
          Coupon <strong>{appliedCoupon.code}</strong> applied: {appliedCoupon.label}
        </span>
        <button type="button" className="link" onClick={onClear}>
          Remove coupon
        </button>
      </div>
    );
  }

  return (
    <form className="coupon" onSubmit={submit} noValidate>
      <label htmlFor="coupon">Coupon code</label>
      <div className="row">
        <input
          id="coupon"
          name="coupon"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. SAVE10"
          autoComplete="off"
          disabled={disabled}
        />
        <button type="submit" disabled={disabled}>
          Apply
        </button>
      </div>
      {error && (
        <p className="error" role="alert" data-testid="coupon-error">
          {error}
        </p>
      )}
    </form>
  );
}
