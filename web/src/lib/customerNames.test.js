// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerName } from './customerNames.js';

test('set-dinner contents for customers: plain names, no counts, sauces or containers', () => {
  assert.equal(customerName('SpR'), 'Spring Roll');
  assert.equal(customerName('CKB (12) & 8 oz S/S sauce OR S/S PK (Round)'), 'Chicken Balls or Sweet & Sour Pork');
  assert.equal(customerName('CKB (18) & 12 oz S/S'), 'Chicken Balls');
  assert.equal(customerName('Mon Ribs (half order)'), 'Montreal Ribs');
  assert.equal(customerName('SP VEG (6*9)'), 'Special Vegetables');
  assert.equal(customerName('FR (EP28)'), 'Fried Rice');
  assert.equal(customerName('DF SHR'), 'Deep Fried Shrimp');
  assert.equal(customerName('Chicken Vegetables'), 'Chicken Vegetables');
});
