// Clover Hosted Checkout: the customer pays on a Clover-hosted page, so card data never
// touches this Worker. https://docs.clover.com/dev/docs/hosted-checkout-api
//
// Flow: createOrder (payment_status 'awaiting') -> createCheckout -> browser goes to href
//   -> Clover webhook (signed) -> markOrderPaid -> the order appears on the kitchen board.

import { HttpError } from '../lib/http.js';

const API_BASE = {
  production: 'https://api.clover.com',
  sandbox: 'https://apisandbox.dev.clover.com',
};

export const isCloverConfigured = (env) => Boolean(env.CLOVER_PRIVATE_KEY && env.CLOVER_MERCHANT_ID);

const apiBase = (env) => API_BASE[env.CLOVER_ENV === 'production' ? 'production' : 'sandbox'];

// The single line item's name carries our order id; findPaidOrders() reads it back.
const LINE_ITEM_PREFIX = 'Jade Garden order ';

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  const firstName = parts.shift() || 'Customer';
  return { firstName, lastName: parts.join(' ') || firstName };
}

/**
 * Creates a checkout session for one order. The whole order is sent as ONE line item for
 * the exact server-computed total (tax, discount and tip included), so Clover cannot
 * recompute a different amount. Clover's own tip screen stays off: the tip is already in.
 * Returns { href, checkoutSessionId }.
 */
export async function createCheckout(env, { order, successUrl, failureUrl, fetchImpl = fetch }) {
  const summary = order.items.map((l) => `${l.qty}× ${l.name}`).join(', ');
  const body = {
    customer: { ...splitName(order.customer_name), email: order.customer_email, phoneNumber: order.customer_phone },
    shoppingCart: {
      lineItems: [
        {
          name: `${LINE_ITEM_PREFIX}${order.id}`,
          price: order.total_cents,
          unitQty: 1,
          note: summary.length > 250 ? `${summary.slice(0, 247)}...` : summary,
        },
      ],
    },
  };
  // Clover rejects non-https redirect URLs (400). Plain-http local dev omits them, so the
  // customer stays on Clover's receipt page; use an https tunnel to test the return trip.
  if (successUrl.startsWith('https://') && failureUrl.startsWith('https://')) {
    body.redirectUrls = { success: successUrl, failure: failureUrl };
  } else {
    console.warn('Clover redirect URLs omitted: they must be https, got', successUrl);
  }

  const res = await fetchImpl(`${apiBase(env)}/invoicingcheckoutservice/v1/checkouts`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${env.CLOVER_PRIVATE_KEY}`,
      'X-Clover-Merchant-Id': env.CLOVER_MERCHANT_ID,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* Clover answers some errors in plain text, e.g. "UNAUTHORIZED" */
  }
  if (!res.ok || !data?.href || !data?.checkoutSessionId) {
    console.error('Clover checkout failed:', res.status, text.slice(0, 300));
    throw new HttpError(502, 'We could not start the online payment. Please try again, or call us to order.');
  }
  return { href: data.href, checkoutSessionId: data.checkoutSessionId };
}

/**
 * Backup for a lost webhook: asks Clover which of our orders were paid since `sinceMs`.
 * Returns Map(orderId -> { paymentId, amountCents }) of successful payments, matched by the
 * line item name createCheckout() set. Callers must still compare the amount.
 */
export async function findPaidOrders(env, sinceMs, fetchImpl = fetch) {
  const url = new URL(`${apiBase(env)}/v3/merchants/${encodeURIComponent(env.CLOVER_MERCHANT_ID)}/payments`);
  url.searchParams.set('filter', `createdTime>=${Math.floor(sinceMs)}`);
  url.searchParams.set('expand', 'order.lineItems');
  url.searchParams.set('limit', '1000');
  const res = await fetchImpl(url, { headers: { accept: 'application/json', authorization: `Bearer ${env.CLOVER_PRIVATE_KEY}` } });
  if (!res.ok) throw new Error(`Clover payments lookup failed: ${res.status}`);
  const data = await res.json();

  const paid = new Map();
  for (const payment of data.elements || []) {
    if (payment.result !== 'SUCCESS') continue;
    for (const line of payment.order?.lineItems?.elements || []) {
      if (String(line.name || '').startsWith(LINE_ITEM_PREFIX)) {
        paid.set(line.name.slice(LINE_ITEM_PREFIX.length), { paymentId: payment.id, amountCents: payment.amount });
      }
    }
  }
  return paid;
}

/**
 * Clover-Signature: t=<timestamp>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 * signed with the Signing Secret from Hosted Checkout settings (CLOVER_WEBHOOK_SECRET).
 */
export async function verifyCloverSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const fields = Object.fromEntries(
    String(header)
      .split(',')
      .map((kv) => kv.trim().split('='))
      .filter((kv) => kv.length === 2)
  );
  if (!fields.t || !/^[0-9a-f]{64}$/i.test(fields.v1 || '')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = Uint8Array.from(fields.v1.match(/../g), (h) => parseInt(h, 16));
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${fields.t}.${rawBody}`));
}

// Webhook body fields per Clover docs: type, status, id (payment), merchantId, data (checkout session).
// Accept any key casing so a capitalised payload still parses.
export function parseCloverEvent(payload) {
  const lower = Object.fromEntries(Object.entries(payload || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    type: String(lower.type || '').toUpperCase(),
    status: String(lower.status || '').toUpperCase(),
    paymentId: lower.id ? String(lower.id) : null,
    merchantId: lower.merchantid ? String(lower.merchantid) : null,
    checkoutSessionId: lower.data ? String(lower.data) : null,
  };
}
