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
  HISTORY_DEFAULT_DIFFICULTY,
  HISTORY_DEFAULT_GENRE,
  HISTORY_DETAIL_DESCRIPTION,
  mergeCatalogIntoDetail,
  savedPieceToDetail,
  type CatalogPieceInfo,
} from '../src/services/historyPiece';
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

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== history piece mapping (History row → piece page) ===');
  savedToDetailTests();
  mergeTests();
  ownerCaseTests();
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
