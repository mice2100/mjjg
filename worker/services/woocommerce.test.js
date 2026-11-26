import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWooOrder, wooDay, wooLineOptions } from './woocommerce.js';

test('WooCommerce line options reach the order lines', () => {
  const line = {
    name: 'N7 Chicken Low Mein or Shanghai Noodel', price: 14.95, quantity: 1,
    meta_data: [
      { key: '_exceptions', value: 'x' },
      { key: 'Noodle Type', value: 'Low Mein (Soft Skinny Noodles)', display_key: 'Noodle Type', display_value: '<p>Low Mein (Soft Skinny Noodles)</p>' },
      { key: 'Spice', value: ['Mild', 'Extra sauce'] },
      { key: 'addons', value: { a: 1 } },
    ],
  };
  assert.deepEqual(wooLineOptions(line).map((m) => m.n), ['Noodle Type: Low Mein (Soft Skinny Noodles)', 'Spice: Mild, Extra sauce']);
  const o = mapWooOrder({ id: 1, status: 'processing', billing: {}, line_items: [line, { name: 'C4 Orange Chicken', price: 15.95, quantity: 1 }] });
  const items = JSON.parse(o.items_json);
  assert.equal(items[0].mods[0].n, 'Noodle Type: Low Mein (Soft Skinny Noodles)');
  assert.equal(items[0].mods[0].price_cents, 0);
  assert.equal(items[1].mods, undefined);
  assert.equal(o.subtotal_cents, 1495 + 1595);
});

test('WooCommerce pickup date goes in front of the time slot', () => {
  assert.equal(wooDay('2026-11-26'), 'Thu, Nov 26');
  assert.equal(wooDay('11/27/2026'), 'Fri, Nov 27');
  const o = mapWooOrder({ id: 2, status: 'processing', billing: {}, line_items: [],
    meta_data: [{ key: 'exwfood_time_deli', value: '17:00 - 17:30' }, { key: 'exwfood_date_deli', value: '2026-11-26' }] });
  assert.equal(o.delivery_time_slot, 'Thu, Nov 26 · 17:00 - 17:30');
  assert.equal(mapWooOrder({ id: 3, status: 'processing', billing: {}, line_items: [], meta_data: [{ key: 'exwfood_time_deli', value: '17:00 - 17:30' }] }).delivery_time_slot, '17:00 - 17:30');
});
