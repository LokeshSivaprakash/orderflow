import type { Pool, PoolClient } from 'pg';
import { HttpError } from './lib/http';
import type { OrdersClient } from './ordersClient';
import type { PaymentEvent, PaymentProvider } from './provider';

export interface PaymentRow {
  id: string;
  order_id: string;
  user_id: string;
  provider: string;
  provider_session_id: string;
  payment_intent_id: string | null;
  checkout_url: string;
  amount_cents: string;
  status: 'CREATED' | 'PAID' | 'EXPIRED' | 'REFUNDED';
  created_at: Date;
}

export interface Deps {
  pool: Pool;
  provider: PaymentProvider;
  orders: OrdersClient;
  publicUrl: string;
}

/** Serialise all payment work for one order (checkout creation and webhook handling) with a transaction-scoped advisory lock. */
async function withOrderLock<T>(pool: Pool, orderId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [orderId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const REUSE_WINDOW_MINUTES = 25;

/** Create (or reuse) a hosted checkout session for an unpaid order owned by `userId`. */
export async function createCheckout(deps: Deps, userId: string, orderId: string) {
  const order = await deps.orders.getOrder(orderId);
  // 404 for other people's orders so IDs cannot be probed.
  if (!order || order.userId !== userId) throw new HttpError(404, 'Order not found');
  if (order.status !== 'PENDING_PAYMENT') throw new HttpError(409, `Order is ${order.status.toLowerCase().replace('_', ' ')} and cannot be paid`);
  if (order.totalCents <= 0) throw new HttpError(409, 'Nothing to pay');

  return withOrderLock(deps.pool, orderId, async (db) => {
    const existing = await db.query<PaymentRow>(
      `SELECT * FROM payments WHERE order_id = $1 AND status = 'CREATED'
         AND created_at > now() - make_interval(mins => $2) ORDER BY created_at DESC LIMIT 1`,
      [orderId, REUSE_WINDOW_MINUTES],
    );
    if (existing.rows[0]) return { url: existing.rows[0].checkout_url, reused: true };

    const attempt = Number((await db.query<{ count: string }>('SELECT count(*) FROM payments WHERE order_id = $1', [orderId])).rows[0].count) + 1;
    let session;
    try {
      session = await deps.provider.createCheckoutSession({
        order,
        attempt,
        successUrl: `${deps.publicUrl}/orders?payment=success`,
        cancelUrl: `${deps.publicUrl}/orders?payment=cancelled`,
      });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'checkout session creation failed', err: (err as Error).message }));
      throw new HttpError(502, 'Payment provider unavailable, please try again');
    }
    await db.query(
      `INSERT INTO payments (order_id, user_id, provider, provider_session_id, checkout_url, amount_cents)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orderId, userId, deps.provider.name, session.id, session.url, order.totalCents],
    );
    return { url: session.url, reused: false };
  });
}

/**
 * Apply a verified provider event. Every step is idempotent because providers deliver webhooks at least once:
 * a retry after a partial failure re-runs the remaining steps safely. Throwing makes the webhook return 5xx so the
 * provider retries.
 */
export async function handleEvent(deps: Deps, event: PaymentEvent): Promise<'handled' | 'ignored' | 'refunded'> {
  if (event.type === 'ignored') return 'ignored';

  if (event.type === 'expired') {
    const mayCancel = await withOrderLock(deps.pool, event.orderId, async (db) => {
      await db.query(
        `UPDATE payments SET status = 'EXPIRED', updated_at = clock_timestamp() WHERE provider_session_id = $1 AND status = 'CREATED'`,
        [event.sessionId],
      );
      const live = await db.query(`SELECT 1 FROM payments WHERE order_id = $1 AND status IN ('CREATED','PAID') LIMIT 1`, [event.orderId]);
      return live.rowCount === 0; // another open/paid session keeps the order alive
    });
    if (mayCancel) await deps.orders.expire(event.orderId);
    return 'handled';
  }

  // type === 'paid'
  const decision = await withOrderLock(deps.pool, event.orderId, async (db) => {
    const rows = (await db.query<PaymentRow>('SELECT * FROM payments WHERE order_id = $1', [event.orderId])).rows;
    const mine = rows.find((r) => r.provider_session_id === event.sessionId);
    if (!mine) return { action: 'unknown' as const };
    if (mine.status === 'REFUNDED') return { action: 'done' as const };
    if (mine.status !== 'PAID') {
      await db.query(
        `UPDATE payments SET status = 'PAID', payment_intent_id = COALESCE($2, payment_intent_id), updated_at = clock_timestamp() WHERE id = $1`,
        [mine.id, event.paymentIntentId],
      );
    }
    // If the customer somehow paid two sessions for one order, the earliest payment wins and the rest are refunded.
    const paid = (await db.query<PaymentRow>(`SELECT * FROM payments WHERE order_id = $1 AND status = 'PAID' ORDER BY updated_at, id`, [event.orderId])).rows;
    // `mine` was read before the UPDATE above, so carry the freshly recorded payment intent forward.
    const payment = { ...mine, payment_intent_id: event.paymentIntentId ?? mine.payment_intent_id };
    return { action: paid[0].id !== mine.id ? ('refund' as const) : ('confirm' as const), payment };
  });

  if (decision.action === 'unknown') {
    console.warn(JSON.stringify({ level: 'warn', msg: 'webhook for unknown session', sessionId: event.sessionId }));
    return 'ignored';
  }
  if (decision.action === 'done') return 'handled';

  let refund = decision.action === 'refund';
  if (decision.action === 'confirm') {
    // Tell orders. If it was cancelled in the meantime, the money must go back.
    refund = (await deps.orders.markPaid(event.orderId)) === 'cancelled';
  }
  if (refund) {
    const pi = decision.payment.payment_intent_id;
    if (!pi) throw new Error(`Cannot refund payment ${decision.payment.id}: no payment_intent recorded`);
    await deps.provider.refund(pi, `refund-${decision.payment.id}`);
    await deps.pool.query(`UPDATE payments SET status = 'REFUNDED', updated_at = clock_timestamp() WHERE id = $1`, [decision.payment.id]);
    return 'refunded';
  }
  return 'handled';
}
