// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipCents } from './pricing.js';

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
