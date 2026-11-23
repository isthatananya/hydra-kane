#!/usr/bin/env node
// An honest stand-in builder for the loop test. It saves the heal prompt it was given (so the
// test can check what the builder was, and was not, told), then fixes the shipping formula the
// way a good agent would. cwd is the sandboxed workspace; the prompt arrives on stdin.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const prompt = readFileSync(0, "utf8");
appendFileSync(join(process.env.HYDRA_ROOT, "prompts-seen.txt"), `${prompt}\n=====\n`);

const file = join(process.cwd(), "lib", "pricing.ts");
const src = readFileSync(file, "utf8");
const fixed = src.replace("const shippingCents = lines.length * SHIPPING_CENTS;", "const shippingCents = lines.length > 0 ? SHIPPING_CENTS : 0;");
writeFileSync(file, fixed);
console.log(fixed === src ? "fix-builder: nothing to change" : "fix-builder: shipping is charged once per order again");
