# SITE WAVE 1a — affiliate CTA + Piece of the Day

Branch: `feat/site-wave1a`. Owner direction 09-18 (plan rev 18): **the site must make
consistent money** — practice engagement → affiliate purchases, with every piece page
carrying a purchase CTA. Sheet Music Direct (affiliate ID **67650**, 10%) is PRIMARY.

Feasibility map this implements: `shared/site-stickiness-map.md` §2, §4, §5, §8 —
wiring option **(a) + (c)** (SSR-import the pure builder *and* expose the field on the API).

## 1. One attribution path (P0)

`src/services/piece-affiliate.ts` (new, pure — no env, no network, no DB):

| Export | Purpose |
|---|---|
| `pieceAffiliateQuery(title, composer)` | `"<title> <composer>"`, whitespace-collapsed, skips a missing part |
| `pieceAffiliateLink(title, composer, builders?)` | `{ query, url, retailer, usedFallback }` or `null` |
| `pieceAffiliateUrl(title, composer, builders?)` | the URL only (API serialization) |
| `SMD_RETAILER_NAME` / `MUSICNOTES_RETAILER_NAME` | labels shown next to the CTA |

Both call sites go through the verified SMD builder `modern-retailer.ts`
(`sheetMusicDirectSearchUrl`, newly exported), which appends `tid=67650&affiliateId=67650`
to every link. Musicnotes is used **only** when the SMD builder cannot produce a URL
(injectable `builders` argument makes that branch testable). A piece with no title gets
**no** CTA — never a composer-only search and never a dead link.

Call sites:

1. **API** — `src/services/catalog-handler.ts`: `affiliate_url` added to the serialized
   piece on **both** `/api/pieces` (list) and `/api/pieces/:id` (detail). Additive only —
   no field renamed or removed. Populated for every piece, including the ~85% with
   `sheet_music_available: false`, which is where the CTA is the only honest offer.
2. **Site** — `src/routes/library.$pieceId.tsx`: the loader prefers the API's
   `affiliate_url` (via `CatalogPiece.affiliate_url`, new) and falls back to the same
   pure builder, so the URL is identical either way and works before the API ships.

App consumption: the field is on the existing public JSON, so the app can read
`piece.affiliate_url` with no new endpoint and no second affiliate map.

## 2. The CTA itself (P0)

`AffiliateCta` in `src/routes/library.$pieceId.tsx` — amber/stone card, rendered on
**every** piece page with the same visual weight whether or not we hold a score:

- Heading "Get the official sheet music"; one link (min-h-12, amber) to Sheet Music
  Direct, `target="_blank"`, `rel="noopener noreferrer sponsored"`.
- Copy differs only in the honest reason to buy: "prefer a published edition" (we hold a
  score) vs "our quality-checked score isn't ready yet, but the official edition is
  available" (we do not).
- `aria-label` names the retailer, the search text, and that it opens a new tab; the
  commission is disclosed in the small print. No urgency, no scarcity, no auto-redirect
  (owner UX rule 08-24).

## 3. SheetMusicPlus retired (P0)

`src/services/affiliates.ts`: the `sheetmusicplus` entry is gone (owner dropped it
08-24 — its flow loops on sign-in). `musicnotes` (backup) and `jwpepper` are untouched.
The dead `purchaseUrl.sheetmusicplus` button in `src/components/RecognitionDemo.tsx`
was removed with it; `generate-purchase-urls.ts` needs no change (it iterates the
registry). `src/services/affiliates.test.ts` pins the retirement.

## 4. Piece of the Day (P1)

- `src/components/PieceOfTheDay.tsx` — `daily | null`, `currentPieceId?`,
  `variant: "card" | "compact"`. Links to `/library/<piece_id>`; shows difficulty and
  "Free score on NoteSnap" / "Score coming soon" honestly.
- Data: the homepage's exact SSR pattern — a `getDailyPiece` `createServerFn` importing
  `handleDailyChallenge` directly (no HTTP hop), now in both `src/routes/library.tsx`
  (top of the library) and `src/routes/library.$pieceId.tsx` (below the sources,
  `variant="compact"`, "You're practising today's piece" when it *is* that piece).
- Empty state (catalog unavailable / empty pool): "A new piece arrives every day — check
  back tomorrow." No new data source; same deterministic pick as the homepage and the app.

## 5. Gates

- `bun test --timeout 60000` — **51 pass / 0 fail** (6 files, 194 expect calls), including
  the real-audio hum/whistle regressions. New tests: `piece-affiliate.test.ts` (10),
  `affiliates.test.ts` (4).
- `tsc --noEmit -p tsconfig.json` — see the WAVE 1a PR report.
- Not run: `bun run go-live` / publish (branch discipline: no deploy from WAVE 1a), and no
  on-device/browser render check of the new blocks — **needs the owner's eye or a dev
  run before publish**, per the 09-16 lesson that layout regressions are invisible to
  build gates.

## 6. Follow-ups (not in WAVE 1a)

`getDailyPiece` is duplicated in three route files (homepage, library, piece page) —
worth hoisting into one module once a shared-home is verified. Virtual Sheet Music
(classical complement) still needs the owner's tracking link. Analytics for affiliate
CTR / piece-page depth (GA4) is WAVE 2.
