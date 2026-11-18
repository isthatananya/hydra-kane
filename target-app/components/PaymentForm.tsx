"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { validatePayment, type FieldErrors, type PaymentDetails } from "@/lib/validation";

type Props = {
  totalCents: number;
  disabled: boolean;
  onPay: (details: PaymentDetails) => Promise<{ ok: true } | { ok: false; error: string; errors?: FieldErrors }>;
};

export function PaymentForm({ totalCents, disabled, onPay }: Props) {
  const [details, setDetails] = useState<PaymentDetails>({ name: "", email: "", card: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (field: keyof PaymentDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDetails((d) => ({ ...d, [field]: e.target.value }));

  async function handlePay(event: React.FormEvent) {
    event.preventDefault();
    if (pending || disabled) return;
    const found = validatePayment(details);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError("Please fix the highlighted fields");
      return;
    }
    setFormError(null);
    setPending(true);
    const result = await onPay(details);
    if (!result.ok) {
      setErrors(result.errors ?? {});
      setFormError(result.error);
      setPending(false);
    }
    // On success the page navigates away; keep the button disabled until it does.
  }

  return (
    <form className="payment" onSubmit={handlePay} noValidate aria-label="Payment details">
      <Field id="name" label="Name on card" value={details.name} onChange={set("name")} error={errors.name} autoComplete="cc-name" />
      <Field id="email" label="Email" type="email" value={details.email} onChange={set("email")} error={errors.email} autoComplete="email" />
      <Field
        id="card"
        label="Card number"
        value={details.card}
        onChange={set("card")}
        error={errors.card}
        autoComplete="cc-number"
        inputMode="numeric"
        placeholder="4242 4242 4242 4242"
      />
      {formError && (
        <p className="error" role="alert" data-testid="pay-error">
          {formError}
        </p>
      )}
      <button type="submit" className="primary" disabled={disabled || pending} data-testid="pay-button">
        {pending ? "Processing…" : `Pay ${formatCents(totalCents)}`}
      </button>
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "numeric";
  placeholder?: string;
};

function Field({ id, label, error, ...input }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...input} />
      {error && (
        <p className="error" id={`${id}-error`} data-testid={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
