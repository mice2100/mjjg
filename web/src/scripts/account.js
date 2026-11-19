// Customer account client: config, current customer, social sign-in, header chip.
// The Worker verifies every provider token; nothing here is trusted server-side.

const FACEBOOK_GRAPH_VERSION = 'v21.0';

let configPromise = null;
let customer = null;
const listeners = new Set();

export function getConfig() {
  configPromise ??= fetch('/api/config')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return configPromise;
}

export const getCustomer = () => customer;

// cb(customer|null) now and on every change.
export function onCustomerChange(cb) {
  listeners.add(cb);
  cb(customer);
  return () => listeners.delete(cb);
}

function setCustomer(next) {
  customer = next || null;
  listeners.forEach((cb) => cb(customer));
}

export async function refreshCustomer() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    setCustomer(res.ok ? (await res.json()).customer : null);
  } catch {
    setCustomer(null);
  }
  return customer;
}

export async function updateProfile(fields) {
  const res = await fetch('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (res.ok) setCustomer((await res.json()).customer);
}

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  setCustomer(null);
}

async function exchange(provider, payload) {
  const res = await fetch(`/api/auth/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Sign-in failed. Please try again.');
  setCustomer(data.customer);
}

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });

// Provider SDKs are loaded only when the dialog is first opened.
async function setUpProviders(dialog, config, onError) {
  const done = () => dialog.close();
  const fail = (err) => onError(err.message || String(err));

  if (config.google_client_id) {
    const slot = dialog.querySelector('[data-provider="google"]');
    await loadScript('https://accounts.google.com/gsi/client');
    window.google.accounts.id.initialize({
      client_id: config.google_client_id,
      callback: ({ credential }) => exchange('google', { credential }).then(done, fail),
    });
    window.google.accounts.id.renderButton(slot, { theme: 'outline', size: 'large', shape: 'pill', width: 320, text: 'continue_with' });
    slot.hidden = false;
  }

  if (config.apple_services_id) {
    const btn = dialog.querySelector('[data-provider="apple"]');
    await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
    window.AppleID.auth.init({
      clientId: config.apple_services_id,
      scope: 'name email',
      redirectURI: `${location.origin}/order/`,
      usePopup: true,
    });
    btn.onclick = async () => {
      try {
        const r = await window.AppleID.auth.signIn();
        const n = r.user?.name;
        await exchange('apple', { id_token: r.authorization.id_token, name: n ? `${n.firstName || ''} ${n.lastName || ''}`.trim() : '' });
        done();
      } catch (err) {
        if (err?.error !== 'popup_closed_by_user') fail(err);
      }
    };
    btn.hidden = false;
  }

  if (config.facebook_app_id) {
    const btn = dialog.querySelector('[data-provider="facebook"]');
    await loadScript('https://connect.facebook.net/en_US/sdk.js');
    window.FB.init({ appId: config.facebook_app_id, version: FACEBOOK_GRAPH_VERSION, cookie: false, xfbml: false });
    btn.onclick = () =>
      window.FB.login(
        (resp) => {
          if (resp.authResponse) exchange('facebook', { access_token: resp.authResponse.accessToken }).then(done, fail);
        },
        { scope: 'public_profile,email' }
      );
    btn.hidden = false;
  }
}

const hasProvider = (c) => Boolean(c.google_client_id || c.apple_services_id || c.facebook_app_id);

let providersReady = null;
export async function openSignIn() {
  const dialog = document.getElementById('signin-dialog');
  const config = await getConfig();
  if (!dialog || !hasProvider(config)) return false;
  const errorEl = dialog.querySelector('.signin-error');
  errorEl.hidden = true;
  dialog.showModal();
  providersReady ??= setUpProviders(dialog, config, (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }).catch((err) => {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  });
  return true;
}

function renderHeader(slot, config) {
  if (!hasProvider(config)) return;
  onCustomerChange((c) => {
    slot.replaceChildren();
    if (c) {
      const chip = document.createElement('span');
      chip.className = 'account-chip';
      const name = document.createElement('span');
      name.textContent = `Hi, ${(c.name || c.email || 'there').split(' ')[0]}`;
      const out = document.createElement('button');
      out.type = 'button';
      out.textContent = 'Sign out';
      out.onclick = signOut;
      chip.append(name, out);
      slot.append(chip);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.textContent = 'Sign in';
      btn.onclick = openSignIn;
      slot.append(btn);
    }
  });
}

let initialized = false;
export async function initAccount() {
  if (initialized) return;
  initialized = true;
  const dialog = document.getElementById('signin-dialog');
  dialog?.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  const config = await getConfig();
  document.querySelectorAll('[data-account-slot]').forEach((slot) => renderHeader(slot, config));
  document.querySelectorAll('[data-open-signin]').forEach((el) => {
    el.hidden = !hasProvider(config);
    el.addEventListener('click', openSignIn);
  });
  if (hasProvider(config)) refreshCustomer();
}
