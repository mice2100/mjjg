-- Online payment (Clover Hosted Checkout) and customer tips.
--
-- payment_status:
--   in_store  – collected by staff (POS orders, WooCommerce imports, web orders while Clover is not configured)
--   awaiting  – web order sent to Clover checkout; hidden from the kitchen until paid
--   paid      – Clover webhook confirmed the payment
--   expired   – customer never paid; the order is cancelled and its coupon released
-- tip_cents already exists on orders (0001); tip_choice records which button the customer picked.

ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'in_store'
  CHECK (payment_status IN ('in_store', 'awaiting', 'paid', 'expired'));
ALTER TABLE orders ADD COLUMN tip_choice TEXT;              -- 'none' | '5' | '10' | '15' | 'round'
ALTER TABLE orders ADD COLUMN checkout_session_id TEXT;     -- Clover Hosted Checkout session UUID
ALTER TABLE orders ADD COLUMN payment_id TEXT;              -- Clover payment UUID (from the webhook)
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN public_token TEXT;            -- lets the customer's browser read its own order status

CREATE UNIQUE INDEX idx_orders_checkout_session ON orders(checkout_session_id);
CREATE INDEX idx_orders_payment ON orders(payment_status, created_at);
