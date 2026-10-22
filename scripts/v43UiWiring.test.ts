/**
 * v43 item B3 — THE ITEM B SURFACES, run against the REAL screens.
 *
 * The build stamp and the honest PDF control are the two things the owner cannot
 * verify from a screenshot of the app in general, so they are source-guarded here
 * and mutated below to prove each guard bites.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
import {
  homeShowsTheBuildStamp,
  noScreenMountsAutoScrollUnconditionally,
  pdfAutoScrollIsGatedOnPageCount,
  scannedViewerKeepsItsHonestLine,
  settingsShowsTheBuildStamp,
} from '../src/services/v43UiContract';

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

const SETTINGS = 'src/screens/SettingsScreen.tsx';
const HOME = 'src/screens/HomeScreen.tsx';
const PDF = 'src/screens/PdfViewerScreen.tsx';
const SCANNED = 'src/screens/ScannedViewerScreen.tsx';

const settingsSource = read(SETTINGS);
const homeSource = read(HOME);
const pdfSource = read(PDF);
const scannedSource = read(SCANNED);

console.log('\nv43 B1 — the build stamp is on screen');
assertEq(settingsShowsTheBuildStamp(settingsSource), true, 'Settings → About renders the stamp from the live version + versionCode + the built commit');
assertEq(homeShowsTheBuildStamp(homeSource), true, 'Home carries the same stamp in its footer');

console.log('\nv43 B2 — the PDF auto-scroll control is honest');
assertEq(pdfAutoScrollIsGatedOnPageCount(pdfSource), true, 'the control renders only for a multi-page PDF; one page gets the honest line');
assertEq(scannedViewerKeepsItsHonestLine(scannedSource), true, 'the scanned viewer keeps its own honest no-auto-scroll line');
assertEq(
  noScreenMountsAutoScrollUnconditionally([
    { path: PDF, source: pdfSource },
    { path: SCANNED, source: scannedSource },
  ]),
  true,
  'neither surface mounts the control unconditionally',
);

// ─── the guards bite ─────────────────────────────────────────────────────────
console.log('\nv43 B3 — mutations');
const literalStamp = settingsSource.replace('version: appVersion', "version: '0.1.32'");
assert(literalStamp !== settingsSource, 'mutation 1 hard-coded the version');
assertEq(settingsShowsTheBuildStamp(literalStamp), false, 'MUTATION: a hard-coded version FAILS settingsShowsTheBuildStamp');

const noTag = settingsSource.split('BUILD_STAMP_TAG').join('BUILD_TAG');
assertEq(settingsShowsTheBuildStamp(noTag), false, 'MUTATION: a stamp with no accessibility tag FAILS settingsShowsTheBuildStamp');

const noHomeStamp = homeSource.split('{buildStampLine(').join("{'NoteSnap'}");
assertEq(homeShowsTheBuildStamp(noHomeStamp), false, 'MUTATION: a Home footer without the stamp FAILS homeShowsTheBuildStamp');

const ungated = pdfSource.replace('{pageCount >= 2 ? (', '{true ? (');
assert(ungated !== pdfSource, 'mutation 4 un-gated the control');
assertEq(pdfAutoScrollIsGatedOnPageCount(ungated), false, 'MUTATION: an un-gated auto-scroll control FAILS pdfAutoScrollIsGatedOnPageCount');
assertEq(
  noScreenMountsAutoScrollUnconditionally([{ path: PDF, source: ungated }]),
  false,
  'MUTATION: a screen mounting the control unconditionally FAILS the sweep',
);

const noHonestLine = pdfSource.split('{PDF_NO_AUTOSCROLL_LINE}').join("{' '}");
assertEq(pdfAutoScrollIsGatedOnPageCount(noHonestLine), false, 'MUTATION: a one-page PDF with no honest line FAILS pdfAutoScrollIsGatedOnPageCount');

const scannedLostLine = scannedSource.split('{SCANNED_NO_AUTOSCROLL_LINE}').join("{' '}");
assertEq(scannedViewerKeepsItsHonestLine(scannedLostLine), false, 'MUTATION: a scanned viewer that loses its honest line FAILS scannedViewerKeepsItsHonestLine');

assertEq(settingsShowsTheBuildStamp(''), false, 'an empty Settings screen shows no stamp');
assertEq(pdfAutoScrollIsGatedOnPageCount(''), false, 'an empty PDF screen gates nothing');

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
