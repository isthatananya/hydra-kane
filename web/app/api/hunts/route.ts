import { createHash } from "node:crypto";
import { auth, authConfigured } from "@/auth";
import { createHunt } from "@/lib/hunts";

/**
 * Queue a live Kane hunt. No sign-in needed: a signed-in judge is limited per account, anyone else
 * per IP address (hashed, never stored raw). A global daily cap bounds the Kane credits either way.
 */
export async function POST(req: Request) {
  const session = authConfigured() ? await auth() : null;
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const anon = `ip:${createHash("sha256").update(`${process.env.HYDRA_RUNNER_TOKEN ?? ""}:${ip}`).digest("hex").slice(0, 20)}`;
  const user = session?.user?.id
    ? { id: session.user.id, login: session.user.login ?? session.user.name ?? null }
    : { id: anon, login: null };
  const body = (await req.json().catch(() => ({}))) as { shop?: unknown };
  const res = await createHunt(user, String(body.shop ?? ""));
  if (!res.ok) return Response.json({ error: res.error, id: res.id }, { status: res.status });
  return Response.json({ id: res.id }, { status: 201 });
}
