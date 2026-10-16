export const config = {
  port: Number(process.env.PORT ?? 4003),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://orderflow:orderflow@localhost:5432/orderflow_orders',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
  inventoryUrl: process.env.INVENTORY_URL ?? 'http://localhost:4002',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};

if (process.env.NODE_ENV === 'production' && (config.jwtSecret.startsWith('dev-') || config.internalKey.startsWith('dev-'))) {
  throw new Error('JWT_SECRET and INTERNAL_API_KEY must be set in production');
}
