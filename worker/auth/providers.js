// Server-side verification of social sign-in tokens. The browser only ever sends us
// the provider's token; we never trust a client-supplied email or user id.
// Each verifier returns { providerUserId, email, emailVerified, name }.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from '../lib/http.js';
import { cleanText, normalizeEmail } from '../lib/util.js';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

const invalid = () => new HttpError(401, 'Sign-in could not be verified. Please try again.');

// Google Identity Services: body.credential is the ID token from the GIS button.
async function google(body, env) {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in is not configured');
  try {
    const { payload } = await jwtVerify(String(body.credential || ''), GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
    });
    return {
      providerUserId: payload.sub,
      email: normalizeEmail(payload.email),
      emailVerified: payload.email_verified === true,
      name: cleanText(payload.name, 100),
    };
  } catch {
    throw invalid();
  }
}

// Sign in with Apple JS (popup mode): body.id_token, plus body.name which Apple only
// returns to the browser on the very first authorization.
async function apple(body, env) {
  if (!env.APPLE_SERVICES_ID) throw new HttpError(503, 'Apple sign-in is not configured');
  try {
    const { payload } = await jwtVerify(String(body.id_token || ''), APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: env.APPLE_SERVICES_ID,
    });
    return {
      providerUserId: payload.sub,
      email: normalizeEmail(payload.email), // may be a privaterelay.appleid.com address
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      name: cleanText(body.name, 100),
    };
  } catch {
    throw invalid();
  }
}

// Facebook Login JS SDK: body.access_token. Verified against our app id, then /me.
async function facebook(body, env) {
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) throw new HttpError(503, 'Facebook sign-in is not configured');
  const userToken = String(body.access_token || '');
  const appToken = `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`;

  const debug = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(appToken)}`
  ).then((r) => r.json());
  if (!debug?.data?.is_valid || String(debug.data.app_id) !== String(env.FACEBOOK_APP_ID)) throw invalid();

  const me = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(userToken)}`
  ).then((r) => r.json());
  if (!me?.id || me.id !== debug.data.user_id) throw invalid();

  const email = normalizeEmail(me.email); // absent if the user declined the email permission
  return { providerUserId: me.id, email, emailVerified: Boolean(email), name: cleanText(me.name, 100) };
}

export const PROVIDERS = { google, apple, facebook };
