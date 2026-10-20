import type { Pool } from 'pg';
import type { InventoryClient } from './inventoryClient';

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';

export interface OrderRow {
  id: string;
  user_id: string;
  user_email: string;
  status: OrderStatus;
  total_cents: string;
  created_at: Date;
  paid_at: Date | null;
}
export interface ItemRow {
  order_id: string;
  product_id: string;
  sku: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
}

export const toDto = (o: OrderRow, items: ItemRow[]) => ({
  id: o.id,
  userId: o.user_id,
  userEmail: o.user_email,
  status: o.status,
  totalCents: Number(o.total_cents),
  createdAt: o.created_at,
  paidAt: o.paid_at,
  items: items.map((i) => ({
    productId: i.product_id,
    sku: i.sku,
    name: i.name,
    unitPriceCents: i.unit_price_cents,
    quantity: i.quantity,
  })),
});

export async function loadItems(pool: Pool, orderIds: string[]) {
  const m = new Map<string, ItemRow[]>();
  if (!orderIds.length) return m;
  const { rows } = await pool.query<ItemRow>('SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY name', [orderIds]);
  for (const row of rows) m.set(row.order_id, [...(m.get(row.order_id) ?? []), row]);
  return m;
}

export async function getOrder(pool: Pool, id: string) {
  return (await pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
}

/**
 * Cancel an order that is still awaiting payment and give its stock back.
 * The conditional UPDATE makes this safe to call twice or concurrently (user cancel racing the
 * checkout-expired webhook): only one caller flips the status and releases stock.
 */
export async function cancelPendingOrder(pool: Pool, inventory: InventoryClient, orderId: string) {
  const upd = await pool.query<OrderRow>(
    `UPDATE orders SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND status = 'PENDING_PAYMENT' RETURNING *`,
    [orderId],
  );
  if (!upd.rows[0]) return { changed: false as const, order: await getOrder(pool, orderId) };
  const items = (await loadItems(pool, [orderId])).get(orderId) ?? [];
  try {
    await inventory.release(items.map((i) => ({ productId: i.product_id, quantity: i.quantity })));
  } catch (err) {
    await pool.query(`UPDATE orders SET status = 'PENDING_PAYMENT', updated_at = now() WHERE id = $1`, [orderId]);
    throw err;
  }
  return { changed: true as const, order: upd.rows[0] };
}
