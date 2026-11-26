import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, authConfigured } from "@/auth";
import { SignOutButton } from "@/components/session";
import { dailyLimit } from "@/lib/hunts";
import { SitePage } from "@/components/site";
import { ButtonLink, Card, Eyebrow } from "@/components/ui";

export const metadata: Metadata = { title: "Account" };

export default async function Account() {
  await connection();
  const session = authConfigured() ? await auth() : null;
  if (!session?.user) redirect("/signin?callbackUrl=/account");
  const { user } = session;
  const name = user.name ?? user.login ?? "Your account";

  return (
    <SitePage>
      <section className="flex justify-center px-[var(--pad-x)] py-[var(--section-y)]">
        <Card className="w-full max-w-[560px] p-10 max-sm:p-7">
          <Eyebrow>Account</Eyebrow>
          <div className="mt-5 flex items-center gap-4">
            {user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" width={56} height={56} className="size-14 rounded-full border border-line" />
            )}
            <div className="min-w-0">
              <h1 className="m-0 truncate text-[30px] leading-[1.1] font-medium tracking-[-0.02em]">{name}</h1>
              {user.login && <div className="meta mt-1">github.com/{user.login}</div>}
            </div>
          </div>

          <dl className="mt-8 mb-0 grid grid-cols-2 gap-4 border-t border-line pt-6 max-sm:grid-cols-1">
            <div>
              <dt className="meta">Live Kane hunts</dt>
              <dd className="m-0 mt-1 text-[18px] font-medium">{dailyLimit()} per day</dd>
            </div>
            <div>
              <dt className="meta">Full matches</dt>
              <dd className="m-0 mt-1 text-[18px] font-medium">On your own machine</dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/run?mode=live">Run a hunt</ButtonLink>
            <SignOutButton />
          </div>
        </Card>
      </section>
    </SitePage>
  );
}
