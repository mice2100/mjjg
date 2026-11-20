// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSlotDays, slotLabel } from './slots.js';

// Regina is UTC-6: 18:10 local on Thursday 2026-11-19 is 2026-11-20T00:10Z.
const at = (iso) => new Date(iso);

test('slot labels', () => {
  assert.equal(slotLabel(18 * 60 + 30), '6:30 – 7:00 PM');
  assert.equal(slotLabel(11 * 60 + 30), '11:30 AM – 12:00 PM');
  assert.equal(slotLabel(12 * 60), '12:00 – 12:30 PM');
});

test('today starts at the next half hour and ends at closing', () => {
  const [today, tomorrow] = getSlotDays(at('2026-11-20T00:10:00Z'));
  assert.equal(today.label, 'Today');
  assert.equal(today.slots[0].label, '6:30 – 7:00 PM');
  assert.equal(today.slots.at(-1).label, '7:30 – 8:00 PM');
  assert.equal(today.slots.length, 3);
  assert.equal(tomorrow.label, 'Tomorrow');
  assert.equal(tomorrow.slots.length, 18);
  assert.equal(tomorrow.slots[0].value, 'Fri Nov 20 · 11:00 – 11:30 AM');
});

test('on the half hour the next slot is the following half hour', () => {
  const [today] = getSlotDays(at('2026-11-20T00:30:00Z')); // 18:30
  assert.equal(today.slots[0].label, '7:00 – 7:30 PM');
});

test('before opening, today starts at 11:00', () => {
  const [today] = getSlotDays(at('2026-11-19T14:00:00Z')); // 08:00
  assert.equal(today.slots[0].label, '11:00 – 11:30 AM');
  assert.equal(today.slots.length, 18);
});

test('after the last slot, today is skipped', () => {
  const days = getSlotDays(at('2026-11-20T01:50:00Z')); // 19:50
  assert.equal(days[0].isToday, false);
  assert.equal(days[0].label, 'Tomorrow');
});

test('Mondays are skipped', () => {
  const days = getSlotDays(at('2026-11-22T20:00:00Z'), { days: 3 }); // Sunday 14:00
  assert.deepEqual(days.map((d) => d.label), ['Today', 'Tue Nov 24', 'Wed Nov 25']);
});
