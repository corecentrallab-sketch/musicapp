/**
 * sampleBadge.test.ts — UX round 1, step 1: THE SAMPLE / EXCERPT BADGE
 * (owner 10-18 item 5; spec ux-round-1/owner-five-items.md §5 + ux-blueprint.md §5).
 *
 * The badge exists because the owner opened the built-in four-bar "Für Elise" and
 * saw four bars — the DATA, not a broken renderer. Its whole point is HONESTY, so
 * this suite guards two things no screenshot can:
 *
 *   1. THE WORDS ARE DERIVED FROM THE SCORE. There is no way to pass a label in —
 *      the component takes the score and this suite reads every surface's real
 *      source and fails if a `label=` / `text=` / `copy=` prop ever appears on it.
 *   2. THE FULL-SCORE CLAUSE IS EARNED. "· tap for the full piece" is reachable
 *      only through the `full-score-opens-on-tap` state, which a surface must be
 *      able to prove — and the pure logic below proves it cannot be produced
 *      without a real curated score URL.
 *
 * Layers, the team's usual shape: PURE LOGIC → PRE-FIX FIXTURES (verbatim, each
 * asserted to FAIL the guard) → LIVE SOURCE SCAN (with floors) → MUTATION PROBES.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  SAMPLE_BADGE_EXCERPT_ONLY_CLAUSE,
  SAMPLE_BADGE_FULL_SCORE_ON_TAP_CLAUSE,
  SAMPLE_BADGE_WHOLE_LIBRARY_CLAUSE,
  featuredPieceLibraryState,
  piecePageLibraryState,
  sampleBadgeBlocks,
  sampleBadgeDerivesItsWords,
  sampleBadgeIsRenderedOn,
  sampleBadgeLabel,
  sampleBadgeStatesItsLibraryState,
  sampleBadgeTakesNoCopy,
} from '../src/services/sampleBadge';
import { PUBLIC_DOMAIN_ABC_SCORES } from '../src/data/abcScores';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
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
  throw new Error('could not find the repo root from ' + process.cwd());
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

/** Every file this feature touches, in the order the badge reached them. */
const BADGE_COMPONENT_PATH = 'src/components/SampleBadge.tsx';
const BADGE_SERVICE_PATH = 'src/services/sampleBadge.ts';
/** The surfaces that show a bundled excerpt score. */
export const SAMPLE_BADGE_SURFACE_PATHS = [
  BADGE_COMPONENT_PATH,
  'src/screens/TransposedScoreReaderScreen.tsx',
  'src/screens/NotationEditorScreen.tsx',
  'src/screens/LibraryScreen.tsx',
  'src/screens/PieceDetailScreen.tsx',
  'src/screens/HomeScreen.tsx',
] as const;

const BADGE_COMPONENT = readAppFile(BADGE_COMPONENT_PATH);
const BADGE_SERVICE = readAppFile(BADGE_SERVICE_PATH);
const surfaces = SAMPLE_BADGE_SURFACE_PATHS.map((rel) => ({
  path: rel,
  source: readAppFile(rel),
}));
function surface(rel: string): string {
  const found = surfaces.find((file) => file.path === rel);
  if (!found) throw new Error('surface not read: ' + rel);
  return found.source;
}
const READER = surface('src/screens/TransposedScoreReaderScreen.tsx');
const EDITOR = surface('src/screens/NotationEditorScreen.tsx');
const LIBRARY = surface('src/screens/LibraryScreen.tsx');
const PIECE = surface('src/screens/PieceDetailScreen.tsx');
const HOME = surface('src/screens/HomeScreen.tsx');

const FOUR_BARS = 'K:C\nE E F G | G F E D | C C D E | E2 D2 |]';
const TWO_BARS = 'K:C\nC D | E F |]';
const LONG_SCORE = 'K:C\n' + 'C D | '.repeat(20);

console.log('\nsample badge — the words come from the score');
assertEq(sampleBadgeLabel({ abc: FOUR_BARS }), 'Sample · 4-bar excerpt' + SAMPLE_BADGE_EXCERPT_ONLY_CLAUSE, 'an unflagged four-bar score still says what it is, in the owner’s “·” shape');
assertEq(sampleBadgeLabel({ abc: FOUR_BARS, libraryState: 'unverified' }), 'Sample · 4-bar excerpt' + SAMPLE_BADGE_EXCERPT_ONLY_CLAUSE, 'the default state makes no claim about the library');
assertEq(sampleBadgeLabel({ abc: FOUR_BARS, libraryState: 'full-score-opens-on-tap' }), 'Sample · 4-bar excerpt · tap for the full piece', 'the owner’s full string, when the tap really opens the full score');
assertEq(sampleBadgeLabel({ abc: FOUR_BARS, libraryState: 'nothing-fuller-in-library' }), 'Sample · 4-bar excerpt — this is the whole score in the free library', 'the reduced form for a surface that knows the catalog hosts no score');
assertEq(sampleBadgeLabel({ abc: LONG_SCORE }), null, 'a real work is not badged a sample at all');
assertEq(sampleBadgeLabel({ abc: '' }), null, 'an empty score has nothing to badge');
assertEq(sampleBadgeLabel({ abc: null }), null, 'a missing score has nothing to badge');
assertEq(sampleBadgeLabel({ abc: 42 as unknown as string }), null, 'junk is not a score');
assertEq(sampleBadgeLabel({ abc: FOUR_BARS, libraryState: 'anything-else' as unknown as 'unverified' }), 'Sample · 4-bar excerpt' + SAMPLE_BADGE_EXCERPT_ONLY_CLAUSE, 'an unknown state falls back to the claim-free wording');
assertEq(
  (sampleBadgeLabel({ abc: FOUR_BARS }) ?? '').indexOf('tap for the full piece') < 0,
  true,
  'THE RULE: a surface that proved nothing never promises a full score',
);
assertEq(
  (sampleBadgeLabel({ abc: FOUR_BARS }) ?? '').indexOf('free library') < 0,
  true,
  'THE RULE: a catalog-blind surface never claims the library holds nothing fuller',
);
assertEq(
  (sampleBadgeLabel({ abc: FOUR_BARS, libraryState: 'nothing-fuller-in-library' }) ?? '').indexOf('tap for the full piece') < 0,
  true,
  'and the catalog-reduced form never promises a tap that does not exist',
);

console.log('\nsample badge — the reader keeps its caller assertion (the flag is not lost)');
assertEq(sampleBadgeLabel({ abc: TWO_BARS, isSample: true }), 'Sample · 2-bar excerpt' + SAMPLE_BADGE_EXCERPT_ONLY_CLAUSE, 'a flagged sample with a readable count keeps the count');
assertEq(sampleBadgeLabel({ abc: '', isSample: true }), 'Sample · short excerpt' + SAMPLE_BADGE_EXCERPT_ONLY_CLAUSE, 'a flagged sample with an unreadable score keeps the fallback wording');
assertEq(sampleBadgeLabel({ abc: FOUR_BARS, isSample: false }), null, 'the caller can still say “not a sample” and get no badge');
assertEq(sampleBadgeLabel({ abc: LONG_SCORE, isSample: true }), null, 'and a flagged sample past the excerpt limit is not badged as one');

console.log('\nsample badge — the honest state per surface (no false claim is reachable)');
assertEq(featuredPieceLibraryState({ sheetMusicUrl: 'https://x/y.pdf' }), 'full-score-opens-on-tap', 'the Today card earns the tap clause only with a curated score URL');
assertEq(featuredPieceLibraryState({ sheetMusicUrl: '   ' }), 'nothing-fuller-in-library', 'a blank URL is not a score (the catalog parser’s own rule)');
assertEq(featuredPieceLibraryState(null), 'nothing-fuller-in-library', 'no challenge loaded = no score in the library');
assertEq(featuredPieceLibraryState(undefined), 'nothing-fuller-in-library', 'an undefined challenge is the same honest state');
assertEq(piecePageLibraryState({ sheetMusicUrl: 'https://x/y.pdf' }), 'full-score-opens-on-tap', 'a piece page with a hosted score opens it from its own sheet control');
assertEq(piecePageLibraryState({}), 'nothing-fuller-in-library', 'a piece with no hosted score says the excerpt is the whole of it');
assertEq(piecePageLibraryState(null), 'nothing-fuller-in-library', 'no piece payload = the reduced honest form');
assertEq(
  featuredPieceLibraryState({ sheetMusicUrl: 'https://x/y.pdf' }) === 'full-score-opens-on-tap' &&
    sampleBadgeLabel({ abc: FOUR_BARS, libraryState: featuredPieceLibraryState({ sheetMusicUrl: 'https://x/y.pdf' }) }) ===
      'Sample · 4-bar excerpt · tap for the full piece',
  true,
  'the state and the words agree on the one surface that can prove both',
);

console.log('\nsample badge — the bundled scores are all excerpts (the owner’s report)');
for (const score of PUBLIC_DOMAIN_ABC_SCORES) {
  assert(sampleBadgeLabel({ abc: score.abc }) !== null, `the bundled score “${score.title}” is badged as an excerpt`);
}
assert(PUBLIC_DOMAIN_ABC_SCORES.length >= 8, `the bundle still holds its ${PUBLIC_DOMAIN_ABC_SCORES.length} scores (floor)`);

console.log('\nsample badge — the scanner (a badge is a badge, not a string)');
const goodSource = 'const x = <SampleBadge abc={abc} libraryState={piecePageLibraryState(piece)} />;';
const preFixInlineBadge =
  '{sampleLabel !== null && (\n' +
  '  <View style={styles.sampleBadge}>\n' +
  '    <Ionicons name="information-circle-outline" size={13} color={theme.accent} />\n' +
  '    <Text style={styles.sampleBadgeText}>{sampleLabel}</Text>\n' +
  '  </View>\n' +
  ')}';
assertEq(sampleBadgeIsRenderedOn(goodSource), true, 'the fixed form is seen');
assertEq(sampleBadgeIsRenderedOn(preFixInlineBadge), false, 'PRE-FIX: an inline badge with the label in a variable is not the shared badge');
assertEq(sampleBadgeIsRenderedOn('<SampleBadge isSample={isSample} />'), false, 'a badge with no score prop could not derive its words');
assertEq(sampleBadgeIsRenderedOn('const x = <SamplePill abc={abc} />;'), false, 'a look-alike component is not the shared badge');
assertEq(sampleBadgeIsRenderedOn(''), false, 'an empty source renders nothing');
assertEq(sampleBadgeIsRenderedOn(preFixInlineBadge + '\n// ' + goodSource), false, 'a COMMENTED-OUT badge is not a badge');
assertEq(sampleBadgeIsRenderedOn(goodSource + '\n' + preFixInlineBadge), true, 'a real badge beside dead markup still counts');
assertEq(sampleBadgeTakesNoCopy(goodSource), true, 'the fixed form passes no copy');
assertEq(sampleBadgeTakesNoCopy('<SampleBadge abc={abc} label={sampleLabel} />'), false, 'PRE-FIX: the words passed in as a string');
assertEq(sampleBadgeTakesNoCopy('<SampleBadge abc={abc} text={label} />'), false, 'PRE-FIX: the same rule, the other prop name');
assertEq(sampleBadgeTakesNoCopy('<SampleBadge abc={abc} words={"Sample"} />'), false, 'PRE-FIX: a literal copy string');
assertEq(sampleBadgeTakesNoCopy('<SampleBadge abc={abc} />'), true, 'a badge with no props is still honest (it derives)');
assertEq(sampleBadgeTakesNoCopy(preFixInlineBadge), false, 'a source with no badge at all does not pass by omission');
assertEq(sampleBadgeTakesNoCopy(''), false, 'an empty source passes nothing');
assertEq(sampleBadgeStatesItsLibraryState(goodSource, 'piecePageLibraryState'), true, 'the catalog-carrying surface states its state from the shared helper');
assertEq(sampleBadgeStatesItsLibraryState(goodSource, 'featuredPieceLibraryState'), false, 'and it is not the other surface’s helper');
assertEq(sampleBadgeStatesItsLibraryState('<SampleBadge abc={abc} />', 'piecePageLibraryState'), false, 'a surface that states nothing is caught');
assertEq(sampleBadgeBlocks(goodSource).length, 1, 'one badge element is one block');
assertEq(sampleBadgeBlocks('<SampleBadge abc={abc} />\n<SampleBadge abc={abc} />').length, 2, 'two badges are two blocks');
assertEq(sampleBadgeBlocks('').length, 0, 'an empty source has no blocks');
assertEq(sampleBadgeDerivesItsWords(BADGE_COMPONENT), true, 'the shared component derives its words through the pure service');
assertEq(sampleBadgeDerivesItsWords('<View><Text>{label}</Text></View>'), false, 'PRE-FIX: a component that renders a label it was handed');
assertEq(
  sampleBadgeDerivesItsWords(
    BADGE_COMPONENT.replace('export interface SampleBadgeProps {', 'export interface SampleBadgeProps {\n  label?: string;'),
  ),
  false,
  'MUTATION — a copy prop added to the component interface fails the guard',
);
assertEq(sampleBadgeDerivesItsWords(''), false, 'an empty component proves nothing');

console.log('\nsample badge — the live scan (floors first)');
assert(surfaces.length >= 6, `read all ${surfaces.length} badge surfaces`);
for (const file of surfaces) {
  assert(file.source.length > 2000, `read ${file.path} (${file.source.length} chars)`);
}
assert(BADGE_SERVICE.length > 4000, `read the badge service (${BADGE_SERVICE.length} chars)`);
for (const file of surfaces.filter((f) => f.path !== BADGE_COMPONENT_PATH)) {
  assertEq(sampleBadgeIsRenderedOn(file.source), true, `${file.path} renders the shared badge with the score`);
  assertEq(sampleBadgeTakesNoCopy(file.source), true, `${file.path} passes the badge no copy string`);
}
assertEq(sampleBadgeBlocks(READER).some((b) => b.indexOf('isSample={isSample}') >= 0), true, 'the reader still hands over the sample flag it carries');
assertEq(sampleBadgeStatesItsLibraryState(HOME, 'featuredPieceLibraryState'), true, 'Home’s Today card states its honest library state from the tap mapping');
assertEq(sampleBadgeStatesItsLibraryState(PIECE, 'piecePageLibraryState'), true, 'the piece page states its honest library state from the catalog payload');
assertEq(sampleBadgeStatesItsLibraryState(READER, 'featuredPieceLibraryState'), false, 'the reader — which cannot check the catalog — claims nothing (floor)');
assertEq(sampleBadgeStatesItsLibraryState(EDITOR, 'piecePageLibraryState'), false, 'the editor — which cannot check the catalog — claims nothing (floor)');
assertEq(sampleBadgeStatesItsLibraryState(LIBRARY, 'piecePageLibraryState'), false, 'a saved Library row — which cannot check the catalog — claims nothing (floor)');

console.log('\nsample badge — the gate lists know about it');
const tsconfig = readAppFile('tsconfig.tier1.json');
const pkg = readAppFile('package.json');
assertEq(tsconfig.indexOf('src/services/sampleBadge.ts') >= 0, true, 'the service is compiled by the gate');
assertEq(tsconfig.indexOf('scripts/sampleBadge.test.ts') >= 0, true, 'this suite is compiled by the gate');
assertEq(pkg.indexOf('sampleBadge.test.js') >= 0, true, 'and it is chained into npm run test:tier1');

console.log('\nsample badge — MUTATION PROBES (each guard must bite)');
function mutate(source: string, needle: string, replacement: string): string {
  return source.split(needle).join(replacement);
}
{
  const gutted = mutate(HOME, '<SampleBadge', '<SamplePill');
  assert(gutted !== HOME, 'the mutation really changed Home’s source');
  assertEq(sampleBadgeIsRenderedOn(gutted), false, 'MUTATION FAILS THE GUARD — the Today card silently stops badging the excerpt');
  const withoutTheScore = mutate(HOME, '<SampleBadge abc={', '<SampleBadge score="');
  assert(withoutTheScore !== HOME, 'the mutation really changed the score prop name');
  assertEq(sampleBadgeIsRenderedOn(withoutTheScore), false, 'MUTATION FAILS THE GUARD — the badge loses the score it derives from');
  const withACopy = mutate(HOME, '<SampleBadge abc={', '<SampleBadge label="Sample · 4-bar excerpt" abc={');
  assert(withACopy !== HOME, 'the mutation really injected a copy string');
  assertEq(sampleBadgeTakesNoCopy(withACopy), false, 'MUTATION FAILS THE GUARD — the words passed in as a string again');
  const lying = mutate(HOME, 'libraryState={featuredPieceLibraryState(dailyChallenge)}', 'libraryState="full-score-opens-on-tap"');
  assert(lying !== HOME, 'the mutation really replaced the honest state with a hard-coded one');
  assertEq(
    sampleBadgeStatesItsLibraryState(lying, 'featuredPieceLibraryState'),
    false,
    'MUTATION FAILS THE GUARD — a hard-coded “tap for the full piece” on a card with no hosted score',
  );
  const droppedFromThePiecePage = mutate(PIECE, '<SampleBadge', '<View');
  assert(droppedFromThePiecePage !== PIECE, 'the mutation really changed the piece page’s source');
  assertEq(sampleBadgeIsRenderedOn(droppedFromThePiecePage), false, 'MUTATION FAILS THE GUARD — the piece page drops the badge');
  const droppedFromTheLibrary = mutate(LIBRARY, '<SampleBadge', '<SamplePill');
  assert(droppedFromTheLibrary !== LIBRARY, 'the mutation really changed the Library’s source');
  assertEq(sampleBadgeIsRenderedOn(droppedFromTheLibrary), false, 'MUTATION FAILS THE GUARD — a Library row drops the badge');
  const droppedFromTheReader = mutate(READER, '<SampleBadge', '<SamplePill');
  assert(droppedFromTheReader !== READER, 'the mutation really changed the reader’s source');
  assertEq(sampleBadgeIsRenderedOn(droppedFromTheReader), false, 'MUTATION FAILS THE GUARD — the reader drops the badge it shipped with');
  const droppedFromTheEditor = mutate(EDITOR, '<SampleBadge', '<SamplePill');
  assert(droppedFromTheEditor !== EDITOR, 'the mutation really changed the editor’s source');
  assertEq(sampleBadgeIsRenderedOn(droppedFromTheEditor), false, 'MUTATION FAILS THE GUARD — the editor drops the badge it shipped with');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
