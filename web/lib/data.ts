import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import type { LibraryBug, Run, RunEvent, RunsIndex } from "./types";

// public/data is copied from ../docs/data (the scrubbed arena export) by scripts/sync-data.mjs.
const DATA = path.join(process.cwd(), "public", "data");

async function json<T>(...parts: string[]): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA, ...parts), "utf8")) as T;
}

export const getIndex = cache(() => json<RunsIndex>("runs.json"));
export const getRun = cache((id: string) => json<Run>("runs", id, "run.json"));
export const getEvents = cache((id: string) => json<RunEvent[]>("runs", id, "events.json"));
export const getLibrary = cache(() => json<LibraryBug[]>("bugs.json"));

export const getPatch = cache(async (id: string, rel: string | null): Promise<string | null> => {
  if (!rel) return null;
  try {
    return await readFile(path.join(DATA, "runs", id, "files", rel), "utf8");
  } catch {
    return null;
  }
});

/** Every recorded run in full, oldest first. */
export const getRuns = cache(async (): Promise<Run[]> => {
  const index = await getIndex();
  const runs = await Promise.all(index.runs.map((r) => getRun(r.runId)));
  return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
});

/** The exporter keeps a subset of each Kane run's screenshots; only show the ones that exist. */
export function fileExists(runId: string, rel: string): boolean {
  return existsSync(path.join(DATA, "runs", runId, "files", rel));
}

/** Public URL of an exported evidence file. */
export function fileUrl(runId: string, rel: string): string {
  return `/data/runs/${runId}/files/${rel}`;
}
