// What a set dinner contains, as customers read it on the website.
// Staff keep the kitchen version (counts, sauce sizes, containers such as (Round), (6*9), (EP28));
// customers see plain dish names, like the printed menu: "Spring Roll", "Chicken Balls or Sweet & Sour Pork".

const NAMES = {
  'spr': 'Spring Roll',
  'ckb': 'Chicken Balls',
  's/s pk': 'Sweet & Sour Pork',
  'df shr': 'Deep Fried Shrimp',
  'pf shr': 'Pan Fried Shrimp',
  'mon rib': 'Montreal Ribs',
  'mon ribs': 'Montreal Ribs',
  'ckw': 'Chicken Wings',
  'gb': 'Ginger Beef',
  'sp veg': 'Special Vegetables',
  'ck lm': 'Chicken Low Mein',
  'fr': 'Fried Rice',
  'ck fr': 'Chicken Fried Rice',
  'spicy ck fr': 'Spicy Chicken Fried Rice',
  'blp': 'Sweet & Sour Pork',
};

// Sauce that comes with the chicken balls: staff-only detail.
const SAUCE = /^(\d+\s*oz\s*)?s\/s( sauce)?$/i;

const plain = (text) => String(text || '')
  .replace(/\([^)]*\)/g, ' ') // counts and containers
  .replace(/\b\d+\s*oz\b/gi, ' ') // sauce sizes
  .replace(/^\s*\d+\s*[x×]\s*/i, '') // "2 x SpR"
  .replace(/\s+/g, ' ')
  .trim();

function word(part) {
  const p = plain(part);
  return NAMES[p.toLowerCase()] || p;
}

// "CKB (12) & 8 oz S/S sauce OR S/S PK (Round)" -> "Chicken Balls or Sweet & Sour Pork"
export function customerName(name) {
  return String(name || '')
    .split(/\s+OR\s+/i)
    .map((choice) => choice.split(/\s*&\s*/).filter((p) => !SAUCE.test(plain(p))).map(word).filter(Boolean).join(' & '))
    .filter(Boolean)
    .join(' or ');
}

export const customerContents = (components) => components.map((c) => customerName(c.name)).filter(Boolean);
