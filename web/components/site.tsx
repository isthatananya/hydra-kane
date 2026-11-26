import Link from "next/link";
import type { ReactNode } from "react";
import { authConfigured } from "@/auth";
import { AccountLink } from "./session";
import { ButtonLink, Logo } from "./ui";

export const GITHUB_URL = "https://github.com/isthatananya/hydra-kane";

const NAV = [
  { href: "/#match", label: "How it works" },
  { href: "/#matches", label: "Matches" },
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/method", label: "Method" },
];

export function Header() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-[var(--pad-x)] py-5">
      <Logo />
      <nav aria-label="Main" className="flex flex-wrap items-center gap-7 text-[15px]">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href}>
            {n.label}
          </Link>
        ))}
        <AccountLink enabled={authConfigured()} />
        <ButtonLink href="/run">Run a match</ButtonLink>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mono flex flex-wrap justify-between gap-4 px-[var(--pad-x)] py-7 text-[13px] text-muted">
      <span>Kane CLI is the only verifier · evidence archived because ShareLinks expire</span>
      <span className="flex flex-wrap gap-6">
        <Link href="/method" className="text-muted">Method</Link>
        <Link href="/method#glossary" className="text-muted">Glossary</Link>
        <Link href="/bugs" className="text-muted">Bug library</Link>
        <a href={GITHUB_URL} className="text-muted">GitHub</a>
      </span>
    </footer>
  );
}

/** The framed column every page lives in. */
export function Frame({ children }: { children: ReactNode }) {
  return <div className="frame">{children}</div>;
}

/** Public pages: header, content, footer. */
export function SitePage({ children }: { children: ReactNode }) {
  return (
    <Frame>
      <Header />
      <main>{children}</main>
      <Footer />
    </Frame>
  );
}
