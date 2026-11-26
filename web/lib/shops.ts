// Each shop is the target app with one chaos bug applied (scripts/build-playground.mjs).
// `run` is a recorded Hydra run on the same bug: Kane's recorded verdict and time come from it.
// The `hydra worker` keeps its own copy of these URLs and only ever hunts on them.
export const SHOPS = [
  { slot: "a", url: "https://hydra-shop-a.vercel.app/", bug: "stale-cart", run: "20261119-140125-s12-claude" },
  { slot: "b", url: "https://hydra-shop-b.vercel.app/", bug: "validation-bypass", run: "20261119-013112-s14-claude" },
  { slot: "c", url: "https://hydra-shop-c.vercel.app/", bug: "wrong-total", run: "20261119-003757-s7-claude" },
] as const;

export type ShopSlot = (typeof SHOPS)[number]["slot"];
export const shopBySlot = (slot: string) => SHOPS.find((s) => s.slot === slot);
