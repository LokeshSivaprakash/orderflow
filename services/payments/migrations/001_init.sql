CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL,
  user_id            UUID NOT NULL,
  provider           TEXT NOT NULL,
  provider_session_id TEXT NOT NULL UNIQUE,
  payment_intent_id  TEXT,
  checkout_url       TEXT NOT NULL,
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  currency           TEXT NOT NULL DEFAULT 'usd',
  status             TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'PAID', 'EXPIRED', 'REFUNDED')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id, created_at DESC);
