// Register tab: every open order (POS, website, WordPress), the dine-in floor plan, order
// details, payments (full, split evenly, split by item, custom amounts) and receipts.
'use strict';

const OCATS = [['all', 'All'], ['pickup', 'Pickup'], ['delivery', 'Delivery'], ['dinein', 'Dine-in'], ['online', 'Online']];
const inCat = (o, c) => c === 'all' || (c === 'online' ? !isPos(o) : o.delivery_type === c);
const openList = () => S.orders.filter((o) => o.status === 'pending');

function orderLabel(o) {
  if (o.delivery_type === 'dinein') return o.table_id ? 'Table ' + o.table_id : 'Dine-in (no table)';
  return TYPES[o.delivery_type] + (o.customer_name ? ' · ' + o.customer_name : '');
}
function payState(o) {
  if (o.payment_status === 'paid') return { cls: 'ok', txt: 'Paid online' };
  if (o.balance <= 0) return { cls: 'ok', txt: o.status === 'pending' ? 'Paid in advance' : 'Paid' };
  if (o.paid > 0) return { cls: 'warn', txt: 'Part paid · ' + $m(o.balance) + ' due' };
  return { cls: 'danger', txt: 'Collect ' + $m(o.balance) };
}
const unsentOf = (o) => o.items.reduce((a, it) => a + Math.max(0, it.qty - it.sent), 0) + (o.pending_voids || []).length;

function orderCard(o) {
  const ps = payState(o), open = o.status === 'pending', pend = open && isPos(o) ? unsentOf(o) : 0;
  const items = o.items.map((it) => `${it.qty}× ${shortName(it.name)}`).join(', ');
  const time = open ? mins(o.created_at) + ' min' : o.status === 'cancelled' ? 'Cancelled' : fmtTime(o.closed_at || o.updated_at);
  // Dine-in: the table. Pickup: name, then the phone in bold. Delivery: address, then the
  // phone in bold, then the name. A missing name is left blank.
  const phone = o.customer_phone ? `<span class="oc-phone num">${esc(o.customer_phone)}</span>` : '';
  const line = (text) => (text ? `<span class="oc-cust">${esc(text)}</span>` : '');
  const who = o.delivery_type === 'dinein' ? `<span class="oc-name">${esc(o.table_id ? 'Table ' + o.table_id : 'No table')}</span>`
    : o.delivery_type === 'delivery' ? line(o.delivery_address) + phone + (o.customer_name ? `<span class="oc-contact">${esc(o.customer_name)}</span>` : '')
    : line(o.customer_name) + phone;
  return `<button class="ocard ${open ? '' : 'closed'} ${U.sel === o.id ? 'sel' : ''}" data-act="viewOrder" data-id="${esc(o.id)}">
    <span class="oc-top"><span class="dot ${o.delivery_type === 'dinein' ? 'k-dine' : 'k-togo'}"></span><span>${esc(orderNo(o))} · ${TYPES[o.delivery_type] || ''}</span><span class="oc-time">${time}</span></span>
    ${who}
    <span class="oc-items">${esc(items)}</span>
    <span class="oc-foot"><span class="st-${o.status === 'cancelled' ? 'muted' : ps.cls}">${o.status === 'cancelled' ? 'Cancelled' : ps.txt}</span>${pend ? `<span class="st-unsent">· ${pend} unsent</span>` : ''}<b class="num">${$m(o.total)}</b></span>
  </button>`;
}

function viewTables() {
  const c = U.ocat;
  const open = openList().filter((o) => inCat(o, c)).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const closed = S.orders.filter((o) => o.status !== 'pending' && inCat(o, c)).slice(0, 12);
  const tabs = OCATS.map(([k, n]) => `<button class="otab ${c === k ? 'on' : ''}" data-act="ocat" data-c="${k}" aria-pressed="${c === k}">${n}<span>${openList().filter((o) => inCat(o, k)).length}</span></button>`).join('');
  const held = U.draft && !U.draft.id && U.draft.lines.length ? `<div class="callout"><span>An unsaved ${TYPES[U.draft.type].toLowerCase()} order is on the Order screen.</span><button class="btn sm" data-act="view" data-v="register">Go to it</button></div>` : '';
  // Cards on the left in order (oldest first), the chosen order on the right like a receipt.
  const sel = S.orders.find((o) => o.id === U.sel);
  return `<div class="regsplit">
    <div class="orders" data-keep="reglist">
      <h2>Register</h2>${held}
      <nav class="otabs" aria-label="Order category">${tabs}</nav>
      ${c === 'dinein' ? floorHtml() + (open.some((o) => !o.table_id) ? `<h3 class="osub">Dine-in without a table</h3><div class="ogrid">${open.filter((o) => !o.table_id).map(orderCard).join('')}</div>` : '')
        : `<div class="ogrid">${open.map(orderCard).join('') || '<div class="empty">No open orders here. Tap + to start one.</div>'}</div>`}
      ${closed.length ? `<h3 class="osub">Recently closed</h3><div class="ogrid">${closed.map(orderCard).join('')}</div>` : ''}
    </div>
    <aside class="panel regdetail" aria-label="Order details">${sel ? detailPanel(sel) : '<div class="empty" style="margin:auto"><b>No order selected</b><span>Tap an order on the left to see it here.</span></div>'}</aside>
  </div>${can.order ? fanHtml() : ''}`;
}

function floorHtml() {
  const seated = TABLES.filter((t) => openTableOrder(t.id)).length;
  const box = (o) => `left:${o.x}%;top:${o.y}%;width:${o.w}%;height:${o.h}%`;
  const decor = FLOOR_DECOR.map((d) => `<div class="fd ${d.k}" style="${box(d)}">${d.label ? `<span>${d.label}</span>` : ''}</div>`).join('');
  const tiles = TABLES.map((t) => {
    const o = openTableOrder(t.id), slim = t.w < 7 ? 'slim' : '';
    const kind = t.round ? 'round' : t.id[0] === 'W' ? 'lr' : t.id === 'L1' ? 'l1' : 'tb';
    const inset = { round: [17, 17, 17, 17], lr: [5, 25, 5, 25], l1: [24, 3, 24, 13], tb: [24, 4, 24, 4] }[kind];
    const chairs = [];
    if (kind === 'round') for (let i = 0; i < t.seats; i++) { const a = (i * 360) / t.seats - 90, r = (a * Math.PI) / 180; chairs.push([50 + 41 * Math.cos(r), 50 + 41 * Math.sin(r), a + 90]); }
    else if (kind === 'lr') [[12, -90], [88, 90]].forEach(([x, rot]) => [30, 70].forEach((y) => chairs.push([x, y, rot])));
    else {
      const per = Math.floor(t.seats / 2), x0 = inset[3], span = 100 - inset[3] - inset[1];
      for (let i = 0; i < per; i++) { const x = x0 + ((i + 0.5) * span) / per; chairs.push([x, 11, 0], [x, 89, 180]); }
      if (kind === 'l1') chairs.push([5, 50, -90]);
    }
    const ch = chairs.map(([x, y, a]) => `<span class="chair" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--a:${a.toFixed(0)}deg"></span>`).join('');
    const topStyle = `top:${inset[0]}%;right:${inset[1]}%;bottom:${inset[2]}%;left:${inset[3]}%`;
    if (!o) return `<button class="tbl ${kind === 'round' ? 'round' : ''} ${slim}" style="${box(t)}" data-act="table" data-id="${t.id}" title="${t.id} · free · ${t.seats} seats" aria-label="Table ${t.id}, free, ${t.seats} seats">
      ${ch}<span class="top" style="${topStyle}"><span class="tno">${t.id}</span><span class="tsub">${t.seats} seats</span></span></button>`;
    const pend = unsentOf(o), m = mins(o.created_at);
    return `<button class="tbl busy ${kind === 'round' ? 'round' : ''} ${slim}" style="${box(t)}" data-act="viewOrder" data-id="${esc(o.id)}" title="${t.id} · ${esc(o.id)} · ${m} min · ${$m(o.total)}${pend ? ' · ' + pend + ' unsent' : ''}" aria-label="Table ${t.id}, seated ${m} minutes, ${$m(o.total)}">
      ${ch}<span class="top" style="${topStyle}">${pend ? '<span class="udot" aria-hidden="true"></span>' : ''}<span class="tno">${t.id}</span><span class="tsub">${m} min</span>${t.w < 10 ? '' : `<span class="tsub tamt">${$m(o.total)}</span>`}</span></button>`;
  }).join('');
  return `<div class="floorhead"><span class="muted">${seated} of ${TABLES.length} tables seated · tap a free table to seat guests</span>
    <div class="flegend"><span><i class="b"></i>Seated</span><span><i></i>Free</span><span><i class="u"></i>Unsent items</span></div></div>
    <div class="fmapwrap"><div class="fmap" role="group" aria-label="Floor plan">${decor}${tiles}</div></div>`;
}

// ---------- order details ----------
function receiptHtml(o) {
  const r = (a, b) => `<div class="r"><span>${a}</span><span>${b}</span></div>`;
  const cust = [o.customer_name ? 'Name: ' + esc(o.customer_name) : '', o.customer_phone ? 'Phone: ' + esc(o.customer_phone) : '',
    o.delivery_type === 'delivery' && o.delivery_address ? 'Deliver to: ' + esc(o.delivery_address) : '',
    o.delivery_time_slot && o.delivery_type !== 'dinein' ? 'Time: ' + esc(o.delivery_time_slot) : '',
    o.customer_notes ? 'Notes: ' + esc(o.customer_notes) : ''].filter(Boolean).map((x) => `<div>${x}</div>`).join('');
  const paid = o.balance <= 0;
  const stamp = o.status === 'cancelled' ? 'CANCELLED' : o.payment_status === 'paid' ? 'PAID ONLINE' : paid ? (o.status === 'pending' ? 'PAID IN ADVANCE' : 'PAID') : 'BALANCE DUE ' + $m(o.balance);
  const lines = o.items.map((it) => r(`${it.qty} ${esc(shortName(it.name))}`, $m(it.price * it.qty))
    + (it.mods || []).map((m) => `<div class="s">${esc(m.n)}${m.price ? ' +' + $m(m.price) : ''}</div>`).join('')
    + (it.components || []).map((c) => `<div class="s">↳ ${c.qty * it.qty}× ${esc(shortName(c.name))}</div>`).join('')
    + (it.note ? `<div class="s">Note: ${esc(it.note)}</div>` : '')
    + (it.disc ? r(`&nbsp;&nbsp;${discLabel(it.disc)}`, '−' + $m(it.disc_amount)) : '')).join('');
  const itemDisc = o.items.reduce((s, it) => s + cents(it.disc_amount), 0);
  const orderDisc = cents(o.discount) - itemDisc;
  return `<div class="receipt">
    <div class="c"><b>JADE GARDEN RESTAURANT</b></div><div class="c">471 Main St N, Moose Jaw · (306) 694-5566</div>
    <div class="c">${esc(orderNo(o))} · ${esc(orderLabel(o))}</div>
    <div class="c">${fmtDate(o.created_at)} ${fmtTime(o.created_at)}</div>
    ${cust ? '<hr>' + cust : ''}<hr>
    ${lines || '<div class="c muted">No items</div>'}<hr>
    ${r('Food subtotal', $m(o.subtotal))}${itemDisc ? r('Item discounts', '−' + $c(itemDisc)) : ''}
    ${orderDisc > 0 ? r(o.coupon_code ? 'Coupon ' + esc(o.coupon_code) : o.order_discount ? 'Order discount ' + discLabel(o.order_discount) : 'Discount', '−' + $c(orderDisc)) : ''}
    ${r(TAX_NAME, $m(o.tax))}
    ${o.delivery_fee ? r(o.delivery_place === 'apartment' ? 'Delivery (apartment / hotel)' : 'Delivery', $m(o.delivery_fee)) : ''}${o.tip ? r('Tip', $m(o.tip)) : ''}${r('<b>TOTAL</b>', `<b>${$m(o.total)}</b>`)}
    ${o.payments.length ? '<hr>' + o.payments.map((p) => r(`${esc(p.label)} · ${esc(p.method.toUpperCase())}`, $m(p.amount))
      + (p.tendered != null ? r('&nbsp;&nbsp;Cash received', $m(p.tendered)) + r('&nbsp;&nbsp;Change', $m(p.change)) : '')).join('') : ''}
    <hr><div class="c stamp ${paid && o.status !== 'cancelled' ? 'ok' : 'due'}"><b>${stamp}</b></div><div class="c">Thank you!</div></div>`;
}

function viewModal() {
  const o = S.orders.find((x) => x.id === U.viewId);
  if (!o) return sheet('Order not found', '', '<div class="empty">This order is no longer on the board.</div>', '');
  const d = orderDetail(o, false);
  return sheet(d.title, d.sub, d.body, d.btns);
}

// The Register's right-hand side: the same details as the pop-up, without covering the cards.
function detailPanel(o) {
  const d = orderDetail(o, true);
  return `<div class="shead"><div><div class="eyebrow">${d.sub}</div><h2>${d.title}</h2></div><button class="xbtn" data-act="unsel" aria-label="Close">✕</button></div>
    <div class="sbody">${d.body}</div><div class="sfoot">${d.btns}</div>`;
}

function orderDetail(o, inPanel) {
  const open = o.status === 'pending', btns = [];
  const done = o.delivery_type === 'delivery' ? 'Out for delivery' : o.delivery_type === 'dinein' ? 'Close check' : 'Picked up';
  if (open) {
    btns.push(`<button class="btn danger ghost" data-act="askCancel" data-id="${esc(o.id)}">Cancel order</button>${printButtons(o.id)}<span style="flex:1"></span>`);
    if (!isPos(o) && !o.received_at) btns.push(`<button class="btn accent" data-act="received" data-id="${esc(o.id)}">Received</button>`);
    if (isPos(o) && can.order) btns.push(`<button class="btn" data-act="open" data-id="${esc(o.id)}">Edit order</button>`);
    if (o.balance > 0 && o.payment_status === 'in_store' && isPos(o) && can.pay) btns.push(`<button class="btn accent" data-act="payOrder" data-id="${esc(o.id)}">Take payment · ${$m(o.balance)}</button>`);
    else btns.push(`<button class="btn accent" data-act="complete" data-id="${esc(o.id)}">${o.balance > 0 ? `Collected ${$m(o.balance)} · ${done}` : done}</button>`);
  } else {
    btns.push(`<button class="btn" data-act="reopen" data-id="${esc(o.id)}">Reopen</button><span style="flex:1"></span>`);
    btns.push(`${printButtons(o.id)}<button class="btn accent" data-act="${inPanel ? 'unsel' : 'close'}">Close</button>`);
  }
  const ps = payState(o);
  const sub = `${esc(o.source)} · ${open ? 'Open · ' + mins(o.created_at) + ' min' : o.status === 'cancelled' ? 'Cancelled' : 'Closed ' + fmtTime(o.closed_at || o.updated_at)}`;
  const confirm = U.confirmCancel === o.id
    ? `<div class="callout"><span>Cancel ${esc(orderNo(o))}?${o.payment_status === 'paid' ? ' It was paid online: refund it in Clover.' : o.paid > 0 ? ` ${$m(o.paid)} was paid in store: give it back.` : ''}</span>
       <span class="row"><button class="btn sm" data-act="keepOrder">Keep it</button><button class="btn sm danger" data-act="cancelOrder" data-id="${esc(o.id)}">Yes, cancel</button></span></div>` : '';
  return {
    title: `${esc(orderNo(o))} · ${esc(orderLabel(o))}`, sub,
    body: `${confirm}${o.status !== 'cancelled' ? `<div class="banner-pay ${ps.cls === 'ok' ? 'ok' : 'due'}">${o.payment_status === 'paid' ? 'Paid online · do not collect' : ps.txt}</div>` : ''}${receiptHtml(o)}`,
    btns: btns.join(''),
  };
}

// ---------- payment ----------
function splitAmounts(base, raws) {
  const sum = raws.reduce((a, b) => a + b, 0);
  const out = raws.map((v) => (sum ? Math.round((v * base) / sum) : 0));
  if (out.length) out[out.length - 1] = base - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}

// Splits are remembered per order on this iPad until the order is paid.
const SPLITS = new Map();
function checksFor(o) {
  const P = U.pay, sp = SPLITS.get(o.id), mode = sp ? sp.mode : P.mode, n = sp ? sp.n : P.n, assign = sp ? sp.assign : P.assign;
  const base = sp ? sp.base : cents(o.balance);
  if (mode === 'even') return splitAmounts(base, Array(n).fill(1)).map((amt, i) => ({ i, amt, items: [] }));
  const raws = Array(n).fill(0), lists = Array.from({ length: n }, () => []);
  o.items.forEach((l) => {
    const a = assign[l.uid] ?? 'S', v = cents(l.price) * l.qty - cents(l.disc_amount);
    if (a === 'S') for (let g = 0; g < n; g++) { raws[g] += v / n; lists[g].push(`${shortName(l.name)} (shared 1/${n})`); }
    else { const g = Math.min(+a, n - 1); raws[g] += v; lists[g].push(`${l.qty}× ${shortName(l.name)}`); }
  });
  return splitAmounts(base, raws).map((amt, i) => ({ i, amt, items: lists[i] }));
}

async function openPay(id, advance = false) {
  // An order still being edited is saved first, so the server knows the real total.
  if (U.draft && U.draft.id === id && U.draft.dirty && !(await saveDraft({ quiet: true }))) return;
  if (!id && U.draft) {
    if (!(await saveDraft({ quiet: true }))) return;
    id = U.draft.id;
  }
  const sp = SPLITS.get(id);
  U.pay = { id, mode: sp ? sp.mode : 'full', n: sp ? sp.n : 2, assign: sp ? { ...sp.assign } : {}, method: 'card', tendered: '', custom: '', advance, busy: false };
  U.modal = 'pay';
  renderModal();
}

function payModal() {
  const P = U.pay, o = S.orders.find((x) => x.id === P.id);
  if (!o) return sheet('Order not found', '', '', '');
  const sp = SPLITS.get(o.id), mode = sp ? sp.mode : P.mode, bal = cents(o.balance);
  const pend = isPos(o) ? unsentOf(o) : 0;
  const tabs = [['full', 'Pay in full'], ['even', 'Split evenly'], ['item', 'Split by item'], ['custom', 'Custom amounts']]
    .map(([k, n]) => `<button class="chip ${mode === k ? 'on' : ''}" data-act="pmode" data-m="${k}" ${sp && sp.mode !== k ? 'disabled' : ''}>${n}</button>`).join('');
  let body = '';
  if (mode === 'full') {
    const t = cents(P.tendered);
    const quick = [bal, Math.ceil(bal / 500) * 500, Math.ceil(bal / 2000) * 2000, 5000, 10000].filter((v, i, a) => v >= bal && a.indexOf(v) === i).slice(0, 4);
    body = `<div class="chips">${['card', 'cash'].map((m) => `<button class="chip ${P.method === m ? 'on' : ''}" data-act="pmeth" data-m="${m}">${m === 'card' ? 'Card' : 'Cash'}</button>`).join('')}</div>
      ${P.method === 'cash' ? `<div class="row"><div class="field" style="max-width:180px"><label for="f-tendered">Cash received</label><input id="f-tendered" class="input" inputmode="decimal" value="${esc(P.tendered)}" placeholder="${(bal / 100).toFixed(2)}" data-input="tendered"></div>
        <div class="chips">${quick.map((v) => `<button class="chip" data-act="tq" data-v="${v}">${$c(v)}</button>`).join('')}</div></div>
        <div class="bal"><span class="muted">Change due</span><strong id="chg">${t >= bal ? $c(t - bal) : '—'}</strong></div>` : '<p class="muted" style="margin:0">Tap or insert the card on the terminal, then confirm here.</p>'}`;
  } else if (mode === 'custom') {
    body = `<div class="row"><div class="field" style="max-width:180px"><label for="f-custom">Amount for this payment</label><input id="f-custom" class="input" inputmode="decimal" value="${esc(P.custom)}" placeholder="${(bal / 100).toFixed(2)}" data-input="custom"></div>
      <button class="btn" data-act="payCustom" data-m="card">Charge card</button><button class="btn" data-act="payCustom" data-m="cash">Take cash</button></div>
      <p class="muted" style="margin:0">Each guest pays any amount until the balance reaches $0.00.</p>`;
  } else {
    const n = sp ? sp.n : P.n, assign = sp ? sp.assign : P.assign, checks = checksFor(o), paid = sp ? sp.paid : [];
    const step = sp ? '<span class="pill">Split locked after the first payment</span>' : `<div class="bigstep"><button data-act="pn" data-d="-1" aria-label="Fewer guests">−</button><span>${n}</span><button data-act="pn" data-d="1" aria-label="More guests">+</button></div>`;
    const assignHtml = mode === 'item' ? `<div><div class="eyebrow" style="margin-bottom:4px">Who had what</div>${o.items.map((l) => { const a = assign[l.uid] ?? 'S';
      return `<div class="assign"><span>${l.qty}× ${esc(shortName(l.name))} <span class="muted num">${$m(l.price * l.qty - l.disc_amount)}</span></span><div class="chips">${Array.from({ length: n }, (_, g) => `<button class="chip ${String(a) === String(g) ? 'on' : ''}" data-act="asg" data-u="${esc(l.uid)}" data-g="${g}" ${sp ? 'disabled' : ''}>G${g + 1}</button>`).join('')}<button class="chip ${a === 'S' ? 'on' : ''}" data-act="asg" data-u="${esc(l.uid)}" data-g="S" ${sp ? 'disabled' : ''}>Shared</button></div></div>`; }).join('')}</div>` : '';
    body = `<div class="row"><b>Guests</b>${step}</div>${assignHtml}
      <div class="checks">${checks.map((c) => { const done = paid.includes(c.i);
        return `<div class="guest ${done ? 'paid' : ''}"><div class="ghead"><span>Guest ${c.i + 1} · <b>${$c(c.amt)}</b></span>${done ? '<span class="pill ok">Paid</span>' : c.amt > 0 ? `<span class="row"><button class="btn sm" data-act="payCheck" data-i="${c.i}" data-m="card">Card</button><button class="btn sm" data-act="payCheck" data-i="${c.i}" data-m="cash">Cash</button></span>` : '<span class="muted">Nothing assigned</span>'}</div>
          ${c.items.length ? `<div class="gitems">${c.items.map(esc).join(' · ')}</div>` : ''}</div>`; }).join('')}</div>
      <p class="muted" style="margin:0">Each share includes its part of discounts, delivery and tax. Rounding cents go to the last guest.</p>`;
  }
  const pays = o.payments.length ? `<div><div class="eyebrow">Payments taken</div>${o.payments.map((p) => `<div class="trow num"><span>${esc(p.label)} · ${esc(p.method)}</span><span>${$m(p.amount)}</span></div>`).join('')}</div>` : '';
  const foot = mode === 'full' ? `<button class="btn accent" data-act="payFull" ${P.busy ? 'disabled' : ''}>${P.method === 'cash' ? 'Take cash' : 'Charge card'} · ${$c(bal)}</button>` : '';
  return sheet(`${P.advance ? 'Pay in advance' : 'Pay'} · ${esc(orderLabel(o))}`, `${esc(o.id)} · total ${$m(o.total)}`,
    `${pend ? `<div class="callout"><span>${pend} change${pend > 1 ? 's' : ''} not sent to the kitchen yet.</span><button class="btn sm" data-act="sendFromPay">Send now</button></div>` : ''}
     <div class="bal"><span class="muted">Balance due</span><strong>${$c(bal)}</strong></div>
     <div class="chips">${tabs}</div>${body}${pays}`, foot, true);
}

async function takePayment(amountCents, method, label, extra = {}) {
  const P = U.pay;
  if (P.busy) return;
  P.busy = true;
  try {
    const o = S.orders.find((x) => x.id === P.id);
    const close = !P.advance && amountCents >= cents(o.balance);
    const r = await api('POST', `${API}/orders/${encodeURIComponent(P.id)}/payments`,
      { method, amount: amountCents / 100, label, close, tendered: extra.tendered != null ? extra.tendered / 100 : null });
    upsertOrder(r.order);
    if (U.draft && U.draft.id === r.order.id) U.draft = r.order.status === 'pending' ? draftFromOrder(r.order) : null;
    P.busy = false;
    if (r.order.balance <= 0) {
      SPLITS.delete(r.order.id);
      U.pay = null;
      U.viewId = r.order.id;
      U.modal = 'receipt';
      toast(r.order.status === 'pending' ? 'Paid in advance · the order stays open until it goes out' : 'Payment complete · order closed');
    } else toast(`${$c(amountCents)} paid by ${method} · ${$m(r.order.balance)} left`);
  } catch (e) {
    P.busy = false;
    toast('Payment NOT recorded: ' + e.message);
  }
  renderModal();
  render();
}

function receiptModal() {
  const o = S.orders.find((x) => x.id === U.viewId);
  if (!o) return sheet('Receipt', '', '', '');
  return sheet(o.status === 'pending' ? 'Paid in advance' : 'Paid in full', esc(o.id), receiptHtml(o),
    `${printButtons(o.id)}<button class="btn" data-act="close">Close</button><button class="btn accent" data-act="afterPay">${o.delivery_type === 'dinein' ? 'Back to tables' : 'Start new order'}</button>`);
}

async function setStatus(id, status) {
  try {
    const r = await api('PATCH', `${API}/orders/${encodeURIComponent(id)}`, { status });
    upsertOrder(r.order);
    if (U.draft && U.draft.id === id && status !== 'pending') U.draft = null;
    toast(`${orderNo(r.order)} ${status === 'pending' ? 'reopened' : status}`);
    return r.order;
  } catch (e) {
    toast('Not changed: ' + e.message);
    return null;
  } finally {
    render();
  }
}
