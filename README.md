# Jade Garden — Website, Online Ordering, POS & Kitchen

**English** · [中文](README.zh.md)

Jade Garden Restaurant (471 Main St N, Moose Jaw, SK) runs on **one Cloudflare Worker + one D1 database**:

- **Customer website** (`/`, `/order/`, `/gallery/`, `/privacy/`): Astro static site with online ordering (pickup and delivery), coupons and optional Google/Apple/Facebook sign-in.
- **Staff app** (`/staff/`; `/staff/pos/` opens on Order, `/staff/kitchen/` on Kitchen): iPad POS (phone, walk-in, dine-in tables), register (cash/card, split bills, receipts), kitchen display with chime alerts, and menu settings (item options, sold out, combo contents). Protected by Cloudflare Access. The previous screen stays at `/staff/classic/`.
- **API** (`/api/*`): server-side pricing, orders, customers, coupons, payment webhooks.
- **Online payment:** Clover Hosted Checkout (customers pay on Clover's page; no card data touches our code).
- **WooCommerce import** (temporary): keeps the old WordPress orders flowing into the kitchen board until cutover.

> **This README is the handover guide.** The detailed engineering contract (rules, API, data model, promotions) is in [AGENTS.md](AGENTS.md). If you use an AI coding assistant, tell it to read AGENTS.md first.

---

## 1. Where things stand (handover snapshot)

| Item | State |
|---|---|
| Website, ordering, POS, kitchen board, coupons | Built and tested locally (`npm test`, e2e smoke tests) |
| New staff app (dine-in tables, split payments, item options, sold out) | Built 2026-11, tested locally; **not deployed yet**. Deploying applies migration `0005` |
| Test deployment | Previously on `jg.moosephotoprint.com` and a `workers.dev` host, under the previous developer's Cloudflare account |
| Clover payments | **Sandbox only.** The previous keys were rejected (see §8). Production refuses web orders until real Clover keys are set |
| Customer sign-in (Google/Apple/Facebook) | Not configured; the site works with guest checkout only |
| Turnstile (bot protection) | Not configured |
| Domain `mjjadegarden.com` | Moved to Cloudflare, still points at the old WordPress site. Plan: stage on `w2.mjjadegarden.com`, move `www` later (§7) |
| Photos / dish descriptions | Restaurant's own photos only; 67 dishes still have no photo |

**Because the domain now lives in your Cloudflare account, deploy everything into that account.** Do not reuse the previous developer's D1 id, Access app or tokens; replace them as described in §4.

---

## 2. Accounts you need

1. **Cloudflare** (owns the domain): Workers, D1, Zero Trust (Access, free plan is enough), Turnstile.
2. **Clover** merchant account (Ecommerce / Hosted Checkout enabled).
3. **GitHub** (this repo).
4. Optional: Google / Apple / Facebook developer accounts if you want social sign-in.

Tools on your computer: Node.js 20+ and npm, git. (Python 3 only for the optional scripts in `tools/`.)

---

## 3. Project structure

```
AGENTS.md            Engineering contract: rules, architecture, API, data model, promotions playbook
README.md            This file
TODO.md              Detailed plans for bigger backlog items (customer email)
wrangler.jsonc       Worker config: assets, D1 binding, cron, routes, public vars (NO secrets)
package.json         npm scripts (dev, test, build, deploy, db:*)
scripts/deploy.sh    Production deploy: setup | deploy | status | rollback
data/
  menu.json          SINGLE source of dishes, prices, photos (site, API and server pricing all read it)
  moose_jaw_streets.json, moose_jaw_hotels.json   POS address autocomplete
migrations/          D1 schema, one file per change (0001_init.sql, ...). Never edit an applied one
seed/dev.sql         Local-only sample coupons
worker/              Backend (Cloudflare Worker)
  index.js           Router + cron entry
  routes/            public.js, account.js, staff.js, webhooks.js
  services/          pricing.js, coupons.js, orders.js, customers.js, clover.js, combos.js, woocommerce.js (+ tests)
  auth/              staff.js (Cloudflare Access JWT), session.js, providers.js
  lib/               http, util (tax, time zone, phone), menu
web/                 Customer site (Astro) -> built into web/dist
  src/data/site.js   Address, phone, opening hours, featured dishes
  src/content/promotions/   One .md file per live promotion (see §6)
  src/pages/ components/ scripts/ styles/ lib/
  public/staff/index.html   Staff POS + kitchen app (one vanilla HTML file)
  public/images/menu/       <menuId>.webp and <menuId>-sm.webp dish photos
  public/images/site/       Hero, story and gallery photos
docs/architecture_and_guide.md   POS search, printer hardware, cutover SOP
tools/               Optional offline Python helpers (WooCommerce inspection, old image import)
```

How it fits together: the browser loads static pages from `web/dist`; anything under `/api/*` runs `worker/index.js`, which reads/writes D1. A cron job runs **every minute** to expire unpaid Clover checkouts and (until cutover) import WooCommerce orders. Staff pages and `/api/staff/*` are behind Cloudflare Access.

---

## 4. First-time setup in YOUR Cloudflare account

### 4.1 Run it locally first

```bash
git clone https://github.com/mice2100/mjjg.git && cd mjjg
npm install
cp .dev.vars.example .dev.vars          # keep ENVIRONMENT=development (skips staff login locally)
npm run db:migrate && npm run db:seed   # local D1
npm run dev                             # http://localhost:8787  (/, /order/, /staff/)
npm test
```

### 4.2 Cloudflare API token

Cloudflare dashboard → My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers**, then add **Account › D1 › Edit**. If you attach custom domains through `routes`, also add **Zone › Workers Routes › Edit** for `mjjadegarden.com`. Then:

```bash
cp .deploy.env.example .deploy.env      # fill CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
```

(Or leave both empty and use `npx wrangler login`.) `.deploy.env`, `.prod.vars`, `.dev.vars` and `.env` are git-ignored. **Never commit them.**

### 4.3 Edit `wrangler.jsonc` for your account

| Setting | What to do |
|---|---|
| `d1_databases[0].database_id` | `npm run deploy:setup` finds or creates `jadegarden-db` in your account and writes the new id for you |
| `routes` | Currently the old test host `jg.moosephotoprint.com`. Replace with `w2.mjjadegarden.com` for the staged launch (see §7) |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Replace with your own Zero Trust values (step 4.5) |
| `CLOVER_MERCHANT_ID`, `CLOVER_ENV` | Your Clover merchant UUID and `sandbox` or `production` (step 4.6) |
| `PUBLIC_SITE_URL`, `WC_STORE_URL` | `https://mjjadegarden.com` |
| `ADMIN_EMAILS` | Emails allowed to edit combo contents in the staff app. Empty = every staff member |

### 4.4 First deploy

```bash
npm run deploy:setup
```

It creates the D1 database, applies migrations, generates `SESSION_SECRET` in `.prod.vars`, and deploys. The site is then live at `jadegarden.<your-subdomain>.workers.dev`.

### 4.5 Protect the staff app (Cloudflare Access)

Zero Trust → Access → Applications → Add **self-hosted**. Add two paths on your host: `/staff/*` and `/api/staff/*`. Policy: allow the staff emails (One-time PIN login works). Copy the **team domain** (`xxxx.cloudflareaccess.com`) and the application **AUD tag** into `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.jsonc`, then `npm run deploy`. Until this is set the staff API refuses every request (it fails closed, on purpose).

### 4.6 Clover (online payments)

1. Find the **13-character merchant UUID** (in the Merchant Dashboard URL). It is **not** the numeric MID. Put it in `CLOVER_MERCHANT_ID`.
2. Merchant Dashboard → Account & Setup → Ecommerce API Tokens → create a **private token** → `CLOVER_PRIVATE_KEY` in `.prod.vars`.
3. Ecommerce → Hosted Checkout → set the webhook URL to `https://<your-host>/api/webhooks/clover`, click Generate, and store the Signing Secret as `CLOVER_WEBHOOK_SECRET`. Keep Clover's own tipping **off**: tips are chosen on our site.
4. Test in `sandbox` with Clover's test cards. Before going live set `CLOVER_ENV` to `production`, then do a real $1 order and refund it in Clover.

### 4.7 Other secrets (`.prod.vars`)

Copy `.prod.vars.example` to `.prod.vars`. An empty line keeps the value already stored in Cloudflare.

| Secret | Needed for |
|---|---|
| `SESSION_SECRET` | Generated by setup. Changing it signs every customer out |
| `CLOVER_PRIVATE_KEY`, `CLOVER_WEBHOOK_SECRET` | Online payment |
| `TURNSTILE_SECRET_KEY` (+ `TURNSTILE_SITE_KEY` var) | Bot protection on checkout. Create a Turnstile widget for your host |
| `FACEBOOK_APP_SECRET` | Only if Facebook sign-in is used |
| `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `WC_WEBHOOK_SECRET` | Only until WordPress is shut down |

---

## 5. Deploying updates

```bash
npm test && npm run build     # sanity check
git commit -am "..."          # deploy refuses uncommitted changes
npm run deploy                # tests, build, D1 backup to backups/, migrations if pending, deploy, smoke test
npm run deploy:status         # versions, secrets, pending migrations
npm run deploy:rollback       # previous CODE version only; never rolls back D1
```

Because rollback never touches the database, **migrations must be additive** (new tables/columns; old code must still run on the new schema).

---

## 6. Everyday tasks (no developer needed)

**Change a price or add a dish:** edit `data/menu.json`, then `npm run deploy`. Never renumber ids. Add new dishes with new ids; remove a dish to retire it (old orders keep their own copy).

**Add a dish photo:** convert to WebP and save as `web/public/images/menu/<id>.webp` (1200px) and `<id>-sm.webp` (480px), then set `"image": "/images/menu/<id>.webp"` on the item in `menu.json`.
`magick in.jpg -auto-orient -strip -resize 1200x1200\> -quality 80 out.webp`. Publish only the restaurant's **own** photos, never stock images or photos of identifiable customers.

**Change hours, address or phone:** `web/src/data/site.js`.

**Advertise a promotion on the website:** copy `web/src/content/promotions/_example.md` to a new file, edit, deploy. Start and end dates are respected automatically. Delete the file to retire it.

**Give a discount (coupon):** one SQL row, no deploy:

```bash
npx wrangler d1 execute jadegarden-db --remote --command "INSERT INTO coupons (...) VALUES (...)"
```

The full column list and a ready-to-edit example are in [AGENTS.md §7](AGENTS.md#7-promotions--coupons-playbook). Turn a coupon off with `UPDATE coupons SET is_active = 0 WHERE code = 'X'`.

**Mailing list (only customers who opted in, CASL):**
`SELECT email, name FROM customers WHERE marketing_opt_in = 1`

**Refund a paid web order:** done by hand in the Clover dashboard. Cancelling in the kitchen does **not** refund.

**Add a staff member:** add their email to the Access policy in Zero Trust.

**Sold out / back in stock:** staff app → Menu → tap Available / Sold out next to the dish. The website stops selling it at the same time; no deploy needed.

**Item options (spice level, requests …):** staff app → Menu → Item options. Only emails in `ADMIN_EMAILS` can change them (empty = every staff member).

---

## 7. Launch plan: stage on `w2.mjjadegarden.com`, then move `www`

The domain is already on Cloudflare, so we launch in two stages. WordPress keeps serving `www.mjjadegarden.com` and `mjjadegarden.com` until the new site has proven itself.

**Stage 1: staging on `w2.mjjadegarden.com` (WordPress untouched)**

1. In `wrangler.jsonc` set `routes` to `[{ "pattern": "w2.mjjadegarden.com", "custom_domain": true }]`, then `npm run deploy`. Wrangler creates the DNS record and certificate. (`PUBLIC_SITE_URL` may stay `https://mjjadegarden.com`.)
2. Add `w2.mjjadegarden.com` to the Access application (§4.5) and to the Turnstile widget hostnames.
3. Set the Clover webhook to `https://w2.mjjadegarden.com/api/webhooks/clover` (and the WooCommerce webhooks to `https://w2.mjjadegarden.com/api/webhooks/woocommerce`).
4. Keep `CLOVER_ENV` at `sandbox` while testing: place orders, pay with a test card, see them on `/staff/kitchen/`, mark them complete. The owner reviews copy, hours, prices, privacy text and photos here.
5. Let staff use `https://w2.mjjadegarden.com/staff/pos/` and `/staff/kitchen/` for real (phone orders, WordPress orders imported by the cron). Run like this until it is stable.

**Stage 2: go live on `www`**

1. Set `CLOVER_ENV` to `production` with the live merchant id, `CLOVER_PRIVATE_KEY` and `CLOVER_WEBHOOK_SECRET`.
2. In Cloudflare DNS **delete the WordPress records** for `www` and the apex (a custom domain cannot sit on top of an existing record). Do this at a quiet time: from here until the deploy finishes, the old site is down.
3. Set `routes` to `www.mjjadegarden.com` and `mjjadegarden.com` (both `custom_domain: true`; keep `w2` too if you want it as a spare), then `npm run deploy`.
4. Update the Access app, Turnstile hostnames, and the Clover and WooCommerce webhook URLs to the new host.
5. Place a real $1 order and refund it in Clover.
6. After a few stable days, clean up: delete the WooCommerce part of `scheduled()`, `worker/services/woocommerce.js`, the WooCommerce handler in `worker/routes/webhooks.js` (**keep the Clover webhook and the cron**) and the `WC_*` secrets, then shut down WordPress.

Old WordPress URLs are redirected by `web/public/_redirects`.

---

## 8. Known issues and must-do items

1. **Rotate the WooCommerce API key.** An old key was committed in the *previous* repository's history. This repository was published with a fresh, squashed history, but the old key is still active on the WordPress site. In WordPress create a new **read-only** key, delete the old one, and put the new one in `.prod.vars`.
2. **Clover keys:** the earlier keys failed with 401 because the numeric processor MID was used instead of the 13-character merchant UUID. Create new keys as in §4.6.
3. **Access and Turnstile** must be set up in your account before the site can be used for real (§4.5, §4.7).
4. **Order-taking guards:** web orders are not yet rejected outside business hours or on Mondays.
5. **Owner content review:** hours, delivery area, privacy text, dish descriptions (`description` field in `menu.json`), and photos for dishes that have none.

## 9. Backlog (not built yet)

Order confirmation email and coupon campaigns (see `TODO.md`), scheduled "order for later", caller-ID popup in the POS (`/staff/#call=<number>`), kitchen printer bridge (see `docs/architecture_and_guide.md`), magic-link sign-in and `/account/` page, and a staff menu editor (move the menu into D1). Full list in [AGENTS.md §12](AGENTS.md#12-open-items--backlog-priority-order).

## 10. Rules to keep (details in AGENTS.md §2)

- All customer and staff text is **English**.
- **The server decides prices.** Never trust a price or total from the browser.
- Money is **integer cents**. Times are stored in UTC; business logic uses `America/Regina`.
- **No secrets in git.** Use `.dev.vars`, `.prod.vars`, `.deploy.env`, or `wrangler secret put`.
- Schema changes are **new files** in `migrations/`. Never edit an applied one.
- Keep promotion slots empty-safe: the site must launch with no promotions.

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `/staff/` shows a Cloudflare login, then 401/403 from `/api/staff/*` | `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` wrong, or the Access app does not cover both `/staff/*` and `/api/staff/*` |
| Checkout returns 503 | No `CLOVER_PRIVATE_KEY` in production |
| Checkout returns 502 | Clover rejected the request: check merchant UUID, token, environment |
| Customer paid but the order stays "awaiting" | Webhook URL or `CLOVER_WEBHOOK_SECRET` wrong. The cron also checks Clover's payments API every minute as a backup |
| Local site shows old pages | `wrangler dev` serves the `web/dist` from startup: run `npm run build` and restart |
| Deploy refuses to run | Uncommitted changes (commit them), or tests failing |

More detail: [docs/architecture_and_guide.md](docs/architecture_and_guide.md) (POS search algorithm, street autocomplete, printer hardware, cutover SOP).
