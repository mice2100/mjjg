// Receipt printing on a thermal roll printer (80 mm or 58 mm paper), from mice2100's version:
// a narrow black-and-white receipt goes through a hidden frame, so the staff screen is never
// printed. In the print dialog choose the receipt printer and set Margins to "None".
// The paper width is remembered per device (the "80 mm" / "58 mm" button next to Print).
'use strict';

const RESTAURANT = { name: 'JADE GARDEN', sub: 'RESTAURANT', address: '471 Main St N, Moose Jaw, SK S6H 0W5', phone: '(306) 694-5566' };

function receiptMm() {
  try { return localStorage.getItem('jg_receipt_mm') === '58' ? 58 : 80; } catch { return 80; }
}
function toggleReceiptMm() {
  const next = receiptMm() === 80 ? 58 : 80;
  try { localStorage.setItem('jg_receipt_mm', String(next)); } catch { /* private mode */ }
  toast(`Receipt paper: ${next} mm`);
}
const printButtons = (id) => `<button class="btn" data-act="print" data-id="${esc(id)}">Print</button><button class="btn sm ghost" data-act="paper" title="Receipt paper width">${receiptMm()} mm</button>`;

function thermalHtml(o, mm) {
  const money = (n) => '$' + Number(n).toFixed(2);
  const row = (l, r, cls = '') => `<div class="row ${cls}"><span class="l">${l}</span><span class="r">${r}</span></div>`;
  const kind = o.delivery_type === 'delivery' ? 'DELIVERY' : o.delivery_type === 'dinein' ? 'DINE-IN' : 'PICK UP';
  const printed = new Date().toLocaleString('en-CA', { timeZone: 'America/Regina', dateStyle: 'medium', timeStyle: 'short' });
  const items = o.items.map((it) => `
    <div class="item">${row(`<b>${it.qty} &times; ${esc(shortOf(it.id ?? it.name) || shortName(it.name))}</b>`, it.free ? 'FREE' : money(it.price * it.qty))}
      ${shortOf(it.id ?? it.name) ? `<div class="sub">${esc(shortName(it.name))}</div>` : ''}
      ${(it.mods || []).map((m) => `<div class="sub">- ${esc(m.n)}${m.price ? ' +' + money(m.price) : ''}</div>`).join('')}
      ${(it.components || []).map((c) => `<div class="sub">- ${c.qty * it.qty} &times; ${esc(shortName(c.name))}</div>`).join('')}
      ${it.note ? `<div class="sub">* ${esc(it.note)}</div>` : ''}
      ${it.disc ? row(`&nbsp;&nbsp;${discLabel(it.disc)}`, '-' + money(it.disc_amount)) : ''}
    </div>`).join('');
  const itemDisc = o.items.reduce((s, it) => s + cents(it.disc_amount), 0);
  const orderDisc = cents(o.discount) - itemDisc;
  const totals = [
    row('Food subtotal', money(o.subtotal)),
    itemDisc ? row('Item discounts', '-' + money(itemDisc / 100)) : '',
    orderDisc > 0 ? row(o.coupon_code ? `Coupon ${esc(o.coupon_code)}` : 'Discount', '-' + money(orderDisc / 100)) : '',
    row('GST/PST (11%)', money(o.tax)),
    o.delivery_fee > 0 ? row(o.delivery_place === 'apartment' ? 'Delivery (apt/hotel)' : 'Delivery', money(o.delivery_fee)) : '',
    o.tip > 0 ? row('Tip', money(o.tip)) : '',
  ].join('');
  const pays = (o.payments || []).map((p) => row(`${esc(p.label)} ${esc(p.method.toUpperCase())}`, money(p.amount))
    + (p.tendered != null ? row('&nbsp;&nbsp;Cash received', money(p.tendered)) + row('&nbsp;&nbsp;Change', money(p.change)) : '')).join('');
  const stamp = o.payment_status === 'paid' ? 'PAID ONLINE' : o.balance <= 0 ? 'PAID' : `COLLECT ${money(o.balance)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(orderNo(o))}</title><style>
    @page { size: ${mm}mm auto; margin: 0; }
    * { box-sizing: border-box; color: #000 !important; background: none !important; }
    html, body { margin: 0; padding: 0; }
    body { width: ${mm === 58 ? 48 : 72}mm; margin: 0 auto; padding: 3mm 0 6mm; font: ${mm === 58 ? 11 : 13}px/1.35 "Courier New", Courier, monospace; }
    .c { text-align: center; }
    .brand { font: 800 ${mm === 58 ? 18 : 22}px/1.1 Arial, Helvetica, sans-serif; letter-spacing: 1px; }
    .big { font: 800 ${mm === 58 ? 20 : 26}px/1.2 Arial, Helvetica, sans-serif; margin: 4px 0; }
    .tag { display: inline-block; border: 2px solid #000; padding: 1px 10px; font: 800 ${mm === 58 ? 14 : 17}px Arial, sans-serif; margin: 2px 0; }
    .phone { font: 800 ${mm === 58 ? 15 : 18}px Arial, sans-serif; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    hr.solid { border-top: 2px solid #000; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    .row .l { flex: 1; word-break: break-word; }
    .row .r { white-space: nowrap; text-align: right; }
    .item { margin: 4px 0; font-size: ${mm === 58 ? 12 : 14}px; }
    .sub { padding-left: 14px; font-size: ${mm === 58 ? 11 : 12}px; }
    .grand { font: 800 ${mm === 58 ? 15 : 18}px/1.3 Arial, Helvetica, sans-serif; margin-top: 3px; }
    .note { border: 2px solid #000; padding: 3px 5px; margin: 5px 0; font-weight: 700; }
    .pay { text-align: center; font: 800 ${mm === 58 ? 14 : 17}px Arial, sans-serif; border: 2px solid #000; padding: 4px; margin-top: 6px; }
    .foot { margin-top: 8px; font-size: ${mm === 58 ? 10 : 11}px; }
  </style></head><body>
    <div class="c"><div class="brand">${RESTAURANT.name}</div><div>${RESTAURANT.sub}</div>
      <div>${RESTAURANT.address}</div><div>${RESTAURANT.phone}</div></div>
    <hr>
    <div class="c"><div class="big">${esc(orderNo(o))}</div><div class="tag">${kind}${o.table_id ? ' · TABLE ' + esc(o.table_id) : ''}</div></div>
    ${row('Date', `${fmtDate(o.created_at)} ${fmtTime(o.created_at)}`)}
    ${o.delivery_type !== 'dinein' ? row(o.delivery_type === 'delivery' ? 'Deliver at' : 'Pick up at', esc(o.delivery_time_slot && !/^(ASAP|Pick Up)$/i.test(o.delivery_time_slot) ? o.delivery_time_slot : 'ASAP')) : ''}
    ${o.delivery_type !== 'dinein' ? `<hr>
    ${o.delivery_type === 'delivery' && o.delivery_address ? `<div><b>${esc(o.delivery_address)}</b></div>` : ''}
    ${o.customer_phone ? `<div class="phone">${esc(o.customer_phone)}</div>` : ''}
    ${o.customer_name ? `<div>${esc(o.customer_name)}</div>` : ''}` : ''}
    ${o.customer_notes ? `<div class="note">NOTE: ${esc(o.customer_notes)}</div>` : ''}
    <hr class="solid">
    ${items}
    <hr>
    ${totals}
    <hr class="solid">
    ${row('TOTAL', money(o.total), 'grand')}
    ${pays ? '<hr>' + pays : ''}
    <div class="pay">${stamp}</div>
    <div class="c foot">Thank you!<br>Printed ${printed}</div>
  </body></html>`;
}

function printReceipt(id) {
  const o = S.orders.find((x) => x.id === id);
  if (!o) return;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  frame.srcdoc = thermalHtml(o, receiptMm());
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000); // keep it while the print dialog is open
  };
  document.body.appendChild(frame);
}
