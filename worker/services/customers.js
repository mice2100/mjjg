// Customer CRM: identity linking (social sign-in) and progressive profiling from orders.

import { normalizeEmail, normalizePhone, nowIso, randomId } from '../lib/util.js';

export const publicProfile = (c) =>
  c && {
    id: c.id,
    name: c.name || '',
    email: c.email || '',
    phone: c.phone || '',
    default_address: c.default_address || '',
    marketing_opt_in: Boolean(c.marketing_opt_in),
  };

export const getCustomer = (db, id) => db.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();

/**
 * Called after a provider (Google/Apple/Facebook) has VERIFIED the user.
 * Links by (provider, sub) first, then by verified email, otherwise creates a customer.
 */
export async function upsertFromIdentity(db, { provider, providerUserId, email, emailVerified, name }) {
  const now = nowIso();
  const identity = await db
    .prepare('SELECT customer_id FROM customer_identities WHERE provider = ? AND provider_user_id = ?')
    .bind(provider, providerUserId)
    .first();

  let customerId = identity?.customer_id;
  if (!customerId && email && emailVerified) {
    const byEmail = await db.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first();
    customerId = byEmail?.id;
  }

  const stmts = [];
  if (customerId) {
    stmts.push(
      db
        .prepare(
          `UPDATE customers SET
             name = COALESCE(NULLIF(name, ''), ?),
             email = COALESCE(email, ?),
             email_verified = MAX(email_verified, ?),
             updated_at = ?
           WHERE id = ?`
        )
        .bind(name || null, email || null, emailVerified ? 1 : 0, now, customerId)
    );
  } else {
    customerId = randomId('cus_');
    stmts.push(
      db
        .prepare(
          `INSERT INTO customers (id, email, email_verified, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(customerId, email || null, emailVerified ? 1 : 0, name || null, now, now)
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO customer_identities (provider, provider_user_id, customer_id, email, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider, provider_user_id) DO UPDATE SET last_login_at = excluded.last_login_at,
           email = COALESCE(excluded.email, customer_identities.email)`
      )
      .bind(provider, providerUserId, customerId, email || null, now, now)
  );
  await db.batch(stmts);
  return getCustomer(db, customerId);
}

/**
 * Finds or creates the customer for an order and returns { customerId, statements }.
 * The statements must run in the same batch as (and before) the order INSERT/UPDATE.
 * Order stats are not touched here: append refreshCustomerStats() after the order write.
 *
 * - Signed-in customer: their profile is updated with the latest contact details.
 * - Guest matched by email/phone: only EMPTY fields are filled, so a guest typing
 *   someone else's email cannot overwrite that person's phone/address.
 */
export async function prepareCustomerForOrder(db, { sessionCustomerId, name, email, phone, address, marketingOptIn, at }) {
  let existing = null;
  if (sessionCustomerId) existing = await getCustomer(db, sessionCustomerId);
  if (!existing && email) existing = await db.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first();
  if (!existing && phone) {
    existing = await db
      .prepare('SELECT * FROM customers WHERE phone = ? ORDER BY last_order_at DESC LIMIT 1')
      .bind(phone)
      .first();
  }
  if (!existing && !email && !phone) return { customerId: null, statements: [] };

  const optIn = marketingOptIn ? 1 : 0;
  if (existing) {
    const trusted = existing.id === sessionCustomerId;
    const sql = trusted
      ? `UPDATE customers SET
           name = COALESCE(NULLIF(?, ''), name),
           email = COALESCE(email, NULLIF(?, '')),
           phone = COALESCE(NULLIF(?, ''), phone),
           default_address = COALESCE(NULLIF(?, ''), default_address),`
      : `UPDATE customers SET
           name = COALESCE(NULLIF(name, ''), NULLIF(?, '')),
           email = COALESCE(email, NULLIF(?, '')),
           phone = COALESCE(NULLIF(phone, ''), NULLIF(?, '')),
           default_address = COALESCE(NULLIF(default_address, ''), NULLIF(?, '')),`;
    const stmt = db
      .prepare(
        `${sql}
           marketing_opt_in = MAX(marketing_opt_in, ?),
           marketing_opt_in_at = CASE WHEN ? = 1 AND marketing_opt_in = 0 THEN ? ELSE marketing_opt_in_at END,
           updated_at = ?
         WHERE id = ?`
      )
      .bind(name || '', email || '', phone || '', address || '', optIn, optIn, at, at, existing.id);
    return { customerId: existing.id, statements: [stmt] };
  }

  const customerId = randomId('cus_');
  const stmt = db
    .prepare(
      `INSERT INTO customers (id, email, name, phone, default_address, marketing_opt_in, marketing_opt_in_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(customerId, email || null, name || null, phone || null, address || null, optIn, optIn ? at : null, at, at);
  return { customerId, statements: [stmt] };
}

// An order counts toward a customer's stats and saved addresses once it is real:
// collected in store or paid online, and not cancelled.
const COUNTED = "status != 'cancelled' AND payment_status IN ('in_store', 'paid')";
const countsAsOrder = (row) => row.status !== 'cancelled' && ['in_store', 'paid'].includes(row.payment_status || 'in_store');

/**
 * Recomputes a customer's order stats from their own orders (idx_orders_customer_created),
 * so cancellations, late payments and re-imports can never leave them out of step.
 * Put it after the order write in the same batch.
 */
export const refreshCustomerStats = (db, customerId) =>
  db
    .prepare(
      `UPDATE customers SET (order_count, total_spent_cents, first_order_at, last_order_at) =
         (SELECT COUNT(*), COALESCE(SUM(total_cents), 0), MIN(created_at), MAX(created_at)
            FROM orders WHERE customer_id = ?1 AND ${COUNTED}),
         updated_at = ?2
       WHERE id = ?1`
    )
    .bind(customerId, nowIso());

// Addresses compare equal regardless of case, spacing and punctuation around commas.
export const addressKey = (a) => String(a || '').toLowerCase().replace(/[\s,.]+/g, ' ').trim();

/** Saves a delivery address on the customer (idempotent; keeps the newest spelling and time). */
export function rememberAddress(db, customerId, address, usedAt) {
  const key = addressKey(address);
  if (!customerId || !key) return null;
  return db
    .prepare(
      `INSERT INTO customer_addresses (customer_id, address_key, address, last_used_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (customer_id, address_key) DO UPDATE SET
         address = CASE WHEN excluded.last_used_at >= customer_addresses.last_used_at
                        THEN excluded.address ELSE customer_addresses.address END,
         last_used_at = MAX(customer_addresses.last_used_at, excluded.last_used_at)`
    )
    .bind(customerId, key, String(address).trim(), usedAt, nowIso());
}

/**
 * Statements that bring a customer up to date after one of their orders changed:
 * the order's delivery address (when the order counts) and the stats.
 */
export function afterOrderChange(db, row, customerId = row.customer_id) {
  if (!customerId) return [];
  const stmts = [];
  if (row.delivery_type === 'delivery' && countsAsOrder(row)) {
    const addr = rememberAddress(db, customerId, row.delivery_address, row.created_at);
    if (addr) stmts.push(addr);
  }
  stmts.push(refreshCustomerStats(db, customerId));
  return stmts;
}

/**
 * Links an order that has no customer yet (WooCommerce imports, older orders) to the
 * customer with the same email or phone, creating one when needed. Guest rules apply:
 * an existing customer's details are only filled in, never overwritten.
 * Returns the customer id, or null when the order has neither phone nor email.
 */
export async function linkOrderCustomer(db, row, { refreshStats = true } = {}) {
  let customerId = row.customer_id;
  const stmts = [];
  if (!customerId) {
    const phone = normalizePhone(row.customer_phone);
    const prep = await prepareCustomerForOrder(db, {
      name: row.customer_name === 'Web Customer' ? '' : row.customer_name,
      email: normalizeEmail(row.customer_email),
      phone: phone.length === 10 ? phone : '',
      address: row.delivery_type === 'delivery' && countsAsOrder(row) ? row.delivery_address : '',
      at: nowIso(),
    });
    if (!prep.customerId) return null;
    customerId = prep.customerId;
    stmts.push(
      ...prep.statements,
      db.prepare('UPDATE orders SET customer_id = ? WHERE id = ? AND customer_id IS NULL').bind(customerId, row.id)
    );
  }
  const after = afterOrderChange(db, row, customerId);
  stmts.push(...(refreshStats ? after : after.slice(0, -1)));
  if (stmts.length) await db.batch(stmts);
  return customerId;
}

const BACKFILL_KEY = 'customer_backfill_cursor';

/**
 * One-time job run by the cron until it reports done: walks every order, newest first,
 * links it to a customer, saves its delivery address, then refreshes the stats of the
 * customers it touched. Newest first so a customer's freshest name fills their profile.
 * Small batches keep each cron run well inside the Workers subrequest limit.
 */
export async function backfillCustomers(db, { limit = 40 } = {}) {
  const state = await db.prepare('SELECT value FROM sync_state WHERE key = ?').bind(BACKFILL_KEY).first();
  if (state?.value === 'done') return { done: true, processed: 0 };
  const [beforeAt, beforeId] = state?.value ? JSON.parse(state.value) : ['9999', ''];
  const { results } = await db
    .prepare(
      `SELECT * FROM orders WHERE created_at < ?1 OR (created_at = ?1 AND id < ?2)
       ORDER BY created_at DESC, id DESC LIMIT ?3`
    )
    .bind(beforeAt, beforeId, limit)
    .all();

  const touched = new Set();
  for (const row of results) {
    const id = await linkOrderCustomer(db, row, { refreshStats: false });
    if (id) touched.add(id);
  }
  const last = results.at(-1);
  const value = results.length < limit ? 'done' : JSON.stringify([last.created_at, last.id]);
  await db.batch([
    ...[...touched].map((id) => refreshCustomerStats(db, id)),
    db
      .prepare(
        `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(BACKFILL_KEY, value, nowIso()),
  ]);
  return { done: value === 'done', processed: results.length, customers: touched.size };
}

const VISIBLE = "payment_status NOT IN ('awaiting', 'expired')";

/**
 * Staff POS lookup by phone (digits only, 10 long). Every query is an index seek, so it
 * stays fast however many orders pile up: customers by phone (idx_customers_phone), their
 * newest orders (idx_orders_customer_created), their saved addresses (primary key), and the
 * stats already stored on the customer row. Several customers can share a phone (for
 * example two web accounts); their history is shown together.
 */
export async function lookupCustomerByPhone(db, phone, { orderLimit = 50 } = {}) {
  const { results: customers } = await db
    .prepare('SELECT * FROM customers WHERE phone = ? ORDER BY last_order_at DESC LIMIT 5')
    .bind(phone)
    .all();
  const ids = customers.map((c) => c.id);
  const marks = ids.map(() => '?').join(', ');

  let orders;
  let addresses = [];
  if (ids.length) {
    ({ results: orders } = await db
      .prepare(`SELECT * FROM orders WHERE customer_id IN (${marks}) AND ${VISIBLE} ORDER BY created_at DESC LIMIT ?`)
      .bind(...ids, orderLimit)
      .all());
    const { results } = await db
      .prepare(`SELECT address FROM customer_addresses WHERE customer_id IN (${marks}) ORDER BY last_used_at DESC LIMIT 10`)
      .bind(...ids)
      .all();
    addresses = results.map((r) => r.address);
  } else {
    // Orders not linked to a customer yet (before the backfill finishes).
    ({ results: orders } = await db
      .prepare(`SELECT * FROM orders WHERE customer_phone = ? AND ${VISIBLE} ORDER BY created_at DESC LIMIT ?`)
      .bind(phone, orderLimit)
      .all());
    for (const o of orders) if (o.delivery_type === 'delivery' && o.status !== 'cancelled') addresses.push(o.delivery_address);
  }

  const seen = new Set();
  const unique = [];
  for (const a of [...addresses, ...customers.map((c) => c.default_address)]) {
    const key = addressKey(a);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(String(a).trim());
  }

  const counted = orders.filter(countsAsOrder);
  const stats = customers.length
    ? {
        order_count: customers.reduce((s, c) => s + c.order_count, 0),
        total_spent_cents: customers.reduce((s, c) => s + c.total_spent_cents, 0),
        first_order_at: customers.map((c) => c.first_order_at).filter(Boolean).sort()[0] || null,
      }
    : {
        order_count: counted.length,
        total_spent_cents: counted.reduce((s, o) => s + o.total_cents, 0),
        first_order_at: counted.at(-1)?.created_at || null,
      };

  const customer = customers[0] || null;
  return {
    customer,
    orders,
    addresses: unique.slice(0, 10),
    stats,
    name: customer?.name || orders.find((o) => o.customer_name)?.customer_name || '',
    email: customer?.email || orders.find((o) => o.customer_email)?.customer_email || '',
    notes: customers.map((c) => c.notes).filter(Boolean).join('\n'),
    last_delivery_type: orders[0]?.delivery_type || null,
  };
}
