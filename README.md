# Sufra — سفرة

NFC + QR restaurant ordering platform for Saudi Arabia. Multi-tenant SaaS:
one deployment serves many restaurants, each seeing only its own data.

A diner scans the QR code or taps the NFC tag on their table, browses a
bilingual menu with photos, builds an order and sends it to the waiter. The
waiter confirms it, the kitchen cooks it, and the bill is settled at the
cashier.

```
React 18 · TypeScript · Vite · Tailwind · React Router · i18next · Recharts
Supabase (Postgres + Auth + Storage + Realtime)
```

---

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in your Supabase URL + anon key
npm run dev
```

Until `.env.local` is filled in, the app shows a setup screen rather than
failing with opaque network errors.

### 1. Create the database

In the Supabase dashboard → **SQL Editor**, run the four migrations **in
order**:

| File | What it does |
| --- | --- |
| `supabase/migrations/0001_schema.sql` | Tables, enums, indexes, triggers, realtime publication, storage bucket |
| `supabase/migrations/0002_rls.sql` | Row Level Security: every policy and privilege grant |
| `supabase/migrations/0003_functions.sql` | The server-side business logic (pricing, prize draws, reports) |
| `supabase/migrations/0004_seed.sql` | Pricing plans + one demo restaurant you can delete |

Or with the Supabase CLI:

```bash
supabase db push
```

### 2. Create your accounts

Creating an auth user requires the `service_role` key, which must never appear
in a browser bundle — so accounts are created in Supabase Auth and linked to a
role in the database.

**Super admin** — Dashboard → Authentication → Users → *Add user*, then:

```sql
insert into public.profiles (id, restaurant_id, full_name, role)
values ('<auth-user-uuid>', null, 'Platform Owner', 'super_admin')
on conflict (id) do update set role = 'super_admin', restaurant_id = null;
```

**Restaurant owner** — add another user, then:

```sql
insert into public.profiles (id, restaurant_id, full_name, role)
select '<auth-user-uuid>', id, 'Owner', 'restaurant_admin'
from public.restaurants where slug = 'najd-grill'
on conflict (id) do update
  set role = 'restaurant_admin', restaurant_id = excluded.restaurant_id;
```

After that, staff are added from **Admin → Staff**, which links an existing
auth user to a role. If you invite users through Supabase Auth instead, put
`restaurant_id` and `role` in the invite metadata and the `handle_new_user`
trigger provisions the profile automatically.

### 3. Open it

| URL | Who |
| --- | --- |
| `/` | Marketing page and pricing |
| `/r/najd-grill/t/1?k=<qr_token>` | A diner at table 1 |
| `/signin` | Staff and platform sign-in |
| `/admin` | Restaurant owner / manager |
| `/waiter` | Waiter and cashier |
| `/kitchen` | Kitchen display |
| `/platform` | Super admin |

The `k` parameter is the table's `qr_token`. Get a working link from
**Admin → Tables & QR → QR code → Copy link**, or:

```sql
select 'http://localhost:5173/r/' || r.slug || '/t/' || t.code || '?k=' || t.qr_token
from restaurant_tables t join restaurants r on r.id = t.restaurant_id
where r.slug = 'najd-grill' order by t.code;
```

---

## Security model

The guiding rule: **the browser sends intent, never money.** A diner is an
anonymous visitor with no account, so nothing they send can be trusted.

### Prices and discounts are computed in Postgres

`place_order()` receives only which item, how many, which options and an
optional coupon code. It re-reads every price from `menu_items`, re-reads every
modifier delta from `modifier_options`, validates that each chosen option
actually belongs to that dish, enforces the min/max selection rules, applies
the coupon through `validate_coupon()`, and computes VAT itself.

A request claiming `"unit_price": 1` for a 62 SAR dish produces a 62 SAR line.
There is a test for exactly that.

### Guests cannot write to the database directly

`anon` holds no `INSERT`/`UPDATE`/`DELETE` privilege on any table except
`favorites`. Orders, service requests, reviews, game plays and reward
redemptions all go through `SECURITY DEFINER` functions that validate and rate-
limit them. This is enforced by privilege revocation, not only by the absence
of a policy.

### Prize odds are not in the client bundle

`anon` cannot read `game_prizes` at all. `spin_wheel()` performs the weighted
draw in the database and returns the winning segment index; the wheel animation
is then aimed at that segment. Patching the JavaScript changes how the spin
looks, not what is won. Same for trivia: `correct_index` is revoked at the
column level, and answers are graded by `check_trivia_answer()`.

### Tenant isolation

Every table carries `restaurant_id` and every policy is fenced through three
`SECURITY DEFINER` helpers — `auth_restaurant()`, `has_role()`,
`is_super_admin()` — which read `profiles` without recursing into its own
policy. A manager at one restaurant cannot read another's orders, loyalty
data, QR tokens or sales reports, and cannot rotate another's table token.
`sales_report()` and `platform_stats()` check authorisation themselves rather
than trusting the caller's argument.

### QR codes and NFC tags

Each table's link carries a random `qr_token`:

```
/r/<slug>/t/<code>?k=<qr_token>
```

`resolve_table()` requires it, so a guessed `/r/slug/t/7` opens nothing. If a
code is photographed and posted online, **Admin → Tables → Regenerate code**
mints a new token; the old printed code stops working immediately.

### Duplicate orders

Two layers. An `idempotency_key`, unique per restaurant, means a double tap or
a retried submit returns the *original* order rather than creating a second
one. Separately, an identical cart from the same session inside 45 seconds is
rejected as a resubmission. The client regenerates the key only after a
successful submit or a change to the cart.

### Role-gated status transitions

A trigger on `orders` enforces who may move an order where, and which moves are
legal at all — so the rule holds whether the update came from the waiter board,
the kitchen board or a hand-rolled API call. The kitchen cannot confirm an
order; a waiter cannot skip a `confirmed` order straight to `paid`; an owner or
manager can override. The trigger also stamps the timeline and refuses to let
anyone but a manager alter a settled total.

### Subscription enforcement

`restaurant_is_live()` gates every guest-facing policy and RPC. When the
platform suspends a tenant or its trial lapses, its menu becomes invisible and
its QR codes stop taking orders — immediately, without a deploy. A tenant
cannot change its own `plan_id`, `subscription_status`, `trial_ends_at` or
`slug`: a trigger silently reverts those columns for anyone who is not a super
admin.

### Known trade-off

For the live status screen, `anon` can `SELECT` orders from the last 12 hours,
narrowed by a **column-level grant** that excludes `customer_name` and
`customer_phone`. Totals and statuses for today's orders at that restaurant are
therefore technically readable by anyone who scanned a code there; contact
details are not. The stronger design is a short-lived JWT minted per table scan
carrying a `table_id` claim, with the policy comparing against that claim. That
needs an Edge Function to sign tokens and is the first thing to add if this
matters for your deployment.

---

## Testing

The database layer — where all the security and money logic lives — has a real
test suite that runs against a throwaway Postgres instance:

```bash
# needs a local Postgres (any version 14+) you can create databases on
PGHOST=/var/run/postgresql ./supabase/run_local_tests.sh
```

83 assertions covering, among others:

- a forged `unit_price` is ignored and the database price is used
- VAT is extracted correctly from a VAT-inclusive total
- a replayed idempotency key returns the original order, creating no duplicate
- required modifier groups, max-select limits, and options borrowed from a
  different dish
- a menu item from another tenant cannot be ordered at this table
- coupon minimums, expiry, exhaustion and per-session limits
- 400 wheel spins land within the configured weight distribution, and a second
  spin in the same session is refused
- trivia questions are served without the answer key
- the kitchen cannot confirm an order; `confirmed → paid` is refused; the
  timeline and actor are stamped
- loyalty points accrue on payment, at the configured rate
- `anon`, a waiter, a rival tenant's admin and a super admin each see exactly
  what they should — and nothing more

`supabase/_test_shim.sql` recreates the Supabase-specific pieces (the `auth`
schema, the `anon`/`authenticated` roles, `storage`) so the migrations run
verbatim against plain Postgres. **Never run the shim against a real project.**

Front-end checks that need no `node_modules`:

```bash
node scripts/syntaxcheck.mjs   # parses every .ts/.tsx file
node scripts/verify.mjs        # see below
```

`verify.mjs` checks what a syntax pass misses and a runtime would only reveal
in front of a diner: that every `t('…')` key exists, that Arabic and English
have identical key sets, that every local import resolves, that every Tailwind
colour shade is defined, that every table, column and `.rpc()` name referenced
in code exists in the migrations, and that every RPC parameter name matches the
function signature.

And the real thing, once dependencies are installed:

```bash
npm run typecheck
npm run build
```

---

## Project layout

```
supabase/
  migrations/           0001 schema · 0002 RLS · 0003 functions · 0004 seed
  _test_shim.sql        local-only Supabase stand-in
  _test_rpcs.sql        business-logic tests
  _test_rls.sql         access-control tests
  run_local_tests.sh
scripts/
  syntaxcheck.mjs       parses all sources without node_modules
  verify.mjs            keys, imports, colours, schema, RPC signatures
src/
  lib/
    supabase.ts         client + configuration guard
    types.ts            every row and RPC payload shape
    i18n.ts             locale detection, <html dir> switching
    useLocale.ts        one hook for locale + all formatters
    format.ts           money, dates, elapsed time, CSV — locale-aware
    session.ts          anonymous guest id, idempotency keys
    qr.ts               table URLs, QR PNG/SVG, Web NFC, printable sheet
    useMenu.ts          menu loading, realtime availability, favourites
    useRows.ts          tenant-scoped CRUD over one table
    useChime.ts         synthesised alert tone for the staff boards
  locales/              en.ts · ar.ts  (640 keys, kept in lockstep by verify.mjs)
  store/
    auth.tsx            session, profile, role helpers
    cart.tsx            per-table cart, persisted in localStorage
    guest.tsx           resolves a scan into a restaurant + table
  components/
    ui/index.tsx        buttons, fields, modal, toasts, badges, confirm
    ImageUpload.tsx     downscales in-browser, uploads to the tenant's folder
    LanguageToggle.tsx · RequireRole.tsx · SetupNotice.tsx
  pages/
    customer/           GuestShell · Menu · ItemSheet · Cart · Orders
                        More · Games · Loyalty · Review
    admin/              Layout · Overview · Orders · Menu · Categories
                        Tables · Staff · Marketing · Games · Loyalty
                        Reviews · Reports · Settings
    staff/              WaiterBoard · KitchenBoard
    super/              Layout · Overview · Restaurants · Plans · Subscriptions
```

---

## Arabic and RTL

Arabic is the default. The whole interface is built with CSS logical properties
(`ms-*`, `me-*`, `ps-*`, `text-start`, `start-0`) rather than left/right, so
setting `<html dir="rtl">` mirrors everything without a second stylesheet.
Directional icons carry `.flip-rtl`.

Beyond mirroring: numerals render in Arabic-Indic digits for Arabic and Latin
for English via `Intl.NumberFormat`; Recharts axes reverse so charts read
right-to-left; every content row has `name`/`name_ar` columns and `pick()`
falls back to the base language when a translation is missing; forms keep
individual fields LTR where the content demands it (phone numbers, URLs,
coupon codes) while the layout stays RTL. Arabic gets its own font stack and a
looser line height.

A restaurant sets its own default language; a guest's own choice is remembered
and never overridden.

## Saudi specifics

- VAT at 15%, configurable per restaurant, and **extracted** from VAT-inclusive
  menu prices by default — which is how menus are priced in the Kingdom —
  rather than added on top. Both modes are supported.
- VAT registration number and commercial registration number on the restaurant
  record, ready for receipt printing.
- Optional service charge, applied after discount and before VAT extraction.
- Riyal formatting with `ر.س` in Arabic and `SAR` in English.
- Snapchat and TikTok alongside Instagram and WhatsApp.

---

## Deployment

Any static host. The app is a SPA, so **all routes must fall back to
`index.html`** or a scanned QR link will 404.

```bash
npm run build     # → dist/
```

**Vercel** — zero config; `vercel.json` with a catch-all rewrite if needed.
**Netlify** — add `_redirects` containing `/*  /index.html  200`.
**Nginx** — `try_files $uri $uri/ /index.html;`

Set `VITE_PUBLIC_BASE_URL` to your real domain before generating QR codes, or
the printed codes will point at localhost. Changing it later means reprinting.

Web NFC writing from the admin screen needs Chromium on Android over HTTPS.
Everywhere else the screen shows the URL for a third-party tag writer, which is
how most venues will tag tables anyway. Use NTAG213 or later, write the link as
a URL record, and lock the tag afterwards.

### Opening Lovable

This is a standard Vite + React project, so it imports cleanly:

1. `git init && git add . && git commit -m "Initial commit"`
2. Push to a GitHub repository
3. In Lovable, create a project from that repository
4. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
   `VITE_PUBLIC_BASE_URL` as environment variables
5. Connect the same Supabase project

The migrations are plain SQL and belong in the Supabase SQL editor either way.

---

## What is built

**Customer** — QR/NFC table identification with token validation · bilingual
menu with photos, categories, search, popular and favourites · item
customisation with required and multi-select option groups · cart persisted per
table · order submission with duplicate protection · live order status over
Realtime with a polling fallback · call waiter / request bill / ask for water,
throttled · spin-the-wheel and food trivia · loyalty balance by phone and
reward redemption · reviews with a Google link shown only after a positive
rating · social links, Google Maps, offers strip.

**Restaurant admin** — live overview with revenue, open orders and table
requests · order management with role-aware actions · menu CRUD with in-browser
image downscaling and a full modifier editor · category ordering · tables with
QR download, printable sheet, Web NFC writing and token rotation · staff and
roles · offers and discount codes · prize wheel with visible odds and trivia
authoring · loyalty rewards, member list and manual point adjustments with an
audit row · reviews with replies and moderation · reports with CSV export ·
settings covering brand, contact, VAT, ordering behaviour and feature toggles.

**Waiter** — three-tab board of orders to confirm, orders in progress and table
requests · tickets that redden as they age · a synthesised chime for genuinely
new tickets, primed on first load so a shift does not start with a burst of
alerts · one-tap confirm, serve and settle.

**Kitchen** — three-column ticket rail for a wall-mounted tablet, large type,
all-day dish counts, age-coloured tickets, one tap to advance.

**Super admin** — platform stats and MRR · restaurant provisioning that creates
a branch, a starter menu skeleton, tables and a configured prize wheel in one
call · plan, status and trial management · a payments ledger that also moves the
tenant's live subscription window.

## What is not built

Honest list, so nothing here surprises you:

- **Payment processing.** Deliberate: the brief specifies payment at the
  cashier. The subscription screen records payments you have collected; it does
  not take them. Wiring Moyasar, Tap or HyperPay for *platform* billing is the
  natural next step.
- **ZATCA e-invoicing.** VAT is calculated and the registration numbers are
  stored, but Phase 2 Fatoora compliance (signed XML invoices, QR-coded
  receipts, cryptographic stamps) is a separate integration.
- **Automated subscription expiry.** `restaurant_is_live()` enforces the dates
  correctly on every request, but nothing flips a lapsed tenant's status to
  `past_due` on a schedule. A `pg_cron` job is a few lines.
- **Push notifications.** The staff boards use Realtime plus an in-page chime,
  which needs the tab open. Web Push would survive a locked tablet.
- **Multi-branch UI.** The schema models branches and every order and table
  carries `branch_id`, so the data is ready; the dashboards do not yet offer a
  branch switcher.
- **Automated front-end tests.** The database logic is covered properly. The
  React layer has static verification but no component or end-to-end tests —
  Playwright against a seeded Supabase project is the obvious addition.
