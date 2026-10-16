import jwt from 'jsonwebtoken';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { createPool } from '../src/lib/db';
import { runMigrations } from '../src/lib/migrate';

const pool = createPool(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orderflow_inventory_test');
const app = createApp(pool);
const token = (role: 'admin' | 'staff') => jwt.sign({ email: `${role}@x.com`, role }, config.jwtSecret, { subject: '11111111-1111-1111-1111-111111111111' });
const admin = `Bearer ${token('admin')}`;
const staff = `Bearer ${token('staff')}`;
const internal = { 'x-internal-key': config.internalKey };

async function seed(sku: string, stock: number, price = 1000) {
  const res = await request(app).post('/inventory/products').set('Authorization', admin).send({ sku, name: `Product ${sku}`, priceCents: price, stock });
  return res.body as { id: string };
}

beforeAll(() => runMigrations(pool, path.join(__dirname, '..', 'migrations')));
beforeEach(() => pool.query('TRUNCATE products'));
afterAll(() => pool.end());

describe('product API', () => {
  it('requires authentication and admin role for writes', async () => {
    expect((await request(app).get('/inventory/products')).status).toBe(401);
    const res = await request(app).post('/inventory/products').set('Authorization', staff).send({ sku: 'A', name: 'A', priceCents: 1 });
    expect(res.status).toBe(403);
  });

  it('creates, lists with search + pagination, updates and deletes', async () => {
    const p = await seed('KB-1', 5);
    await seed('MS-1', 7);
    expect((await request(app).post('/inventory/products').set('Authorization', admin).send({ sku: 'KB-1', name: 'dup', priceCents: 1 })).status).toBe(409);

    const list = await request(app).get('/inventory/products?search=kb&pageSize=1').set('Authorization', staff);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(list.body.items[0].sku).toBe('KB-1');

    const upd = await request(app).patch(`/inventory/products/${p.id}`).set('Authorization', admin).send({ priceCents: 2500 });
    expect(upd.body.priceCents).toBe(2500);

    expect((await request(app).delete(`/inventory/products/${p.id}`).set('Authorization', admin)).status).toBe(204);
    expect((await request(app).get(`/inventory/products/${p.id}`).set('Authorization', staff)).status).toBe(404);
  });

  it('rejects invalid payloads', async () => {
    const res = await request(app).post('/inventory/products').set('Authorization', admin).send({ sku: '', name: 'x', priceCents: -5 });
    expect(res.status).toBe(400);
  });
});

describe('stock reservation (internal)', () => {
  it('is protected by the internal key', async () => {
    const res = await request(app).post('/inventory/internal/reserve').send({ items: [] });
    expect(res.status).toBe(403);
  });

  it('reserves stock and returns priced lines', async () => {
    const p = await seed('R-1', 10, 500);
    const res = await request(app).post('/inventory/internal/reserve').set(internal).send({ items: [{ productId: p.id, quantity: 3 }, { productId: p.id, quantity: 2 }] });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ productId: p.id, sku: 'R-1', name: 'Product R-1', unitPriceCents: 500, quantity: 5 }]);
    const { rows } = await pool.query('SELECT stock FROM products WHERE id=$1', [p.id]);
    expect(rows[0].stock).toBe(5);
  });

  it('is all-or-nothing when any line lacks stock', async () => {
    const a = await seed('A', 10);
    const b = await seed('B', 1);
    const res = await request(app).post('/inventory/internal/reserve').set(internal).send({ items: [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 5 }] });
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual([{ productId: b.id, reason: 'insufficient_stock' }]);
    const { rows } = await pool.query('SELECT sku, stock FROM products ORDER BY sku');
    expect(rows.map((r) => r.stock)).toEqual([10, 1]);
  });

  it('never oversells under concurrent reservations', async () => {
    const p = await seed('HOT', 10);
    const attempts = await Promise.all(
      Array.from({ length: 25 }, () => request(app).post('/inventory/internal/reserve').set(internal).send({ items: [{ productId: p.id, quantity: 1 }] })),
    );
    expect(attempts.filter((r) => r.status === 200)).toHaveLength(10);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(15);
    const { rows } = await pool.query('SELECT stock FROM products WHERE id=$1', [p.id]);
    expect(rows[0].stock).toBe(0);
  });

  it('release returns stock', async () => {
    const p = await seed('REL', 4);
    await request(app).post('/inventory/internal/reserve').set(internal).send({ items: [{ productId: p.id, quantity: 4 }] });
    const res = await request(app).post('/inventory/internal/release').set(internal).send({ items: [{ productId: p.id, quantity: 4 }] });
    expect(res.status).toBe(204);
    expect((await pool.query('SELECT stock FROM products WHERE id=$1', [p.id])).rows[0].stock).toBe(4);
  });
});
