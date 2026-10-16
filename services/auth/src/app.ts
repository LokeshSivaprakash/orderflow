import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { config } from './config';
import { errorHandler, notFound, requestLogger } from './lib/http';
import { authRouter } from './routes/auth';

export function createApp(pool: Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'auth' });
  });

  const limiter = rateLimit({ windowMs: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true });
  app.use('/auth', limiter, authRouter(pool));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
