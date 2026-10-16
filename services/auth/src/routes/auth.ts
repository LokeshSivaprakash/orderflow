import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { z } from 'zod';
import { config } from '../config';
import { authenticate } from '../lib/auth';
import { asyncHandler, HttpError, validate } from '../lib/http';

const registerSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase()),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(128),
});
const loginSchema = z.object({ email: z.string().email().transform((v) => v.toLowerCase()), password: z.string().min(1) });

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff';
  password_hash: string;
}

const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, role: u.role });
const signToken = (u: UserRow) =>
  jwt.sign({ email: u.email, role: u.role }, config.jwtSecret, {
    subject: u.id,
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });

export function authRouter(pool: Pool) {
  const r = Router();

  r.post(
    '/register',
    validate(registerSchema),
    asyncHandler(async (req, res) => {
      const { email, name, password } = req.body as z.infer<typeof registerSchema>;
      const hash = await bcrypt.hash(password, 10);
      try {
        const { rows } = await pool.query<UserRow>(
          `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *`,
          [email, name, hash],
        );
        res.status(201).json({ user: publicUser(rows[0]), token: signToken(rows[0]) });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'Email already registered');
        throw err;
      }
    }),
  );

  r.post(
    '/login',
    validate(loginSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as z.infer<typeof loginSchema>;
      const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0];
      // Compare even when the user is missing to keep timing roughly uniform.
      const ok = await bcrypt.compare(password, user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidu');
      if (!user || !ok) throw new HttpError(401, 'Invalid email or password');
      res.json({ user: publicUser(user), token: signToken(user) });
    }),
  );

  r.get(
    '/me',
    authenticate(config.jwtSecret),
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
      if (!rows[0]) throw new HttpError(404, 'User not found');
      res.json({ user: publicUser(rows[0]) });
    }),
  );

  return r;
}
