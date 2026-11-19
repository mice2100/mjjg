-- Customers as the hub for every channel (POS, website, WooCommerce import).
--
-- * Every order with a phone or email is linked to a customer (orders.customer_id).
--   New orders are linked when they are created or imported; older orders are linked
--   by the cron backfill (backfillCustomers in worker/services/customers.js).
-- * customer_addresses: every delivery address a customer has used, so the POS lookup
--   reads a handful of rows instead of scanning the customer's orders.
-- * customers.order_count / total_spent_cents / first_order_at / last_order_at are
--   recomputed from the customer's own orders after every change (refreshCustomerStats).
--   They count orders that are not cancelled and are paid or collected in store.
--
-- Additive only: the previous code still runs on this schema.

CREATE TABLE customer_addresses (
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  address_key   TEXT NOT NULL,   -- lowercase, punctuation and spacing collapsed (addressKey in customers.js)
  address       TEXT NOT NULL,   -- as last typed
  last_used_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (customer_id, address_key)
);

-- POS lookup: a customer's newest orders without sorting their whole history.
CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);
