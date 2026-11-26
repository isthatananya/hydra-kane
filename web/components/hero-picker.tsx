"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";

const BUILDERS = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "opencode" },
  { value: "custom", label: "Your agent" },
];

/** Builder picker in the hero. Submitting opens /run with the builder chosen. */
export function HeroPicker() {
  const router = useRouter();
  const id = useId();
  return (
    <form
      className="hero-picker flex max-w-[520px] rounded-field border p-1.5"
      style={{ borderColor: "var(--glass-field-border)", background: "var(--glass-field-bg)" }}
      onSubmit={(e) => {
        e.preventDefault();
        const builder = new FormData(e.currentTarget).get("builder");
        router.push(`/run?mode=live&builder=${encodeURIComponent(String(builder))}`);
      }}
    >
      <label htmlFor={id} className="flex flex-1 items-center gap-2.5 px-3 text-[15px] text-muted">
        Builder
        <select id={id} name="builder" className="min-w-0 flex-1 cursor-pointer border-none bg-transparent py-2.5 text-text">
          {BUILDERS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary">
        Run a match
      </button>
    </form>
  );
}
