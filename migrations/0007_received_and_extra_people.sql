-- 1. Online orders (website, WordPress) ring on the staff app until someone taps "Received".
--    received_at = when staff acknowledged it. Orders that already exist count as received.
-- 2. Extra people on the big set dinners (staff app → item options):
--    House Special Platter for Three or More (96) and Dinner for Six (93): $15.95 per person;
--    Dinner for Eight (90): $16.37 per person.
-- Additive only.

ALTER TABLE orders ADD COLUMN received_at TEXT;
UPDATE orders SET received_at = updated_at WHERE received_at IS NULL;

INSERT OR IGNORE INTO option_groups (id, name, min_choices, max_choices, options_json, item_ids_json, sort, updated_at)
VALUES ('extra_people', 'Extra people ($15.95 each)', 0, 1, '[{"name":"+1 person","price_cents":1595},{"name":"+2 people","price_cents":3190},{"name":"+3 people","price_cents":4785},{"name":"+4 people","price_cents":6380},{"name":"+5 people","price_cents":7975},{"name":"+6 people","price_cents":9570}]', '[93,96]', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO option_groups (id, name, min_choices, max_choices, options_json, item_ids_json, sort, updated_at)
VALUES ('extra_people_8', 'Extra people ($16.37 each)', 0, 1, '[{"name":"+1 person","price_cents":1637},{"name":"+2 people","price_cents":3274},{"name":"+3 people","price_cents":4911},{"name":"+4 people","price_cents":6548},{"name":"+5 people","price_cents":8185},{"name":"+6 people","price_cents":9822}]', '[90]', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
