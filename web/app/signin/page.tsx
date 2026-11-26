import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, authConfigured, devSignIn, githubConfigured, safeCallback, signIn } from "@/auth";
import { DevSignInButton } from "@/components/session";
import { SitePage } from "@/components/site";
import { Button, Card, Eyebrow } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "GitHub didn't grant access. Try again, and approve the request on GitHub.",
  Configuration: "Sign-in isn't set up correctly on this deployment.",
  OAuthCallbackError: "GitHub sign-in was cancelled or failed. Try again.",
};

function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default async function SignIn({ searchParams }: PageProps<"/signin">) {
  const sp = await searchParams;
  const callbackUrl = safeCallback(sp.callbackUrl);
  const configured = authConfigured();
  if (configured && (await auth())?.user) redirect(callbackUrl);

  const code = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const error = code ? (ERRORS[code] ?? "Sign-in failed. Try again.") : null;

  return (
    <SitePage>
      <section className="flex justify-center px-[var(--pad-x)] py-[var(--section-y)]">
        <Card className="w-full max-w-[460px] p-10 max-sm:p-7">
          <Eyebrow>Account</Eyebrow>
          <h1 className="mt-4 mb-0 text-[38px] leading-[1.05] font-medium tracking-[-0.03em]">Sign in to Hydra</h1>
          <p className="mt-3 mb-8 text-[16px] leading-[1.45] text-text-2">
            You need an account to run a live Kane hunt, so the daily limit is tracked per person. Watching recorded matches stays free, with no sign-in.
          </p>

          {error && (
            <p role="alert" className="mono mt-0 mb-5 rounded-chip bg-chaos-tint px-3 py-2.5 text-[13px] text-chaos">
              {error}
            </p>
          )}

          {githubConfigured() ? (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: callbackUrl });
              }}
            >
              <Button type="submit" size="lg" className="w-full">
                <GitHubMark />
                Continue with GitHub
              </Button>
            </form>
          ) : (
            <>
              <Button size="lg" className="w-full" disabled aria-describedby="signin-off">
                <GitHubMark />
                Continue with GitHub
              </Button>
              <p id="signin-off" className="meta mt-3 mb-0">
                GitHub sign-in isn&apos;t switched on for this deployment yet.
              </p>
            </>
          )}

          {configured && devSignIn() && (
            <div className="mt-3">
              <DevSignInButton callbackUrl={callbackUrl} />
              <p className="meta mt-2 mb-0">Only on localhost (next dev). Never on the live site.</p>
            </div>
          )}

          <p className="meta mt-6 mb-0">We only read your public GitHub profile: name, username and avatar.</p>
        </Card>
      </section>
    </SitePage>
  );
}
