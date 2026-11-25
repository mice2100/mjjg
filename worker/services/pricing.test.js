// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveItems, tipCents } from './pricing.js';
import { customerGroups } from './options.js';

const base = { foodCents: 4000, totalBeforeTipCents: 4440 }; // $40 food + 11% tax

test('percent tips are on food after discount, rounded to the cent', () => {
  assert.equal(tipCents('5', base), 200);
  assert.equal(tipCents('10', base), 400);
  assert.equal(tipCents('15', { foodCents: 3333, totalBeforeTipCents: 3700 }), 500);
});

test('round tops the total up to the next whole dollar', () => {
  assert.equal(tipCents('round', base), 60);
  assert.equal(tipCents('round', { foodCents: 1000, totalBeforeTipCents: 2001 }), 99);
  assert.equal(tipCents('round', { foodCents: 1000, totalBeforeTipCents: 2000 }), 0);
});

test('no tip, unknown choices and client amounts give 0', () => {
  assert.equal(tipCents('none', base), 0);
  assert.equal(tipCents(undefined, base), 0);
  assert.equal(tipCents('50', base), 0);
  assert.equal(tipCents(500, base), 0);
});

// Online orders: same option rules as the POS (Dinner for Two = menu id 94).
const GROUPS = [
  { id: 'dinner_meat', name: 'Dinner choice', min: 1, max: 1, options: [{ name: 'Chicken Balls', price_cents: 0 }, { name: 'Sweet & Sour Pork', price_cents: 0 }], item_ids: [94] },
  { id: 'extra', name: 'Extra people', min: 0, max: 1, options: [{ name: '+1 person', price_cents: 1595 }], item_ids: [94] },
];

test('online dishes with a required choice need it, and options are priced by the server', () => {
  assert.throws(() => resolveItems([{ id: 94, qty: 1 }], GROUPS), /Choose dinner choice/);
  const [line] = resolveItems([{ id: 94, qty: 2, mods: [{ g: 'dinner_meat', n: 'Sweet & Sour Pork' }, { g: 'extra', n: '+1 person' }] }], GROUPS);
  assert.equal(line.qty, 2);
  assert.equal(line.price_cents, 3295 + 1595);
  assert.deepEqual(line.mods.map((m) => m.n), ['Sweet & Sour Pork', '+1 person']);
});

test('online lines merge only when the options match', () => {
  const ck = { g: 'dinner_meat', n: 'Chicken Balls' }, pk = { g: 'dinner_meat', n: 'Sweet & Sour Pork' };
  const lines = resolveItems([{ id: 94, qty: 1, mods: [ck] }, { id: 94, qty: 1, mods: [pk] }, { id: 94, qty: 1, mods: [ck] }], GROUPS);
  assert.deepEqual(lines.map((l) => [l.mods[0].n, l.qty]), [['Chicken Balls', 2], ['Sweet & Sour Pork', 1]]);
  assert.throws(() => resolveItems([{ id: 94, qty: 1, mods: [{ g: 'dinner_meat', n: 'Beef' }] }], GROUPS), /not an option/);
});

test('website orders cannot pick staff-only requests', () => {
  const groups = [
    { id: 'requests', name: 'Requests', min: 0, max: 9, options: [{ name: 'No onion', price_cents: 0 }], item_ids: [1] },
    { id: 'spice', name: 'Spice level', min: 0, max: 1, options: [{ name: 'Hot', price_cents: 0 }], item_ids: [1] },
  ];
  const online = customerGroups(groups);
  assert.deepEqual(online.map((g) => g.id), ['spice']);
  assert.throws(() => resolveItems([{ id: 1, qty: 1, mods: [{ g: 'requests', n: 'No onion' }] }], online), /no longer applies/);
  assert.equal(resolveItems([{ id: 1, qty: 1, mods: [{ g: 'spice', n: 'Hot' }] }], online)[0].mods[0].n, 'Hot');
});
