import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { config } from '../config';
import { authenticate, requireInternalKey, requireRole } from '../lib/auth';
import { asyncHandler, HttpError, validate } from '../lib/http';

const productInput = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  priceCents: z.number().int().min(0).max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000).default(0),
});
const productUpdate = productInput.partial().refine((v) => Object.keys(v).length > 0, 'No fields to update');

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});
const idParams = z.object({ id: z.string().uuid() });

const lineItems = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10_000) }))
    .min(1)
    .max(50),
});

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string;
  price_cents: number;
  stock: number;
  created_at: Date;
}
const toDto = (p: ProductRow) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  description: p.description,
  priceCents: p.price_cents,
  stock: p.stock,
  createdAt: p.created_at,
});

export function inventoryRouter(pool: Pool) {
  const r = Router();
  const auth = authenticate(config.jwtSecret);

  // ---- Internal endpoints (service-to-service, guarded by shared key) ----
  /**
   * Atomically reserve stock for every line or none. Rows are locked in a stable (id) order
   * with SELECT ... FOR UPDATE so concurrent reservations cannot deadlock or oversell.
   */
  r.post(
    '/internal/reserve',
    requireInternalKey(config.internalKey),
    validate(lineItems),
    asyncHandler(async (req, res) => {
      const { items } = req.body as z.infer<typeof lineItems>;
      const merged = new Map<string, number>();
      for (const i of items) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.quantity);
      const ids = [...merged.keys()].sort();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<ProductRow>(
          'SELECT * FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [ids],
        );
        const byId = new Map(rows.map((p) => [p.id, p]));
        const problems: { productId: string; reason: string }[] = [];
        for (const id of ids) {
          const p = byId.get(id);
          if (!p) problems.push({ productId: id, reason: 'not_found' });
          else if (p.stock < merged.get(id)!) problems.push({ productId: id, reason: 'insufficient_stock' });
        }
        if (problems.length) {
          await client.query('ROLLBACK');
          throw new HttpError(409, 'Cannot reserve stock', problems);
        }
        for (const id of ids) {
          await client.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1', [id, merged.get(id)]);
        }
        await client.query('COMMIT');
        res.json({
          items: ids.map((id) => {
            const p = byId.get(id)!;
            return { productId: id, sku: p.sku, name: p.name, unitPriceCents: p.price_cents, quantity: merged.get(id)! };
          }),
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  r.post(
    '/internal/release',
    requireInternalKey(config.internalKey),
    validate(lineItems),
    asyncHandler(async (req, res) => {
      const { items } = req.body as z.infer<typeof lineItems>;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const i of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
          await client.query('UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1', [i.productId, i.quantity]);
        }
        await client.query('COMMIT');
        res.status(204).end();
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  // ---- Public API (JWT) ----
  r.get(
    '/products',
    auth,
    validate(listQuery, 'query'),
    asyncHandler(async (req, res) => {
      const { search, page, pageSize } = req.query as unknown as z.infer<typeof listQuery>;
      const like = search ? `%${search.toLowerCase().replace(/[%_\\]/g, '\\$&')}%` : null;
      const where = like ? `WHERE lower(name) LIKE $1 OR lower(sku) LIKE $1` : '';
      const params: unknown[] = like ? [like] : [];
      const total = (await pool.query<{ count: string }>(`SELECT count(*) FROM products ${where}`, params)).rows[0].count;
      const { rows } = await pool.query<ProductRow>(
        `SELECT * FROM products ${where} ORDER BY created_at DESC, id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params,
      );
      res.json({ items: rows.map(toDto), page, pageSize, total: Number(total) });
    }),
  );

  r.get(
    '/products/:id',
    auth,
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query<ProductRow>('SELECT * FROM products WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Product not found');
      res.json(toDto(rows[0]));
    }),
  );

  r.post(
    '/products',
    auth,
    requireRole('admin'),
    validate(productInput),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof productInput>;
      try {
        const { rows } = await pool.query<ProductRow>(
          'INSERT INTO products (sku, name, description, price_cents, stock) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [b.sku, b.name, b.description, b.priceCents, b.stock],
        );
        res.status(201).json(toDto(rows[0]));
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'SKU already exists');
        throw err;
      }
    }),
  );

  r.patch(
    '/products/:id',
    auth,
    requireRole('admin'),
    validate(idParams, 'params'),
    validate(productUpdate),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof productUpdate>;
      const cols: Record<string, string> = { sku: 'sku', name: 'name', description: 'description', priceCents: 'price_cents', stock: 'stock' };
      const sets: string[] = [];
      const vals: unknown[] = [req.params.id];
      for (const [k, v] of Object.entries(b)) {
        vals.push(v);
        sets.push(`${cols[k]} = $${vals.length}`);
      }
      try {
        const { rows } = await pool.query<ProductRow>(
          `UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
          vals,
        );
        if (!rows[0]) throw new HttpError(404, 'Product not found');
        res.json(toDto(rows[0]));
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'SKU already exists');
        throw err;
      }
    }),
  );

  r.delete(
    '/products/:id',
    auth,
    requireRole('admin'),
    validate(idParams, 'params'),
    asyncHandler(async (req, res) => {
      const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
      if (!rowCount) throw new HttpError(404, 'Product not found');
      res.status(204).end();
    }),
  );

  return r;
}
