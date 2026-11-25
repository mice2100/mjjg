// Staff API (POS + kitchen board). Every handler here is wrapped by requireStaff in index.js;
// handlers registered with { admin: true } also pass isStaffAdmin.

import { HttpError, json, readJson } from '../lib/http.js';
import { normalizePhone, toDollars } from '../lib/util.js';
import { createOrder, listStaffOrderChanges, listStaffOrders, markReceived, setOrderStatus, toStaffOrder, withPayments } from '../services/orders.js';
import { addPayment, createStaffOrder, listTickets, setTicketDone, updateStaffOrder } from '../services/staffOrders.js';
import { deleteOptionGroup, listOptionGroups, listSoldOut, saveOptionGroup, setSoldOut } from '../services/options.js';
import { lookupCustomerByPhone } from '../services/customers.js';
import { listCombos, saveCombo } from '../services/combos.js';
import { isStaffAdmin } from '../auth/staff.js';

// GET /api/staff/orders            → the kitchen board (pending + last 7 days) and kitchen tickets
// GET /api/staff/orders?since=<iso> → only orders and tickets created or changed after that time
export async function getOrders(request, env) {
  const serverTime = new Date().toISOString();
  const since = new URL(request.url).searchParams.get('since');
  if (since) {
    if (Number.isNaN(Date.parse(since))) throw new HttpError(400, 'Invalid since');
    const [orders, tickets, soldOut] = await Promise.all([
      listStaffOrderChanges(env.DB, since), listTickets(env.DB, since), listSoldOut(env.DB),
    ]);
    return json({ success: true, changes: true, orders, tickets, sold_out: soldOut, server_time: serverTime });
  }
  const [orders, tickets, soldOut] = await Promise.all([listStaffOrders(env.DB), listTickets(env.DB), listSoldOut(env.DB)]);
  return json({ success: true, orders, tickets, sold_out: soldOut, server_time: serverTime });
}

const staffOrder = async (env, row) => (await withPayments(env.DB, [row]))[0];

// Body with `lines` → POS order (options, staff discounts, dine-in, kitchen tickets).
// Body with `items` → the older phone-order shape, still used by /staff/classic/.
export async function postOrder(request, env) {
  const body = await readJson(request);
  if (Array.isArray(body.lines)) {
    return json({ success: true, order: await staffOrder(env, await createStaffOrder(env.DB, body)) }, { status: 201 });
  }
  const source = body.source === 'Walk-in' ? 'Walk-in' : 'Phone';
  const order = await createOrder(env.DB, body, { source });
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
  return json({ success: true, order: toStaffOrder(row) }, { status: 201 });
}

export async function putOrder(request, env, { id }) {
  const body = await readJson(request);
  return json({ success: true, order: await staffOrder(env, await updateStaffOrder(env.DB, id, body)) });
}

// {status} changes the kitchen status; {received:true} acknowledges a new online order.
export async function patchOrder(request, env, { id }) {
  const body = await readJson(request);
  if (body.received === true && body.status === undefined) return json({ success: true, order: await markReceived(env.DB, id) });
  return json({ success: true, order: await setOrderStatus(env.DB, id, body.status) });
}

export async function postPayment(request, env, { id }, staff) {
  const body = await readJson(request);
  return json({ success: true, order: await staffOrder(env, await addPayment(env.DB, id, body, staff?.email)) });
}

export async function patchTicket(request, env, { id }) {
  const body = await readJson(request);
  return json({ success: true, ticket: await setTicketDone(env.DB, id, Boolean(body.done)) });
}

// Item options and sold-out switches (Menu tab).
export async function getMenuSettings(request, env, params, staff) {
  const [groups, soldOut] = await Promise.all([listOptionGroups(env.DB), listSoldOut(env.DB)]);
  return json({ success: true, groups, sold_out: soldOut, can_edit: isStaffAdmin(env, staff) });
}

export async function putOptionGroup(request, env, { id }, staff) {
  const body = await readJson(request);
  return json({ success: true, group: await saveOptionGroup(env.DB, id, body, staff?.email) });
}

export async function removeOptionGroup(request, env, { id }) {
  await deleteOptionGroup(env.DB, id);
  return json({ success: true });
}

export async function putAvailability(request, env, { id }, staff) {
  const body = await readJson(request);
  return json({ success: true, ...(await setSoldOut(env.DB, id, Boolean(body.sold_out), staff?.email)) });
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
    orders: r.orders.map((o) => toStaffOrder(o)),
  });
}

export async function getCombos(request, env, params, staff) {
  return json({ success: true, combos: await listCombos(env.DB), can_edit: isStaffAdmin(env, staff) });
}

export async function putCombo(request, env, { id }, staff) {
  const body = await readJson(request);
  return json({ success: true, combo: await saveCombo(env.DB, id, body.components, staff?.email) });
}
