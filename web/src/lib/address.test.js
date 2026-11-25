import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeForAddress, streetKey } from './address.js';
import hotelData from '../../../data/moose_jaw_hotels.json' with { type: 'json' };

const PLACES = {
  hotels: [{ name: 'Grant Hall Hotel', address: '401 Main St N' }, { name: 'Temple Gardens Hotel & Spa', address: '24 Fairford St E' }],
  buildings: [{ name: 'Example Towers', address: '1000 9th Ave NW' }],
};

test('houses', () => {
  assert.equal(placeForAddress('740 Thatcher Drive, Moose Jaw, SK', PLACES), 'house');
  assert.equal(placeForAddress('123 Main St N, Moose Jaw, SK', PLACES), 'house');
  assert.equal(placeForAddress('', PLACES), 'house');
});

test('units, rooms and hotels are apartments', () => {
  for (const a of [
    '123 Main St N, Apt 4, Moose Jaw, SK', '55 Oxford St W #204', '204-123 Main St N', '12 High St E, Unit 3',
    'Grant Hall Hotel, 401 Main St N, Room 210, Moose Jaw, SK', '401 main street north, Moose Jaw', '24 Fairford Street East',
    'Lobby',
  ]) assert.equal(placeForAddress(a, PLACES), 'apartment', a);
});

test('known apartment buildings without a unit number', () => {
  assert.equal(placeForAddress('1000 9th Avenue Northwest, Moose Jaw, SK', PLACES), 'apartment');
  assert.equal(streetKey('1000 9th Avenue Northwest, Moose Jaw'), '1000 9 av nw');
});

test('real Moose Jaw hotel list: by name or by street address', () => {
  const places = { hotels: hotelData.hotels, buildings: [] };
  assert.equal(placeForAddress('Super 8 by Wyndham, 1706 Main St N, Room 12, Moose Jaw, SK', places), 'apartment');
  assert.equal(placeForAddress('1590 Main Street North, Moose Jaw', places), 'apartment');
  assert.equal(placeForAddress('1592 Main St N, Moose Jaw', places), 'house');
});

test('owner apartment list: by street address, other addresses of a complex, quadrant left out', async () => {
  const { default: b } = await import('../../../data/moose_jaw_apartment_buildings.json', { with: { type: 'json' } });
  const places = { hotels: hotelData.hotels, buildings: b.buildings };
  assert.equal(placeForAddress('450 Langdon Crescent, Moose Jaw, SK', places), 'apartment');
  assert.equal(placeForAddress('610 2nd Avenue NE', places), 'apartment');
  assert.equal(placeForAddress('610 2nd Ave, Moose Jaw', places), 'apartment'); // no quadrant typed
  assert.equal(placeForAddress('610 2nd Ave SE, Moose Jaw', places), 'house'); // different quadrant
  assert.equal(placeForAddress('31 Wood Lily Drive', places), 'apartment'); // Woodlily Court "also"
  assert.equal(placeForAddress('Langdon Towers, 450 Langdon Cres, Unit 904', places), 'apartment');
  assert.equal(placeForAddress('955 Thatcher Dr, Moose Jaw', places), 'apartment'); // Prairie Oasis
  assert.equal(placeForAddress('957 Thatcher Dr E', places), 'house');
});

test('unit numbers', async () => {
  const { hasUnit } = await import('./address.js');
  for (const a of ['450 Langdon Cres, Unit 904', '55 Oxford St W #204', 'Grant Hall Hotel, 401 Main St N, Room 210', '11-47 Arrowhead Rd', 'Apt 4B, 610 2nd Ave NE', 'Langdon Towers, Lobby', 'Suite B, 12 Main St'])
    assert.equal(hasUnit(a), true, a);
  for (const a of ['Gordon Manor Apartments, 1350 Gordon Rd', 'Langdon Towers, 450 Langdon Cres', '740 Thatcher Dr', 'Comfort Inn & Suites, 155 Thatcher Dr W'])
    assert.equal(hasUnit(a), false, a);
});

test('trailer courts: lot numbers and other spellings', async () => {
  const { hasUnit, placeForAddress } = await import('./address.js');
  const { default: b } = await import('../../../data/moose_jaw_apartment_buildings.json', { with: { type: 'json' } });
  const places = { hotels: hotelData.hotels, buildings: b.buildings };
  assert.equal(placeForAddress('A8 Prarie Oasis Trailer Court, Moose Jaw, SK', places), 'apartment');
  assert.equal(placeForAddress('1295 9th Avenue NE', places), 'apartment'); // Lakeview
  assert.equal(placeForAddress('1250 11th Ave SW', places), 'apartment'); // Prairie Meadows (housing authority)
  assert.equal(placeForAddress('308 Ross St W', places), 'apartment'); // Ross Street Terrace range
  for (const a of ['A8 Prarie Oasis Trailer Court', 'A24 - 1295 9th Ave NE', 'Lakeview Trailer Court, Lot B19', '#B19 1455 9th Ave NE'])
    assert.equal(hasUnit(a), true, a);
  assert.equal(hasUnit('1455 9th Ave NE, Moose Jaw'), false);
});
