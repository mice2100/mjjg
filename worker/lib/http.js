// Small HTTP helpers shared by every route.

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ success: false, error: err.message, ...err.extra }, { status: err.status });
  }
  console.error('Unhandled error:', err);
  return json({ success: false, error: 'Internal server error' }, { status: 500 });
}

// Only accept JSON bodies. Browsers cannot send application/json cross-site without a
// CORS preflight, so this doubles as CSRF protection for cookie-authenticated routes.
export async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const isDev = (env) => env.ENVIRONMENT === 'development';
