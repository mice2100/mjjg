# AGENTS.md — Jade Garden (mjjadegarden.com)

> Read this file first. It is the contract for every AI agent and engineer working in this repo.
> If you change architecture, rules or conventions, update this file in the same commit.

---

## 1. What this project is

**Client:** Jade Garden Restaurant, 471 Main St N, Moose Jaw, SK S6H 0W5 · (306) 694-5566 · family-owned since 2012.
**Goal:** replace the slow WordPress/WooCommerce site with one fast Cloudflare stack that serves:

| Area | URL | Users | Status |
|---|---|---|---|
| Customer website + online ordering | `/`, `/order/`, `/gallery/`, `/privacy/` | Public | Built with the restaurant's own photos; needs owner review and auth/Turnstile keys |
| Phone orders (POS) | `/pos/` | POS staff + admins (Cloudflare Access) | Working; phase 1 launch |
| Order management (kitchen board) | `/staff/` | Kitchen staff + admins (Cloudflare Access) | Working; phase 1 launch |
| Administration (combo contents) | `/jadmin/` | Admins only (Cloudflare Access) | Working. Old `/staff/pos/` and `/staff/kitchen/` redirect |
| Order API, customer accounts, coupons | `/api/*` | Website + staff app | Working, unit + e2e tested locally |
| WooCommerce → D1 order import | cron (webhook optional) | Background | Working; all 1042 historic orders imported 2026-11-19; delete after cutover |

**Current phase:** the old WordPress site still takes online orders. The Worker imports them into D1 so the kitchen sees **all** orders in one place. After the owner approves the new site, DNS for `mjjadegarden.com` moves to the Worker and WordPress is shut down (see §11).

---

## 2. Hard rules (MUST)

1. **All user-facing text is English.** The customer website (`web/src/**`) and the staff/kitchen app (`web/public/staff/`) must be in English only, including labels, buttons, errors, alerts, placeholders, `title` attributes, API error messages (`worker/**`), and seed data descriptions. The owner and developers talk in Chinese. **Never copy Chinese from a conversation into the product.** Code comments and docs should be English too.
2. **The server decides prices.** Clients send only `{id, qty}` items, a delivery type and a coupon code. Totals come from `worker/services/pricing.js`. Never trust a price, discount or total from a request body.
3. **Money is integer cents** in D1 and in the Worker (`*_cents`). Convert to dollars only for display (`toStaffOrder`, the website).
4. **No secrets in git.** Use `wrangler secret put` (prod) and `.dev.vars` (local). `.env` is only for `tools/*.py`. A WooCommerce key was committed in the past and **must be rotated** (see §12).
5. **Menu item `id`s in `data/menu.json` are permanent.** Carts, coupons (`free_item_id`) and `FEATURED_ITEM_IDS` reference them. Add new dishes with new ids. Never renumber. Retire a dish by removing it (old orders keep their own copy of name and price).
6. **Schema changes = a new file in `migrations/`** (`0002_….sql`). Never edit an applied migration. Never create or alter tables at runtime.
7. **Staff-only endpoints are split by role**: `/api/kitchen/*` (page `/staff/`), `/api/pos/*` (page `/pos/`) and `/api/admin/*` (page `/jadmin/`). Each is registered with `{ staff: '<role>' }` in `worker/index.js` and protected by its **own Cloudflare Access application** plus JWT verification against that role's AUD (`worker/auth/staff.js`), which fails closed. Who may use a role is set in the Cloudflare dashboard (§10), never in the repo. A new staff endpoint must pick exactly one role.
8. **Escape customer text in the staff app.** It renders with `innerHTML`. All order strings pass through `sanitizeOrder()` when they enter the app. Keep it that way, and never put customer text inside inline `onclick="…'${text}'…"`.
9. **Times:** store UTC ISO strings. Business logic (coupon days and hours, display) uses `America/Regina` (Saskatchewan, CST all year, no DST). Helpers are in `worker/lib/util.js`.
10. **Keep the site launchable without promotions.** Every promotion slot must render nothing when it is empty (see §7).
11. **Photos: publish only the restaurant's own images, as WebP.** Never publish stock photos, images copied from other sites, AI-generated food art, or photos showing identifiable customers (that needs their consent). Use one large and one `-sm` size (see §4a).

---

## 3. Architecture

```
                 Browser (customers)            iPad / kitchen screen (staff)
                         │                                  │
                         ▼                                  ▼
        ┌──────────────────────── Cloudflare (one Worker: "jadegarden") ───────────────────────┐
        │  Static assets (web/dist, built by Astro)     Access: /staff /pos /jadmin and      │
        │    /  /order/  /privacy/  /staff/ /pos/ /jadmin/  /api/{kitchen,pos,admin}/*         │
        │                                                                                      │
        │  worker/index.js  fetch()  → /api/*  (run_worker_first)                              │
        │      public:  config, menu, streets, quote, orders, auth/*, me                       │
        │      staff:   staff/orders (list, create, status)                                    │
        │      hooks:   webhooks/woocommerce, webhooks/clover (HMAC-signed)                    │
        │  worker/index.js  scheduled()  every minute → expire unpaid checkouts;               │
        │                                 WooCommerce REST → D1 (safety net)                   │
        └───────────────────────────────────────┬──────────────────────────────────────────────┘
                                                ▼
        Clover Hosted Checkout ◄──── web orders pay on Clover's page; its webhook marks them paid
                                   Cloudflare D1 (jadegarden-db)
                 customers · customer_identities · orders · counters · coupons · coupon_redemptions · sync_state
```

**Why this shape (decision log):**
- **One Worker instead of Pages + Functions.** Workers support static assets, cron triggers and webhooks in a single deployable. WooCommerce syncing became a background job (cron + webhook), so the **kitchen screen only reads D1** and never calls WooCommerce. Before this change, every kitchen poll from every screen hit WooCommerce, and nothing synced while no screen was open.
- **Astro (static output) for the customer site.** Pages are pre-rendered (fast, SEO-friendly, the full menu is indexable). Components and a typed content collection make promotions safe for agents to edit. There is no SSR adapter and no client framework; small vanilla scripts handle the cart and sign-in.
- **Shared code between the site and the staff app** lives in `web/src/lib/` as dependency-free ES modules. The site imports it normally; the staff app loads it with `import('/js/…')` through a tiny endpoint in `src/pages/js/`. Change search behaviour only in `src/lib/search.js`; both apps follow. Do not paste copies into `staff/index.html`.
- **The staff app stays one vanilla HTML file** (`web/public/staff/index.html`), copied as-is by Astro. It is battle-tested on the iPad mini. Rewriting it gives no user value now.
- **Online payment = Clover Hosted Checkout.** The customer pays on Clover's page, so card data never touches our code (no PCI scope). The whole order goes to Clover as one line item for the exact server total, and Clover's own tip screen stays off. An order becomes paid only on Clover's word: the signed webhook, or, if that is lost, Clover's own payments API (`reconcileCloverPayments`, matched by the line item name `Jade Garden order <id>` and the exact total). The browser never asserts payment; its status polls and the cron just trigger that server-side check.
- **D1 holds only one promotion primitive: coupons.** The marketing strategy is not decided, so there are no flash-sale, weekly-special or loyalty tables until a real campaign needs them.

---

## 4. Repository map

```
AGENTS.md                 ← this file (CLAUDE.md just imports it)
README.md                 ← quick start
TODO.md                   ← detailed plans for larger backlog items (email)
wrangler.jsonc            ← Worker config: assets, D1 binding, cron, public vars
package.json              ← scripts (build, dev, db:*, test, deploy)
.dev.vars.example         ← local secrets template (copy to .dev.vars)
.deploy.env.example       ← Cloudflare API token + account id for scripts/deploy.sh (copy to .deploy.env)
.prod.vars.example        ← production secrets template (copy to .prod.vars)
scripts/deploy.sh         ← production deploy: setup | deploy | status | rollback (see §10)
.env.example              ← only for tools/*.py
data/
  menu.json               ← SINGLE source of dishes, prices and photo paths (website build, /api/menu, server pricing)
  moose_jaw_streets.json  ← street list for POS address autocomplete (/api/streets)
  moose_jaw_hotels.json   ← hotels/motels (name + street address) for the POS address picker (/api/streets → hotels); owner to confirm
migrations/               ← D1 schema: 0001_init.sql, 0002_payments.sql, 0003_combos.sql, 0004_customer_addresses.sql (see §6)
seed/dev.sql              ← local-only sample coupons
worker/
  index.js                ← router + cron entry
  lib/        http.js (json, errors, readJson), util.js (tax, fees, phone/email, time zone), menu.js
  auth/       staff.js (Cloudflare Access JWT), session.js (customer cookie), providers.js (Google/Apple/Facebook)
  services/   pricing.js (+ tips, pricing.test.js), coupons.js (+ coupons.test.js), orders.js, customers.js,
              clover.js (+ clover.test.js), combos.js (+ combos.test.js), woocommerce.js
  routes/     public.js, account.js, staff.js, webhooks.js
web/                      ← Astro project (npm run build → web/dist)
  astro.config.mjs
  public/staff/index.html ← staff app, one vanilla JS file; APP_MODE from the path picks kitchen (/staff/) / pos (/pos/) / admin (/jadmin/)
  src/pages/pos/, src/pages/jadmin/ ← republish that same file at /pos/ and /jadmin/
  public/_redirects       ← old URLs (/pos.html, /kitchen.html, /website/*) → new ones
  public/images/menu/     ← <menuId>.webp (1200px) + <menuId>-sm.webp (480px) dish photos
  public/images/site/     ← <slug>.webp (1800px) + <slug>-sm.webp (640px) hero, story, gallery photos
  public/_headers, robots.txt, favicon.svg
  src/data/site.js        ← restaurant facts (address, phone, hours), FEATURED_ITEM_IDS, GALLERY/PHOTO
  src/data/gallery.json   ← generated photo list (src, thumb, size, group, English alt text)
  src/content.config.js   ← promotions collection schema
  src/content/promotions/ ← one .md per live promotion (_example.md = template, never published)
  src/components/         ← Header, Footer, PromoSlot, SignInDialog
  src/layouts/Base.astro
  src/pages/              ← index, order, gallery, privacy, 404
  src/scripts/            ← account.js (sign-in), order.js (cart/checkout)
  src/lib/search.js       ← fuzzy dish + street search SHARED by /order/ (bundled) and the staff app (+ search.test.js)
  src/pages/js/search.js.js ← publishes src/lib/search.js unbundled at /js/search.js for the staff app
  src/styles/global.css   ← design tokens; reuse them
docs/architecture_and_guide.md ← POS search algorithm, printer hardware, cutover SOP
tools/wc_inspect.py       ← read-only WooCommerce debugging
tools/import_old_site_images.py ← re-imports photos from the old WordPress site (see §4a)
assets/old-site-webp/     ← git-ignored local archive of ALL old-site images as WebP (reference only, not published)
```

### 4a. Images

- **Dish photo:** put `web/public/images/menu/<id>.webp` and `<id>-sm.webp` in place, then set `"image": "/images/menu/<id>.webp"` on the item in `data/menu.json`. The home page and `/order/` use the `-sm` file automatically. Dishes without a photo show a neutral brand tile.
- **Site photos** (hero, Our story, gallery) are listed in `web/src/data/gallery.json` (`group`: `food` | `room` | `buffet`). Pages pick them by `slug` through `PHOTO[slug]` in `site.js`.
- **Converting:** `magick in.jpg -auto-orient -strip -resize 1800x1800\> -quality 80 out.webp` (ImageMagick 7, also reads HEIC from iPhones).
- **Old-site import:** `python3 -I tools/import_old_site_images.py` downloads the WordPress media library and archives every real image to `assets/old-site-webp/`. It republishes only the curated `SITE_PHOTOS` list and product photos matched to `menu.json` by name. Of 327 old-site images, about 120 were blank theme placeholders, and many others were stock or copied from other restaurants and recipe blogs. Those are deliberately not published.

---

## 5. API reference

All bodies are JSON. POST/PATCH **require** `Content-Type: application/json`, which also blocks form-based CSRF. Errors return `{ success: false, error }` with a proper status code.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/config` | – | Public settings: sign-in client ids, Turnstile site key, fee, tax rate, `tip_choices`, `online_payment` |
| GET | `/api/menu` | – | `{menu:[{id,code,name,price,category}]}` from `data/menu.json` |
| GET | `/api/streets` | – | `{streets, hotels}`: Moose Jaw street names and hotels `[{name, address, type}]` |
| POST | `/api/quote` | optional session | Cart preview: `{items:[{id,qty}], delivery_type, coupon_code?, tip?, customer_email?, customer_phone?}` → `{quote}` (includes `tip_cents` and `tip_options`, the amount for every tip button). Reports coupon problems in `coupon_message` instead of failing |
| POST | `/api/orders` | optional session, Turnstile if configured | Place a web order. Needs `customer_name`, `customer_phone`, `customer_email`, plus `delivery_address` for delivery; optional `tip` (`none`\|`5`\|`10`\|`15`\|`round`). Returns `{order, payment_url}` with `WEB-####`; the browser goes to `payment_url` (Clover). A coupon problem → 409 `{coupon_error:true}`. Clover down → 502. No Clover key in production → 503 |
| GET | `/api/orders/:id/status?t=<public_token>` | token | The customer's own order: `{status, payment_status, total_cents, …}`. Polled after Clover redirects back; while `awaiting`, it also asks Clover's payments API, in case the webhook is lost |
| POST | `/api/auth/google` · `apple` · `facebook` | – | Body: `{credential}` / `{id_token, name}` / `{access_token}`. The token is verified server-side, then the `jg_session` cookie is set |
| POST | `/api/auth/logout` | – | Clears the session cookie |
| GET / PATCH | `/api/me` | session | Read or update name, phone, default_address, marketing_opt_in |
| GET | `/api/kitchen/orders` | kitchen | All pending orders plus the last 7 days, staff shape (dollars, `time` in local time). `?since=<iso>` returns only orders changed after that time (max 500); the board polls this way and reloads fully every 10 minutes |
| POST | `/api/pos/orders` | pos | Phone or walk-in order: `{source:'Phone'\|'Walk-in', items:[{id,qty}], …}` → `ORD-####` |
| PATCH | `/api/kitchen/orders/:id` | kitchen | `{status:'pending'\|'completed'\|'cancelled'}` |
| GET | `/api/pos/customers/lookup?phone=` | pos | POS phone lookup: `{found, name, email, notes, addresses[] (most recent first), last_delivery_type, stats, orders[]}` (staff order shape, every channel). Index seeks only: customers by phone → their orders, `customer_addresses`, stored stats |
| GET | `/api/kitchen/combos` · `/api/pos/combos` · `/api/admin/combos` | kitchen / pos / admin | `{combos:[{combo_id, components:[{id,code,name,qty}]}], can_edit}` (`can_edit` only on the admin route). Kitchen and POS read it to show what a combo contains |
| PUT | `/api/admin/combos/:id` | admin | `{components:[{id,qty}\|{name,qty}]}` replaces what combo `:id` contains; `[]` clears it |
| POST | `/api/webhooks/woocommerce` | HMAC (`WC_WEBHOOK_SECRET`) | WooCommerce "Order created/updated" webhook |
| POST | `/api/webhooks/clover` | `Clover-Signature` HMAC (`CLOVER_WEBHOOK_SECRET`) | Clover Hosted Checkout payment webhook. `APPROVED` → order paid |

Order numbers come from one D1 counter (`counters.order`), so WEB-1001 and ORD-1002 never collide.

---

## 6. Data model (D1)

See `migrations/0001_init.sql` for exact columns and comments.

- **customers**: one per person, shared by the website and the POS. `email` (unique, lowercase) is the retention key; `phone` (digits only) is the POS key. `marketing_opt_in` and `marketing_opt_in_at` record CASL consent.
  - **Every order with a phone or email is linked** (`orders.customer_id`): web and POS orders when created, WooCommerce imports when imported (`linkOrderCustomer`), older orders by the cron job `backfillCustomers` (runs once, `sync_state.customer_backfill_cursor = 'done'` when finished).
  - `order_count`, `total_spent_cents`, `first_order_at`, `last_order_at` are **recomputed** from the customer's own orders after every change (`refreshCustomerStats`): orders not cancelled and `in_store` or `paid`. Never increment them by hand.
- **customer_addresses** (0004): every delivery address a customer used, keyed by `addressKey()`; `last_used_at` orders the POS address list.
- **customer_identities**: `(provider, provider_user_id) → customer_id`. One customer can link Google, Apple and Facebook. Linking happens by provider id first, then by verified email.
- **orders**: every channel. `source ∈ Web | Phone | Walk-in | WooCommerce`. `items_json` is a snapshot `[{id, code, name, price_cents, qty, free?}]`, all money in `*_cents`.
  - `payment_status`: `in_store` (staff collects: POS, WooCommerce, local dev), `awaiting` (web order sent to Clover, **hidden from the kitchen**), `paid` (Clover webhook), `expired` (never paid; order cancelled, coupon redemption deleted). `checkout_session_id` / `payment_id` link to Clover. `public_token` lets the customer's browser read its own status.
  - Every cron run first asks Clover about `awaiting` orders (lost-webhook backup), then expires unpaid web orders after 60 minutes, or right away when the same email + phone checks out again. A payment that still arrives later revives the order (back to `pending`, coupon re-reserved). Customer `order_count` / `total_spent_cents` count a web order only once it is paid.
  - `tip_cents` / `tip_choice`: web orders only.
- **coupons / coupon_redemptions**: see §7.
- **combos** (0003): what a combo menu item contains, `components_json` = `[{id|null, name, qty}]` (menu dish or free-text line). Edited in the staff app's Combos tab; display only, the combo's price stays in `data/menu.json`. `createOrder` copies the contents into each combo line of `items_json` (`components`), so the kitchen sees them even if the combo changes later.
- **counters**: sequential order numbers. **sync_state**: WooCommerce sync cursor.

Progressive profiling:
- **Signed-in** customers: checkout updates their phone, address and name.
- **Guests** matched by email or phone only fill **empty** fields, so a guest cannot overwrite someone else's details.
- Guest checkout still creates or links a customer by email. This captures every online customer's email even without sign-in.

---

### 6a. Staff POS new-order flow

New Order starts on the **phone step**: an on-screen keypad (`inputmode="none"`, so the iPad keyboard stays hidden; a physical keyboard still works). At 10 digits the app calls `/api/pos/customers/lookup`, fills the name, preselects pickup/delivery from the last order and the most recent address, and lists the order history. **Reorder** copies an old order into the cart (matched to today's menu by id, then code, then name; prices are today's; free coupon items are skipped). A saved address is sent exactly as stored; "New address" falls back to the street autocomplete. That autocomplete also offers hotels (typing a name, or the 🏨 Hotels button lists them all); a hotel address needs a room number and is stored as `<Hotel>, <street>, Room <n>, Moose Jaw, SK`.

**Caller ID hook:** opening `/pos/#call=3065551234` (or calling `startOrderForPhone()`) starts this lookup. An order already in progress is never replaced. The store has a landline, so the planned bridge is a USB caller-ID modem on the counter PC that opens that URL (backlog).

Combo editing lives only on `/jadmin/` (admin role). The kitchen and POS screens only display what a combo contains.

## 7. Promotions & coupons playbook

The owner will keep trying new ideas. There are two layers, and most requests touch only one:

**A. Advertising a promotion on the website = content.** Copy `web/src/content/promotions/_example.md` to a new file and edit it. Fields:
- `placement` is one of:
  - `announcement`: thin bar above the header on every page
  - `hero`: card beside the hours on the home page
  - `home-feature`: row of offer cards under the hero
  - `order-banner`: top of the menu on `/order/`
- `starts_at` / `ends_at`: checked at build time and again in the browser, so promotions start and stop on time without a rebuild.
- Also: `coupon_code`, `cta_label`, `cta_href`, `priority`.

Delete the file to retire the promotion. An empty slot renders nothing. Style new promo variations with the tokens in `global.css` (`--lacquer` is reserved for offers).

**B. Giving a discount = one row in `coupons`.** No deploy is needed:
```sql
-- wrangler d1 execute jadegarden-db --remote --command "<SQL>"
INSERT INTO coupons (code, description, discount_type, discount_value, max_discount_cents, min_subtotal_cents,
  first_order_only, requires_account, max_per_customer, max_redemptions, channels, conditions_json,
  starts_at, ends_at, is_active, created_at, updated_at)
VALUES ('SNOWDAY', 'Free delivery on snow days', 'free_delivery', 0, NULL, 2500,
  0, 0, 1, 100, 'Web', '{"days_of_week":[2,3,4]}',
  '2026-12-01T06:00:00Z', '2026-12-02T06:00:00Z', 1, datetime('now'), datetime('now'));
```
| Column | Meaning |
|---|---|
| `discount_type` | `percent` (value = whole %), `fixed` (value = cents), `free_delivery`, `free_item` (`free_item_id` = menu id) |
| `min_subtotal_cents`, `max_discount_cents` | threshold and cap |
| `starts_at`, `ends_at`, `is_active` | window and kill switch |
| `max_redemptions` | total uses (NULL = unlimited). `max_per_customer` matches email **or** phone |
| `first_order_only` | no previous non-cancelled order by that email or phone, from any channel |
| `requires_account` | must be signed in. Use this for "members-only" offers that grow registrations |
| `channels` | `Web`, or `Web,Phone` to let the POS use it later |
| `conditions_json` | `days_of_week` [0–6, 0 = Sunday], `hours` {from,to} in local time, `delivery_types` [...], `required_item_ids` [...]. **Unknown keys make the coupon invalid** (fail closed) |

**Adding a new kind of rule:** add a key to `CONDITION_CHECKS` in `worker/services/coupons.js`, add a test in `coupons.test.js`, and document it in the table above. Do not put promotion logic in the browser.

**Not implemented on purpose (add only when the owner commits to it):** automatic discounts without a code (would need an `auto_apply` column), stacking multiple coupons, loyalty points, flash-sale countdowns, weekly-specials pricing. Each one needs a migration plus pricing changes. Do not fake them in front-end code.

---

## 8. Customer accounts & retention

- **Sign-in options:** Google, Apple and Facebook. The Worker verifies every token (`worker/auth/providers.js`). The browser never asserts identity on its own.
- **Configuration:** a provider button appears only when its id is set in `wrangler.jsonc` vars (`GOOGLE_CLIENT_ID`, `APPLE_SERVICES_ID`, `FACEBOOK_APP_ID`) and its secret is set where needed (`FACEBOOK_APP_SECRET`). With no provider configured, the site launches with guest checkout only and every account UI element hides itself.
- **Session:** `jg_session` is an HttpOnly cookie holding an HS256 JWT signed with `SESSION_SECRET`, valid for 90 days.
- **Email without social sign-in:** guest checkout requires an email, so every web order captures one. Passwordless email login (magic link) is a backlog item and needs an email-sending service.
- **CASL (Canada's anti-spam law):** marketing email needs express opt-in. The checkbox is unchecked by default, and unchecking it never clears an earlier consent. Export a mailing list with `SELECT email, name FROM customers WHERE marketing_opt_in = 1`. Never email customers who did not opt in.
- **Apple users:** Apple may give a `privaterelay.appleid.com` address. Treat it like any other email.

---

## 9. Business rules

- Tax: GST 5% + PST 6% = **11%** of `(subtotal − discount + delivery fee)`, rounded to the cent. Tips are not taxed.
- Tips (website): No tip (default), 5%, 10%, 15% of food after discount (before tax and delivery), or "Round up", which tops the total up to the next whole dollar ($0 if already whole). The client sends only the choice; `tipCents()` in `pricing.js` computes the amount.
- Delivery: flat **$6.31** anywhere in Moose Jaw. Pickup is free.
- Payment: web orders are **paid online by card through Clover before the kitchen sees them**. No money is collected at the door. The staff app shows "Paid online — do not collect" or "Collect $X". POS phone and walk-in orders are still paid in store.
- Order ids: `WEB-####` (website), `ORD-####` (POS phone or walk-in), `WC-<wooId>` (imported from WordPress).
- Kitchen status: `pending → completed` (or `cancelled`). A WooCommerce re-sync never moves a kitchen-completed order back to pending. A WooCommerce cancellation always wins.
- Hours (also in `web/src/data/site.js`): Tue–Sun. Buffet lunch 11:00–15:00, supper 16:00–19:45, take-out and delivery 11:00–20:00. Closed Mondays.

---

## 10. Develop, test, deploy

```bash
npm install
cp .dev.vars.example .dev.vars          # set ENVIRONMENT=development (skips staff auth locally)
npm run db:migrate && npm run db:seed   # local D1
npm run dev                             # builds the site, then wrangler dev on http://localhost:8787
npm run dev:web                         # optional: Astro hot reload on :4321, proxies /api → :8787
npm test                                # coupon, tax, tip and Clover unit tests
npm run cron:local                      # run the cron handler once against wrangler dev
```
`wrangler dev` serves the `web/dist` it found at startup. After `npm run build`, restart it.

**Before you finish a change:** `npm test`, `npm run build`, and a smoke test of `/`, `/order/` (place an order) and `/staff/` (see it arrive, mark it completed) and `/pos/`.

**Deploying = `npm run deploy`** (`scripts/deploy.sh`). It refuses uncommitted changes (`ALLOW_DIRTY=1` overrides), runs the tests, builds, backs up D1 to `backups/` and applies migrations **only when some are pending**, deploys with the git sha as the version tag, then smoke tests the public pages and checks that `/api/staff/orders` is **not** public. `npm run deploy:status` shows versions, secrets and migrations. `npm run deploy:rollback` restores the previous code version only (never D1), so **migrations must be additive**: the old code must still run on the new schema.

Credentials: `.deploy.env` (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, optional `DEPLOY_URL`), or `npx wrangler login`. Secrets: `.prod.vars`, sent with every deploy. Empty lines keep the value already in Cloudflare, and names outside the script's `SECRET_NAMES` list are rejected. Both files are git-ignored.

**First production deploy (checklist):**
1. Fill in `.deploy.env`, then `npm run deploy:setup`. It finds or creates `jadegarden-db`, writes its id into `wrangler.jsonc` (and commits it), generates `SESSION_SECRET` in `.prod.vars`, and deploys. The site is live on `jadegarden.<subdomain>.workers.dev`.
2. Secrets: fill in `.prod.vars` (`WC_*`, `TURNSTILE_SECRET_KEY`, `CLOVER_*`, and `FACEBOOK_APP_SECRET` if Facebook is used), then `npm run deploy`.
3. Cloudflare Zero Trust → three Access applications on `<host>`: **Kitchen** (`/staff`, `/api/kitchen`), **POS** (`/pos`, `/api/pos`), **Admin** (`/jadmin`, `/api/admin`). Policies reference Access groups (**Kitchen staff**, **POS staff**, **Admins**): Kitchen allows Kitchen staff + Admins, POS allows POS staff + Admins, Admin allows Admins only. Login method: One-time PIN. Put the team domain in `ACCESS_TEAM_DOMAIN` and each application's AUD in `ACCESS_AUD_KITCHEN` / `ACCESS_AUD_POS` / `ACCESS_AUD_ADMIN`. Until then that role's API refuses every request. Adding or removing a person = edit the group (Zero Trust → Access controls → Access groups), no deploy.
4. Turnstile widget (hostname = the deploy host) → `TURNSTILE_SITE_KEY` var plus the secret.
5. Clover: set `CLOVER_MERCHANT_ID` (the 13-character merchant UUID, **not** the numeric processor MID) and `CLOVER_ENV` in `wrangler.jsonc`. In the Clover Merchant Dashboard → Ecommerce → Hosted Checkout, set the webhook URL `https://<host>/api/webhooks/clover`, click Generate, and store the Signing Secret as `CLOVER_WEBHOOK_SECRET`. Keep Clover's own tipping **off**. Test with a real card for $1 worth of food, then refund it in Clover.
6. WooCommerce webhook (**optional**): the cron already pulls new and changed orders every minute, so the kitchen sees them within about a minute. A webhook only makes that instant: Settings → Advanced → Webhooks, "Order created" and "Order updated" → `https://<host>/api/webhooks/woocommerce`, using the same secret as `WC_WEBHOOK_SECRET`. Skipped for now.

`<host>` is `w2.mjjadegarden.com` during dual-run (custom domain in `wrangler.jsonc` `routes`). `workers_dev` and preview URLs are **off**: Access cannot protect workers.dev, so w2 is the only public host. Access uses the one-time PIN identity provider; users are managed through the three Access groups. The Cloudflare token lives in the environment as `CF_ACCOUNT_TOKEN` / `CF_ACCOUNT_ID` (mise); `scripts/deploy.sh` maps them to `CLOUDFLARE_*`. Clover runs in **sandbox** (`CLOVER_ENV`, test cards only) until cutover. Clover's return URL follows the request's own origin, so the site works on any host. Moving to a new host means updating the Access application, the Turnstile hostnames and both webhook URLs.

---

## 11. Cutover plan

1. **Now (dual-run):** the Worker runs on `w2.mjjadegarden.com`, with Clover in sandbox. Staff use `/staff/` (kitchen) and `/pos/` (phone orders); managers use `/jadmin/`. WordPress keeps taking customer orders, which flow in through the cron (`WC_STORE_URL` is `https://www.mjjadegarden.com`; the apex was rate limited with 429 by Hostinger while proxied). Historic WooCommerce orders were imported once: everything before the import day is `completed`, because the old system never set statuses.
2. **Owner review:** the owner checks the website copy, hours, menu prices, privacy policy and photos. Place real test orders.
3. **Cutover:** switch `CLOVER_ENV` to `production` with the live merchant id and keys, then attach the custom domains `mjjadegarden.com` and `www` to the Worker (`routes` in `wrangler.jsonc`). `_redirects` maps the old WordPress URLs.
4. **After cutover:** remove the WooCommerce part of `scheduled()` (keep the cron: it expires unpaid Clover checkouts), `worker/services/woocommerce.js`, `routes/webhooks.js` and the WC secrets. Then shut down WordPress. Optionally import past WooCommerce customers into `customers` with `marketing_opt_in = 0`.

---

## 12. Open items / backlog (priority order)

1. **Rotate the WooCommerce API key** (`ck_4376…` was committed in git history and is still active). Create a new **read-only** key and delete the old one in WordPress.
2. Production setup per §10 (D1 id, secrets, Access, Turnstile, Clover). The Clover keys in `.env` were rejected (401) on 2026-10-19: `CLOVER_MERCHANT_ID` is the 11-digit processor MID, but the API needs the 13-character merchant UUID. Until Clover works, production refuses web orders (503).
3. Owner content review: photos for the 67 dishes that still have none (only 48 of 115 had product photos on the old site; see §4a), dish descriptions in `data/menu.json` (add a `description` field), and confirmation of hours, delivery area and privacy text.
4. Order-taking guards: reject web orders outside take-out hours or on Mondays, and add an optional "schedule for later" time.
5. Refunds: done by hand in the Clover dashboard today. If staff cancel a paid order, they must refund it in Clover (the kitchen "cancel" does not refund).
6. Customer notifications: order confirmation email, subscriptions and coupon campaigns (plan in `TODO.md`), plus optional SMS when an order is ready.
7. Caller ID: USB caller-ID modem (landline) on the counter PC + a tiny local script that opens `/pos/#call=<number>` (see §6a).
8. Kitchen printing: a LAN print bridge to the ESC/POS printer (see `docs/architecture_and_guide.md`).
9. Passwordless email sign-in (magic link) and a simple `/account/` page with order history.
10. Move the menu into D1 plus a staff menu editor, only once the owner wants to edit prices without a deploy.
