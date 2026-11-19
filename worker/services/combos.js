// Combo contents (table `combos`, migration 0003). A combo is a normal menu item with its
// own price; this module only knows which dishes it contains, for display and for the
// kitchen. Pricing never reads it.

import { HttpError } from '../lib/http.js';
import { getMenuItem } from '../lib/menu.js';
import { cleanText, nowIso } from '../lib/util.js';

export const MAX_COMPONENTS = 30;
export const MAX_COMPONENT_QTY = 20;

/**
 * Validates staff input for one combo and returns the stored shape [{id, name, qty}].
 * Each line is either a menu dish ({id, qty}) or a free-text line ({name, qty}).
 * Lines for the same dish (or the same text) are merged.
 */
export function normalizeComponents(comboId, raw) {
  if (!Array.isArray(raw)) throw new HttpError(400, 'components must be a list');
  if (raw.length > MAX_COMPONENTS) throw new HttpError(400, `A combo can have at most ${MAX_COMPONENTS} lines.`);
  const merged = new Map();
  for (const line of raw) {
    const qty = Math.floor(Number(line?.qty ?? 1));
    if (!(qty >= 1 && qty <= MAX_COMPONENT_QTY)) throw new HttpError(400, `Quantity must be 1 to ${MAX_COMPONENT_QTY}.`);
    let entry;
    if (line?.id != null && line.id !== '') {
      const item = getMenuItem(line.id);
      if (!item) throw new HttpError(400, `Unknown menu item: ${line.id}`);
      if (item.id === comboId) throw new HttpError(400, 'A combo cannot contain itself.');
      entry = { key: `id:${item.id}`, id: item.id, name: item.name };
    } else {
      const name = cleanText(String(line?.name ?? '').replace(/\s+/g, ' '), 80);
      if (!name) throw new HttpError(400, 'Each line needs a dish or a name.');
      entry = { key: `name:${name.toLowerCase()}`, id: null, name };
    }
    const prev = merged.get(entry.key);
    if (prev) prev.qty = Math.min(MAX_COMPONENT_QTY, prev.qty + qty);
    else merged.set(entry.key, { id: entry.id, name: entry.name, qty });
  }
  return [...merged.values()];
}

// Dish names follow the menu (renames show up everywhere); retired dishes keep their stored name.
function hydrate(components) {
  return components.map((c) => {
    const item = c.id != null ? getMenuItem(c.id) : null;
    return { id: item ? item.id : null, code: item?.code || '', name: item ? item.name : c.name, qty: c.qty };
  });
}

function parse(json) {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Combos whose menu item still exists: [{combo_id, components, updated_at, updated_by}]
export async function listCombos(db) {
  const { results } = await db.prepare('SELECT * FROM combos ORDER BY combo_id').all();
  return results
    .filter((r) => getMenuItem(r.combo_id))
    .map((r) => ({
      combo_id: r.combo_id,
      components: hydrate(parse(r.components_json)),
      updated_at: r.updated_at,
      updated_by: r.updated_by || '',
    }));
}

export async function loadComboMap(db) {
  return new Map((await listCombos(db)).map((c) => [c.combo_id, c.components]));
}

// Saving an empty list removes the combo contents (the dish stays on the menu).
export async function saveCombo(db, comboId, rawComponents, staffEmail) {
  const item = getMenuItem(comboId);
  if (!item) throw new HttpError(404, 'Menu item not found');
  const components = normalizeComponents(item.id, rawComponents);
  if (components.length === 0) {
    await db.prepare('DELETE FROM combos WHERE combo_id = ?').bind(item.id).run();
    return { combo_id: item.id, components: [] };
  }
  const at = nowIso();
  await db
    .prepare(
      `INSERT INTO combos (combo_id, components_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (combo_id) DO UPDATE SET components_json = excluded.components_json,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
    .bind(item.id, JSON.stringify(components), staffEmail || null, at)
    .run();
  return { combo_id: item.id, components: hydrate(components), updated_at: at, updated_by: staffEmail || '' };
}

/**
 * Adds `components` to combo lines of an order snapshot, so the kitchen sees what to cook
 * even if the combo is edited later. Quantities are per one combo.
 */
export function withComponents(items, comboMap) {
  return items.map((line) => {
    const components = line.id != null && !line.free ? comboMap.get(line.id) : null;
    return components?.length ? { ...line, components: components.map(({ id, code, name, qty }) => ({ id, code, name, qty })) } : line;
  });
}
