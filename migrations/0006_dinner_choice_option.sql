-- Dinner for Two (menu id 94) and Dinner for Four (menu id 92) come with either chicken balls
-- or sweet & sour pork: staff must pick one in the POS. Editable later in the staff app
-- (Menu → Item options). Data only; no schema change.
INSERT OR IGNORE INTO option_groups (id, name, min_choices, max_choices, options_json, item_ids_json, sort, updated_at)
VALUES (
  'dinner_meat', 'Chicken balls or S/S pork', 1, 1,
  '[{"name":"Chicken Balls","price_cents":0},{"name":"Sweet & Sour Pork","price_cents":0}]',
  '[92,94]', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
