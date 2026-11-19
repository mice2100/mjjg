// Staff authentication = Cloudflare Access (Zero Trust).
// Access protects /staff/* and /api/staff/* at the edge (email one-time PIN or Google);
// this check re-verifies the Access JWT so the API stays closed even if an Access
// policy is misconfigured or the workers.dev URL is hit directly. Fails closed.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError, getCookie, isDev } from '../lib/http.js';

let jwks = null;
let jwksTeam = null;

export async function requireStaff(request, env) {
  if (isDev(env)) return { email: 'dev@localhost' };

  const team = env.ACCESS_TEAM_DOMAIN; // e.g. 'jadegarden.cloudflareaccess.com'
  if (!team || !env.ACCESS_AUD) throw new HttpError(503, 'Staff access is not configured');

  const token = request.headers.get('Cf-Access-Jwt-Assertion') || getCookie(request, 'CF_Authorization');
  if (!token) throw new HttpError(401, 'Staff sign-in required');

  if (!jwks || jwksTeam !== team) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwksTeam = team;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: env.ACCESS_AUD });
    return { email: payload.email };
  } catch {
    throw new HttpError(401, 'Staff sign-in required');
  }
}

// Combo (menu) editing. ADMIN_EMAILS (comma-separated var) lists who may edit; when it is
// empty, every signed-in staff member may.
export function isStaffAdmin(env, staff) {
  const admins = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length === 0) return Boolean(staff);
  return Boolean(staff?.email && admins.includes(String(staff.email).toLowerCase()));
}
