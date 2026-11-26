// WooCommerce -> D1 order import (transition period only; delete once WordPress is retired).
//
// Two paths feed the same upsert:
//   1. Webhook  POST /api/webhooks/woocommerce  (instant, signed with WC_WEBHOOK_SECRET)
//   2. Cron     scheduled() every minute         (safety net; catches missed webhooks)
// The kitchen screen never talks to WooCommerce; it only reads D1.

import { cleanText, normalizeEmail, normalizePhone, nowIso, toCents } from '../lib/util.js';
import { linkOrderCustomer } from './customers.js';

const CURSOR_KEY = 'woo_modified_after';
const PAGE_SIZE = 50;
const MAX_PAGES = 5;

// WooCommerce status -> kitchen status. null = do not import (unpaid / draft).
const STATUS_MAP = {
  processing: 'pending',
  'on-hold': 'pending',
  completed: 'completed',
  cancelled: 'cancelled',
  refunded: 'cancelled',
  failed: 'cancelled',
  trash: 'cancelled',
};

// What the customer picked on a WooCommerce line (e.g. "Noodle Type: Low Mein (Soft Skinny
// Noodles)"), from line_items[].meta_data. Keys starting with "_" are WooCommerce/plugin internals.
// Shown on the kitchen screen and tickets as "Label: choice". price_cents 0: WooCommerce already
// includes option prices in the line price.
const decode = (t) => String(t)
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;/g, '–').replace(/&#36;/g, '$')
  .replace(/\s+/g, ' ').trim();

export function wooLineOptions(it) {
  const mods = [];
  for (const m of it?.meta_data || []) {
    const key = String(m?.key ?? '');
    if (!key || key.startsWith('_')) continue;
    const raw = m.display_value ?? m.value;
    const vals = Array.isArray(raw) ? raw : [raw];
    if (vals.some((v) => v !== null && typeof v === 'object')) continue; // plugin data, not a choice
    const value = decode(vals.filter((v) => v !== null && v !== '').join(', '));
    const label = decode(m.display_key || key);
    if (!value) continue;
    const n = cleanText(label ? `${label}: ${value}` : value, 160);
    if (!mods.some((x) => x.n === n)) mods.push({ g: 'wc', group: label, n, price_cents: 0 });
  }
  return mods;
}

export function mapWooOrder(o) {
  const status = STATUS_MAP[o.status];
  if (!status) return null;

  const billing = o.billing || {};
  let deliveryType = 'pickup';
  let timeSlot = '';
  for (const m of o.meta_data || []) {
    if (m.key === 'exwfood_order_method') deliveryType = String(m.value).toLowerCase() === 'delivery' ? 'delivery' : 'pickup';
    if ((m.key === 'exwfood_time_deli' || m.key === 'exwfood_timeslot') && !timeSlot) timeSlot = String(m.value);
  }

  let deliveryFeeCents = toCents(o.shipping_total);
  let tipCents = 0;
  for (const f of o.fee_lines || []) {
    const name = String(f.name || '').toLowerCase();
    const cents = toCents(f.total);
    if (name.includes('shipping') || name.includes('delivery')) {
      deliveryFeeCents += cents;
      deliveryType = 'delivery';
    } else if (name.includes('appreciation') || name.includes('tip')) {
      tipCents += cents;
    }
  }

  const items = (o.line_items || []).map((it) => {
    const mods = wooLineOptions(it);
    return {
      id: null,
      code: it.sku || (String(it.name).match(/^([A-Z]+\d+[A-Z]?)\b/) || [])[1] || '',
      name: it.name,
      price_cents: toCents(it.price),
      qty: it.quantity || 1,
      ...(mods.length ? { mods } : {}),
    };
  });

  const address = [billing.address_1, billing.address_2, billing.city, billing.state, billing.postcode].filter(Boolean).join(', ');
  const toIso = (gmt) => (gmt ? `${gmt}Z` : nowIso());

  return {
    id: `WC-${o.id}`,
    external_id: String(o.id),
    status,
    delivery_type: deliveryType,
    customer_name: `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || 'Web Customer',
    customer_phone: normalizePhone(billing.phone),
    customer_email: normalizeEmail(billing.email) || null,
    delivery_address: deliveryType === 'delivery' ? address : null,
    delivery_time_slot: timeSlot,
    customer_notes: cleanText(o.customer_note, 500),
    items_json: JSON.stringify(items),
    subtotal_cents: items.reduce((s, it) => s + it.price_cents * it.qty, 0),
    discount_cents: toCents(o.discount_total),
    delivery_fee_cents: deliveryFeeCents,
    tax_cents: toCents(o.total_tax),
    tip_cents: tipCents,
    total_cents: toCents(o.total),
    coupon_code: (o.coupon_lines || []).map((c) => c.code).join(',') || null,
    created_at: toIso(o.date_created_gmt),
    // Import time, not WooCommerce's modified time: the kitchen board polls for orders
    // changed since its last poll, and an import can arrive minutes after the change.
    updated_at: nowIso(),
  };
}

export async function upsertWooOrder(db, wooOrder) {
  const o = mapWooOrder(wooOrder);
  if (!o) return false;

  // Status rule: a cancellation in WooCommerce always wins; otherwise never move an
  // order the kitchen already completed back to pending.
  const row = await db
    .prepare(
      `INSERT INTO orders (id, source, external_id, status, delivery_type, customer_name, customer_phone, customer_email,
         delivery_address, delivery_time_slot, customer_notes, items_json, subtotal_cents, discount_cents,
         delivery_fee_cents, tax_cents, tip_cents, total_cents, coupon_code, created_at, updated_at)
       VALUES (?, 'WooCommerce', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         status = CASE
           WHEN excluded.status = 'cancelled' THEN 'cancelled'
           WHEN orders.status = 'completed' THEN 'completed'
           ELSE excluded.status END,
         delivery_type = excluded.delivery_type,
         delivery_address = excluded.delivery_address,
         delivery_time_slot = excluded.delivery_time_slot,
         customer_notes = excluded.customer_notes,
         items_json = excluded.items_json,
         subtotal_cents = excluded.subtotal_cents,
         discount_cents = excluded.discount_cents,
         delivery_fee_cents = excluded.delivery_fee_cents,
         tax_cents = excluded.tax_cents,
         tip_cents = excluded.tip_cents,
         total_cents = excluded.total_cents,
         updated_at = excluded.updated_at
       RETURNING *`
    )
    .bind(
      o.id, o.external_id, o.status, o.delivery_type, o.customer_name, o.customer_phone, o.customer_email,
      o.delivery_address, o.delivery_time_slot, o.customer_notes, o.items_json, o.subtotal_cents, o.discount_cents,
      o.delivery_fee_cents, o.tax_cents, o.tip_cents, o.total_cents, o.coupon_code, o.created_at, o.updated_at
    )
    .first();
  // Link the order to its customer (created from the billing email/phone when new)
  // and refresh that customer's stats and saved addresses.
  await linkOrderCustomer(db, row);
  return true;
}

export async function syncWooOrders(env) {
  if (!env.WC_CONSUMER_KEY || !env.WC_CONSUMER_SECRET || !env.WC_STORE_URL) {
    return { skipped: 'WooCommerce credentials not configured' };
  }
  const db = env.DB;
  const state = await db.prepare('SELECT value FROM sync_state WHERE key = ?').bind(CURSOR_KEY).first();
  // First run: look back 2 days. Subtract 1s on every run because modified_after is exclusive.
  const cursorMs = state?.value ? Date.parse(state.value) : Date.now() - 2 * 86400 * 1000;
  let cursor = new Date(cursorMs - 1000).toISOString().replace(/\.\d{3}Z$/, '');
  const auth = 'Basic ' + btoa(`${env.WC_CONSUMER_KEY}:${env.WC_CONSUMER_SECRET}`);

  let imported = 0;
  let newest = state?.value || null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL('/wp-json/wc/v3/orders', env.WC_STORE_URL);
    url.search = new URLSearchParams({
      per_page: String(PAGE_SIZE),
      page: String(page),
      orderby: 'modified',
      order: 'asc',
      modified_after: cursor,
      dates_are_gmt: 'true',
    }).toString();

    const resp = await fetch(url, { headers: { Authorization: auth, 'User-Agent': 'JadeGarden-Worker/2.0' } });
    if (!resp.ok) throw new Error(`WooCommerce HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const orders = await resp.json();

    for (const o of orders) {
      if (await upsertWooOrder(db, o)) imported++;
      const modified = o.date_modified_gmt ? `${o.date_modified_gmt}Z` : null;
      if (modified && (!newest || modified > newest)) newest = modified;
    }
    if (orders.length < PAGE_SIZE) break;
  }

  if (newest) {
    await db
      .prepare(
        `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(CURSOR_KEY, newest, nowIso())
      .run();
  }
  return { imported, cursor: newest };
}

// WooCommerce signs webhook bodies: base64(HMAC-SHA256(rawBody, secret)).
export async function verifyWooSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let sigBytes;
  try {
    sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(rawBody));
}
