import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { config } from './config';
import type { InventoryClient } from './inventoryClient';
import { errorHandler, notFound, requestLogger } from './lib/http';
import { internalRouter } from './routes/internal';
import { ordersRouter } from './routes/orders';

export function createApp(pool: Pool, inventory: InventoryClient) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'orders' });
  });

  app.use('/orders/internal', internalRouter(pool, inventory)); // before /orders so JWT auth does not apply
  app.use('/orders', ordersRouter(pool, inventory));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
