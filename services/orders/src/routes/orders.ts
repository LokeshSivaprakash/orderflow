import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { config } from '../config';
import type { InventoryClient } from '../inventoryClient';
import { authenticate, type AuthUser } from '../lib/auth';
import { asyncHandler, HttpError, validate } from '../lib/http';
import { cancelPendingOrder, getOrder, loadItems, toDto, type OrderRow } from '../orderModel';

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
  status: z.enum(['PENDING_PAYMENT', 'PAID', 'CANCELLED']).optional(),
});

export function ordersRouter(pool: Pool, inventory: InventoryClient) {
  const r = Router();
  r.use(authenticate(config.jwtSecret));

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
        const stored = await loadItems(pool, [order.id]);
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
      const items = await loadItems(pool, rows.map((o) => o.id));
      res.json({ items: rows.map((o) => toDto(o, items.get(o.id) ?? [])), page, pageSize, total });
    }),
  );

  async function findAccessible(id: string, user: AuthUser) {
    const o = await getOrder(pool, id);
    // 404 (not 403) for other users' orders so IDs cannot be probed.
    if (!o || (user.role !== 'admin' && o.user_id !== user.id)) throw new HttpError(404, 'Order not found');
    return o;
  }

  r.get(
    '/:id',
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      const o = await findAccessible(req.params.id, req.user!);
      res.json(toDto(o, (await loadItems(pool, [o.id])).get(o.id) ?? []));
    }),
  );

  r.post(
    '/:id/cancel',
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      const o = await findAccessible(req.params.id, req.user!);
      if (o.status === 'PAID') throw new HttpError(409, 'Paid orders cannot be cancelled here - a refund is required');
      const result = await cancelPendingOrder(pool, inventory, o.id);
      if (!result.changed) throw new HttpError(409, 'Order is already cancelled');
      res.json(toDto(result.order as OrderRow, (await loadItems(pool, [o.id])).get(o.id) ?? []));
    }),
  );

  return r;
}
