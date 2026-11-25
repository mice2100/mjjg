// Rendering, event wiring (data-act / data-input / data-change) and start-up.
'use strict';

// Re-rendering replaces the HTML; keep the field being typed in and its caret.
function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.matches('input, textarea, select')) return null;
  return { id: a.id, key: a.dataset.input, i: a.dataset.i, start: a.selectionStart, end: a.selectionEnd };
}
function restoreFocus(f) {
  if (!f) return;
  const el = f.id ? $(f.id) : document.querySelector(`[data-input="${f.key}"]${f.i != null ? `[data-i="${f.i}"]` : ''}`);
  if (!el) return;
  el.focus({ preventScroll: true });
  try { if (f.start != null) el.setSelectionRange(Math.min(f.start, el.value.length), Math.min(f.end, el.value.length)); } catch { /* not a text field */ }
}

function render() {
  const open = S.orders.filter((o) => o.status === 'pending').length;
  const kds = S.loaded ? openTicketCount() : 0;
  const TAB = { register: ['register', 'Order'], tables: ['tables', 'Register', open], kds: ['kds', 'Kitchen', kds], menu: ['menu', 'Menu'] };
  $('tabs').innerHTML = ROLE_VIEWS[ROLE].map((v) => TAB[v]) // each site's own tabs, in its own order
    .map(([v, n, b]) => `<button class="tab ${U.view === v ? 'on' : ''}" data-act="view" data-v="${v}" aria-current="${U.view === v}">${n}${b ? `<span class="badge">${b}</span>` : ''}</button>`).join('');
  // New online orders waiting to be acknowledged (the ringtone plays until "Received").
  const waiting = unreceived();
  $('ringbar').hidden = !waiting.length;
  $('ringbar').innerHTML = waiting.map((o) => `<div class="ringrow"><span><b>New online order ${esc(orderNo(o))}</b> · ${TYPES[o.delivery_type] || ''}${o.customer_name ? ' · ' + esc(o.customer_name) : ''} · ${$m(o.total)}</span>
    <span class="row"><button class="btn sm" data-act="viewOrder" data-id="${esc(o.id)}">Details</button><button class="btn sm accent" data-act="received" data-id="${esc(o.id)}">Received</button></span></div>`).join('');
  const focus = $('modal').hidden ? captureFocus() : null;
  const keep = {};
  document.querySelectorAll('[data-keep]').forEach((e) => (keep[e.dataset.keep] = e.scrollTop));
  $('main').innerHTML = !S.loaded ? `<div class="empty">${esc(S.loadError || 'Loading the menu…')}</div>`
    : U.view === 'register' ? viewRegister() : U.view === 'tables' ? viewTables() : U.view === 'kds' ? viewKds() : viewMenu();
  document.querySelectorAll('[data-keep]').forEach((e) => { if (keep[e.dataset.keep] != null) e.scrollTop = keep[e.dataset.keep]; });
  restoreFocus(focus);
}

function renderModal() {
  const el = $('modal');
  if (!U.modal) { el.hidden = true; el.innerHTML = ''; return; }
  const focus = captureFocus();
  el.hidden = false;
  el.innerHTML = { item: itemModal, od: odModal, start: startModal, seat: seatModal, view: viewModal, pay: payModal, receipt: receiptModal, group: groupModal, combo: comboModal }[U.modal]();
  if (U.modal === 'start') drawAc();
  restoreFocus(focus);
}

function closeModal() {
  U.modal = null; U.mod = null; U.od = null; U.start = null; U.pay = null; U.ge = null; U.ce = null; U.confirmCancel = null;
  renderModal();
}

function tapItem(id) {
  const item = S.byId.get(Number(id));
  if (!item) return;
  if (S.sold.has(item.id)) { toast(`${shortName(item.name)} is sold out`); return; }
  if (!U.draft) { openStart('pickup', { pendingItem: item.id }); return; }
  if (asksOptions(item.id)) { openItem(item.id); return; }
  addLine(item);
  render();
}

// ---------- click actions ----------
const A = {
  close: closeModal,
  view: async ({ v }) => { if (!ROLE_VIEWS[ROLE].includes(v)) return; U.view = v; U.fan = false; closeModal(); render(); },
  osk: () => oskToggle(),
  sound: () => {
    // The tap itself unlocks audio; when sound was blocked this button means "enable", not "mute".
    if (sound.on && sound.blocked) { updateRinging(); return; }
    sound.on = !sound.on;
    localStorage.setItem('jg_sound_enabled', sound.on);
    if (sound.on) ringBriefly(3000); else updateRinging();
    toast(sound.on ? 'Sound on' : 'Sound off');
  },
  // order screen
  cat: ({ c }) => { U.cat = c; U.q = ''; render(); const it = $('items'); if (it) it.scrollTop = 0; },
  clearQ: () => { U.q = ''; render(); },
  item: ({ id }) => tapItem(id),
  type: ({ t }) => {
    const d = U.draft;
    d.type = t;
    if (t === 'dinein') d.source = 'Walk-in';
    touch();
    render();
    if (t === 'delivery' && (!d.phone || !d.addr)) openStart('delivery', { edit: true });
  },
  editCustomer: () => openStart(null, { edit: true }),
  editLine: ({ u }) => { const l = U.draft.lines.find((x) => x.uid === u); if (l) openItem(l.id, u); },
  inc: ({ u }) => { const l = U.draft.lines.find((x) => x.uid === u); if (l) { setQty(l, l.qty + 1); render(); } },
  dec: ({ u }) => { const l = U.draft.lines.find((x) => x.uid === u); if (l) { setQty(l, l.qty - 1); render(); } },
  minPanel: () => holdDraft(),
  send: () => saveDraft({ send: true }),
  pay: () => openPay(U.draft.id),
  payAdvance: () => openPay(U.draft.id, true),
  complete: async ({ id }) => {
    if (U.draft && U.draft.id === id && U.draft.dirty && !(await saveDraft({ quiet: true }))) return;
    closeModal();
    await setStatus(id, 'completed');
  },
  orderDisc: openOrderDisc,
  odq: ({ v }) => { U.od = { t: 'pct', v }; renderModal(); },
  odt: ({ t }) => { U.od.t = t; renderModal(); },
  saveOD: () => { U.draft.disc = odValue(); touch(); closeModal(); render(); },
  clearOD: () => { U.draft.disc = null; touch(); closeModal(); render(); },
  // item picker
  opt: ({ g, n }) => {
    const grp = S.groups.find((x) => x.id === g), sel = U.mod.sel[g];
    if (sel.includes(n)) { if (!(grp.min && grp.max === 1)) sel.splice(sel.indexOf(n), 1); }
    else if (grp.max === 1) sel.splice(0, sel.length, n);
    else if (sel.length < grp.max) sel.push(n);
    renderModal();
  },
  cnt: ({ g, d }) => {
    const grp = S.groups.find((x) => x.id === g);
    const n = Math.min(grp.options.length, Math.max(0, counterValue(grp) + Number(d)));
    U.mod.sel[g] = n ? [grp.options[n - 1].name] : [];
    renderModal();
  },
  mq: ({ d }) => { U.mod.qty = Math.min(50, Math.max(1, U.mod.qty + Number(d))); renderModal(); },
  mdt: ({ t }) => { if (t !== U.mod.dt) U.mod.dv = ''; U.mod.dt = t; renderModal(); },
  mSave: saveItem,
  mRemove: () => { const l = U.draft.lines.find((x) => x.uid === U.mod.lineUid); if (l) setQty(l, 0); closeModal(); render(); },
  // new orders
  fan: () => { U.fan = !U.fan; render(); },
  fanPick: ({ t }) => { U.fan = false; render(); if (t === 'dinein') { U.modal = 'seat'; renderModal(); } else openStart(t); },
  seatPick: () => { U.modal = 'seat'; renderModal(); },
  seat: ({ id }) => seatTable(id),
  seatNone: () => seatTable(null),
  table: ({ id }) => seatTable(id),
  key: ({ k }) => keypad(k),
  area: ({ c }) => areaCode(c),
  stype: ({ t }) => { U.start.type = t; renderModal(); },
  splace: ({ p }) => { U.start.place = p; renderModal(); },
  tmode: ({ m }) => { const s = U.start; s.tmode = m; if (m === 'asap' || m === 'date') s.slot = ''; if (m === 'date') s.tdate = null; renderModal(); },
  toff: ({ n }) => { U.start.tmode = 'off'; U.start.slot = pickupIn(n); renderModal(); },
  tdate: ({ d }) => { U.start.tdate = d; U.start.slot = ''; renderModal(); },
  tcal: ({ d }) => { U.start.cal = Math.max(0, Math.min(2, U.start.cal + Number(d))); renderModal(); },
  slot: ({ v }) => { U.start.slot = v; renderModal(); },
  place: ({ p }) => { U.draft.place = p; touch(); render(); },
  pickAddr: ({ i }) => { U.start.addrIdx = Number(i); U.start.type = 'delivery'; renderModal(); },
  hotels: () => { U.start.addrIdx = -1; streetSearch(U.start.hotel ? '' : U.start.street, true); },
  acPick: ({ i }) => acPick(Number(i)),
  startGo: () => startGo(),
  reorder: ({ i }) => {
    const s = U.start;
    if (!s.edit) return startGo(Number(i));
    copyOrder(s.lookup.orders[Number(i)]);
    touch();
    closeModal(); render();
  },
  // register
  ocat: ({ c }) => { U.ocat = c; render(); },
  // On the Register tab (wide screens) an order opens on the right-hand side; elsewhere as a pop-up.
  viewOrder: ({ id }) => {
    U.confirmCancel = null;
    if (U.view === 'tables' && !U.modal && !window.matchMedia('(max-width: 860px)').matches) { U.sel = id; render(); return; }
    U.viewId = id; U.modal = 'view'; renderModal();
  },
  unsel: () => { U.sel = null; U.confirmCancel = null; render(); },
  open: ({ id }) => openExisting(id),
  payOrder: ({ id }) => openPay(id),
  askCancel: ({ id }) => { U.confirmCancel = id; renderModal(); render(); },
  keepOrder: () => { U.confirmCancel = null; renderModal(); render(); },
  cancelOrder: async ({ id }) => { closeModal(); await setStatus(id, 'cancelled'); },
  reopen: async ({ id }) => { closeModal(); await setStatus(id, 'pending'); },
  print: ({ id }) => printReceipt(id || U.viewId || U.sel),
  paper: () => { toggleReceiptMm(); render(); if (U.modal) renderModal(); },
  // payment
  pmode: ({ m }) => { U.pay.mode = m; renderModal(); },
  pmeth: ({ m }) => { U.pay.method = m; renderModal(); },
  tq: ({ v }) => { U.pay.tendered = (Number(v) / 100).toFixed(2); renderModal(); },
  pn: ({ d }) => { U.pay.n = Math.min(12, Math.max(2, U.pay.n + Number(d))); renderModal(); },
  asg: ({ u, g }) => { U.pay.assign[u] = g === 'S' ? 'S' : Number(g); renderModal(); },
  payFull: () => {
    const P = U.pay, o = S.orders.find((x) => x.id === P.id), bal = cents(o.balance);
    const tendered = P.method === 'cash' && P.tendered ? cents(P.tendered) : null;
    if (tendered != null && tendered < bal) { toast('Cash received is less than the balance.'); return; }
    takePayment(bal, P.method, 'Full', { tendered });
  },
  payCustom: ({ m }) => {
    const P = U.pay, o = S.orders.find((x) => x.id === P.id), amt = cents(P.custom);
    if (!(amt > 0)) { toast('Enter an amount.'); return; }
    takePayment(Math.min(amt, cents(o.balance)), m, 'Partial');
  },
  payCheck: async ({ i, m }) => {
    const P = U.pay, o = S.orders.find((x) => x.id === P.id);
    if (!SPLITS.has(o.id)) SPLITS.set(o.id, { mode: P.mode, n: P.n, assign: { ...P.assign }, base: cents(o.balance), paid: [] });
    const sp = SPLITS.get(o.id), check = checksFor(o)[Number(i)];
    const before = o.payments.length;
    await takePayment(Math.min(check.amt, cents(o.balance)), m, 'Guest ' + (Number(i) + 1));
    const after = S.orders.find((x) => x.id === o.id);
    if (after && after.payments.length > before && SPLITS.has(o.id)) { sp.paid.push(Number(i)); renderModal(); }
  },
  sendFromPay: async () => {
    const id = U.pay.id;
    try {
      const r = await api('PUT', `${API}/orders/${encodeURIComponent(id)}`, { send: true });
      upsertOrder(r.order);
      if (U.draft && U.draft.id === id) U.draft = draftFromOrder(r.order);
      toast('Sent to kitchen');
      refresh();
    } catch (e) { toast('Not sent: ' + e.message); }
    renderModal(); render();
  },
  afterPay: () => {
    const o = S.orders.find((x) => x.id === U.viewId);
    closeModal();
    if (o && o.delivery_type === 'dinein') { U.view = 'tables'; U.ocat = 'dinein'; render(); }
    else { U.view = 'register'; render(); openStart('pickup'); }
  },
  // kitchen
  received: async ({ id }) => {
    try {
      const r = await api('PATCH', `${API}/orders/${encodeURIComponent(id)}`, { received: true });
      upsertOrder(r.order);
      toast(`${orderNo(r.order)} received`);
    } catch (e) { toast('Not saved: ' + e.message); }
    updateRinging();
    render();
    if (U.modal === 'view') renderModal();
  },
  bump: ({ id, whole }) => bump(id, whole === '1', true),
  recall: ({ id, whole }) => bump(id, whole === '1', false),
  // menu
  sold: ({ id }) => toggleSold(Number(id)),
  editGroup: ({ g }) => openGroup(g),
  newGroup: () => openGroup(null),
  geRule: ({ r }) => { U.ge.rule = r; renderModal(); },
  geAddOpt: () => { U.ge.opts.push({ n: '', p: '' }); renderModal(); },
  geDelOpt: ({ i }) => { U.ge.opts.splice(Number(i), 1); renderModal(); },
  geItem: ({ id }) => { const s = U.ge.items, n = Number(id); if (s.has(n)) s.delete(n); else s.add(n); renderModal(); },
  geCat: ({ c }) => {
    const its = S.menu.filter((i) => i.category === c), all = its.every((i) => U.ge.items.has(i.id));
    its.forEach((i) => (all ? U.ge.items.delete(i.id) : U.ge.items.add(i.id)));
    renderModal();
  },
  geAll: () => { const all = S.menu.every((i) => U.ge.items.has(i.id)); U.ge.items = new Set(all ? [] : S.menu.map((i) => i.id)); renderModal(); },
  geSave: saveGroup,
  geAskDel: () => { U.ge.confirmDel = true; renderModal(); },
  geDel: deleteGroup,
  editCombo: ({ id }) => openCombo(Number(id)),
  ceQty: ({ i, d }) => { const l = U.ce.lines[Number(i)]; l.qty = Math.min(20, Math.max(1, l.qty + Number(d))); U.ce.dirty = true; renderModal(); },
  ceDel: ({ i }) => { U.ce.lines.splice(Number(i), 1); U.ce.dirty = true; renderModal(); },
  ceAdd: ({ id }) => {
    const m = S.byId.get(Number(id)), l = U.ce.lines.find((x) => x.id === m.id);
    if (l) l.qty++; else U.ce.lines.push({ id: m.id, name: m.name, qty: 1 });
    U.ce.q = ''; U.ce.dirty = true; renderModal();
  },
  ceAddText: () => {
    const name = U.ce.text.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const l = U.ce.lines.find((x) => x.id == null && x.name.toLowerCase() === name.toLowerCase());
    if (l) l.qty++; else U.ce.lines.push({ id: null, name, qty: 1 });
    U.ce.text = ''; U.ce.dirty = true; renderModal();
  },
  ceSave: saveCombo,
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.closest('#modal') === null && !$('modal').hidden && !el.closest('.top')) return;
  const fn = A[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset); }
});
// Tapping the dark area around a sheet closes it.
// Only for sheets that hold nothing typed (seat picker, order details, receipt).
$('modal').addEventListener('click', (e) => { if (e.target === $('modal') && ['seat', 'view', 'receipt'].includes(U.modal)) closeModal(); });

// ---------- typing ----------
const INPUT = {
  q: (v) => { U.q = v; const it = $('items'); if (it) { it.innerHTML = itemsHtml(); it.scrollTop = 0; } },
  mnote: (v) => { U.mod.note = v; },
  mdv: (v) => {
    U.mod.dv = v;
    const t = $('m-total');
    if (t) t.textContent = $c(netCents({ id: U.mod.itemId, qty: U.mod.qty, mods: modMods(), disc: modDisc() }));
  },
  odv: (v) => { U.od.v = v; const t = $('od-amt'); if (t) t.textContent = '−' + $c(discCents(odValue(), draftTotals(U.draft).after)); },
  phone: (v) => setStartPhone(digitsOf(v)),
  name: (v) => { U.start.name = v; },
  notes: (v) => { U.start.notes = v; },
  apt: (v) => {
    const had = startPlace();
    U.start.apt = v;
    if (startPlace() !== had) renderModal(); // an apt / room number switches the fee to apartment
  },
  street: (v) => { U.start.street = v; U.start.hotel = null; streetSearch(v); },
  tendered: (v) => {
    U.pay.tendered = v;
    const o = S.orders.find((x) => x.id === U.pay.id), bal = cents(o.balance), t = cents(v), el = $('chg');
    if (el) el.textContent = t >= bal ? $c(t - bal) : '—';
  },
  custom: (v) => { U.pay.custom = v; },
  geName: (v) => { U.ge.name = v; },
  geN: (v, el) => { U.ge.opts[Number(el.dataset.i)].n = v; },
  geP: (v, el) => { U.ge.opts[Number(el.dataset.i)].p = v; },
  ceQ: (v) => { U.ce.q = v; renderModal(); },
  ceText: (v) => { U.ce.text = v; },
};
document.addEventListener('input', (e) => {
  const fn = INPUT[e.target.dataset.input];
  if (fn) fn(e.target.value, e.target);
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.change === 'table') {
    U.draft.table = e.target.value || null;
    touch();
    render();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && U.modal && U.modal !== 'pay') { closeModal(); return; }
  if (e.target.dataset.input === 'street' && U.start && U.start.ac.list.length) {
    const ac = U.start.ac;
    if (e.key === 'ArrowDown') { e.preventDefault(); ac.i = (ac.i + 1) % ac.list.length; drawAc(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ac.i = (ac.i - 1 + ac.list.length) % ac.list.length; drawAc(); }
    else if (e.key === 'Enter' && ac.i >= 0) { e.preventDefault(); acPick(ac.i); }
  } else if (e.key === 'Enter' && U.modal === 'start' && e.target.matches('input')) {
    e.preventDefault();
    startGo();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (U.draft && (U.draft.dirty || (!U.draft.id && U.draft.lines.length))) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- start-up ----------
async function loadReference() {
  const [menu, streets, search, address, slots, settings, combos] = await Promise.all([
    fetch('/api/menu').then((r) => r.json()),
    fetch('/api/streets', { cache: 'no-cache' }).then((r) => r.json()), // the lists change; do not use an old copy
    import('/js/search.js'),
    import('/js/address.js'),
    import('/js/slots.js'),
    api('GET', `${API}/menu`),
    api('GET', `${API}/combos`),
  ]);
  S.menu = menu.menu || [];
  S.byId = new Map(S.menu.map((i) => [i.id, i]));
  S.byName = new Map(S.menu.map((i) => [i.name.toLowerCase(), i]));
  // Sidebar order chosen by the owner; categories not listed go last.
  const CAT_ORDER = ['Dinner for One', 'Family Dinners', 'Appetizers', 'Soup', 'Fried Rice', 'Noodles', 'Vegetables', 'Chicken', 'Beef',
    'Pork', 'Seafood', 'Sides & Sauces', 'Drinks', 'Traditional Chinese Food'];
  const rank = (c) => { const i = CAT_ORDER.findIndex((p) => c.toLowerCase().startsWith(p.toLowerCase())); return i < 0 ? CAT_ORDER.length : i; };
  S.cats = [...new Set(S.menu.map((i) => i.category))].sort((a, b) => rank(a) - rank(b));
  S.streets = streets.streets || [];
  S.hotels = streets.hotels || [];
  S.search = search;
  S.address = address;
  S.slots = slots;
  S.buildings = streets.apartment_buildings || [];
  S.groups = settings.groups;
  S.sold = new Set(settings.sold_out);
  S.canEditOptions = settings.can_edit;
  S.combos = new Map(combos.combos.map((c) => [c.combo_id, c.components]));
  S.canEditCombos = Boolean(combos.can_edit);
}

async function init() {
  document.querySelector('.brand small').textContent = ROLE_TITLE[ROLE];
  document.title = 'Jade Garden ' + ROLE_TITLE[ROLE];
  tick();
  setInterval(tick, 15000);
  setInterval(() => { if (!U.modal) render(); }, 60000); // minute counters
  soundButton();
  oskButton();
  setSync();
  render();
  try {
    await loadReference();
    S.loaded = true;
  } catch (e) {
    S.loadError = 'Could not load the menu: ' + e.message + ' Check the connection and reload.';
    render();
    return;
  }
  render();
  handleCallHash();
  if (!can.orders) return; // the admin site only edits menu settings
  await refresh({ full: true });
  setInterval(() => refresh(), POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { unlockAudio(); refresh(); } });
}

init();
