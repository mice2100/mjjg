// Domain constants and small pure helpers. Business rules live here so every
// channel (website, POS, WooCommerce import) uses the same numbers.

export const TAX_RATE_PERCENT = 11; // Saskatchewan: GST 5% + PST 6%
// Moose Jaw delivery fee: $7 to a house, $8 to an apartment, condo or hotel. Not taxed.
export const DELIVERY_FEES_CENTS = { house: 700, apartment: 800 };
export const DELIVERY_PLACES = Object.keys(DELIVERY_FEES_CENTS);
export const deliveryFeeCents = (deliveryType, place) =>
  deliveryType === 'delivery' ? DELIVERY_FEES_CENTS[place] ?? DELIVERY_FEES_CENTS.house : 0;
// The place an existing order was charged for, from its stored fee.
export const placeOfFee = (cents) => (cents === DELIVERY_FEES_CENTS.apartment ? 'apartment' : 'house');
export const RESTAURANT_TIME_ZONE = 'America/Regina'; // Saskatchewan: CST all year, no DST
export const MAX_QTY_PER_LINE = 50;

export const toCents = (dollars) => Math.round(Number(dollars || 0) * 100);
export const toDollars = (cents) => Math.round(Number(cents || 0)) / 100;

// Tax is charged on food only: (subtotal - food discounts). Delivery fees and tips are not taxed.
export const taxOn = (taxableCents) => Math.round((Math.max(0, taxableCents) * TAX_RATE_PERCENT) / 100);

export const normalizePhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  // Drop North American country code so '+1 306…' and '306…' match.
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
};

export const normalizeEmail = (raw) => {
  const email = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};

export const cleanText = (raw, max = 500) => String(raw ?? '').trim().slice(0, max);

export const nowIso = () => new Date().toISOString();

export const randomId = (prefix) => {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
};

// Local wall-clock parts in the restaurant's time zone (for coupon day/hour rules, display).
export function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RESTAURANT_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { dayOfWeek: days.indexOf(get('weekday')), hhmm: `${get('hour')}:${get('minute')}` };
}

export function formatLocalTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { timeZone: RESTAURANT_TIME_ZONE, hour: '2-digit', minute: '2-digit' });
}

export function formatLocalDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: RESTAURANT_TIME_ZONE }); // YYYY-MM-DD
}
