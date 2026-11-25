import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiscount, priceLines, staffTotals } from './staffOrders.js';
import { normalizeGroup, resolveMods } from './options.js';

// Menu ids from data/menu.json: 1 = A1 Egg Roll $3.50, 28 = C12 Kung Pao Chicken.
const GROUPS = [
  { id: 'spice', name: 'Spice level', min: 1, max: 1, options: [{ name: 'Mild', price_cents: 0 }, { name: 'Hot', price_cents: 0 }], item_ids: [28] },
  { id: 'extra', name: 'Extras', min: 0, max: 3, options: [{ name: 'Extra sauce', price_cents: 150 }], item_ids: [1, 28] },
];

test('options add their price and required groups are enforced', () => {
  const { lines } = priceLines([{ id: 1, qty: 2, mods: [{ g: 'extra', n: 'Extra sauce' }] }], GROUPS);
  assert.equal(lines[0].price_cents, 350 + 150);
  assert.throws(() => priceLines([{ id: 28, qty: 1 }], GROUPS), /spice level/i);
  assert.throws(() => priceLines([{ id: 1, qty: 1, mods: [{ g: 'spice', n: 'Hot' }] }], GROUPS), /no longer applies/);
  assert.throws(() => priceLines([{ id: 28, qty: 1, mods: [{ g: 'spice', n: 'Nuclear' }] }], GROUPS), /not an option/);
});

test('client prices are ignored', () => {
  const { lines } = priceLines([{ id: 1, qty: 1, price_cents: 1, price: 0.01 }], GROUPS);
  assert.equal(lines[0].price_cents, 350);
});

test('reducing or removing sent lines makes voids; unsent changes do not', () => {
  const prev = [
    { uid: 'a', id: 1, name: 'A1. Egg Roll', qty: 3, sent: 3 },
    { uid: 'b', id: 1, name: 'A1. Egg Roll', qty: 2, sent: 0 },
    { uid: 'c', id: 28, name: 'C12 Kung Pao Chicken', qty: 1, sent: 1 },
  ];
  const { lines, voids } = priceLines(
    [{ uid: 'a', id: 1, qty: 1 }, { uid: 'b', id: 1, qty: 1 }],
    GROUPS,
    prev
  );
  assert.equal(lines.find((l) => l.uid === 'a').sent, 1);
  assert.equal(lines.find((l) => l.uid === 'b').sent, 0);
  assert.deepEqual(voids, [{ qty: 2, name: 'A1. Egg Roll' }, { qty: 1, name: 'C12 Kung Pao Chicken' }]);
});

test('line and order discounts, untaxed delivery fee and 11% tax on food', () => {
  const { lines } = priceLines(
    [{ id: 1, qty: 4, disc: { t: 'pct', v: 50 } }, { id: 28, qty: 1, mods: [{ g: 'spice', n: 'Hot' }] }],
    GROUPS
  );
  const item28 = lines[1].price_cents;
  const t = staffTotals(lines, { deliveryType: 'delivery', orderDiscount: { t: 'amt', v: 100 } });
  assert.equal(t.subtotal_cents, 1400 + item28);
  assert.equal(t.item_discount_cents, 700);
  assert.equal(t.order_discount_cents, 100);
  assert.equal(t.delivery_fee_cents, 700); // house is the default
  assert.equal(t.tax_cents, Math.round(((1400 + item28 - 800) * 11) / 100));
  assert.equal(t.total_cents, 1400 + item28 - 800 + 700 + t.tax_cents);
});

test('apartments and hotels pay $8 delivery, pickup and dine-in pay none', () => {
  const { lines } = priceLines([{ id: 1, qty: 1 }], GROUPS);
  const apt = staffTotals(lines, { deliveryType: 'delivery', deliveryPlace: 'apartment' });
  assert.equal(apt.delivery_fee_cents, 800);
  assert.equal(apt.tax_cents, Math.round((350 * 11) / 100));
  assert.equal(apt.total_cents, 350 + 800 + apt.tax_cents);
  assert.equal(staffTotals(lines, { deliveryType: 'pickup', deliveryPlace: 'apartment' }).delivery_fee_cents, 0);
  assert.equal(staffTotals(lines, { deliveryType: 'dinein' }).delivery_fee_cents, 0);
});

test('discounts are clamped and validated', () => {
  assert.equal(normalizeDiscount({ t: 'pct', v: 150 }), null);
  assert.equal(normalizeDiscount({ t: 'amt', v: -5 }), null);
  assert.deepEqual(normalizeDiscount({ t: 'pct', v: 100 }), { t: 'pct', v: 100 });
  const { lines } = priceLines([{ id: 1, qty: 1, disc: { t: 'amt', v: 99999 } }], GROUPS);
  assert.equal(lines[0].disc_cents, 350); // never more than the line
});

test('option group edits are validated', () => {
  const g = normalizeGroup({ name: ' Spice ', min: 1, max: 1, options: [{ name: 'Hot', price_cents: 0 }, { name: '' }], item_ids: [28, 28, 999999] });
  assert.deepEqual(g, { name: 'Spice', min: 1, max: 1, options: [{ name: 'Hot', price_cents: 0 }], item_ids: [28] });
  assert.throws(() => normalizeGroup({ name: 'X', max: 1, options: [], item_ids: [] }), /at least one/);
  assert.throws(() => normalizeGroup({ name: 'X', max: 1, options: [{ name: 'a' }, { name: 'A' }], item_ids: [] }), /twice/);
  assert.deepEqual(resolveMods(GROUPS, 1, []), []);
});
