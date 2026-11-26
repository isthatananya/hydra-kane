import { getHuntView } from "@/lib/hunts";

/** A hunt's state and its Kane steps after `?after=N`. Public, so a hunt link can be shared. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const after = Math.max(0, Number(new URL(req.url).searchParams.get("after")) || 0);
  const view = await getHuntView(id, after);
  if (!view) return Response.json({ error: "No such hunt." }, { status: 404 });
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
