// Order screen: categories | dish tiles | the order being taken (the "draft").
// A draft is local until it is sent to the kitchen, held, or paid; then the server stores it
// as an open order (status 'pending') that any iPad can reopen from Register.
'use strict';

function newDraft(type, extra = {}) {
  return {
    id: null, type, source: type === 'dinein' ? 'Walk-in' : 'Phone', table: null,
    name: '', phone: '', addr: '', place: 'house', notes: '', slot: '', lines: [], disc: null, paid: 0,
    pendingVoids: [], removed: [], dirty: false, created_at: new Date().toISOString(), ...extra,
  };
}

function draftFromOrder(o) {
  return {
    id: o.id, type: o.delivery_type, source: o.source, table: o.table_id,
    name: o.customer_name, phone: digitsOf(o.customer_phone), addr: o.delivery_address, notes: o.customer_notes,
    place: o.delivery_place || guessPlace(o.delivery_address),
    slot: /^(ASAP|Pick Up|Dine-in)$/i.test(o.delivery_time_slot || '') ? '' : o.delivery_time_slot || '',
    lines: o.items.filter((it) => it.id != null).map((it) => ({
      uid: it.uid, id: it.id, qty: it.qty, sent: it.sent, note: it.note, disc: it.disc, price: it.price,
      mods: it.mods.map((m) => ({ g: m.g, n: m.n, price: m.price })),
    })),
    disc: o.order_discount, paid: cents(o.paid), pendingVoids: o.pending_voids || [], removed: [],
    dirty: false, created_at: o.created_at,
  };
}

// Another iPad (or a payment) changed the open order: follow it unless we have unsaved edits.
function syncDraftFromServer() {
  const d = U.draft;
  if (!d || !d.id || d.dirty) return;
  const o = S.orders.find((x) => x.id === d.id);
  if (!o) return;
  if (o.status !== 'pending') {
    U.draft = null;
    toast(`${o.id} was closed on another screen`);
    return;
  }
  U.draft = draftFromOrder(o);
}

const touch = () => { U.draft.dirty = true; };

const draftLabel = (d) => d.type === 'dinein' ? (d.table ? 'Table ' + d.table : 'Dine-in (no table)')
  : TYPES[d.type] + (d.name ? ' · ' + d.name : d.phone ? ' · ' + formatPhone(d.phone) : '');

function voidRows(d) {
  const rows = [...d.pendingVoids, ...d.removed];
  for (const l of d.lines) if (l.qty < l.sent) rows.push({ qty: l.sent - l.qty, name: itemName(l) });
  return rows;
}
const unsentCount = (d) => d.lines.reduce((a, l) => a + Math.max(0, l.qty - l.sent), 0) + voidRows(d).length;
const itemName = (l) => { const it = S.byId.get(l.id); return it ? it.name : 'Item ' + l.id; };
const modsKey = (mods) => mods.map((m) => m.g + ':' + m.n).join('|');

function addLine(item, mods = [], note = '', qty = 1, disc = null) {
  const d = U.draft;
  const same = d.lines.find((l) => l.id === item.id && modsKey(l.mods) === modsKey(mods) && l.note === note && !l.disc && !disc);
  if (same) same.qty += qty;
  else d.lines.push({ uid: uid(), id: item.id, qty, sent: 0, mods, note, disc });
  touch();
}

function setQty(l, q) {
  const d = U.draft;
  if (q <= 0) {
    if (l.sent > 0) d.removed.push({ qty: l.sent, name: itemName(l) });
    d.lines = d.lines.filter((x) => x !== l);
  } else l.qty = Math.min(50, q);
  touch();
}

// ---------- saving ----------
function draftBody(d, send) {
  return {
    delivery_type: d.type, source: d.source, table_id: d.type === 'dinein' ? d.table : null,
    customer_name: d.name, customer_phone: d.phone, delivery_address: d.type === 'delivery' ? d.addr : '', delivery_place: d.place,
    delivery_time_slot: d.type === 'dinein' ? '' : d.slot,
    customer_notes: d.notes, discount: d.disc, send,
    lines: d.lines.map((l) => ({ uid: l.uid, id: l.id, qty: l.qty, note: l.note, disc: l.disc, mods: l.mods.map((m) => ({ g: m.g, n: m.n })) })),
  };
}

let saving = false;
async function saveDraft({ send = false, quiet = false } = {}) {
  const d = U.draft;
  if (!d || saving) return false;
  if (!d.lines.length) {
    if (!d.id) { U.draft = null; render(); return true; }
    toast('An order needs at least one item. Cancel it from Register instead.');
    return false;
  }
  saving = true;
  try {
    const r = d.id ? await api('PUT', `${API}/orders/${encodeURIComponent(d.id)}`, draftBody(d, send))
      : await api('POST', `${API}/orders`, draftBody(d, send));
    MINE.add(r.order.id);
    upsertOrder(r.order);
    U.draft = draftFromOrder(r.order);
    if (!quiet) toast(send ? `Sent to kitchen · ${r.order.id}` : `Saved · ${r.order.id}`);
    if (send) refresh();
    return true;
  } catch (e) {
    toast('Not saved: ' + e.message);
    if (/sold out/i.test(e.message)) refresh();
    return false;
  } finally {
    saving = false;
    render();
  }
}

// Leaving the order screen keeps the order: unsaved changes are held (saved, not sent).
async function holdDraft() {
  const d = U.draft;
  if (!d) return true;
  if (d.dirty || (!d.id && d.lines.length)) return saveDraft({ quiet: true }).then((ok) => { if (ok) { toast(`Held · ${U.draft?.id || ''}`); U.draft = null; render(); } return ok; });
  U.draft = null;
  render();
  return true;
}

// ---------- views ----------
function viewRegister() {
  const d = U.draft;
  if (!U.cat || !S.cats.includes(U.cat)) U.cat = S.cats[0];
  const cats = S.cats.map((c) => `<button class="cat ${!U.q && U.cat === c ? 'on' : ''}" data-act="cat" data-c="${esc(c)}">${esc(c)}<span>${S.menu.filter((i) => i.category === c).length}</span></button>`).join('');
  return `<div class="register ${d ? '' : 'min'}">
    <nav class="cats" aria-label="Menu categories">${cats}</nav>
    <div class="itemcol">
      <div class="isearch"><input id="q" class="input" type="search" placeholder="Search code or name: A1, beef, wonton…" value="${esc(U.q)}" autocomplete="off" autocorrect="off" spellcheck="false" data-input="q">
        ${U.q ? '<button class="btn sm" data-act="clearQ">Clear</button>' : ''}</div>
      <section class="items" id="items" data-keep="items">${itemsHtml()}</section>
    </div>
    ${d ? orderPanel(d) : ''}
  </div>${d ? '' : fanHtml()}`;
}

// Owner's order for the set dinners (menu ids); other dishes keep the menu order.
const TILE_ORDER = [88, 89, 97, 98, 95, 99, 94, 96, 92, 91, 93, 90];
const tileRank = (i) => { const r = TILE_ORDER.indexOf(i.id); return r < 0 ? 1000 + S.menu.indexOf(i) : r; };

function itemsHtml() {
  const list = U.q && S.search ? S.search.searchMenu(S.menu, U.q).slice(0, 60).map((r) => r.item)
    : S.menu.filter((i) => i.category === U.cat).sort((a, b) => tileRank(a) - tileRank(b));
  if (!list.length) return `<div class="empty">${U.q ? 'No dish matches “' + esc(U.q) + '”.' : 'No dishes.'}</div>`;
  return list.map((i) => {
    const out = S.sold.has(i.id);
    const combo = (S.combos.get(i.id) || []).map((c) => (c.qty > 1 ? c.qty + '× ' : '') + shortName(c.name)).join(' · ');
    const opts = asksOptions(i.id);
    return `<button class="tile ${out ? 'out' : ''}" data-act="item" data-id="${i.id}" ${out ? 'disabled aria-disabled="true"' : ''}>
      ${i.code ? `<span class="tcode">${esc(i.code)}</span>` : ''}
      ${isGf(i.id) ? '<span class="gfmark" title="Gluten free available" aria-label="Gluten free available">GF</span>' : ''}
      ${dishHtml(i.name, i.id, 'tname')}
      ${combo ? `<span class="tdesc">${esc(combo)}</span>` : ''}
      <span class="tmeta"><span>${$m(i.price)}</span>
        <span class="tflags">${out ? '<span class="pill danger">Sold out</span>' : opts ? '<span class="pill">Options</span>' : ''}</span></span>
    </button>`;
  }).join('');
}

function orderPanel(d) {
  const T = draftTotals(d), pend = unsentCount(d);
  const seg = Object.entries(TYPES).map(([k, n]) => `<button class="${d.type === k ? 'on' : ''}" data-act="type" data-t="${k}" aria-pressed="${d.type === k}">${n}</button>`).join('');
  let fields;
  if (d.type === 'dinein') {
    const opts = TABLES.map((t) => {
      const other = openTableOrder(t.id);
      const busy = other && other.id !== d.id;
      return `<option value="${t.id}" ${d.table === t.id ? 'selected' : ''} ${busy ? 'disabled' : ''}>Table ${t.id}${busy ? ' (occupied)' : ''}</option>`;
    }).join('');
    fields = `<div class="field wide"><label for="f-table">Table</label><select id="f-table" class="input" data-change="table"><option value="">No table</option>${opts}</select></div>`;
  } else {
    const who = [d.name, d.phone ? formatPhone(d.phone) : ''].filter(Boolean).map(esc).join(' · ') || '<span class="muted">No customer yet</span>';
    fields = `<div class="field wide"><label>Customer</label>
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span>${who}${d.type === 'delivery' ? `<br><span class="muted">${d.addr ? esc(d.addr) : '<span class="st-danger">No delivery address</span>'}</span>` : ''}</span>
      <button class="btn sm" data-act="editCustomer">${d.name || d.phone ? 'Edit' : 'Add'}</button></div>
      <div class="muted" style="font-size:13px">${d.type === 'delivery' ? 'Deliver' : 'Pick up'}: <b class="${d.slot ? 'st-unsent' : ''}">${esc(d.slot || 'ASAP')}</b></div>
      ${d.type === 'delivery' ? `<div class="chips" role="group" aria-label="Delivery to">${Object.entries(PLACES).map(([k, n]) => `<button class="chip ${d.place === k ? 'on' : ''}" data-act="place" data-p="${k}" aria-pressed="${d.place === k}">${n} · ${$c(DELIVERY_FEES[k])}</button>`).join('')}</div>` : ''}</div>`;
  }
  const lines = d.lines.map((l) => {
    const nq = l.qty - l.sent;
    const chip = l.sent === 0 ? '<span class="pill st-new">New</span>' : nq > 0 ? `<span class="pill st-new">+${nq} new</span>` : '<span class="pill st-sent">Sent</span>';
    return `<div class="line">
      <button class="lmain" data-act="editLine" data-u="${l.uid}" aria-label="Edit ${esc(itemName(l))}">
        <span class="lq">${l.qty}×</span>
        <span class="lbody">
          <span class="lname">${dishHtml(itemName(l), l.id)} ${chip}</span>
          ${l.mods.length ? `<span class="lmods">${l.mods.map((m) => esc(m.n) + (modPriceCents(m) ? ' +' + $c(modPriceCents(m)) : '')).join(' · ')}</span>` : ''}
          ${l.note ? `<span class="lnote">Note: ${esc(l.note)}</span>` : ''}
          ${l.disc ? `<span class="ldisc">${discLabel(l.disc)} −${$c(lineDiscCents(l))}</span>` : ''}
        </span>
      </button>
      <div class="lright">
        <span class="lprice">${l.disc ? `<s>${$c(grossCents(l))}</s>` : ''}${$c(netCents(l))}</span>
        <span class="step"><button data-act="dec" data-u="${l.uid}" aria-label="One less">−</button><span>${l.qty}</span><button data-act="inc" data-u="${l.uid}" aria-label="One more">+</button></span>
      </div>
    </div>`;
  }).join('');
  const voids = voidRows(d).map((v) => `<div class="voidrow"><span>Void for kitchen: ${v.qty}× ${esc(shortName(v.name))}</span></div>`).join('');
  const paidInfo = T.paid ? `<div class="trow"><span>Paid so far</span><span>−${$c(T.paid)}</span></div><div class="trow"><b>Balance due</b><b>${$c(T.balance)}</b></div>` : '';
  const doneLabel = d.type === 'delivery' ? 'Out for delivery' : d.type === 'dinein' ? 'Close check' : 'Picked up';
  const can = d.lines.length > 0;
  return `<section class="panel" aria-label="Current order">
    <div class="ohead">
      <div><div class="eyebrow">${d.id ? esc(d.id) : 'New order'} · ${esc(d.source)} · opened ${fmtTime(d.created_at)}${d.dirty ? ' · <span class="st-unsent">not saved</span>' : ''}</div><h2>${esc(draftLabel(d))}</h2></div>
      <button class="minbtn" data-act="minPanel" aria-label="Put this order aside" title="Put this order aside (it is kept)">−</button>
    </div>
    <div class="pscroll" data-keep="pscroll">
    <div class="seg" style="grid-template-columns:repeat(3,1fr)" role="group" aria-label="Order type">${seg}</div>
    <div class="ofields">${fields}</div>
    <div class="lines">${lines || '<div class="empty"><b>No items yet</b><span>Tap a dish to add it. Tap a line to add options, a note or a discount.</span></div>'}${voids}</div>
    </div>
    <div class="totals">
      <div class="trow"><span>Food subtotal</span><span>${$c(T.sub)}</span></div>
      ${T.itemDisc ? `<div class="trow disc"><span>Item discounts</span><span>−${$c(T.itemDisc)}</span></div>` : ''}
      ${d.disc ? `<div class="trow disc"><span>Order discount (${discLabel(d.disc)}) <button class="x" data-act="clearOD" aria-label="Remove order discount">✕</button></span><span>−${$c(T.orderDisc)}</span></div>` : ''}
      <div class="trow"><span>${TAX_NAME}</span><span>${$c(T.tax)}</span></div>
      ${T.fee ? `<div class="trow"><span>Delivery fee · ${PLACES[d.place] || PLACES.house}</span><span>${$c(T.fee)}</span></div>` : ''}
      <div class="trow big"><span>Total</span><span>${$c(T.total)}</span></div>
      ${paidInfo}
    </div>
    <div class="actions">
      <button class="btn" data-act="orderDisc" ${!can ? 'disabled' : ''}>Discount</button>
      <button class="btn primary" data-act="send" ${!pend || saving ? 'disabled' : ''}>${pend ? `Send to kitchen · ${pend}` : 'All sent to kitchen'}</button>
      ${can && T.balance <= 0 && d.id && !d.dirty ? `<button class="btn accent pay" data-act="complete" data-id="${esc(d.id)}">Paid · ${doneLabel}</button>`
        : d.type !== 'dinein' ? `<div class="payrow"><button class="btn" data-act="payAdvance" ${!can ? 'disabled' : ''}>Pay in advance</button><button class="btn accent" data-act="pay" ${!can ? 'disabled' : ''}>Pay ${$c(T.balance)}</button></div>`
        : `<button class="btn accent pay" data-act="pay" ${!can ? 'disabled' : ''}>Pay ${$c(T.balance)}</button>`}
    </div>
  </section>`;
}

const openTableOrder = (tableId) => S.orders.find((o) => o.status === 'pending' && o.delivery_type === 'dinein' && o.table_id === tableId);

// ---------- item picker (options, quantity, note, line discount) ----------
function openItem(itemId, lineUid) {
  const d = U.draft, item = S.byId.get(itemId);
  const l = lineUid ? d.lines.find((x) => x.uid === lineUid) : null;
  const sel = {};
  for (const g of groupsFor(itemId)) sel[g.id] = l ? l.mods.filter((m) => m.g === g.id).map((m) => m.n) : [];
  U.mod = { itemId, lineUid, sel, qty: l ? l.qty : 1, note: l ? l.note : '', dt: l && l.disc ? l.disc.t : 'none',
    dv: l && l.disc ? (l.disc.t === 'amt' ? (l.disc.v / 100).toFixed(2) : String(l.disc.v)) : '', tried: false, item };
  U.modal = 'item';
  renderModal();
}

function modMods() {
  const M = U.mod;
  return groupsFor(M.itemId).flatMap((g) => g.options.filter((o) => M.sel[g.id].includes(o.name)).map((o) => ({ g: g.id, n: o.name, price: o.price_cents / 100 })));
}
const modMissing = () => groupsFor(U.mod.itemId).filter((g) => U.mod.sel[g.id].length < g.min);
function modDisc() {
  const M = U.mod, v = parseFloat(M.dv) || 0;
  if (M.dt === 'pct' && v > 0) return { t: 'pct', v: Math.min(100, Math.round(v)) };
  if (M.dt === 'amt' && v > 0) return { t: 'amt', v: Math.round(v * 100) };
  if (M.dt === 'comp') return { t: 'pct', v: 100 };
  return null;
}

// A "+1 person / +2 people / …" group priced n × the first option: shown as a quantity.
const isCounter = (g) => g.min === 0 && g.max === 1 && g.options.length > 1
  && g.options.every((o, i) => new RegExp(`^\\+${i + 1}\\b`).test(o.name) && o.price_cents === g.options[0].price_cents * (i + 1));
const counterValue = (g) => { const i = g.options.findIndex((o) => U.mod.sel[g.id].includes(o.name)); return i + 1; };

function itemModal() {
  const M = U.mod, item = M.item, miss = M.tried ? modMissing() : [];
  const groups = groupsFor(item.id).map((g) => {
    if (isCounter(g)) {
      // Extra people: a quantity stepper (0 to the last option) instead of one button per count.
      const n = counterValue(g), each = g.options[0].price_cents;
      return `<div class="grp"><h3>${esc(g.name.replace(/\s*\(.*\)\s*$/, ''))} <span class="pill">${$c(each)} each</span></h3>
        <div class="row"><div class="bigstep"><button type="button" data-act="cnt" data-g="${esc(g.id)}" data-d="-1" aria-label="One fewer" ${n ? '' : 'disabled'}>−</button><span>${n}</span>
          <button type="button" data-act="cnt" data-g="${esc(g.id)}" data-d="1" aria-label="One more" ${n < g.options.length ? '' : 'disabled'}>+</button></div>
          <span class="muted num">${n ? `+${$c(each * n)}` : 'None added'}</span></div></div>`;
    }
    const rule = g.min ? 'Required · choose one' : g.max === 1 ? 'Optional · choose one' : 'Optional · choose any';
    const opts = g.options.map((o) => `<button type="button" class="opt ${M.sel[g.id].includes(o.name) ? 'on' : ''}" data-act="opt" data-g="${esc(g.id)}" data-n="${esc(o.name)}">${esc(o.name)}${o.price_cents ? ` <small>+${$c(o.price_cents)}</small>` : ''}</button>`).join('');
    return `<div class="grp ${miss.includes(g) ? 'missing' : ''}"><h3>${esc(g.name)} <span class="pill">${rule}</span></h3><div class="chips">${opts}</div></div>`;
  }).join('');
  const line = { id: item.id, qty: M.qty, mods: modMods(), disc: modDisc() };
  const discChips = [['none', 'No discount'], ['pct', '% off'], ['amt', '$ off'], ['comp', 'Comp (free)']]
    .map(([k, n]) => `<button type="button" class="chip ${M.dt === k ? 'on' : ''}" data-act="mdt" data-t="${k}">${n}</button>`).join('');
  const combo = (S.combos.get(item.id) || []).map((c) => `${c.qty}× ${esc(shortName(c.name))}`).join(' · ');
  return sheet(`${item.code ? `<span class="tcode" style="font-size:16px">${esc(item.code)}</span> ` : ''}${esc(shortName(item.name))}`,
    `${esc(item.category)} · ${$m(item.price)}`,
    `${combo ? `<div><div class="eyebrow">Includes</div><p style="margin:4px 0 0">${combo}</p></div>` : ''}
     ${groups}
     <div class="row"><b>Quantity</b><div class="bigstep"><button data-act="mq" data-d="-1" aria-label="One less">−</button><span>${M.qty}</span><button data-act="mq" data-d="1" aria-label="One more">+</button></div></div>
     <div class="field"><label for="m-note">Note for the kitchen</label><input id="m-note" class="input" value="${esc(M.note)}" placeholder="e.g. extra crispy, allergy: peanuts" data-input="mnote" maxlength="200"></div>
     <div class="grp"><h3>Line discount</h3><div class="row"><div class="chips">${discChips}</div>
       ${M.dt === 'pct' || M.dt === 'amt' ? `<input id="m-dv" class="input" style="width:110px" inputmode="decimal" value="${esc(M.dv)}" placeholder="${M.dt === 'pct' ? 'Percent' : 'Dollars'}" data-input="mdv">` : ''}</div></div>
     <div class="bal"><span class="muted">Line total</span><strong id="m-total">${$c(netCents(line))}</strong></div>`,
    `${M.lineUid ? '<button class="btn danger ghost" data-act="mRemove">Remove</button><span style="flex:1"></span>' : ''}
     <button class="btn" data-act="close">Cancel</button><button class="btn accent" data-act="mSave">${M.lineUid ? 'Update' : 'Add to order'}</button>`, true);
}

function saveItem() {
  const M = U.mod;
  M.tried = true;
  if (modMissing().length) { renderModal(); return; }
  const d = U.draft;
  if (M.lineUid) {
    const l = d.lines.find((x) => x.uid === M.lineUid);
    if (l) {
      l.mods = modMods(); l.note = M.note.trim(); l.disc = modDisc();
      setQty(l, M.qty);
      touch();
    }
  } else addLine(M.item, modMods(), M.note.trim(), M.qty, modDisc());
  U.modal = null; U.mod = null;
  renderModal(); render();
}

// ---------- whole-order discount ----------
function openOrderDisc() {
  const d = U.draft;
  U.od = { t: d.disc ? d.disc.t : 'pct', v: d.disc ? (d.disc.t === 'amt' ? (d.disc.v / 100).toFixed(2) : String(d.disc.v)) : '' };
  U.modal = 'od';
  renderModal();
}
function odValue() {
  const v = parseFloat(U.od.v) || 0;
  if (!(v > 0)) return null;
  return U.od.t === 'pct' ? { t: 'pct', v: Math.min(100, Math.round(v)) } : { t: 'amt', v: Math.round(v * 100) };
}
function odModal() {
  const D = U.od, T = draftTotals(U.draft), v = parseFloat(D.v) || 0;
  return sheet('Discount whole order', `Items after item discounts ${$c(T.after)}`,
    `<div class="chips">${[10, 15, 20, 25].map((p) => `<button class="chip ${D.t === 'pct' && v === p ? 'on' : ''}" data-act="odq" data-v="${p}">${p}% off</button>`).join('')}</div>
     <div class="row"><div class="chips">${[['pct', '% off'], ['amt', '$ off']].map(([k, n]) => `<button class="chip ${D.t === k ? 'on' : ''}" data-act="odt" data-t="${k}">${n}</button>`).join('')}</div>
       <input id="od-v" class="input" style="width:120px" inputmode="decimal" value="${esc(D.v)}" placeholder="${D.t === 'pct' ? 'Percent' : 'Dollars'}" data-input="odv"></div>
     <div class="bal"><span class="muted">Discount</span><strong id="od-amt">−${$c(discCents(odValue(), T.after))}</strong></div>
     <p class="muted" style="margin:0">Applied before tax. Item discounts stay as they are.</p>`,
    `${U.draft.disc ? '<button class="btn danger ghost" data-act="clearOD">Remove discount</button>' : ''}<button class="btn accent" data-act="saveOD">Apply discount</button>`);
}

// ---------- floating "new order" button ----------
const FAN = [['dinein', 'Dine in', 102, 34], ['pickup', 'Pick Up', 130, 22], ['delivery', 'Delivery', 156, 10]];
function fanHtml() {
  const R = 150, rad = (x) => (x * Math.PI) / 180;
  return `<div class="fanwrap ${U.fan ? 'open' : ''}">
    <div class="fanscrim" data-act="fan"></div>
    <div class="fan">${FAN.map(([t, n, a, r], i) => `<button class="fanitem" data-act="fanPick" data-t="${t}" tabindex="${U.fan ? 0 : -1}"
      style="--dx:${(R * Math.cos(rad(a))).toFixed(1)}px;--dy:${(-R * Math.sin(rad(a))).toFixed(1)}px;--r:${r}deg;--i:${i}">${n}</button>`).join('')}</div>
    <button class="fab" data-act="fan" aria-expanded="${U.fan}" aria-label="New order"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg></button>
  </div>`;
}
