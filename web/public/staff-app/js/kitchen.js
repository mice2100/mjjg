// Kitchen display. Two lanes: dine-in, and pickup / delivery.
// POS orders send tickets (NEW, ADD-ON, VOID, CHANGE); "Done" bumps one ticket.
// Website and WordPress orders (and orders from the classic screen) have no tickets: the
// whole order is one ticket and "Done" completes the order, as on the old order board.
'use strict';

function kitchenTickets() {
  const byId = new Map(S.orders.map((o) => [o.id, o]));
  const real = S.tickets
    .map((t) => ({ ...t, order: byId.get(t.order_id) }))
    .filter((t) => t.order && t.order.status !== 'cancelled');
  const whole = S.orders
    .filter((o) => !o.ticketed && o.status !== 'cancelled' && (o.status === 'pending' || Date.now() - Date.parse(o.closed_at || o.updated_at) < 3 * 3600000))
    .map((o) => ({
      id: 'o:' + o.id, order_id: o.id, order: o, kind: 'NEW', whole: true, note: '',
      items: o.items.map((it) => ({ qty: it.qty, name: it.name, mods: (it.mods || []).map((m) => m.n), note: it.note || '', components: it.components || [] })),
      voids: [], created_at: o.created_at, done_at: o.status === 'pending' ? null : o.closed_at || o.updated_at,
    }));
  return [...real, ...whole];
}

function ticketHtml(t) {
  const o = t.order, m = mins(t.created_at), age = t.done_at ? '' : m >= 15 ? 'age-late' : m >= 10 ? 'age-warn' : '';
  const kl = { NEW: 'NEW', ADD: 'ADD-ON', VOID: 'VOID', CHANGE: 'CHANGE' }[t.kind];
  const items = t.items.map((e) => `<li class="tk-item"><b>${e.qty}×</b> ${dishHtml(e.name)}
      ${e.mods.length ? `<div class="tk-mods">${e.mods.map(esc).join(', ')}</div>` : ''}
      ${(e.components || []).map((c) => `<div class="tk-comp">↳ ${c.qty * e.qty}× ${esc(shortName(c.name))}</div>`).join('')}
      ${e.note ? `<div class="tk-note">** ${esc(e.note)}</div>` : ''}</li>`).join('');
  const voids = t.voids.map((e) => `<li class="void"><b>${e.qty}×</b> ${esc(shortName(e.name))}</li>`).join('');
  const dine = o.delivery_type === 'dinein';
  const pay = t.whole ? (o.payment_status === 'paid' ? '<span class="tk-pay ok">PAID ONLINE</span>' : o.balance > 0 ? `<span class="tk-pay due">COLLECT ${$m(o.balance)}</span>` : '') : '';
  const notes = t.whole && o.customer_notes ? `<li class="chg">!! ${esc(o.customer_notes)}</li>` : '';
  const doneId = esc(t.whole ? o.id : t.id);
  return `<article class="ticket lane-${dine ? 'dine' : 'togo'} ${age} ${t.done_at ? 'done' : ''}">
    <header class="tk-head" data-act="viewOrder" data-id="${esc(o.id)}" title="Order details">
      <div class="tk-top"><span>${esc(orderNo(o))}</span><span>${m} min</span></div>
      <div class="tk-sub"><span>${esc(orderLabel(o))}</span><span class="kind ${t.kind}">${kl}</span></div>
      <div class="tk-sub"><span>${sourceTag(o)} ${o.delivery_type !== 'dinein' && o.delivery_time_slot ? esc(o.delivery_time_slot) : ''}</span><span>${fmtTime(t.created_at)}</span></div>
    </header>
    <ul>${t.note ? `<li class="chg">!! ${esc(t.note)}</li>` : ''}${notes}${items}${voids ? `<li class="muted">— VOID —</li>${voids}` : ''}</ul>
    <footer><span class="ttype">${(TYPES[o.delivery_type] || '').toUpperCase()}</span>${pay}
      ${t.whole && !isPos(o) && !o.received_at && !t.done_at ? `<button class="btn sm accent" data-act="received" data-id="${esc(o.id)}">Received</button>` : ''}
      ${!can.bump && !t.whole ? '' : t.done_at ? `<button class="btn sm" data-act="recall" data-id="${doneId}" data-whole="${t.whole ? 1 : 0}">Recall</button>`
        : `<button class="btn sm primary" data-act="bump" data-id="${doneId}" data-whole="${t.whole ? 1 : 0}">Done</button>`}</footer>
  </article>`;
}

function viewKds() {
  const all = kitchenTickets();
  const lane = (key, title, test, emptyMsg) => {
    const live = all.filter((t) => !t.done_at && test(t)).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const done = all.filter((t) => t.done_at && test(t)).sort((a, b) => (a.done_at < b.done_at ? 1 : -1)).slice(0, 3);
    return `<section class="lane ${key}" aria-label="${title}">
      <div class="lanehead"><h3>${title}</h3><span class="cnt">${live.length} open</span></div>
      <div class="kgrid">${live.map(ticketHtml).join('') || `<div class="empty">${emptyMsg}</div>`}</div>
      ${done.length ? `<div class="done-h">Recently done</div><div class="kgrid">${done.map(ticketHtml).join('')}</div>` : ''}
    </section>`;
  };
  return `<div class="sechead"><h2>Kitchen display</h2><span class="muted">Tap a ticket header for the full order.</span></div>
    <div class="klanes">
      ${lane('dine', 'Dine-in', (t) => t.order.delivery_type === 'dinein', 'No dine-in tickets waiting.')}
      ${lane('togo', 'Pickup · Delivery', (t) => t.order.delivery_type !== 'dinein', 'No pickup or delivery tickets waiting.')}
    </div>`;
}

const openTicketCount = () => kitchenTickets().filter((t) => !t.done_at).length;

async function bump(id, whole, done) {
  if (whole) {
    await setStatus(id, done ? 'completed' : 'pending');
    return;
  }
  try {
    const r = await api('PATCH', `${API}/tickets/${encodeURIComponent(id)}`, { done });
    const i = S.tickets.findIndex((t) => String(t.id) === String(id));
    if (i >= 0) S.tickets[i] = r.ticket;
  } catch (e) {
    toast('Not changed: ' + e.message);
  }
  render();
}
