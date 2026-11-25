-- Dine-in tables, open checks, in-store payments, kitchen tickets, item options and sold-out
-- switches for the staff POS (web/public/staff/index.html).
--
-- Additive only: the previous code still runs on this schema (new columns are nullable,
-- new tables are ignored by old code).
--
-- Open checks: a POS order stays status = 'pending' while it is open (a dine-in table, or a
-- pickup / delivery order that has not gone out). Items can be added and removed while it is
-- open; the server reprices every change. status = 'completed' closes it (closed_at).
-- Each items_json line of a POS order also records how many were already sent to the
-- kitchen ("sent"), its options ("mods") and an optional staff line discount ("disc").

ALTER TABLE orders ADD COLUMN table_id TEXT;              -- dine-in table id from the staff floor plan (e.g. 'B2')
ALTER TABLE orders ADD COLUMN guests INTEGER;             -- dine-in party size (optional)
ALTER TABLE orders ADD COLUMN staff_discount_json TEXT;   -- whole-order discount set by staff: {"t":"pct"|"amt","v":<percent | cents>}
ALTER TABLE orders ADD COLUMN pending_voids_json TEXT;    -- removed items the kitchen has not been told about yet
ALTER TABLE orders ADD COLUMN closed_at TEXT;             -- when the order was completed (picked up, delivered, check closed)
CREATE INDEX idx_orders_open_table ON orders(table_id) WHERE status = 'pending';

-- Money taken in store (cash or the card terminal). Online payments stay on orders
-- (payment_status = 'paid', Clover). Balance = total_cents - SUM(amount_cents).
CREATE TABLE order_payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT NOT NULL REFERENCES orders(id),
  method          TEXT NOT NULL CHECK (method IN ('cash', 'card', 'other')),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  tendered_cents  INTEGER,                                -- cash handed over
  change_cents    INTEGER,                                -- cash given back
  label           TEXT,                                   -- 'Full' | 'Guest 2' | 'Partial'
  staff_email     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_payments_order ON order_payments(order_id);

-- Kitchen tickets for POS orders: every "Send to kitchen" makes one (NEW, ADD-ON, VOID or
-- CHANGE). Web and WooCommerce orders have no tickets; the kitchen screen shows the whole
-- order instead, as before.
CREATE TABLE kitchen_tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  kind        TEXT NOT NULL CHECK (kind IN ('NEW', 'ADD', 'VOID', 'CHANGE')),
  items_json  TEXT NOT NULL DEFAULT '[]',              -- [{qty, name, mods:[...], note}]
  voids_json  TEXT NOT NULL DEFAULT '[]',              -- [{qty, name}]
  note        TEXT,
  created_at  TEXT NOT NULL,
  done_at     TEXT,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_tickets_updated ON kitchen_tickets(updated_at);
CREATE INDEX idx_tickets_order ON kitchen_tickets(order_id);

-- Item options staff pick when they add a dish (spice level, requests ...). Prices of options
-- are in cents and are added by the server. item_ids_json lists the menu ids that use the group.
CREATE TABLE option_groups (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  min_choices    INTEGER NOT NULL DEFAULT 0,               -- 1 = required
  max_choices    INTEGER NOT NULL DEFAULT 1,               -- 1 = pick one, more = pick any
  options_json   TEXT NOT NULL,                            -- [{"name":"Medium","price_cents":0}]
  item_ids_json  TEXT NOT NULL DEFAULT '[]',
  sort           INTEGER NOT NULL DEFAULT 0,
  updated_by     TEXT,
  updated_at     TEXT NOT NULL
);

-- Dishes marked sold out by staff. A row with sold_out = 1 blocks the dish on the website
-- and in the POS until staff mark it available again.
CREATE TABLE menu_availability (
  item_id     INTEGER PRIMARY KEY,                         -- data/menu.json id
  sold_out    INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);

-- Starting option groups (staff can edit them in the Menu tab).
INSERT INTO option_groups (id, name, min_choices, max_choices, options_json, item_ids_json, sort, updated_at)
  VALUES ('spice', 'Spice level', 0, 1, '[{"name":"No spicy","price_cents":0},{"name":"Mild","price_cents":0},{"name":"Medium","price_cents":0},{"name":"Hot","price_cents":0}]', '[12,13,15,16,27,28,47,59,61,67,70,77,79,99,108]', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO option_groups (id, name, min_choices, max_choices, options_json, item_ids_json, sort, updated_at)
  VALUES ('requests', 'Requests', 0, 9, '[{"name":"No MSG","price_cents":0},{"name":"No onion","price_cents":0},{"name":"Less oil","price_cents":0},{"name":"Less salt","price_cents":0},{"name":"Sauce on the side","price_cents":0}]', '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,115]', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
