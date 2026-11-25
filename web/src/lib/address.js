// House or apartment / hotel? Decides the delivery fee ($7 house, $8 apartment, condo or hotel).
// Dependency-free and shared: the Worker prices orders with it (worker/services/pricing.js,
// staffOrders.js), the order page and the staff app (/js/address.js) show the same answer.
//
// An address counts as an apartment / hotel when it
//   1. names a hotel or motel, or is at a hotel's street address (data/moose_jaw_hotels.json),
//   2. is at a known apartment / condo building (data/moose_jaw_apartment_buildings.json), or
//   3. has a unit: "Apt 4", "Unit 12", "Suite 3", "Room 210", "#204", "204-123 Main St", "Lobby".
// Everything else is a house.

const UNIT = /\b(apt|apartment|apartments|suite|ste|unit|room|rm|condo|condos|lobby|penthouse|ph)\b\.?\s*\w*|#\s*\d+|^\s*\d+[a-z]?\s*[-–]\s*\d+\s+\S/i;
const LODGING = /\b(hotel|motel|inn|suites|lodge|resort)\b|\btrailer (court|crt|park)\b/i; // trailer courts: each home has a lot number

// An actual unit / room / lot: "Apt 4", "Unit 12B", "Suite 3", "Room 305", "Lot A24", "#204",
// "204-123 Main St", "A24 - 1295 9th Ave NE", "A8 Prairie Oasis Trailer Court", "Lobby".
// (A building name like "Gordon Manor Apartments" is not a unit; a house number like "740 Thatcher" is not either.)
const UNIT_NUMBER = /\b(apt|apartment|suite|ste|unit|room|rm|ph|penthouse|lot|pad|site|space)\b\.?\s*#?\s*([a-z]?\d+[a-z]?|[a-z])\b|#\s*[a-z]?\d+|^\s*[a-z]?\d+[a-z]?\s*[-–]\s*\d+\s+\S|^\s*[a-z]\d+[a-z]?\b|\blobby\b/i;

/** Deliveries to an apartment or hotel need this (the driver needs the door). */
export const hasUnit = (address) => UNIT_NUMBER.test(String(address || ''));

const WORDS = [
  [/\bstreet\b/g, 'st'], [/\bavenue\b|\bave\b/g, 'av'], [/\bdrive\b/g, 'dr'], [/\broad\b/g, 'rd'],
  [/\bcrescent\b|\bcres\b/g, 'cr'], [/\bboulevard\b/g, 'blvd'], [/\bhighway\b|\bhwy\b/g, 'hwy'],
  [/\bnorth\s*west\b/g, 'nw'], [/\bnorth\s*east\b/g, 'ne'], [/\bsouth\s*west\b/g, 'sw'], [/\bsouth\s*east\b/g, 'se'],
  [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\beast\b/g, 'e'], [/\bwest\b/g, 'w'],
  [/(\d+)(st|nd|rd|th)\b/g, '$1'],
];

/** "740 Thatcher Drive West, Moose Jaw, SK" → "740 thatcher dr w" */
export function streetKey(address) {
  let s = String(address || '').toLowerCase().split(',')[0] ?? '';
  s = s.replace(/[.]/g, ' ');
  for (const [re, to] of WORDS) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

// Address parts split on commas, each reduced with streetKey (the street is not always first:
// "Grant Hall Hotel, 401 Main St N, Room 210, Moose Jaw, SK").
const parts = (address) => String(address || '').split(',').map((p) => streetKey(p)).filter(Boolean);

/**
 * places = { hotels: [{name, address}], buildings: [{name?, address}] }
 * Returns 'apartment' or 'house'.
 */
export function placeForAddress(address, places = {}) {
  const text = String(address || '');
  if (!text.trim()) return 'house';
  if (UNIT.test(text) || LODGING.test(text)) return 'apartment';
  return findPlace(text, places) ? 'apartment' : 'house';
}

const QUADRANT = /\s(n|s|e|w|nw|ne|sw|se)$/;
// "610 2 av ne" matches "610 2 av ne", and also "610 2 av" (quadrant left out on one side).
function sameStreet(a, b) {
  if (a === b) return true;
  const qa = QUADRANT.test(a), qb = QUADRANT.test(b);
  if (qa === qb) return false;
  return (qa ? a.replace(QUADRANT, '') : a) === (qb ? b.replace(QUADRANT, '') : b);
}

/** The hotel or building an address is at (by name or street address), or null. */
export function findPlace(address, places = {}) {
  const lower = String(address || '').toLowerCase();
  const keys = parts(address);
  for (const p of [...(places.hotels || []), ...(places.buildings || [])]) {
    for (const n of [p.name, ...(p.names || [])]) {
      const name = String(n || '').toLowerCase();
      if (name && !/^\d/.test(name) && lower.includes(name)) return p;
    }
    for (const a of [p.address, ...(p.also || [])]) {
      const k = streetKey(a);
      if (k && /\d/.test(k) && keys.some((x) => sameStreet(x, k))) return p;
    }
  }
  return null;
}
