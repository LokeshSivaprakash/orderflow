-- Orders now wait for payment: PENDING_PAYMENT -> PAID, or -> CANCELLED (user cancel / checkout expiry).
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
UPDATE orders SET status = 'PAID' WHERE status = 'CONFIRMED';
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'CANCELLED')),
  ALTER COLUMN status SET DEFAULT 'PENDING_PAYMENT';
ALTER TABLE orders ADD COLUMN paid_at TIMESTAMPTZ;
