/**
 * Tests for THE FIVE STYLE FAMILIES (v45 slice 3b) —
 * src/services/genreFamilies.ts, plus the REAL Discover surface and family
 * screen it is wired into (components/DiscoverStyles.tsx,
 * components/FamilyScreen.tsx, screens/HomeScreen.tsx).
 *
 * Owner-ratified all-genres scope, 2026-10-26: "the app is for music
 * enthusiasts, and we use the public domain" — so Discover shows FIVE style
 * families, never a classical-only grid, and four of them hold no free scores
 * and must still be a real door rather than a hole.
 *
 * The bug classes these guard, with no emulator available:
 *   • a family dropped from the surface (a classical-only grid creeping back);
 *   • a tile that is a no-op, opens something generic, or is greyed out;
 *   • an empty family with NO money path (its only resolution) — the mutation
 *     "set one family's `q` to ''" must fail this gate;
 *   • a count that was typed instead of derived (536 in the source, or a "0"
 *     printed next to an era);
 *   • a family screen that renders the free row ABOVE the money row, or mounts
 *     no purchase shell, or opens a retailer without a tap.
 *
 * Layout, like scripts/frontDoorBands.test.ts:
 *   1. THE TABLE + THE COPY — the five families, the six era chips, every string.
 *   2. THE MONEY PATH — one builder, id 67650, no retired routes.
 *   3. COUNTS FROM REAL ROWS — derived or omitted, never faked.
 *   4. THE TWO LAYOUTS + the family-screen model (ordering rules).
 *   5. PRE-FIX NEGATIVE FIXTURES — shapes that must FAIL these contracts.
 *   6. LIVE SOURCE SCAN — the real files off disk, with floors and inline
 *      mutation probes (comment-masked, so a commented-out tile cannot pass).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  DISCOVER_LAYOUT,
  DISCOVER_STYLE_LABEL,
  DISCOVER_WIRING_MARKERS,
  ERA_CHIPS,
  FAMILY_EMPTY_STATE_BODY,
  FAMILY_EMPTY_STATE_TITLE,
  FAMILY_FOOTER_TEST_ID,
  FAMILY_FREE_ROW_LABEL,
  FAMILY_MONEY_ROW_LABEL,
  FAMILY_OFFICIAL_LINE,
  FAMILY_SCREEN_MARKERS,
  FAMILY_STATE_EYEBROW,
  GENRE_FAMILIES,
  discoverFamilyRows,
  discoverStyleNote,
  emptyEraCounts,
  eraChipLabel,
  eraChipsRenderInTile,
  eraCountsFromPieces,
  eraCountsTotal,
  everyFamilyResolves,
  familiesOnMoneyPath,
  familiesWithFreeScores,
  familyAffiliateUrl,
  familyById,
  familyFooterLine,
  familyMoneyRowHint,
  familyScreenModel,
  familyTileSecondLine,
  familyTilesAreBackedByRealContent,
  maskSource,
  normalizeEra,
  type CatalogGenreRow,
  type GenreFamily,
} from '../src/services/genreFamilies';

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

// ─── helpers ────────────────────────────────────────────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
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

/** The five names, verbatim from the owner-ratified copy deck (design sheet 7). */
const EXPECTED_NAMES: readonly string[] = [
  'Classical',
  'Early Jazz & Blues',
  'Folk & Traditional',
  'Patriotic & Holiday',
  'Vaudeville, Opera & Parlor',
];

/** The six era labels, in render order. */
const EXPECTED_ERAS: readonly string[] = [
  'Renaissance',
  'Baroque',
  'Classical',
  'Romantic',
  'Impressionist',
  'Modern',
];

/** A complete catalog sample shaped like the real /api/pieces rows. */
function catalogRows(eras: readonly string[]): CatalogGenreRow[] {
  return eras.map((era, i) => ({ id: `p${i}`, title: `Piece ${i}`, genre: era }));
}

// ─── 1. the table and the copy ──────────────────────────────────

function tableAndCopyTests(): void {
  console.log('\nTHE FIVE FAMILIES — the owner-ratified names, in order');

  assertEq(GENRE_FAMILIES.length, 5, 'the table holds exactly five families');
  assertEq(
    GENRE_FAMILIES.map((family) => family.name).join(' | '),
    EXPECTED_NAMES.join(' | '),
    'the five tile names are verbatim, in the ratified order',
  );
  assert(
    GENRE_FAMILIES.every((family) => family.destination === 'family-screen'),
    'every family tile opens the family screen (no other destination exists)',
  );
  assert(
    GENRE_FAMILIES.every((family) => family.backedBy.trim().length > 0),
    'every family names what actually backs it',
  );
  assertEq(
    familiesWithFreeScores().map((family) => family.id).join(','),
    'classical',
    'exactly one family holds free scores today (Classical)',
  );
  assertEq(familiesOnMoneyPath().length, 4, 'the other four resolve via the money path');

  console.log('\nTHE SIX ERAS are chips INSIDE Classical, never top-level tiles');
  assertEq(ERA_CHIPS.length, 6, 'six era chips');
  assertEq(
    ERA_CHIPS.map((era) => era.label).join(' | '),
    EXPECTED_ERAS.join(' | '),
    'the six era labels, Renaissance → Modern',
  );
  assert(
    EXPECTED_ERAS.every((era) => !EXPECTED_NAMES.includes(era) || era === 'Classical'),
    'no catalogue era is also a top-level family tile (Classical is the family, the era is a chip)',
  );

  console.log('\nTHE COPY is the ratified string set');
  assertEq(FAMILY_OFFICIAL_LINE, 'Official sheet music', 'the empty tile line');
  assertEq(
    familyFooterLine(),
    'Free scores today: 1 of 5 style families',
    'the family screen footer line, derived from the table',
  );
  assertEq(FAMILY_EMPTY_STATE_TITLE, 'No free scores in this style yet', 'the empty state title');
  assert(
    FAMILY_EMPTY_STATE_BODY.indexOf('The free library grows one style at a time') === 0,
    'the empty state body keeps the growth framing (no date, no queue)',
  );
  assertEq(FAMILY_MONEY_ROW_LABEL, 'Official sheet music', 'the money row label');
  assertEq(FAMILY_FREE_ROW_LABEL, 'Browse what is free now', 'the free row label');
  assertEq(FAMILY_STATE_EYEBROW, 'FREE LIBRARY', 'the state card eyebrow');
  assertEq(DISCOVER_STYLE_LABEL, 'BROWSE BY STYLE', 'the Discover section label');
  assertEq(FAMILY_FOOTER_TEST_ID, 'family-footer', 'the footer test id the guard reads');

  console.log('\nNO BANNED PROMISE survives in the style copy');
  const banned = [/coming soon/i, /\bsoon\b/i, /check back soon/i, /still curating/i, /personali[sz]ed/i, /for you/i];
  const copyBag = [
    FAMILY_EMPTY_STATE_BODY,
    FAMILY_EMPTY_STATE_TITLE,
    FAMILY_OFFICIAL_LINE,
    discoverStyleNote(536),
    discoverStyleNote(null),
    familyFooterLine(),
    ...GENRE_FAMILIES.map((family) => family.subtitle),
    ...GENRE_FAMILIES.map((family) => familyMoneyRowHint(family)),
  ].join(' ');
  for (const pattern of banned) {
    assert(!pattern.test(copyBag), `style copy avoids ${String(pattern)}`);
  }
  assert(
    copyBag.indexOf('0 pieces') < 0 && copyBag.indexOf('0 free') < 0,
    'no "0 pieces" / "0 free scores" anywhere in the style copy',
  );
  assert(
    GENRE_FAMILIES.every((family) => familyTileSecondLine(family, 0) !== '0 pieces'),
    'a family with no free scores never renders a zero count',
  );

  console.log('\nTHE HONEST NOTE under BROWSE BY STYLE');
  assertEq(
    discoverStyleNote(536),
    '536 free scores today, all in Classical. The four other styles open official editions.',
    'with a real count the note prints it and names the populated family',
  );
  assertEq(
    discoverStyleNote(null),
    'Free scores today are all in Classical. The four other styles open official editions.',
    'with no count the note omits the number instead of guessing',
  );
}

// ─── 2. the money path ──────────────────────────────────────────

function moneyPathTests(): void {
  console.log('\nTHE MONEY PATH — the app’s own affiliate builder, every family');

  for (const family of GENRE_FAMILIES) {
    const url = familyAffiliateUrl(family);
    assert(!!url, `${family.name}: resolves to a retailer URL`);
    if (!url) continue;
    assert(url.indexOf('https://www.sheetmusicdirect.com') === 0, `${family.name}: SMD origin`);
    assert(url.indexOf('67650') >= 0, `${family.name}: carries affiliate id 67650`);
    assert(url.indexOf('/search/go') < 0, `${family.name}: no retired /search/go route`);
    assert(url.indexOf('w=') < 0, `${family.name}: no Musicnotes w= param on the SMD link`);
    assert(
      url.indexOf(encodeURIComponent(family.q)) >= 0,
      `${family.name}: the search is this family's own phrase (${family.q})`,
    );
  }

  console.log('\nTHE EMPTY FAMILIES still carry the four style searches');
  const searches = familiesOnMoneyPath().map((family) => family.q).join(' | ');
  assertEq(searches, 'ragtime | sea shanty | christmas carol | vaudeville', 'the four style phrases');
}

// ─── 3. counts derived from real rows ───────────────────────────

function countTests(): void {
  console.log('\nCOUNTS COME FROM REAL ROWS — or they are omitted');

  const eras = [
    ...Array(9).fill('Renaissance'),
    ...Array(154).fill('Baroque'),
    ...Array(111).fill('Classical'),
    ...Array(227).fill('Romantic'),
    ...Array(24).fill('Impressionist'),
    ...Array(11).fill('Modern'),
  ];
  const rows = catalogRows(eras as readonly string[]);
  assertEq(rows.length, 536, 'the fixture is a 536-row catalog');
  const counts = eraCountsFromPieces(rows, 536);
  assert(counts !== null, 'a COMPLETE sample of rows that carry eras yields counts');
  if (counts) {
    assertEq(counts.Renaissance, 9, 'Renaissance 9');
    assertEq(counts.Baroque, 154, 'Baroque 154');
    assertEq(counts.Classical, 111, 'Classical 111');
    assertEq(counts.Romantic, 227, 'Romantic 227');
    assertEq(counts.Impressionist, 24, 'Impressionist 24');
    assertEq(counts.Modern, 11, 'Modern 11');
    assertEq(eraCountsTotal(counts), 536, 'the era counts sum to the catalog total');
  }

  assertEq(
    eraCountsFromPieces(rows, 2000),
    null,
    'an INCOMPLETE page (rows < total) yields null — never a slice counted as the library',
  );
  assertEq(eraCountsFromPieces([], 0), null, 'no rows → null');
  assertEq(eraCountsFromPieces(rows, 0), null, 'no total → null');
  assertEq(
    eraCountsFromPieces([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], 2),
    null,
    'rows WITHOUT `genre` (the live backend before 3a deploys) → null, not zeros',
  );
  assertEq(
    eraCountsFromPieces(
      catalogRows(['Baroque', '', 'Joy of Man\'s Desiring', 'Romantic']),
      4,
    )?.Baroque,
    1,
    'a junk or empty genre value is not counted as an era',
  );
  assertEq(
    normalizeEra('Classical/Romantic'),
    'Classical',
    'the legacy merged tag resolves to its real era',
  );
  assertEq(normalizeEra(undefined), null, 'an absent genre is null, never a default');
  assertEq(normalizeEra(null), null, 'a null genre is null');
  assertEq(normalizeEra('baroque'), 'Baroque', 'era matching is case-insensitive');

  console.log('\nCHIP LABELS — a count when real, the name alone when not, never "Baroque 0"');
  assertEq(eraChipLabel('Baroque', counts), 'Baroque 154', 'a real count is printed');
  assertEq(eraChipLabel('Baroque', null), 'Baroque', 'no counts → the name alone');
  assertEq(eraChipLabel('Baroque', emptyEraCounts()), 'Baroque', 'a zero count prints no number');
  assertEq(
    eraChipLabel('Modern', counts),
    'Modern 11',
    'the smallest real era count still prints',
  );

  console.log('\nTILE SECOND LINES');
  const classical = familyById('classical') as GenreFamily;
  const jazz = familyById('early-jazz-blues') as GenreFamily;
  assertEq(familyTileSecondLine(classical, 536), '536 pieces', 'the populated tile shows its count');
  assertEq(familyTileSecondLine(classical, null), '', 'with no count it shows nothing');
  assertEq(
    familyTileSecondLine(jazz, 0),
    'Official sheet music',
    'an empty family shows its money path, never a count',
  );
  assertEq(
    familyTileSecondLine(jazz, 536),
    'Official sheet music',
    'an empty family never borrows the library count',
  );
}

// ─── 4. the layouts and the family screen ───────────────────────

function layoutAndScreenTests(): void {
  console.log('\nTHE LAYOUT FLAG — both layouts render all five families');
  assertEq(DISCOVER_LAYOUT, 'hero-classical', 'the shipped default is hero-classical');

  const heroRows = discoverFamilyRows('hero-classical');
  assertEq(heroRows.length, 5, 'hero-classical renders five rows');
  assertEq(heroRows[0].kind, 'hero', 'hero-classical leads with a full-width tile');
  assertEq(heroRows[0].family.id, 'classical', 'the hero tile is Classical');
  assertEq(
    new Set(heroRows.map((row) => row.family.id)).size,
    5,
    'hero-classical shows every family exactly once',
  );
  assert(eraChipsRenderInTile('hero-classical'), 'the eras render INSIDE the Classical tile');

  const equalRows = discoverFamilyRows('equal');
  assertEq(equalRows.length, 5, 'equal renders five rows');
  assertEq(
    equalRows.filter((row) => row.kind === 'tile').length,
    4,
    'equal is a 2×2 grid plus one full-width tile',
  );
  assertEq(equalRows[4].kind, 'wide', 'the fifth tile is full width in equal');
  assertEq(
    new Set(equalRows.map((row) => row.family.id)).size,
    5,
    'equal shows every family exactly once',
  );
  assert(!eraChipsRenderInTile('equal'), 'in equal the era fold moves into Classical’s screen');

  console.log('\nTHE FAMILY SCREEN MODEL — money FIRST for an empty family');
  const jazz = familyById('early-jazz-blues') as GenreFamily;
  const jazzModel = familyScreenModel(jazz, { freeCount: 536 });
  assert(jazzModel.moneyFirst, 'an empty family leads with the money path');
  assertEq(jazzModel.rows[0].kind, 'money', 'row 1 is the money row');
  assertEq(jazzModel.rows[1].kind, 'library', 'row 2 is the free library');
  assert(!!jazzModel.rows[0].url, 'the money row carries a live URL');
  assertEq(jazzModel.stateTitle, 'No free scores in this style yet', 'the honest state title');
  assertEq(jazzModel.footer, 'Free scores today: 1 of 5 style families', 'the footer line');
  assertEq(jazzModel.eraChips.length, 0, 'an empty family shows no era chips');

  const classical = familyById('classical') as GenreFamily;
  const classicalModel = familyScreenModel(classical, { freeCount: 536, eraCounts: null });
  assertEq(classicalModel.rows[0].kind, 'library', 'the populated family leads with free scores');
  assertEq(classicalModel.rows[1].kind, 'money', 'its money row is still one tap away');
  assertEq(classicalModel.eraChips.length, 6, 'the populated family carries the six era chips');
  assert(!classicalModel.moneyFirst, 'the populated family is not money-first');

  console.log('\nEVERY FAMILY RESOLVES (the model half of the guard)');
  assert(everyFamilyResolves(), 'the shipped table passes');

  // ── NEGATIVE FIXTURES: shapes that MUST fail ──
  const noPhrase: GenreFamily = { ...jazz, q: '' };
  assert(!everyFamilyResolves([classical, noPhrase, ...GENRE_FAMILIES.slice(2)]),
    'PRE-FIX: an empty family with no search phrase is a dead tile → fails');
  const noBacking: GenreFamily = { ...jazz, backedBy: '  ' };
  assert(!everyFamilyResolves([classical, noBacking, ...GENRE_FAMILIES.slice(2)]),
    'PRE-FIX: a family that names no backing content → fails');
  const noDestination = { ...jazz, destination: 'none' as unknown as GenreFamily['destination'] };
  assert(!everyFamilyResolves([classical, noDestination, ...GENRE_FAMILIES.slice(2)]),
    'PRE-FIX: a family with no real destination → fails');
  const noSubtitle: GenreFamily = { ...jazz, subtitle: '' };
  assert(!everyFamilyResolves([classical, noSubtitle, ...GENRE_FAMILIES.slice(2)]),
    'PRE-FIX: a family screen with no honest subtitle → fails');
}

// ─── 5. the live source scan ────────────────────────────────────

function liveScanTests(): void {
  console.log('\nLIVE SCAN — the REAL Discover surface and family screen');

  const home = readAppFile('src/screens/HomeScreen.tsx');
  const familyScreen = readAppFile('src/components/FamilyScreen.tsx');
  const tiles = readAppFile('src/components/DiscoverStyles.tsx');

  // FLOORS: a broken walk must not pass vacuously.
  assert(home.length > 5000, `HomeScreen really read (${home.length} chars)`);
  assert(familyScreen.length > 2000, `FamilyScreen really read (${familyScreen.length} chars)`);
  assert(tiles.length > 1000, `DiscoverStyles really read (${tiles.length} chars)`);
  assert(home.indexOf('BAND_TEST_IDS.discover') >= 0, 'HomeScreen carries the Discover band');
  assert(
    home.indexOf('<DiscoverStyles') >= 0,
    'the Discover band really mounts the style tiles',
  );

  const bundle = { discover: home, familyScreen, tiles };
  assert(familyTilesAreBackedByRealContent(bundle), 'the shipped wiring passes the guard');

  for (const marker of DISCOVER_WIRING_MARKERS) {
    assert(home.indexOf(marker) >= 0, `Discover wiring marker present: ${marker}`);
  }
  for (const marker of FAMILY_SCREEN_MARKERS) {
    assert(familyScreen.indexOf(marker) >= 0, `family screen marker present: ${marker}`);
  }
  assert(
    tiles.indexOf('discoverFamilyRows') >= 0,
    'the tile grid renders the ROWS FROM THE TABLE (not a hardcoded list)',
  );
  assert(
    tiles.indexOf('onOpenFamily(family.id)') >= 0,
    'each tile tap carries the family id into the one handler',
  );
  assert(
    EXPECTED_NAMES.every((name) => maskSource(tiles).indexOf(name) < 0),
    'the tile component hardcodes no family name — the table is the only source',
  );

  console.log('\nTAP-ONLY: nothing opens a retailer on mount');
  const maskedFamily = maskSource(familyScreen);
  assert(maskedFamily.indexOf('Linking.openURL') < 0, 'the family screen never leaves the app');
  assert(maskedFamily.indexOf('useEffect(') < 0, 'the family screen runs no effect on mount');
  const openCalls = maskedFamily.split('handleOpenRetailer(').length - 1;
  assertEq(openCalls, 1, 'exactly one tap-driven retailer open (the onPress call site)');

  console.log('\nMUTATION PROBES on the REAL source (the guard must bite)');
  // 1. the tile grid unmounted from Discover
  const noTiles = home.replace(/DiscoverStyles/g, 'SomeOtherBlock');
  assert(!familyTilesAreBackedByRealContent({ ...bundle, discover: noTiles }),
    'PROBE: removing the tile grid from Discover fails the guard');
  // 2. the family screen unmounted
  const noFamilyScreen = home.replace('<FamilyScreen', '<SomeOtherScreen');
  assert(!familyTilesAreBackedByRealContent({ ...bundle, discover: noFamilyScreen }),
    'PROBE: removing the family-screen mount fails the guard');
  // 3. the tap detached from the family handler
  const noHandler = home.replace('onOpenFamily={handleOpenFamily}', 'onOpenFamily={() => {}}');
  assert(!familyTilesAreBackedByRealContent({ ...bundle, discover: noHandler }),
    'PROBE: detaching the tile tap from handleOpenFamily fails the guard');
  // 4. the money row renamed on the family screen (ordering cannot be proven)
  const noMoneyRow = familyScreen.replace("'family-money-row'", "'row-a'");
  assert(!familyTilesAreBackedByRealContent({ ...bundle, familyScreen: noMoneyRow }),
    'PROBE: a family screen without its money row fails the guard');
  // 5. the family screen builds its rows locally instead of from the model
  const noModel = familyScreen.replace(/familyScreenModel\(/g, 'someLocalRows(');
  assert(!familyTilesAreBackedByRealContent({ ...bundle, familyScreen: noModel }),
    'PROBE: a family screen not driven by the honest model fails the guard');
  // 6. the tiles no longer come from the table
  const hardcodedTiles = tiles.replace(/discoverFamilyRows/g, 'someOtherRows');
  assert(!familyTilesAreBackedByRealContent({ ...bundle, tiles: hardcodedTiles }),
    'PROBE: a tile grid not driven by the family table fails the guard');
  // 7. a tile with NO free scores and NO search phrase (the designer's mutation)
  const deadFamily = familyById('folk-traditional') as GenreFamily;
  assert(!everyFamilyResolves([GENRE_FAMILIES[0], { ...deadFamily, q: '' }, ...GENRE_FAMILIES.slice(2)]),
    'PROBE: setting one empty family’s q to empty fails the guard');
  // 8. A COMMENTED-OUT tile block must not satisfy the scan
  const tileStart = home.indexOf('<DiscoverStyles');
  const tileEnd = home.indexOf('/>', tileStart) + 2;
  const commented =
    home.slice(0, tileStart) + '/* ' + home.slice(tileStart, tileEnd) + ' */' + home.slice(tileEnd);
  assert(maskSource(commented).indexOf('<DiscoverStyles') < 0,
    'PROBE: the commented-out block really is masked out');
  assert(!familyTilesAreBackedByRealContent({ ...bundle, discover: commented }),
    'PROBE: a commented-out tile grid fails the guard (comments are masked)');
  // …and the UNCOMMENTED original still passes, so the probe proves the masking
  assert(familyTilesAreBackedByRealContent(bundle), 'the original source still passes');

  console.log('\nMASKING sanity — the guard reads code, not documentation');
  assertEq(maskSource('a // <DiscoverStyles\nb').indexOf('<DiscoverStyles'), -1,
    'a line comment is masked');
  assertEq(maskSource('/* <DiscoverStyles */x').indexOf('<DiscoverStyles'), -1,
    'a block comment is masked');
  assert(maskSource('x = "<DiscoverStyles"').indexOf('<DiscoverStyles') >= 0,
    'a string literal is NOT masked (real code still counts)');
  assertEq(maskSource('a // c\nb').length, 'a // c\nb'.length, 'masking preserves length');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('v45 slice 3b — the five style families');
  tableAndCopyTests();
  moneyPathTests();
  countTests();
  layoutAndScreenTests();
  liveScanTests();
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
