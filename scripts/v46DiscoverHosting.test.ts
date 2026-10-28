/**
 * Tests for WHERE THE DISCOVER SURFACE LIVES (v46 corrective) —
 * src/services/v46DiscoverHosting.ts, against the REAL screens:
 * src/screens/HomeScreen.tsx and src/screens/FindPieceScreen.tsx.
 *
 * The bug class, in one line: the browse block (five-family grid + facet chips +
 * free-library row + honest note) was mounted inside Home's Discover band, so the
 * owner saw "home and discover are on one page" on device. No existing guard can
 * see it — they all ask "is the wiring present somewhere", and every one of them
 * passes while the block sits on the wrong file. These two predicates are the only
 * place the HOSTING is asserted:
 *   (a) homeIsMinimalVariantA(home) — the browse block's markers are NOT in Home's
 *       code (comments are masked, so Home's explanatory notes are allowed);
 *   (b) discoverSurfaceCarriesTheFamilies(findPiece) — every marker of the block
 *       IS on the Discover surface (FindPieceScreen).
 *
 * Both directions are proven here on the real sources with inline mutation
 * probes, because a hosting guard that cannot fail is worse than no guard.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  DISCOVER_CONTENT_MARKERS,
  DISCOVER_HOST_FILE,
  HOME_BANNED_MARKERS,
  HOME_FILE,
  discoverHostingIsSplit,
  discoverSurfaceCarriesTheFamilies,
  homeIsMinimalVariantA,
} from '../src/services/v46DiscoverHosting';
import { DISCOVER_SOURCE_FILE, maskSource } from '../src/services/genreFamilies';

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

/** The masked source, for reporting WHICH marker a probe tripped on. */
function maskedHits(source: string, markers: readonly string[]): string[] {
  const masked = maskSource(source);
  return markers.filter((marker) => masked.indexOf(marker) >= 0);
}

/** The markers a source is MISSING (the (b) direction: content must be there). */
function missingFrom(source: string, markers: readonly string[]): string[] {
  const masked = maskSource(source);
  return markers.filter((marker) => masked.indexOf(marker) < 0);
}

/** The door's Discover band container, as it really renders (mutation anchor). */
const HOME_DISCOVER_BAND = '<View style={styles.band} testID={BAND_TEST_IDS.discover}>';

// ─── 1. the marker lists ────────────────────────────────────────

function markerListTests(): void {
  console.log('\nthe two marker lists');

  assert(DISCOVER_CONTENT_MARKERS.length >= 12,
    `the content list covers the whole block (${DISCOVER_CONTENT_MARKERS.length} markers)`);
  assert(HOME_BANNED_MARKERS.length >= 12,
    `the banned list covers the whole block (${HOME_BANNED_MARKERS.length} markers)`);

  // The content list's job: the families, their tap, the money rows.
  for (const required of [
    '<DiscoverStyles',
    'onOpenFamily={handleOpenFamily}',
    '<FamilyScreen',
    'styles.bandChip',
    'styles.browseLibraryRow',
    '{FRONT_DOOR_BETA_NOTE}',
    'sheetMusicDirectSearchUrl(',
  ]) {
    assert(DISCOVER_CONTENT_MARKERS.indexOf(required) >= 0,
      `the content list requires ${required}`);
  }
  // The banned list's job: the same block, as it looked on Home.
  for (const required of [
    '<DiscoverStyles',
    '<FamilyScreen',
    'styles.bandChip',
    'styles.browseLibraryRow',
    '{FRONT_DOOR_BETA_NOTE}',
    'BAND_TITLES.discover',
    'DISCOVER_BAND_NOTE',
  ]) {
    assert(HOME_BANNED_MARKERS.indexOf(required) >= 0,
      `the banned list forbids ${required}`);
  }
  // The door's OWN furniture is not banned — moving the block never unplugged it.
  // (`onBrowseLibrary={handleBrowseLibraryFromModern}` is the MODERN-SONG card's
  // destination, a different offer; the Explore free-scores row no longer takes a
  // prop at all since the v46 defect fix — see services/v46DefectSweep.ts.)
  for (const allowed of [
    'styles.findASongBar',
    'handleFindAnySong',
    'onBrowseLibrary={handleBrowseLibraryFromModern}',
    '<FindPieceScreen',
  ]) {
    assert(HOME_BANNED_MARKERS.indexOf(allowed) < 0,
      `the banned list leaves the door's own marker alone: ${allowed}`);
  }
  // The hosting is stated once, in two modules, and they may not drift.
  assertEq(DISCOVER_HOST_FILE, DISCOVER_SOURCE_FILE, 'both modules name the same host file');
  assertEq(HOME_FILE, 'src/screens/HomeScreen.tsx', 'the door is HomeScreen');
  assert(DISCOVER_HOST_FILE.indexOf('FindPieceScreen') > 0,
    'the host named is FindPieceScreen (Discover = FindPieceScreen extended)');
}

// ─── 2. floors: a broken read must not pass ────────────────────

function floorTests(): void {
  console.log('\nfloors — an empty or truncated read fails both predicates');

  assertEq(homeIsMinimalVariantA(''), false, 'no Home source → (a) fails');
  assertEq(homeIsMinimalVariantA('const x = 1;'), false, 'a tiny Home source → (a) fails');
  assertEq(discoverSurfaceCarriesTheFamilies(''), false, 'no Discover source → (b) fails');
  assertEq(
    discoverSurfaceCarriesTheFamilies('const x = 1;'),
    false,
    'a tiny Discover source → (b) fails',
  );
  assertEq(discoverHostingIsSplit('', ''), false, 'the combined gate fails on empty sources');
  // The door's own band container + bar are required, so a stripped file fails.
  assertEq(
    homeIsMinimalVariantA('x'.repeat(20001)),
    false,
    '(a) fails on a long source that is not the door',
  );
}

// ─── 3. the live scan ──────────────────────────────────────────

function liveScanTests(): void {
  console.log('\nLIVE SCAN — the real door and the real Discover surface');

  const home = readAppFile(HOME_FILE);
  const findPiece = readAppFile(DISCOVER_HOST_FILE);

  assert(home.length > 20000, `read ${HOME_FILE} (${home.length} chars)`);
  assert(findPiece.length > 4000, `read ${DISCOVER_HOST_FILE} (${findPiece.length} chars)`);

  // FLOORS: the files really are what this suite thinks they are.
  assert(maskSource(home).indexOf('BAND_TEST_IDS.discover') >= 0,
    'Home really renders its Discover band container');
  assert(maskSource(home).indexOf('handleFindAnySong') >= 0,
    'Home really renders the one search entry that opens Discover');
  assert(findPiece.indexOf('DiscoverStyles') >= 0,
    'FindPieceScreen really is the Discover surface');

  const homeHits = maskedHits(home, HOME_BANNED_MARKERS);
  assertEq(homeHits.join(', '), '',
    'the door carries NO browse-block CODE (comments are masked and allowed)');
  const findMissing = missingFrom(findPiece, DISCOVER_CONTENT_MARKERS);
  assertEq(findMissing.join(', '), '',
    'the Discover surface carries EVERY browse-block marker');

  assertEq(homeIsMinimalVariantA(home), true, '(a) the shipped Home is minimal Variant A');
  assertEq(
    discoverSurfaceCarriesTheFamilies(findPiece),
    true,
    '(b) the shipped FindPieceScreen carries the five families + the money rows',
  );
  assertEq(discoverHostingIsSplit(home, findPiece), true, 'both halves together pass');

  // The explanatory comments Home keeps are NOT offences: they mention the moved
  // components by name, and a guard that failed on them would be deleted within a
  // week. Prove masking is what makes that true.
  console.log('\nDOCUMENTATION vs CODE — the three surviving Home comments');
  const commentMentions = ['<DiscoverStyles', '<FamilyScreen', 'selectedFamily', 'familyCounts'];
  for (const mention of commentMentions) {
    const raw = home.indexOf(mention) >= 0;
    const code = maskSource(home).indexOf(mention) >= 0;
    assert(!code, `${mention} appears only in masked-out documentation (raw=${raw})`);
  }
}

// ─── 4. MUTATION PROOFS on the real sources ────────────────────

function mutationProbes(): void {
  console.log('\nMUTATION PROBES on the REAL sources (each guard must bite)');

  const home = readAppFile(HOME_FILE);
  const findPiece = readAppFile(DISCOVER_HOST_FILE);
  assert(maskSource(home).indexOf(HOME_DISCOVER_BAND) >= 0,
    'the mutation anchor (Home\'s Discover band) exists');

  // ── (i) the tile grid comes back onto the door ──
  const gridBack = home.replace(
    HOME_DISCOVER_BAND,
    HOME_DISCOVER_BAND +
      '\n          <DiscoverStyles layout={DISCOVER_LAYOUT} freeCount={familyCounts ? familyCounts.total : null} onOpenFamily={handleOpenFamily} />',
  );
  assert(gridBack !== home, 'the grid-back mutation changed the real Home source');
  assertEq(
    homeIsMinimalVariantA(gridBack),
    false,
    'MUTATION (i): re-inserting <DiscoverStyles into Home\'s discover band FAILS (a)',
  );
  assert(maskedHits(gridBack, HOME_BANNED_MARKERS).indexOf('<DiscoverStyles') >= 0,
    'MUTATION (i) trips on the exact banned marker: <DiscoverStyles');

  // ── (ii) the grid is deleted from the Discover surface ──
  const noGrid = findPiece.split('<DiscoverStyles').join('<SomeOtherBlock');
  assert(noGrid !== findPiece, 'the grid-gone mutation changed the real Discover source');
  assertEq(
    discoverSurfaceCarriesTheFamilies(noGrid),
    false,
    'MUTATION (ii): deleting <DiscoverStyles from FindPieceScreen FAILS (b)',
  );
  assert(missingFrom(noGrid, DISCOVER_CONTENT_MARKERS).indexOf('<DiscoverStyles') >= 0,
    'MUTATION (ii) trips on the exact missing marker: <DiscoverStyles');

  // ── (iii) the facet chip row + the free-library copy come back to the door ──
  const chipsBack = home.replace(
    HOME_DISCOVER_BAND,
    HOME_DISCOVER_BAND +
      '\n          <View style={styles.bandChipRow}>{facets.map((facet) => <TouchableOpacity key={facet.id} style={styles.bandChip} onPress={() => handleFacetChip(facet.id)}><Text style={styles.bandChipText}>{facet.label}</Text></TouchableOpacity>)}</View>' +
      '\n          <TouchableOpacity style={styles.browseLibraryRow} onPress={handleBrowseLibrary}><Text style={styles.browseLibraryTitle}>{BROWSE_LIBRARY_LABEL}</Text><Text style={styles.browseLibraryBetaNote}>{FRONT_DOOR_BETA_NOTE}</Text></TouchableOpacity>',
  );
  assert(chipsBack !== home, 'the chips-back mutation changed the real Home source');
  assertEq(
    homeIsMinimalVariantA(chipsBack),
    false,
    'MUTATION (iii): restoring the facet chip row + free-library copy to Home FAILS (a)',
  );
  const chipHits = maskedHits(chipsBack, HOME_BANNED_MARKERS);
  assert(
    chipHits.indexOf('styles.bandChip') >= 0 && chipHits.indexOf('{FRONT_DOOR_BETA_NOTE}') >= 0,
    `MUTATION (iii) trips on the restored rows: ${chipHits.slice(0, 6).join(', ')}`,
  );

  // ── extra: the band heading comes back (the v45 labelled band) ──
  const headingBack = home.replace(
    HOME_DISCOVER_BAND,
    HOME_DISCOVER_BAND + '\n          <Text style={styles.bandTitle}>{BAND_TITLES.discover}</Text>',
  );
  assert(headingBack !== home, 'the heading-back mutation changed the real Home source');
  assertEq(
    homeIsMinimalVariantA(headingBack),
    false,
    'MUTATION: re-adding the band heading (BAND_TITLES.discover) FAILS (a)',
  );

  // ── extra: the family screen is mounted on the door again ──
  const familyScreenBack = home.replace(
    HOME_DISCOVER_BAND,
    HOME_DISCOVER_BAND + '\n          <FamilyScreen family={selectedFamily} onClose={() => {}} />',
  );
  assert(familyScreenBack !== home, 'the family-screen-back mutation changed the real Home source');
  assertEq(
    homeIsMinimalVariantA(familyScreenBack),
    false,
    'MUTATION: mounting <FamilyScreen on the door again FAILS (a)',
  );

  // ── extra: a chip on the Discover surface loses its destination ──
  const chipDead = findPiece.replace(
    'onPress={() => handleFacetChip(facet.id)}',
    'onPress={undefined}',
  );
  assert(chipDead !== findPiece, 'the dead-chip mutation changed the real Discover source');
  assertEq(
    discoverSurfaceCarriesTheFamilies(chipDead),
    false,
    'MUTATION: a facet chip with no destination FAILS (b) — the dead-CTA class',
  );

  // ── extra: the money facet stops reaching the licensed search ──
  const moneyGone = findPiece.replace(/sheetMusicDirectSearchUrl\(/g, 'someBuilder(');
  assert(moneyGone !== findPiece, 'the money-gone mutation changed the real Discover source');
  assertEq(
    discoverSurfaceCarriesTheFamilies(moneyGone),
    false,
    'MUTATION: the money facet no longer building the SMD search FAILS (b)',
  );

  // ── extra: a COMMENTED-OUT grid does not satisfy the Discover half ──
  const start = findPiece.indexOf('<DiscoverStyles');
  const end = findPiece.indexOf('/>', start) + 2;
  const commented =
    findPiece.slice(0, start) + '/* ' + findPiece.slice(start, end) + ' */' + findPiece.slice(end);
  assertEq(
    discoverSurfaceCarriesTheFamilies(commented),
    false,
    'MUTATION: a commented-out grid FAILS (b) (comments are masked)',
  );

  // ── extra: the combined gate fails if EITHER half fails ──
  assertEq(discoverHostingIsSplit(gridBack, findPiece), false, 'combined gate fails on (a) alone');
  assertEq(discoverHostingIsSplit(home, noGrid), false, 'combined gate fails on (b) alone');

  // …and the untouched sources still pass, so every probe above proved the guard
  // rather than a broken fixture.
  assertEq(discoverHostingIsSplit(home, findPiece), true, 'the originals still pass');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('v46 corrective — Discover lives on the Discover surface, not on Home');
  markerListTests();
  floorTests();
  liveScanTests();
  mutationProbes();
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
