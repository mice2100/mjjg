// Menu tab: item options (spice level, requests ...), sold-out switches and combo contents.
// Dishes and prices stay in data/menu.json (deployed); these settings live in D1.
// Editing options and combos is limited to ADMIN_EMAILS; any staff member can mark sold out.
'use strict';

const ruleText = (g) => (g.min ? 'Required · choose one' : g.max === 1 ? 'Optional · choose one' : 'Optional · choose any');
const looksLikeCombo = (item) => /combo|dinner for|platter/i.test(item.name) || /dinner (special|for one)|family dinner/i.test(item.category);

function viewMenu() {
  const out = S.menu.filter((i) => S.sold.has(i.id)).length;
  const gcards = S.groups.map((g) => {
    const used = g.item_ids.length;
    return `<button class="gcard" data-act="editGroup" data-g="${esc(g.id)}"><span class="gc-top"><b>${esc(g.name)}</b><span class="muted" style="font-size:12px">${ruleText(g)}</span></span>
      <span class="gc-opts">${g.options.map((o) => esc(o.name) + (o.price_cents ? ` <span class="muted">+${$c(o.price_cents)}</span>` : '')).join(' · ')}</span>
      <span class="muted" style="font-size:12px">Used by ${used} dish${used === 1 ? '' : 'es'}</span></button>`;
  }).join('');
  const combos = S.menu.filter((m) => S.combos.has(m.id) || looksLikeCombo(m)).map((m) => {
    const c = S.combos.get(m.id) || [];
    return `<div class="mrow"><button class="mname" data-act="editCombo" data-id="${m.id}">${m.code ? `<b class="tcode">${esc(m.code)}</b> ` : ''}<span class="nm">${esc(shortName(m.name))}</span>
      <small>${c.length ? c.map((x) => `${x.qty}× ${esc(shortName(x.name))}`).join(' · ') : '<span style="color:var(--warn)">Contents not set</span>'}</small></button>
      <span class="num">${$m(m.price)}</span><span></span></div>`;
  }).join('');
  const cards = S.cats.map((c) => `<div class="mcard"><h3>${esc(c)}</h3>${S.menu.filter((i) => i.category === c).map((i) => {
    const so = S.sold.has(i.id), gs = groupsFor(i.id);
    return `<div class="mrow"><span class="mname">${i.code ? `<b class="tcode">${esc(i.code)}</b> ` : ''}<span class="nm">${esc(shortName(i.name))}</span>
      ${gs.length ? `<small>${gs.map((g) => esc(g.name)).join(', ')}</small>` : ''}</span>
      <span class="num">${$m(i.price)}</span>
      <button class="toggle ${so ? 'off' : ''}" data-act="sold" data-id="${i.id}" aria-pressed="${so}">${so ? 'Sold out' : 'Available'}</button></div>`;
  }).join('')}</div>`).join('');
  return `<div class="sechead"><div><h2>Item options</h2><div class="muted">Choices staff see when they add a dish, like spice level or requests. ${S.canEditOptions ? 'Tap a group to edit it or choose which dishes use it.' : 'Only a manager can change them.'}</div></div>
      ${S.canEditOptions ? '<button class="btn sm primary" data-act="newGroup">New option group</button>' : ''}</div>
    <div class="gcards">${gcards || '<div class="empty">No option groups yet.</div>'}</div>
    <div class="sechead" style="margin-top:28px"><div><h2>Combo contents</h2><div class="muted">What each combo and set dinner contains (shown on the dish and on kitchen tickets). The price stays the menu price.</div></div></div>
    <div class="mcard" style="max-width:760px">${combos}</div>
    <div class="sechead" style="margin-top:28px"><div><h2>Menu & availability</h2><div class="muted">${out ? `${out} dish${out > 1 ? 'es' : ''} sold out: hidden from online ordering and greyed out here. Tap to restock.` : 'Everything is available. Tap a dish to mark it sold out (the website stops selling it too).'}</div></div>
      <a class="classic muted" href="/staff/classic/">Old screen</a></div>
    <div class="mgrid">${cards}</div>`;
}

async function toggleSold(id) {
  const now = !S.sold.has(id);
  try {
    await api('PUT', `/api/staff/menu/${id}/availability`, { sold_out: now });
    if (now) S.sold.add(id); else S.sold.delete(id);
    toast(`${shortName(S.byId.get(id)?.name)} ${now ? 'sold out' : 'available again'}`);
  } catch (e) {
    toast('Not changed: ' + e.message);
  }
  render();
}

// ---------- option group editor ----------
function openGroup(gid) {
  if (!S.canEditOptions) { toast('Only a manager can change item options.'); return; }
  const g = gid ? S.groups.find((x) => x.id === gid) : null;
  U.ge = {
    id: g ? g.id : null, name: g ? g.name : '', rule: g ? (g.min ? 'req' : g.max === 1 ? 'one' : 'any') : 'any',
    opts: g ? g.options.map((o) => ({ n: o.name, p: o.price_cents ? (o.price_cents / 100).toFixed(2) : '' })) : [{ n: '', p: '' }, { n: '', p: '' }],
    items: new Set(g ? g.item_ids : []), err: '', confirmDel: false,
  };
  U.modal = 'group';
  renderModal();
}

function groupModal() {
  const E = U.ge;
  const rules = [['any', 'Optional · any number'], ['one', 'Optional · pick one'], ['req', 'Required · pick one']]
    .map(([k, n]) => `<button type="button" class="chip ${E.rule === k ? 'on' : ''}" data-act="geRule" data-r="${k}" aria-pressed="${E.rule === k}">${n}</button>`).join('');
  const opts = E.opts.map((o, i) => `<div class="optrow"><input class="input" value="${esc(o.n)}" placeholder="Option, e.g. Medium" aria-label="Option ${i + 1} name" data-input="geN" data-i="${i}">
    <span class="pricein"><input class="input" inputmode="decimal" value="${esc(o.p)}" placeholder="0.00" aria-label="Option ${i + 1} extra charge" data-input="geP" data-i="${i}"></span>
    <button type="button" class="xbtn" data-act="geDelOpt" data-i="${i}" aria-label="Remove option ${i + 1}" ${E.opts.length < 2 ? 'disabled' : ''}>✕</button></div>`).join('');
  const all = S.menu.every((i) => E.items.has(i.id));
  const apply = S.cats.map((c) => {
    const its = S.menu.filter((i) => i.category === c), allc = its.every((i) => E.items.has(i.id));
    return `<div class="applycat"><div class="row"><b>${esc(c)}</b><button type="button" class="btn sm ghost" data-act="geCat" data-c="${esc(c)}">${allc ? 'Clear' : 'Select all'}</button></div>
      <div class="chips">${its.map((i) => `<button type="button" class="chip ${E.items.has(i.id) ? 'on' : ''}" data-act="geItem" data-id="${i.id}" aria-pressed="${E.items.has(i.id)}">${esc(shortName(i.name))}</button>`).join('')}</div></div>`;
  }).join('');
  const body = `${E.err ? `<div class="callout">${esc(E.err)}</div>` : ''}
    <div class="field"><label for="ge-name">Group name</label><input id="ge-name" class="input" value="${esc(E.name)}" placeholder="e.g. Spice level" autocomplete="off" data-input="geName"></div>
    <div class="grp"><h3>How staff choose</h3><div class="chips">${rules}</div></div>
    <div class="grp"><h3>Options <span class="pill">Leave the price empty for no charge</span></h3><div class="checks">${opts}</div>
      <button type="button" class="btn sm" data-act="geAddOpt" style="margin-top:8px">+ Add option</button></div>
    <div class="grp"><h3>Use on these dishes <span class="pill accent">${E.items.size} selected</span></h3>
      <div class="row" style="margin-bottom:10px"><button type="button" class="chip ${all ? 'on' : ''}" data-act="geAll" aria-pressed="${all}">All dishes</button></div>
      <div class="checks">${apply}</div></div>`;
  const foot = `${E.id ? (E.confirmDel ? `<span class="muted">Delete this group?</span><button class="btn danger" data-act="geDel">Delete</button>` : '<button class="btn danger ghost" data-act="geAskDel">Delete group</button>') : ''}
    <span style="flex:1"></span><button class="btn" data-act="close">Cancel</button><button class="btn accent" data-act="geSave">${E.id ? 'Save changes' : 'Create group'}</button>`;
  return sheet(E.id ? 'Edit option group' : 'New option group', 'Menu · item options', body, foot, true);
}

async function saveGroup() {
  const E = U.ge;
  const max = E.rule === 'any' ? Math.max(1, E.opts.filter((o) => o.n.trim()).length) : 1;
  try {
    const r = await api('PUT', `/api/staff/options/${encodeURIComponent(E.id || 'new')}`, {
      name: E.name, min: E.rule === 'req' ? 1 : 0, max,
      options: E.opts.map((o) => ({ name: o.n, price_cents: Math.round((parseFloat(o.p) || 0) * 100) })),
      item_ids: [...E.items],
    });
    const i = S.groups.findIndex((g) => g.id === r.group.id);
    if (i >= 0) S.groups[i] = r.group; else S.groups.push(r.group);
    U.modal = null; U.ge = null;
    toast('Option group saved');
  } catch (e) {
    E.err = e.message;
  }
  renderModal(); render();
}

async function deleteGroup() {
  const E = U.ge;
  try {
    await api('DELETE', `/api/staff/options/${encodeURIComponent(E.id)}`);
    S.groups = S.groups.filter((g) => g.id !== E.id);
    U.modal = null; U.ge = null;
    toast('Option group deleted');
  } catch (e) {
    E.err = e.message;
  }
  renderModal(); render();
}

// ---------- combo contents editor ----------
function openCombo(id) {
  U.ce = { id, lines: (S.combos.get(id) || []).map((c) => ({ id: c.id, name: c.name, qty: c.qty })), q: '', text: '', dirty: false, err: '' };
  U.modal = 'combo';
  renderModal();
}

function comboModal() {
  const E = U.ce, item = S.byId.get(E.id), edit = S.canEditCombos;
  const lines = E.lines.length ? E.lines.map((l, i) => `<div class="combo-line"><span>${esc(shortName(l.name))}${l.id == null ? ' <span class="pill">Not on menu</span>' : ''}</span>
      ${edit ? `<span class="step"><button data-act="ceQty" data-i="${i}" data-d="-1">−</button><span>${l.qty}</span><button data-act="ceQty" data-i="${i}" data-d="1">+</button></span>
      <button class="xbtn" data-act="ceDel" data-i="${i}" aria-label="Remove">✕</button>` : `<b>${l.qty}×</b><span></span>`}</div>`).join('')
    : '<div class="muted">Nothing yet. Add the dishes this combo includes.</div>';
  const results = E.q.trim() && S.search ? S.search.searchMenu(S.menu, E.q).filter((r) => r.item.id !== E.id).slice(0, 10) : [];
  const body = `${E.err ? `<div class="callout">${esc(E.err)}</div>` : ''}${edit ? '' : '<div class="callout">Only a manager can change combo contents.</div>'}
    <div><div class="eyebrow">Contains (per 1 combo)</div>${lines}</div>
    ${edit ? `<div class="field"><label for="ce-q">Add a dish from the menu</label><input id="ce-q" class="input" value="${esc(E.q)}" placeholder="Search code or name (A1, egg roll…)" autocomplete="off" data-input="ceQ">
      <div class="results" id="ce-results">${results.map(({ item: m }) => `<button type="button" data-act="ceAdd" data-id="${m.id}"><span>${esc(m.name)}</span><span class="muted">+ Add</span></button>`).join('')}</div></div>
      <div class="field"><label for="ce-text">Add something that is not on the menu</label><div class="row" style="flex-wrap:nowrap"><input id="ce-text" class="input" value="${esc(E.text)}" placeholder="e.g. Steamed Rice" maxlength="80" data-input="ceText"><button class="btn" data-act="ceAddText">+ Add</button></div></div>` : ''}`;
  return sheet(esc(shortName(item?.name)), `Combo contents · menu price ${$m(item?.price)}`, body,
    edit ? `<button class="btn" data-act="close">Cancel</button><button class="btn accent" data-act="ceSave" ${E.dirty ? '' : 'disabled'}>Save combo</button>` : '<button class="btn" data-act="close">Close</button>', true);
}

async function saveCombo() {
  const E = U.ce;
  try {
    const { combo } = await api('PUT', `/api/staff/combos/${E.id}`, {
      components: E.lines.map((l) => (l.id != null ? { id: l.id, qty: l.qty } : { name: l.name, qty: l.qty })),
    });
    if (combo.components.length) S.combos.set(combo.combo_id, combo.components); else S.combos.delete(combo.combo_id);
    U.modal = null; U.ce = null;
    toast('Combo saved');
  } catch (e) {
    E.err = e.message;
  }
  renderModal(); render();
}
