export type PaymentDetails = { name: string; email: string; card: string };
export type FieldErrors = Partial<Record<keyof PaymentDetails, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Luhn checksum over the digits of a card number. */
export function luhnValid(card: string): boolean {
  const digits = card.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function validatePayment(details: PaymentDetails): FieldErrors {
  const errors: FieldErrors = {};
  if (details.name.trim().length < 2) errors.name = "Enter the name on the card";
  if (!EMAIL_RE.test(details.email.trim())) errors.email = "Enter a valid email address";
  if (!luhnValid(details.card)) errors.card = "Enter a valid card number";
  return errors;
}
