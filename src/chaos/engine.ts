import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";
import type { Bug, Edit } from "./taxonomy.js";

export class PatchError extends Error {}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Normalise to LF for matching; restore the file's original line endings on write. */
function readNormalized(path: string): { text: string; crlf: boolean } {
  const raw = readFileSync(path, "utf8");
  return { text: raw.replace(/\r\n/g, "\n"), crlf: raw.includes("\r\n") };
}

export type AppliedPatch = { files: string[]; diff: string };

/** Check that every edit applies exactly once, without writing anything. */
export function checkEdits(workspace: string, edits: Edit[]): string[] {
  const problems: string[] = [];
  const pending = new Map<string, string>();
  for (const e of edits) {
    const path = join(workspace, e.file);
    if (!pending.has(e.file)) {
      if (!existsSync(path)) {
        problems.push(`${e.file}: file not found`);
        continue;
      }
      pending.set(e.file, readNormalized(path).text);
    }
    const text = pending.get(e.file)!;
    const n = countOccurrences(text, e.find);
    if (n !== 1) {
      problems.push(`${e.file}: expected exactly 1 match for edit, found ${n}`);
      continue;
    }
    pending.set(e.file, text.replace(e.find, () => e.replace));
  }
  return problems;
}

/** Apply all edits atomically: either every edit applies or nothing is written. */
export function applyEdits(workspace: string, edits: Edit[]): AppliedPatch {
  const problems = checkEdits(workspace, edits);
  if (problems.length) throw new PatchError(`Patch does not apply:\n  ${problems.join("\n  ")}`);
  const originals = new Map<string, { text: string; crlf: boolean }>();
  const updated = new Map<string, string>();
  for (const e of edits) {
    if (!originals.has(e.file)) {
      const o = readNormalized(join(workspace, e.file));
      originals.set(e.file, o);
      updated.set(e.file, o.text);
    }
    updated.set(e.file, updated.get(e.file)!.replace(e.find, () => e.replace));
  }
  let diff = "";
  for (const [file, text] of updated) {
    const orig = originals.get(file)!;
    writeFileSync(join(workspace, file), orig.crlf ? text.replace(/\n/g, "\r\n") : text);
    diff += createTwoFilesPatch(`a/${file}`, `b/${file}`, orig.text, text, "", "", { context: 3 });
  }
  return { files: [...updated.keys()], diff };
}

export function applyBug(workspace: string, bug: Bug): AppliedPatch {
  return applyEdits(workspace, bug.edits);
}

/** Combine bugs into one compound bug (escalation). Returns null when their edits conflict. */
export function compoundBug(parts: Bug[], workspace: string): Bug | null {
  const edits = parts.flatMap((b) => b.edits);
  if (checkEdits(workspace, edits).length) return null;
  return {
    id: parts.map((b) => b.id).join("+"),
    title: parts.map((b) => b.title).join(" + "),
    bugClass: parts[0]!.bugClass,
    surface: new Set(parts.map((b) => b.surface)).size === 1 ? parts[0]!.surface : "mixed",
    description: parts.map((b) => b.description).join(" ALSO: "),
    edits,
    breaks: [...new Set(parts.flatMap((b) => b.breaks))],
    kaneHypothesis: parts.some((b) => b.kaneHypothesis === "caught") ? "caught" : parts[0]!.kaneHypothesis,
    rationale: "Compound bug from escalation.",
  };
}
