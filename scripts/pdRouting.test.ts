/**
 * pdRouting.test.ts — the modern → public-domain cross-check, app half (build #3).
 *
 * OWNER-REPRODUCED (09-25, RC v26 follow-up probe): the owner played Lang Lang's
 * recording of Für Elise, the hero button identified it correctly, and the card
 * came up as "Recognised — Fur Elise (Piano Version) — Beethoven — Modern Song"
 * with a purchase CTA. Every part of that was wrong for a 200-year-old
 * public-domain work whose free score this app already holds: the category was
 * invented, the offer was a purchase instead of the score we host, and the
 * "Modern song" interstitial is built for copyrighted music we must never host.
 *
 * THE FIX has two halves and BOTH are pinned here:
 *   • backend (site repo, src/services/modern-pd-crosscheck.ts): match the AudD
 *     title + composer surname against the pieces table and attach `pd_match`
 *     ONLY when the mapping is confident — so this suite starts from a synthetic
 *     `pd_match` payload exactly as the server sends it;
 *   • app (src/services/pdRouting.ts + the screens): turn that mapping into the
 *     app's own LIBRARY result (free score card, purchase_url null, the affiliate
 *     search link secondary), and NEVER open the modern interstitial for it.
 *
 * The failure mode this suite exists for is a SILENT one: `parseModernResponse`
 * REBUILDS the wire payload, so a field it does not copy does not exist
 * downstream — the whole app half was inert while every payload-level test passed.
 * The carrier test below is that bug's guard.
 */
import {
  PD_ROUTE_CARD,
  PD_ROUTE_READER,
  pdLibraryResultResponse,
  pdMatchFromModernResponse,
  pdRouteReturnsBeforeModernCard,
  pdRouteWired,
  routesToPdLibrary,
  type PdLibraryMatch,
} from '../src/services/pdRouting';
import { parseModernResponse } from '../src/services/tier1';
import {
  FALLBACK_MODERN_GENRE_RETIRED,
  PUBLIC_DOMAIN_GENRE,
  modernGenreLabel,
  resultGenreLabel,
} from '../src/services/resultGenre';
import type { ModernResponse } from '../src/types';

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (
      fs.existsSync(path.join(dir, 'app.json')) &&
      fs.existsSync(path.join(dir, 'src'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

const HOME_SCREEN = 'src/screens/HomeScreen.tsx';
const MODERN_SCREEN = 'src/screens/ModernSearchScreen.tsx';

// ─── 1. The owner's case: Lang Lang's Für Elise ──────────────────────────────

/** The `pd_match` block the backend sends for the owner's recording, verbatim in
 *  shape: the catalog work behind the identified commercial recording. */
const FUR_ELISE_PD_MATCH = {
  id: '0e1e4700-0000-4000-8000-000000000001',
  title: 'Für Elise',
  composer: 'Ludwig van Beethoven',
  catalog: 'WoO 59',
  genre: 'Classical',
  difficulty_label: 'Intermediate',
  sheet_music_available: true,
  sheet_music_url: 'https://notesnap.app/scores/fur-elise.pdf',
  album_art_url: 'https://notesnap.app/art/fur-elise.png',
  affiliate_url:
    'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=Für%20Elise&tid=67650&affiliateId=67650',
  match_confidence: 0.97,
  is_public_domain: true,
};

/** The full modern response for that recording: AudD identified the RECORDING,
 *  the backend's cross-check added the PD mapping. */
function furEliseResponse(): Record<string, unknown> {
  return {
    success: true,
    recognized: 'modern',
    source: 'audd',
    query_duration_ms: 12000,
    modern: {
      song: 'Fur Elise (Piano Version)',
      artist: 'Lang Lang',
      album: 'The Romantic Pianist',
      genre: 'Classical',
      matchConfidence: 1,
      source: 'audd',
      retailerUrl:
        'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=Fur%20Elise&tid=67650&affiliateId=67650',
      musicnotesUrl: 'https://www.musicnotes.com/search/go?q=Fur%20Elise',
    },
    pd_match: FUR_ELISE_PD_MATCH,
  };
}

function pdRouteTests(): void {
  console.log('\nthe owner\'s recording: Lang Lang — Für Elise → the FREE library card');

  const resp = furEliseResponse();
  assertEq(routesToPdLibrary(resp), true, 'the response routes to the PD library');

  const pd = pdMatchFromModernResponse(resp);
  assert(pd !== null, 'the PD mapping is read off the response');
  if (!pd) return;
  const card: PdLibraryMatch = pd;

  assertEq(card.title, 'Für Elise', 'the card states the WORK, not the recording');
  assertEq(
    card.composer,
    'Ludwig van Beethoven',
    'the card credits the composer (not the performer)',
  );
  assertEq(card.catalog, 'WoO 59', 'the catalog number travels with the mapping');
  assertEq(card.is_public_domain, true, 'the work is marked public domain');
  assertEq(card.sheet_music_available, true, 'the free score is available');
  assertEq(
    card.sheet_music_url,
    'https://notesnap.app/scores/fur-elise.pdf',
    'the free in-app score URL travels with the mapping',
  );
  assertEq(card.confidence, 0.97, 'the cross-check confidence is carried');

  // THE PRIMARY OFFER RULE: we host this score, so the card must never redirect
  // the user to a retailer as its primary action — exactly the rule
  // /api/recognize applies to every public-domain piece.
  assertEq(
    card.purchase_url,
    null,
    'a PD card never carries a purchase_url — the free score is the primary offer',
  );
  assert(
    !!card.affiliate_url && card.affiliate_url.includes('tid=67650'),
    'the affiliate search link rides along as the SECONDARY action (SMD 67650)',
  );

  // The card is the app's EXISTING library result shape, so the existing result
  // card renders it — no second card implementation.
  const result = pdLibraryResultResponse(card);
  assertEq(result.success, true, 'the library-shaped response is a success');
  assertEq(result.matches.length, 1, 'it carries exactly the one matched work');
  assertEq(result.matches[0].title, 'Für Elise', 'the matched work is the PD work');
  assertEq(
    result.pd_routed_from,
    'modern-pd-crosscheck',
    'the response records where the route came from (telemetry, never shown)',
  );
}

// ─── 2. Never a PD work on the modern card ───────────────────────────────────

function genreTests(): void {
  console.log('\na public-domain work is never labelled a modern song');

  const pd = pdMatchFromModernResponse(furEliseResponse());
  assert(pd !== null, 'the PD mapping is present for the genre checks');
  if (!pd) return;

  assert(
    resultGenreLabel(pd) !== FALLBACK_MODERN_GENRE_RETIRED,
    `the card never claims the retired modern category ("${FALLBACK_MODERN_GENRE_RETIRED}")`,
  );
  assertEq(
    resultGenreLabel(pd),
    'Classical',
    "the catalog's own genre is what the card shows",
  );
  assertEq(
    resultGenreLabel({
      is_public_domain: true,
      catalog: 'WoO 59',
      genre: undefined,
    }),
    PUBLIC_DOMAIN_GENRE,
    'with no catalog genre the honest "Public domain" is used — never an invented category',
  );

  // The modern card's line stays absent when the provider sent no genre: the app
  // never fills the gap with a made-up label, and a PD work never reaches it.
  assertEq(
    modernGenreLabel({ genre: undefined }),
    null,
    'a modern match with no provider genre puts no category line on the card',
  );
  assertEq(
    modernGenreLabel({ genre: 'Classical' }),
    'Classical',
    'the provider genre is shown verbatim when it sent one',
  );
}

// ─── 3. The honest fallbacks: not-PD, ambiguous, no match ────────────────────

function fallbackTests(): void {
  console.log('\nthe not-PD / ambiguous / no-match cases (never a guess)');

  // A genuine modern song: AudD matched, the cross-check found no PD work, so the
  // backend omits the key ENTIRELY. The modern card stays.
  const modernOnly: Record<string, unknown> = {
    success: true,
    recognized: 'modern',
    source: 'audd',
    query_duration_ms: 12000,
    modern: {
      song: 'Sharp Dressed Man',
      artist: 'ZZ Top',
      matchConfidence: 1,
      source: 'audd',
      retailerUrl: 'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=Sharp',
    },
  };
  assertEq(
    routesToPdLibrary(modernOnly),
    false,
    'a genuine modern song does NOT route to the PD library (the modern card stays)',
  );
  assertEq(
    pdMatchFromModernResponse(modernOnly),
    null,
    'no pd_match key ⇒ no PD card',
  );

  // Ambiguous mapping: the backend declines to name the work. Whatever shape the
  // refusal takes, the app must not invent a PD work from it.
  assertEq(
    pdMatchFromModernResponse({ pd_match: null }),
    null,
    'a null pd_match is an honest no-route',
  );
  assertEq(
    pdMatchFromModernResponse({ pd_match: undefined }),
    null,
    'an absent pd_match is an honest no-route',
  );
  assertEq(
    pdMatchFromModernResponse({ pd_match: 'Für Elise' }),
    null,
    'a bare string is not a mapping (the ambiguous shape never routes)',
  );
  assertEq(
    pdMatchFromModernResponse({ pd_match: {} }),
    null,
    'an empty mapping has no title ⇒ no route',
  );
  assertEq(
    pdMatchFromModernResponse({ pd_match: { title: '   ' } }),
    null,
    'a whitespace title is not a title ⇒ no route',
  );
  assertEq(
    pdMatchFromModernResponse({ pd_match: { composer: 'Beethoven' } }),
    null,
    'a composer alone can never route (the title is the identity)',
  );

  // An explicit PD veto (a future backend flag) wins over everything.
  assertEq(
    pdMatchFromModernResponse({
      pd_match: { ...FUR_ELISE_PD_MATCH, is_public_domain: false },
    }),
    null,
    'is_public_domain:false vetoes the route even with a full mapping',
  );

  assertEq(pdMatchFromModernResponse(null), null, 'no response at all ⇒ no route');
  assertEq(pdMatchFromModernResponse(undefined), null, 'undefined ⇒ no route');

  // A no-match response carries no modern match AND no PD mapping.
  const honestMiss: Record<string, unknown> = {
    success: true,
    recognized: 'none',
    source: 'audd',
    query_duration_ms: 12000,
    modern: null,
  };
  assertEq(
    routesToPdLibrary(honestMiss),
    false,
    'an honest no-match never becomes a PD result',
  );

  // A PD mapping with no score URL is NOT offered as sheet-music-available: the
  // card then says so instead of opening a broken link.
  const noScore = pdMatchFromModernResponse({
    pd_match: { ...FUR_ELISE_PD_MATCH, sheet_music_url: undefined },
  });
  assert(noScore !== null, 'the mapping still routes without a score URL');
  assertEq(
    noScore ? noScore.sheet_music_available : null,
    false,
    'no score URL ⇒ sheet_music_available false (never a dead link)',
  );
  assertEq(noScore ? noScore.purchase_url : null, null, 'and still no purchase_url');
}

// ─── 4. THE CARRIER: the parser must not drop pd_match ───────────────────────

function carrierTests(): void {
  console.log('\nparseModernResponse carries pd_match to the screens (the inert half)');

  const parsed = parseModernResponse(furEliseResponse());
  assert(parsed !== null, 'the owner\'s response parses');
  if (!parsed) return;
  const resp: ModernResponse = parsed;

  // The bug this test exists for: the parser REBUILDS the payload, so dropping
  // this key would make every screen-level PD branch dead code while all payload
  // fixtures still passed.
  assert(
    resp.pd_match !== undefined,
    'the parsed response still carries pd_match (a rebuilt payload must copy it)',
  );
  assertEq(
    resp.pd_match ? resp.pd_match.title : null,
    'Für Elise',
    'the carried mapping is the backend\'s own',
  );
  const routed = pdMatchFromModernResponse(resp);
  assert(
    routed !== null,
    'the PARSED response is what the screens hand to the PD router — and it routes',
  );
  assertEq(
    routed ? routed.title : null,
    'Für Elise',
    'end to end: wire payload → parser → PD card',
  );

  // The carrier must be honest: a modern song with no mapping keeps it absent,
  // and a non-object value is never coerced into one.
  const modernOnly = parseModernResponse({
    success: true,
    recognized: 'modern',
    source: 'audd',
    query_duration_ms: 12000,
    modern: { song: 'Sharp Dressed Man', artist: 'ZZ Top', source: 'audd' },
  });
  assert(modernOnly !== null, 'a modern-only payload parses');
  assertEq(
    modernOnly ? modernOnly.pd_match : 'missing',
    undefined,
    'no pd_match on the wire ⇒ none on the parsed response',
  );
  assertEq(
    modernOnly ? routesToPdLibrary(modernOnly) : true,
    false,
    'and it stays a modern result',
  );
  const notAnObject = parseModernResponse({
    success: true,
    recognized: 'modern',
    source: 'audd',
    query_duration_ms: 12000,
    modern: { song: 'Sharp Dressed Man', artist: 'ZZ Top', source: 'audd' },
    pd_match: 'Fur Elise',
  });
  assertEq(
    notAnObject ? notAnObject.pd_match : 'missing',
    undefined,
    'a non-object pd_match is dropped by the parser (never coerced)',
  );
}

// ─── 5. Both screens carry the branch, in the right order ────────────────────

function wiringTests(): void {
  console.log('\nthe pipeline that renders a result routes PD before the modern card');

  for (const path of [HOME_SCREEN, MODERN_SCREEN]) {
    const source = readAppFile(path);
    assert(source.length > 2000, `${path} was read`);
    assert(
      source.includes(PD_ROUTE_READER),
      `${path} reads the PD mapping off the modern response (${PD_ROUTE_READER})`,
    );
    assert(
      source.includes(PD_ROUTE_CARD),
      `${path} renders the PD library card for it (${PD_ROUTE_CARD})`,
    );
    assert(pdRouteWired(source), `${path} passes the PD route contract`);
    assert(
      pdRouteReturnsBeforeModernCard(source),
      `${path} leaves the pipeline (return) before the modern outcome / interstitial`,
    );
    assert(
      !/setShowModernInterstitial\s*\(\s*true\s*\)[\s\S]{0,400}pdMatchFromModernResponse/.test(
        source,
      ),
      `${path} never opens the modern interstitial on the way to the PD branch`,
    );
  }

  // The screen the owner sees must render the card through the app's EXISTING
  // result card, and the card is fed the PD library response shape.
  const modern = readAppFile(MODERN_SCREEN);
  assert(
    modern.includes('<RecognitionResultView'),
    'ModernSearchScreen renders the PD result through the existing result card',
  );
  assert(
    modern.includes("type: 'success'"),
    'the PD branch hands the card a success phase (not a no-match card)',
  );
  assert(
    modern.includes('PUBLIC_DOMAIN_GENRE'),
    'a routed work is saved with a public-domain category, never a modern one',
  );
}

// ─── run ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(
    '\n=== modern-song PD cross-check (a PD work must never reach the modern card) ===',
  );
  pdRouteTests();
  genreTests();
  fallbackTests();
  carrierTests();
  wiringTests();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
