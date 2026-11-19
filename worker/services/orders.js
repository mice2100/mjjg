// Order creation (website + staff POS) and the staff-facing order shape.

import { HttpError } from '../lib/http.js';
import { cleanText, formatLocalDate, formatLocalTime, normalizeEmail, normalizePhone, nowIso, randomId, toDollars } from '../lib/util.js';
import { buildQuote } from './pricing.js';
import { afterOrderChange, prepareCustomerForOrder } from './customers.js';
import { findPaidOrders, isCloverConfigured } from './clover.js';
import { loadComboMap, withComponents } from './combos.js';

const formatPhone = (digits) =>
  /^\d{10}$/.test(digits || '') ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits || '';

const ID_PREFIX = { Web: 'WEB', Phone: 'ORD', 'Walk-in': 'ORD' };

async function nextOrderNumber(db) {
  const row = await db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'order' RETURNING value").first();
  if (!row) throw new Error('counters table is missing the "order" row');
  return row.value;
}

/**
 * input: raw request body. ctx: { source: 'Web'|'Phone'|'Walk-in', sessionCustomerId?, payOnline? }
 * Website orders require name + phone + email; staff orders require name + phone.
 * payOnline: the order waits for the Clover webhook (payment_status 'awaiting') and stays
 * off the kitchen board until paid. Only website orders take a tip.
 */
export async function createOrder(db, input, ctx) {
  const source = ctx.source;
  const name = cleanText(input.customer_name, 100);
  const phone = normalizePhone(input.customer_phone);
  const email = normalizeEmail(input.customer_email);
  const deliveryType = input.delivery_type;
  const address = cleanText(input.delivery_address, 300);

  if (!name) throw new HttpError(400, 'Please enter your name.');
  if (phone.length < 10) throw new HttpError(400, 'Please enter a valid 10-digit phone number.');
  if (source === 'Web' && !email) throw new HttpError(400, 'Please enter a valid email address.');
  if (source === 'Web' && !['pickup', 'delivery'].includes(deliveryType)) {
    throw new HttpError(400, 'Please choose pickup or delivery.');
  }
  if (deliveryType === 'delivery' && !address) throw new HttpError(400, 'Please enter a delivery address.');

  const payOnline = Boolean(ctx.payOnline);
  // A customer who left the Clover page and checks out again: drop their earlier unpaid
  // attempt first so it does not hold their coupon ("once per customer", "first order").
  if (payOnline && email) {
    await expireUnpaidOrders(db, "customer_email = ? AND customer_phone = ?", [email, phone]);
  }

  const quote = await buildQuote(db, {
    items: input.items,
    deliveryType,
    couponCode: input.coupon_code,
    source,
    email,
    phone,
    signedIn: Boolean(ctx.sessionCustomerId),
    strict: true,
    tip: source === 'Web' ? input.tip : 'none',
  });

  // Snapshot combo contents on the order so the kitchen sees them even if the combo changes later.
  const items = withComponents(quote.items, await loadComboMap(db));

  const at = nowIso();
  const orderNumber = await nextOrderNumber(db);
  const id = `${ID_PREFIX[source] || 'ORD'}-${orderNumber}`;

  const { customerId, statements } = await prepareCustomerForOrder(db, {
    sessionCustomerId: ctx.sessionCustomerId,
    name,
    email,
    phone,
    address: deliveryType === 'delivery' ? address : '',
    marketingOptIn: Boolean(input.marketing_opt_in),
    at,
  });
  const paymentStatus = payOnline ? 'awaiting' : 'in_store';
  const publicToken = source === 'Web' ? randomId('') : null;

  const defaultSlot = deliveryType === 'pickup' ? 'Pick Up' : 'ASAP';
  const batch = [
    ...statements,
    db
      .prepare(
        `INSERT INTO orders (id, source, status, delivery_type, customer_id, customer_name, customer_phone, customer_email,
           delivery_address, delivery_time_slot, customer_notes, items_json, subtotal_cents, discount_cents,
           delivery_fee_cents, tax_cents, tip_cents, tip_choice, total_cents, coupon_code, payment_status, public_token,
           created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, source, quote.delivery_type, customerId, name, phone, email || null,
        quote.delivery_type === 'delivery' ? address : null,
        cleanText(input.delivery_time_slot, 60) || defaultSlot,
        cleanText(input.customer_notes, 500) || null,
        JSON.stringify(items),
        quote.subtotal_cents, quote.discount_cents, quote.delivery_fee_cents, quote.tax_cents,
        quote.tip_cents, source === 'Web' ? quote.tip_choice : null, quote.total_cents,
        quote.coupon?.code || null, paymentStatus, publicToken, at, at
      ),
  ];
  // Online orders join the customer's stats and saved addresses once paid (markOrderPaid).
  if (!payOnline) {
    batch.push(...afterOrderChange(db, {
      status: 'pending', payment_status: paymentStatus, delivery_type: quote.delivery_type,
      delivery_address: address, created_at: at,
    }, customerId));
  }
  if (quote.coupon) {
    batch.push(
      db
        .prepare(
          `INSERT INTO coupon_redemptions (coupon_code, order_id, customer_id, customer_email, customer_phone, discount_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(quote.coupon.code, id, customerId, email || null, phone, quote.discount_cents, at)
    );
  }
  await db.batch(batch);

  return {
    id, created_at: at, payment_status: paymentStatus, public_token: publicToken,
    customer_name: name, customer_email: email, customer_phone: phone, ...quote,
  };
}

/**
 * Cancels unpaid online orders matching `where` and releases their coupon redemptions.
 * Used when a customer retries checkout, when Clover cannot start a payment, and by the
 * cron sweep for abandoned checkouts. A late payment still revives the order (markOrderPaid).
 */
export async function expireUnpaidOrders(db, where, params = []) {
  const match = `SELECT id FROM orders WHERE payment_status = 'awaiting' AND (${where})`;
  const results = await db.batch([
    db.prepare(`DELETE FROM coupon_redemptions WHERE order_id IN (${match})`).bind(...params),
    db
      .prepare(
        `UPDATE orders SET status = 'cancelled', payment_status = 'expired', updated_at = ?
         WHERE payment_status = 'awaiting' AND (${where})`
      )
      .bind(nowIso(), ...params),
  ]);
  return results[1].meta?.changes ?? 0;
}

/**
 * Backup for a lost Clover webhook: marks awaiting orders paid when Clover's payment list
 * shows a successful payment for exactly the order total. Pass an order id to check just one.
 * Returns the orders it marked paid.
 */
export async function reconcileCloverPayments(env, { id = null, fetchImpl } = {}) {
  if (!isCloverConfigured(env)) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, total_cents, checkout_session_id, created_at FROM orders
     WHERE payment_status = 'awaiting' AND checkout_session_id IS NOT NULL AND (? IS NULL OR id = ?)`
  )
    .bind(id, id)
    .all();
  if (!results.length) return [];

  // Clover's clock may differ a little from ours; look back a minute before the oldest order.
  const since = Math.min(...results.map((r) => Date.parse(r.created_at))) - 60 * 1000;
  const paid = await findPaidOrders(env, since, fetchImpl);
  const marked = [];
  for (const row of results) {
    const payment = paid.get(row.id);
    if (!payment) continue;
    if (payment.amountCents !== row.total_cents) {
      console.error('Clover payment amount mismatch:', row.id, payment.amountCents, row.total_cents);
      continue;
    }
    const order = await markOrderPaid(env.DB, { checkoutSessionId: row.checkout_session_id, paymentId: payment.paymentId });
    if (order) marked.push(order);
  }
  return marked;
}

// Clover checkout sessions last 15 minutes; give the webhook generous slack before expiring.
export const expireAbandonedCheckouts = (db, minutes = 60) =>
  expireUnpaidOrders(db, 'created_at < ?', [new Date(Date.now() - minutes * 60 * 1000).toISOString()]);

export async function setCheckoutSession(db, id, checkoutSessionId) {
  await db.prepare('UPDATE orders SET checkout_session_id = ?, updated_at = ? WHERE id = ?').bind(checkoutSessionId, nowIso(), id).run();
}

/**
 * Clover confirmed the payment. Idempotent (webhooks can repeat). An order that expired
 * while the customer was still paying comes back to the kitchen: the money is in.
 */
export async function markOrderPaid(db, { checkoutSessionId, paymentId }) {
  const at = nowIso();
  const row = await db
    .prepare(
      `UPDATE orders SET
         status = CASE WHEN payment_status = 'expired' THEN 'pending' ELSE status END,
         payment_status = 'paid', payment_id = ?, paid_at = ?, updated_at = ?
       WHERE checkout_session_id = ? AND payment_status IN ('awaiting', 'expired')
       RETURNING *`
    )
    .bind(paymentId, at, at, checkoutSessionId)
    .first();
  if (!row) return null;

  const stmts = afterOrderChange(db, row);
  if (row.coupon_code) {
    // Re-reserve the coupon if an expiry released it.
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO coupon_redemptions (coupon_code, order_id, customer_id, customer_email, customer_phone, discount_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(row.coupon_code, row.id, row.customer_id, row.customer_email, row.customer_phone, row.discount_cents, at)
    );
  }
  if (stmts.length) await db.batch(stmts);
  return row;
}

// What the customer's browser may see about its own order (needs the order's public token).
export async function getPublicOrderStatus(db, id, token) {
  if (!token) throw new HttpError(404, 'Order not found');
  const row = await db.prepare('SELECT * FROM orders WHERE id = ? AND public_token = ?').bind(id, String(token)).first();
  if (!row) throw new HttpError(404, 'Order not found');
  return {
    id: row.id,
    status: row.status,
    payment_status: row.payment_status,
    delivery_type: row.delivery_type,
    total_cents: row.total_cents,
    tip_cents: row.tip_cents,
  };
}

// Shape consumed by the staff app (web/public/staff/index.html). Dollars, not cents.
export function toStaffOrder(row) {
  let items = [];
  try {
    items = JSON.parse(row.items_json);
  } catch {
    /* keep empty */
  }
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    delivery_type: row.delivery_type,
    customer_name: row.customer_name || '',
    customer_phone: formatPhone(row.customer_phone),
    customer_email: row.customer_email || '',
    delivery_address: row.delivery_address || '',
    delivery_time_slot: row.delivery_time_slot || '',
    customer_notes: row.customer_notes || '',
    items: items.map((it) => ({
      id: it.id ?? null, // menu id; null for WooCommerce imports
      code: it.code || '',
      name: it.free ? `${it.name} (FREE)` : it.name,
      price: toDollars(it.price_cents),
      qty: it.qty,
      free: Boolean(it.free),
      components: (it.components || []).map((c) => ({ name: c.name, qty: c.qty })),
    })),
    subtotal: toDollars(row.subtotal_cents),
    discount: toDollars(row.discount_cents),
    coupon_code: row.coupon_code || '',
    delivery_fee: toDollars(row.delivery_fee_cents),
    tip: toDollars(row.tip_cents),
    payment_status: row.payment_status || 'in_store',
    tax: toDollars(row.tax_cents),
    total: toDollars(row.total_cents),
    created_at: row.created_at,
    updated_at: row.updated_at,
    time: formatLocalTime(row.created_at),
    date: formatLocalDate(row.created_at),
  };
}

// Kitchen board: everything still pending plus the last week of history,
// so staff can look up recent completed orders under "All" / "Completed".
const STAFF_HISTORY_DAYS = 7;

export async function listStaffOrders(db) {
  const since = new Date(Date.now() - STAFF_HISTORY_DAYS * 24 * 3600 * 1000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT * FROM orders
       WHERE payment_status NOT IN ('awaiting', 'expired') AND (status = 'pending' OR created_at >= ?)
       ORDER BY created_at DESC LIMIT 1000`
    )
    .bind(since)
    .all();
  return results.map(toStaffOrder);
}

/**
 * Kitchen board delta: visible orders created or changed after `since` (idx_orders_updated).
 * Every write to an order sets updated_at to the server's time, including WooCommerce
 * imports, so a poll that asks a little before its previous server_time misses nothing.
 */
export async function listStaffOrderChanges(db, since) {
  const { results } = await db
    .prepare(
      `SELECT * FROM orders WHERE updated_at > ? AND payment_status NOT IN ('awaiting', 'expired')
       ORDER BY updated_at LIMIT 500`
    )
    .bind(new Date(since).toISOString())
    .all();
  return results.map(toStaffOrder);
}

export async function setOrderStatus(db, id, status) {
  if (!['pending', 'completed', 'cancelled'].includes(status)) throw new HttpError(400, 'Invalid status');
  const row = await db
    .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? RETURNING *')
    .bind(status, nowIso(), id)
    .first();
  if (!row) throw new HttpError(404, 'Order not found');
  const stmts = afterOrderChange(db, row); // a cancellation leaves the customer's stats
  if (stmts.length) await db.batch(stmts);
  return toStaffOrder(row);
}
