import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { config } from './config';
import { errorHandler, notFound, requestLogger } from './lib/http';
import { inventoryRouter } from './routes/inventory';

export function createApp(pool: Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'inventory' });
  });

  app.use('/inventory', inventoryRouter(pool));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
