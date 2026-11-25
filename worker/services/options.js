// Item options (option_groups) and sold-out switches (menu_availability), migration 0005.
//
// Option groups are what staff pick when they add a dish in the POS: spice level, requests,
// and so on. An option may cost extra (price_cents); the server adds that price, never the
// browser. Sold-out dishes are refused by every channel until staff mark them available.

import { HttpError } from '../lib/http.js';
import { getMenuItem } from '../lib/menu.js';
import { cleanText, nowIso } from '../lib/util.js';

export const MAX_OPTIONS = 30;
export const MAX_OPTION_PRICE_CENTS = 100000;

const parse = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const toGroup = (row) => ({
  id: row.id,
  name: row.name,
  min: row.min_choices,
  max: row.max_choices,
  options: parse(row.options_json, []),
  item_ids: parse(row.item_ids_json, []),
  sort: row.sort,
});

// Groups only staff can pick (POS); the website neither shows nor accepts them.
export const STAFF_ONLY_GROUPS = ['requests'];
export const customerGroups = (groups) => groups.filter((g) => !STAFF_ONLY_GROUPS.includes(g.id));

export async function listOptionGroups(db) {
  const { results } = await db.prepare('SELECT * FROM option_groups ORDER BY sort, name').all();
  return results.map(toGroup);
}

/**
 * Validates a staff edit of one option group.
 * raw = {name, min, max, options:[{name, price_cents}], item_ids:[menu id]}
 */
export function normalizeGroup(raw) {
  const name = cleanText(raw?.name, 60);
  if (!name) throw new HttpError(400, 'Give the option group a name.');
  const min = raw?.min ? 1 : 0;
  const max = Math.floor(Number(raw?.max));
  if (!(max >= 1 && max <= MAX_OPTIONS)) throw new HttpError(400, 'Invalid choice rule.');
  if (!Array.isArray(raw?.options)) throw new HttpError(400, 'options must be a list');
  const seen = new Set();
  const options = [];
  for (const opt of raw.options) {
    const optName = cleanText(String(opt?.name ?? '').replace(/\s+/g, ' '), 60);
    if (!optName) continue;
    const key = optName.toLowerCase();
    if (seen.has(key)) throw new HttpError(400, `"${optName}" is listed twice.`);
    seen.add(key);
    const price = Math.round(Number(opt?.price_cents || 0));
    if (!(price >= 0 && price <= MAX_OPTION_PRICE_CENTS)) throw new HttpError(400, `Invalid price for ${optName}.`);
    options.push({ name: optName, price_cents: price });
  }
  if (!options.length) throw new HttpError(400, 'Add at least one option.');
  if (options.length > MAX_OPTIONS) throw new HttpError(400, `A group can have at most ${MAX_OPTIONS} options.`);
  if (!Array.isArray(raw?.item_ids)) throw new HttpError(400, 'item_ids must be a list');
  const itemIds = [...new Set(raw.item_ids.map(Number))].filter((id) => getMenuItem(id)).sort((a, b) => a - b);
  return { name, min, max, options, item_ids: itemIds };
}

export async function saveOptionGroup(db, id, raw, staffEmail) {
  const g = normalizeGroup(raw);
  const groupId = id && id !== 'new' ? cleanText(id, 40) : `g_${crypto.randomUUID().slice(0, 8)}`;
  const at = nowIso();
  await db
    .prepare(
      `INSERT INTO option_groups (id, name, min_choices, max_choices, options_json, item_ids_json, sort, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort) + 1 FROM option_groups), 1), ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, min_choices = excluded.min_choices,
         max_choices = excluded.max_choices, options_json = excluded.options_json,
         item_ids_json = excluded.item_ids_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
    .bind(groupId, g.name, g.min, g.max, JSON.stringify(g.options), JSON.stringify(g.item_ids), staffEmail || null, at)
    .run();
  return { id: groupId, ...g };
}

export async function deleteOptionGroup(db, id) {
  const r = await db.prepare('DELETE FROM option_groups WHERE id = ?').bind(id).run();
  if (!r.meta?.changes) throw new HttpError(404, 'Option group not found');
}

/**
 * Turns the options a staff member picked for one dish into priced mods.
 * picked = [{g: groupId, n: optionName}]. Enforces which groups apply to the dish and the
 * group's min/max. Returns [{g, group, n, price_cents}] in group order.
 */
export function resolveMods(groups, itemId, picked) {
  const applicable = groups.filter((g) => g.item_ids.includes(itemId));
  const list = Array.isArray(picked) ? picked : [];
  const mods = [];
  for (const g of applicable) {
    const chosen = [];
    for (const p of list) {
      if (p?.g !== g.id) continue;
      const opt = g.options.find((o) => o.name === p.n);
      if (!opt) throw new HttpError(400, `"${p.n}" is not an option of ${g.name}.`);
      if (!chosen.some((c) => c.n === opt.name)) chosen.push({ g: g.id, group: g.name, n: opt.name, price_cents: opt.price_cents });
    }
    if (chosen.length < g.min) throw new HttpError(400, `Choose ${g.name.toLowerCase()} for ${getMenuItem(itemId)?.name || 'this dish'}.`);
    if (chosen.length > g.max) throw new HttpError(400, `Too many choices for ${g.name}.`);
    mods.push(...chosen);
  }
  const unknown = list.find((p) => !applicable.some((g) => g.id === p?.g));
  if (unknown) throw new HttpError(400, 'An option no longer applies to this dish. Remove it and add the dish again.');
  return mods;
}

// ---------------------------------------------------------------------------
// Sold out
// ---------------------------------------------------------------------------

export async function listSoldOut(db) {
  const { results } = await db.prepare('SELECT item_id FROM menu_availability WHERE sold_out = 1').all();
  return results.map((r) => r.item_id);
}

export async function setSoldOut(db, itemId, soldOut, staffEmail) {
  const item = getMenuItem(itemId);
  if (!item) throw new HttpError(404, 'Unknown menu item');
  await db
    .prepare(
      `INSERT INTO menu_availability (item_id, sold_out, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET sold_out = excluded.sold_out, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
    .bind(item.id, soldOut ? 1 : 0, staffEmail || null, nowIso())
    .run();
  return { item_id: item.id, sold_out: Boolean(soldOut) };
}

// Throws 409 when a new line asks for a sold-out dish. `lines` = [{id, name}].
export async function assertAvailable(db, lines) {
  if (!lines.length) return;
  const soldOut = new Set(await listSoldOut(db));
  const out = lines.find((l) => soldOut.has(l.id));
  if (out) throw new HttpError(409, `Sorry, ${out.name} is sold out right now.`, { sold_out_id: out.id });
}
