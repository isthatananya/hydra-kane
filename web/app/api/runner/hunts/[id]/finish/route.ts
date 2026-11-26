import { finishHunt, huntsEnabled, runnerAuthorized, type FinishBody } from "@/lib/hunts";

/** The runner reports Kane's verdict. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!huntsEnabled()) return Response.json({ error: "Hunts aren't configured." }, { status: 503 });
  if (!runnerAuthorized(req)) return Response.json({ error: "Bad runner token." }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as FinishBody | null;
  if (!body || typeof body.verdict !== "string") return Response.json({ error: "Missing verdict." }, { status: 400 });
  const ok = await finishHunt(id, body);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "No such hunt." }, { status: 404 });
}
