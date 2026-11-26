import { appendSteps, huntsEnabled, runnerAuthorized, type HuntStep } from "@/lib/hunts";

/** Kane's steps, streamed by the runner as they happen. An empty batch is a heartbeat. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!huntsEnabled()) return Response.json({ error: "Hunts aren't configured." }, { status: 503 });
  if (!runnerAuthorized(req)) return Response.json({ error: "Bad runner token." }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { steps?: HuntStep[] };
  const ok = await appendSteps(id, Array.isArray(body.steps) ? body.steps : []);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "Hunt isn't running." }, { status: 409 });
}
