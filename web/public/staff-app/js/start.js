// Starting an order: phone number first (on-screen keypad), customer lookup with saved
// addresses and order history (Reorder), street / hotel / apartment-building autocomplete for delivery.
// The same sheet edits the customer of the open order ("Edit" in the order panel).
// Dine-in starts from the seat picker instead.
'use strict';

function openStart(type, { pendingItem = null, phone = '', edit = false } = {}) {
  const d = edit ? U.draft : null;
  U.start = {
    edit, type: d ? d.type : type === 'delivery' ? 'delivery' : 'pickup',
    phone: d ? d.phone : digitsOf(phone), name: d ? d.name : '', notes: d ? d.notes : '',
    slot: d ? d.slot : '', tmode: timeMode(d ? d.slot : ''), tdate: null, cal: 0,
    savedAddr: d && d.type === 'delivery' ? d.addr : '', place: d ? d.place : null, addrIdx: -1, street: '', apt: '', hotel: null,
    lookup: null, state: 'idle', err: '', seq: 0, hist: -1, pendingItem, tried: false, ac: { list: [], i: -1 },
  };
  U.modal = 'start';
  renderModal();
  if (U.start.phone.length === 10) lookupPhone();
}

async function lookupPhone() {
  const s = U.start;
  const seq = ++s.seq;
  s.state = 'loading';
  renderModal();
  try {
    const data = await api('GET', `${API}/customers/lookup?phone=` + encodeURIComponent(s.phone));
    if (U.start !== s || seq !== s.seq) return;
    s.lookup = data;
    s.state = 'done';
    if (!s.name && data.name) s.name = data.name;
    if (!s.edit && data.last_delivery_type === 'delivery') s.type = 'delivery';
    const saved = data.addresses || [];
    s.addrIdx = s.savedAddr ? saved.findIndex((a) => addressKey(a) === addressKey(s.savedAddr)) : saved.length ? 0 : -1;
    if (s.addrIdx < 0 && s.savedAddr) { s.street = s.savedAddr; }
  } catch (e) {
    if (U.start !== s || seq !== s.seq) return;
    s.state = 'error';
    s.err = e.message;
  }
  renderModal();
}

function keypad(key) {
  const s = U.start;
  let d = s.phone;
  if (key === 'clear') d = '';
  else if (key === 'back') d = d.slice(0, -1);
  else if (d.length < 10) d += key;
  setStartPhone(d);
}
// Saskatchewan area codes: put 306 / 639 in front, or swap it for the one already typed.
function areaCode(code) {
  const d = U.start.phone;
  setStartPhone(/^(306|639)/.test(d) || d.length === 10 ? code + d.slice(3) : (code + d).slice(0, 10));
}

function setStartPhone(d) {
  const s = U.start;
  if (d === s.phone) return;
  s.phone = d;
  if (s.lookup && s.lookup.phone !== d) { s.lookup = null; s.addrIdx = -1; }
  if (d.length === 10) lookupPhone();
  else { s.state = 'idle'; s.seq++; renderModal(); }
}

// A hotel (by name or address) takes a room number; everything else a unit number.
const isHotelAddress = (addr) => (U.start.hotel ? isLodging(U.start.hotel)
  : Boolean(S.address && S.address.findPlace(addr, { hotels: S.hotels })) || /\b(hotel|motel|inn|lodge)\b/i.test(addr));

function startAddress() {
  const s = U.start;
  const saved = s.lookup?.addresses || [];
  // A bare number typed in the unit box gets its label, so the driver (and hasUnit) can read it.
  const raw = s.apt.trim();
  const aptFor = (base) => (/^[a-z]?\d+[a-z]?$/i.test(raw) ? (isTrailer(base) ? 'Lot ' : isHotelAddress(base) ? 'Room ' : 'Unit ') + raw : raw);
  if (s.addrIdx >= 0 && saved[s.addrIdx]) {
    const base = saved[s.addrIdx];
    if (!raw || S.address?.hasUnit(base)) return base;
    // Saved without a unit: put it after the street.
    const parts = base.split(',').map((p) => p.trim());
    return [parts[0], aptFor(base), ...parts.slice(1)].join(', ');
  }
  if (!s.street.trim()) return '';
  if (/moose jaw/i.test(s.street) && !raw) return s.street.trim(); // already a full address
  return [s.street.trim(), aptFor(s.street), 'Moose Jaw, SK'].filter(Boolean).join(', ');
}

// Apartments, condos and hotels must have the unit / suite / apt or room number.
const needsUnit = () => U.start.type === 'delivery' && startPlace() === 'apartment' && !(S.address && S.address.hasUnit(startAddress()));

// House or apartment / hotel: what staff picked, else a guess from the address (a hotel or an apt number = apartment).
function startPlace() {
  const s = U.start;
  if (s.place) return s.place;
  if (s.addrIdx < 0 && (s.hotel || s.apt.trim())) return 'apartment';
  return guessPlace(startAddress());
}

// Pickup / delivery time. Kept short on screen: ASAP, "in 15 / 20 / 30 / 40 min" (pickup) or
// "in 45 / 60 / 115 min" (delivery: never sooner than 45 minutes),
// "Pick a time" (today's 30-minute slots) or "Pick a date" (a calendar; a future date needs a slot).
// Hours and closed days come from mice2100's slots module (web/src/lib/slots.js, /js/slots.js).
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PICKUP_OFFSETS = [15, 20, 30, 40];
const DELIVERY_OFFSETS = [45, 60, 115];
const DELIVERY_MIN_LEAD = 45; // minutes
const CAL_DAYS_AHEAD = 60;
// Restaurant clock (America/Regina, UTC-6 all year): a Date whose UTC fields read as Regina time.
const reginaNow = () => new Date(Date.now() - 6 * 3600 * 1000);
const ymdOf = (d) => d.toISOString().slice(0, 10);
const dateOfYmd = (ymd) => new Date(ymd + 'T00:00:00Z');
const clockLabel = (min) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const isClosedDay = (d) => (S.slots?.CLOSED_WEEKDAYS || [1]).includes(d.getUTCDay());

// 30-minute slots of one day; today starts at the next half hour (delivery: 45 minutes from now).
function daySlots(ymd, lead = 0) {
  const L = S.slots, now = reginaNow(), today = ymdOf(now) === ymd, d = dateOfYmd(ymd);
  if (!L || isClosedDay(d)) return [];
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let first = L.OPEN_FROM_MIN;
  if (today) first = Math.max(first, Math.ceil((nowMin + Math.max(lead, 1)) / L.SLOT_MINUTES) * L.SLOT_MINUTES);
  const short = `${DOW3[d.getUTCDay()]} ${MON3[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const out = [];
  for (let m = first; m + L.SLOT_MINUTES <= L.OPEN_TO_MIN; m += L.SLOT_MINUTES) out.push({ label: L.slotLabel(m), value: today ? L.slotLabel(m) : `${short} · ${L.slotLabel(m)}` });
  return out;
}

function timeMode(slot) {
  if (!slot) return 'asap';
  if (/\(in \d+ min\)/.test(slot)) return 'off';
  if (slot.includes(' · ')) return 'date';
  return 'time';
}

function slotsHtml() {
  const s = U.start;
  if (!S.slots) return '';
  const pickup = s.type !== 'delivery';
  const m = s.tmode;
  const chip = (act, attrs, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" data-act="${act}" ${attrs}>${label}</button>`;
  const now = reginaNow(), nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let row = chip('tmode', 'data-m="asap"', pickup ? 'ASAP' : 'ASAP (45+ min)', m === 'asap');
  row += (pickup ? PICKUP_OFFSETS : DELIVERY_OFFSETS).map((n) => chip('toff', `data-n="${n}"`, `${n} min`, m === 'off' && s.slot.includes(`(in ${n} min)`))).join('');
  row += chip('tmode', 'data-m="time"', 'Pick a time', m === 'time') + chip('tmode', 'data-m="date"', 'Pick a date', m === 'date');
  let more = '';
  if (m === 'time') {
    const list = daySlots(ymdOf(now), pickup ? 0 : DELIVERY_MIN_LEAD);
    more = `<div class="chips slots">${list.map((x) => chip('slot', `data-v="${esc(x.value)}"`, esc(x.label), s.slot === x.value)).join('') || '<span class="muted">No time slots left today. Pick a date.</span>'}</div>`;
  } else if (m === 'date') {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + s.cal, 1));
    const last = new Date(now.getTime() + CAL_DAYS_AHEAD * 86400000), todayYmd = ymdOf(now);
    const cells = [];
    for (let i = 0; i < base.getUTCDay(); i++) cells.push('<span></span>');
    for (let day = 1; ; day++) {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day));
      if (d.getUTCMonth() !== base.getUTCMonth()) break;
      const ymd = ymdOf(d), off = ymd < todayYmd || d > last || isClosedDay(d) || !daySlots(ymd, pickup ? 0 : DELIVERY_MIN_LEAD).length;
      cells.push(`<button type="button" class="cal-day ${s.tdate === ymd ? 'on' : ''} ${ymd === todayYmd ? 'today' : ''}" data-act="tdate" data-d="${ymd}" ${off ? 'disabled' : ''}>${day}</button>`);
    }
    const head = `<div class="cal-head"><button type="button" class="btn sm" data-act="tcal" data-d="-1" ${s.cal <= 0 ? 'disabled' : ''}>‹</button>
      <b>${MON3[base.getUTCMonth()]} ${base.getUTCFullYear()}</b><button type="button" class="btn sm" data-act="tcal" data-d="1" ${s.cal >= 2 ? 'disabled' : ''}>›</button></div>`;
    more = `<div class="cal">${head}<div class="cal-grid">${DOW3.map((x) => `<span class="cal-dow">${x.slice(0, 2)}</span>`).join('')}${cells.join('')}</div></div>`;
    if (s.tdate) more += `<div class="chips slots">${daySlots(s.tdate, pickup ? 0 : DELIVERY_MIN_LEAD).map((x) => chip('slot', `data-v="${esc(x.value)}"`, esc(x.label), s.slot === x.value)).join('')}</div>`;
  }
  const e = s.tried ? startErrors() : {};
  return `<div class="field"><label>${pickup ? 'Pickup' : 'Delivery'} time <span class="muted">· ${esc(s.slot || 'ASAP')}</span></label>
    <div class="chips">${row}</div>${more}${e.slot ? `<span class="ferr">${e.slot}</span>` : ''}</div>`;
}

// "in 20 min" → "1:05 PM (in 20 min)"; stored on the order like a slot.
function pickupIn(n) {
  const now = reginaNow(), min = now.getUTCHours() * 60 + now.getUTCMinutes() + Number(n);
  return `${clockLabel(min)} (in ${n} min)`;
}

function aptInput(e) {
  const s = U.start, apt = startPlace() === 'apartment';
  const a = startAddress() || s.street;
  const ph = !apt ? 'Apt / suite / buzzer (optional)' : isTrailer(a) ? 'Lot number (required, e.g. A24)' : isHotelAddress(a) ? 'Room number (required, or Lobby)' : 'Unit / suite / apt number (required, or Lobby)';
  return `<input id="s-apt" class="input" value="${esc(s.apt)}" placeholder="${ph}" data-input="apt" ${e.apt ? 'aria-invalid="true"' : ''}>`;
}

function startErrors() {
  const s = U.start, e = {};
  if (s.phone && s.phone.length !== 10) e.phone = 'Enter all 10 digits, or clear it for a walk-in.';
  if (s.type === 'delivery' && s.phone.length !== 10) e.phone = 'Delivery needs a phone number.';
  if (s.type === 'pickup' && !s.phone && !s.name.trim()) e.name = 'Enter a name or a phone number.';
  if (s.type === 'delivery' && !startAddress()) e.addr = 'Enter the delivery address.';
  if (s.type !== 'dinein' && s.tmode === 'date' && !s.slot) e.slot = s.tdate ? 'Pick a time for that date.' : 'Pick a date and a time.';
  if (startAddress() && needsUnit()) {
    const a = startAddress();
    e.apt = isTrailer(a) ? 'Trailer court delivery: enter the lot number (e.g. A24).' : isHotelAddress(a) ? 'Hotel delivery: enter the room number (or Lobby).' : 'Apartment delivery: enter the unit / suite / apt number (or Lobby).';
  }
  return e;
}

function startModal() {
  const s = U.start, e = s.tried ? startErrors() : {}, c = s.lookup;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  const pad = keys.map((k) => `<button type="button" class="${k.length > 1 ? 'fn' : ''}" data-act="key" data-k="${k}">${k === 'clear' ? 'Clear' : k === 'back' ? '⌫' : k}</button>`).join('');
  const status = s.phone.length < 10 ? (s.phone ? `${10 - s.phone.length} more digit(s)` : 'Type the caller’s number')
    : s.state === 'loading' ? 'Looking up…' : s.state === 'error' ? 'Lookup failed: ' + esc(s.err)
    : c && c.found ? 'Returning customer' : 'New customer';
  const since = c && c.found && c.stats.first_order_at ? fmtDate(c.stats.first_order_at) : '';
  const banner = s.phone.length === 10 && s.state === 'done'
    ? (c.found ? `<div class="cbanner found">${esc(c.name || 'Returning customer')}<small>${c.stats.order_count} order(s) · ${$m(c.stats.total_spent)} spent${since ? ' · since ' + since : ''}</small></div>`
      : '<div class="cbanner new">No orders from this number yet<small>Enter the name below.</small></div>') : '';
  const types = [['pickup', 'Pickup', 'Customer collects at the counter'], ['delivery', 'Delivery', `Driver takes it · ${$c(DELIVERY_FEES.house)} house / ${$c(DELIVERY_FEES.apartment)} apartment`]]
    .map(([k, n, dsc]) => `<button type="button" class="typecard ${s.type === k ? 'on' : ''}" data-act="stype" data-t="${k}" aria-pressed="${s.type === k}"><b>${n}</b><span>${dsc}</span></button>`).join('');
  const saved = c?.addresses || [];
  const addrList = s.type === 'delivery' ? `<div class="field"><label>Delivery address <span class="req">*</span></label>
    ${saved.length ? `<div class="alist">${saved.map((a, i) => `<button type="button" class="addr ${s.addrIdx === i ? 'on' : ''}" data-act="pickAddr" data-i="${i}"><span>${esc(a)}</span>${i === 0 ? '<span class="pill tag">Last used</span>' : ''}</button>`).join('')}
      <button type="button" class="addr ${s.addrIdx < 0 ? 'on' : ''}" data-act="pickAddr" data-i="-1">New address</button></div>` : ''}
    ${s.addrIdx < 0 ? `<div class="ac"><div class="row" style="flex-wrap:nowrap"><input id="s-street" class="input" value="${esc(s.street)}" placeholder="House # and street (740 thatcher), hotel (temple) or apartment (langdon)" autocomplete="off" autocorrect="off" spellcheck="false" data-input="street" ${e.addr ? 'aria-invalid="true"' : ''}>
        <button type="button" class="btn sm" data-act="hotels">Hotels</button></div>
        <div class="acdrop" id="acdrop" hidden></div></div>
      ${aptInput(e)}` : s.addrIdx >= 0 && (needsUnit() || s.apt) ? aptInput(e) : ''}
    ${e.addr ? `<span class="ferr">${e.addr}</span>` : ''}${e.apt ? `<span class="ferr">${e.apt}</span>` : ''}
    <div class="chips" role="group" aria-label="Delivery to">${Object.entries(PLACES).map(([k, n]) => `<button type="button" class="chip ${startPlace() === k ? 'on' : ''}" data-act="splace" data-p="${k}" aria-pressed="${startPlace() === k}">${n} · ${$c(DELIVERY_FEES[k])}</button>`).join('')}</div></div>` : '';
  const hist = c && c.found && c.orders.length ? `<div class="field"><label>Order history (${c.orders.length})</label><div class="alist">${c.orders.map((o, i) => {
    const sum = o.items.filter((it) => !it.free).map((it) => `${it.qty}× ${shortName(it.name)}`).join(', ');
    return `<div class="hist ${o.status === 'cancelled' ? 'cancelled' : ''}"><span class="muted">${fmtDate(o.created_at)}</span><span class="sum" title="${esc(sum)}">${o.delivery_type === 'delivery' ? 'Delivery' : o.delivery_type === 'dinein' ? 'Dine-in' : 'Pickup'} · ${esc(sum)}</span>
      <b class="num">${$m(o.total)}</b><button type="button" class="btn sm" data-act="reorder" data-i="${i}">Reorder</button></div>`;
  }).join('')}</div></div>` : '';
  const body = `<div class="startgrid">
    <div>
      <div class="phonebig num" aria-live="polite">${s.phone ? formatPhone(s.phone) : '<span class="muted">306-___-____</span>'}</div>
      <input id="s-phone" class="input" type="tel" inputmode="none" autocomplete="off" value="${esc(formatPhone(s.phone))}" placeholder="Or type the phone here" data-input="phone" ${e.phone ? 'aria-invalid="true"' : ''}>
      ${e.phone ? `<span class="ferr">${e.phone}</span>` : ''}
      <div class="keypad area" role="group" aria-label="Area code">${['306', '639'].map((c) => `<button type="button" class="${s.phone.startsWith(c) ? 'on' : ''}" data-act="area" data-c="${c}">${c}</button>`).join('')}</div>
      <div class="keypad">${pad}</div>
      <div class="muted" style="text-align:center">${status}</div>
    </div>
    <div>
      ${banner}
      ${c && c.found && c.notes ? `<div class="cnotes">${esc(c.notes)}</div>` : ''}
      <div class="typegrid" role="group" aria-label="Order type">${types}</div>
      ${slotsHtml()}
      <div class="field"><label for="s-name">Customer name</label><input id="s-name" class="input" value="${esc(s.name)}" autocomplete="off" data-input="name" ${e.name ? 'aria-invalid="true"' : ''}>${e.name ? `<span class="ferr">${e.name}</span>` : ''}</div>
      ${addrList}
      <div class="field"><label for="s-notes">Order notes <span class="muted">(optional)</span></label><input id="s-notes" class="input" value="${esc(s.notes)}" placeholder="e.g. call on arrival, extra napkins" data-input="notes" maxlength="500"></div>
      ${hist}
    </div>
  </div>`;
  const go = s.edit ? 'Save customer' : `Start ${TYPES[s.type].toLowerCase()} order`;
  return sheet(s.edit ? 'Customer' : 'New order', s.edit ? esc(U.draft.id || 'New order') : 'Ask for the phone number first', body,
    `${!s.edit ? '<button class="btn ghost" data-act="seatPick">Dine-in · pick a table</button><span style="flex:1"></span>' : ''}
     <button class="btn" data-act="close">Cancel</button><button class="btn accent" data-act="startGo" ${s.state === 'loading' ? 'disabled' : ''}>${go}</button>`, true);
}

async function startGo(reorderIdx = null) {
  const s = U.start;
  s.tried = true;
  if (Object.keys(startErrors()).length) { renderModal(); return; }
  const fields = { type: s.type, name: s.name.trim(), phone: s.phone, addr: s.type === 'delivery' ? startAddress() : '', place: startPlace(), notes: s.notes.trim(), slot: s.slot };
  if (s.edit) {
    Object.assign(U.draft, fields);
    touch();
  } else {
    if (U.draft && !(await holdDraft())) return;
    U.draft = newDraft(s.type, { ...fields, source: s.phone ? 'Phone' : 'Walk-in' });
    if (reorderIdx != null) copyOrder(s.lookup.orders[reorderIdx]);
  }
  const pi = s.pendingItem;
  U.start = null; U.modal = null; U.view = 'register'; U.fan = false;
  renderModal(); render();
  if (!s.edit) toast(`${TYPES[U.draft.type]} order started`);
  if (pi) tapItem(pi);
}

// Reorder: today's menu and prices; dishes no longer on the menu are skipped (and named).
function copyOrder(o) {
  const missing = [];
  for (const line of o.items) {
    if (line.free) continue;
    const item = line.id != null && S.byId.get(line.id)
      || S.menu.find((m) => line.code && m.code && m.code.toUpperCase() === String(line.code).toUpperCase())
      || S.menu.find((m) => shortName(m.name).toLowerCase() === shortName(line.name).toLowerCase());
    if (!item || S.sold.has(item.id)) { missing.push(shortName(line.name) + (item ? ' (sold out)' : '')); continue; }
    const valid = (line.mods || []).filter((m) => groupsFor(item.id).some((g) => g.id === m.g && g.options.some((op) => op.name === m.n)));
    addLine(item, valid.map((m) => ({ g: m.g, n: m.n })), line.note || '', line.qty);
  }
  if (missing.length) setTimeout(() => toast('Not added: ' + missing.join(', ')), 300);
}

// ---------- street / hotel / apartment autocomplete ----------
const isLodging = (p) => !['Apartment', 'Trailer court'].includes(p.type);
const isTrailer = (addr) => {
  const p = U.start.hotel || (S.address && S.address.findPlace(addr, { buildings: S.buildings }));
  return Boolean(p && p.type === 'Trailer court') || /trailer (court|crt|park)/i.test(addr || '');
};
let placesCache = null;
const allPlaces = () => (placesCache ??= [
  ...S.hotels,
  ...S.buildings.map((b) => ({ ...b, type: b.type || 'Apartment', street: b.address, address: [b.address, ...(b.also || [])].join(' / ') || b.name,
    display: (b.address || 'Address not on file') + (b.also?.length ? ` (+${b.also.length} more)` : '') })),
]);
function streetSearch(q, all = false) {
  const s = U.start;
  if (!S.search) return;
  // Hotels and apartment buildings, found by name ("langdon") or by street address ("450 langdon").
  const hotels = all ? S.search.searchPlaces(S.hotels, q).map((r) => ({ kind: 'hotel', ...r }))
    : /[a-z]{2}/i.test(q) ? S.search.searchPlaces(allPlaces(), q, 6).map((r) => ({ kind: 'hotel', ...r })) : [];
  const streets = all || !q.trim() ? [] : S.search.searchStreets(S.streets, q);
  s.ac = { list: [...hotels, ...streets], i: -1 };
  drawAc();
}
function drawAc() {
  const el = $('acdrop');
  if (!el) return;
  const { list, i: active } = U.start.ac;
  el.hidden = !list.length;
  let shownStreets = false;
  el.innerHTML = list.map((r, i) => {
    if (r.kind === 'hotel') {
      const name = r.positions.length ? S.search.fuzzyHighlight(r.place.name, r.positions) : esc(r.place.name);
      return `${i === 0 ? '<div class="grp-h">HOTELS & APARTMENTS</div>' : ''}<button type="button" class="acitem ${i === active ? 'on' : ''}" data-act="acPick" data-i="${i}"><span>${name}<br><small>${esc(r.place.display || r.place.address)}</small></span><small>${esc(r.place.type || 'Hotel')}</small></button>`;
    }
    const head = !shownStreets && i > 0 ? '<div class="grp-h">STREETS</div>' : '';
    shownStreets = true;
    const street = r.positions && r.positions.length ? S.search.fuzzyHighlight(r.street, r.positions) : esc(r.street);
    return `${head}<button type="button" class="acitem ${i === active ? 'on' : ''}" data-act="acPick" data-i="${i}"><span>${r.house ? `<b>${esc(r.house)}</b> ` : ''}${street}</span><small>${esc(r.typeTag || '')}</small></button>`;
  }).join('');
}
function acPick(i) {
  const s = U.start, r = s.ac.list[i];
  if (!r) return;
  if (r.kind === 'hotel') {
    // A building named by its street address ("217 High St E") is not repeated.
    const street = r.place.street || r.place.address;
    s.street = !street || r.place.name === street ? r.place.name || street : `${r.place.name}, ${street}`;
    s.hotel = r.place;
    toast(`${r.place.name}: ask for the ${r.place.type === 'Trailer court' ? 'lot' : isLodging(r.place) ? 'room' : 'unit'} number`);
  }
  else { s.street = r.full; s.hotel = null; }
  s.ac = { list: [], i: -1 };
  renderModal();
  setTimeout(() => $('s-apt')?.focus(), 50);
}

// ---------- dine-in: pick a table ----------
// The same floor map as Register → Dine-in: tap a free table to seat it, a seated one to see its check.
function seatModal() {
  return sheet('Seat a table', 'Dine in', floorHtml(), '<button class="btn" data-act="seatNone">Dine-in without a table</button>', true);
}
async function seatTable(tableId) {
  const open = tableId && openTableOrder(tableId);
  if (open) { await openExisting(open.id); return; }
  if (U.draft && !(await holdDraft())) return;
  U.draft = newDraft('dinein', { table: tableId || null, source: 'Walk-in' });
  U.modal = null; U.view = 'register'; U.fan = false;
  renderModal(); render();
  toast(tableId ? `Table ${tableId} seated` : 'Dine-in order started');
}

async function openExisting(id) {
  const o = S.orders.find((x) => x.id === id);
  if (!o || !isPos(o) || o.status !== 'pending') return;
  if (U.draft && U.draft.id !== id && !(await holdDraft())) return;
  if (!U.draft || U.draft.id !== id) U.draft = draftFromOrder(o);
  U.modal = null; U.view = 'register'; U.fan = false;
  renderModal(); render();
}

// Caller ID hook: /staff/#call=3065551234 opens a phone order for that number.
function handleCallHash() {
  const m = location.hash.match(/^#call=(\+?[\d-]+)$/);
  if (!m) return;
  if (ROLE !== 'pos') { location.replace('/pos/' + location.hash); return; } // phone orders are taken on the POS
  history.replaceState(null, '', location.pathname + location.search);
  if (U.draft && U.draft.dirty) { toast(`Incoming call ${formatPhone(digitsOf(m[1]))}: finish the current order first`); return; }
  U.view = 'register';
  openStart('pickup', { phone: m[1] });
  render();
}
window.addEventListener('hashchange', handleCallHash);
