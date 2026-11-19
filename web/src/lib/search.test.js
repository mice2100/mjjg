// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMatch, fuzzyHighlight, searchMenu, parseHouseAndStreet, searchStreets, searchPlaces } from './search.js';

const MENU = [
  { id: 1, code: 'B8', name: 'Ginger Beef', category: 'Beef' },
  { id: 2, code: 'B10', name: 'Beef with Broccoli', category: 'Beef' },
  { id: 3, code: 'C1', name: 'Sweet and Sour Chicken Balls', category: 'Chicken' },
  { id: 4, code: '', name: 'Spring Roll', category: 'Appetizers' },
];
const STREETS = ['9th Avenue Northwest', '9th Avenue Southwest', 'Thatcher Drive East', 'Main Street North'];

test('fuzzyMatch: substring beats subsequence, misses return null', () => {
  assert.ok(fuzzyMatch('Ginger Beef', 'beef').score > fuzzyMatch('Ginger Beef', 'gbf').score);
  assert.equal(fuzzyMatch('Ginger Beef', 'xyz'), null);
});

test('fuzzyHighlight escapes HTML', () => {
  assert.equal(fuzzyHighlight('<a>&', [1]), '&lt;<mark>a</mark>&gt;&amp;');
});

test('searchMenu: code prefix ranks first, typos-by-omission still match', () => {
  assert.equal(searchMenu(MENU, 'b8')[0].item.id, 1);
  assert.equal(searchMenu(MENU, 'gngr bf')[0].item.id, 1);
  assert.equal(searchMenu(MENU, 'swt sour')[0].item.id, 3);
  assert.equal(searchMenu(MENU, 'zzz').length, 0);
  assert.equal(searchMenu(MENU, '  ').length, MENU.length);
});

test('streets: house number is kept and abbreviations expand', () => {
  assert.deepEqual(parseHouseAndStreet('740 thatcher'), { house: '740 ', streetPart: 'thatcher' });
  assert.deepEqual(parseHouseAndStreet('9th ave'), { house: '', streetPart: '9th ave' });
  assert.equal(searchStreets(STREETS, '740 that')[0].full, '740 Thatcher Drive East');
  assert.equal(searchStreets(STREETS, '12 9 ave nw')[0].full, '12 9th Avenue Northwest');
  assert.equal(searchStreets(STREETS, '')[0], undefined);
});

test('places: word-start match on name or address; empty query lists all', () => {
  const PLACES = [
    { name: 'Temple Gardens Hotel & Spa', address: '24 Fairford St E' },
    { name: 'Super 8 by Wyndham', address: '1706 Main St N' },
    { name: 'Days Inn by Wyndham', address: '1720 Main St N' },
  ];
  assert.equal(searchPlaces(PLACES, 'temp gar')[0].place.name, 'Temple Gardens Hotel & Spa');
  assert.equal(searchPlaces(PLACES, 'super 8')[0].place.name, 'Super 8 by Wyndham');
  assert.equal(searchPlaces(PLACES, 'fairford')[0].place.name, 'Temple Gardens Hotel & Spa');
  assert.equal(searchPlaces(PLACES, 'wyndham').length, 2);
  assert.equal(searchPlaces(PLACES, 'ml').length, 0); // no loose subsequence matches
  assert.equal(searchPlaces(PLACES, '').length, 3);
  assert.deepEqual(searchPlaces(PLACES, 'days')[0].positions, [0, 1, 2, 3]);
});
