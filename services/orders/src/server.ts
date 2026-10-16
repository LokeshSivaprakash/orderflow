import path from 'node:path';
import { createApp } from './app';
import { httpInventoryClient } from './inventoryClient';
import { config } from './config';
import { createPool } from './lib/db';
import { runMigrations } from './lib/migrate';

async function main() {
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool, path.join(__dirname, '..', 'migrations'));
  const server = createApp(pool, httpInventoryClient(config.inventoryUrl, config.internalKey)).listen(config.port, () => console.log(`orders-service listening on :${config.port}`));
  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
