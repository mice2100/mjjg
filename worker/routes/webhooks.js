// Incoming webhooks from third parties. Each verifies its own signature.

import { HttpError, json } from '../lib/http.js';
import { upsertWooOrder, verifyWooSignature } from '../services/woocommerce.js';
import { parseCloverEvent, verifyCloverSignature } from '../services/clover.js';
import { markOrderPaid } from '../services/orders.js';

// WooCommerce > Settings > Advanced > Webhooks: topics "Order created" and "Order updated",
// delivery URL https://<host>/api/webhooks/woocommerce, secret = WC_WEBHOOK_SECRET.
export async function postWooWebhook(request, env) {
  const raw = await request.text();
  // WooCommerce sends an unsigned form-encoded ping when the webhook is first saved.
  if (raw.startsWith('webhook_id=')) return json({ success: true });

  const ok = await verifyWooSignature(raw, request.headers.get('X-WC-Webhook-Signature'), env.WC_WEBHOOK_SECRET);
  if (!ok) throw new HttpError(401, 'Invalid signature');

  const imported = await upsertWooOrder(env.DB, JSON.parse(raw));
  return json({ success: true, imported });
}

// Clover Merchant Dashboard > Ecommerce > Hosted Checkout: webhook URL
// https://<host>/api/webhooks/clover, Signing Secret = CLOVER_WEBHOOK_SECRET.
// Only APPROVED payments change anything; declines are retried on the Clover page.
export async function postCloverWebhook(request, env) {
  const raw = await request.text();
  const ok = await verifyCloverSignature(raw, request.headers.get('Clover-Signature'), env.CLOVER_WEBHOOK_SECRET);
  if (!ok) throw new HttpError(401, 'Invalid signature');

  let event;
  try {
    event = parseCloverEvent(JSON.parse(raw));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  if (event.merchantId && env.CLOVER_MERCHANT_ID && event.merchantId !== env.CLOVER_MERCHANT_ID) {
    console.warn('Clover webhook for another merchant:', event.merchantId);
    return json({ success: true, ignored: 'merchant' });
  }
  if (event.type !== 'PAYMENT' || event.status !== 'APPROVED' || !event.checkoutSessionId) {
    return json({ success: true, ignored: event.status || event.type || 'unknown' });
  }
  const order = await markOrderPaid(env.DB, { checkoutSessionId: event.checkoutSessionId, paymentId: event.paymentId });
  if (!order) console.warn('Clover payment for unknown or already-paid session:', event.checkoutSessionId);
  return json({ success: true, order_id: order?.id || null });
}
