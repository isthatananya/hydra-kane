// Copies the recorded runs (already scrubbed by `hydra export-arena`) into public/data,
// and writes the chaos bug library next to them. Every number on the site comes from here.
import { cp, mkdir, writeFile, access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(web, "..");
const from = path.join(repo, "docs", "data");
const to = path.join(web, "public", "data");

const exists = (p) => access(p).then(() => true, () => false);

if (!(await exists(from))) {
  if (await exists(path.join(to, "runs.json"))) {
    console.log("sync-data: no ../docs/data, keeping the existing public/data");
    process.exit(0);
  }
  console.error("sync-data: ../docs/data is missing. Run `hydra export-arena --state demo -o docs` first.");
  process.exit(1);
}

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });

// The bug library. web/data/bugs.json is committed so a clean clone (Vercel's Git builds) has it;
// it is refreshed from the compiled chaos library whenever dist/ exists locally.
const committed = path.join(web, "data", "bugs.json");
const taxonomy = path.join(repo, "dist", "chaos", "taxonomy.js");
if (await exists(taxonomy)) {
  const { BUGS } = await import(pathToFileURL(taxonomy).href);
  const bugs = BUGS.map(({ id, title, bugClass, surface, description, edits, breaks, kaneHypothesis, rationale }) =>
    ({ id, title, bugClass, surface, description, edits, breaks, kaneHypothesis, rationale }));
  await mkdir(path.dirname(committed), { recursive: true });
  await writeFile(committed, JSON.stringify(bugs, null, 2) + "\n");
}
if (!(await exists(committed))) {
  console.error("sync-data: web/data/bugs.json is missing. Run `npm run build` in the repo root first.");
  process.exit(1);
}
await cp(committed, path.join(to, "bugs.json"));
console.log("sync-data: copied", path.relative(repo, from), "->", path.relative(repo, to));
