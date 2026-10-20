import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { config } from '../config';
import type { InventoryClient } from '../inventoryClient';
import { requireInternalKey } from '../lib/auth';
import { asyncHandler, HttpError, validate } from '../lib/http';
import { cancelPendingOrder, getOrder, loadItems, toDto } from '../orderModel';

const idParams = z.object({ id: z.string().uuid() });

/** Service-to-service endpoints used by the payment service. Guarded by a shared key and blocked at the gateway. */
export function internalRouter(pool: Pool, inventory: InventoryClient) {
  const r = Router();
  r.use(requireInternalKey(config.internalKey));

  async function load(id: string) {
    const o = await getOrder(pool, id);
    if (!o) throw new HttpError(404, 'Order not found');
    return o;
  }

  r.get(
    '/:id',
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      const o = await load(req.params.id);
      res.json(toDto(o, (await loadItems(pool, [o.id])).get(o.id) ?? []));
    }),
  );

  // Idempotent: PENDING_PAYMENT -> PAID. A second call (webhook retry) returns 200. A cancelled order returns 409
  // so the payment service knows it must refund.
  r.post(
    '/:id/paid',
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      const upd = await pool.query(
        `UPDATE orders SET status = 'PAID', paid_at = now(), updated_at = now() WHERE id = $1 AND status = 'PENDING_PAYMENT' RETURNING id`,
        [req.params.id],
      );
      const o = await load(req.params.id);
      if (!upd.rowCount && o.status === 'CANCELLED') throw new HttpError(409, 'Order was cancelled before payment completed');
      res.json({ id: o.id, status: o.status });
    }),
  );

  // Idempotent: PENDING_PAYMENT -> CANCELLED and release stock; no-op otherwise.
  r.post(
    '/:id/expire',
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      await load(req.params.id);
      const result = await cancelPendingOrder(pool, inventory, req.params.id);
      res.json({ id: req.params.id, status: result.order.status });
    }),
  );

  return r;
}
