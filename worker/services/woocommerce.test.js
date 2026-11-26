import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWooOrder, wooLineOptions } from './woocommerce.js';

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
