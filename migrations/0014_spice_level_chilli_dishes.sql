-- Owner, 2026-11-25: every dish with the chilli icon on the printed 2026 menu offers the spice level
-- (No spicy / Mild / Medium / Hot). Missing so far: C3 Honey Garlic Sesame Chicken Wings (19) and
-- N5 Singapore Fried Rice Noodles (107). Sauces with the icon (O3 Curry, O5 Chili Oil) only show it.
-- Appends only; /jadmin edits kept.
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 19)
  WHERE id = 'spice' AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 19);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 107)
  WHERE id = 'spice' AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 107);
