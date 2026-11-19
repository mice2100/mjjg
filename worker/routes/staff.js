// Staff API (POS + kitchen board). Every handler here is wrapped by requireStaff in index.js;
// handlers registered with { admin: true } also pass isStaffAdmin.

import { HttpError, json, readJson } from '../lib/http.js';
import { normalizePhone, toDollars } from '../lib/util.js';
import { createOrder, listStaffOrderChanges, listStaffOrders, setOrderStatus, toStaffOrder } from '../services/orders.js';
import { lookupCustomerByPhone } from '../services/customers.js';
import { listCombos, saveCombo } from '../services/combos.js';
import { isStaffAdmin } from '../auth/staff.js';

// GET /api/staff/orders            → the kitchen board (pending + last 7 days)
// GET /api/staff/orders?since=<iso> → only orders created or changed after that time
export async function getOrders(request, env) {
  const serverTime = new Date().toISOString();
  const since = new URL(request.url).searchParams.get('since');
  if (since) {
    if (Number.isNaN(Date.parse(since))) throw new HttpError(400, 'Invalid since');
    return json({ success: true, changes: true, orders: await listStaffOrderChanges(env.DB, since), server_time: serverTime });
  }
  return json({ success: true, orders: await listStaffOrders(env.DB), server_time: serverTime });
}

export async function postOrder(request, env) {
  const body = await readJson(request);
  const source = body.source === 'Walk-in' ? 'Walk-in' : 'Phone';
  const order = await createOrder(env.DB, body, { source });
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
  return json({ success: true, order: toStaffOrder(row) }, { status: 201 });
}

export async function patchOrder(request, env, { id }) {
  const body = await readJson(request);
  return json({ success: true, order: await setOrderStatus(env.DB, id, body.status) });
}

// GET /api/staff/customers/lookup?phone=306-555-1234 → known customer, addresses, order history
export async function getCustomerLookup(request, env) {
  const phone = normalizePhone(new URL(request.url).searchParams.get('phone'));
  if (phone.length !== 10) throw new HttpError(400, 'Enter a 10-digit phone number.');
  const r = await lookupCustomerByPhone(env.DB, phone);
  return json({
    success: true,
    phone,
    found: Boolean(r.customer || r.orders.length),
    name: r.name,
    email: r.email,
    notes: r.notes,
    addresses: r.addresses,
    last_delivery_type: r.last_delivery_type,
    stats: {
      order_count: r.stats.order_count,
      total_spent: toDollars(r.stats.total_spent_cents),
      first_order_at: r.stats.first_order_at,
    },
    orders: r.orders.map(toStaffOrder),
  });
}

export async function getCombos(request, env, params, staff) {
  return json({ success: true, combos: await listCombos(env.DB), can_edit: isStaffAdmin(env, staff) });
}

export async function putCombo(request, env, { id }, staff) {
  const body = await readJson(request);
  return json({ success: true, combo: await saveCombo(env.DB, id, body.components, staff?.email) });
}
