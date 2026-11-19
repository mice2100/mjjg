// Customer session: an HttpOnly cookie holding a signed JWT (HS256, SESSION_SECRET).
// Issued only after a provider token was verified server-side (see providers.js).

import { SignJWT, jwtVerify } from 'jose';
import { HttpError, getCookie, isDev } from '../lib/http.js';

const COOKIE = 'jg_session';
const MAX_AGE_SECONDS = 90 * 24 * 3600;

function secretKey(env) {
  if (!env.SESSION_SECRET) throw new HttpError(503, 'Customer accounts are not configured');
  return new TextEncoder().encode(env.SESSION_SECRET);
}

const cookieAttrs = (env) => `Path=/; HttpOnly; SameSite=Lax${isDev(env) ? '' : '; Secure'}`;

export async function sessionCookie(env, customerId) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(customerId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey(env));
  return `${COOKIE}=${token}; Max-Age=${MAX_AGE_SECONDS}; ${cookieAttrs(env)}`;
}

export const clearSessionCookie = (env) => `${COOKIE}=; Max-Age=0; ${cookieAttrs(env)}`;

// Returns the customer id or null. Never throws for a missing/invalid cookie.
export async function getSessionCustomerId(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token || !env.SESSION_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(env), { algorithms: ['HS256'] });
    return payload.sub || null;
  } catch {
    return null;
  }
}
