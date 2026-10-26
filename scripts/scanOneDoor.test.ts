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
  SCAN_TAKE_SAVES_COPY,
  captureScreenShowsTheFramingNotice,
  findPieceHasNoCoverScanAffordance,
  framingTipCarriesTheOwnerCopy,
  framingTipColoursCannotInvert,
  framingTipIsNeverClipped,
  garbageNeverOffersAReadSearch,
  noScreenMountsTheRetiredModal,
  oneDoorReadsTheCover,
  pageScanNeverOffersAGarbageQuery,
  readCoverTextCallSites,
} from '../src/services/scanOneDoorContract';
import {
  SCAN_FIND_CONFIRM_LABEL,
  SCAN_FIND_PAGE_OF_MUSIC_LINE,
  SCAN_FIND_WHAT_WE_READ_LABEL,
  scanFindView,
} from '../src/services/scanFind';

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
const scanFindSource = read('src/services/scanFind.ts');

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

// ════════════════════════════════════════════════════════════════════════════
// v44 — THE OWNER'S THREE v43-CHECKLIST SCAN DEFECTS
//
// #58 (bdb27d6c) the framing tip was black-on-black and sat over the preview;
// #60 (33732422) its copy was wrong and cut in half;
// #59 (ce3a2282) a scanned PAGE of music offered the recogniser's debris
// ("Auio - Metal") as a search query. Each fix has a guard HERE, and each guard is
// then shown to BITE by mutating the very thing it protects.
// ════════════════════════════════════════════════════════════════════════════
const TAKE_LINE = 'Your Take still saves to the library';

console.log('\nv44 #60 — the tip carries the owner’s words, whole');
assertEq(SCAN_TAKE_SAVES_COPY, TAKE_LINE, 'the durability copy is the owner’s exact string');
assertEq(
  framingTipCarriesTheOwnerCopy(scanScreenSource, TAKE_LINE),
  true,
  'the capture screen renders it from the named constant, as its own text',
);
assertEq(
  scanFindSource.indexOf("'Your Take still saves to the library'") >= 0,
  true,
  'and the words themselves are the shipped constant (services/scanFind)',
);
assertEq(
  scanScreenSource.indexOf('Every page you take still saves to your Library') >= 0,
  false,
  'the old half-read sentence is gone from the camera screen',
);

console.log('\nv44 #60 — the tip is never clipped');
assertEq(framingTipIsNeverClipped(scanScreenSource), true, 'no maxHeight on the tip panel, font scale capped at the measured limit');

console.log('\nv44 #58 — the tip cannot be repainted black-on-black');
assertEq(framingTipColoursCannotInvert(scanScreenSource), true, 'its colours are inline from the model, not repaintable literals');
assertEq(
  scanScreenSource.indexOf('backgroundColor: SCAN_TIP_SCRIM') >= 0 &&
    scanScreenSource.indexOf('rgba(9,11,22,0.78)') < 0,
  true,
  'the old near-black rgba fill is gone',
);

console.log('\nv44 #59 — a page of music never offers its debris as a query');
assertEq(pageScanNeverOffersAGarbageQuery(), true, 'the owner’s "Auio - Metal" page read yields no query on the page door');
assertEq(
  scanFindView({ text: 'Auio - Metal', failed: false, photoKind: 'page' }).line === SCAN_FIND_PAGE_OF_MUSIC_LINE,
  true,
  '…it shows the honest page-of-music line instead',
);
assertEq(
  scanFindView({ text: 'Auio - Metal', failed: false, photoKind: 'cover' }).uncorroborated,
  true,
  'the cover door keeps the words but flags them as NOT a vouched-for title',
);
const readLabel: string = SCAN_FIND_WHAT_WE_READ_LABEL;
const vouchedLabel: string = SCAN_FIND_CONFIRM_LABEL;
assertEq(
  readLabel !== vouchedLabel,
  true,
  'so the field cannot be labelled "Search for" for an uncorroborated read',
);
console.log('\nv44 #59 — BOTH scan doors use the one page rule');
assertEq(
  scannedViewerSource.indexOf('photoKind="page"') >= 0,
  true,
  'the saved-scan viewer (a page of a scanned score) is the page door',
);
// RE-POINTED BY v45 SLICE 4 (owner 2026-10-26). The first-photo/later-page rule is
// still the FALLBACK, but the door now comes from the CLASSIFIER's verdict on the
// photo itself (`services/scanClassify`) — see scripts/scanBatch.test.ts for the
// guards that pin the verdict, the honest gate and the mutation proof.
assertEq(
  scanScreenSource.indexOf("const pageDoorFallback: 'cover' | 'page' = pages.length > 1 ? 'page' : 'cover';") >= 0,
  true,
  'the scanner keeps the cover door for the first photo and the page door from the second on (as the fallback)',
);
assertEq(
  scanScreenSource.indexOf('const photoDoor = scanPhotoKindFor(scanClassification, pageDoorFallback);') >= 0 &&
    scanScreenSource.indexOf('photoKind={photoDoor}') >= 0,
  true,
  'and the read’s own verdict decides the door once the photo has been classified',
);
assertEq(
  resolveSource.indexOf('scanFindView({ ...result, photoKind }') >= 0,
  true,
  'and the ONE resolve component hands the photo kind to the same pure model',
);

console.log('\nv44 — mutations (each one MUST fail its guard)');
const oldCopy = scanScreenSource.split('{SCAN_TAKE_SAVES_LINE}').join("{'You take still saves to your library'}");
assert(oldCopy !== scanScreenSource, 'mutation reverted the tip copy');
assertEq(
  framingTipCarriesTheOwnerCopy(oldCopy, TAKE_LINE),
  false,
  'MUTATION: the old wrong copy FAILS framingTipCarriesTheOwnerCopy',
);

const clipped = scanScreenSource.split('    maxWidth: `${Math.round(SCAN_TIP_MAX_WIDTH_RATIO * 100)}%`,\n').join(
  '    maxWidth: `${Math.round(SCAN_TIP_MAX_WIDTH_RATIO * 100)}%`,\n    maxHeight: 132,\n',
);
assert(clipped !== scanScreenSource, 'mutation re-added the height cap');
assertEq(
  framingTipIsNeverClipped(clipped),
  false,
  'MUTATION: a maxHeight cap back on the tip panel FAILS framingTipIsNeverClipped',
);

const uncapped = scanScreenSource.split('maxFontSizeMultiplier={SCAN_TIP_MAX_FONT_SCALE}').join('');
assertEq(
  framingTipIsNeverClipped(uncapped),
  false,
  'MUTATION: an uncapped font scale FAILS framingTipIsNeverClipped',
);

const repainted = scanScreenSource.split('  framingHintText: {\n').join(
  "  framingHintText: {\n    color: '#ffffff',\n",
);
assert(repainted !== scanScreenSource, 'mutation put a repaintable ink literal back');
assertEq(
  framingTipColoursCannotInvert(repainted),
  false,
  'MUTATION: a `#ffffff` ink literal back on the tip FAILS framingTipColoursCannotInvert',
);

const darkFill = scanScreenSource.split('backgroundColor: SCAN_TIP_SCRIM').join("backgroundColor: 'rgba(9,11,22,0.78)'");
assertEq(
  framingTipColoursCannotInvert(darkFill),
  false,
  'MUTATION: the hard-coded panel fill back FAILS framingTipColoursCannotInvert',
);

assertEq(
  scanFindView({ text: 'Auio - Metal', failed: false }).query,
  'Auio - Metal',
  'MUTATION (the pre-fix behaviour): with no photoKind the debris IS the query — which is why the page door must never default to it',
);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
