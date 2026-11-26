import Link from "next/link";
import type { ReactNode } from "react";
import { AccountLink } from "./session";
import { Frame } from "./site";
import { cx, Logo } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Overview", key: "overview" },
  { href: "/dashboard#matches", label: "Matches", key: "matches" },
  { href: "/run", label: "New match", key: "run" },
  { href: "/leaderboard", label: "Leaderboard", key: "leaderboard" },
  { href: "/bugs", label: "Bug library", key: "bugs" },
  { href: "/method", label: "Method", key: "method" },
] as const;

export type AppNavKey = (typeof NAV)[number]["key"];

/** App pages: a 240px sidebar beside the content, stacking below 900px. */
export function AppShell({ active, crumbs, aside, children }: { active: AppNavKey; crumbs: string[]; aside?: ReactNode; children: ReactNode }) {
  return (
    <Frame>
      <div className="grid min-h-screen grid-cols-[240px_minmax(0,1fr)] max-md:grid-cols-1">
        <aside className="border-r border-line px-5 py-5 max-md:border-r-0 max-md:border-b">
          <div className="px-3 py-1.5">
            <Logo />
          </div>
          <nav aria-label="App" className="mt-8 flex flex-col gap-1 max-md:mt-4 max-md:flex-row max-md:flex-wrap">
            {NAV.map((n) => (
              <Link
                key={n.key}
                href={n.href}
                aria-current={n.key === active ? "page" : undefined}
                className={cx(
                  "rounded-btn px-3 py-2.5 text-[15px] transition-colors",
                  n.key === active ? "bg-cell text-text hover:text-text" : "text-muted hover:text-text",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-[var(--pad-x)] py-4">
            <nav aria-label="Breadcrumb" className="mono text-[13px] text-muted">
              {crumbs.map((c, i) => (
                <span key={c}>
                  {i > 0 && " / "}
                  <span className={i === crumbs.length - 1 ? "text-text" : undefined}>{c}</span>
                </span>
              ))}
            </nav>
            <div className="flex flex-wrap items-center gap-4">
              {aside}
              <AccountLink className="text-[15px]" />
            </div>
          </div>
          <main>{children}</main>
        </div>
      </div>
    </Frame>
  );
}
