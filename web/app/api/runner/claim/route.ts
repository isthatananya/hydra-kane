import { claimHunt, huntsEnabled, runnerAuthorized } from "@/lib/hunts";

/** The runner asks for the next queued hunt (and, by asking, reports itself online). */
export async function POST(req: Request) {
  if (!huntsEnabled()) return Response.json({ error: "Hunts aren't configured." }, { status: 503 });
  if (!runnerAuthorized(req)) return Response.json({ error: "Bad runner token." }, { status: 401 });
  const job = await claimHunt();
  return job ? Response.json(job) : new Response(null, { status: 204 });
}
