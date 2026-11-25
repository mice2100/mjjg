-- Owner, 2026-11-25: N5 Singapore Fried Rice Noodles (menu id 107) can be made gluten free
-- (marked on the printed 2026 menu). Appends to the "Gluten free" option; /jadmin edits kept.
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 107)
  WHERE id = 'gluten_free' AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 107);
