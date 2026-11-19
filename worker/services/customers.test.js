import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressKey } from './customers.js';

test('addressKey ignores case, commas, dots and spacing', () => {
  assert.equal(addressKey('55 Oxford St. W,  Apt 3, Moose Jaw'), addressKey('55 oxford st w apt 3 moose jaw'));
  assert.notEqual(addressKey('55 Oxford St W'), addressKey('57 Oxford St W'));
  assert.equal(addressKey('  '), '');
  assert.equal(addressKey(null), '');
});
