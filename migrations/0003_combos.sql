-- Combo contents, edited by staff admins in the staff app (Combos tab).
--
-- A combo is still a normal menu item in data/menu.json (its own id, name and price);
-- this table only records what it contains, so the POS, the kitchen board and order
-- snapshots can list the dishes. Price never comes from here.
--
-- components_json: [{"id": <menu item id> | null, "name": "Egg Roll", "qty": 1}]
--   id   = a dish from data/menu.json (its name is refreshed from the menu on read)
--   null = a free-text line that is not a menu item, e.g. "Steamed Rice"

CREATE TABLE combos (
  combo_id         INTEGER PRIMARY KEY,   -- menu item id (data/menu.json) of the combo
  components_json  TEXT NOT NULL,
  updated_by       TEXT,                  -- staff email from Cloudflare Access
  updated_at       TEXT NOT NULL
);
