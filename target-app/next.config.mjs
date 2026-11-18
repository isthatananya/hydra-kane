import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Hydra builds copies of this app in sandboxed workspaces that have no node_modules of
// their own; dependencies resolve from the nearest ancestor that has `next` installed.
// Turbopack must be told that ancestor is the project root.
function findModulesRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "node_modules", "next", "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const root = findModulesRoot(here);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default nextConfig;
