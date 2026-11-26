// Jade Garden staff app: shared state, helpers, server sync, sound.
// The server (D1) is the source of truth for orders, payments, tickets, options and
// sold-out dishes. Prices shown here are estimates; every save returns the server's numbers.
'use strict';

// Three sites, one app: the address decides the role, and each role has its own Cloudflare
// Access sign-in and API (worker/auth/staff.js):
//   /pos/     phone & counter orders, dine-in, payments   → /api/pos/*
//   /staff/   kitchen display (and the order list)         → /api/kitchen/*
//   /jadmin/  menu settings: options, sold out, combos     → /api/admin/*
const ROLE = location.pathname.startsWith('/pos') ? 'pos' : location.pathname.startsWith('/jadmin') ? 'admin' : 'kitchen';
const API = `/api/${ROLE}`;
const ROLE_VIEWS = { pos: ['register', 'tables', 'menu'], kitchen: ['kds', 'tables', 'menu'], admin: ['menu'] };
const ROLE_TITLE = { pos: 'POS', kitchen: 'Kitchen', admin: 'Admin' };
const can = { order: ROLE === 'pos', pay: ROLE === 'pos', bump: ROLE === 'kitchen', orders: ROLE !== 'admin' };

const TAX_PERCENT = 11; // Saskatchewan GST 5% + PST 6% (worker/lib/util.js)
const TAX_NAME = 'GST + PST 11%';
// Delivery: $7 to a house, $8 to an apartment, condo or hotel (worker/lib/util.js). Not taxed.
const DELIVERY_FEES = { house: 700, apartment: 800 };
const PLACES = { house: 'House', apartment: 'Apartment / hotel' };
// Automatic answer for an address (same rule as the server: web/src/lib/address.js, hotel list,
// apartment-building list, unit numbers). Staff can switch it on the order.
const guessPlace = (addr) => (S.address ? S.address.placeForAddress(addr, { hotels: S.hotels, buildings: S.buildings }) : 'house');
const TYPES = { dinein: 'Dine-in', pickup: 'Pickup', delivery: 'Delivery' };

// Floor plan (percent of the room). Ids are stored on dine-in orders (orders.table_id).
const TABLES = [
  { id: 'W1', seats: 4, x: 33.17, y: 1.46, w: 13.57, h: 8.0 },
  { id: 'W2', seats: 4, x: 53.27, y: 1.46, w: 13.57, h: 8.0 },
  { id: 'W3', seats: 4, x: 69.05, y: 1.46, w: 13.37, h: 8.0 },
  { id: 'W4', seats: 4, x: 84.92, y: 1.46, w: 13.27, h: 8.0 },
  { id: 'R2', seats: 10, x: 49.05, y: 15.32, w: 19.1, h: 18.54, round: true },
  { id: 'R1', seats: 10, x: 53.47, y: 35.61, w: 19.1, h: 18.54, round: true },
  { id: 'L3', seats: 10, x: 78.39, y: 15.32, w: 17.09, h: 13.46 },
  { id: 'L2', seats: 10, x: 78.39, y: 31.51, w: 17.09, h: 13.46 },
  { id: 'L1', seats: 14, x: 70.35, y: 47.8, w: 25.13, h: 15.12 },
  { id: 'A5', seats: 4, x: 0.2, y: 29.27, w: 8.34, h: 12.88 },
  { id: 'B5', seats: 4, x: 14.57, y: 29.27, w: 8.44, h: 12.88 },
  { id: 'C5', seats: 4, x: 28.44, y: 29.27, w: 8.44, h: 12.88 },
  { id: 'A4', seats: 4, x: 0.2, y: 43.12, w: 8.34, h: 12.68 },
  { id: 'B4', seats: 6, x: 14.37, y: 43.12, w: 11.86, h: 12.68 },
  { id: 'C4', seats: 2, x: 31.46, y: 43.12, w: 5.53, h: 12.68 },
  { id: 'A3', seats: 4, x: 0.2, y: 56.88, w: 8.34, h: 12.88 },
  { id: 'B3', seats: 6, x: 14.37, y: 56.88, w: 11.86, h: 12.88 },
  { id: 'C3', seats: 2, x: 31.46, y: 56.88, w: 5.53, h: 12.88 },
  { id: 'A2', seats: 4, x: 0.2, y: 70.73, w: 8.34, h: 12.68 },
  { id: 'B2', seats: 6, x: 14.37, y: 70.73, w: 11.86, h: 12.68 },
  { id: 'C2', seats: 2, x: 31.46, y: 70.73, w: 5.53, h: 12.68 },
  { id: 'A1', seats: 4, x: 0.2, y: 84.59, w: 8.34, h: 12.68 },
  { id: 'B1', seats: 4, x: 14.57, y: 84.59, w: 8.44, h: 12.68 },
  { id: 'C1', seats: 4, x: 28.44, y: 84.59, w: 8.44, h: 12.68 },
];
const FLOOR_DECOR = [
  { k: 'pillar', x: 46.93, y: 0, w: 5.13, h: 8, label: '' },
  { k: 'pillar', x: 46.53, y: 37.85, w: 5.83, h: 18.83, label: '' },
  { k: 'pillar', x: 0, y: 98.54, w: 6.03, h: 1.46, label: '' },
  { k: 'zone', x: 0, y: 0, w: 15.58, h: 19.51, label: 'Entrance' },
  { k: 'zone', x: 46.23, y: 65.17, w: 53.77, h: 24.1, label: 'Washrooms' },
  { k: 'zone', x: 46.23, y: 89.27, w: 53.77, h: 10.73, label: 'Service corridor' },
  { k: 'window', x: 24.12, y: 0, w: 75.38, h: 0.59, label: '' },
];
const tableById = (id) => TABLES.find((t) => t.id === id);

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
// Every server string is escaped when rendered (all views use innerHTML).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cents = (dollars) => Math.round(Number(dollars || 0) * 100);
const $c = (c) => (c < 0 ? '−$' : '$') + (Math.abs(c) / 100).toFixed(2);
const $m = (d) => $c(cents(d));
const uid = () => Math.random().toString(36).slice(2, 12);
const mins = (iso) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-CA', { timeZone: 'America/Regina', hour: 'numeric', minute: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Regina', month: 'short', day: 'numeric', year: '2-digit' });
const shortName = (name) => String(name || '').replace(/^[A-Z]{1,2}\d+[A-Za-z]?\.?\s+/, '');
// One order line in a summary: "1× Chicken Low Mein (Low Mein (Soft Skinny Noodles))". Options the
// customer picked are kept; WooCommerce ones ("Noodle Type: Low Mein") show just the choice.
const modText = (m) => (m.g === 'wc' && m.group && m.n.startsWith(m.group + ': ') ? m.n.slice(m.group.length + 2) : m.n);
const lineSummary = (it) => `${it.qty}× ${shortName(it.name)}${it.mods && it.mods.length ? ` (${it.mods.map(modText).join(', ')})` : ''}`;
const formatPhone = (d) => (d.length > 6 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d);
const digitsOf = (s) => {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.slice(0, 10);
};
const addressKey = (a) => String(a || '').toLowerCase().replace(/[\s,.]+/g, ' ').trim();
const isTouch = () => window.matchMedia('(hover: none)').matches;

// Kitchen short names ("short" in data/menu.json): bold on top, full name underneath.
// Looked up by menu id, or by the dish name for ticket / order lines that only kept the name.
function shortOf(idOrName) {
  const item = typeof idOrName === 'number' ? S.byId.get(idOrName) : S.byName.get(String(idOrName || '').toLowerCase());
  return item?.short || '';
}
function dishHtml(name, idOrName = name, cls = 'dn') {
  const short = shortOf(idOrName), full = shortName(name);
  return short ? `<span class="${cls}"><b class="dn-short">${esc(short)}</b><span class="dn-full">${esc(full)}</span></span>`
    : `<span class="${cls}"><b class="dn-short">${esc(full)}</b></span>`;
}

// Order numbers as staff say them: WooCommerce imports show the WordPress number (#2565).
const orderNo = (o) => (o.id.startsWith('WC-') ? '#' + o.id.slice(3) : o.id);
const isPos = (o) => o.source === 'Phone' || o.source === 'Walk-in';
const sourceTag = (o) => o.source === 'Web' ? '<span class="src web">Online</span>'
  : o.source === 'WooCommerce' ? '<span class="src wc">WordPress</span>'
  : `<span class="src">${esc(o.source)}</span>`;

// ---------- state ----------
const S = {
  menu: [], byId: new Map(), byName: new Map(), cats: [], groups: [], sold: new Set(), combos: new Map(),
  canEditCombos: false, canEditOptions: false, streets: [], hotels: [], buildings: [], search: null, address: null,
  orders: [], tickets: [], loaded: false,
};
const U = {
  view: ROLE_VIEWS[ROLE][0], cat: null, q: '', ocat: 'all',
  modal: null, draft: null, fan: false, panelMin: false,
};
const MINE = new Set(); // orders created on this device (no ringtone for them)

// ---------- money (mirror of worker/services/staffOrders.js) ----------
const discCents = (d, base) => (!d ? 0 : d.t === 'pct' ? Math.round((base * d.v) / 100) : Math.min(d.v, base));
const discLabel = (d) => (d.t === 'pct' ? (d.v >= 100 ? 'Comp' : d.v + '% off') : $c(d.v) + ' off');
function groupsFor(itemId) { return S.groups.filter((g) => g.item_ids.includes(itemId)); }
// Dishes that can be made gluten free (the gluten_free option group).
const isGf = (itemId) => S.groups.some((g) => g.id === 'gluten_free' && g.item_ids.includes(itemId));
// Open the option picker when a dish is tapped: a required choice, or options that cost extra (extra people).
// Tapping a dish opens its options when a choice is required or priced, and for spice level and
// gluten free (so staff ask the customer). Requests stay on the line's edit window.
const ASK_GROUPS = ['spice', 'gluten_free'];
const asksOptions = (itemId) => groupsFor(itemId).some((g) => g.min > 0 || ASK_GROUPS.includes(g.id) || g.options.some((o) => o.price_cents > 0));
function modPriceCents(m) {
  const g = S.groups.find((x) => x.id === m.g);
  const o = g && g.options.find((x) => x.name === m.n);
  return o ? o.price_cents : cents(m.price);
}
function unitCents(l) {
  const item = S.byId.get(l.id);
  const base = item ? cents(item.price) : cents(l.price) - l.mods.reduce((s, m) => s + cents(m.price), 0);
  return base + l.mods.reduce((s, m) => s + modPriceCents(m), 0);
}
const grossCents = (l) => unitCents(l) * l.qty;
const lineDiscCents = (l) => discCents(l.disc, grossCents(l));
const netCents = (l) => grossCents(l) - lineDiscCents(l);
function draftTotals(d) {
  const sub = d.lines.reduce((s, l) => s + grossCents(l), 0);
  const itemDisc = d.lines.reduce((s, l) => s + lineDiscCents(l), 0);
  const after = sub - itemDisc;
  const orderDisc = discCents(d.disc, after);
  const fee = d.type === 'delivery' ? DELIVERY_FEES[d.place] ?? DELIVERY_FEES.house : 0;
  const tax = Math.round((Math.max(0, after - orderDisc) * TAX_PERCENT) / 100); // food only
  const total = after - orderDisc + fee + tax;
  const paid = d.paid || 0;
  return { sub, itemDisc, after, orderDisc, fee, tax, total, paid, balance: total - paid };
}

// ---------- server ----------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Staff sign-in expired. Reload the page to sign in again.');
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}

function upsertOrder(o) {
  const i = S.orders.findIndex((x) => x.id === o.id);
  if (i >= 0) S.orders[i] = o;
  else S.orders.unshift(o);
}

// Polling: one full load, then only what changed since the previous poll (cheap in D1).
const POLL_MS = 15000;
const FULL_REFRESH_MS = 10 * 60 * 1000;
const POLL_OVERLAP_MS = 60 * 1000;
const HISTORY_DAYS = 7;
let lastServerTime = null;
let lastFull = 0;
let knownOrders = null;
let knownTickets = null;
let syncFailed = false;

function mergeById(list, changed, keep) {
  const byId = new Map(list.map((x) => [x.id, x]));
  for (const x of changed) byId.set(x.id, x);
  return [...byId.values()].filter(keep);
}

async function refresh({ full = false } = {}) {
  try {
    const delta = !full && lastServerTime && Date.now() - lastFull < FULL_REFRESH_MS;
    const since = delta ? new Date(Date.parse(lastServerTime) - POLL_OVERLAP_MS).toISOString() : null;
    const data = await api('GET', `${API}/orders` + (since ? '?since=' + encodeURIComponent(since) : ''));
    if (delta && (data.orders.length >= 500 || data.tickets.length >= 500)) return refresh({ full: true });
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
    const tcut = new Date(Date.now() - 12 * 3600000).toISOString();
    S.orders = (delta ? mergeById(S.orders, data.orders, (o) => o.status === 'pending' || o.created_at >= cutoff) : data.orders)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    S.tickets = delta ? mergeById(S.tickets, data.tickets, (t) => !t.done_at || t.created_at >= tcut) : data.tickets;
    S.sold = new Set(data.sold_out || []);
    if (!delta) lastFull = Date.now();
    lastServerTime = data.server_time;

    // Chime for orders and kitchen tickets that other devices or the website created.
    const newOrders = knownOrders ? S.orders.filter((o) => o.status === 'pending' && !knownOrders.has(o.id) && !MINE.has(o.id)) : [];
    const newTickets = knownTickets ? S.tickets.filter((t) => !t.done_at && !knownTickets.has(t.id) && !MINE.has(t.order_id)) : [];
    knownOrders = new Set(S.orders.map((o) => o.id));
    knownTickets = new Set(S.tickets.map((t) => t.id));
    syncDraftFromServer();
    if (syncFailed) toast('Connection restored');
    syncFailed = false;
    setSync();
    render();
    const playing = newTickets.length && !unreceived().length ? await ringBriefly() : await updateRinging();
    if (newOrders.length || newTickets.length) {
      const n = newOrders.length || newTickets.length;
      toast(`${n} new ${newOrders.length ? 'order' : 'kitchen ticket'}${n > 1 ? 's' : ''}` + (sound.on && !playing ? ' · sound is blocked, tap anywhere' : ''));
    }
  } catch (e) {
    if (!syncFailed) toast('Cannot reach the server: ' + e.message);
    syncFailed = true;
    setSync();
  }
}

function setSync() {
  const el = $('sync');
  if (!el) return;
  if (!can.orders) { el.textContent = ''; return; } // the admin site does not follow orders
  el.className = 'sync' + (syncFailed ? ' bad' : '');
  el.textContent = syncFailed ? 'Offline' : lastServerTime ? 'Synced ' + fmtTime(lastServerTime) : 'Connecting…';
}

// ---------- sound ----------
// The restaurant's ringtone (/staff-app/ringtone.mp3). It loops while any website or WordPress
// order is waiting for someone to tap "Received" (on any screen), and plays a few seconds
// for kitchen tickets sent from another iPad. Browsers block sound until the first tap.
const sound = { on: localStorage.getItem('jg_sound_enabled') !== 'false', audio: null, blocked: false, briefUntil: 0 };
function ringAudio() {
  if (!sound.audio) {
    sound.audio = new Audio('/staff-app/ringtone.mp3');
    sound.audio.loop = true;
    sound.audio.preload = 'auto';
  }
  return sound.audio;
}
// Online orders nobody has acknowledged yet.
const unreceived = () => S.orders.filter((o) => !isPos(o) && o.status === 'pending' && !o.received_at);

async function updateRinging() {
  const a = ringAudio();
  const want = sound.on && (unreceived().length > 0 || Date.now() < sound.briefUntil);
  if (want && a.paused) {
    try { await a.play(); sound.blocked = false; } catch { sound.blocked = true; }
  } else if (!want && !a.paused) {
    a.pause();
    a.currentTime = 0;
  }
  soundButton();
  return !a.paused;
}
// A few seconds of the ringtone (kitchen tickets from another iPad, the sound test).
function ringBriefly(ms = 6000) {
  sound.briefUntil = Date.now() + ms;
  setTimeout(updateRinging, ms + 50);
  return updateRinging();
}
function unlockAudio() { if (sound.blocked) updateRinging(); }
['pointerdown', 'touchstart', 'keydown'].forEach((e) => window.addEventListener(e, unlockAudio, { passive: true, capture: true }));
function soundButton() {
  const b = $('soundBtn');
  if (!b) return;
  b.textContent = !sound.on ? 'Sound off' : sound.blocked ? 'Tap to enable sound' : 'Sound on';
  b.classList.toggle('off', !sound.on || sound.blocked);
}

// ---------- toast & clock ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
function tick() {
  const d = new Date();
  $('clock').textContent = d.toLocaleDateString('en-CA', { timeZone: 'America/Regina', weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + fmtTime(d.toISOString());
}

// ---------- modal sheet ----------
const sheet = (title, sub, body, foot, wide) => `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mt">
  <div class="shead"><div>${sub ? `<div class="eyebrow">${sub}</div>` : ''}<h2 id="mt">${title}</h2></div><button class="xbtn" data-act="close" aria-label="Close">✕</button></div>
  <div class="sbody">${body}</div>${foot ? `<div class="sfoot">${foot}</div>` : ''}</div>`;
