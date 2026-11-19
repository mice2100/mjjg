// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCoupon } from './coupons.js';
import { taxOn } from '../lib/util.js';

const base = {
  code: 'TEST',
  is_active: 1,
  discount_type: 'percent',
  discount_value: 10,
  max_discount_cents: 1500,
  min_subtotal_cents: 3000,
  first_order_only: 0,
  requires_account: 0,
  max_per_customer: null,
  max_redemptions: null,
  channels: 'Web',
  conditions_json: null,
};
const ctx = (over = {}) => ({
  now: new Date('2026-10-23T18:00:00Z'), // Friday 12:00 in Moose Jaw (UTC-6)
  source: 'Web',
  deliveryType: 'pickup',
  items: [{ id: 1, qty: 1, price_cents: 4000 }],
  subtotalCents: 4000,
  deliveryFeeCents: 0,
  signedIn: false,
  strict: true,
  stats: { totalRedemptions: 0, customerRedemptions: 0, hasPreviousOrder: false },
  ...over,
});

test('percent discount with cap', () => {
  assert.deepEqual(evaluateCoupon(base, ctx()).discountCents, 400);
  assert.equal(evaluateCoupon(base, ctx({ subtotalCents: 30000 })).discountCents, 1500);
});

test('minimum subtotal', () => {
  assert.equal(evaluateCoupon(base, ctx({ subtotalCents: 2999 })).ok, false);
});

test('expired and inactive', () => {
  assert.equal(evaluateCoupon({ ...base, ends_at: '2026-10-01T00:00:00Z' }, ctx()).ok, false);
  assert.equal(evaluateCoupon({ ...base, is_active: 0 }, ctx()).ok, false);
});

test('channel restriction', () => {
  assert.equal(evaluateCoupon(base, ctx({ source: 'Phone' })).ok, false);
  assert.equal(evaluateCoupon({ ...base, channels: 'Web,Phone' }, ctx({ source: 'Phone' })).ok, true);
});

test('first order only: preview is pending, strict needs identity', () => {
  const c = { ...base, first_order_only: 1 };
  const unknown = { totalRedemptions: 0, customerRedemptions: null, hasPreviousOrder: null };
  assert.equal(evaluateCoupon(c, ctx({ strict: false, stats: unknown })).ok, true);
  assert.ok(evaluateCoupon(c, ctx({ strict: false, stats: unknown })).pending);
  assert.equal(evaluateCoupon(c, ctx({ stats: unknown })).ok, false);
  assert.equal(evaluateCoupon(c, ctx({ stats: { ...unknown, hasPreviousOrder: true } })).ok, false);
});

test('conditions: day of week and hours in local time', () => {
  const fri = { ...base, conditions_json: JSON.stringify({ days_of_week: [5], hours: { from: '11:00', to: '14:00' } }) };
  assert.equal(evaluateCoupon(fri, ctx()).ok, true);
  assert.equal(evaluateCoupon(fri, ctx({ now: new Date('2026-10-23T21:00:00Z') })).ok, false); // 15:00 local
  assert.equal(evaluateCoupon(fri, ctx({ now: new Date('2026-10-24T18:00:00Z') })).ok, false); // Saturday
});

test('unknown condition fails closed', () => {
  assert.equal(evaluateCoupon({ ...base, conditions_json: '{"typo_rule":1}' }, ctx()).ok, false);
});

test('free delivery only for delivery', () => {
  const c = { ...base, discount_type: 'free_delivery', discount_value: 0 };
  assert.equal(evaluateCoupon(c, ctx()).ok, false);
  assert.equal(evaluateCoupon(c, ctx({ deliveryType: 'delivery', deliveryFeeCents: 631 })).discountCents, 631);
});

test('fixed discount never exceeds subtotal', () => {
  const c = { ...base, discount_type: 'fixed', discount_value: 99999, min_subtotal_cents: 0 };
  assert.equal(evaluateCoupon(c, ctx()).discountCents, 4000);
});

test('tax is 11% rounded to the cent', () => {
  assert.equal(taxOn(3190), 351);
  assert.equal(taxOn(-5), 0);
});
