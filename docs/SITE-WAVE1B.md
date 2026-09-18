# SITE WAVE 1b — play-the-melody, related pieces, app CTA loop

Branch `feat/site-wave1b`, based on `origin/feat/find-piece-catalog-search` @ `ad18198`
(WAVE 1a). Site-only: nothing in the app repo changed.

Owner direction 09-18: the site must make consistent money, and practice engagement
is the layer that creates it. WAVE 1a shipped the money path (affiliate CTA on every
piece page + `affiliate_url` on the catalog API + Piece of the Day). WAVE 1b ships the
engagement layer around it.

## P2 — "Play the melody" (`library.$pieceId.tsx`, `MelodyPlayer.tsx`)

* `src/services/piece-melody.ts` — pure resolver, ported from the app's
  `pieceAbc.ts` (`resolvePieceAbc` / `normalizePieceKey`): **normalised title + composer**,
  never a UUID join (the seeds carry slugs such as `fur-elise`; a piece page carries a
  catalog UUID). Exact title key first, then a related title (one key contains the other,
  or the same leading two words) *only when the composer surname agrees*. Unmatched →
  `null`.
* `src/services/melody-playback.ts` — pure ABC → timed-note schedule, reusing the
  in-tree `abc/abc-parser.ts`. Rests advance time; chords reduce to the median pitch
  (same reduction as `hum/skeleton.ts`).
  **Tempo is honest**: the bundled seeds carry no `Q:` header, so we play at
  `DEFAULT_MELODY_BPM = 100` and label it "practice tempo — our choice"; a `Q:` marking,
  if a seed ever carries one, wins and is attributed to the score.
* `src/components/MelodyPlayer.tsx` — Web Audio synthesised in the browser (triangle
  oscillator + gain envelope), the ABC embedded in the rendered page: no audio files, no
  R2, no infra, works offline. Play/stop only, no autoplay. The other ~517 pieces get
  the app's honest line, **"Reference melody coming soon"**, and no player at all.

### The eight melodies (the only pieces that can ever be interactive)

`Für Elise` · `Ode to Joy` · `Twinkle, Twinkle, Little Star` · `Greensleeves` ·
`Jingle Bells` · `Canon in D` · `Happy Birthday` · `Anvil Chorus`
(`src/services/hum/melody-seeds.ts`, byte-identical mirror of the app's `ABC_SEEDS`).

Which of them the LIVE catalog can actually match (probed `/api/pieces` on 2026-09-18) —
the catalogue titles are not the seed titles, which is exactly why the resolver matches
on normalised text:

| seed | live catalog piece | how |
|---|---|---|
| fur-elise | `Bagatelle in A Minor (Für Elise)` (Beethoven) | title contains the seed key + composer agrees |
| ode-to-joy | `Symphony No. 9 in D Minor (Choral) — Ode to Joy` (Beethoven) | title contains the seed key + composer agrees |
| canon-in-d | `Canon in D Major (piano arrangement)` (Pachelbel) | title contains the seed key + composer agrees |
| twinkle, greensleeves, jingle-bells, happy-birthday, anvil-chorus | **no piece in the catalog** (`?q=` returned 0) | honest "coming soon" |

`Twelve Variations on 'Ah vous dirai-je, Maman' (K. 265)` (Mozart) is the catalog's
Twinkle-family piece and is deliberately **not** matched: the seed title cannot be
matched to it without a hand-written alias, and a wrong reference melody is worse than
none. Recorded as an honest gap, with a test.

## P3 — related pieces / difficulty path (`RelatedPieces.tsx`, `related-pieces.ts`)

Below the affiliate CTA: **"More by <composer>"** (from
`GET /api/pieces?composer=<composer>&limit=6`) and **"Pieces at the same level ·
<label>"** (from the API's largest sample, `limit=50`, filtered locally by the piece's
own `difficulty_label`). The current piece is excluded, and composer-block ids are
excluded from the level block so nothing appears twice. Both blocks render **nothing**
when empty — a composer with one piece gets silence, not padding. There is no
similarity ranking because the API has none; the heading claims nothing more.
`fetchCatalogList` gained an optional `composer` param (the API already supported it —
no backend change).

## P4 — app CTA loop (`AppCta.tsx`, `app-links.ts`)

"Hear it? Practise it in NoteSnap" → the Google Play closed-test opt-in link, with three
true statements about what the app adds (recognition incl. hum/whistle, practice coach,
offline sheets/editor). Rendered in the library header (`variant="inline"`) and on every
piece page (`variant="card"`). Copy states it is an Android closed test and that there is
no iPhone version yet — no fake urgency, no store badge we cannot honour.
`RecognitionDemo.tsx` now imports `PLAY_TEST_URL` from `app-links.ts` (one source of
truth; it previously declared its own copy of the same URL).

## Gates

* `bun test --timeout 60000` (repo `bunfig.toml` also sets 20 s): **93 pass / 0 fail**,
  93 tests across 9 files, 15.1 s. The new files contribute 42 (piece-melody 14,
  melody-playback 17, related-pieces 11); the real-audio regressions (owner's genuine
  whistle/m4a takes in `hum.test.ts`, `coach-pcm.test.ts`) still pass.
* `tsc --noEmit -p tsconfig.json`: **no new errors** — the 60 reported errors are the
  same set the base commit `ad18198` reports (`scripts/*`, `serve.ts`, `bun:test` module
  resolution, and the broken `createFileRoute` route-tree typing in `library.tsx` /
  `library.$pieceId.tsx`).

## Gaps / not verified here

* **No browser or visual check, and no deploy** — per the 09-16 lesson (layout
  regressions are invisible to build verification) this needs the owner's eye on the
  working site; nothing was published and `vercel`/`go-live` were not run.
* Web Audio scheduling is unit-tested at the plan level only; the oscillator wiring was
  not exercised in a real browser.
* Seed coverage is still 8 titles: widening it is a data task (seeds are not in the DB),
  and only 3 of the 8 currently exist in the catalog.
* The same-level block is a 50-piece alphabetical sample, not the whole catalog,
  because `/api/pieces` has no difficulty filter and caps `limit` at 50.
* No analytics/GA4, so piece-page depth and melody plays are still unmeasurable.
