/**
 * v39Fixes.test.ts — THE v39 BUG-FIX GATE (owner-reported 10-11, riding the v39
 * build): the three bugs from the v38 on-device pass.
 *
 * Three layers, the team's usual shape:
 *   1. PURE LOGIC — the scanned page's way into the search (`services/scanFind`):
 *      a failed read, a wordless page and a missing reader each keep their own
 *      honest state, no query is ever invented, the finish/resume copy is driven
 *      by the real page count, and the search decision is the cover scan's own
 *      (`coverQueryFromScan`) rather than a second one;
 *   2. LIVE-SOURCE GUARDS — the wiring, read from the REAL files: the scan writes
 *      each page through the store as it is taken and resumes an open scan, the
 *      scan reaches the ONE search and builds no URL, the record surface films
 *      only after a Start press, and a History row is the playback phase rendered
 *      as the tab's own body;
 *   3. MUTATION PROBES — every guard run against a mutated copy that MUST fail,
 *      and the mutation is asserted to have really changed the source first (a
 *      probe whose mutation missed is not evidence).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  SCAN_FIND_CTA,
  SCAN_FIND_RAW_QUERY_NOTE,
  SCAN_SAVED_AS_YOU_GO_LINE,
  scanFindQuery,
  scanFindView,
  scanFinishCta,
  scanPageFileLabel,
  scanSessionResumedLine,
  scanSessionTitle,
} from '../src/services/scanFind';
import { coverQueryFromScan } from '../src/services/coverScan';
import {
  V39_FIND_PIECE_PATH,
  V39_HISTORY_PATH,
  V39_LIBRARY_STORE_PATH,
  V39_OCR_PATH,
  V39_SCAN_FIND_PATH,
  V39_SCAN_SCREEN_PATH,
  V39_SCAN_SECTION_PATH,
  V39_SCANNED_VIEWER_PATH,
  V39_TIER1_MODULES,
  V39_TIER1_SUITES,
  V39_VIDEO_REF_PATH,
  V39_VIDEO_SCREEN_PATH,
  historyPracticeVideoStartsInPlayback,
  practiceVideoFilmsOnlyAfterAPress,
  scanFindCopyClaimsNoNoteReading,
  scanFindOpensTheOneSearch,
  scanSavesEveryPageAsItIsTaken,
  scanStorePersistsBeforeItNamesThePage,
  tier1ListsTheV39Fixes,
} from '../src/services/v39FixContract';

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
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}
/** Replace the first occurrence — the shape every probe below uses. */
function mutate(source: string, from: string, to: string): string {
  const at = source.indexOf(from);
  if (at < 0) return source;
  return source.slice(0, at) + to + source.slice(at + from.length);
}

const SCAN_SCREEN = readAppFile(V39_SCAN_SCREEN_PATH);
const SCANNED_VIEWER = readAppFile(V39_SCANNED_VIEWER_PATH);
const SCAN_SECTION = readAppFile(V39_SCAN_SECTION_PATH);
const SCAN_FIND = readAppFile(V39_SCAN_FIND_PATH);
const LIBRARY_STORE = readAppFile(V39_LIBRARY_STORE_PATH);
const FIND_PIECE = readAppFile(V39_FIND_PIECE_PATH);
const VIDEO_SCREEN = readAppFile(V39_VIDEO_SCREEN_PATH);
const VIDEO_REF = readAppFile(V39_VIDEO_REF_PATH);
const HISTORY = readAppFile(V39_HISTORY_PATH);
const OCR_READER = readAppFile(V39_OCR_PATH);
const TSCONFIG = readAppFile('tsconfig.tier1.json');
const PACKAGE = readAppFile('package.json');

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE LOGIC — the scanned page's decision
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nv39 fixes — the scanned page\u2019s own decision (pure)');

const readReady = scanFindView({ text: 'Für Elise', failed: false });
assertEq(readReady.status, 'ready', 'a read with words is ready');
assert(readReady.canSearch === true, 'a read with words may be searched');
assert(readReady.query.length > 0, 'the confirmed query carries the words that were read');

const readFailed = scanFindView({ text: '', failed: true });
assertEq(readFailed.status, 'ocr-failed', 'a broken read is its own state');
assertEq(readFailed.query, '', 'a broken read invents no query');
assertEq(readFailed.canSearch, false, 'a broken read searches nothing');
assert(!!readFailed.line, 'a broken read still says something to the user');

const readBlank = scanFindView({ text: '   \n  ', failed: false });
assertEq(readBlank.canSearch, false, 'a page with no words on it searches nothing');
assertEq(readBlank.query, '', 'a wordless page invents no query');

const readIdle = scanFindView(null);
assertEq(readIdle.status, 'idle', 'nothing read yet is its own state');
assertEq(readIdle.line, null, 'the idle state says nothing about a read that never happened');
assertEq(readIdle.canSearch, false, 'the idle state cannot search');

assertEq(scanFindQuery({ text: '', failed: true }), null, 'the query helper refuses a failed read');
assertEq(scanFindQuery(null), null, 'the query helper refuses an unread page');
assertEq(
  scanFindQuery({ text: 'Clair de Lune' }),
  coverQueryFromScan({ ocrText: 'Clair de Lune', ocrFailed: false }).query,
  'the scan uses the cover scan\u2019s OWN decision, not a second one',
);
assertEq(readReady.line, coverQueryFromScan({ ocrText: 'Für Elise' }).line, 'the ready line is the shared one');

assertEq(scanFinishCta(0), 'Done', 'no pages = a plain Done');
assertEq(scanFinishCta(1), 'Done (1 page)', 'one page reads in the singular');
assertEq(scanFinishCta(4), 'Done (4 pages)', 'four pages read in the plural');
assertEq(scanFinishCta(Number.NaN), 'Done', 'a nonsense count never prints a number');

assertEq(scanSessionResumedLine(0), null, 'nothing captured = nothing to resume');
assert(scanSessionResumedLine(1)!.indexOf('1 page') >= 0, 'a resumed single page says so');
assert(scanSessionResumedLine(3)!.indexOf('3 pages') >= 0, 'a resumed three-page scan says so');
assert(scanSessionResumedLine(3)!.indexOf('Done') < 0, 'the resume line does not invent a button name');

assertEq(scanPageFileLabel(0), 'page-001.jpg', 'the first page is page-001');
assertEq(scanPageFileLabel(9), 'page-010.jpg', 'the tenth page is zero-padded to page-010');
assertEq(scanPageFileLabel(-3), 'page-001.jpg', 'a nonsense index cannot produce a nonsense name');
assertEq(scanSessionTitle('1/2/2026'), 'Scanned score 1/2/2026', 'the title carries the device\u2019s own date');
assertEq(scanSessionTitle('  '), 'Scanned score', 'an empty date label is not printed');

assert(SCAN_FIND_CTA.length > 0 && SCAN_SAVED_AS_YOU_GO_LINE.length > 0, 'the flow carries its own copy');
assert(
  SCAN_FIND_RAW_QUERY_NOTE.toLowerCase().indexOf('notes into a score') >= 0,
  'the money-path note states the raw-query boundary',
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. LIVE-SOURCE GUARDS
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nv39 fixes — the live-source walk (floors first)');
assert(SCAN_SCREEN.length > 5000, `read ${V39_SCAN_SCREEN_PATH} (${SCAN_SCREEN.length} chars)`);
assert(SCANNED_VIEWER.length > 3000, `read ${V39_SCANNED_VIEWER_PATH} (${SCANNED_VIEWER.length} chars)`);
assert(SCAN_SECTION.length > 2000, `read ${V39_SCAN_SECTION_PATH} (${SCAN_SECTION.length} chars)`);
assert(SCAN_FIND.length > 2000, `read ${V39_SCAN_FIND_PATH} (${SCAN_FIND.length} chars)`);
assert(LIBRARY_STORE.length > 8000, `read ${V39_LIBRARY_STORE_PATH} (${LIBRARY_STORE.length} chars)`);
assert(VIDEO_SCREEN.length > 8000, `read ${V39_VIDEO_SCREEN_PATH} (${VIDEO_SCREEN.length} chars)`);
assert(HISTORY.length > 20000, `read ${V39_HISTORY_PATH} (${HISTORY.length} chars)`);
assert(OCR_READER.indexOf('readCoverText') >= 0, 'the ONE on-device reader is still where the flow reads it');

assertEq(
  scanSavesEveryPageAsItIsTaken(SCAN_SCREEN),
  true,
  'FIX 1a: the scan writes each page through the store as it is taken, and resumes an open scan',
);
assertEq(
  scanStorePersistsBeforeItNamesThePage(LIBRARY_STORE),
  true,
  'FIX 1a: the store copies the page in before naming it, marks the scan open, and undo deletes the file',
);
assertEq(
  scanFindOpensTheOneSearch({
    scanScreen: SCAN_SCREEN,
    viewer: SCANNED_VIEWER,
    section: SCAN_SECTION,
    host: FIND_PIECE,
  }),
  true,
  'FIX 1b: both scan doors read the words and open the ONE find-a-piece search with them',
);
assertEq(
  scanFindCopyClaimsNoNoteReading([SCAN_FIND, SCAN_SECTION, SCAN_SCREEN, SCANNED_VIEWER]),
  true,
  'FIX 1b: no note-reading / OMR / edition claim anywhere in the flow',
);
assertEq(
  practiceVideoFilmsOnlyAfterAPress(VIDEO_SCREEN, VIDEO_REF),
  true,
  'FIX 2: the camera coming up arms the control, and only the Start press films',
);
assertEq(
  historyPracticeVideoStartsInPlayback(VIDEO_SCREEN, HISTORY),
  true,
  'FIX 3: a History row starts in the playback phase, rendered as the tab\u2019s own body',
);
assertEq(
  tier1ListsTheV39Fixes(TSCONFIG, PACKAGE),
  true,
  'the gate lists this round\u2019s new module and suite in both files',
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. MUTATION PROBES — every guard above must bite
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nv39 fixes — the mutation probes');

/** A probe is only evidence when its mutation really changed the source. */
function probe(label: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${label}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${label}`);
}

const screenWithoutAppend = mutate(SCAN_SCREEN, 'appendScanSessionPage(sessionId, photo.uri)', 'readOnlyPage(sessionId)');
probe('the scan holds later pages in state instead of writing them', screenWithoutAppend, SCAN_SCREEN, () =>
  scanSavesEveryPageAsItIsTaken(screenWithoutAppend),
);

const screenWithoutResume = mutate(SCAN_SCREEN, 'getOpenScanSession()', 'noResumeAtAll()');
probe('the scan forgets the session the user left', screenWithoutResume, SCAN_SCREEN, () =>
  scanSavesEveryPageAsItIsTaken(screenWithoutResume),
);

const screenBackToTheOneShot = mutate(SCAN_SCREEN, 'startScanSession(photo.uri, scanSessionTitle(', 'createScannedScore([{ uri: photo.uri }], ');
probe('the scan saves once at the end again', screenBackToTheOneShot, SCAN_SCREEN, () =>
  scanSavesEveryPageAsItIsTaken(screenBackToTheOneShot),
);

const screenNoClose = mutate(SCAN_SCREEN, 'await endScanSession(sessionId);', 'await Promise.resolve();');
probe('the scan is left open in the library for ever', screenNoClose, SCAN_SCREEN, () =>
  scanSavesEveryPageAsItIsTaken(screenNoClose),
);

const storeWithoutOpenMark = mutate(LIBRARY_STORE, 'scanSessionOpen: true,', 'scanSessionOpen: false,');
probe('the open scan is no longer marked', storeWithoutOpenMark, LIBRARY_STORE, () =>
  scanStorePersistsBeforeItNamesThePage(storeWithoutOpenMark),
);

const storeWithoutUndoDelete = mutate(LIBRARY_STORE, 'export async function removeScanSessionPage(', 'async function unusableRemoval(');
probe('the undo stops deleting the file it dropped', storeWithoutUndoDelete, LIBRARY_STORE, () =>
  scanStorePersistsBeforeItNamesThePage(storeWithoutUndoDelete),
);

const sectionWithoutHandOff = mutate(SCAN_SECTION, 'onSearch(confirmed)', 'noHandOff(confirmed)');
probe('the read never reaches the search', sectionWithoutHandOff, SCAN_SECTION, () =>
  scanFindOpensTheOneSearch({ scanScreen: SCAN_SCREEN, viewer: SCANNED_VIEWER, section: sectionWithoutHandOff, host: FIND_PIECE }),
);

const viewerWithoutTheDoor = mutate(SCANNED_VIEWER, '<FindPieceScreen initialQuery={findQuery}', '<View');
probe('the saved scan loses its way into the money path', viewerWithoutTheDoor, SCANNED_VIEWER, () =>
  scanFindOpensTheOneSearch({ scanScreen: SCAN_SCREEN, viewer: viewerWithoutTheDoor, section: SCAN_SECTION, host: FIND_PIECE }),
);

// RE-POINTED by v42 fix D: the pre-fix auto-seed is gone, so the mutation is the
// proposal losing the one control that turns it into a search — a read the user
// can never act on is as dead as a silent auto-query.
const hostWithoutTheConfirm = mutate(FIND_PIECE, 'onPress={handleSubmitPrefill}', 'onPress={() => {}}');
probe('the search cannot turn the words a scan handed it into a search', hostWithoutTheConfirm, FIND_PIECE, () =>
  scanFindOpensTheOneSearch({ scanScreen: SCAN_SCREEN, viewer: SCANNED_VIEWER, section: SCAN_SECTION, host: hostWithoutTheConfirm }),
);

const sectionBuildingItsOwnUrl = mutate(
  SCAN_SECTION,
  'export const ScanFindSection',
  'const retailerNote = "https://www.sheetmusicdirect.com/";\nexport const ScanFindSection',
);
probe('the scan section builds its own retailer link', sectionBuildingItsOwnUrl, SCAN_SECTION, () =>
  scanFindOpensTheOneSearch({
    scanScreen: SCAN_SCREEN,
    viewer: SCANNED_VIEWER,
    section: sectionBuildingItsOwnUrl,
    host: FIND_PIECE,
  }),
);

const screenClaimingOmr = mutate(SCAN_SCREEN, 'Capture at least one page first.', 'We use OMR to read this sheet music for you.');
probe('the scan claims the notes were read', screenClaimingOmr, SCAN_SCREEN, () =>
  scanFindCopyClaimsNoNoteReading([screenClaimingOmr]),
);

const videoStillAutoStarts = mutate(VIDEO_SCREEN, 'setCameraReady(true);', 'startBothCaptures();');
probe('the surface films the moment the camera comes up again (the owner\u2019s bug)', videoStillAutoStarts, VIDEO_SCREEN, () =>
  practiceVideoFilmsOnlyAfterAPress(videoStillAutoStarts, VIDEO_REF),
);

const videoWithoutTheStartControl = mutate(VIDEO_SCREEN, 'onPress={handleStart}', 'onPress={() => undefined}');
probe('the record surface has no Start control', videoWithoutTheStartControl, VIDEO_SCREEN, () =>
  practiceVideoFilmsOnlyAfterAPress(videoWithoutTheStartControl, VIDEO_REF),
);

const refBackToAutoCopy = mutate(VIDEO_REF, 'Ready — filming starts when you press Start.', 'Ready — recording starts on its own.');
probe('the arming copy promises an automatic start again', refBackToAutoCopy, VIDEO_REF, () =>
  practiceVideoFilmsOnlyAfterAPress(VIDEO_SCREEN, refBackToAutoCopy),
);

const screenNotStartingInPlayback = mutate(VIDEO_SCREEN, "watchMode ? 'playback' : 'permissions',", "'permissions',");
probe('a History row no longer starts in the playback phase', screenNotStartingInPlayback, VIDEO_SCREEN, () =>
  historyPracticeVideoStartsInPlayback(screenNotStartingInPlayback, HISTORY),
);

const screenRecordingFirst = mutate(
  VIDEO_SCREEN,
  "if (phase === 'playback') {",
  "if (phase === 'playback' && false) {\n    return <View />;\n  }\n  if (false) {",
);
probe('the playback branch stops being the mode test', screenRecordingFirst, VIDEO_SCREEN, () =>
  historyPracticeVideoStartsInPlayback(screenRecordingFirst, HISTORY),
);

const historySiblingAgain = mutate(HISTORY, 'if (watchVideoId) {', 'if (false) {');
probe('the watch surface is appended below the list again (the owner\u2019s bug)', historySiblingAgain, HISTORY, () =>
  historyPracticeVideoStartsInPlayback(VIDEO_SCREEN, historySiblingAgain),
);

const historyInsideTheGesture = mutate(HISTORY, 'requestAnimationFrame(() => setWatchVideoId(item.id))', 'setWatchVideoId(item.id)');
probe('the player is mounted inside the press event again', historyInsideTheGesture, HISTORY, () =>
  historyPracticeVideoStartsInPlayback(VIDEO_SCREEN, historyInsideTheGesture),
);

const packageWithoutTheSuite = mutate(PACKAGE, '/tmp/tier1-test/scripts/v39Fixes.test.js', '/tmp/tier1-test/scripts/never-run.test.js');
probe('the new suite is missing from the gate chain', packageWithoutTheSuite, PACKAGE, () =>
  tier1ListsTheV39Fixes(TSCONFIG, packageWithoutTheSuite),
);

const tsconfigWithoutTheModule = mutate(TSCONFIG, `"${V39_TIER1_MODULES[0]}"`, '"src/services/not-this-file.ts"');
probe('the new module is missing from the compiled set', tsconfigWithoutTheModule, TSCONFIG, () =>
  tier1ListsTheV39Fixes(tsconfigWithoutTheModule, PACKAGE),
);

assertEq(V39_TIER1_SUITES.length, 1, 'this suite names itself once');
assert(V39_TIER1_MODULES.length >= 3, 'the module list names the pure module, the contract and this suite');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
