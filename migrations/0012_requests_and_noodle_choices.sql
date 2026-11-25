-- Owner, 2026-11-25 (menu workbook + printed 2026 menu):
-- 1. Requests: "No MSG" becomes "No extra MSG"; new "Extra Onion". Only if the list is unchanged since 0005.
-- 2. New noodle choices (menu ids 120-129) get the same option groups as their siblings:
--    BBQ Pork Chow Mein like Chicken Chow Mein (101); Low Mein / Shanghai choices like Chicken Low Mein (105).
-- Appends only; nothing set in /jadmin is removed.

UPDATE option_groups SET options_json = '[{"name":"No extra MSG","price_cents":0},{"name":"No onion","price_cents":0},{"name":"Extra Onion","price_cents":0},{"name":"Less oil","price_cents":0},{"name":"Less salt","price_cents":0},{"name":"Sauce on the side","price_cents":0}]',
  updated_by = 'menu workbook 2026-11-25', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = 'requests' AND options_json = '[{"name":"No MSG","price_cents":0},{"name":"No onion","price_cents":0},{"name":"Less oil","price_cents":0},{"name":"Less salt","price_cents":0},{"name":"Sauce on the side","price_cents":0}]';

UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 120)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 101)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 120);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 121)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 121);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 122)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 122);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 123)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 123);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 124)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 124);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 125)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 125);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 126)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 126);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 127)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 127);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 128)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 128);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 129)
  WHERE EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 105)
    AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 129);
