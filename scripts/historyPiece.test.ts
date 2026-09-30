/**
 * Unit tests for the History → piece-page mapping (src/services/historyPiece.ts):
 * the fix for the owner-reported v18 bug where a History row did nothing when
 * tapped. The screen itself is a thin caller — the two pure functions tested
 * here are the whole of the logic:
 *
 *   • savedPieceToDetail()      — SavedPiece (persisted recognition) → the
 *                                DailyChallengePiece PieceDetailScreen renders
 *   • mergeCatalogIntoDetail()  — fills in the catalog's own record for the
 *                                piece (curated sheet URL, difficulty,
 *                                public-domain signals) without ever inventing
 *                                data or clobbering the saved identity
 *
 * Run with: npm run test:tier1. Pure modules + plain Node, no app runtime, no
 * react-native, same convention as the other scripts/*.test.ts suites.
 */
import {
  filterSavedPieces,
  HISTORY_DEFAULT_DIFFICULTY,
  HISTORY_DEFAULT_GENRE,
  HISTORY_DETAIL_DESCRIPTION,
  mergeCatalogIntoDetail,
  modernSheetCard,
  normalizeHistoryQuery,
  savedPieceToDetail,
  type CatalogPieceInfo,
} from '../src/services/historyPiece';
import {
  primaryPurchaseUrl,
  secondaryPurchaseUrl,
} from '../src/services/purchaseCta';
import type { DailyChallengePiece, SavedPiece } from '../src/types';

declare const process: { exit(code: number): never };
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

/** A saved recognition exactly as storage holds it (Für Elise, owner's case). */
const SAVED_FUR_ELISE: SavedPiece = {
  id: '741700db-72cf-4c6d-9b61-cf1e091621ef',
  title: 'Bagatelle in A Minor (Für Elise)',
  composer: 'Ludwig van Beethoven',
  savedAt: '2026-09-16T09:12:00.000Z',
  genre: 'WoO 59',
};

/** The catalog's real record for Für Elise (fetched live 2026-09-18). */
const CATALOG_FUR_ELISE: CatalogPieceInfo = {
  sheetMusicUrl: null,
  difficultyLabel: 'Beginner',
  difficultyGrade: 3,
  isPublicDomain: true,
  sheetMusicAvailable: false,
  catalog: 'WoO 59',
};

/** The catalog's real record for a piece that HAS a curated score. */
const CATALOG_WITH_SHEET: CatalogPieceInfo = {
  sheetMusicUrl: 'https://site-notesnap.vercel.app/api/sheets/b2ffba94-592b-4f01-bf0a-f45dfb172f68.pdf',
  difficultyLabel: 'Advanced',
  difficultyGrade: 8,
  isPublicDomain: true,
  sheetMusicAvailable: true,
  catalog: 'BWV 971',
};

// ─── savedPieceToDetail ────────────────────────────────────────

function savedToDetailTests(): void {
  const piece = savedPieceToDetail(SAVED_FUR_ELISE);

  assertEq(piece.id, SAVED_FUR_ELISE.id, 'id comes from the saved recognition');
  assertEq(piece.title, SAVED_FUR_ELISE.title, 'title comes from the saved recognition');
  assertEq(
    piece.composer,
    SAVED_FUR_ELISE.composer,
    'composer comes from the saved recognition',
  );
  assertEq(piece.genre, 'WoO 59', 'a saved genre tag is carried through');
  assertEq(
    piece.sheetMusicUrl,
    undefined,
    'no sheet URL is invented — the page opens on its honest no-sheet state',
  );
  assertEq(
    piece.difficulty,
    HISTORY_DEFAULT_DIFFICULTY,
    'difficulty label starts at the honest default (catalog label arrives on merge)',
  );
  assertEq(
    piece.description,
    HISTORY_DETAIL_DESCRIPTION,
    'the description states where the piece came from, with no invented confidence',
  );
  assert(
    !/confidence/i.test(piece.description ?? ''),
    'the description never claims a confidence the saved record does not hold',
  );

  const noGenre = savedPieceToDetail({ ...SAVED_FUR_ELISE, genre: undefined });
  assertEq(
    noGenre.genre,
    HISTORY_DEFAULT_GENRE,
    'a missing genre falls back to the app default, not an empty tag',
  );

  const blankGenre = savedPieceToDetail({ ...SAVED_FUR_ELISE, genre: '   ' });
  assertEq(
    blankGenre.genre,
    HISTORY_DEFAULT_GENRE,
    'a whitespace-only genre is treated as missing',
  );

  const withGrade = savedPieceToDetail({ ...SAVED_FUR_ELISE, difficulty: 3 });
  assertEq(withGrade.difficultyGrade, 3, 'a saved catalog grade is carried through');
  assertEq(
    savedPieceToDetail({ ...SAVED_FUR_ELISE }).difficultyGrade,
    null,
    'no saved grade → null (never a fabricated grade)',
  );
  assertEq(
    savedPieceToDetail({ ...SAVED_FUR_ELISE, difficulty: Number.NaN })
      .difficultyGrade,
    null,
    'a NaN grade is rejected rather than shown',
  );
}

// ─── mergeCatalogIntoDetail ────────────────────────────────────

function mergeTests(): void {
  const base = savedPieceToDetail(SAVED_FUR_ELISE);

  // Failure path: offline / unknown id / malformed body.
  assertEq(
    mergeCatalogIntoDetail(base, null).sheetMusicUrl,
    undefined,
    'a null catalog response leaves the piece untouched (offline is not an error)',
  );
  assertEq(
    mergeCatalogIntoDetail(base, undefined).difficulty,
    base.difficulty,
    'an undefined catalog response leaves the piece untouched',
  );
  assert(
    mergeCatalogIntoDetail(base, null) === base,
    'a null response returns the same object identity (nothing to re-render)',
  );

  // Für Elise: the catalog has no curated score, so no sheet link may appear.
  const elise = mergeCatalogIntoDetail(base, CATALOG_FUR_ELISE);
  assertEq(
    elise.sheetMusicUrl,
    undefined,
    'a catalog piece with no curated score gets NO sheet link (honest coming-soon)',
  );
  assertEq(
    elise.sheetMusicAvailable,
    false,
    'the catalog availability flag is carried through for the CTA copy',
  );
  assertEq(elise.difficulty, 'Beginner', 'the catalog difficulty label wins');
  assertEq(elise.difficultyGrade, 3, 'the catalog grade is carried through');
  assertEq(elise.isPublicDomain, true, 'the public-domain signal is carried through');
  assertEq(elise.catalog, 'WoO 59', 'the catalog number is carried through');
  assertEq(elise.id, base.id, 'the merge never re-identifies the piece');
  assertEq(elise.title, base.title, 'the merge never rewrites the title');
  assertEq(elise.composer, base.composer, 'the merge never rewrites the composer');
  assertEq(elise.genre, base.genre, 'the merge never rewrites the genre');
  assertEq(elise.description, base.description, 'the merge keeps the honest description');

  // A piece WITH a curated score — the sheet URL is what the recognition flow
  // returns for the same piece, so tapping the saved row shows the same sheet.
  const withSheet = mergeCatalogIntoDetail(base, CATALOG_WITH_SHEET);
  assertEq(
    withSheet.sheetMusicUrl,
    CATALOG_WITH_SHEET.sheetMusicUrl,
    'a curated sheet URL from the catalog fills in the piece page',
  );
  assertEq(withSheet.difficulty, 'Advanced', 'the catalog label replaces the default');
  assertEq(
    withSheet.abc,
    null,
    'an absent ABC reference stays null (the coach shows its honest fallback)',
  );

  // Partial / hostile payloads.
  const blankSheet = mergeCatalogIntoDetail(base, {
    sheetMusicUrl: '   ',
    difficultyLabel: '',
    catalog: '',
    abc: '   ',
  });
  assertEq(
    blankSheet.sheetMusicUrl,
    undefined,
    'a whitespace-only sheet URL is not treated as a score',
  );
  assertEq(blankSheet.difficulty, base.difficulty, 'a blank label does not override');
  assertEq(blankSheet.catalog, null, 'a blank catalog number stays null');
  assertEq(blankSheet.abc, null, 'a blank ABC reference stays null');

  const abc = mergeCatalogIntoDetail(base, { abc: 'X:1\nK:C\nCDEF|' });
  assertEq(abc.abc, 'X:1\nK:C\nCDEF|', 'an ABC reference is carried through when present');
  assertEq(
    abc.sheetMusicUrl,
    undefined,
    'merging an ABC reference still does not invent a sheet',
  );

  const unknownPd = mergeCatalogIntoDetail(base, { isPublicDomain: undefined });
  assertEq(
    unknownPd.isPublicDomain,
    undefined,
    'an unknown public-domain flag stays unknown — never guessed as true',
  );

  // Idempotence: merging the same catalog record twice is stable.
  const twice = mergeCatalogIntoDetail(elise, CATALOG_FUR_ELISE);
  assertEq(twice.sheetMusicUrl, elise.sheetMusicUrl, 'the merge is idempotent (sheet)');
  assertEq(twice.difficulty, elise.difficulty, 'the merge is idempotent (difficulty)');
  assertEq(twice.difficultyGrade, elise.difficultyGrade, 'the merge is idempotent (grade)');
}

// ─── the owner's on-device case end to end (data level) ────────

function ownerCaseTests(): void {
  const saved: SavedPiece = {
    id: 'b2ffba94-592b-4f01-bf0a-f45dfb172f68',
    title: 'Italian Concerto in F Major',
    composer: 'Johann Sebastian Bach',
    savedAt: '2026-09-18T08:00:00.000Z',
  };
  const piece: DailyChallengePiece = mergeCatalogIntoDetail(
    savedPieceToDetail(saved),
    CATALOG_WITH_SHEET,
  );
  assertEq(
    piece.sheetMusicUrl,
    'https://site-notesnap.vercel.app/api/sheets/b2ffba94-592b-4f01-bf0a-f45dfb172f68.pdf',
    'a saved piece with a curated score opens the SAME sheet URL the daily/recognition flows use',
  );
  assert(
    !!(piece.sheetMusicUrl && piece.sheetMusicUrl.endsWith('.pdf')),
    'the sheet URL is a real in-app-viewable PDF (ScoreViewer input)',
  );
}

// ─── the sheet-music card (History dead-end sprint, owner 10-01) ──

/** The two retailer links a modern match arrives with (identifiable values). */
const PRIMARY_URL = 'https://example.test/sheet/primary-123';
const BACKUP_URL = 'https://example.test/sheet/backup-456';

/** A modern-song History row, saved WITH the links its match carried. */
const SAVED_MODERN: SavedPiece = {
  id: 'GBAYE0601499',
  title: 'Fields of Gold',
  composer: 'Sting',
  savedAt: '2026-10-01T09:00:00.000Z',
  genre: 'Pop',
  purchaseUrls: {
    sheetmusicdirect: PRIMARY_URL,
    musicnotes: BACKUP_URL,
  },
};

function sheetCardTests(): void {
  console.log('\nthe sheet-music card a saved modern song shows');

  // The owner's dead end: a row with no links keeps the honest coming-soon text
  // (the screen renders it when this returns null).
  assertEq(
    modernSheetCard(savedPieceToDetail({ ...SAVED_FUR_ELISE })),
    null,
    'no purchaseUrls → null (the honest "coming soon" state is kept)',
  );
  assertEq(
    modernSheetCard(savedPieceToDetail({ ...SAVED_FUR_ELISE, purchaseUrls: null })),
    null,
    'an explicit null map → null',
  );
  assertEq(
    modernSheetCard(
      savedPieceToDetail({
        ...SAVED_FUR_ELISE,
        purchaseUrls: { sheetmusicdirect: '   ', musicnotes: '' },
      }),
    ),
    null,
    'blank URLs are not links — the card is never rendered empty',
  );

  // The card itself: the song's OWN header, and the money-path URL.
  const detail = savedPieceToDetail(SAVED_MODERN);
  const card = modernSheetCard(detail);
  assert(card !== null, 'a saved modern row renders a card');
  assertEq(
    card?.title,
    'Fields of Gold — official sheet music',
    'the card header names the song’s own official sheet music',
  );
  assertEq(
    card?.subtitle,
    'Sting · Pop',
    'the subtitle carries the composer/artist and the genre when present',
  );
  assertEq(card?.url, PRIMARY_URL, 'the card opens the PRIMARY retailer link');
  assertEq(
    primaryPurchaseUrl(detail.purchaseUrls),
    PRIMARY_URL,
    'the card’s URL is the app’s one primary-URL rule',
  );
  assertEq(
    secondaryPurchaseUrl(detail.purchaseUrls),
    BACKUP_URL,
    'the secondary line resolves to the OTHER retailer (a different page)',
  );

  // Only the backup exists → it IS the card's link, and there is no duplicate
  // secondary line pointing at the same page.
  const backupOnly = savedPieceToDetail({
    ...SAVED_MODERN,
    purchaseUrls: { musicnotes: BACKUP_URL },
  });
  assertEq(modernSheetCard(backupOnly)?.url, BACKUP_URL, 'backup-only rows still open a real page');
  assertEq(
    secondaryPurchaseUrl(backupOnly.purchaseUrls),
    undefined,
    'no secondary line when the only link is already the card’s own destination',
  );

  // The genre on the card is the SAVED row's genre; a legacy row with none is
  // labelled with the app's honest default rather than an invented real genre.
  const noGenre = modernSheetCard(
    savedPieceToDetail({ ...SAVED_MODERN, genre: undefined }),
  );
  assertEq(
    noGenre?.subtitle,
    `Sting · ${HISTORY_DEFAULT_GENRE}`,
    'no saved genre → the app’s default label, never an invented real genre',
  );
  assert(
    !/Classical|Pop/.test(noGenre?.subtitle ?? ''),
    'the card never invents a genre for a modern song',
  );

  // A row with a catalog piece id whose catalog record has no score: the card
  // must not appear out of nothing.
  assertEq(
    modernSheetCard(
      mergeCatalogIntoDetail(savedPieceToDetail(SAVED_FUR_ELISE), CATALOG_FUR_ELISE),
    ),
    null,
    'a PD piece with no curated score keeps its honest state (no purchase card)',
  );
}

// ─── the saved links survive the round trip ────────────────────

function purchaseRoundTripTests(): void {
  console.log('\nthe saved purchase links survive the row → page → catalog merge');

  const saved = SAVED_MODERN;
  const detail = savedPieceToDetail(saved);
  assertEq(
    detail.purchaseUrls?.sheetmusicdirect,
    PRIMARY_URL,
    'savedPieceToDetail carries the primary link',
  );
  assertEq(
    detail.purchaseUrls?.musicnotes,
    BACKUP_URL,
    'savedPieceToDetail carries the backup link',
  );

  // A catalog response for the SAME id (a modern ISRC is not a catalog piece, so
  // in practice the lookup returns nothing — this is the defensive half).
  const merged = mergeCatalogIntoDetail(detail, {
    sheetMusicUrl: null,
    difficultyLabel: 'Advanced',
    isPublicDomain: false,
    sheetMusicAvailable: false,
  });
  assertEq(
    merged.purchaseUrls?.sheetmusicdirect,
    PRIMARY_URL,
    'the catalog merge NEVER clears the saved links',
  );
  assertEq(merged.sheetMusicUrl, undefined, 'the merge still adds no invented score');
  const card = modernSheetCard(merged);
  assertEq(
    card?.url,
    PRIMARY_URL,
    'the card still opens the saved retailer after the merge',
  );

  // A hostile response carrying its own map must not overwrite the saved one.
  const hostile = mergeCatalogIntoDetail(detail, {
    purchaseUrls: { sheetmusicdirect: 'https://example.test/hostile' },
  } as unknown as CatalogPieceInfo);
  assertEq(
    hostile.purchaseUrls?.sheetmusicdirect,
    PRIMARY_URL,
    'a catalog body cannot overwrite the saved links (the catalog has no such field)',
  );

  // A legacy row (saved before this change) has no map and gains none.
  const legacy = savedPieceToDetail(SAVED_FUR_ELISE);
  assertEq(legacy.purchaseUrls, null, 'a legacy row gets no links — today’s behaviour is kept');
  assertEq(
    mergeCatalogIntoDetail(legacy, CATALOG_WITH_SHEET).purchaseUrls,
    null,
    'the merge cannot supply links either',
  );
}

// ─── History search scope (owner 10-01) ────────────────────────

const SEARCH_ITEMS: SavedPiece[] = [
  {
    id: 'a',
    title: 'Bagatelle in A Minor (Für Elise)',
    composer: 'Ludwig van Beethoven',
    savedAt: '2026-09-16T09:12:00.000Z',
  },
  {
    id: 'b',
    title: 'Fields of Gold',
    composer: 'Sting',
    savedAt: '2026-10-01T09:00:00.000Z',
  },
  {
    id: 'c',
    title: 'Italian Concerto in F Major',
    composer: 'Johann Sebastian Bach',
    savedAt: '2026-09-18T08:00:00.000Z',
  },
];

function historyFilterTests(): void {
  console.log('\nHistory search filters the SAVED recognitions, in memory');

  assertEq(
    filterSavedPieces(SEARCH_ITEMS, '').length,
    3,
    'an empty query shows the full saved list',
  );
  assertEq(
    filterSavedPieces(SEARCH_ITEMS, '   ').length,
    3,
    'a whitespace-only query is treated as empty',
  );
  assertEq(filterSavedPieces(null, 'bach').length, 0, 'a missing list filters to nothing (no throw)');
  assertEq(
    filterSavedPieces(undefined, '').length,
    0,
    'an undefined list is the honest empty result',
  );

  assertEq(
    filterSavedPieces(SEARCH_ITEMS, 'gold').map((p) => p.id).join(','),
    'b',
    'a title match returns exactly that saved row',
  );
  assertEq(
    filterSavedPieces(SEARCH_ITEMS, 'sting').map((p) => p.id).join(','),
    'b',
    'a composer match returns that row',
  );
  assertEq(
    filterSavedPieces(SEARCH_ITEMS, 'BACH').map((p) => p.id).join(','),
    'c',
    'matching is case-insensitive',
  );
  // The diacritic rule: the user's keyboard has no umlaut, the catalog does.
  assertEq(
    filterSavedPieces(SEARCH_ITEMS, 'fur elise').map((p) => p.id).join(','),
    'a',
    'an ASCII query finds a diacritic title (Für Elise)',
  );
  assertEq(
    filterSavedPieces(SEARCH_ITEMS, 'für').map((p) => p.id).join(','),
    'a',
    'the diacritic query finds the same row',
  );
  assertEq(
    filterSavedPieces(SEARCH_ITEMS, 'beethoven').map((p) => p.id).join(','),
    'a',
    'a composer surname matches',
  );
  assertEq(
    filterSavedPieces(SEARCH_ITEMS, 'moonlight').length,
    0,
    'a piece the user never recognized matches NOTHING — History is not a catalog search',
  );
  assertEq(
    filterSavedPieces(SEARCH_ITEMS, 'concerto').map((p) => p.id).join(','),
    'c',
    'a partial title still matches (substring, not exact)',
  );

  const first = filterSavedPieces(SEARCH_ITEMS, '');
  assert(first !== SEARCH_ITEMS, 'the filter returns a new list (never the caller’s array)');
  assertEq(
    SEARCH_ITEMS.length,
    3,
    'the filter never mutates the loaded saved list',
  );

  assertEq(normalizeHistoryQuery('  Für   ELISE '), 'fur elise', 'the normalizer folds case, diacritics and spacing');
  assertEq(normalizeHistoryQuery(null), '', 'a null query normalizes to empty');
  assertEq(normalizeHistoryQuery(undefined), '', 'an undefined query normalizes to empty');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== history piece mapping (History row → piece page) ===');
  savedToDetailTests();
  mergeTests();
  ownerCaseTests();
  sheetCardTests();
  purchaseRoundTripTests();
  historyFilterTests();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
