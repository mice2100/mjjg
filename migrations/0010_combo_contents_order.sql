-- Owner, 2026-11-25: set-dinner contents listed in the kitchen's order:
-- SpR, CKB (or S/S PK), DF ShR, Mon Ribs, CKW, GB, SP VEG, CK LM, FR.
-- Only rows still as migration 0008 wrote them; anything edited in /jadmin is left alone.

UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":1},{"id":null,"name":"S/S PK","qty":1},{"id":null,"name":"SP VEG","qty":1},{"id":null,"name":"FR","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 88 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":1},{"id":null,"name":"CKB","qty":6},{"id":null,"name":"SP VEG","qty":1},{"id":null,"name":"FR","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 89 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":1},{"id":null,"name":"S/S PK","qty":1},{"id":null,"name":"DF SHR","qty":3},{"id":null,"name":"SP VEG","qty":1},{"id":null,"name":"FR","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 97 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":1},{"id":null,"name":"CKB","qty":6},{"id":null,"name":"DF SHR","qty":3},{"id":null,"name":"SP VEG","qty":1},{"id":null,"name":"FR","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 98 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"BLP","qty":1},{"id":null,"name":"Chicken Vegetables","qty":1},{"id":null,"name":"CK FR","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 95 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"PF ShR","qty":1},{"id":null,"name":"Mon Rib","qty":1},{"id":null,"name":"Spicy CK FR","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 99 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":2},{"id":null,"name":"CKB (12) & 8 oz S/S sauce OR S/S PK (Round)","qty":1},{"id":null,"name":"DF ShR","qty":6},{"id":null,"name":"SP VEG (Round)","qty":1},{"id":null,"name":"FR (EP28)","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 94 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":3},{"id":null,"name":"CKB","qty":9},{"id":null,"name":"DF ShR","qty":9},{"id":null,"name":"Mon Ribs (half order)","qty":1},{"id":null,"name":"CKW","qty":8},{"id":null,"name":"FR (EP28)","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 96 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"CKB (18) & 12 oz S/S OR S/S PK (Round)","qty":1},{"id":null,"name":"DF SHR","qty":12},{"id":null,"name":"CKW","qty":12},{"id":null,"name":"SP VEG (6*9)","qty":1},{"id":null,"name":"FR (6*9)","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 92 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":5},{"id":null,"name":"CKB (18) & 12 oz S/S","qty":1},{"id":null,"name":"DF SHR","qty":18},{"id":null,"name":"Mon Ribs (Round)","qty":1},{"id":null,"name":"SP VEG (6*9)","qty":1},{"id":null,"name":"FR (6*9)","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 91 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":6},{"id":null,"name":"CKB (18) & 12 oz S/S","qty":1},{"id":null,"name":"DF SHR","qty":18},{"id":null,"name":"Mon Ribs (Round)","qty":1},{"id":null,"name":"SP VEG (6*9)","qty":1},{"id":null,"name":"CK LM","qty":1},{"id":null,"name":"FR (6*9)","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 93 AND updated_by = 'menu workbook 2026-11-25';
UPDATE combos SET components_json = '[{"id":null,"name":"SpR","qty":8},{"id":null,"name":"CKB (18) & 12 oz S/S","qty":1},{"id":null,"name":"S/S PK (Round)","qty":1},{"id":null,"name":"DF SHR","qty":18},{"id":null,"name":"Mon Ribs (Round)","qty":1},{"id":null,"name":"GB","qty":1},{"id":null,"name":"SP VEG (6*9)","qty":1},{"id":null,"name":"CK LM","qty":1},{"id":null,"name":"FR (6*9)","qty":1}]', updated_by = 'owner order 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE combo_id = 90 AND updated_by = 'menu workbook 2026-11-25';
