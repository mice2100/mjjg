-- 2026-11-25: WooCommerce imports now keep what customers picked on each line (e.g. "Noodle Type:
-- Low Mein"). Move the sync cursor back 2 days so recent orders are re-read with their options.
-- Safe: the upsert never moves a kitchen-completed order back to pending.
UPDATE sync_state SET value = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days')
  WHERE key = 'woo_modified_after' AND value > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days');
