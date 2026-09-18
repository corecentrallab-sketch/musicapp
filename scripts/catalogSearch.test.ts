/**
 * Unit tests for the "Find a piece" catalog search logic
 * (src/services/catalogSearch.ts) — the pure half of the screen whose network
 * half is `GET /api/pieces?q=` (live 2026-09-18):
 *
 *   ?q=fur       → 1 row (Bagatelle in A Minor (Für Elise), WoO 59)
 *   ?q=beethoven → 50 rows
 *   ?q=zzzznope  → 0 rows, success:true
 *   (no query)   → the catalog's first page, 525 pieces
 *
 * Every fixture below is a REAL row captured from that live endpoint
 * (2026-09-18), so a change that would break the real payload fails here.
 *
 * Run with: npm run test:tier1 — pure modules + plain Node, no app runtime, no
 * react-native, no network, same convention as the other scripts/*.test.ts.
 */
import {
  BROWSE_FIRST_N_MESSAGE,
  CATALOG_SEARCH_DEBOUNCE_MS,
  CATALOG_SEARCH_LIMIT,
  NO_MATCH_MESSAGE,
  SEARCH_DETAIL_DESCRIPTION,
  SHEET_BADGE_AVAILABLE,
  SHEET_BADGE_COMING_SOON,
  buildSearchPath,
  buildSearchUrl,
  catalogPieceToDetail,
  noMatchMessage,
  normalizeQuery,
  parseCatalogPiece,
  parseCatalogSearchResponse,
  resultsHeaderText,
  sheetBadgeLabel,
  sortPiecesForDisplay,
} from '../src/services/catalogSearch';
import type { CatalogPiece } from '../src/types';

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

/** Real API payload: GET /api/pieces?q=fur (live 2026-09-18). */
const API_FUR = {
  success: true,
  total: 1,
  offset: 0,
  limit: 20,
  pieces: [
    {
      id: '741700db-72cf-4c6d-9b61-cf1e091621ef',
      title: 'Bagatelle in A Minor (Für Elise)',
      composer: 'Ludwig van Beethoven',
      catalog: 'WoO 59',
      difficulty: 3,
      difficulty_label: 'Beginner',
      is_public_domain: true,
      sheet_music_available: false,
      sheet_music_url: null,
      album_art_url: null,
    },
  ],
};

/** Real API payload: GET /api/pieces?q=italian — the curated-score case. */
const API_ITALIAN = {
  success: true,
  total: 1,
  offset: 0,
  limit: 20,
  pieces: [
    {
      id: 'b2ffba94-592b-4f01-bf0a-f45dfb172f68',
      title: 'Italian Concerto in F Major',
      composer: 'Johann Sebastian Bach',
      catalog: 'BWV 971',
      difficulty: 8,
      difficulty_label: 'Advanced',
      is_public_domain: true,
      sheet_music_available: true,
      sheet_music_url:
        'https://site-notesnap.vercel.app/api/sheets/b2ffba94-592b-4f01-bf0a-f45dfb172f68.pdf',
      album_art_url: null,
    },
  ],
};

/** Real API payload: GET /api/pieces?q=zzzznope — the honest zero-result case. */
const API_NO_MATCH = {
  success: true,
  total: 0,
  offset: 0,
  limit: 20,
  pieces: [],
};

/** Real rows from GET /api/pieces?q=beethoven (live 2026-09-18), 3 of 50. */
const API_BEETHOVEN = {
  success: true,
  total: 50,
  offset: 0,
  limit: 3,
  pieces: [
    API_FUR.pieces[0],
    {
      id: '1c90f0ad-4c98-4652-ac41-464f07bb9890',
      title: 'Diabelli Variations',
      composer: 'Ludwig van Beethoven',
      catalog: 'Op. 120',
      difficulty: 10,
      difficulty_label: 'Advanced',
      is_public_domain: true,
      sheet_music_available: false,
      sheet_music_url: null,
      album_art_url: null,
    },
  ],
};

const FUR_ELISE: CatalogPiece = {
  id: '741700db-72cf-4c6d-9b61-cf1e091621ef',
  title: 'Bagatelle in A Minor (Für Elise)',
  composer: 'Ludwig van Beethoven',
  catalog: 'WoO 59',
  difficulty: 3,
  difficultyLabel: 'Beginner',
  isPublicDomain: true,
  sheetMusicAvailable: false,
  sheetMusicUrl: null,
  albumArtUrl: null,
};

const ITALIAN_CONCERTO: CatalogPiece = {
  id: 'b2ffba94-592b-4f01-bf0a-f45dfb172f68',
  title: 'Italian Concerto in F Major',
  composer: 'Johann Sebastian Bach',
  catalog: 'BWV 971',
  difficulty: 8,
  difficultyLabel: 'Advanced',
  isPublicDomain: true,
  sheetMusicAvailable: true,
  sheetMusicUrl:
    'https://site-notesnap.vercel.app/api/sheets/b2ffba94-592b-4f01-bf0a-f45dfb172f68.pdf',
  albumArtUrl: null,
};

// ─── parseCatalogSearchResponse ────────────────────────────────

function parseTests(): void {
  const fur = parseCatalogSearchResponse(API_FUR);
  assert(fur !== null, 'a real /api/pieces?q=fur body parses');
  assertEq(fur?.pieces.length, 1, 'the query returns its single row');
  assertEq(fur?.total, 1, 'the server total is carried through');
  assertEq(
    fur?.pieces[0].title,
    'Bagatelle in A Minor (Für Elise)',
    'the diacritic title survives parsing byte-for-byte',
  );
  assertEq(fur?.pieces[0].catalog, 'WoO 59', 'the catalog number is carried through');
  assertEq(fur?.pieces[0].difficulty, 3, 'the raw grade is carried through');
  assertEq(
    fur?.pieces[0].difficultyLabel,
    'Beginner',
    'the difficulty label is carried through',
  );

  const empty = parseCatalogSearchResponse(API_NO_MATCH);
  assert(empty !== null, 'a zero-result body is a real answer, not an error');
  assertEq(empty?.pieces.length, 0, 'zero-result body → zero rows');
  assertEq(empty?.total, 0, 'zero-result body → total 0');

  const beethoven = parseCatalogSearchResponse(API_BEETHOVEN);
  assertEq(beethoven?.total, 50, 'the match total (50) is reported, not just the page');
  assertEq(beethoven?.pieces.length, 2, 'only the rows sent are parsed');
  assertEq(
    beethoven?.pieces[0].title,
    'Bagatelle in A Minor (Für Elise)',
    'parser preserves the server order (sorting is a separate, tested step)',
  );

  const many = parseCatalogSearchResponse({
    success: true,
    total: 525,
    pieces: [API_FUR.pieces[0]],
  });
  assertEq(many?.total, 525, 'a browse total larger than the page is kept');

  // Malformed / hostile bodies → null (the screen shows error + Retry).
  assertEq(parseCatalogSearchResponse(null), null, 'null body → null (error state)');
  assertEq(
    parseCatalogSearchResponse(undefined),
    null,
    'undefined body → null (error state)',
  );
  assertEq(parseCatalogSearchResponse('nope'), null, 'a string body → null');
  assertEq(parseCatalogSearchResponse(42), null, 'a number body → null');
  assertEq(parseCatalogSearchResponse({}), null, 'a body with no pieces array → null');
  assertEq(
    parseCatalogSearchResponse({ success: true }),
    null,
    'success with no pieces array → null (never an empty list)',
  );
  assertEq(
    parseCatalogSearchResponse({ success: true, pieces: 'x' }),
    null,
    'a non-array pieces field → null',
  );
  assertEq(
    parseCatalogSearchResponse({ success: false, error: 'boom', pieces: [] }),
    null,
    'an explicit failure body → null, even when it carries an empty array',
  );

  // Junk inside a well-formed body: unusable rows are dropped, good ones stay.
  const mixed = parseCatalogSearchResponse({
    success: true,
    total: 3,
    pieces: [
      null,
      'nope',
      { id: 'no-title' },
      { title: 'No id' },
      { id: '   ', title: 'Blank id' },
      API_FUR.pieces[0],
    ],
  });
  assertEq(mixed?.pieces.length, 1, 'rows without an id or a title are dropped');
  assertEq(mixed?.pieces[0].id, FUR_ELISE.id, 'the usable row is the one kept');
  assertEq(
    mixed?.total,
    3,
    'the server total is still reported when rows were dropped',
  );

  const badTotal = parseCatalogSearchResponse({
    success: true,
    total: Number.NaN,
    pieces: [API_FUR.pieces[0]],
  });
  assertEq(badTotal?.total, 1, 'a NaN total falls back to the rows we hold');

  const smallTotal = parseCatalogSearchResponse({
    success: true,
    total: 0,
    pieces: [API_FUR.pieces[0]],
  });
  assertEq(
    smallTotal?.total,
    1,
    'a total smaller than the row count is not trusted over the rows',
  );
}

// ─── parseCatalogPiece (row-level honesty) ─────────────────────

function rowTests(): void {
  assertEq(parseCatalogPiece(null), null, 'a null row is dropped');
  assertEq(parseCatalogPiece('x'), null, 'a non-object row is dropped');
  assertEq(parseCatalogPiece({ title: 'Orphan' }), null, 'a row with no id is dropped');
  assertEq(parseCatalogPiece({ id: 'x' }), null, 'a row with no title is dropped');

  const fur = parseCatalogPiece(API_FUR.pieces[0]);
  assertEq(fur?.sheetMusicUrl, null, 'a piece without a curated score gets NO URL');
  assertEq(
    fur?.sheetMusicAvailable,
    false,
    'the availability flag is carried through for the badge',
  );
  assertEq(fur?.albumArtUrl, null, 'a null album-art URL stays null');

  const italian = parseCatalogPiece(API_ITALIAN.pieces[0]);
  assertEq(
    italian?.sheetMusicUrl,
    ITALIAN_CONCERTO.sheetMusicUrl,
    'a curated sheet URL is passed through byte-for-byte',
  );

  // A contradicting payload: a URL on a row the catalog says has no score.
  const contradicting = parseCatalogPiece({
    ...API_ITALIAN.pieces[0],
    sheet_music_available: false,
  });
  assertEq(
    contradicting?.sheetMusicUrl,
    null,
    'a sheet URL on a sheet_music_available:false row is dropped (never a link the catalog disowns)',
  );
  const blankUrl = parseCatalogPiece({
    ...API_ITALIAN.pieces[0],
    sheet_music_url: '   ',
  });
  assertEq(blankUrl?.sheetMusicUrl, null, 'a whitespace-only sheet URL is not a score');
  const missingUrl = parseCatalogPiece({
    ...API_ITALIAN.pieces[0],
    sheet_music_url: undefined,
  });
  assertEq(missingUrl?.sheetMusicUrl, null, 'a missing sheet URL does not become "undefined"');

  // Missing signals stay "unknown", never guessed true.
  const bare = parseCatalogPiece({ id: 'x', title: 'Bare Piece' });
  assertEq(bare?.isPublicDomain, false, 'an absent public-domain flag is not guessed true');
  assertEq(
    bare?.sheetMusicAvailable,
    false,
    'an absent sheet-availability flag is not guessed true',
  );
  assertEq(bare?.composer, '', 'an absent composer becomes an empty string, not null');
  assertEq(bare?.catalog, null, 'an absent catalog number stays null');
  assertEq(bare?.difficulty, null, 'an absent grade stays null');
  assertEq(bare?.difficultyLabel, null, 'an absent difficulty label stays null');

  const junk = parseCatalogPiece({
    id: 'x',
    title: 'Junk Piece',
    composer: '   ',
    catalog: '  ',
    difficulty: 'eight',
    difficulty_label: '  ',
    is_public_domain: 'yes',
    sheet_music_available: 1,
    sheet_music_url: 42,
  });
  assertEq(junk?.composer, '', 'a whitespace-only composer is treated as missing');
  assertEq(junk?.catalog, null, 'a whitespace-only catalog number stays null');
  assertEq(junk?.difficulty, null, 'a non-number grade is rejected');
  assertEq(junk?.difficultyLabel, null, 'a whitespace-only label stays null');
  assertEq(junk?.isPublicDomain, false, 'a truthy non-boolean flag is not a boolean true');
  assertEq(junk?.sheetMusicAvailable, false, 'a numeric 1 flag is not a boolean true');
  assertEq(junk?.sheetMusicUrl, null, 'a non-string sheet URL is dropped');

  const trimmed = parseCatalogPiece({
    id: '  x  ',
    title: '  Spaced Title  ',
    composer: '  Spaced Composer  ',
  });
  assertEq(trimmed?.id, 'x', 'a padded id is trimmed');
  assertEq(trimmed?.title, 'Spaced Title', 'a padded title is trimmed');
  assertEq(trimmed?.composer, 'Spaced Composer', 'a padded composer is trimmed');

  const nanGrade = parseCatalogPiece({
    id: 'x',
    title: 'NaN grade',
    difficulty: Number.NaN,
  });
  assertEq(nanGrade?.difficulty, null, 'a NaN grade is rejected rather than shown');
}

// ─── sortPiecesForDisplay ──────────────────────────────────────

function sortTests(): void {
  const soon = { ...FUR_ELISE, title: 'Zebra Piece' };
  const readyA = { ...ITALIAN_CONCERTO, title: 'Alpha Piece' };
  const readyB = { ...ITALIAN_CONCERTO, title: 'Beta Piece' };

  const input = [soon, readyB, readyA];
  const sorted = sortPiecesForDisplay(input);
  assertEq(sorted[0].title, 'Alpha Piece', 'sheet-ready pieces come first');
  assertEq(sorted[1].title, 'Beta Piece', 'sheet-ready pieces are alphabetical');
  assertEq(sorted[2].title, 'Zebra Piece', 'coming-soon pieces follow');
  assertEq(input[0].title, 'Zebra Piece', 'the input array is not re-ordered in place');
  assert(input !== sorted, 'a new array is returned');
  assertEq(input.length, 3, 'no row is lost or duplicated');

  const sameTitleA = { ...FUR_ELISE, title: 'Same', composer: 'Zed' };
  const sameTitleB = { ...FUR_ELISE, title: 'Same', composer: 'Anna' };
  const byComposer = sortPiecesForDisplay([sameTitleA, sameTitleB]);
  assertEq(byComposer[0].composer, 'Anna', 'equal titles fall back to composer order');

  const lower = { ...FUR_ELISE, title: 'apple' };
  const upper = { ...FUR_ELISE, title: 'Banana' };
  assertEq(
    sortPiecesForDisplay([upper, lower])[0].title,
    'apple',
    'sorting is case-insensitive, so "apple" precedes "Banana"',
  );

  assertEq(sortPiecesForDisplay([]).length, 0, 'sorting an empty page is safe');
  const single = sortPiecesForDisplay([FUR_ELISE]);
  assertEq(single.length, 1, 'sorting a single-row page is safe');
  assertEq(single[0].id, FUR_ELISE.id, 'the single row is unchanged');
}

// ─── URL building ──────────────────────────────────────────────

function urlTests(): void {
  assertEq(CATALOG_SEARCH_LIMIT, 20, 'the search page size is 20 (the API default)');
  assertEq(
    CATALOG_SEARCH_DEBOUNCE_MS,
    300,
    'the debounce is ~300 ms as briefed',
  );

  assertEq(
    buildSearchPath('fur'),
    '/api/pieces?limit=20&q=fur',
    'a plain query builds the documented search path',
  );
  assertEq(
    buildSearchPath('beethoven'),
    '/api/pieces?limit=20&q=beethoven',
    'the composer query builds the same shape',
  );
  assertEq(
    buildSearchPath('  fur  '),
    '/api/pieces?limit=20&q=fur',
    'a padded query is trimmed before it reaches the URL',
  );
  assertEq(
    buildSearchPath('Für Elise'),
    '/api/pieces?limit=20&q=F%C3%BCr%20Elise',
    'a diacritic + space query is URL-encoded (the endpoint is diacritic-tolerant)',
  );
  assertEq(
    buildSearchPath('bach & sons?'),
    '/api/pieces?limit=20&q=bach%20%26%20sons%3F',
    'URL-significant characters are encoded, so a query can never break the request',
  );
  assertEq(
    buildSearchPath(''),
    '/api/pieces?limit=20',
    'an empty query asks for the catalog first page (the browse state)',
  );
  assertEq(
    buildSearchPath('   '),
    '/api/pieces?limit=20',
    'a whitespace-only query is treated as empty',
  );
  assertEq(
    buildSearchPath('fur', 5),
    '/api/pieces?limit=5&q=fur',
    'an explicit page size is honoured',
  );
  assertEq(
    buildSearchPath('fur', 0),
    '/api/pieces?limit=20&q=fur',
    'a non-positive page size falls back to the default',
  );
  assertEq(
    buildSearchPath('fur', Number.NaN),
    '/api/pieces?limit=20&q=fur',
    'a NaN page size falls back to the default',
  );

  assertEq(
    buildSearchUrl('https://site-notesnap.vercel.app', 'fur'),
    'https://site-notesnap.vercel.app/api/pieces?limit=20&q=fur',
    'the absolute URL joins the production base',
  );
  assertEq(
    buildSearchUrl('https://site-notesnap.vercel.app/', 'fur'),
    'https://site-notesnap.vercel.app/api/pieces?limit=20&q=fur',
    'a trailing slash on the base does not double up',
  );
  assertEq(
    buildSearchUrl('https://example.test', ''),
    'https://example.test/api/pieces?limit=20',
    'the browse URL is absolute too',
  );
}

// ─── copy + badges ─────────────────────────────────────────────

function copyTests(): void {
  assertEq(
    normalizeQuery('  fur  '),
    'fur',
    'normalizeQuery trims a padded query',
  );
  assertEq(normalizeQuery(''), '', 'normalizeQuery passes an empty query through');
  assertEq(normalizeQuery(null), '', 'normalizeQuery turns null into an empty query');
  assertEq(
    normalizeQuery(undefined),
    '',
    'normalizeQuery turns undefined into an empty query',
  );
  assertEq(normalizeQuery('\t'), '', 'a tab-only query is empty');
  assertEq(
    normalizeQuery('für Elise'),
    'für Elise',
    'normalizeQuery keeps the user’s diacritics intact',
  );

  assertEq(
    NO_MATCH_MESSAGE,
    'No pieces match — try another title or composer',
    'the no-match copy is the briefed, honest sentence',
  );
  assertEq(noMatchMessage('zzzznope'), NO_MATCH_MESSAGE, 'noMatchMessage returns that copy');
  assertEq(
    noMatchMessage('zzzznope').includes('zzzznope'),
    false,
    'the no-match copy never echoes the failed query as a guess',
  );

  assertEq(
    SHEET_BADGE_AVAILABLE,
    '🎼 Sheet music',
    'the sheet badge copy is the briefed string',
  );
  assertEq(SHEET_BADGE_COMING_SOON, 'Coming soon', 'the coming-soon copy is the briefed string');
  assertEq(
    sheetBadgeLabel(true),
    '🎼 Sheet music',
    'a piece with a curated score gets the sheet badge',
  );
  assertEq(
    sheetBadgeLabel(false),
    'Coming soon',
    'a piece without a curated score honestly says coming soon',
  );

  assertEq(
    resultsHeaderText(5, '', 5),
    BROWSE_FIRST_N_MESSAGE,
    'an empty query is labelled as the catalog first page (not "popular")',
  );
  assert(
    /first 20/i.test(resultsHeaderText(525, '', 20)),
    'the browse header says how many pieces it is showing',
  );
  assertEq(resultsHeaderText(0, 'zzzznope', 0), '', 'no header for a zero-result search');
  assertEq(
    resultsHeaderText(1, 'fur', 1),
    '1 piece match “fur”',
    'a single match reads as one piece (singular)',
  );
  assertEq(
    resultsHeaderText(50, 'beethoven', 20),
    '50 pieces match “beethoven” · showing 20',
    'a larger match set says how many of them are on screen',
  );
  assertEq(
    resultsHeaderText(20, 'beethoven', 20),
    '20 pieces match “beethoven”',
    'no "showing" note when the whole match set is on screen',
  );
  assertEq(
    resultsHeaderText(2, 'für', 2),
    '2 pieces match “für”',
    'a diacritic query is reported verbatim (the user’s own spelling)',
  );
}

// ─── catalogPieceToDetail ──────────────────────────────────────

function detailTests(): void {
  const fur = catalogPieceToDetail(FUR_ELISE);
  assertEq(fur.id, FUR_ELISE.id, 'the detail keeps the catalog id (piece page lookups)');
  assertEq(fur.title, FUR_ELISE.title, 'the detail keeps the catalog title');
  assertEq(fur.composer, FUR_ELISE.composer, 'the detail keeps the composer');
  assertEq(fur.catalog, 'WoO 59', 'the catalog number is carried onto the piece page');
  assertEq(fur.difficulty, 'Beginner', 'the catalog difficulty label is used');
  assertEq(fur.difficultyGrade, 3, 'the raw grade is carried through');
  assertEq(fur.isPublicDomain, true, 'the public-domain signal is carried through');
  assertEq(
    fur.sheetMusicAvailable,
    false,
    'the coming-soon availability flag is carried through',
  );
  assertEq(
    fur.sheetMusicUrl,
    undefined,
    'no sheet link is invented for a piece with no curated score',
  );
  assertEq(fur.abc, null, 'no ABC reference is invented (the screen fetches it after the tap)');
  assertEq(
    fur.description,
    SEARCH_DETAIL_DESCRIPTION,
    'the piece page says where it was opened from',
  );
  assert(
    !/confidence|match\b/i.test(fur.description ?? ''),
    'the description never claims a match confidence — a search was typed, not heard',
  );

  const italian = catalogPieceToDetail(ITALIAN_CONCERTO);
  assertEq(
    italian.sheetMusicUrl,
    ITALIAN_CONCERTO.sheetMusicUrl,
    'a piece WITH a curated score opens that exact sheet URL',
  );
  assertEq(
    italian.sheetMusicUrl?.endsWith('.pdf'),
    true,
    'the sheet URL is the in-app-viewable PDF the other flows use',
  );
  assertEq(italian.sheetMusicAvailable, true, 'the sheet-ready flag is carried through');
  assertEq(italian.difficulty, 'Advanced', 'the Advanced label is carried through');

  const bare: CatalogPiece = {
    id: 'x',
    title: 'Bare Piece',
    composer: '',
    catalog: null,
    difficulty: null,
    difficultyLabel: null,
    isPublicDomain: true,
    sheetMusicAvailable: false,
    sheetMusicUrl: null,
    albumArtUrl: null,
  };
  const bareDetail = catalogPieceToDetail(bare);
  assertEq(
    bareDetail.difficulty,
    'Intermediate',
    'a piece with no difficulty label falls back to the honest default',
  );
  assertEq(bareDetail.difficultyGrade, null, 'a piece with no grade keeps null, not 0');
  assertEq(
    bareDetail.sheetMusicUrl,
    undefined,
    'a nameless-sheet piece still gets no invented link',
  );
  assertEq(bareDetail.catalog, null, 'a piece with no catalog number keeps null');

  const idempotentA = catalogPieceToDetail(ITALIAN_CONCERTO);
  const idempotentB = catalogPieceToDetail(ITALIAN_CONCERTO);
  assertEq(idempotentA.sheetMusicUrl, idempotentB.sheetMusicUrl, 'mapping is stable');
  assertEq(idempotentA.difficulty, idempotentB.difficulty, 'mapping is stable (difficulty)');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== catalog search (Find a piece) ===');
  parseTests();
  rowTests();
  sortTests();
  urlTests();
  copyTests();
  detailTests();
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
