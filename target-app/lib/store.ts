// In-memory, process-local order store. Deterministic: ids restart at ORD-1001 after reset.
import type { QuoteLine } from "./pricing";

export type Order = {
  id: string;
  createdSeq: number;
  name: string;
  email: string;
  cardLast4: string;
  lines: QuoteLine[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  couponCode: string | null;
};

type StoreState = {
  nextSeq: number;
  orders: Map<string, Order>;
  byIdempotencyKey: Map<string, string>;
};

const g = globalThis as typeof globalThis & { __hydraStore?: StoreState };

function fresh(): StoreState {
  return { nextSeq: 1001, orders: new Map(), byIdempotencyKey: new Map() };
}

function state(): StoreState {
  if (!g.__hydraStore) g.__hydraStore = fresh();
  return g.__hydraStore;
}

export function resetStore(): void {
  g.__hydraStore = fresh();
}

export function findOrderByKey(key: string): Order | undefined {
  const id = state().byIdempotencyKey.get(key);
  return id ? state().orders.get(id) : undefined;
}

export function createOrder(data: Omit<Order, "id" | "createdSeq">, idempotencyKey: string): Order {
  const s = state();
  const seq = s.nextSeq++;
  const order: Order = { ...data, id: `ORD-${seq}`, createdSeq: seq };
  s.orders.set(order.id, order);
  s.byIdempotencyKey.set(idempotencyKey, order.id);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return state().orders.get(id);
}

export function listOrders(): Order[] {
  return [...state().orders.values()].sort((a, b) => a.createdSeq - b.createdSeq);
}
