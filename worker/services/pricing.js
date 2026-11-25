// Authoritative price calculation. The browser may show its own estimate, but only
// the numbers produced here are stored on an order.

import { HttpError } from '../lib/http.js';
import { getMenuItem, priceCents } from '../lib/menu.js';
import { MAX_QTY_PER_LINE, deliveryFeeCents as feeFor, taxOn } from '../lib/util.js';
import { evaluateCoupon, findCoupon, loadCouponStats } from './coupons.js';
import { assertAvailable, customerGroups, listOptionGroups, resolveMods } from './options.js';

export const DELIVERY_TYPES = ['pickup', 'delivery', 'dinein'];

// Tip buttons on the website. Percent tips are on food after discount (before tax and
// delivery); 'round' tops the total up to the next whole dollar. Tips are not taxed.
export const TIP_CHOICES = ['none', '5', '10', '15', 'round'];

export function tipCents(choice, { foodCents, totalBeforeTipCents }) {
  if (choice === 'round') return Math.ceil(totalBeforeTipCents / 100) * 100 - totalBeforeTipCents;
  const percent = Number(choice);
  if (!TIP_CHOICES.includes(choice) || !(percent > 0)) return 0;
  return Math.round((Math.max(0, foodCents) * percent) / 100);
}

// [{id, qty, mods}] from the client -> [{id, code, name, price_cents, qty, mods}] from the menu.
// mods = [{g, n}] picked options; the server checks them against the option groups (required
// choices such as chicken balls / sweet & sour pork) and adds their prices. Same dish with the
// same options = one line.
export function resolveItems(rawItems, groups = []) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'Your cart is empty.');
  }
  const merged = new Map();
  for (const raw of rawItems) {
    const item = getMenuItem(raw?.id);
    const qty = Math.floor(Number(raw?.qty));
    if (!item) throw new HttpError(400, `Unknown menu item: ${raw?.id}`);
    if (!(qty >= 1)) throw new HttpError(400, `Invalid quantity for ${item.name}`);
    const mods = resolveMods(groups, item.id, raw?.mods);
    const key = `${item.id}|${mods.map((m) => `${m.g}:${m.n}`).sort().join(',')}`;
    const line = merged.get(key) || {
      id: item.id,
      code: item.code,
      name: item.name,
      price_cents: priceCents(item) + mods.reduce((sum, m) => sum + m.price_cents, 0), // per unit, options included
      qty: 0,
      ...(mods.length ? { mods } : {}),
    };
    line.qty += qty;
    if (line.qty > MAX_QTY_PER_LINE) throw new HttpError(400, `Too many of ${item.name}; please call us for large orders.`);
    merged.set(key, line);
  }
  return [...merged.values()];
}

/**
 * Builds a full price breakdown.
 * opts = { items, deliveryType, deliveryPlace ('house' | 'apartment'), couponCode, source, email, phone, signedIn, strict, now }
 */
export async function buildQuote(db, opts) {
  // Website orders: staff-only groups (requests) are refused.
  const items = resolveItems(opts.items, opts.groups || customerGroups(await listOptionGroups(db)));
  await assertAvailable(db, items); // dishes staff marked sold out
  const deliveryType = DELIVERY_TYPES.includes(opts.deliveryType) ? opts.deliveryType : 'pickup';
  const subtotalCents = items.reduce((sum, l) => sum + l.price_cents * l.qty, 0);
  const deliveryFeeCents = feeFor(deliveryType, opts.deliveryPlace);

  let discountCents = 0;
  let coupon = null;
  let couponResult = null;

  if (opts.couponCode) {
    coupon = await findCoupon(db, opts.couponCode);
    const stats = coupon
      ? await loadCouponStats(db, coupon, { email: opts.email, phone: opts.phone })
      : { totalRedemptions: 0, customerRedemptions: null, hasPreviousOrder: null };
    couponResult = evaluateCoupon(coupon, {
      now: opts.now || new Date(),
      source: opts.source,
      deliveryType,
      items,
      subtotalCents,
      deliveryFeeCents,
      signedIn: Boolean(opts.signedIn),
      strict: Boolean(opts.strict),
      stats,
    });
    if (couponResult.ok) {
      if (couponResult.freeItem) items.push({ ...couponResult.freeItem, free: true });
      discountCents = couponResult.discountCents;
    } else if (opts.strict) {
      throw new HttpError(409, couponResult.message, { coupon_error: true });
    }
  }

  const fullSubtotal = items.reduce((sum, l) => sum + l.price_cents * l.qty, 0);
  discountCents = Math.min(discountCents, fullSubtotal + deliveryFeeCents);
  // A free-delivery coupon discounts the (untaxed) fee; every other discount is on food.
  const deliveryDiscount = coupon?.discount_type === 'free_delivery' ? Math.min(discountCents, deliveryFeeCents) : 0;
  const foodCents = fullSubtotal - Math.min(discountCents - deliveryDiscount, fullSubtotal);
  const taxCents = taxOn(foodCents);
  const totalBeforeTipCents = fullSubtotal - discountCents + deliveryFeeCents + taxCents;
  const tipBase = { foodCents, totalBeforeTipCents };
  const tipChoice = TIP_CHOICES.includes(opts.tip) ? opts.tip : 'none';
  const tip = tipCents(tipChoice, tipBase);

  return {
    items,
    delivery_type: deliveryType,
    subtotal_cents: fullSubtotal,
    discount_cents: discountCents,
    delivery_fee_cents: deliveryFeeCents,
    delivery_place: deliveryType === 'delivery' ? (opts.deliveryPlace === 'apartment' ? 'apartment' : 'house') : null,
    tax_cents: taxCents,
    tip_choice: tipChoice,
    tip_cents: tip,
    // Amount each tip button would add, so the buttons can show dollars.
    tip_options: Object.fromEntries(TIP_CHOICES.map((c) => [c, tipCents(c, tipBase)])),
    total_cents: totalBeforeTipCents + tip,
    coupon: coupon && couponResult?.ok ? { code: coupon.code, description: coupon.description } : null,
    coupon_message: couponResult ? (couponResult.ok ? couponResult.pending : couponResult.message) : null,
  };
}
