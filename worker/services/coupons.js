// Coupon engine.
//
// A coupon is one row in the `coupons` table (see migrations/0001_init.sql).
// Launching a promotion = INSERT a row; retiring it = set is_active = 0 or ends_at.
// Only add code here when a promotion needs a rule that cannot be expressed with
// the existing columns + CONDITION_CHECKS below.

import { localParts } from '../lib/util.js';
import { getMenuItem, priceCents } from '../lib/menu.js';

// Extra rules stored in coupons.conditions_json. Each key maps to a check that
// returns an error message (string) when the condition is NOT met, or null.
// Unknown keys make the coupon invalid (fail closed) so typos are noticed.
const CONDITION_CHECKS = {
  // [0..6], 0 = Sunday, evaluated in Moose Jaw local time.
  days_of_week: (value, ctx) =>
    value.includes(localParts(ctx.now).dayOfWeek) ? null : 'This code is not valid today.',

  // {"from": "11:00", "to": "14:00"} local time, inclusive start, exclusive end.
  hours: (value, ctx) => {
    const { hhmm } = localParts(ctx.now);
    return hhmm >= value.from && hhmm < value.to ? null : `This code is valid ${value.from}–${value.to} only.`;
  },

  // ["pickup"] or ["delivery"]
  delivery_types: (value, ctx) =>
    value.includes(ctx.deliveryType) ? null : `This code is only valid for ${value.join(' / ')} orders.`,

  // Cart must contain at least one of these menu item ids.
  required_item_ids: (value, ctx) =>
    ctx.items.some((line) => value.includes(line.id)) ? null : 'Add a qualifying dish to use this code.',
};

/**
 * Pure evaluation of a coupon against an order context.
 *
 * ctx = {
 *   now: Date, source: 'Web'|'Phone'|'Walk-in', deliveryType,
 *   items: [{id, qty, price_cents}], subtotalCents, deliveryFeeCents,
 *   signedIn: boolean,
 *   strict: boolean,              // true at order submit; false for a cart preview
 *   stats: { totalRedemptions, customerRedemptions, hasPreviousOrder } // null fields = unknown yet
 * }
 * Returns { ok: true, discountCents, freeItem? , pending?: string } or { ok: false, message }.
 */
export function evaluateCoupon(coupon, ctx) {
  const fail = (message) => ({ ok: false, message });

  if (!coupon || !coupon.is_active) return fail('This code is not valid.');

  const now = ctx.now.toISOString();
  if (coupon.starts_at && now < coupon.starts_at) return fail('This code is not active yet.');
  if (coupon.ends_at && now >= coupon.ends_at) return fail('This code has expired.');

  const channels = String(coupon.channels || 'Web').split(',').map((s) => s.trim());
  if (!channels.includes(ctx.source)) return fail('This code cannot be used for this order.');

  if (ctx.subtotalCents < coupon.min_subtotal_cents) {
    return fail(`Minimum order for this code is $${(coupon.min_subtotal_cents / 100).toFixed(2)}.`);
  }

  if (coupon.requires_account && !ctx.signedIn) return fail('Please sign in to use this code.');

  let conditions = {};
  if (coupon.conditions_json) {
    try {
      conditions = JSON.parse(coupon.conditions_json);
    } catch {
      console.error(`Coupon ${coupon.code}: invalid conditions_json`);
      return fail('This code is not valid.');
    }
  }
  for (const [key, value] of Object.entries(conditions)) {
    const check = CONDITION_CHECKS[key];
    if (!check) {
      console.error(`Coupon ${coupon.code}: unknown condition "${key}"`);
      return fail('This code is not valid.');
    }
    const message = check(value, ctx);
    if (message) return fail(message);
  }

  const { stats } = ctx;
  if (coupon.max_redemptions != null && stats.totalRedemptions >= coupon.max_redemptions) {
    return fail('This code has been fully redeemed.');
  }

  // Per-customer rules need the customer's email/phone. In a cart preview they may be
  // unknown yet; the order endpoint re-evaluates with strict = true.
  let pending = null;
  const needsIdentity = coupon.first_order_only || coupon.max_per_customer != null;
  if (needsIdentity && stats.hasPreviousOrder == null) {
    if (ctx.strict) return fail('Enter your email and phone to use this code.');
    pending = 'Eligibility will be confirmed at checkout.';
  } else {
    if (coupon.first_order_only && stats.hasPreviousOrder) {
      return fail('This code is for first-time customers only.');
    }
    if (coupon.max_per_customer != null && stats.customerRedemptions >= coupon.max_per_customer) {
      return fail('You have already used this code.');
    }
  }

  let discountCents = 0;
  let freeItem = null;
  switch (coupon.discount_type) {
    case 'percent':
      discountCents = Math.round((ctx.subtotalCents * coupon.discount_value) / 100);
      if (coupon.max_discount_cents != null) discountCents = Math.min(discountCents, coupon.max_discount_cents);
      break;
    case 'fixed':
      discountCents = Math.min(coupon.discount_value, ctx.subtotalCents);
      break;
    case 'free_delivery':
      if (ctx.deliveryType !== 'delivery') return fail('This code is for delivery orders only.');
      discountCents = ctx.deliveryFeeCents;
      break;
    case 'free_item': {
      const item = getMenuItem(coupon.free_item_id);
      if (!item) {
        console.error(`Coupon ${coupon.code}: free_item_id ${coupon.free_item_id} not on menu`);
        return fail('This code is not valid.');
      }
      freeItem = { id: item.id, code: item.code, name: item.name, price_cents: priceCents(item), qty: 1 };
      discountCents = freeItem.price_cents;
      break;
    }
    default:
      return fail('This code is not valid.');
  }

  return { ok: true, discountCents, freeItem, pending };
}

export async function findCoupon(db, code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return db.prepare('SELECT * FROM coupons WHERE code = ?').bind(clean).first();
}

// Loads the redemption / order-history numbers evaluateCoupon needs.
export async function loadCouponStats(db, coupon, { email, phone }) {
  const stats = { totalRedemptions: 0, customerRedemptions: null, hasPreviousOrder: null };

  if (coupon.max_redemptions != null) {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_code = ?')
      .bind(coupon.code)
      .first();
    stats.totalRedemptions = row?.n ?? 0;
  }

  if (!email && !phone) return stats;
  // Match on either identifier so a customer cannot reuse a code by changing one of them.
  const e = email || '\u0000';
  const p = phone || '\u0000';

  if (coupon.max_per_customer != null) {
    const row = await db
      .prepare(
        'SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_code = ? AND (customer_email = ? OR customer_phone = ?)'
      )
      .bind(coupon.code, e, p)
      .first();
    stats.customerRedemptions = row?.n ?? 0;
  }

  const prev = await db
    .prepare("SELECT 1 FROM orders WHERE (customer_email = ? OR customer_phone = ?) AND status != 'cancelled' LIMIT 1")
    .bind(e, p)
    .first();
  stats.hasPreviousOrder = Boolean(prev);
  return stats;
}
