import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from './http';

export type Role = 'admin' | 'staff';
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const authenticate =
  (secret: string): RequestHandler =>
  (req, _res, next) => {
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Missing bearer token'));
    try {
      const p = jwt.verify(token, secret) as jwt.JwtPayload;
      req.user = { id: String(p.sub), email: String(p.email), role: p.role as Role };
      next();
    } catch {
      next(new HttpError(401, 'Invalid or expired token'));
    }
  };

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Unauthenticated'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Forbidden'));
    next();
  };

export const requireInternalKey =
  (key: string): RequestHandler =>
  (req: Request, _res, next) => {
    if (req.header('x-internal-key') !== key) return next(new HttpError(403, 'Forbidden'));
    next();
  };
