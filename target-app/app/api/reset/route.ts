import { NextResponse } from "next/server";
import { resetStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Restores the seeded initial state. Hydra calls this before every Kane run. */
export async function POST() {
  resetStore();
  return NextResponse.json({ ok: true });
}
