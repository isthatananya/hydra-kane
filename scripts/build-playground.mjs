#!/usr/bin/env node
// Build the shop variants for the "Find the bug before Kane" challenge.
// Each variant is the target app with exactly one chaos bug applied, using the same
// edits `hydra run` applies. Output: playground/<slot>/ (a standalone Next.js app).
//
//   node scripts/build-playground.mjs            # writes playground/
//   cd playground/<slot> && vercel deploy --prod # one Vercel project per slot
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUGS } from "../dist/chaos/taxonomy.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "target-app");
const out = join(root, "playground");

/** Slots are named by letter so the URL never gives the bug away. */
export const SLOTS = [
  { slot: "a", bug: "stale-cart" },
  { slot: "b", bug: "validation-bypass" },
  { slot: "c", bug: "wrong-total" },
];

const HOSTING_EDITS = [
  [
    "app/api/pay/route.ts",
    "return NextResponse.json({ orderId: order.id, totalCents: order.totalCents });",
    "return NextResponse.json({ orderId: order.id, totalCents: order.totalCents, order });",
  ],
  [
    "components/Checkout.tsx",
    "const data = (await res.json().catch(() => ({}))) as { orderId?: string; error?: string; errors?: FieldErrors };",
    "const data = (await res.json().catch(() => ({}))) as { orderId?: string; order?: unknown; error?: string; errors?: FieldErrors };",
  ],
  [
    "components/Checkout.tsx",
    "router.push(`/order/${encodeURIComponent(data.orderId)}`);",
    "router.push(`/order/${encodeURIComponent(data.orderId)}${data.order ? `?o=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(data.order)))))}` : \"\"}`);",
  ],
  [
    "app/order/[id]/page.tsx",
    "export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {\n  const { id } = await params;\n  const order = getOrder(decodeURIComponent(id));",
    "function fromUrl(o: string | undefined): ReturnType<typeof getOrder> {\n  if (!o) return undefined;\n  try {\n    return JSON.parse(Buffer.from(o, \"base64\").toString(\"utf8\"));\n  } catch {\n    return undefined;\n  }\n}\n\nexport default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ o?: string }> }) {\n  const { id } = await params;\n  const { o } = await searchParams;\n  const order = getOrder(decodeURIComponent(id)) ?? fromUrl(o);",
  ],
];

rmSync(out, { recursive: true, force: true });
for (const { slot, bug: bugId } of SLOTS) {
  const bug = BUGS.find((b) => b.id === bugId);
  if (!bug) throw new Error(`unknown bug ${bugId}`);
  const dest = join(out, `shop-${slot}`);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (p) => !/[\\/](node_modules|\.next)([\\/]|$)/.test(p),
  });
  for (const e of bug.edits) {
    const file = join(dest, e.file);
    const text = readFileSync(file, "utf8");
    const hits = text.split(e.find).length - 1;
    if (hits !== 1) throw new Error(`${bugId}: edit in ${e.file} matched ${hits} times`);
    writeFileSync(file, text.replace(e.find, e.replace));
  }
  // Serverless: /api/pay and /order/[id] run in different functions with no shared memory,
  // so the confirmation page would never find the order. Carry it in the URL instead.
  // (Playground copies only; the app Hydra tests is unchanged.)
  for (const [file, find, replace] of HOSTING_EDITS) {
    const path = join(dest, file);
    const text = readFileSync(path, "utf8");
    if (text.split(find).length !== 2) throw new Error(`hosting edit did not match once in ${file}`);
    writeFileSync(path, text.replace(find, replace));
  }
  // Vercel installs dependencies itself; drop the monorepo root lookup's local-only ports.
  const pkg = JSON.parse(readFileSync(join(dest, "package.json"), "utf8"));
  pkg.name = `hydra-shop-${slot}`;
  pkg.scripts = { dev: "next dev", build: "next build", start: "next start" };
  writeFileSync(join(dest, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  if (!existsSync(join(dest, ".gitignore"))) writeFileSync(join(dest, ".gitignore"), "node_modules\n.next\n.vercel\n");
  console.log(`shop-${slot}: ${bugId} (${bug.edits.length} edit${bug.edits.length === 1 ? "" : "s"})`);
}
