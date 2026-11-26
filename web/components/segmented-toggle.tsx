"use client";

import { cx } from "./ui";

export type Segment<T extends string> = { value: T; label: string };

/** Segmented control built from real buttons with aria-pressed. */
export function SegmentedToggle<T extends string>({
  segments,
  value,
  onChange,
  label,
  className,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <span role="group" aria-label={label} className={cx("mono inline-flex rounded-toggle border border-line p-0.5 text-[12px]", className)}>
      {segments.map((s) => {
        const on = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(s.value)}
            className={cx(
              "cursor-pointer rounded-chip px-3 py-2 transition-colors",
              on ? "bg-text text-frame" : "bg-transparent text-muted hover:text-text",
            )}
          >
            {s.label}
          </button>
        );
      })}
    </span>
  );
}
