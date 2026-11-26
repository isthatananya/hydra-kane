import { runnerStatus } from "@/lib/hunts";

/** Whether the runner machine is online and how many hunts are waiting. */
export async function GET() {
  return Response.json(await runnerStatus(), { headers: { "cache-control": "no-store" } });
}
