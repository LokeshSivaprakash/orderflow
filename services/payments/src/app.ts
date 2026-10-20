import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { config } from './config';
import { errorHandler, notFound, requestLogger } from './lib/http';
import type { OrdersClient } from './ordersClient';
import type { Deps } from './paymentService';
import type { PaymentProvider } from './provider';
import { paymentsRouter } from './routes/payments';

export function createApp(pool: Pool, orders: OrdersClient, provider: PaymentProvider) {
  const deps: Deps = { pool, orders, provider, publicUrl: config.publicUrl };
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(requestLogger);

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'payments', provider: provider.name });
  });

  // NOTE: no global express.json() - the webhook route needs the raw body.
  app.use('/payments', paymentsRouter(deps));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
