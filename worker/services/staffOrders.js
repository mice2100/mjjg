// POS orders (staff app): open checks, kitchen tickets and in-store payments. Migration 0005.
//
// A POS order is created by the staff app with `lines` (not the website's `items`):
//   {uid, id, qty, mods:[{g, n}], note, disc:{t:'pct'|'amt', v}}
// The browser sends only ids, quantities, chosen options and staff discounts. Every price
// below comes from data/menu.json and option_groups, so the server still decides prices.
//
// While status = 'pending' the order is open: staff can add or remove lines, move it to
// another table and take payments. "Send to kitchen" creates a kitchen ticket with what
// changed since the last send (NEW, ADD, VOID or CHANGE).

import { HttpError } from '../lib/http.js';
import { getMenuItem, priceCents } from '../lib/menu.js';
import { MAX_QTY_PER_LINE, deliveryFeeCents, cleanText, normalizePhone, nowIso, taxOn, toCents } from '../lib/util.js';
import { afterOrderChange, prepareCustomerForOrder } from './customers.js';
import { loadComboMap, withComponents } from './combos.js';
import { assertAvailable, listOptionGroups, resolveMods } from './options.js';
import { closeTicketsStatement } from './orders.js';
import { assertUnit, staffPlace } from '../lib/places.js';

export const STAFF_TYPES = ['dinein', 'pickup', 'delivery'];
export const MAX_LINES = 100;
const POS_SOURCES = ['Phone', 'Walk-in'];

const parse = (text, fallback) => {
  try {
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
};

const newUid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

/** Staff discount {t:'pct'|'amt', v}: pct = whole percent 1-100, amt = cents. null = none. */
export function normalizeDiscount(raw) {
  if (!raw || !['pct', 'amt'].includes(raw.t)) return null;
  const v = Math.round(Number(raw.v));
  if (raw.t === 'pct') return v >= 1 && v <= 100 ? { t: 'pct', v } : null;
  return v >= 1 && v <= 10000000 ? { t: 'amt', v } : null;
}

export const discountCents = (disc, baseCents) =>
  !disc ? 0 : disc.t === 'pct' ? Math.round((baseCents * disc.v) / 100) : Math.min(disc.v, baseCents);

/**
 * Prices the lines of a POS order. prevLines (the stored lines, if the order exists) keep
 * each line's `sent` count: lines are matched by uid. Returns {lines, voids} where voids are
 * the sent items that were removed or reduced and must be told to the kitchen.
 */
export function priceLines(rawLines, groups, prevLines = []) {
  if (!Array.isArray(rawLines)) throw new HttpError(400, 'lines must be a list');
  if (rawLines.length > MAX_LINES) throw new HttpError(400, 'Too many lines on one order.');
  const prev = new Map(prevLines.map((l) => [l.uid, l]));
  const used = new Set();
  const lines = [];
  const voids = [];
  for (const raw of rawLines) {
    const item = getMenuItem(raw?.id);
    if (!item) throw new HttpError(400, `Unknown menu item: ${raw?.id}`);
    const qty = Math.floor(Number(raw?.qty));
    if (!(qty >= 1 && qty <= MAX_QTY_PER_LINE)) throw new HttpError(400, `Invalid quantity for ${item.name}`);
    let uid = typeof raw?.uid === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(raw.uid) ? raw.uid : newUid();
    if (used.has(uid)) uid = newUid();
    used.add(uid);
    const old = prev.get(uid);
    // A stored line keeps its dish: changing the dish means a new line.
    const before = old && old.id === item.id ? old : null;
    const mods = resolveMods(groups, item.id, raw?.mods);
    const base = priceCents(item);
    const unit = base + mods.reduce((sum, m) => sum + m.price_cents, 0);
    const gross = unit * qty;
    const disc = normalizeDiscount(raw?.disc);
    let sent = before ? Math.min(before.sent, before.qty) : 0;
    if (sent > qty) {
      voids.push({ qty: sent - qty, name: item.name });
      sent = qty;
    }
    lines.push({
      uid,
      id: item.id,
      code: item.code,
      name: item.name,
      base_cents: base,
      price_cents: unit,
      qty,
      sent,
      mods,
      note: cleanText(raw?.note, 200),
      disc,
      disc_cents: discountCents(disc, gross),
    });
  }
  for (const old of prevLines) {
    const kept = lines.find((l) => l.uid === old.uid && l.id === old.id);
    if (!kept && old.sent > 0) voids.push({ qty: Math.min(old.sent, old.qty), name: old.name });
  }
  return { lines, voids };
}

/** Totals of a POS order. lines from priceLines. */
export function staffTotals(lines, { deliveryType, deliveryPlace, orderDiscount }) {
  const subtotal = lines.reduce((sum, l) => sum + l.price_cents * l.qty, 0);
  const itemDiscount = lines.reduce((sum, l) => sum + l.disc_cents, 0);
  const afterItems = subtotal - itemDiscount;
  const orderDisc = discountCents(orderDiscount, afterItems);
  const discount = itemDiscount + orderDisc;
  const fee = deliveryFeeCents(deliveryType, deliveryPlace);
  const tax = taxOn(subtotal - discount); // staff discounts are on food; the delivery fee is not taxed
  return {
    subtotal_cents: subtotal,
    item_discount_cents: itemDiscount,
    order_discount_cents: orderDisc,
    discount_cents: discount,
    delivery_fee_cents: fee,
    tax_cents: tax,
    total_cents: subtotal - discount + fee + tax,
  };
}

// Lines stored before migration 0005 (website, WooCommerce, older POS) have no uid / sent.
export function storedLines(row) {
  return parse(row.items_json, []).map((l, i) => ({
    ...l,
    uid: l.uid || `L${i}`,
    sent: l.sent ?? l.qty,
    mods: l.mods || [],
    disc_cents: l.disc_cents || 0,
  }));
}

// What the kitchen ticket shows for the unsent part of each line.
function ticketItems(lines) {
  const out = [];
  for (const l of lines) {
    const d = l.qty - l.sent;
    if (d <= 0) continue;
    out.push({
      qty: d,
      name: l.name,
      mods: l.mods.map((m) => m.n),
      note: l.note || '',
      components: (l.components || []).map((c) => ({ name: c.name, qty: c.qty })),
    });
    l.sent = l.qty;
  }
  return out;
}

async function ticketStatement(db, orderId, { items, voids, note, hadTickets, at }) {
  if (!items.length && !voids.length && !note) return null;
  const kind = items.length ? (hadTickets ? 'ADD' : 'NEW') : voids.length ? 'VOID' : 'CHANGE';
  return db
    .prepare(
      `INSERT INTO kitchen_tickets (order_id, kind, items_json, voids_json, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(orderId, kind, JSON.stringify(items), JSON.stringify(voids), note || null, at, at);
}

function customerFields(body, deliveryType) {
  const name = cleanText(body.customer_name, 100);
  const phone = normalizePhone(body.customer_phone);
  const address = cleanText(body.delivery_address, 300);
  if (phone && phone.length !== 10) throw new HttpError(400, 'Please enter a valid 10-digit phone number.');
  if (deliveryType === 'delivery') {
    if (!phone) throw new HttpError(400, 'A delivery order needs a phone number.');
    if (!address) throw new HttpError(400, 'Please enter a delivery address.');
  }
  if (deliveryType === 'pickup' && !name && !phone) throw new HttpError(400, 'A pickup order needs a name or a phone number.');
  return { name, phone, address: deliveryType === 'delivery' ? address : '' };
}

async function checkTable(db, tableId, orderId) {
  if (!tableId) return null;
  const id = cleanText(tableId, 12);
  if (!/^[A-Za-z0-9-]{1,12}$/.test(id)) throw new HttpError(400, 'Invalid table');
  const busy = await db
    .prepare(`SELECT id FROM orders WHERE status = 'pending' AND table_id = ? AND id != ? LIMIT 1`)
    .bind(id, orderId || '')
    .first();
  if (busy) throw new HttpError(409, `Table ${id} already has an open check (${busy.id}).`);
  return id;
}

// Sold-out check for dishes the request adds (new lines or higher quantities only).
async function checkAdded(db, lines, prevLines = []) {
  const prevQty = new Map();
  for (const l of prevLines) prevQty.set(l.id, (prevQty.get(l.id) || 0) + l.qty);
  const nowQty = new Map();
  for (const l of lines) nowQty.set(l.id, (nowQty.get(l.id) || 0) + l.qty);
  const added = lines.filter((l) => nowQty.get(l.id) > (prevQty.get(l.id) || 0));
  await assertAvailable(db, added);
}

const nextOrderNumber = async (db) => {
  const row = await db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'order' RETURNING value").first();
  if (!row) throw new Error('counters table is missing the "order" row');
  return row.value;
};

/** POST /api/staff/orders with `lines`. Returns the stored row. */
export async function createStaffOrder(db, body) {
  const deliveryType = STAFF_TYPES.includes(body.delivery_type) ? body.delivery_type : 'pickup';
  const source = body.source === 'Phone' ? 'Phone' : 'Walk-in';
  const cust = customerFields(body, deliveryType);
  const tableId = deliveryType === 'dinein' ? await checkTable(db, body.table_id, null) : null;
  const groups = await listOptionGroups(db);
  const { lines } = priceLines(body.lines, groups);
  if (!lines.length) throw new HttpError(400, 'Add at least one item.');
  await checkAdded(db, lines);
  const orderDiscount = normalizeDiscount(body.discount);
  const deliveryPlace = staffPlace(body.delivery_place, cust.address);
  assertUnit(deliveryType, deliveryPlace, cust.address);
  const totals = staffTotals(lines, { deliveryType, deliveryPlace, orderDiscount });

  const comboMap = await loadComboMap(db);
  const at = nowIso();
  const id = `ORD-${await nextOrderNumber(db)}`;
  const kitchenNote = cleanText(body.kitchen_note, 300);
  const stored = withComponents(lines, comboMap);
  const items = body.send ? ticketItems(stored) : []; // marks the sent lines

  const { customerId, statements } = await prepareCustomerForOrder(db, {
    name: cust.name,
    email: '',
    phone: cust.phone,
    address: cust.address,
    at,
  });
  const guests = Math.floor(Number(body.guests)) || null;
  const batch = [
    ...statements,
    db
      .prepare(
        `INSERT INTO orders (id, source, status, delivery_type, customer_id, customer_name, customer_phone,
           delivery_address, delivery_time_slot, customer_notes, items_json, subtotal_cents, discount_cents,
           delivery_fee_cents, tax_cents, tip_cents, total_cents, payment_status, table_id, guests,
           staff_discount_json, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'in_store', ?, ?, ?, ?, ?)`
      )
      .bind(
        id, source, deliveryType, customerId, cust.name, cust.phone || null, cust.address || null,
        cleanText(body.delivery_time_slot, 60) || (deliveryType === 'delivery' ? 'ASAP' : deliveryType === 'pickup' ? 'Pick Up' : 'Dine-in'),
        cleanText(body.customer_notes, 500) || null,
        JSON.stringify(stored), totals.subtotal_cents, totals.discount_cents, totals.delivery_fee_cents,
        totals.tax_cents, totals.total_cents, tableId, guests,
        orderDiscount ? JSON.stringify(orderDiscount) : null, at, at
      ),
    ...afterOrderChange(db, { status: 'pending', payment_status: 'in_store', delivery_type: deliveryType,
      delivery_address: cust.address, created_at: at }, customerId),
  ];
  if (body.send) {
    const t = await ticketStatement(db, id, { items, voids: [], note: kitchenNote, hadTickets: false, at });
    if (t) batch.push(t);
  }
  await db.batch(batch);
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
}

async function loadOpenPosOrder(db, id) {
  const row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Order not found');
  if (!POS_SOURCES.includes(row.source)) throw new HttpError(409, 'Website and WooCommerce orders cannot be edited here.');
  if (row.status !== 'pending') throw new HttpError(409, 'This order is already closed.');
  return row;
}

export async function paidCents(db, orderId) {
  const r = await db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM order_payments WHERE order_id = ?').bind(orderId).first();
  return r?.paid || 0;
}

/**
 * PUT /api/staff/orders/:id: replace the lines / details of an open POS order.
 * body.send = true also sends every change to the kitchen.
 */
export async function updateStaffOrder(db, id, body) {
  const row = await loadOpenPosOrder(db, id);
  const deliveryType = STAFF_TYPES.includes(body.delivery_type) ? body.delivery_type : row.delivery_type;
  const cust = customerFields(
    {
      customer_name: body.customer_name ?? row.customer_name,
      customer_phone: body.customer_phone ?? row.customer_phone,
      delivery_address: body.delivery_address ?? row.delivery_address,
    },
    deliveryType
  );
  const tableId = deliveryType === 'dinein' ? await checkTable(db, body.table_id !== undefined ? body.table_id : row.table_id, id) : null;
  const prevLines = storedLines(row);
  const groups = await listOptionGroups(db);
  const { lines, voids } = body.lines ? priceLines(body.lines, groups, prevLines) : { lines: prevLines, voids: [] };
  if (!lines.length) throw new HttpError(400, 'An order needs at least one item. Cancel it instead.');
  if (body.lines) await checkAdded(db, lines, prevLines);
  const orderDiscount = body.discount !== undefined ? normalizeDiscount(body.discount) : parse(row.staff_discount_json, null);
  const deliveryPlace = staffPlace(body.delivery_place, cust.address);
  assertUnit(deliveryType, deliveryPlace, cust.address);
  const totals = staffTotals(lines, { deliveryType, deliveryPlace, orderDiscount });
  const paid = await paidCents(db, id);
  if (totals.total_cents < paid) {
    throw new HttpError(409, `$${(paid / 100).toFixed(2)} is already paid on this order, more than the new total. Refund the difference first.`);
  }

  const comboMap = await loadComboMap(db);
  const stored = withComponents(lines, comboMap);
  const pendingVoids = [...parse(row.pending_voids_json, []), ...voids];
  const at = nowIso();
  const batch = [];
  let ticket = null;
  if (body.send) {
    const items = ticketItems(stored);
    const had = await db.prepare('SELECT 1 FROM kitchen_tickets WHERE order_id = ? LIMIT 1').bind(id).first();
    ticket = await ticketStatement(db, id, {
      items, voids: pendingVoids, note: cleanText(body.kitchen_note, 300), hadTickets: Boolean(had), at,
    });
  }
  let customerId = row.customer_id;
  if (!customerId && cust.phone) {
    const prep = await prepareCustomerForOrder(db, { name: cust.name, email: '', phone: cust.phone, address: cust.address, at });
    customerId = prep.customerId;
    batch.push(...prep.statements);
  }
  batch.push(
    db
      .prepare(
        `UPDATE orders SET delivery_type = ?, customer_id = ?, customer_name = ?, customer_phone = ?, delivery_address = ?,
           customer_notes = ?, items_json = ?, subtotal_cents = ?, discount_cents = ?, delivery_fee_cents = ?,
           tax_cents = ?, total_cents = ?, table_id = ?, guests = ?, staff_discount_json = ?, pending_voids_json = ?,
           updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .bind(
        deliveryType, customerId, cust.name, cust.phone || null, cust.address || null,
        body.customer_notes !== undefined ? cleanText(body.customer_notes, 500) || null : row.customer_notes,
        JSON.stringify(stored), totals.subtotal_cents, totals.discount_cents, totals.delivery_fee_cents,
        totals.tax_cents, totals.total_cents, tableId,
        body.guests !== undefined ? Math.floor(Number(body.guests)) || null : row.guests,
        orderDiscount ? JSON.stringify(orderDiscount) : null,
        body.send || !pendingVoids.length ? null : JSON.stringify(pendingVoids),
        at, id
      )
  );
  if (ticket) batch.push(ticket);
  const updated = { ...row, delivery_type: deliveryType, delivery_address: cust.address, status: 'pending' };
  batch.push(...afterOrderChange(db, updated, customerId));
  await db.batch(batch);
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
}

/**
 * POST /api/staff/orders/:id/payments {method, amount, tendered?, label?, close?}
 * amount and tendered are dollars from the staff screen; stored as cents. A payment can
 * never exceed the balance. close = true completes the order once nothing is left to pay.
 */
export async function addPayment(db, id, body, staffEmail) {
  const row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Order not found');
  if (row.status === 'cancelled') throw new HttpError(409, 'This order was cancelled.');
  if (row.payment_status !== 'in_store') throw new HttpError(409, 'This order was paid online.');
  const method = ['cash', 'card', 'other'].includes(body.method) ? body.method : null;
  if (!method) throw new HttpError(400, 'Choose cash or card.');
  const balance = row.total_cents - (await paidCents(db, id));
  if (balance <= 0) throw new HttpError(409, 'Nothing left to pay on this order.');
  const amount = Math.min(toCents(body.amount), balance);
  if (!(amount > 0)) throw new HttpError(400, 'Enter an amount.');
  let tendered = null;
  let change = null;
  if (method === 'cash' && body.tendered != null && body.tendered !== '') {
    tendered = toCents(body.tendered);
    if (tendered < amount) throw new HttpError(400, 'Cash received is less than the amount.');
    change = tendered - amount;
  }
  const at = nowIso();
  const close = Boolean(body.close) && amount === balance;
  await db.batch([
    db
      .prepare(
        `INSERT INTO order_payments (order_id, method, amount_cents, tendered_cents, change_cents, label, staff_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, method, amount, tendered, change, cleanText(body.label, 40) || (amount === balance ? 'Full' : 'Partial'), staffEmail || null, at),
    db
      .prepare(
        `UPDATE orders SET updated_at = ?,
           status = CASE WHEN ? THEN 'completed' ELSE status END,
           closed_at = CASE WHEN ? THEN ? ELSE closed_at END
         WHERE id = ?`
      )
      .bind(at, close ? 1 : 0, close ? 1 : 0, at, id),
    ...(close ? [closeTicketsStatement(db, id, at)] : []),
  ]);
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
}

// ---------------------------------------------------------------------------
// Kitchen tickets
// ---------------------------------------------------------------------------

const TICKET_HISTORY_HOURS = 12;

export const toTicket = (r) => ({
  id: r.id,
  order_id: r.order_id,
  kind: r.kind,
  items: parse(r.items_json, []),
  voids: parse(r.voids_json, []),
  note: r.note || '',
  created_at: r.created_at,
  done_at: r.done_at,
  updated_at: r.updated_at,
});

// Open tickets plus the last few hours of done ones; with `since`, only tickets changed after it.
export async function listTickets(db, since = null) {
  const stmt = since
    ? db.prepare('SELECT * FROM kitchen_tickets WHERE updated_at > ? ORDER BY updated_at LIMIT 500').bind(new Date(since).toISOString())
    : db
        .prepare('SELECT * FROM kitchen_tickets WHERE done_at IS NULL OR created_at >= ? ORDER BY created_at LIMIT 500')
        .bind(new Date(Date.now() - TICKET_HISTORY_HOURS * 3600 * 1000).toISOString());
  const { results } = await stmt.all();
  return results.map(toTicket);
}

export async function setTicketDone(db, id, done) {
  const at = nowIso();
  const row = await db
    .prepare('UPDATE kitchen_tickets SET done_at = ?, updated_at = ? WHERE id = ? RETURNING *')
    .bind(done ? at : null, at, Number(id))
    .first();
  if (!row) throw new HttpError(404, 'Ticket not found');
  return toTicket(row);
}
