import request from 'supertest';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createPool } from '../src/lib/db';
import { runMigrations } from '../src/lib/migrate';

const pool = createPool(process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orderflow_auth_test');
const app = createApp(pool);

beforeAll(async () => {
  await runMigrations(pool, path.join(__dirname, '..', 'migrations'));
});
beforeEach(async () => {
  await pool.query('TRUNCATE users');
});
afterAll(() => pool.end());

const creds = { email: 'Ada@Example.com', name: 'Ada', password: 'correct horse battery' };

describe('auth service', () => {
  it('registers a user, normalises email and returns a token', async () => {
    const res = await request(app).post('/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', role: 'staff' });
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.token).toBeTypeOf('string');
  });

  it('rejects duplicate emails with 409', async () => {
    await request(app).post('/auth/register').send(creds);
    const res = await request(app).post('/auth/register').send(creds);
    expect(res.status).toBe(409);
  });

  it('validates input', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'nope', name: '', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty('email');
    expect(res.body.details).toHaveProperty('password');
  });

  it('logs in with valid credentials and rejects invalid ones', async () => {
    await request(app).post('/auth/register').send(creds);
    const ok = await request(app).post('/auth/login').send({ email: creds.email, password: creds.password });
    expect(ok.status).toBe(200);
    const bad = await request(app).post('/auth/login').send({ email: creds.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const unknown = await request(app).post('/auth/login').send({ email: 'x@y.com', password: 'whatever' });
    expect(unknown.status).toBe(401);
  });

  it('GET /auth/me requires a valid token', async () => {
    const reg = await request(app).post('/auth/register').send(creds);
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${reg.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('ada@example.com');
    expect((await request(app).get('/auth/me')).status).toBe(401);
    expect((await request(app).get('/auth/me').set('Authorization', 'Bearer junk')).status).toBe(401);
  });
});
