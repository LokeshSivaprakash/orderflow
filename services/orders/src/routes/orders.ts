import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { config } from '../config';
import type { InventoryClient } from '../inventoryClient';
import { authenticate, type AuthUser } from '../lib/auth';
import { asyncHandler, HttpError, validate } from '../lib/http';

const createSchema = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10_000) }))
    .min(1)
    .max(50),
});
const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(['CONFIRMED', 'CANCELLED']).optional(),
});

interface OrderRow {
  id: string;
  user_id: string;
  user_email: string;
  status: 'CONFIRMED' | 'CANCELLED';
  total_cents: string;
  created_at: Date;
}
interface ItemRow {
  order_id: string;
  product_id: string;
  sku: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
}

const toDto = (o: OrderRow, items: ItemRow[]) => ({
  id: o.id,
  userId: o.user_id,
  userEmail: o.user_email,
  status: o.status,
  totalCents: Number(o.total_cents),
  createdAt: o.created_at,
  items: items.map((i) => ({
    productId: i.product_id,
    sku: i.sku,
    name: i.name,
    unitPriceCents: i.unit_price_cents,
    quantity: i.quantity,
  })),
});

export function ordersRouter(pool: Pool, inventory: InventoryClient) {
  const r = Router();
  r.use(authenticate(config.jwtSecret));

  async function loadItems(orderIds: string[]) {
    if (!orderIds.length) return new Map<string, ItemRow[]>();
    const { rows } = await pool.query<ItemRow>('SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY name', [orderIds]);
    const m = new Map<string, ItemRow[]>();
    for (const row of rows) m.set(row.order_id, [...(m.get(row.order_id) ?? []), row]);
    return m;
  }

  /**
   * Create order = saga: (1) reserve stock in inventory-service, (2) persist order locally.
   * If (2) fails, run the compensating action (release stock) so the systems stay consistent.
   */
  r.post(
    '/',
    validate(createSchema),
    asyncHandler(async (req, res) => {
      const { items } = req.body as z.infer<typeof createSchema>;
      const reserved = await inventory.reserve(items);
      const total = reserved.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<OrderRow>(
          'INSERT INTO orders (user_id, user_email, total_cents) VALUES ($1,$2,$3) RETURNING *',
          [req.user!.id, req.user!.email, total],
        );
        const order = rows[0];
        for (const l of reserved) {
          await client.query(
            'INSERT INTO order_items (order_id, product_id, sku, name, unit_price_cents, quantity) VALUES ($1,$2,$3,$4,$5,$6)',
            [order.id, l.productId, l.sku, l.name, l.unitPriceCents, l.quantity],
          );
        }
        await client.query('COMMIT');
        const stored = await loadItems([order.id]);
        res.status(201).json(toDto(order, stored.get(order.id) ?? []));
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        await inventory.release(reserved).catch((e) => console.error(JSON.stringify({ level: 'error', msg: 'compensation failed', err: String(e) })));
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  r.get(
    '/',
    validate(listQuery, 'query'),
    asyncHandler(async (req, res) => {
      const { page, pageSize, status } = req.query as unknown as z.infer<typeof listQuery>;
      const conds: string[] = [];
      const params: unknown[] = [];
      if (req.user!.role !== 'admin') {
        params.push(req.user!.id);
        conds.push(`user_id = $${params.length}`);
      }
      if (status) {
        params.push(status);
        conds.push(`status = $${params.length}`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const total = Number((await pool.query<{ count: string }>(`SELECT count(*) FROM orders ${where}`, params)).rows[0].count);
      const { rows } = await pool.query<OrderRow>(
        `SELECT * FROM orders ${where} ORDER BY created_at DESC, id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params,
      );
      const items = await loadItems(rows.map((o) => o.id));
      res.json({ items: rows.map((o) => toDto(o, items.get(o.id) ?? [])), page, pageSize, total });
    }),
  );

  async function findAccessible(id: string, user: AuthUser) {
    const { rows } = await pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
    const o = rows[0];
    // 404 (not 403) for other users' orders so IDs cannot be probed.
    if (!o || (user.role !== 'admin' && o.user_id !== user.id)) throw new HttpError(404, 'Order not found');
    return o;
  }

  r.get(
    '/:id',
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      const o = await findAccessible(req.params.id, req.user!);
      res.json(toDto(o, (await loadItems([o.id])).get(o.id) ?? []));
    }),
  );

  r.post(
    '/:id/cancel',
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      const o = await findAccessible(req.params.id, req.user!);
      // Conditional update makes cancellation idempotent-safe under concurrent requests.
      const upd = await pool.query<OrderRow>(
        `UPDATE orders SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND status = 'CONFIRMED' RETURNING *`,
        [o.id],
      );
      if (!upd.rows[0]) throw new HttpError(409, 'Order is already cancelled');
      const items = (await loadItems([o.id])).get(o.id) ?? [];
      try {
        await inventory.release(items.map((i) => ({ productId: i.product_id, quantity: i.quantity })));
      } catch (err) {
        await pool.query(`UPDATE orders SET status = 'CONFIRMED', updated_at = now() WHERE id = $1`, [o.id]);
        throw err;
      }
      res.json(toDto(upd.rows[0], items));
    }),
  );

  return r;
}
