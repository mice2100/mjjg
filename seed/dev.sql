-- Local development seed data. NOT applied in production.
-- Run: npm run db:seed

INSERT OR IGNORE INTO coupons
  (code, description, discount_type, discount_value, max_discount_cents, min_subtotal_cents,
   first_order_only, requires_account, max_per_customer, channels, is_active, created_at, updated_at)
VALUES
  ('WELCOME10', '10% off your first online order of $30+ (up to $15 off)', 'percent', 10, 1500, 3000,
   1, 0, 1, 'Web', 1, '2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z'),
  ('FREEDELIVERY', 'Free delivery on orders of $50+', 'free_delivery', 0, NULL, 5000,
   0, 0, NULL, 'Web', 1, '2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z');
