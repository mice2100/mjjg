// Authoritative price calculation. The browser may show its own estimate, but only
// the numbers produced here are stored on an order.

import { HttpError } from '../lib/http.js';
import { getMenuItem, priceCents } from '../lib/menu.js';
import { DELIVERY_FEE_CENTS, MAX_QTY_PER_LINE, taxOn } from '../lib/util.js';
import { evaluateCoupon, findCoupon, loadCouponStats } from './coupons.js';

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

// [{id, qty}] from the client -> [{id, code, name, price_cents, qty}] from the menu.
export function resolveItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'Your cart is empty.');
  }
  const merged = new Map();
  for (const raw of rawItems) {
    const item = getMenuItem(raw?.id);
    const qty = Math.floor(Number(raw?.qty));
    if (!item) throw new HttpError(400, `Unknown menu item: ${raw?.id}`);
    if (!(qty >= 1)) throw new HttpError(400, `Invalid quantity for ${item.name}`);
    const line = merged.get(item.id) || {
      id: item.id,
      code: item.code,
      name: item.name,
      price_cents: priceCents(item),
      qty: 0,
    };
    line.qty += qty;
    if (line.qty > MAX_QTY_PER_LINE) throw new HttpError(400, `Too many of ${item.name}; please call us for large orders.`);
    merged.set(item.id, line);
  }
  return [...merged.values()];
}

/**
 * Builds a full price breakdown.
 * opts = { items, deliveryType, couponCode, source, email, phone, signedIn, strict, now }
 */
export async function buildQuote(db, opts) {
  const items = resolveItems(opts.items);
  const deliveryType = DELIVERY_TYPES.includes(opts.deliveryType) ? opts.deliveryType : 'pickup';
  const subtotalCents = items.reduce((sum, l) => sum + l.price_cents * l.qty, 0);
  const deliveryFeeCents = deliveryType === 'delivery' ? DELIVERY_FEE_CENTS : 0;

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
  const taxCents = taxOn(fullSubtotal - discountCents + deliveryFeeCents);
  const totalBeforeTipCents = fullSubtotal - discountCents + deliveryFeeCents + taxCents;
  const tipBase = { foodCents: fullSubtotal - discountCents, totalBeforeTipCents };
  const tipChoice = TIP_CHOICES.includes(opts.tip) ? opts.tip : 'none';
  const tip = tipCents(tipChoice, tipBase);

  return {
    items,
    delivery_type: deliveryType,
    subtotal_cents: fullSubtotal,
    discount_cents: discountCents,
    delivery_fee_cents: deliveryFeeCents,
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
