import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Validate and replace req[source] with the parsed (typed, coerced) value. */
export const validate =
  <T extends ZodTypeAny>(schema: T, source: 'body' | 'query' | 'params' = 'body'): RequestHandler =>
  (req, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(new HttpError(400, 'Validation failed', parsed.error.flatten().fieldErrors));
    }
    (req as unknown as Record<string, z.infer<T>>)[source] = parsed.data;
    next();
  };

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'Not found'));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten().fieldErrors });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  console.error(JSON.stringify({ level: 'error', msg: (err as Error)?.message, path: req.path }));
  return res.status(500).json({ error: 'Internal server error' });
}

/** Structured one-line JSON access log. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      JSON.stringify({ level: 'info', method: req.method, path: req.originalUrl, status: res.statusCode, ms: +ms.toFixed(1) }),
    );
  });
  next();
};
