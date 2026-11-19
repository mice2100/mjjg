# Jade Garden — Technical Guide

Deep-dive notes that don't belong in AGENTS.md. AGENTS.md wins if they disagree.

---

## 1. Staff app (`web/public/staff/index.html`)

A single vanilla HTML/CSS/JS file optimised for an iPad mini (it also works on a PC or the kitchen screen). It loads the menu from `/api/menu` and streets from `/api/streets`, and talks only to `/api/staff/*`.

### 1.1 Views
- **Orders dashboard (kitchen board):** the left column lists orders (filter: All / Pending / Completed) with source badges (Web, WooCommerce, Phone, Walk-in) and pickup/delivery badges. The right panel shows the selected order: customer, tap-to-call phone, delivery address card with copy button, time slot, notes, items, bill breakdown (discount, delivery fee, tip, tax, total), *Mark as Completed* and *Print*.
  - Polls `GET /api/staff/orders` every 15 s. That call only reads D1, so polling is cheap.
  - Orders not seen before that are `pending` trigger a two-note Web Audio chime and a toast. Sound can be toggled off and tested. Browsers need one tap first to unlock audio.
  - Status changes go to `PATCH /api/staff/orders/:id`, with an optimistic UI update that reverts if the request fails.
- **New order (phone POS), two stages:**
  1. **Menu and cart:** fuzzy search (§2), category tabs, quantity controls.
  2. **Confirm and delivery modal:** source (Phone / Walk-in), name, phone, pickup or delivery, Moose Jaw street autocomplete (§3), apt/suite, time, and notes with frequency-ranked quick tags.
  - *Submit* → `POST /api/staff/orders` with `{id, qty}` items only. The server prices the order and returns `ORD-####`. If saving fails, the cart is kept and staff can retry.

### 1.2 Security notes
- All customer text is HTML-escaped by `sanitizeOrder()` before any `innerHTML` rendering. Web customers can type anything into name, notes and address fields.
- Access is enforced by Cloudflare Access at the edge and by the Worker (`worker/auth/staff.js`).

---

## 2. Fuzzy menu search (VS Code / Zed style)

Typing speed matters on a phone call, so search uses subsequence matching with scoring:

1. **Code prefix first:** `b3` → *B3 Beef with Sugar Pea* scores highest. `b` lists B1–B9 first.
2. **Greedy subsequence match** over the name. For example, `wonsoup` matches **W**o**n**ton **Soup**.
3. **Scoring:**
   - Contiguous substring hit: +200.
   - Word-boundary character (after space, `-`, `(`, `.`): +15.
   - Consecutive characters: +10 each.
   - Gaps: −1 to −5.
   - An earlier start scores higher.
4. Each matched character is wrapped in `<mark>` so staff can confirm the match at a glance.

## 3. Moose Jaw street autocomplete

- `data/moose_jaw_streets.json` holds ~300 street names. Edit this file to add new subdivisions.
- House number and street are separated, so `740 that` keeps `740` and matches **That**cher Drive East/West.
- Abbreviations are normalised: `4th ave nw` → *4th Avenue Northwest*, `caribou w` → *Caribou Street West*.
- Keyboard navigation (↑/↓/Enter). After a street is picked, focus jumps to the Apt/Suite field.

---

## 4. Kitchen printer (hardware recommendation)

- **Buy:** Epson **TM-T88VI / TM-T88VII** (or Star Micronics **TSP143III LAN**). It **must be the Ethernet/LAN model**.
- **Why LAN:** the printer gets a fixed IP (e.g. `192.168.1.200`) and can be shared. The SkipTheDishes tablet pairs with it directly, and our system can send raw ESC/POS to port **9100**. The printer queues jobs, so the two never conflict.
- **Not built yet (backlog):** a small print bridge on the restaurant LAN (Node or Python) that polls `/api/staff/orders` (with an Access service token) and prints new orders. Until then, staff use *Print* in the browser.

---

## 5. WooCommerce import (transition only)

- `worker/services/woocommerce.js` maps WooCommerce orders to D1 rows (`WC-<id>`, source `WooCommerce`):
  - Delivery vs pickup comes from `meta_data.exwfood_order_method`, the time slot from `exwfood_time_deli` / `exwfood_timeslot`, and fees from `fee_lines` ("Shipping fee" = delivery, "Show your appreciation" = tip).
  - Status mapping: processing / on-hold → `pending`; completed → `completed`; cancelled / refunded / failed → `cancelled`. Unpaid `pending` and `checkout-draft` orders are skipped.
- **Webhook** (instant) and **cron** (every minute, `modified_after` cursor in `sync_state`) share one idempotent upsert.
- Debug with `python3 -I tools/wc_inspect.py [orderId]`. It reads `.env`.

---

## 6. Domain cutover SOP

1. Deploy the Worker, then verify `/`, `/order/` and `/staff/` on the `workers.dev` URL.
2. Run the old site and the new kitchen board side by side for a few days. Confirm every WordPress order appears as `WC-…` within a minute.
3. Get owner sign-off on content (menu, prices, hours, photos, privacy policy).
4. Cloudflare dashboard → Workers → `jadegarden` → **Domains & Routes** → add `mjjadegarden.com` and `www.mjjadegarden.com`. Cloudflare issues the certificates.
5. Update the Access application and Turnstile widget hostnames to the real domain.
6. Watch orders for a day, then remove the WooCommerce sync (AGENTS.md §11) and shut down WordPress hosting.
