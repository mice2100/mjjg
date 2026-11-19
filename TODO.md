# TODO

## Email: order confirmations, subscriptions, coupon campaigns

**Current state (2026-10-19):** the site sends no email at all. Checkout requires an email with the hint
"For your order confirmation." (`web/src/pages/order.astro`), but no confirmation is ever sent. The
marketing checkbox stores consent in `customers.marketing_opt_in`, but there is no way to unsubscribe and no
sending channel.

### Quick fix (if phase 1 is not done soon)

- [ ] Change the checkout email hint to "So we can reach you about your order." so customers don't wait
      for an email that never comes.

### Provider

- [ ] **Resend** (recommended): plain `fetch` from the Worker, no SDK needed. Free tier is about 3,000/month and
      100/day (check current pricing). That is enough for order confirmations. Campaigns to more than 100 people
      need the paid tier (about $20/month) or must be spread over several days.
- Alternative: Cloudflare Email Service (tightest Worker integration). Check whether it is generally
  available before choosing it.
- [ ] Sign up, verify the sending domain, and put `RESEND_API_KEY` in `.dev.vars` / `.prod.vars` (add it to
      `SECRET_NAMES` in `scripts/deploy.sh`).
- [ ] DNS: send from a subdomain (e.g. `mail.mjjadegarden.com`) with SPF, DKIM and DMARC. This can be done
      before cutover and does not affect WordPress.

### Phase 1: order confirmation + unsubscribe

- [ ] `migrations/0003_email.sql`: add `orders.confirmation_sent_at` (prevents duplicate sends when Clover
      retries its webhook).
- [ ] `worker/services/email.js`: Resend wrapper. Templates are plain JS functions that return both html and
      text. English only.
- [ ] Send **when the order is paid** (Clover webhook), not when it is placed (`awaiting` orders may never be
      paid). Use `ctx.waitUntil` so the webhook stays fast.
- [ ] Cron safety net: retry orders that are `paid` with `confirmation_sent_at IS NULL` from the last few hours.
- [ ] Unsubscribe: `/api/email/unsubscribe?c=<customer_id>&t=<HMAC>`, signed with a new `EMAIL_SECRET`
      (no new table). GET shows a confirmation page. POST supports RFC 8058 one-click unsubscribe.
- [ ] Add `List-Unsubscribe` + `List-Unsubscribe-Post` headers (Gmail/Yahoo one-click requirement).
- [ ] Every email footer: restaurant name, address, phone and an unsubscribe link. CASL requires sender
      identification and an unsubscribe mechanism even on transactional mail, and unsubscribes must be processed
      within 10 business days.
- [ ] Keep promotional content out of transactional emails (that would make them commercial messages that
      need consent).
- [ ] Tests for token signing/verification and the "send once" logic. Update AGENTS.md (§5 API, §6 data model,
      §8, §10 secrets).

### Phase 2: double opt-in + welcome coupon

- [ ] Confirmation email includes "Confirm your subscription" when the customer ticked the marketing box.
- [ ] Clicking it records the confirmation (new column, e.g. `customers.marketing_confirmed_at`). Only
      confirmed subscribers get marketing email. Why: emails are typed by hand (typos, someone else's address),
      and under CASL the sender must prove consent.
- [ ] On confirmation, create a personal one-time coupon (e.g. `WELCOME-7K2F`, `max_redemptions = 1`,
      "$3 off your next order") and email it. Fits the existing `coupons` table, so no schema change is needed
      for this part.
- [ ] Update the checkbox copy to mention the incentive.
- [ ] Optional: footer "Get offers by email" signup form (Turnstile + double opt-in, since it is not tied to
      a purchase).

### Phase 3: coupon campaigns

- [ ] `tools/send_campaign.js`: read confirmed subscribers from D1, render a markdown template, and send through
      Resend's batch API with a personal unsubscribe link in every email. Supports a test send to ourselves
      first.
- [ ] D1 stays the only source of truth for subscription state (no syncing unsubscribes with Mailchimp or Brevo).
- [ ] Use coupons that fill slow days, e.g. `conditions_json: {"days_of_week":[2,3]}` for Tue/Wed.
- [ ] Frequency: at most 1–2 emails per month.
- Later, only if the owner wants to write and send emails themselves: a staff editor or Resend Broadcasts.

### Policy notes

- CASL also allows *implied* consent for customers who bought within the last 2 years. We deliberately email
  only express opt-ins (AGENTS.md §8), which keeps the list clean and protects deliverability.
