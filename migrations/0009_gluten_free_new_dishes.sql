-- Owner, 2026-11-25: three dishes from the printed Gluten Free Menu are now on the menu
-- (F9 Black Truffle Bacon Fried Rice, N13 Chicken Fried Rice Noodles, N14 Shrimp Fried Rice Noodles).
-- Add them to the "Gluten free" option. Appends only: dishes set in /jadmin stay as they are.

UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 117)
  WHERE id = 'gluten_free' AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 117);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 118)
  WHERE id = 'gluten_free' AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 118);
UPDATE option_groups SET item_ids_json = json_insert(item_ids_json, '$[#]', 119)
  WHERE id = 'gluten_free' AND NOT EXISTS (SELECT 1 FROM json_each(option_groups.item_ids_json) WHERE value = 119);
