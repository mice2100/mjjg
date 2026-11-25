// Staff authentication = Cloudflare Access (Zero Trust), one Access application per role:
//
//   role      pages        API              env var (the application's AUD tag)
//   kitchen   /staff/      /api/kitchen/*   ACCESS_AUD_KITCHEN
//   pos       /pos/        /api/pos/*       ACCESS_AUD_POS
//   admin     /jadmin/     /api/admin/*     ACCESS_AUD_ADMIN
//
// Who may use a role is decided in the Cloudflare dashboard (each application's policy), never
// in this repo. Access checks the sign-in at the edge; this function re-verifies the Access JWT
// and that it was issued for THIS role's application, so a kitchen sign-in can never call the
// admin API even if an Access policy is misconfigured. Fails closed.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError, getCookie, isDev } from '../lib/http.js';

export const STAFF_ROLES = ['kitchen', 'pos', 'admin'];

let jwks = null;
let jwksTeam = null;

export async function requireStaff(request, env, role) {
  if (!STAFF_ROLES.includes(role)) throw new HttpError(500, 'Unknown staff role');
  if (isDev(env)) return { email: 'dev@localhost', role };

  const team = env.ACCESS_TEAM_DOMAIN; // e.g. 'jadegarden.cloudflareaccess.com'
  const aud = env[`ACCESS_AUD_${role.toUpperCase()}`];
  if (!team || !aud) throw new HttpError(503, 'Staff access is not configured');

  const token = request.headers.get('Cf-Access-Jwt-Assertion') || getCookie(request, 'CF_Authorization');
  if (!token) throw new HttpError(401, 'Staff sign-in required');

  if (!jwks || jwksTeam !== team) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwksTeam = team;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: aud });
    return { email: payload.email, role };
  } catch {
    throw new HttpError(401, 'Staff sign-in required');
  }
}
