// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckout, findPaidOrders, parseCloverEvent, verifyCloverSignature } from './clover.js';

async function sign(secret, t, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('webhook signature: valid, tampered, wrong secret, malformed', async () => {
  const body = '{"type":"PAYMENT","status":"APPROVED","data":"sess-1"}';
  const v1 = await sign('s3cret', '1642599079', body);
  assert.equal(await verifyCloverSignature(body, `t=1642599079,v1=${v1}`, 's3cret'), true);
  assert.equal(await verifyCloverSignature(body.replace('sess-1', 'sess-2'), `t=1642599079,v1=${v1}`, 's3cret'), false);
  assert.equal(await verifyCloverSignature(body, `t=1642599080,v1=${v1}`, 's3cret'), false);
  assert.equal(await verifyCloverSignature(body, `t=1642599079,v1=${v1}`, 'other'), false);
  assert.equal(await verifyCloverSignature(body, 'garbage', 's3cret'), false);
  assert.equal(await verifyCloverSignature(body, `t=1642599079,v1=${v1}`, ''), false);
});

test('parseCloverEvent accepts any key casing', () => {
  assert.deepEqual(parseCloverEvent({ Type: 'PAYMENT', Status: 'approved', Id: 'pay1', MerchantId: 'M1', Data: 'sess' }), {
    type: 'PAYMENT', status: 'APPROVED', paymentId: 'pay1', merchantId: 'M1', checkoutSessionId: 'sess',
  });
});

test('createCheckout sends the exact server total as one line item', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ href: 'https://pay/x', checkoutSessionId: 'sess-9' }), { status: 200 });
  };
  const env = { CLOVER_ENV: 'sandbox', CLOVER_PRIVATE_KEY: 'pk', CLOVER_MERCHANT_ID: 'MID' };
  const order = {
    id: 'WEB-1001', total_cents: 5123, customer_name: 'Mary Ann Lee', customer_email: 'm@x.ca', customer_phone: '3065550123',
    items: [{ name: 'Ginger Beef', qty: 2 }],
  };
  const out = await createCheckout(env, { order, successUrl: 'https://s', failureUrl: 'https://f', fetchImpl });
  assert.deepEqual(out, { href: 'https://pay/x', checkoutSessionId: 'sess-9' });
  assert.equal(sent.url, 'https://apisandbox.dev.clover.com/invoicingcheckoutservice/v1/checkouts');
  assert.equal(sent.init.headers.authorization, 'Bearer pk');
  assert.equal(sent.init.headers['X-Clover-Merchant-Id'], 'MID');
  assert.deepEqual(sent.body.shoppingCart.lineItems, [{ name: 'Jade Garden order WEB-1001', price: 5123, unitQty: 1, note: '2× Ginger Beef' }]);
  assert.deepEqual(sent.body.customer, { firstName: 'Mary', lastName: 'Ann Lee', email: 'm@x.ca', phoneNumber: '3065550123' });
  assert.equal(sent.body.tips, undefined);
  assert.deepEqual(sent.body.redirectUrls, { success: 'https://s', failure: 'https://f' });
});

test('createCheckout omits plain-http redirect URLs, which Clover rejects', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ href: 'https://pay/x', checkoutSessionId: 'sess-1' }), { status: 200 });
  };
  const env = { CLOVER_PRIVATE_KEY: 'pk', CLOVER_MERCHANT_ID: 'MID' };
  const order = { id: 'WEB-1', total_cents: 100, customer_name: 'A', items: [] };
  const origWarn = console.warn;
  console.warn = () => {};
  await createCheckout(env, { order, successUrl: 'http://localhost:8787/order/?paid=WEB-1', failureUrl: 'http://localhost:8787/x', fetchImpl });
  console.warn = origWarn;
  assert.equal(sent.redirectUrls, undefined);
});

test('createCheckout turns a Clover error into a 502', async () => {
  const fetchImpl = async () => new Response('UNAUTHORIZED', { status: 401 });
  const env = { CLOVER_PRIVATE_KEY: 'pk', CLOVER_MERCHANT_ID: 'MID' };
  const order = { id: 'WEB-1', total_cents: 100, customer_name: 'A', items: [] };
  const origError = console.error;
  console.error = () => {};
  await assert.rejects(createCheckout(env, { order, successUrl: '', failureUrl: '', fetchImpl }), { status: 502 });
  console.error = origError;
});

test('findPaidOrders maps successful payments to our order ids', async () => {
  let calledUrl;
  const line = (name) => ({ order: { lineItems: { elements: [{ name }] } } });
  const fetchImpl = async (url) => {
    calledUrl = String(url);
    return Response.json({
      elements: [
        { id: 'P1', result: 'SUCCESS', amount: 1900, ...line('Jade Garden order WEB-1007') },
        { id: 'P2', result: 'FAIL', amount: 500, ...line('Jade Garden order WEB-1008') },
        { id: 'P3', result: 'SUCCESS', amount: 700, ...line('Counter sale') },
      ],
    });
  };
  const env = { CLOVER_ENV: 'sandbox', CLOVER_PRIVATE_KEY: 'pk', CLOVER_MERCHANT_ID: 'MID' };
  const paid = await findPaidOrders(env, 1792440000000, fetchImpl);
  assert.deepEqual([...paid], [['WEB-1007', { paymentId: 'P1', amountCents: 1900 }]]);
  assert.match(calledUrl, /^https:\/\/apisandbox\.dev\.clover\.com\/v3\/merchants\/MID\/payments\?/);
  assert.match(decodeURIComponent(calledUrl), /filter=createdTime>=1792440000000/);
});
