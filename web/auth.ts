import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

const hasGitHub = () => Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
/** `next dev` only: a one-click local tester, so the signed-in flow can be tried before GitHub is set up. */
export const devSignIn = () => process.env.NODE_ENV === "development";

/** Sign-in works when there's a secret and at least one way in; otherwise the sign-in page says so. */
export const authConfigured = () => Boolean(process.env.AUTH_SECRET) && (hasGitHub() || devSignIn());
export const githubConfigured = () => Boolean(process.env.AUTH_SECRET) && hasGitHub();

const providers: Provider[] = [GitHub];
if (devSignIn()) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Local tester",
      credentials: {},
      authorize: () => ({ id: "local-tester", name: "Local tester" }),
    }),
  );
}

// Sessions are signed JWT cookies, so there is no user database. `session.user.id` (the GitHub
// user id) keys the daily hunt limit.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  pages: { signIn: "/signin", error: "/signin" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  callbacks: {
    jwt({ token, profile }) {
      if (profile) {
        token.login = typeof profile.login === "string" ? profile.login : undefined;
        token.sub = String(profile.id ?? token.sub);
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? "";
      session.user.login = typeof token.login === "string" ? token.login : undefined;
      return session;
    },
  },
});

/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeCallback(raw: string | string[] | undefined, fallback = "/"): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
}
