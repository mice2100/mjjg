-- Owner, 2026-11-25: BLP becomes S/S PK (Gluten Free Combo).
-- Only if the combo is still as migration 0010 left it; /jadmin edits are kept.
UPDATE combos SET components_json = '[{"id":null,"name":"S/S PK","qty":1},{"id":null,"name":"Chicken Vegetables","qty":1},{"id":null,"name":"CK FR","qty":1}]',
  updated_by = 'owner 2026-11-25 BLP to S/S PK', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 95 AND updated_by = 'owner order 2026-11-25';
