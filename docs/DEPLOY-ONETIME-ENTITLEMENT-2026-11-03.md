# One-time purchase entitlement — deploy & verify (2026-11-03)

Branch: `feat/one-time-entitlement` · base: trunk `5953848` · **not deployed, not
merged** — the lead merges, then we deploy together.

## What was broken (all three verified against the live account/repo, not assumed)

1. **The price map pointed at the wrong Stripe account.**
   `src/services/entitlement.ts` mapped `price_1U3SEFBbnDObsY4ujb2zxBSs`,
   `price_1U3SEKBbnDObsY4usDGDFNPQ`, `price_1U3SEKBbnDObsY4uVrnJDIyg` — labelled
   "USD plans / Monthly / Yearly". Queried with the key in this repo's `.env`
   (account `acct_1TwZkiBbnDObsY4u`, AU, default currency AUD) those three IDs
   resolve, and that account's **six active prices are all `recurring`**. The
   three IDs the app actually sends (`price_1TwbqH…`) answer **"No such price"**
   to that key. So the map could never label a purchase made by the app.
2. **`checkout-handler.ts` rejected the app's real price IDs.**
   Its `VALID_PRICE_IDS` allowlist held the same three `price_1U3SE…` ids, so
   every upgrade tap got `400 Invalid price ID` before Stripe was called — and
   the session was created with `mode: "subscription"`, which Stripe refuses for
   a `one_time` price.
3. **The webhook threw one-time payments away.**
   `if (session.mode !== "subscription") break; // one-time payments don't create
   entitlements`. A real purchase answered `200 {"received":true}` and unlocked
   nothing. `/api/entitlement` could only ask the `subscriptions` table, which a
   one-time purchase can never populate.

## What this branch changes

| File | Change |
|---|---|
| `src/services/live-prices.ts` (new) | The three live one-time AUD prices and their tier words, as pure data (no DB import, safe for a route component). Derived `PLAN_BY_PRICE_ID` / `PRICE_ID_BY_AMOUNT`. **Unknown price id → `null`**, never a silent `"pro"`. |
| `src/services/entitlement.ts` | Re-exports the price table; adds `purchases` access (`getPurchase`, `recordPurchase`, `hasPurchase`), `hasProEntitlement`, and `getEntitlement` (purchase **or** subscription). `handleEntitlement` now returns `{pro, plan, currentPeriodEnd, source}` — `source` is additive. Subscription branch unchanged. |
| `src/services/webhook-handler.ts` | Signature verification split from decision logic: `handleStripeEvent(event, deps)` is callable with a constructed event. New `mode === "payment"` branch: grants only when `payment_status === "paid"`, device from `metadata.device_id` → `client_reference_id`, records the purchase, emits `purchase_complete`. Duplicate delivery → no second row, no second event. |
| `src/services/events-handler.ts` | `SERVER_EVENT_NAMES = ["purchase_complete"]`; `recordServerEvent()` writes it server-side. `handleEvents` still validates against the nine **client** names only, so no client can forge a purchase. |
| `src/services/checkout-handler.ts` | Allowlist = `LIVE_PRICE_IDS`; `mode: "payment"`; sets `metadata.price_id` as well as `metadata.device_id` + `client_reference_id`. |
| `src/services/recognize-handler.ts` | Free-tier cap is lifted by `hasProEntitlement` (purchase **or** subscription), not subscription-only. |
| `src/db/migrations/007_purchases.sql`, `scripts/migrate-purchases-table.ts` (new) | `purchases` table. `stripe_session_id text NOT NULL UNIQUE` — idempotency enforced by the schema, not a read-then-write. |
| `src/routes/api/create-checkout-session.tsx` | Doc page renders the price list from `live-prices.ts` instead of hardcoding the dead ids. |
| `src/services/webhook-handler.test.ts` (new), `tsconfig.onetime-check.json` (new) | 30 tests + targeted type-check config. |

`purchase_complete` props (flat primitives, inside the events endpoint's own
limits): `{ tier, price_id, amount_total, currency, mode }`. A purchase with an
unresolvable price stores `plan = NULL` and emits `tier: "unknown"` — the device
is pro and we say the tier is unknown rather than inventing one.

## Deploy — in this order

1. **Migration first** (the webhook writes to the table; a missing table means a
   500 and Stripe retries forever):
   ```
   cd site-fresh && DATABASE_URL='<prod url>' bun scripts/migrate-purchases-table.ts
   ```
   Idempotent. It prints the real columns and indexes and exits 1 if
   `purchases`, `UNIQUE(stripe_session_id)` or the device index is missing.
2. **Merge to trunk and deploy** (site-fresh trunk → Vercel, per the usual
   `DEPLOY-*.md` procedure).
3. **Stripe dashboard, LIVE account — the one that owns `price_1TwbqH…`:**
   Webhooks → the endpoint for `https://notesnap.app/api/stripe-webhook` must
   exist and subscribe to **`checkout.session.completed`** (plus
   `customer.subscription.updated` / `customer.subscription.deleted` for the
   dormant subscription branch). Its signing secret must be the value of
   `STRIPE_WEBHOOK_SECRET` in Vercel. **Without this, purchases are charged and
   never recorded.** This is the one step that cannot be verified from here.

## Verify after deploy

- `GET https://notesnap.app/api/entitlement?device=<uuid>` returns
  `{"pro":false,"plan":null,"currentPeriodEnd":null,"source":null}` for a fresh
  device (the `source` key is the new one; the old three fields are unchanged).
- `POST /api/stripe-webhook` with no signature still answers `400
  {"error":"Missing Stripe signature."}` (verified live 2026-11-03 on both
  `site-notesnap.vercel.app` and `notesnap.app`).
- **One real $4.99 purchase** (owner action; nothing has ever been purchased):
  1. in the app, tap upgrade → Stripe Checkout shows **$4.99 AUD one-time**;
  2. pay with a real card;
  3. `SELECT device_id, stripe_session_id, plan, amount_total, currency FROM purchases ORDER BY created_at DESC LIMIT 5;`
     → one row, `plan = 'NoteSnap Pro'`, `amount_total = 499`, `currency = 'aud'`;
  4. `SELECT name, install_id, props FROM events WHERE name = 'purchase_complete' ORDER BY id DESC LIMIT 5;`
     → exactly **one** row for that session;
  5. the same `GET /api/entitlement?device=<that device>` now returns
     `pro: true, plan: "NoteSnap Pro", source: "purchase"`;
  6. re-send the same webhook event from the Stripe dashboard ("Resend") →
     still one purchase row, still one event row, and the response says
     `"outcome":"duplicate"`.
- Refund path (not built): a refund or chargeback does **not** revoke a
  purchase row today. That is a deliberate gap to decide on, not an oversight —
  see the open question below.

## Open question for the lead — which Stripe account is live?

The three price IDs the app sells (`price_1TwbqH…`) do **not** exist on the
account whose key is in this repo's `.env` (`acct_1TwZkiBbnDObsY4u`). Either the
owner has two accounts (likely: a `1Twbq…` object-prefix account holding the
one-time AUD prices, and this `1TwZk…`/`1U3SE…` one holding the older recurring
USD/AUD prices), or the `.env` key is stale. Consequences:

- If **Vercel's** `STRIPE_SECRET_KEY` is the `.env` one, `checkout.sessions.create`
  will fail with *"No such price"* for every upgrade tap even after this branch
  ships. Check the Stripe dashboard's account id against Vercel's env before the
  first real purchase attempt.
- The subscription branch keeps working either way — it only ever sees the
  account that sends the events.

## Rollback

`git revert` the merge commit and redeploy; the `purchases` table is additive and
can stay (nothing reads it until this code is live). No data migration to undo.

## Gate evidence (this branch)

- `bun test --timeout 60000` → **24 files / 399 tests, 388 pass, 11 skip
  (opt-in live), 0 fail**, EXIT=0. Base `5953848` was 23 files / 369 tests, so
  this adds one file and 30 tests and breaks nothing.
- `npx tsc -p tsconfig.onetime-check.json` → EXIT=0 (the new test file is not in
  that config: `bun:test` types are not installed in this repo, and `bun test`
  compiles it at runtime).
- Mutation probes, both bite:
  - delete the `if (!inserted) return {outcome:"duplicate"}` guard → the
    duplicate-delivery test fails with `outcome: "purchase-recorded"`;
  - replace `if (session.payment_status !== "paid")` with `if (false)` → the
    unpaid-completion test fails. Both reverted; `cmp` against the pre-probe copy
    is identical and no `MUTATION PROBE` string remains.
