// Seeded, deterministic catalog. Prices are integer cents to avoid float drift.
export type Product = {
  sku: string;
  name: string;
  description: string;
  priceCents: number;
};

export const CATALOG: readonly Product[] = [
  { sku: "MUG-01", name: "Trail Mug", description: "Enamel camp mug, 12 oz.", priceCents: 1800 },
  { sku: "TOTE-01", name: "Canvas Tote", description: "Heavy canvas, reinforced handles.", priceCents: 2400 },
  { sku: "NOTE-01", name: "Field Notebook", description: "Pocket notebook, 48 pages, dot grid.", priceCents: 950 },
];

export const MAX_QTY = 10;

export function findProduct(sku: string): Product | undefined {
  return CATALOG.find((p) => p.sku === sku);
}
