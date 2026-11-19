// Customer sign-in (Google / Apple / Facebook) and profile.

import { HttpError, json, readJson } from '../lib/http.js';
import { cleanText, normalizePhone, nowIso } from '../lib/util.js';
import { PROVIDERS } from '../auth/providers.js';
import { clearSessionCookie, getSessionCustomerId, sessionCookie } from '../auth/session.js';
import { getCustomer, publicProfile, upsertFromIdentity } from '../services/customers.js';

export async function postSignIn(request, env, { provider }) {
  const verify = PROVIDERS[provider];
  if (!verify) throw new HttpError(404, 'Unknown sign-in provider');
  const body = await readJson(request);
  const identity = await verify(body, env);
  const customer = await upsertFromIdentity(env.DB, { provider, ...identity });
  return json(
    { success: true, customer: publicProfile(customer) },
    { headers: { 'Set-Cookie': await sessionCookie(env, customer.id) } }
  );
}

export function postSignOut(request, env) {
  return json({ success: true }, { headers: { 'Set-Cookie': clearSessionCookie(env) } });
}

export async function getMe(request, env) {
  const id = await getSessionCustomerId(request, env);
  const customer = id ? await getCustomer(env.DB, id) : null;
  return json({ success: true, customer: publicProfile(customer) || null });
}

export async function patchMe(request, env) {
  const id = await getSessionCustomerId(request, env);
  if (!id) throw new HttpError(401, 'Please sign in');
  const body = await readJson(request);
  const now = nowIso();
  const optIn = body.marketing_opt_in === undefined ? null : body.marketing_opt_in ? 1 : 0;
  await env.DB
    .prepare(
      `UPDATE customers SET
         name = COALESCE(NULLIF(?, ''), name),
         phone = COALESCE(NULLIF(?, ''), phone),
         default_address = COALESCE(NULLIF(?, ''), default_address),
         marketing_opt_in = COALESCE(?, marketing_opt_in),
         marketing_opt_in_at = CASE WHEN ? = 1 AND marketing_opt_in = 0 THEN ? ELSE marketing_opt_in_at END,
         updated_at = ?
       WHERE id = ?`
    )
    .bind(
      cleanText(body.name, 100), normalizePhone(body.phone), cleanText(body.default_address, 300),
      optIn, optIn, now, now, id
    )
    .run();
  return json({ success: true, customer: publicProfile(await getCustomer(env.DB, id)) });
}
