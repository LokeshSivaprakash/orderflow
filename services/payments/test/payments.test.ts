import jwt from 'jsonwebtoken';
import path from 'node:path';
import request from 'supertest';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { createPool } from '../src/lib/db';
import { runMigrations } from '../src/lib/migrate';
import { HttpError } from '../src/lib/http';
import type { OrderSummary, OrdersClient } from '../src/ordersClient';
import type { PaymentProvider } from '../src/provider';
import { stripeProvider } from '../src/stripeProvider';

const pool = createPool(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orderflow_payments_test');

const ALICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOB = 'bbbbbbbb-0000-4000-8000-000000000002';
const O1 = '10000000-0000-4000-8000-000000000001';
const WEBHOOK_SECRET = 'whsec_test_secret';

const tok = (id: string) => `Bearer ${jwt.sign({ email: `${id}@x.com`, role: 'staff' }, config.jwtSecret, { subject: id })}`;

// ---- test doubles ----
const orders = new Map<string, OrderSummary>();
const calls = { markPaid: [] as string[], expire: [] as string[] };
let markPaidResult: 'ok' | 'cancelled' = 'ok';
let ordersDown = false;
const fakeOrders: OrdersClient = {
  async getOrder(id) {
    return orders.get(id) ?? null;
  },
  async markPaid(id) {
    if (ordersDown) throw new HttpError(503, 'Orders service unavailable');
    calls.markPaid.push(id);
    return markPaidResult;
  },
  async expire(id) {
    if (ordersDown) throw new HttpError(503, 'Orders service unavailable');
    calls.expire.push(id);
  },
};

const real = stripeProvider('sk_test_dummy', WEBHOOK_SECRET); // used only for webhook signature verification
let sessionSeq = 0;
const refunds: { pi: string; key: string }[] = [];
const provider: PaymentProvider = {
  name: 'stripe',
  async createCheckoutSession() {
    sessionSeq += 1;
    return { id: `cs_test_${sessionSeq}`, url: `https://checkout.stripe.com/c/pay/cs_test_${sessionSeq}` };
  },
  parseWebhook: (body, sig) => real.parseWebhook(body, sig),
  async refund(pi, key) {
    refunds.push({ pi, key });
  },
};
const app = createApp(pool, fakeOrders, provider);

const stripe = new Stripe('sk_test_dummy');
function signedEvent(type: string, session: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object: { object: 'checkout.session', ...session } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}
const sendWebhook = (type: string, session: Record<string, unknown>) => {
  const { payload, header } = signedEvent(type, session);
  return request(app).post('/payments/webhook').set('content-type', 'application/json').set('stripe-signature', header).send(payload);
};
const paidSession = (id: string, pi = 'pi_1') => ({ id, payment_status: 'paid', payment_intent: pi, metadata: { orderId: O1 } });
const statusOf = async (sessionId: string) => (await pool.query('SELECT status FROM payments WHERE provider_session_id=$1', [sessionId])).rows[0]?.status;

beforeAll(() => runMigrations(pool, path.join(__dirname, '..', 'migrations')));
beforeEach(async () => {
  await pool.query('TRUNCATE payments');
  orders.clear();
  orders.set(O1, { id: O1, userId: ALICE, status: 'PENDING_PAYMENT', totalCents: 12997, items: [{ name: 'Keyboard', unitPriceCents: 4999, quantity: 2 }, { name: 'Mouse', unitPriceCents: 2999, quantity: 1 }] });
  calls.markPaid = [];
  calls.expire = [];
  refunds.length = 0;
  markPaidResult = 'ok';
  ordersDown = false;
  sessionSeq = 0;
});
afterAll(() => pool.end());

const checkout = (user = ALICE, orderId = O1) => request(app).post('/payments/checkout').set('Authorization', tok(user)).send({ orderId });

describe('POST /payments/checkout', () => {
  it('requires authentication and a valid body', async () => {
    expect((await request(app).post('/payments/checkout').send({ orderId: O1 })).status).toBe(401);
    expect((await request(app).post('/payments/checkout').set('Authorization', tok(ALICE)).send({ orderId: 'nope' })).status).toBe(400);
  });

  it('creates a hosted checkout session and records the payment', async () => {
    const res = await checkout();
    expect(res.status).toBe(201);
    expect(res.body.url).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    const { rows } = await pool.query('SELECT status, amount_cents FROM payments');
    expect(rows).toEqual([{ status: 'CREATED', amount_cents: '12997' }]);
  });

  it('reuses the open session instead of creating a second one (double-click safe)', async () => {
    const a = await checkout();
    const b = await checkout();
    expect(b.status).toBe(200);
    expect(b.body.url).toBe(a.body.url);
    expect(sessionSeq).toBe(1);
  });

  it('returns 502 (and records nothing) when the payment provider fails', async () => {
    const failing: PaymentProvider = { ...provider, createCheckoutSession: async () => { throw new Error('boom'); } };
    const res = await request(createApp(pool, fakeOrders, failing)).post('/payments/checkout').set('Authorization', tok(ALICE)).send({ orderId: O1 });
    expect(res.status).toBe(502);
    expect((await pool.query('SELECT count(*) FROM payments')).rows[0].count).toBe('0');
  });

  it('does not reveal or allow paying for someone else\'s order', async () => {
    expect((await checkout(BOB)).status).toBe(404);
  });

  it('refuses orders that are not awaiting payment', async () => {
    orders.set(O1, { ...orders.get(O1)!, status: 'PAID' });
    expect((await checkout()).status).toBe(409);
    orders.set(O1, { ...orders.get(O1)!, status: 'CANCELLED' });
    expect((await checkout()).status).toBe(409);
  });
});

describe('POST /payments/webhook', () => {
  it('rejects unsigned, badly signed and tampered requests', async () => {
    const { payload, header } = signedEvent('checkout.session.completed', paidSession('cs_test_1'));
    expect((await request(app).post('/payments/webhook').set('content-type', 'application/json').send(payload)).status).toBe(400);
    expect((await request(app).post('/payments/webhook').set('content-type', 'application/json').set('stripe-signature', 't=1,v1=deadbeef').send(payload)).status).toBe(400);
    expect((await request(app).post('/payments/webhook').set('content-type', 'application/json').set('stripe-signature', header).send(payload.replace('pi_1', 'pi_evil'))).status).toBe(400);
    expect(calls.markPaid).toHaveLength(0);
  });

  it('marks the payment and order paid on checkout.session.completed', async () => {
    await checkout();
    const res = await sendWebhook('checkout.session.completed', paidSession('cs_test_1'));
    expect(res.status).toBe(200);
    expect(await statusOf('cs_test_1')).toBe('PAID');
    expect(calls.markPaid).toEqual([O1]);
    expect((await pool.query('SELECT payment_intent_id FROM payments')).rows[0].payment_intent_id).toBe('pi_1');
  });

  it('is idempotent when Stripe redelivers the same event', async () => {
    await checkout();
    await sendWebhook('checkout.session.completed', paidSession('cs_test_1'));
    const again = await sendWebhook('checkout.session.completed', paidSession('cs_test_1'));
    expect(again.status).toBe(200);
    expect(await statusOf('cs_test_1')).toBe('PAID');
    expect(refunds).toHaveLength(0);
  });

  it('survives the orders service being down: returns 5xx so Stripe retries, and the retry completes', async () => {
    await checkout();
    ordersDown = true;
    const failed = await sendWebhook('checkout.session.completed', paidSession('cs_test_1'));
    expect(failed.status).toBeGreaterThanOrEqual(500);
    ordersDown = false;
    const retry = await sendWebhook('checkout.session.completed', paidSession('cs_test_1'));
    expect(retry.status).toBe(200);
    expect(calls.markPaid).toEqual([O1]);
  });

  it('refunds when the order was cancelled before the payment completed', async () => {
    await checkout();
    markPaidResult = 'cancelled';
    const res = await sendWebhook('checkout.session.completed', paidSession('cs_test_1', 'pi_late'));
    expect(res.body.outcome).toBe('refunded');
    expect(refunds).toHaveLength(1);
    expect(refunds[0].pi).toBe('pi_late');
    expect(await statusOf('cs_test_1')).toBe('REFUNDED');
  });

  it('refunds the second payment if the customer paid two sessions for one order', async () => {
    await checkout();
    await pool.query(`UPDATE payments SET created_at = now() - interval '40 minutes'`); // force a second session
    await checkout();
    await sendWebhook('checkout.session.completed', paidSession('cs_test_1', 'pi_first'));
    const second = await sendWebhook('checkout.session.completed', paidSession('cs_test_2', 'pi_second'));
    expect(second.body.outcome).toBe('refunded');
    expect(refunds.map((r) => r.pi)).toEqual(['pi_second']);
    expect(await statusOf('cs_test_1')).toBe('PAID');
    expect(await statusOf('cs_test_2')).toBe('REFUNDED');
  });

  it('expires the order (releasing stock) when the checkout session expires unpaid', async () => {
    await checkout();
    const res = await sendWebhook('checkout.session.expired', { id: 'cs_test_1', metadata: { orderId: O1 } });
    expect(res.status).toBe(200);
    expect(await statusOf('cs_test_1')).toBe('EXPIRED');
    expect(calls.expire).toEqual([O1]);
  });

  it('does not expire the order while another session for it is still open', async () => {
    await checkout();
    await pool.query(`UPDATE payments SET created_at = now() - interval '40 minutes'`);
    await checkout();
    await sendWebhook('checkout.session.expired', { id: 'cs_test_1', metadata: { orderId: O1 } });
    expect(calls.expire).toHaveLength(0);
  });

  it('ignores unpaid (delayed-method) completions, unknown sessions and unrelated events', async () => {
    await checkout();
    expect((await sendWebhook('checkout.session.completed', { ...paidSession('cs_test_1'), payment_status: 'unpaid' })).body.outcome).toBe('ignored');
    expect((await sendWebhook('checkout.session.completed', paidSession('cs_unknown'))).body.outcome).toBe('ignored');
    expect((await sendWebhook('customer.created', { id: 'cus_1' })).body.outcome).toBe('ignored');
    expect(calls.markPaid).toHaveLength(0);
    expect(await statusOf('cs_test_1')).toBe('CREATED');
  });
});
