// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComponents, withComponents } from './combos.js';

test('menu lines take the menu name; text lines keep their own; duplicates merge', () => {
  const out = normalizeComponents(88, [
    { id: 1, qty: 1 },
    { id: '1', qty: 2 },
    { name: '  Steamed   Rice ', qty: 1 },
    { name: 'steamed rice' },
  ]);
  assert.deepEqual(out, [
    { id: 1, name: 'A1. Egg Roll', qty: 3 },
    { id: null, name: 'Steamed Rice', qty: 2 },
  ]);
});

test('rejects unknown dishes, self-reference, bad quantities and empty lines', () => {
  assert.throws(() => normalizeComponents(88, [{ id: 99999 }]), /Unknown menu item/);
  assert.throws(() => normalizeComponents(88, [{ id: 88 }]), /cannot contain itself/);
  assert.throws(() => normalizeComponents(88, [{ id: 1, qty: 0 }]), /Quantity/);
  assert.throws(() => normalizeComponents(88, [{ id: 1, qty: 21 }]), /Quantity/);
  assert.throws(() => normalizeComponents(88, [{ name: '   ' }]), /needs a dish/);
  assert.throws(() => normalizeComponents(88, 'x'), /must be a list/);
});

test('order snapshot gets components on combo lines only, never on free items', () => {
  const map = new Map([[88, [{ id: 1, code: 'A1', name: 'A1. Egg Roll', qty: 1 }]]]);
  const items = withComponents(
    [
      { id: 88, name: 'Combo A', qty: 2 },
      { id: 88, name: 'Combo A', qty: 1, free: true },
      { id: 2, name: 'Spring Roll', qty: 1 },
    ],
    map
  );
  assert.deepEqual(items[0].components, [{ id: 1, code: 'A1', name: 'A1. Egg Roll', qty: 1 }]);
  assert.equal(items[1].components, undefined);
  assert.equal(items[2].components, undefined);
});
