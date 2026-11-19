-- Jade Garden D1 schema v1
-- Conventions:
--   * Money is stored as INTEGER cents (CAD). Never REAL.
--   * Timestamps are ISO-8601 UTC strings (new Date().toISOString()).
--   * Schema changes go in a NEW numbered migration file; never edit an applied one.

-- ---------------------------------------------------------------------------
-- Customers (CRM). One row per person; email is the primary retention key.
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id                  TEXT PRIMARY KEY,               -- 'cus_<random>'
  email               TEXT UNIQUE COLLATE NOCASE,     -- lowercased
  email_verified      INTEGER NOT NULL DEFAULT 0,     -- 1 when proven by Google/Apple/Facebook
  name                TEXT,
  phone               TEXT,                           -- digits only, e.g. '3066945566'
  default_address     TEXT,
  marketing_opt_in    INTEGER NOT NULL DEFAULT 0,     -- CASL: express consent only (unchecked by default)
  marketing_opt_in_at TEXT,
  order_count         INTEGER NOT NULL DEFAULT 0,
  total_spent_cents   INTEGER NOT NULL DEFAULT 0,
  first_order_at      TEXT,
  last_order_at       TEXT,
  notes               TEXT,                           -- staff notes / dietary preferences
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_customers_phone ON customers(phone);

-- A customer can sign in with several providers; each maps to one customer.
CREATE TABLE customer_identities (
  provider          TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'facebook')),
  provider_user_id  TEXT NOT NULL,                    -- 'sub' claim / Facebook user id
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  email             TEXT,
  created_at        TEXT NOT NULL,
  last_login_at     TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX idx_identities_customer ON customer_identities(customer_id);

-- ---------------------------------------------------------------------------
-- Orders from every channel. Totals are always computed server-side.
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id                  TEXT PRIMARY KEY,               -- 'WEB-1001' | 'ORD-1002' | 'WC-2565'
  source              TEXT NOT NULL CHECK (source IN ('Web', 'Phone', 'Walk-in', 'WooCommerce')),
  external_id         TEXT,                           -- WooCommerce order id for 'WC-' orders
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  delivery_type       TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_type IN ('pickup', 'delivery', 'dinein')),
  customer_id         TEXT REFERENCES customers(id),
  customer_name       TEXT,
  customer_phone      TEXT,
  customer_email      TEXT,
  delivery_address    TEXT,
  delivery_time_slot  TEXT,                           -- 'ASAP' | 'Pick Up' | free text / WooCommerce slot
  customer_notes      TEXT,
  items_json          TEXT NOT NULL,                  -- [{id, code, name, price_cents, qty}]
  subtotal_cents      INTEGER NOT NULL DEFAULT 0,
  discount_cents      INTEGER NOT NULL DEFAULT 0,
  delivery_fee_cents  INTEGER NOT NULL DEFAULT 0,
  tax_cents           INTEGER NOT NULL DEFAULT 0,
  tip_cents           INTEGER NOT NULL DEFAULT 0,
  total_cents         INTEGER NOT NULL DEFAULT 0,
  coupon_code         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_updated ON orders(updated_at);
CREATE INDEX idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX idx_orders_phone ON orders(customer_phone);
CREATE INDEX idx_orders_email ON orders(customer_email COLLATE NOCASE);
CREATE INDEX idx_orders_customer ON orders(customer_id);

-- Human-friendly sequential order numbers (WEB-1001, ORD-1002 share one sequence).
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO counters (name, value) VALUES ('order', 1000);

-- ---------------------------------------------------------------------------
-- Coupons: the ONLY promotion primitive in the database.
-- New campaign = INSERT a row. No code change unless a new condition key is needed.
-- See worker/services/coupons.js for how each column / condition is evaluated.
-- ---------------------------------------------------------------------------
CREATE TABLE coupons (
  code                TEXT PRIMARY KEY COLLATE NOCASE, -- stored UPPERCASE, e.g. 'WELCOME10'
  description         TEXT NOT NULL,                  -- customer-facing English text
  discount_type       TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed', 'free_delivery', 'free_item')),
  discount_value      INTEGER NOT NULL DEFAULT 0,     -- percent: whole percent (10 = 10%); fixed: cents
  max_discount_cents  INTEGER,                        -- cap for 'percent'; NULL = no cap
  free_item_id        INTEGER,                        -- menu item id for 'free_item'
  min_subtotal_cents  INTEGER NOT NULL DEFAULT 0,
  starts_at           TEXT,                           -- ISO UTC; NULL = immediately
  ends_at             TEXT,                           -- ISO UTC; NULL = never expires
  max_redemptions     INTEGER,                        -- total uses across everyone; NULL = unlimited
  max_per_customer    INTEGER,                        -- per email/phone; NULL = unlimited
  first_order_only    INTEGER NOT NULL DEFAULT 0,     -- no previous order by this email/phone (any channel)
  requires_account    INTEGER NOT NULL DEFAULT 0,     -- customer must be signed in (drives registration)
  channels            TEXT NOT NULL DEFAULT 'Web',    -- comma list of order sources: 'Web', 'Phone', 'Walk-in'
  conditions_json     TEXT,                           -- extra rules, e.g. {"days_of_week":[5,6],"hours":{"from":"11:00","to":"14:00"}}
  is_active           INTEGER NOT NULL DEFAULT 1,     -- kill switch
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE coupon_redemptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_code     TEXT NOT NULL REFERENCES coupons(code),
  order_id        TEXT NOT NULL UNIQUE REFERENCES orders(id),
  customer_id     TEXT,
  customer_email  TEXT,
  customer_phone  TEXT,
  discount_cents  INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_redemptions_coupon ON coupon_redemptions(coupon_code);
CREATE INDEX idx_redemptions_email ON coupon_redemptions(coupon_code, customer_email COLLATE NOCASE);
CREATE INDEX idx_redemptions_phone ON coupon_redemptions(coupon_code, customer_phone);

-- ---------------------------------------------------------------------------
-- Key/value state for background jobs (e.g. WooCommerce sync cursor).
-- ---------------------------------------------------------------------------
CREATE TABLE sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL
);
