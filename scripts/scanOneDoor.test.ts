/**
 * v43 item C6 — THE ONE-DOOR GUARDS, run against the REAL sources.
 *
 * v43 retired the find-a-piece cover-scan door. These assertions are what stop it
 * coming back, and each one is mutated below to prove it bites.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
import {
  captureScreenShowsTheFramingNotice,
  findPieceHasNoCoverScanAffordance,
  garbageNeverOffersAReadSearch,
  noScreenMountsTheRetiredModal,
  oneDoorReadsTheCover,
  readCoverTextCallSites,
} from '../src/services/scanOneDoorContract';

declare const require: any;
declare const process: any;
let passes = 0;
let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  try {
    assert.deepStrictEqual(actual, expected);
    passes += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

const RESOLVE = 'src/components/ScanFindSection.tsx';
const FIND_PIECE = 'src/screens/FindPieceScreen.tsx';
const SCAN_SCREEN = 'src/screens/ScanScoreScreen.tsx';
const SCANNED_VIEWER = 'src/screens/ScannedViewerScreen.tsx';
const RETIRED_MODAL = 'src/components/CoverScanModal.tsx';

const resolveSource = read(RESOLVE);
const findPieceSource = read(FIND_PIECE);
const scanScreenSource = read(SCAN_SCREEN);
const scannedViewerSource = read(SCANNED_VIEWER);

console.log('\nv43 C6 — the live files');
assertEq(resolveSource.length > 4000, true, `read ${RESOLVE} (${resolveSource.length} chars)`);
assertEq(findPieceSource.length > 8000, true, `read ${FIND_PIECE} (${findPieceSource.length} chars)`);
assertEq(scanScreenSource.length > 8000, true, `read ${SCAN_SCREEN} (${scanScreenSource.length} chars)`);

console.log('\nv43 C6 — ONE door: the read has exactly one home');
assertEq(readCoverTextCallSites(resolveSource), 1, 'the resolve page calls the recogniser exactly once');
assertEq(oneDoorReadsTheCover(resolveSource), true, 'the one read is what the view is built from');
assertEq(
  fs.existsSync(path.join(repoRoot(), RETIRED_MODAL)),
  false,
  'the retired modal component is DELETED, not merely unmounted',
);
assertEq(
  noScreenMountsTheRetiredModal([findPieceSource, scanScreenSource, scannedViewerSource]),
  true,
  'no screen mounts the retired modal',
);
assertEq(findPieceHasNoCoverScanAffordance(findPieceSource), true, 'the find-a-piece screen has no cover-scan affordance');

console.log('\nv43 C6 — a garbage read is never a search');
// The owner's real read, as the recogniser returned it.
// The real reader now hands back BLOCK GEOMETRY (v43 item C1), which is what lets
// the read be judged: the debris line, its box on the page, the photo's size.
const OWNER_DEBRIS = {
  text: '4ox 2Apx ors white Freddie Mer',
  failed: false,
  blocks: [
    {
      text: '4ox 2Apx ors white Freddie Mer',
      frame: { x: 60, y: 120, width: 800, height: 90 },
      lines: [],
    },
  ],
  imageSize: { width: 1000, height: 1400 },
};
assertEq(garbageNeverOffersAReadSearch(OWNER_DEBRIS), true, 'the owner’s debris read offers no search, only the typed title + retake');
// …and the good read is the positive control: it DOES offer one.
assertEq(
  garbageNeverOffersAReadSearch({ text: 'Bohemian Rhapsody', failed: false }),
  false,
  'a good read is not treated as garbage (the guard is not vacuous)',
);

console.log('\nv43 C6 — the camera says how to frame the shot');
assertEq(captureScreenShowsTheFramingNotice(scanScreenSource), true, 'the capture screen renders the framing notice over the viewfinder');

// ─── the guards bite ─────────────────────────────────────────────────────────
console.log('\nv43 C6 — mutations');
const twoReads = `${resolveSource}\nconst again = await readCoverText(otherUri);\n`;
assert(twoReads !== resolveSource, 'mutation 1 added a second read');
assertEq(oneDoorReadsTheCover(twoReads), false, 'MUTATION: a second read call site FAILS oneDoorReadsTheCover');

const modalBack = `${findPieceSource}\nconst again = <CoverScanModal visible onClose={() => {}} />;\n`;
assertEq(noScreenMountsTheRetiredModal([modalBack, scanScreenSource]), false, 'MUTATION: a screen mounting the retired modal FAILS the one-door guard');
assertEq(findPieceHasNoCoverScanAffordance(modalBack), false, 'MUTATION: the modal mount back on the search screen FAILS findPieceHasNoCoverScanAffordance');

const affordanceBack = `${findPieceSource}\nconst label = coverScanAffordanceLabel();\n`;
assertEq(findPieceHasNoCoverScanAffordance(affordanceBack), false, 'MUTATION: the camera row back on the search bar FAILS findPieceHasNoCoverScanAffordance');

const noticeGone = scanScreenSource.split('{SCAN_COVER_ONLY_HINT}').join("{' '}");
assert(noticeGone !== scanScreenSource, 'mutation removed the framing notice');
assertEq(captureScreenShowsTheFramingNotice(noticeGone), false, 'MUTATION: a capture screen with no framing notice FAILS captureScreenShowsTheFramingNotice');

assertEq(garbageNeverOffersAReadSearch({ text: 'Bohemian Rhapsody' }), false, 'an empty resolve page offers nothing');

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
