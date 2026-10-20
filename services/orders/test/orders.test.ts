import jwt from 'jsonwebtoken';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { HttpError } from '../src/lib/http';
import type { InventoryClient, LineRequest, ReservedLine } from '../src/inventoryClient';
import { createPool } from '../src/lib/db';
import { runMigrations } from '../src/lib/migrate';

const pool = createPool(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orderflow_orders_test');

const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const catalog: Record<string, { sku: string; name: string; price: number; stock: number }> = {};
let released: LineRequest[][] = [];

const fakeInventory: InventoryClient = {
  async reserve(items) {
    const problems = items.filter((i) => !catalog[i.productId] || catalog[i.productId].stock < i.quantity);
    if (problems.length) throw new HttpError(409, 'Some items are unavailable', problems);
    return items.map<ReservedLine>((i) => {
      catalog[i.productId].stock -= i.quantity;
      const c = catalog[i.productId];
      return { productId: i.productId, quantity: i.quantity, sku: c.sku, name: c.name, unitPriceCents: c.price };
    });
  },
  async release(items) {
    released.push(items);
    for (const i of items) catalog[i.productId].stock += i.quantity;
  },
};

const app = createApp(pool, fakeInventory);
const tok = (id: string, role: 'admin' | 'staff' = 'staff') => `Bearer ${jwt.sign({ email: `${id}@x.com`, role }, config.jwtSecret, { subject: id })}`;
const alice = tok('aaaaaaaa-0000-4000-8000-000000000001');
const bob = tok('bbbbbbbb-0000-4000-8000-000000000002');
const admin = tok('cccccccc-0000-4000-8000-000000000003', 'admin');
const internal = { 'x-internal-key': config.internalKey };

beforeAll(() => runMigrations(pool, path.join(__dirname, '..', 'migrations')));
beforeEach(async () => {
  await pool.query('TRUNCATE orders CASCADE');
  released = [];
  catalog[P1] = { sku: 'KB-1', name: 'Keyboard', price: 4999, stock: 10 };
  catalog[P2] = { sku: 'MS-1', name: 'Mouse', price: 1999, stock: 2 };
});
afterAll(() => pool.end());

describe('orders API', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/orders')).status).toBe(401);
  });

  it('creates an order, computes the total server-side and decrements stock', async () => {
    const res = await request(app).post('/orders').set('Authorization', alice).send({ items: [{ productId: P1, quantity: 2 }, { productId: P2, quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(2 * 4999 + 1999);
    expect(res.body.status).toBe('PENDING_PAYMENT');
    expect(res.body.items).toHaveLength(2);
    expect(catalog[P1].stock).toBe(8);
  });

  it('returns 409 and creates nothing when stock is insufficient', async () => {
    const res = await request(app).post('/orders').set('Authorization', alice).send({ items: [{ productId: P2, quantity: 5 }] });
    expect(res.status).toBe(409);
    expect((await pool.query('SELECT count(*) FROM orders')).rows[0].count).toBe('0');
  });

  it('validates payloads', async () => {
    const res = await request(app).post('/orders').set('Authorization', alice).send({ items: [{ productId: 'nope', quantity: 0 }] });
    expect(res.status).toBe(400);
  });

  it('compensates (releases stock) if persisting the order fails', async () => {
    await pool.query('ALTER TABLE orders ADD CONSTRAINT force_fail CHECK (total_cents < 0)');
    try {
      const res = await request(app).post('/orders').set('Authorization', alice).send({ items: [{ productId: P1, quantity: 3 }] });
      expect(res.status).toBe(500);
      expect(released).toHaveLength(1);
      expect(catalog[P1].stock).toBe(10);
    } finally {
      await pool.query('ALTER TABLE orders DROP CONSTRAINT force_fail');
    }
  });

  it('scopes order visibility: users see only their own, admins see all', async () => {
    const mine = await request(app).post('/orders').set('Authorization', alice).send({ items: [{ productId: P1, quantity: 1 }] });
    await request(app).post('/orders').set('Authorization', bob).send({ items: [{ productId: P1, quantity: 1 }] });

    expect((await request(app).get('/orders').set('Authorization', alice)).body.total).toBe(1);
    expect((await request(app).get('/orders').set('Authorization', admin)).body.total).toBe(2);
    expect((await request(app).get(`/orders/${mine.body.id}`).set('Authorization', bob)).status).toBe(404);
    expect((await request(app).get(`/orders/${mine.body.id}`).set('Authorization', admin)).status).toBe(200);
  });

  it('cancels an unpaid order once, restoring stock', async () => {
    const o = await request(app).post('/orders').set('Authorization', alice).send({ items: [{ productId: P1, quantity: 4 }] });
    expect(catalog[P1].stock).toBe(6);
    const c1 = await request(app).post(`/orders/${o.body.id}/cancel`).set('Authorization', alice);
    expect(c1.status).toBe(200);
    expect(c1.body.status).toBe('CANCELLED');
    expect(catalog[P1].stock).toBe(10);
    const c2 = await request(app).post(`/orders/${o.body.id}/cancel`).set('Authorization', alice);
    expect(c2.status).toBe(409);
    expect(catalog[P1].stock).toBe(10);
  });

  it('filters by status and paginates', async () => {
    for (let i = 0; i < 3; i++) await request(app).post('/orders').set('Authorization', alice).send({ items: [{ productId: P1, quantity: 1 }] });
    const first = await request(app).get('/orders?pageSize=2').set('Authorization', alice);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.total).toBe(3);
    await request(app).post(`/orders/${first.body.items[0].id}/cancel`).set('Authorization', alice);
    const cancelled = await request(app).get('/orders?status=CANCELLED').set('Authorization', alice);
    expect(cancelled.body.total).toBe(1);
  });
});

describe('payment lifecycle (internal API used by the payment service)', () => {
  async function placeOrder(quantity = 2) {
    const res = await request(app).post('/orders').set('Authorization', alice).send({ items: [{ productId: P1, quantity }] });
    return res.body.id as string;
  }

  it('is protected by the internal key', async () => {
    const id = await placeOrder();
    expect((await request(app).get(`/orders/internal/${id}`)).status).toBe(403);
    expect((await request(app).post(`/orders/internal/${id}/paid`)).status).toBe(403);
  });

  it('exposes order details to the payment service', async () => {
    const id = await placeOrder();
    const res = await request(app).get(`/orders/internal/${id}`).set(internal);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'PENDING_PAYMENT', userId: 'aaaaaaaa-0000-4000-8000-000000000001', totalCents: 2 * 4999 });
  });

  it('marks an order paid idempotently and sets paid_at', async () => {
    const id = await placeOrder();
    const a = await request(app).post(`/orders/internal/${id}/paid`).set(internal);
    const b = await request(app).post(`/orders/internal/${id}/paid`).set(internal); // webhook retry
    expect(a.body.status).toBe('PAID');
    expect(b.status).toBe(200);
    expect(b.body.status).toBe('PAID');
    expect((await request(app).get(`/orders/${id}`).set('Authorization', alice)).body.paidAt).toBeTruthy();
  });

  it('refuses to mark a cancelled order as paid (payment service must refund)', async () => {
    const id = await placeOrder();
    await request(app).post(`/orders/${id}/cancel`).set('Authorization', alice);
    const res = await request(app).post(`/orders/internal/${id}/paid`).set(internal);
    expect(res.status).toBe(409);
  });

  it('paid orders cannot be cancelled by the user and keep their stock deducted', async () => {
    const id = await placeOrder(3);
    await request(app).post(`/orders/internal/${id}/paid`).set(internal);
    const res = await request(app).post(`/orders/${id}/cancel`).set('Authorization', alice);
    expect(res.status).toBe(409);
    expect(catalog[P1].stock).toBe(7);
  });

  it('expire cancels an unpaid order and releases stock exactly once', async () => {
    const id = await placeOrder(4);
    expect(catalog[P1].stock).toBe(6);
    const first = await request(app).post(`/orders/internal/${id}/expire`).set(internal);
    const second = await request(app).post(`/orders/internal/${id}/expire`).set(internal);
    expect(first.body.status).toBe('CANCELLED');
    expect(second.status).toBe(200);
    expect(catalog[P1].stock).toBe(10);
    expect(released).toHaveLength(1);
  });

  it('expire does not touch an order that was already paid', async () => {
    const id = await placeOrder();
    await request(app).post(`/orders/internal/${id}/paid`).set(internal);
    const res = await request(app).post(`/orders/internal/${id}/expire`).set(internal);
    expect(res.body.status).toBe('PAID');
    expect(released).toHaveLength(0);
  });
});
