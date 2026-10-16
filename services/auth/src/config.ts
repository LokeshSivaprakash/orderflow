export const config = {
  port: Number(process.env.PORT ?? 4001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://orderflow:orderflow@localhost:5432/orderflow_auth',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};

if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
