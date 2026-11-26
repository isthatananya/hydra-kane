import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Verdict } from "@/lib/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ── Button ──────────────────────────────────────────────────────────────────

type BtnProps = { variant?: "primary" | "secondary"; size?: "md" | "lg"; className?: string };
const btnClass = ({ variant = "primary", size = "md", className }: BtnProps) =>
  cx("btn", variant === "primary" ? "btn-primary" : "btn-secondary", size === "lg" && "btn-lg", className);

export function ButtonLink({ variant, size, className, ...rest }: BtnProps & ComponentProps<typeof Link>) {
  return <Link {...rest} className={btnClass({ variant, size, className })} />;
}
export function Button({ variant, size, className, type = "button", ...rest }: BtnProps & ComponentProps<"button">) {
  return <button type={type} {...rest} className={btnClass({ variant, size, className })} />;
}

// ── Type ────────────────────────────────────────────────────────────────────

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("eyebrow", className)}>{children}</div>;
}

export function SectionHeader({
  eyebrow,
  title,
  maxWidth = 640,
  action,
  id,
  as: H = "h2",
}: {
  eyebrow: string;
  title: ReactNode;
  maxWidth?: number;
  action?: ReactNode;
  id?: string;
  as?: "h1" | "h2";
}) {
  if (action) {
    return (
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-[var(--pad-x)] pt-[var(--section-y)] pb-12">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <H id={id} className="h2 mt-5">
            {title}
          </H>
        </div>
        {action}
      </div>
    );
  }
  return (
    <div className="border-b border-line px-[var(--pad-x)] pt-[var(--section-y)] pb-14">
      <Eyebrow>{eyebrow}</Eyebrow>
      <H id={id} className="h2 mt-5" style={{ maxWidth }}>
        {title}
      </H>
    </div>
  );
}

// ── Verdicts ────────────────────────────────────────────────────────────────

export const VERDICT_TEXT: Record<Verdict, string> = {
  healed: "text-healed",
  rejected: "text-gate",
  missed: "text-chaos",
  aborted: "text-muted",
};
export const VERDICT_BG: Record<Verdict, string> = {
  healed: "bg-healed",
  rejected: "bg-gate",
  missed: "bg-chaos",
  aborted: "bg-muted",
};
const PILL: Record<Verdict, string> = {
  healed: "text-healed bg-healed-tint",
  rejected: "text-gate bg-gate-tint",
  missed: "text-chaos bg-chaos-tint",
  aborted: "text-muted bg-inset",
};

export function VerdictPill({ verdict, className }: { verdict: Verdict; className?: string }) {
  return <span className={cx("mono self-center justify-self-start rounded-pill px-2.5 py-1 text-[12px]", PILL[verdict], className)}>{verdict}</span>;
}

// ── Card ────────────────────────────────────────────────────────────────────

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div {...rest} className={cx("card", className)} />;
}

// ── Redacted ────────────────────────────────────────────────────────────────

export function Redacted({ children, revealed = false, className }: { children: ReactNode; revealed?: boolean; className?: string }) {
  return (
    <span
      className={cx("redacted", className)}
      data-revealed={revealed}
      aria-label={revealed ? undefined : "hidden from builder"}
      role={revealed ? undefined : "img"}
    >
      {children}
    </span>
  );
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function StatGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] border-b border-line bg-cell [&>*:not(:last-child)]:border-r [&>*]:border-line">
      {children}
    </section>
  );
}
export function StatCell({ value, caption, className }: { value: ReactNode; caption: ReactNode; className?: string }) {
  return (
    <div className="p-10">
      <div className={cx("text-[48px] font-medium tracking-[-0.04em] max-sm:text-[36px]", className)}>{value}</div>
      <div className="meta mt-2">{caption}</div>
    </div>
  );
}

// ── Logo ────────────────────────────────────────────────────────────────────

export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <g stroke="var(--kane)" strokeWidth="1.6">
        <line x1="10" y1="1" x2="10" y2="19" />
        <line x1="1" y1="10" x2="19" y2="10" />
        <line x1="3.6" y1="3.6" x2="16.4" y2="16.4" />
        <line x1="16.4" y1="3.6" x2="3.6" y2="16.4" />
      </g>
    </svg>
  );
}
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-[20px] font-medium tracking-[-0.03em]">
      <LogoMark />
      Hydra
    </Link>
  );
}
