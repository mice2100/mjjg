// Jade Garden Worker entry point.
//   fetch     -> /api/* routes below (everything else is served from web/dist by the assets layer)
//   scheduled -> expire abandoned Clover checkouts, customer backfill, WooCommerce order sync (cron in wrangler.jsonc)

import { HttpError, errorResponse } from './lib/http.js';
import { requireStaff } from './auth/staff.js';
import * as pub from './routes/public.js';
import * as account from './routes/account.js';
import * as staff from './routes/staff.js';
import { postCloverWebhook, postWooWebhook } from './routes/webhooks.js';
import { syncWooOrders } from './services/woocommerce.js';
import { expireAbandonedCheckouts, reconcileCloverPayments } from './services/orders.js';
import { backfillCustomers } from './services/customers.js';

// [method, path, handler, roles] → one route per role: /api/<role>/<path>, checked against that role's Access app.
function staffRoutes(list) {
  return list.flatMap(([method, path, handler, roles]) => roles.map((role) => [method, `/api/${role}/${path}`, handler, { staff: role }]));
}

// [method, URLPattern pathname, handler, options]
const ROUTES = [
  ['GET', '/api/config', pub.getConfig],
  ['GET', '/api/menu', pub.getMenuRoute],
  ['GET', '/api/availability', pub.getAvailability],
  ['GET', '/api/streets', pub.getStreets],
  ['POST', '/api/quote', pub.postQuote],
  ['POST', '/api/orders', pub.postOrder],
  ['GET', '/api/orders/:id/status', pub.getOrderStatus],

  ['POST', '/api/auth/logout', account.postSignOut], // must precede /api/auth/:provider
  ['POST', '/api/auth/:provider', account.postSignIn],
  ['GET', '/api/me', account.getMe],
  ['PATCH', '/api/me', account.patchMe],

  // Staff API: one Cloudflare Access application per role (worker/auth/staff.js).
  //   kitchen  /staff/   → /api/kitchen/*     pos  /pos/  → /api/pos/*     admin  /jadmin/ → /api/admin/*
  ...staffRoutes([
    ['GET', 'orders', staff.getOrders, ['kitchen', 'pos']], // orders + kitchen tickets + sold out
    ['POST', 'orders', staff.postOrder, ['pos']],
    ['PUT', 'orders/:id', staff.putOrder, ['pos']],
    ['PATCH', 'orders/:id', staff.patchOrder, ['kitchen', 'pos']], // status, or {received:true}
    ['POST', 'orders/:id/payments', staff.postPayment, ['pos']],
    ['PATCH', 'tickets/:id', staff.patchTicket, ['kitchen']],
    ['GET', 'customers/lookup', staff.getCustomerLookup, ['pos']],
    ['GET', 'menu', staff.getMenuSettings, ['kitchen', 'pos', 'admin']], // option groups + sold out
    ['PUT', 'menu/:id/availability', staff.putAvailability, ['kitchen', 'pos', 'admin']],
    ['PUT', 'options/:id', staff.putOptionGroup, ['admin']],
    ['DELETE', 'options/:id', staff.removeOptionGroup, ['admin']],
    ['GET', 'combos', staff.getCombos, ['kitchen', 'pos', 'admin']],
    ['PUT', 'combos/:id', staff.putCombo, ['admin']],
  ]),

  ['POST', '/api/webhooks/woocommerce', postWooWebhook],
  ['POST', '/api/webhooks/clover', postCloverWebhook],
].map(([method, path, handler, opts = {}]) => ({ method, pattern: new URLPattern({ pathname: path }), handler, opts }));

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      let pathMatched = false;
      for (const route of ROUTES) {
        const match = route.pattern.exec(url);
        if (!match) continue;
        pathMatched = true;
        if (route.method !== request.method) continue;
        const staffUser = route.opts.staff ? await requireStaff(request, env, route.opts.staff) : null;
        return await route.handler(request, env, match.pathname.groups, staffUser);
      }
      throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed' : 'Not found');
    } catch (err) {
      return errorResponse(err);
    }
  },

  async scheduled(controller, env, ctx) {
    // Ask Clover about unpaid orders first, so a lost webhook never gets a paid order expired.
    ctx.waitUntil(
      reconcileCloverPayments(env)
        .catch((err) => console.error('Clover payment check failed:', err.message))
        .then((paid) => paid?.length && console.log('Paid via Clover check:', paid.map((o) => o.id).join(', ')))
        .then(() => expireAbandonedCheckouts(env.DB))
        .then((n) => n && console.log('Expired unpaid checkouts:', n))
        .catch((err) => console.error('Checkout expiry failed:', err.message))
    );
    // Links older orders to customers until it reports done (then one cheap read per run).
    ctx.waitUntil(
      backfillCustomers(env.DB)
        .then((r) => r.processed && console.log('Customer backfill:', JSON.stringify(r)))
        .catch((err) => console.error('Customer backfill failed:', err.message))
    );
    ctx.waitUntil(
      syncWooOrders(env)
        .then((r) => r.imported && console.log('WooCommerce sync:', JSON.stringify(r)))
        .catch((err) => console.error('WooCommerce sync failed:', err.message))
    );
  },
};
