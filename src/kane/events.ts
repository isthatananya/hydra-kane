/** A single NDJSON event from `kane-cli --agent`. Kane's schema is open; read fields defensively. */
export type KaneEvent = { type?: string; [key: string]: unknown };

export type ExtractedEvidence = {
  runEnd: Record<string, unknown> | null;
  summary: string | null;
  testUrl: string | null;
  failingStep: { index: number | null; description: string | null; reason: string | null } | null;
  extracted: unknown;
  credits: number | null;
  kaneRunDirs: string[];
  errorMessage: string | null;
  steps: Array<{ index: number | null; description: string | null; status: string | null }>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function pick(obj: Record<string, unknown> | null | undefined, keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function stepDescription(ev: Record<string, unknown>): string | null {
  return (
    str(pick(ev, ["description", "step", "title", "heading", "objective", "action", "text", "instruction"])) ??
    str(pick(ev.step as Record<string, unknown> | undefined, ["description", "title", "text"]))
  );
}

export function extractEvidence(events: KaneEvent[]): ExtractedEvidence {
  let runEnd: Record<string, unknown> | null = null;
  let errorMessage: string | null = null;
  const dirs = new Set<string>();
  const steps: ExtractedEvidence["steps"] = [];
  const stepStarts = new Map<string, string>();
  let failingStep: ExtractedEvidence["failingStep"] = null;

  for (const ev of events) {
    const type = ev.type ?? "";
    for (const [k, v] of Object.entries(ev)) {
      if (/(^|_)(run|session|pack)_?dir$/i.test(k) && typeof v === "string") dirs.add(v);
      if (/(^|_)(run|session)_?dirs$/i.test(k) && Array.isArray(v)) for (const d of v) if (typeof d === "string") dirs.add(d);
    }
    if (type === "run_end") runEnd = ev as Record<string, unknown>;
    if (type === "error") errorMessage = str(ev.message) ?? errorMessage;

    if (/step_start$/.test(type)) {
      const key = String(pick(ev, ["index", "step_index", "id"]) ?? steps.length);
      const d = stepDescription(ev);
      if (d) stepStarts.set(key, d);
    }
    if (/step_end$/.test(type) || type === "step_complete") {
      const idx = num(pick(ev, ["index", "step_index", "ordinal"]));
      const key = String(pick(ev, ["index", "step_index", "id"]) ?? steps.length);
      const status = str(ev.status);
      const description = stepDescription(ev) ?? stepStarts.get(key) ?? null;
      steps.push({ index: idx, description, status });
      if (status && /fail|error|broken/i.test(status)) {
        failingStep = {
          index: idx,
          description,
          reason: str(pick(ev, ["reason", "error", "message", "remark", "detail", "summary"])),
        };
      }
    }
  }

  if (runEnd && !failingStep) {
    const fs = pick(runEnd, ["failed_step", "failing_step", "failure"]);
    if (fs && typeof fs === "object") {
      const o = fs as Record<string, unknown>;
      failingStep = {
        index: num(pick(o, ["index", "step_index"])),
        description: stepDescription(o),
        reason: str(pick(o, ["reason", "error", "message"])),
      };
    } else if (runEnd.status === "failed") {
      const idx = num(pick(runEnd, ["failed_step_index", "step_index"]));
      if (idx !== null) failingStep = { index: idx, description: null, reason: str(runEnd.reason) };
    }
  }

  return {
    runEnd,
    summary: str(pick(runEnd, ["summary", "reason", "remark", "message"])),
    testUrl: str(pick(runEnd, ["test_url", "share_link", "shareLink", "dashboard_url", "url"])),
    failingStep,
    extracted: pick(runEnd, ["extracted", "extracted_values", "extractions", "variables", "outputs"]) ?? null,
    credits: num(pick(runEnd, ["credits", "credits_consumed", "creditsConsumed", "credits_used"])),
    kaneRunDirs: [...dirs],
    errorMessage,
    steps,
  };
}
