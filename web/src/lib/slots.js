// Pickup / delivery time slots, shared by the staff app (published at /js/slots.js) and the tests.
// Dependency-free ES module. Slots are 30 minutes, start on the hour or half hour, and only
// cover take-out & delivery hours (web/src/data/site.js: 11:00 am - 8:00 pm, closed Mondays).
// Restaurant time is America/Regina = UTC-6 all year (no DST), see AGENTS.md rule 9.

export const SLOT_MINUTES = 30;
export const OPEN_FROM_MIN = 11 * 60; // 11:00
export const OPEN_TO_MIN = 20 * 60; // 20:00, the last slot ends here
export const CLOSED_WEEKDAYS = [1]; // Monday
const REGINA_OFFSET_MS = -6 * 3600 * 1000;
const DAY_MS = 86400 * 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { h12: h % 12 === 0 ? 12 : h % 12, mm: String(m).padStart(2, '0'), ap: h < 12 ? 'AM' : 'PM' };
}

/** 18:30 -> "6:30 – 7:00 PM" (both ends get a suffix only when they differ). */
export function slotLabel(startMin) {
  const a = clock(startMin);
  const b = clock(startMin + SLOT_MINUTES);
  return `${a.h12}:${a.mm}${a.ap === b.ap ? '' : ' ' + a.ap} – ${b.h12}:${b.mm} ${b.ap}`;
}

/**
 * Days that still have a free slot, starting with today: [{ ymd, label, isToday, slots:[{ start_min, label, value }] }].
 * Today starts at the next half hour after `now`; other days cover the whole day. Mondays are skipped.
 * `value` is what gets stored on the order: "6:30 – 7:00 PM" today, "Fri Nov 20 · 6:30 – 7:00 PM" later.
 */
export function getSlotDays(now = new Date(), { days = 5 } = {}) {
  const local = new Date(now.getTime() + REGINA_OFFSET_MS); // UTC fields now read as Regina clock time
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
  const out = [];
  for (let i = 0; i < 14 && out.length < days; i++) {
    const d = new Date(local.getTime() + i * DAY_MS);
    if (CLOSED_WEEKDAYS.includes(d.getUTCDay())) continue;
    let first = OPEN_FROM_MIN;
    if (i === 0) first = Math.max(first, (Math.floor(nowMin / SLOT_MINUTES) + 1) * SLOT_MINUTES);
    const short = `${DOW[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
    const slots = [];
    for (let s = first; s + SLOT_MINUTES <= OPEN_TO_MIN; s += SLOT_MINUTES) {
      slots.push({ start_min: s, label: slotLabel(s), value: i === 0 ? slotLabel(s) : `${short} · ${slotLabel(s)}` });
    }
    if (!slots.length) continue;
    out.push({ ymd: d.toISOString().slice(0, 10), label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : short, isToday: i === 0, slots });
  }
  return out;
}
