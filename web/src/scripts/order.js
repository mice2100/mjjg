// Online ordering cart + checkout. Totals shown come from the Worker (/api/quote);
// the Worker recomputes everything again when the order is placed.
import { getConfig, getCustomer, onCustomerChange, updateProfile } from './account.js';
import { searchMenu, searchStreets, searchPlaces, fuzzyHighlight } from '../lib/search.js';
import { hasUnit } from '../lib/address.js';

const STORAGE_KEY = 'jg_cart_v3'; // v3: lines with options; v2 (id → qty) is read once and converted
const PENDING_KEY = 'jg_pending_payment'; // {id, t} while the customer is on the Clover page
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

let menu = new Map();
let state = { lines: [], delivery_type: 'pickup', coupon_code: '', tip: 'none' }; // lines: [{id, qty, mods: [{g, n}]}]
let groups = []; // option groups from /api/options
let quote = null;
let quoteTimer = null;
let turnstileToken = '';
let turnstileWidget = null;
let placeLabel = 'Continue to payment'; // 'Place order' when online payment is off (local dev)

let soldOut = new Set(); // menu ids from /api/availability

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.lines) state = { ...state, ...saved };
    else {
      const old = JSON.parse(localStorage.getItem('jg_cart_v2') || 'null');
      if (old?.items) {
        const { items, ...rest } = old;
        state = { ...state, ...rest, lines: Object.entries(items).map(([id, qty]) => ({ id: Number(id), qty, mods: [] })) };
      }
    }
  } catch {
    /* ignore */
  }
  // Drop dishes no longer on the menu.
  state.lines = (state.lines || []).filter((l) => menu.has(Number(l.id)) && l.qty > 0);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

const cartItems = () => state.lines.map((l) => ({ id: l.id, qty: l.qty, mods: l.mods }));
const itemCount = () => state.lines.reduce((a, l) => a + l.qty, 0);
const qtyOf = (id) => state.lines.filter((l) => l.id === id).reduce((a, l) => a + l.qty, 0);

// ---- dish options (same groups as the POS; the server checks and prices them) ----
const groupsFor = (id) => groups.filter((g) => g.item_ids.includes(id));
// A dish opens the choice window when it has a required choice or an option that costs extra.
// Spicy dishes (chilli icon) and gluten free dishes (GF badge) open it too: spice level / gluten free.
const needsChoice = (id) => groupsFor(id).some((g) => g.min > 0 || g.id === 'spice' || g.id === 'gluten_free' || g.options.some((o) => o.price_cents > 0));
// "+1 person / +2 people / …" priced n × the first option: shown as a quantity, like the POS.
const isCounter = (g) => g.min === 0 && g.max === 1 && g.options.length > 1
  && g.options.every((o, i) => new RegExp(`^\\+${i + 1}\\b`).test(o.name) && o.price_cents === g.options[0].price_cents * (i + 1));
const modKey = (mods) => mods.map((m) => `${m.g}:${m.n}`).sort().join(',');
const optionOf = (m) => groups.find((g) => g.id === m.g)?.options.find((o) => o.name === m.n);
const unitCents = (l) => Math.round(menu.get(l.id).price * 100) + l.mods.reduce((sum, m) => sum + (optionOf(m)?.price_cents || 0), 0);

function changed() {
  save();
  render();
  requestQuote();
}
function addLine(id, mods = [], qty = 1) {
  const key = modKey(mods);
  const line = state.lines.find((l) => l.id === id && modKey(l.mods) === key);
  if (line) line.qty = Math.min(line.qty + qty, 50);
  else state.lines.push({ id, qty, mods });
  changed();
}
function setLineQty(line, qty) {
  if (qty <= 0) state.lines = state.lines.filter((l) => l !== line);
  else line.qty = Math.min(qty, 50);
  changed();
}
// Dishes without choices: one line, changed with − / + on the menu row.
function setQty(id, qty) {
  const line = state.lines.find((l) => l.id === id && !l.mods.length);
  if (line) setLineQty(line, qty);
  else if (qty > 0) addLine(id, [], qty);
}
function tapAdd(id) {
  if (soldOut.has(id)) return;
  if (needsChoice(id)) openChoice(id);
  else setQty(id, qtyOf(id) + 1);
}

const counterValue = (g, pick) => g.options.findIndex((o) => pick[g.id].includes(o.name)) + 1;
function counterHtml(g, pick) {
  const n = counterValue(g, pick), each = g.options[0].price_cents;
  return `<div class="opt-count"><div class="opt-count-head"><b>${g.name.replace(/\s*\(.*\)\s*$/, '')}</b><span class="opt-each">${money(each)} each</span></div>
    <div class="opt-count-row"><span class="qty big"><button type="button" data-cnt="${g.id}" data-d="-1" aria-label="One fewer" ${n ? '' : 'disabled'}>−</button><span>${n}</span>
      <button type="button" data-cnt="${g.id}" data-d="1" aria-label="One more" ${n < g.options.length ? '' : 'disabled'}>+</button></span>
      <span class="opt-price">${n ? '+' + money(each * n) : 'None added'}</span></div></div>`;
}

// A single optional choice (e.g. Gluten free) is a tick box, so it can be un-ticked.
const tickBox = (g) => g.min === 0 && g.options.length === 1;

let choiceDialog = null;
function openChoice(id) {
  const item = menu.get(id);
  if (!choiceDialog) {
    choiceDialog = document.createElement('dialog');
    choiceDialog.className = 'opt-dialog';
    document.body.append(choiceDialog);
    choiceDialog.addEventListener('click', (e) => e.target === choiceDialog && choiceDialog.close());
  }
  const list = groupsFor(id);
  const pick = Object.fromEntries(list.map((g) => [g.id, []]));
  let qty = 1;
  const d = choiceDialog;
  const draw = () => {
    const mods = list.flatMap((g) => pick[g.id].map((n) => ({ g: g.id, n })));
    const missing = list.filter((g) => pick[g.id].length < g.min);
    const total = unitCents({ id, mods }) * qty;
    d.innerHTML = `<form method="dialog" class="opt-form">
      <header><h3></h3><button type="button" class="opt-x" aria-label="Close">✕</button></header>
      <div class="opt-groups">${list.map((g) => isCounter(g) ? counterHtml(g, pick) : `<fieldset data-g="${g.id}"><legend>${g.name}${g.min ? ' <span class="opt-req">Required</span>' : ''}<small>${tickBox(g) ? 'Optional' : g.max === 1 ? (g.min ? 'Pick one' : 'Optional · pick one') : 'Pick any'}</small></legend>
        ${g.options.map((o) => `<label class="opt-row"><input type="${g.max === 1 && !tickBox(g) ? 'radio' : 'checkbox'}" name="g-${g.id}" value="${o.name.replace(/"/g, '&quot;')}" ${pick[g.id].includes(o.name) ? 'checked' : ''}>
          <span class="opt-name"></span><span class="opt-price">${o.price_cents ? '+' + money(o.price_cents) : ''}</span></label>`).join('')}</fieldset>`).join('')}</div>
      <footer><span class="qty"><button type="button" data-q="-1" aria-label="One less">−</button><span>${qty}</span><button type="button" data-q="1" aria-label="One more">+</button></span>
        <button type="button" class="btn-add" ${missing.length ? 'disabled' : ''}>${missing.length ? `Pick: ${missing[0].name}` : `Add · ${money(total)}`}</button></footer>
    </form>`;
    d.querySelector('h3').textContent = item.name;
    // option names as text (they come from the restaurant's settings)
    list.forEach((g) => d.querySelectorAll(`fieldset[data-g="${g.id}"] .opt-name`).forEach((el, i) => (el.textContent = g.options[i].name)));
    d.querySelector('.opt-x').onclick = () => d.close();
    d.querySelectorAll('input').forEach((inp) => (inp.onchange = () => {
      const g = list.find((x) => `g-${x.id}` === inp.name);
      pick[g.id] = [...d.querySelectorAll(`input[name="g-${g.id}"]:checked`)].map((x) => x.value).slice(0, g.max);
      draw();
    }));
    d.querySelectorAll('[data-cnt]').forEach((b) => (b.onclick = () => {
      const g = list.find((x) => x.id === b.dataset.cnt);
      const n = Math.max(0, Math.min(g.options.length, counterValue(g, pick) + Number(b.dataset.d)));
      pick[g.id] = n ? [g.options[n - 1].name] : [];
      draw();
    }));
    d.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { qty = Math.max(1, Math.min(50, qty + Number(b.dataset.q))); draw(); }));
    d.querySelector('.btn-add').onclick = () => {
      if (missing.length) return;
      d.close();
      addLine(id, mods, qty);
    };
  };
  draw();
  d.showModal();
}

function contact() {
  const form = $('[data-step="checkout"]');
  return {
    customer_email: form.customer_email.value.trim(),
    customer_phone: form.customer_phone.value.trim(),
    // The server prices delivery from the address: $7 house, $8 apartment / hotel.
    delivery_address: state.delivery_type === 'delivery' ? form.delivery_address.value.trim() : '',
  };
}

function requestQuote() {
  clearTimeout(quoteTimer);
  if (!itemCount()) {
    quote = null;
    renderTotals();
    return;
  }
  quoteTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cartItems(), delivery_type: state.delivery_type, coupon_code: state.coupon_code, tip: state.tip, ...contact() }),
      });
      const data = await res.json();
      quote = res.ok ? data.quote : null;
    } catch {
      quote = null;
    }
    renderTotals();
    renderCouponMessage();
  }, 200);
}

function localEstimate() {
  let subtotal = 0;
  for (const l of state.lines) subtotal += unitCents(l) * l.qty;
  const fee = state.delivery_type === 'delivery' ? 700 : 0; // house rate until the server sees the address
  const tax = Math.round((subtotal * 11) / 100); // food only; delivery is not taxed
  const before = subtotal + fee + tax;
  const tip = state.tip === 'round' ? Math.ceil(before / 100) * 100 - before : Math.round((subtotal * (Number(state.tip) || 0)) / 100);
  return { subtotal_cents: subtotal, discount_cents: 0, delivery_fee_cents: fee, tax_cents: tax, tip_cents: tip, total_cents: before + tip, items: [] };
}

function renderTotals() {
  const q = quote || localEstimate();
  // Food subtotal, tax (on food only), then the untaxed delivery fee.
  const rows = [['Food subtotal', money(q.subtotal_cents)]];
  if (q.discount_cents) rows.push([`Discount${q.coupon ? ` (${q.coupon.code})` : ''}`, `−${money(q.discount_cents)}`, 'discount']);
  rows.push(['GST + PST (11%)', money(q.tax_cents)]);
  if (state.delivery_type === 'delivery') rows.push([q.delivery_place === 'apartment' ? 'Delivery (apartment / hotel)' : 'Delivery', money(q.delivery_fee_cents)]);
  if (q.tip_cents) rows.push(['Tip', money(q.tip_cents)]);
  rows.push(['Total', money(q.total_cents), 'grand']);

  for (const dl of $$('[data-totals]')) {
    dl.replaceChildren(
      ...rows.map(([label, value, cls]) => {
        const div = document.createElement('div');
        if (cls) div.className = cls;
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        div.append(dt, dd);
        return div;
      })
    );
  }
  const free = quote?.items?.find((l) => l.free);
  if (free) {
    const div = document.createElement('div');
    div.innerHTML = '<dt></dt><dd>FREE</dd>';
    div.firstChild.textContent = `+ ${free.name}`;
    $$('[data-totals]').forEach((dl) => dl.prepend(div.cloneNode(true)));
  }
  $('[data-bar-total]').textContent = money(q.total_cents);

  for (const b of $$('[data-tip]')) {
    b.setAttribute('aria-checked', String(b.dataset.tip === state.tip));
    const cents = quote?.tip_options?.[b.dataset.tip];
    $('[data-tip-amount]', b).textContent = b.dataset.tip !== 'none' && cents != null ? `+${money(cents)}` : '';
  }
}

function renderCouponMessage() {
  const el = $('[data-coupon-msg]');
  if (!state.coupon_code) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (quote?.coupon) {
    el.className = 'coupon-msg ok';
    el.textContent = `${quote.coupon.code} applied: ${quote.coupon.description}${quote.coupon_message ? ` ${quote.coupon_message}` : ''}`;
  } else {
    el.className = 'coupon-msg err';
    el.textContent = quote?.coupon_message || 'This code is not valid.';
  }
}

function render() {
  const lines = $('[data-lines]');
  lines.replaceChildren();
  for (const line of state.lines) {
    const { id, qty } = line;
    const item = menu.get(id);
    const li = document.createElement('li');
    li.className = 'cart-line';
    li.innerHTML = `<span class="ln"></span>
      <span class="qty"><button type="button" aria-label="Remove one">−</button><span></span><button type="button" aria-label="Add one">+</button></span>
      <span class="line-price"></span>`;
    li.querySelector('.ln').textContent = `${item.code ? item.code + ' ' : ''}${item.name}`;
    if (line.mods.length) {
      const small = document.createElement('small');
      small.className = 'ln-mods';
      small.textContent = line.mods.map((m) => m.n).join(', ');
      li.querySelector('.ln').append(small);
    }
    li.querySelector('.qty span').textContent = qty;
    li.querySelector('.line-price').textContent = money(unitCents(line) * qty);
    const [minus, plus] = li.querySelectorAll('button');
    minus.onclick = () => setLineQty(line, qty - 1);
    plus.onclick = () => setLineQty(line, qty + 1);
    lines.append(li);
  }
  const count = itemCount();
  $('[data-empty]').hidden = count > 0;
  $('[data-to-checkout]').disabled = count === 0;
  $$('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === state.delivery_type)));
  $('[data-address-field]').hidden = state.delivery_type !== 'delivery';
  $$('[data-add]').forEach((b) => {
    const id = Number(b.dataset.add);
    const q = qtyOf(id);
    const out = soldOut.has(id);
    const choice = needsChoice(id);
    let step = b.nextElementSibling?.classList.contains('mi-step') ? b.nextElementSibling : null;
    if (!step) {
      step = document.createElement('span');
      step.className = 'qty mi-step';
      step.innerHTML = '<button type="button" aria-label="Remove one">−</button><span></span><button type="button" aria-label="Add one">+</button>';
      const [minus, plus] = step.querySelectorAll('button');
      minus.onclick = () => setQty(id, qtyOf(id) - 1);
      plus.onclick = () => setQty(id, qtyOf(id) + 1);
      b.after(step);
    }
    // − / + for plain dishes; dishes with choices keep "Add" (each choice is its own cart line).
    const stepper = q > 0 && !choice && !out;
    step.hidden = !stepper;
    step.querySelector('span').textContent = q;
    b.hidden = stepper;
    b.disabled = out;
    b.classList.toggle('in-cart', Boolean(q) && choice);
    b.textContent = out ? 'Sold out' : q && choice ? `Add · ${q} in cart` : 'Add';
  });
  const bar = $('[data-cart-open]');
  bar.hidden = count === 0;
  $('[data-bar-count]').textContent = `${count} item${count === 1 ? '' : 's'}`;
  renderTotals();
}

function showStep(name) {
  $$('[data-step]').forEach((el) => (el.hidden = el.dataset.step !== name));
  $('.cart-inner').scrollTop = 0;
}

function openCart() {
  $('[data-cart]').classList.add('open');
}
function closeCart() {
  $('[data-cart]').classList.remove('open');
}

function prefill(c) {
  if (!c) return;
  const form = $('[data-step="checkout"]');
  const set = (name, value) => {
    if (value && !form[name].value) form[name].value = value;
  };
  set('customer_name', c.name);
  set('customer_email', c.email);
  set('customer_phone', c.phone);
  set('delivery_address', c.default_address);
  if (c.marketing_opt_in) form.marketing_opt_in.checked = true;
}

async function mountTurnstile() {
  const config = await getConfig();
  if (!config.turnstile_site_key || turnstileWidget !== null) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  turnstileWidget = window.turnstile.render($('[data-turnstile]'), {
    sitekey: config.turnstile_site_key,
    callback: (token) => (turnstileToken = token),
    'expired-callback': () => (turnstileToken = ''),
  });
}

async function placeOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorEl = $('[data-form-error]');
  const button = $('[data-place-order]');
  errorEl.hidden = true;

  if (!form.reportValidity()) return;
  if (state.delivery_type === 'delivery' && !form.delivery_address.value.trim()) {
    errorEl.textContent = 'Please enter your delivery address.';
    errorEl.hidden = false;
    form.delivery_address.focus();
    return;
  }
  // Apartments, condos and hotels (the server decides which): the driver needs the unit or room.
  if (state.delivery_type === 'delivery' && quote?.delivery_place === 'apartment' && !hasUnit(form.delivery_address.value)) {
    errorEl.textContent = 'This looks like an apartment, condo, hotel or trailer court. Please add your unit, suite, room or lot number, e.g. "Unit 904", "Room 210" or "Lot A24".';
    errorEl.hidden = false;
    form.delivery_address.focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Placing order…';
  const onlinePayment = (await getConfig()).online_payment;
  const payload = {
    items: cartItems(),
    delivery_type: state.delivery_type,
    coupon_code: state.coupon_code,
    customer_name: form.customer_name.value.trim(),
    customer_phone: form.customer_phone.value.trim(),
    customer_email: form.customer_email.value.trim(),
    delivery_address: form.delivery_address.value.trim(),
    customer_notes: form.customer_notes.value.trim(),
    tip: state.tip,
    marketing_opt_in: form.marketing_opt_in.checked,
    turnstile_token: turnstileToken,
  };

  try {
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { coupon: data.coupon_error });

    const order = data.order;
    if (getCustomer()) updateProfile({ phone: payload.customer_phone, default_address: payload.delivery_address }).catch(() => {});
    if (data.payment_url) {
      // The cart stays until Clover sends the customer back with a confirmed payment.
      setPending({ id: order.id, t: order.public_token });
      button.textContent = 'Opening secure payment…';
      location.assign(data.payment_url);
      return;
    }
    showDone(order, onlinePayment ? 'online' : 'in_store');
    resetPlaceButton();
  } catch (err) {
    errorEl.textContent = err.coupon
      ? `${err.message} Remove the promo code to continue, or call us at (306) 694-5566.`
      : `${err.message} If this keeps happening, please call us at (306) 694-5566.`;
    errorEl.hidden = false;
    if (window.turnstile && turnstileWidget !== null) window.turnstile.reset(turnstileWidget);
    turnstileToken = '';
    resetPlaceButton();
  }
}

function resetPlaceButton() {
  const button = $('[data-place-order]');
  button.disabled = false;
  button.textContent = placeLabel;
}

function getPending() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
  } catch {
    return null;
  }
}
function setPending(value) {
  try {
    if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode */
  }
}

function clearCart() {
  state = { items: {}, delivery_type: state.delivery_type, coupon_code: '', tip: 'none' };
  save();
  render();
}

function showDone(order, paidHow) {
  $('[data-done-eyebrow]').textContent = 'Thank you!';
  $('[data-done-title]').innerHTML = 'Order <span data-order-id></span> received';
  $('[data-order-id]').textContent = order.id;
  const when = `${order.delivery_type === 'delivery' ? 'We’ll deliver to you' : 'We’ll have it ready for pickup'} as soon as possible.`;
  const paid =
    paidHow === 'online'
      ? `Total ${money(order.total_cents)}, paid online.`
      : `Total ${money(order.total_cents)}, paid at ${order.delivery_type === 'delivery' ? 'the door' : 'pickup'}.`;
  $('[data-done-text]').textContent = `${when} ${paid}`;
  clearCart();
  showStep('done');
  openCart();
}

function showCheckoutError(message) {
  showStep('checkout');
  prefill(getCustomer());
  mountTurnstile().catch(() => {});
  const errorEl = $('[data-form-error]');
  errorEl.textContent = message;
  errorEl.hidden = false;
  openCart();
}

// Clover sent the customer back. The webhook may land a moment later, so poll briefly.
async function confirmPayment(id, token) {
  $('[data-done-eyebrow]').textContent = 'One moment';
  $('[data-done-title]').textContent = 'Confirming your payment…';
  $('[data-done-text]').textContent = 'This usually takes a few seconds. Please keep this page open.';
  showStep('done');
  openCart();

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/status?t=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (res.ok && data.order.payment_status === 'paid') {
        setPending(null);
        showDone(data.order, 'online');
        return;
      }
      if (res.status === 404) break;
    } catch {
      /* network blip: keep trying */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  $('[data-done-eyebrow]').textContent = 'Still checking';
  $('[data-done-title]').textContent = `Order ${id}`;
  $('[data-done-text]').textContent =
    'We have not received the payment confirmation yet. If your card was charged, your order is safe. Please call us at (306) 694-5566 and we’ll confirm it.';
}

// Called on load: returning from Clover (?paid= / ?payment_failed=) or with the Back button.
function resumePayment(params = new URLSearchParams(location.search)) {
  const paidId = params.get('paid');
  const failedId = params.get('payment_failed');
  const token = params.get('t');
  if (paidId || failedId) history.replaceState(null, '', location.pathname);
  if (paidId && token) return confirmPayment(paidId, token);
  if (failedId) {
    setPending(null);
    return showCheckoutError('Your payment did not go through, and you have not been charged. Please try again or use another card.');
  }
  const pending = getPending();
  if (pending) {
    setPending(null);
    showCheckoutError('Your payment was not finished, so the order was not sent to the kitchen. Press “Continue to payment” to try again.');
  }
}

// Same fuzzy search as the staff POS (lib/search.js): "b8", "gngr bf", "chicken".
// Matching dishes are re-ordered best first, and the best category moves to the top.
function setUpSearch() {
  const input = $('[data-search]');
  const items = [...menu.values()];
  const rows = new Map($$('[data-item]').map((li) => [Number(li.dataset.item), li]));
  const original = new Map($$('[data-cat]').map((cat) => [cat, $$('[data-item], [data-group-head]', cat)])); // headings stay in place

  input.addEventListener('input', () => {
    const q = input.value.trim();
    const results = searchMenu(items, q);
    const rank = new Map(results.map((r, i) => [r.item.id, i]));
    const hits = new Map(results.map((r) => [r.item.id, r]));

    for (const [id, li] of rows) {
      const item = menu.get(id);
      const hit = q ? hits.get(id) : null;
      li.hidden = !hits.has(id);
      $('.mi-name', li).innerHTML = fuzzyHighlight(item.name, hit?.namePositions);
      const code = $('.mi-code', li);
      if (code) code.innerHTML = fuzzyHighlight(item.code, hit?.codePositions);
    }

    for (const [cat, lis] of original) {
      const list = $('.menu-list', cat);
      const ordered = q ? [...lis].sort((a, b) => (rank.get(+a.dataset.item) ?? 1e9) - (rank.get(+b.dataset.item) ?? 1e9)) : lis;
      list.append(...ordered);
      lis.forEach((li) => { if (li.dataset.groupHead !== undefined) li.hidden = Boolean(q); });
      const best = Math.min(...lis.map((li) => rank.get(+li.dataset.item) ?? 1e9));
      cat.hidden = best === 1e9;
      cat.style.order = q && !cat.hidden ? String(best) : '';
      const link = $(`[data-cat-link="${cat.id}"]`);
      if (link) link.hidden = cat.hidden;
    }
    $('[data-no-results]').hidden = results.length > 0;
  });
}

// Moose Jaw street autocomplete, same matching as the staff POS. Hotels and apartment
// buildings are suggested too, by name ("langdon") or street address ("450 langdon").
function setUpAddress() {
  const input = $('#f-address');
  const list = $('[data-street-list]');
  let streets = null;
  let results = [];
  let active = -1;

  const loadStreets = () =>
    (streets ??= fetch('/api/streets')
      .then((r) => r.json())
      .then((d) => ({
        streets: d.streets || [],
        places: [
          ...(d.hotels || []),
          ...(d.apartment_buildings || []).map((b) => ({ ...b, type: b.type || 'Apartment', street: b.address, address: [b.address, ...(b.also || [])].join(' / ') || b.name })),
        ],
      }))
      .catch(() => ((streets = null), { streets: [], places: [] })));

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const paint = () => {
    $$('li', list).forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) input.setAttribute('aria-activedescendant', `street-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const choose = (i) => {
    if (!results[i]) return;
    // A hotel or building: leave room for the unit or room number after it.
    input.value = results[i].place ? results[i].full + ', ' : results[i].full;
    close();
    input.focus();
    requestQuote();
  };

  const update = async () => {
    const value = input.value;
    const all = await loadStreets();
    if (input.value !== value) return; // a newer keystroke is in flight
    const places = /[a-z]{2}/i.test(value) && !value.includes(',')
      ? searchPlaces(all.places, value, 4).map((r) => {
          const street = r.place.street || r.place.address;
          return { ...r, full: !street || r.place.name === street ? r.place.name || street : `${r.place.name}, ${street}` };
        })
      : [];
    results = [...places, ...searchStreets(all.streets, value)];
    if (!results.length || (results.length === 1 && results[0].full === value.trim())) return close();
    list.replaceChildren(
      ...results.map((r, i) => {
        const li = document.createElement('li');
        li.id = `street-opt-${i}`;
        li.setAttribute('role', 'option');
        if (r.place) {
          li.innerHTML = `<span>${fuzzyHighlight(r.place.name, r.positions)}<small class="st-addr"></small></span><span class="st-tag"></span>`;
          $('.st-addr', li).textContent = r.place.street || r.place.address;
          $('.st-tag', li).textContent = r.place.type || 'Hotel';
        } else {
          li.innerHTML = `<span>${r.house ? '<span class="st-house"></span>' : ''}${fuzzyHighlight(r.street, r.positions)}</span><span class="st-tag"></span>`;
          if (r.house) $('.st-house', li).textContent = r.house;
          $('.st-tag', li).textContent = r.typeTag;
        }
        // mousedown so the choice lands before the input loses focus.
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(i);
        });
        return li;
      })
    );
    active = -1;
    paint();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('focus', loadStreets, { once: true });
  input.addEventListener('input', update);
  input.addEventListener('input', requestQuote); // house or apartment changes the delivery fee
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      paint();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });
}

export function initOrderPage() {
  const items = JSON.parse($('#menu-data').textContent);
  menu = new Map(items.map((m) => [m.id, m]));
  load();

  const params = new URLSearchParams(location.search);
  if (['pickup', 'delivery'].includes(params.get('type'))) state.delivery_type = params.get('type');
  const addId = Number(params.get('add'));
  if (params.has('add') || params.has('type')) history.replaceState(null, '', location.pathname);
  if (params.get('code')) state.coupon_code = params.get('code').toUpperCase();
  save();

  $$('[data-add]').forEach((b) => (b.onclick = () => tapAdd(Number(b.dataset.add))));
  // Dish options (chicken balls or sweet & sour pork, extra people, …). Until they load, dishes add plainly.
  // Set dinners: what they contain, in plain names.
  fetch('/api/set-dinners')
    .then((r) => r.json())
    .then((data) => {
      for (const el of $$('[data-includes]')) {
        const list = data.contents?.[el.dataset.includes];
        if (!list?.length) continue;
        el.textContent = list.join(' · ');
        el.hidden = false;
      }
    })
    .catch(() => {});
  fetch('/api/options')
    .then((r) => r.json())
    .then((data) => {
      groups = data.groups || [];
      // Saved lines keep only options that still exist.
      for (const l of state.lines) l.mods = (l.mods || []).filter((m) => optionOf(m));
      if (menu.has(addId)) tapAdd(addId);
      save();
      render();
      requestQuote();
    })
    .catch(() => menu.has(addId) && tapAdd(addId));
  // Dishes the restaurant marked sold out today (staff Menu tab): grey them out and take
  // them out of a saved cart. The server refuses them anyway.
  fetch('/api/availability')
    .then((r) => r.json())
    .then((data) => {
      soldOut = new Set(data.sold_out || []);
      state.lines = state.lines.filter((l) => !soldOut.has(l.id));
      save();
      render();
    })
    .catch(() => {});
  $$('.seg button').forEach(
    (b) =>
      (b.onclick = () => {
        state.delivery_type = b.dataset.type;
        save();
        render();
        requestQuote();
      })
  );
  $('[data-coupon-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    state.coupon_code = e.currentTarget.code.value.trim().toUpperCase();
    save();
    requestQuote();
  });
  $('#coupon-input').value = state.coupon_code;

  $('[data-to-checkout]').onclick = () => {
    showStep('checkout');
    prefill(getCustomer());
    mountTurnstile().catch(() => {});
  };
  $('[data-back]').onclick = () => showStep('cart');
  $('[data-new-order]').onclick = () => showStep('cart');
  const checkout = $('[data-step="checkout"]');
  checkout.addEventListener('submit', placeOrder);
  // Re-check coupon eligibility (first order / once per customer) once contact details are known.
  for (const name of ['customer_email', 'customer_phone']) checkout[name].addEventListener('change', () => state.coupon_code && requestQuote());

  $('[data-cart-open]').onclick = openCart;
  $('[data-cart-close]').onclick = closeCart;
  $('[data-cart]').addEventListener('click', (e) => e.target === e.currentTarget && closeCart());

  onCustomerChange((c) => {
    prefill(c);
    if (c) $('.signin-nudge').hidden = true;
    if (state.coupon_code) requestQuote();
  });
  $$('[data-tip]').forEach(
    (b) =>
      (b.onclick = () => {
        state.tip = b.dataset.tip;
        save();
        renderTotals();
        requestQuote();
      })
  );
  getConfig()
    .then((config) => {
      if (config.online_payment) return;
      $('[data-pay-note]').textContent = 'Payment is collected at pickup or on delivery.';
      placeLabel = 'Place order';
      $('[data-place-order]').textContent = placeLabel;
    })
    .catch(() => {});
  // Back from the Clover page via the browser's bfcache: the button must work again.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    resetPlaceButton();
    resumePayment();
  });

  setUpSearch();
  setUpAddress();
  render();
  requestQuote();
  resumePayment(params);
}
