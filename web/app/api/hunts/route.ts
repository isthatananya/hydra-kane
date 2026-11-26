import { auth } from "@/auth";
import { createHunt } from "@/lib/hunts";

/** Queue a live Kane hunt for the signed-in judge. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to run a live hunt." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { shop?: unknown };
  const res = await createHunt({ id: session.user.id, login: session.user.login ?? session.user.name ?? null }, String(body.shop ?? ""));
  if (!res.ok) return Response.json({ error: res.error, id: res.id }, { status: res.status });
  return Response.json({ id: res.id }, { status: 201 });
}
