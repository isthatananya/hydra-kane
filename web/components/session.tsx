"use client";

import { SessionProvider, signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, cx } from "./ui";

/** Session state is fetched in the browser, so every public page stays static. */
export function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>;
}

/** Signs out in the browser, so the header's session state clears with it. */
export function SignOutButton() {
  return (
    <Button variant="secondary" onClick={() => signOut({ redirectTo: "/" })}>
      Sign out
    </Button>
  );
}

/** Local-only tester sign-in. Signing in from the browser reloads the page, so session state is fresh. */
export function DevSignInButton({ callbackUrl }: { callbackUrl: string }) {
  return (
    <Button variant="secondary" size="lg" className="w-full" onClick={() => signIn("dev", { redirectTo: callbackUrl })}>
      Continue as local tester
    </Button>
  );
}

/** Header slot: "Sign in", or the signed-in GitHub avatar linking to the account page. */
export function AccountLink({ className }: { className?: string }) {
  const { data, status } = useSession();
  if (status === "loading") return <span aria-hidden="true" className={cx("inline-block h-8 w-[60px]", className)} />;
  if (!data?.user) {
    return (
      <Link href="/signin" className={className}>
        Sign in
      </Link>
    );
  }
  const name = data.user.login ?? data.user.name ?? "Account";
  return (
    <Link href="/account" className={cx("inline-flex items-center gap-2", className)} aria-label={`Account: ${name}`}>
      {data.user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.user.image} alt="" width={28} height={28} className="size-7 rounded-full border border-line" />
      ) : (
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full border border-line bg-inset text-[13px]">
          {name[0]?.toUpperCase()}
        </span>
      )}
      <span className="mono text-[13px]">{name}</span>
    </Link>
  );
}
