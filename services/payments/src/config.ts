export const config = {
  port: Number(process.env.PORT ?? 4004),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://orderflow:orderflow@localhost:5432/orderflow_payments',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  internalKey: process.env.INTERNAL_API_KEY ?? 'dev-internal-key',
  ordersUrl: process.env.ORDERS_URL ?? 'http://localhost:4003',
  /** Browser-facing origin of the web app/gateway; used for Stripe redirect URLs. */
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  /** Stripe requires at least 30 minutes; the stock reservation is held for this long. */
  checkoutTtlMinutes: 31,
};

if (process.env.NODE_ENV === 'production' && (config.jwtSecret.startsWith('dev-') || config.internalKey.startsWith('dev-'))) {
  throw new Error('JWT_SECRET and INTERNAL_API_KEY must be set in production');
}

if (process.env.NODE_ENV !== 'test') {
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
    throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required (use Stripe TEST mode keys; see README)');
  }
  // Portfolio project: refuse live keys so a pasted production key can never charge real cards.
  if (!config.stripeSecretKey.startsWith('sk_test_')) throw new Error('Only Stripe TEST keys (sk_test_...) are accepted by this project');
}
