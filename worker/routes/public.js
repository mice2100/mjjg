// Public customer-facing API (website).

import { HttpError, isDev, json, readJson } from '../lib/http.js';
import { getMenu } from '../lib/menu.js';
import { DELIVERY_FEES_CENTS, TAX_RATE_PERCENT, normalizeEmail, normalizePhone } from '../lib/util.js';
import { TIP_CHOICES, buildQuote } from '../services/pricing.js';
import { createOrder, expireUnpaidOrders, getPublicOrderStatus, reconcileCloverPayments, setCheckoutSession } from '../services/orders.js';
import { createCheckout, isCloverConfigured } from '../services/clover.js';
import { customerGroups, listOptionGroups, listSoldOut } from '../services/options.js';
import { listCombos } from '../services/combos.js';
import { customerContents } from '../../web/src/lib/customerNames.js';
import { PLACES, deliveryPlaceFor } from '../lib/places.js';
import { getSessionCustomerId } from '../auth/session.js';
import streets from '../../data/moose_jaw_streets.json' with { type: 'json' };
import hotelData from '../../data/moose_jaw_hotels.json' with { type: 'json' };

// Public, non-secret settings the browser needs (sign-in buttons, Turnstile, fees).
export function getConfig(request, env) {
  return json({
    google_client_id: env.GOOGLE_CLIENT_ID || '',
    apple_services_id: env.APPLE_SERVICES_ID || '',
    facebook_app_id: env.FACEBOOK_APP_ID || '',
    turnstile_site_key: env.TURNSTILE_SITE_KEY || '',
    delivery_fees_cents: DELIVERY_FEES_CENTS, // {house, apartment}
    tax_rate_percent: TAX_RATE_PERCENT,
    tip_choices: TIP_CHOICES,
    online_payment: isCloverConfigured(env),
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}

export function getMenuRoute() {
  return json({ success: true, menu: getMenu() }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}

// What each set dinner contains, as customers read it (no counts, sauces or containers).
export async function getSetDinners(request, env) {
  const contents = Object.fromEntries((await listCombos(env.DB)).map((c) => [c.combo_id, customerContents(c.components)]));
  return json({ success: true, contents }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}

// Dish options for the website (choices such as chicken balls / sweet & sour pork, extra people).
export async function getOptions(request, env) {
  const groups = customerGroups(await listOptionGroups(env.DB)).map(({ id, name, min, max, options, item_ids }) => ({ id, name, min, max, options, item_ids }));
  return json({ success: true, groups }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}

// Dishes staff marked sold out (the website greys them out). Short cache: staff flip these during service.
export async function getAvailability(request, env) {
  return json({ success: true, sold_out: await listSoldOut(env.DB) }, { headers: { 'Cache-Control': 'public, max-age=30' } });
}

export function getStreets() {
  return json({ success: true, streets, hotels: hotelData.hotels, apartment_buildings: PLACES.buildings }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}

// Cart preview: same calculation as the real order, but coupon problems are reported
// instead of thrown so the cart can show them inline.
export async function postQuote(request, env) {
  const body = await readJson(request);
  const sessionCustomerId = await getSessionCustomerId(request, env);
  const quote = await buildQuote(env.DB, {
    items: body.items,
    deliveryType: body.delivery_type,
    deliveryPlace: deliveryPlaceFor(body.delivery_address), // from the address, never the browser's choice
    couponCode: body.coupon_code,
    source: 'Web',
    email: normalizeEmail(body.customer_email),
    phone: normalizePhone(body.customer_phone),
    signedIn: Boolean(sessionCustomerId),
    strict: false,
    tip: body.tip,
  });
  return json({ success: true, quote });
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return; // disabled (local dev)
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', String(token || ''));
  if (ip) form.append('remoteip', ip);
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((r) => r.json());
  if (!result.success) throw new HttpError(400, 'Please complete the verification and try again.');
}

// Web orders are paid online through Clover. Without Clover keys, only local development
// may fall back to paying in store; production refuses rather than take unpaid orders.
export async function postOrder(request, env) {
  const body = await readJson(request);
  const payOnline = isCloverConfigured(env);
  if (!payOnline && !isDev(env)) {
    throw new HttpError(503, 'Online ordering is temporarily unavailable. Please call us to order.');
  }
  await verifyTurnstile(env, body.turnstile_token, request.headers.get('CF-Connecting-IP'));
  const sessionCustomerId = await getSessionCustomerId(request, env);
  const order = await createOrder(env.DB, body, { source: 'Web', sessionCustomerId, payOnline });
  if (!payOnline) return json({ success: true, order }, { status: 201 });

  // Come back to /order/ on this host (also right on workers.dev before the DNS cutover).
  // wrangler dev behind an https tunnel sees http:// plus X-Forwarded-Proto; Clover needs https.
  const url = new URL(request.url);
  if (isDev(env) && request.headers.get('X-Forwarded-Proto') === 'https') url.protocol = 'https:';
  const back = (flag) => `${url.origin}/order/?${flag}=${encodeURIComponent(order.id)}&t=${order.public_token}`;
  try {
    const checkout = await createCheckout(env, { order, successUrl: back('paid'), failureUrl: back('payment_failed') });
    await setCheckoutSession(env.DB, order.id, checkout.checkoutSessionId);
    return json({ success: true, order, payment_url: checkout.href }, { status: 201 });
  } catch (err) {
    await expireUnpaidOrders(env.DB, 'id = ?', [order.id]);
    throw err;
  }
}

// Polled by /order/ after Clover redirects back, until the webhook marks the order paid.
export async function getOrderStatus(request, env, { id }) {
  const token = new URL(request.url).searchParams.get('t');
  let order = await getPublicOrderStatus(env.DB, id, token);
  if (order.payment_status === 'awaiting') {
    // The customer is back from Clover; don't wait on the webhook alone.
    try {
      if ((await reconcileCloverPayments(env, { id: order.id })).length) order = await getPublicOrderStatus(env.DB, id, token);
    } catch (err) {
      console.error('Clover payment check failed:', err.message);
    }
  }
  return json({ success: true, order });
}
