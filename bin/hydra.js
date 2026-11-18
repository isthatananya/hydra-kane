#!/usr/bin/env node
import("../dist/cli.js").catch((err) => {
  if (err && err.code === "ERR_MODULE_NOT_FOUND" && String(err.message).includes("dist")) {
    console.error("hydra: not built yet. Run `npm run build` in the hydra-kane checkout.");
  } else {
    console.error(err);
  }
  process.exit(2);
});
