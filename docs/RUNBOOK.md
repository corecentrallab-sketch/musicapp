# NoteSnap — Operations Runbook & Independence Audit

**Owner directive 2026-08-12:** the app + API URL must work fully independently of the
cto.new platform. This runbook is the single source of truth for operating NoteSnap's
product infrastructure with **owner-held credentials only**. The agent team and the
cto.new preview URL (…ctonew.app) are *not* part of the product path and are not
required for anything documented here.

Verified against live systems on 2026-08-12 (see "Verification evidence" section).

---

## 1. Service map

| Service | Role in product | Owner account / org | Where credentials live | Recovery if lost |
|---|---|---|---|---|
| **Vercel** (project `site`, id `prj_j9hp8mOwIokZ5fFH8RqUgAgTTWOn`, team `notesnap` / `team_fecHrI8lrW60USwEfGPVJuzp`) | Hosts the public site + API (SSR, `/api/recognize`, `/api/create-checkout-session`, `/privacy`, `/terms`). Canonical production URL: **https://site-notesnap.vercel.app** (stable forever). | Owner's Vercel account (team "notesnap") | Vercel dashboard → Settings → Environment Variables (7 vars, all environments) + owner's password manager | Recreate project + re-add env vars; deploy with `bash go-live.sh` (below). Data lives in Neon/R2, not Vercel. |
| **Neon Postgres** (`DATABASE_URL`) | Piece catalog (519 pieces), sheet-music sources (489), recognition fingerprints. | Owner's Neon account | Neon dashboard (project → connection string); Vercel env var; site `.env`; owner's password manager | New connection string from Neon dashboard → update Vercel env var → redeploy. DB contents are the business data — keep Neon backups enabled. |
| **Cloudflare R2** (bucket `notesnapscores`) | Object storage: ~290 audio fingerprint files, sheet-music PDFs, cover art. | Owner's Cloudflare account | Cloudflare dashboard → R2 → bucket `notesnapscores`; Vercel env vars `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`; site `.env`; owner's password manager | Regenerate API token in Cloudflare → update Vercel env vars → redeploy. Re-upload objects from repo scripts (`scripts/upload-to-r2.ts`, ingest scripts). |
| **Stripe** (owner's own account, live key `sk_live_51TwZk…`) | Checkout: 3 payment links (marketing page) + server-side Checkout Sessions (`/api/create-checkout-session` with `STRIPE_SECRET_KEY`). Revenue. | Owner's Stripe account | Stripe dashboard → Developers → API keys; Vercel env var `STRIPE_SECRET_KEY`; site `.env`; owner's password manager | New restricted key in Stripe → update Vercel env var → redeploy. Prices/links are separate objects — they survive key rotation. |
| **Porkbun** (domain `notesnap.app`) | Brand domain; currently points at the Vercel site (or can be pointed at `site-notesnap.vercel.app` at any time). | Owner's Porkbun account | Porkbun dashboard → DNS records; owner's password manager | Recreate DNS records (CNAME/A to `site-notesnap.vercel.app`) — nothing else in the product path depends on the domain. |
| **GitHub** (`corecentrallab-sketch/musicapp`) | Source control for site + app (monorepo on GitHub, two working trees locally). PR workflow. | Owner's GitHub org `corecentrallab-sketch` | GitHub → Settings → Developer settings → tokens; `~/.data/.git-credentials` in the team sandbox; owner's password manager | New personal access token → add to password manager + sandbox credentials file. |
| **Expo / EAS** (project owner `notesnap`) | Cloud builds of the mobile app (`eas build`). | Owner's Expo account | Expo dashboard (expo.dev) → account; `EXPO_TOKEN` (if used, it is a convenience only — builds can log in interactively) | `npx eas login` interactively; or generate `EXPO_TOKEN` from Expo dashboard → account settings → tokens. |
| **Google Play / App Store** | Distribution of the app (in progress). | Owner's developer accounts | Store dashboards; owner's password manager | n/a (no product-path dependency). |

**What cto.new holds:** copies of the above tokens/secrets (its own sandbox env vars),
the `…ctonew.app` preview URL, and the agent team itself. **None of these are used by
the product path.** Every product service above is owned by the owner's own accounts.

---

## 2. Credential inventory checklist

Store every item below in the owner's password manager **and** keep the provider
dashboard copy live. The Vercel project env vars are the **canonical runtime source**
(the site's local `.env` is a convenience mirror, not the only copy — verified below).

| Credential | Used by | Canonical copies | Owner action |
|---|---|---|---|
| `VERCEL_TOKEN` | `go-live.sh` (deploys) | Vercel dashboard → Account → Tokens (create a new token any time; scope: team `notesnap`) | ✅ Save in password manager |
| `DATABASE_URL` | runtime DB access | Neon dashboard (project settings → connection string), Vercel env var, site `.env` | ✅ Save in password manager |
| `R2_ENDPOINT` | R2 storage | Cloudflare dashboard (R2 → bucket → S3 API), Vercel env var, site `.env` | ✅ Save in password manager |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 storage | Cloudflare dashboard → R2 → Manage API tokens, Vercel env vars, site `.env` | ✅ Save in password manager |
| `R2_BUCKET_NAME` (= `notesnapscores`) | R2 storage | Cloudflare dashboard, Vercel env var | ✅ Save |
| `R2_PUBLIC_URL` | public object URLs | Cloudflare dashboard, Vercel env var | ✅ Save |
| `STRIPE_SECRET_KEY` (`sk_live_51TwZk…`) | checkout + payment-link verification | Stripe dashboard → Developers → API keys (reveal live key), Vercel env var, site `.env` | ✅ Save in password manager |
| Stripe price IDs (USD) | checkout handler allowlist | `src/services/checkout-handler.ts`; Stripe dashboard → Products | ✅ Confirm present in Stripe (see §4) |
| Stripe payment links (USD) | marketing page | `src/routes/index.tsx` `PAYMENT_LINKS`; Stripe dashboard → Payment links | ✅ Confirm owner-account (see §4) |
| `EXPO_TOKEN` (optional) | `eas build` non-interactive | Expo dashboard → account settings → tokens | ⬜ Optional; interactive login also works |
| GitHub token | git push / PR | GitHub → Developer settings → tokens | ✅ Save in password manager |
| Porkbun DNS access | `notesnap.app` | Porkbun dashboard | ✅ Verify login works |

---

## 3. Owner-runnable redeploy (site + API)

Only one credential is required: `VERCEL_TOKEN`. All runtime secrets live in the
Vercel project (dashboard), which the deploy reuses automatically.

### 3a. Get a fresh Vercel token
1. Go to https://vercel.com/account/settings/tokens (logged in as the owner account / team `notesnap`).
2. **Create Token** → name it (e.g. `notesnap-deploy`), scope **notesnap** team, expiry of your choice.
3. Copy the token (shown once) into your password manager and the shell:

```bash
export VERCEL_TOKEN=<token>
```

### 3b. Deploy the site
On a machine with `git`, `bun`, and network access:

```bash
git clone https://github.com/corecentrallab-sketch/musicapp.git notesnap-site
cd notesnap-site
git checkout feat/sheet-music-curation   # the site's established working branch
export VERCEL_TOKEN=<token>              # required
# optional: export DATABASE_URL=...      # only if the Vercel dashboard env were ever
#                                        # missing it; normally NOT needed (verified)
bash go-live.sh
```

`go-live.sh` builds the Vercel bundle (`build-vercel.sh`), deploys with
`vercel deploy --prebuilt --prod`, and prints:
```
LIVE:   https://<deployment>.vercel.app
STABLE: https://site-notesnap.vercel.app   ← canonical URL, never changes
```
Because the deploy uses `--prod`, every deploy lands on **https://site-notesnap.vercel.app**.
No other platform input is required: scope/team are auto-resolved from the token, and
runtime env vars (DATABASE_URL, R2_*, STRIPE_SECRET_KEY) come from the Vercel project.

Verify after deploy:
```bash
curl -I https://site-notesnap.vercel.app/            # expect 200
curl -I https://site-notesnap.vercel.app/privacy     # expect 200
curl -X GET https://site-notesnap.vercel.app/api/recognize  # expect 405 JSON (function healthy)
```

### 3c. Rebuild the mobile app (EAS cloud build)
The app needs **no** env vars to build: `src/services/api.ts` defaults to
`https://site-notesnap.vercel.app` and every other `EXPO_PUBLIC_*` var falls back to
empty (features self-disable). `EXPO_PUBLIC_API_URL` is an *optional* override only.

```bash
git clone https://github.com/corecentrallab-sketch/musicapp.git notesnap-app
cd notesnap-app
git checkout master
npm install
npx eas login          # owner's Expo account (or: export EXPO_TOKEN=<token>)
npx eas build --platform android --profile production    # → AAB
npx eas build --platform ios --profile production        # → IPA
```

If you ever need to point the app at a different API URL, set it explicitly at build
time (overrides the default):

```bash
EXPO_PUBLIC_API_URL=https://site-notesnap.vercel.app npx eas build --platform android --profile production
```

The standard local check is `npm run ts:check` (tsc --noEmit); it passes with a fully
scrubbed environment, confirming no build-time env is mandatory.

---

## 4. Verified identity of the payment links (owner's Stripe account)

Marketing page `PAYMENT_LINKS` (src/routes/index.tsx) — all three were verified via the
Stripe API (`GET /v1/payment_links`) with the owner's live key on 2026-08-12, and are
the **only** active payment links in the owner's account:

| Plan | Payment link | Price ID | Amount |
|---|---|---|---|
| Pro Monthly | `https://buy.stripe.com/fZufZg3S1e3m8lo7cyefC00` | `price_1U3SEFBbnDObsY4ujb2zxBSs` | $4.99 / month |
| Pro Yearly | `https://buy.stripe.com/5kQ28q9cl7EYeJM1SeefC01` | `price_1U3SEKBbnDObsY4usDGDFNPQ` | $39.99 / year |
| Family | `https://buy.stripe.com/00wfZgcox8J20SW1SeefC02` | `price_1U3SEKBbnDObsY4uVrnJDIyg` | $9.99 / month |

To re-verify at any time:
```bash
curl -u "$STRIPE_SECRET_KEY:" https://api.stripe.com/v1/payment_links?limit=100
```
All three links must appear (they are in the owner's account, not the platform's).

---

## 5. If cto.new disappears

**What keeps running automatically (nothing to do):**
- The live site + API on Vercel (`https://site-notesnap.vercel.app`) — deployed to the
  owner's Vercel project, independent of any platform.
- Runtime env vars (Vercel dashboard), the Neon database, the R2 bucket, Stripe
  checkout, the `buy.stripe.com` payment links, the GitHub repo — all owner-owned.
- The deployed mobile app binaries already shipped to stores (they point at
  `https://site-notesnap.vercel.app`).

**What the owner must do (once, when convenient):**
1. Save the credentials in §2 into your password manager (VERCEL_TOKEN, DATABASE_URL,
   R2 keys, STRIPE_SECRET_KEY, GitHub token, Porkbun login). The Vercel dashboard keeps
   them working even if the token is lost — you only need them to *redeploy*.
2. Verify you can log into each dashboard (Vercel, Neon, Cloudflare, Stripe, Porkbun,
   Expo, GitHub) with your own credentials.
3. Optionally point `notesnap.app` at `site-notesnap.vercel.app` in Porkbun DNS.

**What is lost:**
- The cto.new agent team (this automated team) — the owner's own accounts and the
  product keep working, but future dev/ops work needs a human or a new automation
  setup. The code lives in the owner's GitHub repo; the runbook in `docs/RUNBOOK.md`
  on branch `feat/sheet-music-curation` and the app repo's `docs/`.

---

## 6. Verification evidence (2026-08-12)

1. **No cto.new references in the site repo** — grep for `ctonew`/`0eb3ebd` across
   tracked site files: 0 matches.
2. **No cto.new references in the app repo product path** — the only one
   (`app.json` `privacyPolicyUrl`) was replaced with `https://site-notesnap.vercel.app/privacy`
   (PR #26); the 3 store-doc references were replaced in the same PR. Remaining
   references in the app repo: none.
3. **Payment links are owner-account** — Stripe API returns exactly the 3 links above
   (and nothing else active) for the owner's key.
4. **Vercel project env vars are the canonical runtime source** — API shows 7 env vars
   (DATABASE_URL, STRIPE_SECRET_KEY, R2_ENDPOINT, R2_ACCESS_KEY_ID,
   R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL) targeting
   production/preview/development. The site's local `.env` is a mirror, not the only copy.
5. **Cold deploy input** — `go-live.sh` requires only `VERCEL_TOKEN`
   (`VERCEL_SCOPE`/`VERCEL_TEAM_ID` auto-resolved; `DATABASE_URL` optional and already
   present in the dashboard).
6. **App builds with zero injected env** — `npm run ts:check` passed under
   `env -i HOME PATH` (scrubbed). `EXPO_PUBLIC_API_URL` is an optional override;
   `cloudConfig` vars default to `''` and self-disable.
7. **Live endpoints** — `/` 200, `/privacy` 200, `/terms` 200,
   `/api/recognize` returns `405 {"error":"Method not allowed. Use POST."}` (function
   healthy with env). Production deployment `site-9jlwp9sox-notesnap.vercel.app` aliased
   to the stable URL.
