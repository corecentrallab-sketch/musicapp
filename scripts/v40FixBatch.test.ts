/**
 * v40FixBatch.test.ts — THE v40 FIX-BATCH GATE (owner on-device pass 10-14: the
 * Bohemian-Rhapsody round's A–G plus the practice-video round's H, J, K, L).
 *
 * Three layers, the team's usual shape:
 *   1. PURE LOGIC — the decisions each fix rests on: the OCR garbage guard (A), the
 *      tuner's cents readout (D), the cloud-import reason line (F), the take's two
 *      listen controls (H), the read-back verdict that stands between a corrupt
 *      device write and the share sheet (K), and the tab cut into whole-take blocks
 *      (L);
 *   2. LIVE-SOURCE GUARDS — the wiring, read from the REAL files (see
 *      services/v40FixContract.ts), including the screen-level mounts no pure test
 *      can see;
 *   3. MUTATION PROBES — every guard run against a mutated copy that MUST fail, and
 *      the mutation is asserted to have really changed the source first (a probe
 *      whose mutation missed is not evidence).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  CLOUD_IMPORT_EMPTY_LINE,
  CLOUD_IMPORT_FAILED_LINE,
  CLOUD_IMPORT_SUPPORTED_TYPES_LINE,
  cloudImportOutcomeLine,
  cloudImportReasonLine,
} from '../src/services/cloudImport';
import {
  COVER_SCAN_GARBLED_LINE,
  coverQueryFromScan,
  coverQueryFromText,
  hasGluedInnerPunctuation,
  isGarbageOcrLine,
} from '../src/services/coverScan';
import {
  TAB_CELLS_PER_WINDOW,
  TAB_WINDOWS_CAPTION,
  buildGuitarTab,
  tabLines,
  tabLinesFor,
  tabWindowCount,
  tabWindowLabel,
  tabWindows,
} from '../src/services/guitarTab';
import { midiBytesToBase64 } from '../src/services/midiExport';
import {
  PLAY_THIS_VERSION_EMPTY_LINE,
  PLAY_THIS_VERSION_LABEL,
  PLAY_YOUR_TAKE_CAPTION,
  PLAY_YOUR_TAKE_LABEL,
  STOP_THIS_VERSION_LABEL,
  STOP_YOUR_TAKE_LABEL,
  TAKE_PLAY_BUSY_LABEL,
  TAKE_PLAYBACK_MISSING_LINE,
  takeListenModel,
} from '../src/services/takePlayback';
import {
  TAKE_PDF_READBACK_FAILED_MESSAGE,
  hasPdfHeaderAtByteZero,
  pdfBase64ToBytes,
  takePdfReadBackProblem,
  validateTakePdf,
  writePdf,
} from '../src/services/takeNotationPdf';
import { tunerCentsReadout } from '../src/services/tuner';
import type { TunerReading } from '../src/services/tuner';
import {
  V40_CLOUD_IMPORT_PATH,
  V40_CLOUD_SCREEN_PATH,
  V40_CONTRACT_PATH,
  V40_COVER_SCAN_PATH,
  V40_EDITOR_PATH,
  V40_GUITAR_TAB_PATH,
  V40_HISTORY_PATH,
  V40_LISTEN_MODEL_PATH,
  V40_PDF_PATH,
  V40_SEND_DEVICE_PATH,
  V40_TABS_PATH,
  V40_TIER1_MODULES,
  V40_TIER1_SUITES,
  V40_TUNER_METER_PATH,
  V40_VIDEO_PATH,
  cloudRefusalReachesTheCard,
  coverScanDropsGarbageBeforeChoosing,
  coverScanWritesOffGluedPunctuationOnItsOwn,
  historyShareIsGatedOnTheModel,
  practiceVideoAppliesItsSessionBeforePlayback,
  takeEditorMountsTheOneListenRow,
  takeShareVerifiesTheWrittenFile,
  takeTabsRendersEveryBlock,
  tier1ListsTheV40Fixes,
  tunerUnitHangsOffItsValue,
} from '../src/services/v40FixContract';

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

const COVER_SCAN = readAppFile(V40_COVER_SCAN_PATH);
const TUNER_METER = readAppFile(V40_TUNER_METER_PATH);
const CLOUD_SCREEN = readAppFile(V40_CLOUD_SCREEN_PATH);
const EDITOR = readAppFile(V40_EDITOR_PATH);
const TABS = readAppFile(V40_TABS_PATH);
const HISTORY = readAppFile(V40_HISTORY_PATH);
const VIDEO = readAppFile(V40_VIDEO_PATH);
const SEND_DEVICE = readAppFile(V40_SEND_DEVICE_PATH);
const CONTRACT = readAppFile(V40_CONTRACT_PATH);
const TSCONFIG = readAppFile('tsconfig.tier1.json');
const PACKAGE = readAppFile('package.json');

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE LOGIC
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nv40 fix A — the OCR garbled-line guard');

/**
 * THE BROKEN READS THIS GUARD TARGETS (fixtures verified against the shipped
 * module, not guessed): a run of glued fragments — the recogniser failing to put a
 * space where two words meet — and a capital appearing inside a lower-case run.
 */
const GARBLED_FIXTURE = 'Rha,psody thy,Be-';
assertEq(isGarbageOcrLine(GARBLED_FIXTURE), true, 'a run of glued fragments is written off');
assertEq(isGarbageOcrLine('thy,Be-'), true, 'a single glued fragment is written off');
assertEq(isGarbageOcrLine('BohemianRhapsody'), true, 'a capital glued inside a word is written off');
assertEq(isGarbageOcrLine('  '), true, 'an empty line is not a title');
assertEq(isGarbageOcrLine('----'), true, 'a line of repeated marks is written off');
assertEq(isGarbageOcrLine('Bohemian Rhapsody'), false, 'a clean title is NOT written off');
assertEq(isGarbageOcrLine('Queen'), false, 'a clean one-word title is NOT written off');
assertEq(isGarbageOcrLine('Freddie Mercury'), false, 'a clean composer line is NOT written off');
assertEq(
  isGarbageOcrLine('A Night at the Opera'),
  false,
  'a real multi-word title survives the guard',
);

const withdrawn = coverQueryFromText(`Bohemian Rhapsody\n${GARBLED_FIXTURE}\nQUEEN`);
assert(withdrawn.garbled >= 1, 'the scan counts the broken line it dropped');
assert(
  withdrawn.query.indexOf('Rha,psody') < 0 && withdrawn.query.indexOf('thy,Be-') < 0,
  `the broken read never reaches the query: "${withdrawn.query}"`,
);
assert(
  withdrawn.query.toLowerCase().indexOf('bohemian') >= 0,
  'the clean title is still the query the money path uses',
);

/**
 * THE BOUNDARY THAT WAS STILL LEAKING — CLOSED (v40 fix A, round 4). The owner's
 * on-device read carries ONE glued fragment among four tokens ("thy,Be-" — a comma
 * glued between two letters), which is below MIN_GARBLE_TOKENS, so the line used to
 * be searched as the query with `garbled: 0`: the exact bug the owner reported, and
 * the reason item A could not be called done in round 3.
 *
 * A mark from GARBLE_INNER_PUNCTUATION glued BETWEEN TWO LETTERS is now severe on its
 * own: no printed word carries a comma, a bracket, a slash or a star inside it, so
 * that one signal writes the line off without a second one. The two sides must be
 * LETTERS, so a printed catalogue number ("Op.27") is untouched.
 */
const OWNERS_ON_DEVICE_READ = "thy,Be- I'm Freddie Mercurycause";
assertEq(
  isGarbageOcrLine(OWNERS_ON_DEVICE_READ),
  true,
  "BOUNDARY CLOSED: the owner's on-device read is written off on its own",
);
assertEq(
  hasGluedInnerPunctuation('thy,Be-'),
  true,
  'one punctuation mark glued between two letters is severe on its own',
);
assertEq(
  hasGluedInnerPunctuation('Rha,psody'),
  true,
  '…and the same glue in the longer fixture is severe too',
);
assertEq(
  hasGluedInnerPunctuation('Op.27'),
  false,
  'a catalogue number (a dot between a letter and a digit) is NOT severe',
);
assertEq(hasGluedInnerPunctuation('Elise'), false, 'a plain word is not severe');
assertEq(hasGluedInnerPunctuation("I'm"), false, "an apostrophe inside a word is not severe");
assertEq(hasGluedInnerPunctuation('thy,'), false, 'a trailing mark is not glue');

const ownersReadAlone = coverQueryFromText(OWNERS_ON_DEVICE_READ);
assertEq(ownersReadAlone.garbled, 1, 'the read of ONLY that line counts its line as garbled');
assertEq(ownersReadAlone.query, '', '…and yields NO query for the money path');
assertEq(ownersReadAlone.lines.length, 0, '…and never promotes the broken line to a title');
assertEq(ownersReadAlone.titleLine, null, '…and names no title');
assertEq(ownersReadAlone.composerLine, null, '…and names no composer either');

/** The screen's own path for that read: the honest garbled sentence, never a search. */
const ownersReadOutcome = coverQueryFromScan({ ocrText: OWNERS_ON_DEVICE_READ });
assertEq(ownersReadOutcome.status, 'no-text', 'the scan screens it as "nothing to search"');
assertEq(ownersReadOutcome.query, '', 'the scan runs NO search on a one-line broken read');
assertEq(
  ownersReadOutcome.line,
  COVER_SCAN_GARBLED_LINE,
  'the scan says it read something garbled — its own honest sentence, not "no title"',
);

/** Legit single-line reads are untouched — the guard must not eat a real cover. */
assertEq(isGarbageOcrLine('Für Elise'), false, 'a legit single-line read survives: Für Elise');
assertEq(
  isGarbageOcrLine('Air on the G String'),
  false,
  'a legit single-line read survives: Air on the G String',
);
assertEq(
  isGarbageOcrLine('Moonlight Sonata'),
  false,
  'a legit single-line read survives: Moonlight Sonata',
);
assertEq(
  isGarbageOcrLine('Piano Sonata No. 14'),
  false,
  'a printed catalogue number in a real title survives',
);
assertEq(
  isGarbageOcrLine("Guns N' Roses"),
  false,
  'an apostrophe inside a real word survives',
);

/**
 * AND A PAGE THAT CARRIES ONE BROKEN LINE STILL RESOLVES: the same owner's read on a
 * multi-line page is dropped as a line and the clean title still reaches the query.
 */
const ownersPage = coverQueryFromText(`Bohemian Rhapsody\n${OWNERS_ON_DEVICE_READ}\nQUEEN`);
assert(ownersPage.garbled >= 1, 'the page counts the broken line it dropped');
assert(
  ownersPage.query.indexOf('Thy') < 0 && ownersPage.query.indexOf('Freddie') < 0,
  `the broken read never reaches the query: "${ownersPage.query}"`,
);
assert(
  ownersPage.query.toLowerCase().indexOf('bohemian') >= 0,
  'the clean title is still the query the money path uses',
);

console.log('\nv40 fix D — the tuner’s cents readout');
function noteReading(cents: number): TunerReading {
  return { kind: 'note', cents } as unknown as TunerReading;
}
const idleReadout = tunerCentsReadout(null);
assertEq(idleReadout.unit, null, 'an idle dial has NO unit to hang off nothing');
assert(idleReadout.value.length > 0, 'the idle dial still shows its own placeholder');
assertEq(
  tunerCentsReadout({ kind: 'no-signal' } as unknown as TunerReading).unit,
  null,
  'a take with no note named has no unit either',
);
assertEq(tunerCentsReadout(noteReading(8)).value, '+8', 'a sharp reading carries its sign');
assertEq(tunerCentsReadout(noteReading(8)).unit, 'cents', 'a real reading carries the unit');
assertEq(tunerCentsReadout(noteReading(-12)).value, '-12', 'a flat reading keeps its own sign');
assertEq(tunerCentsReadout(noteReading(0)).value, '0', 'an in-tune reading is a value of 0, not empty');
assertEq(tunerCentsReadout(noteReading(0)).unit, 'cents', '…and it still has a unit');
assertEq(
  tunerCentsReadout(noteReading(-12)).value.indexOf('--'),
  -1,
  'the old "--cents" placeholder can never come back through the model',
);

console.log('\nv40 fix F — the cloud-import refusal line');
assertEq(cloudImportReasonLine(null), null, 'no reason = no bracket of nothing');
assertEq(cloudImportReasonLine('   '), null, 'a blank reason is not printed');
assertEq(
  cloudImportReasonLine('Unsupported file type.\nSupported formats: pdf'),
  'Unsupported file type. Supported formats: pdf',
  'the file layer’s own reason is carried, on one line',
);
assert(
  cloudImportReasonLine('x'.repeat(400))!.length <= 180,
  'a long reason is bounded rather than pasted whole',
);
const refusedJpg = cloudImportOutcomeLine({
  imported: 0,
  skipped: 1,
  cancelled: false,
  firstError: 'Unsupported file type. Supported formats: pdf, midi',
});
assert(refusedJpg.indexOf('Unsupported file type') >= 0, 'the refusal names the real reason');
assert(refusedJpg.indexOf(CLOUD_IMPORT_SUPPORTED_TYPES_LINE) >= 0, '…and says what this app CAN open');
assert(refusedJpg.indexOf('not a score this app can open') >= 0, '…and says the file was left out');
assert(
  refusedJpg.indexOf('0 files are in your Library') < 0,
  'the old "0 files are in your Library" line is gone',
);
const failedImport = cloudImportOutcomeLine({
  imported: 0,
  skipped: 0,
  cancelled: false,
  firstError: 'Storage is full',
});
assert(failedImport.indexOf('Storage is full') >= 0, 'a failed run keeps the real cause');
assert(failedImport.indexOf(CLOUD_IMPORT_FAILED_LINE) >= 0, '…inside its honest failure sentence');
assertEq(
  cloudImportOutcomeLine({ imported: 2, skipped: 0, cancelled: false }),
  '2 files are in your Library — they open offline.',
  'a run that imported files says so plainly',
);
assertEq(
  cloudImportOutcomeLine({ imported: 0, skipped: 0, cancelled: true }),
  CLOUD_IMPORT_EMPTY_LINE,
  'a cancelled picker explains itself',
);

console.log('\nv40 fix H — the two versions of a take');
const listenBoth = takeListenModel({ takeAvailable: true, versionAvailable: true });
assertEq(listenBoth.take.label, PLAY_YOUR_TAKE_LABEL, 'the recording has its own control');
assertEq(listenBoth.version.label, PLAY_THIS_VERSION_LABEL, 'the corrected take has its own control');
assertEq(listenBoth.take.caption, PLAY_YOUR_TAKE_CAPTION, 'the recording says what it is');
assert(listenBoth.hasAnyAction, 'a take with both versions has something to play');
const listenBusy = takeListenModel({ takeAvailable: true, takeBusy: true, versionAvailable: true });
assertEq(listenBusy.take.label, TAKE_PLAY_BUSY_LABEL, 'a loading recording says so');
assertEq(listenBusy.take.disabled, true, '…and cannot be pressed twice');
const listenPlaying = takeListenModel({ takeAvailable: true, takePlaying: true, versionAvailable: true });
assertEq(listenPlaying.take.label, STOP_YOUR_TAKE_LABEL, 'the same button stops the recording');
const listenVersionPlaying = takeListenModel({ takeAvailable: true, versionPlaying: true, versionAvailable: true });
assertEq(listenVersionPlaying.version.label, STOP_THIS_VERSION_LABEL, 'the same button stops the version');
const listenNoClip = takeListenModel({ takeAvailable: false, versionAvailable: true });
assertEq(listenNoClip.take.disabled, true, 'a row whose clip is gone does not offer a dead button');
assertEq(listenNoClip.take.caption, TAKE_PLAYBACK_MISSING_LINE, '…it says why instead');
assert(listenNoClip.hasAnyAction, 'the other version still plays');
const listenVersionEmpty = takeListenModel({ takeAvailable: true, versionAvailable: false });
assertEq(listenVersionEmpty.version.disabled, true, 'a version with no notes cannot be played');
assertEq(
  listenVersionEmpty.version.caption,
  PLAY_THIS_VERSION_EMPTY_LINE,
  '…and says there is nothing to play yet',
);
assertEq(
  takeListenModel({}).hasAnyAction,
  false,
  'a take with nothing playable offers nothing',
);

console.log('\nv40 fix K — the read-back verdict');
const realPdf = writePdf(['BT /F1 12 Tf 72 720 Td (Hello) Tj ET']);
assert(realPdf.length > 200, `the writer produced ${realPdf.length} bytes`);
assert(hasPdfHeaderAtByteZero(realPdf), 'a real PDF starts with the header at byte 0');
assert(validateTakePdf(realPdf).ok, '…and it is the same file the structure gate already passes');
const realBase64 = midiBytesToBase64(realPdf);
assertEq(pdfBase64ToBytes(realBase64)!.length, realPdf.length, 'the read-back decoder round-trips');
assertEq(pdfBase64ToBytes(realBase64)![0], 0x25, '…starting at the "%" of the header');
assertEq(pdfBase64ToBytes(realBase64)![4], realPdf[4], '…byte for byte');
assertEq(
  takePdfReadBackProblem(realBase64, realPdf),
  null,
  'THE FILE ON DISK IS THE FILE WE WROTE — nothing is refused',
);
assertEq(
  takePdfReadBackProblem(realPdf, realPdf),
  null,
  'the verdict also accepts the bytes themselves, not only base64 text',
);

const shortReadBack = midiBytesToBase64(realPdf.slice(0, realPdf.length - 4));
assertEq(
  takePdfReadBackProblem(shortReadBack, realPdf),
  TAKE_PDF_READBACK_FAILED_MESSAGE,
  'a file that lost bytes on disk is refused',
);
const headless = Uint8Array.from(realPdf);
headless[0] = 0x20;
assertEq(
  takePdfReadBackProblem(midiBytesToBase64(headless), realPdf),
  TAKE_PDF_READBACK_FAILED_MESSAGE,
  'a file with no PDF header at byte 0 is refused',
);
const flipped = Uint8Array.from(realPdf);
flipped[120] = (flipped[120]! ^ 0xff) & 0xff;
assertEq(
  takePdfReadBackProblem(midiBytesToBase64(flipped), realPdf),
  TAKE_PDF_READBACK_FAILED_MESSAGE,
  'a file whose bytes changed is refused (same length, header intact)',
);
assertEq(
  takePdfReadBackProblem(null, realPdf),
  TAKE_PDF_READBACK_FAILED_MESSAGE,
  'a read-back that returned nothing is refused, never assumed fine',
);
assertEq(
  takePdfReadBackProblem('not base64 at all !!', realPdf),
  TAKE_PDF_READBACK_FAILED_MESSAGE,
  'a mangled read-back is refused',
);
assertEq(
  takePdfReadBackProblem(realBase64, null),
  TAKE_PDF_READBACK_FAILED_MESSAGE,
  'nothing written = nothing to hand over',
);
assertEq(
  takePdfReadBackProblem(realBase64, new Uint8Array(0)),
  TAKE_PDF_READBACK_FAILED_MESSAGE,
  'an empty write is refused',
);
assertEq(
  pdfBase64ToBytes(''),
  null,
  'an empty read is not "a valid empty file"',
);
assert(
  TAKE_PDF_READBACK_FAILED_MESSAGE.indexOf('try again') >= 0 &&
    !/corrupt|because|invalid header/i.test(TAKE_PDF_READBACK_FAILED_MESSAGE),
  `the refusal is a plain, honest sentence: "${TAKE_PDF_READBACK_FAILED_MESSAGE}"`,
);

console.log('\nv40 fix L — the tab as whole-take blocks');
const takeNotes = Array.from({ length: 30 }, (_unused, index) => ({
  midi: 60 + (index % 5),
  startSec: index * 0.5,
  durationSec: 0.5,
}));
const layout = buildGuitarTab(takeNotes);
assertEq(layout.notes.length, 30, 'every note of the take is laid out');
assertEq(
  tabWindowCount(layout),
  Math.ceil(30 / TAB_CELLS_PER_WINDOW),
  'the take is cut into the number of blocks its notes need',
);
const windows = tabWindows(layout);
assertEq(windows.length, tabWindowCount(layout), 'the blocks and the count agree');
assertEq(windows[0]!.fromNote, 0, 'the first block starts at the first note');
assertEq(windows[windows.length - 1]!.toNote, 29, 'the last block ends at the last note');
let seen = 0;
let inOrder = true;
for (const block of windows) {
  assertEq(block.index, windows.indexOf(block), 'each block carries its own index');
  if (block.fromNote !== seen) inOrder = false;
  seen = block.toNote + 1;
}
assert(inOrder, 'EVERY note appears in exactly one block, in order — no gaps, no repeats');
assertEq(seen, 30, 'all 30 notes are covered by the blocks');
assertEq(windows[0]!.lines.length, 6, 'each block is six string lines');
assert(
  windows.every((block) => block.label.indexOf('Notes ') === 0 && block.label.indexOf('of 30') > 0),
  `every block says which notes it holds (e.g. "${windows[0]!.label}")`,
);
assertEq(
  windows[0]!.lines.join('\n'),
  tabLinesFor(layout.notes.slice(0, TAB_CELLS_PER_WINDOW)).join('\n'),
  'a block is the SAME line builder the single strip uses — one cell rule',
);
assertEq(
  tabLines(layout).join('\n'),
  tabLinesFor(layout.notes).join('\n'),
  'the single-strip form delegates to that same builder',
);
assertEq(tabWindowLabel(0, 15, 30), 'Notes 1–16 of 30', 'block labels count the user’s way, from 1');
assertEq(tabWindowCount(buildGuitarTab([])), 0, 'a take with no notes has no blocks');
assertEq(tabWindows(buildGuitarTab([])).length, 0, '…and no empty block is invented');
assertEq(
  tabWindows(layout, { cellsPerWindow: 4 }).length,
  8,
  'the window size is honoured when a caller asks for another one',
);
assert(
  TAB_WINDOWS_CAPTION.length > 0 && TAB_WINDOWS_CAPTION.indexOf('Every note you played') >= 0,
  'the caption promises the whole take, not a first page',
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. LIVE-SOURCE GUARDS
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nv40 fix batch — the live-source walk (floors first)');
assert(COVER_SCAN.length > 8000, `read ${V40_COVER_SCAN_PATH} (${COVER_SCAN.length} chars)`);
assert(TUNER_METER.length > 1000, `read ${V40_TUNER_METER_PATH} (${TUNER_METER.length} chars)`);
assert(CLOUD_SCREEN.length > 5000, `read ${V40_CLOUD_SCREEN_PATH} (${CLOUD_SCREEN.length} chars)`);
assert(EDITOR.length > 20000, `read ${V40_EDITOR_PATH} (${EDITOR.length} chars)`);
assert(TABS.length > 2000, `read ${V40_TABS_PATH} (${TABS.length} chars)`);
assert(HISTORY.length > 20000, `read ${V40_HISTORY_PATH} (${HISTORY.length} chars)`);
assert(VIDEO.length > 8000, `read ${V40_VIDEO_PATH} (${VIDEO.length} chars)`);
assert(SEND_DEVICE.length > 3000, `read ${V40_SEND_DEVICE_PATH} (${SEND_DEVICE.length} chars)`);
assert(CONTRACT.indexOf('maskComments') >= 0, 'the contract masks comments before every check');

assertEq(
  coverScanDropsGarbageBeforeChoosing(COVER_SCAN),
  true,
  'A: the cover scan writes off a broken read BEFORE choosing a title',
);
assertEq(
  coverScanWritesOffGluedPunctuationOnItsOwn(COVER_SCAN),
  true,
  'A: the glued-punctuation carve-out exists and answers BEFORE the token threshold',
);
assertEq(
  tunerUnitHangsOffItsValue(TUNER_METER),
  true,
  'D: the tuner renders the unit only next to a real value',
);
assertEq(
  cloudRefusalReachesTheCard(CLOUD_SCREEN),
  true,
  'F: the cloud card renders the shared outcome line, reason and all',
);
assertEq(
  historyShareIsGatedOnTheModel(HISTORY),
  true,
  'G: History’s Share button exists, gated on the model’s one rule',
);
assertEq(
  takeEditorMountsTheOneListenRow(EDITOR),
  true,
  'H: the editor mounts ONE listen row, outside the view branch (both views)',
);
assertEq(
  practiceVideoAppliesItsSessionBeforePlayback(VIDEO),
  true,
  'J: the practice video applies its playback session before the player mounts',
);
assertEq(
  takeShareVerifiesTheWrittenFile(SEND_DEVICE),
  true,
  'K: every PDF write is read back and verified before the share sheet opens',
);
assertEq(
  takeTabsRendersEveryBlock(TABS),
  true,
  'L: the tab page renders the take in blocks, with the listen row on it',
);
assertEq(
  tier1ListsTheV40Fixes(TSCONFIG, PACKAGE),
  true,
  'the gate lists this round’s new module and suite in both files',
);
/** The batch's own modules are the ones the tests above import — they exist. */
assert(V40_PDF_PATH.length > 0 && V40_GUITAR_TAB_PATH.length > 0, 'the batch names its model files');
assert(V40_LISTEN_MODEL_PATH.length > 0 && V40_CLOUD_IMPORT_PATH.length > 0, '…and its pure models');

// ─────────────────────────────────────────────────────────────────────────────
// 3. MUTATION PROBES — every guard above must bite
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nv40 fix batch — the mutation probes');

/** A probe is only evidence when its mutation really changed the source. */
function probe(label: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${label}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${label}`);
}

const scanBeforeTheGuard = mutate(COVER_SCAN, 'const broken = isGarbageOcrLine(cleaned);', 'const broken = false;');
probe('the cover scan stops judging the read (the owner’s bug)', scanBeforeTheGuard, COVER_SCAN, () =>
  coverScanDropsGarbageBeforeChoosing(scanBeforeTheGuard),
);

/** The round-3 state, exactly: the carve-out is simply not there any more. */
const SEVERE_LINE = 'if (tokens.some((token) => hasGluedInnerPunctuation(token))) return true;';
const scanBackToTheCountOnly = mutate(COVER_SCAN, SEVERE_LINE, 'const gluedIsSevere = false;');
probe(
  'the glued punctuation is left to the two-token count again (the owner’s case)',
  scanBackToTheCountOnly,
  COVER_SCAN,
  () => coverScanWritesOffGluedPunctuationOnItsOwn(scanBackToTheCountOnly),
);
/**
 * …and the same rule placed BELOW the threshold — the state where the two-token count
 * would answer for a one-token line again — must fail the guard too.
 */
const severeMovedBelowTheCount = mutate(
  mutate(COVER_SCAN, `${SEVERE_LINE}\n  `, ''),
  'return affected > 0 && affected === tokens.length;',
  `return affected > 0 && affected === tokens.length;\n  ${SEVERE_LINE}`,
);
probe(
  'the carve-out is moved below the two-token threshold',
  severeMovedBelowTheCount,
  COVER_SCAN,
  () => coverScanWritesOffGluedPunctuationOnItsOwn(severeMovedBelowTheCount),
);

const meterWithoutTheCondition = mutate(
  TUNER_METER,
  '{readout.unit ? <Text style={styles.centsUnit}>{readout.unit}</Text> : null}',
  '<Text style={styles.centsUnit}>{TUNER_CENTS_SUFFIX}</Text>',
);
probe('the unit is printed next to nothing again', meterWithoutTheCondition, TUNER_METER, () =>
  tunerUnitHangsOffItsValue(meterWithoutTheCondition),
);

const cardWithoutTheSharedLine = mutate(
  CLOUD_SCREEN,
  'cloudImportOutcomeLine(outcome)',
  'handBuiltRefusalLine(outcome)',
);
probe('the card stops using the outcome line that carries the reason', cardWithoutTheSharedLine, CLOUD_SCREEN, () =>
  cloudRefusalReachesTheCard(cardWithoutTheSharedLine),
);

const cardRebuildingTheWording = mutate(
  CLOUD_SCREEN,
  'cloudImportOutcomeLine(outcome)',
  'outcome.imported === 0 ? "0 files are in your Library" : cloudImportOutcomeLine(outcome)',
);
probe('the card rebuilds the refusal wording itself', cardRebuildingTheWording, CLOUD_SCREEN, () =>
  cloudRefusalReachesTheCard(cardRebuildingTheWording),
);

const historyUnGated = mutate(HISTORY, 'shareTakeOffered(item.capture) ? (', 'true ? (');
probe('the Share button is no longer gated by the model', historyUnGated, HISTORY, () =>
  historyShareIsGatedOnTheModel(historyUnGated),
);

const historyWithoutTheSheet = mutate(HISTORY, '<TakeSendToSheet', '<View');
probe('History has no send-to sheet to open', historyWithoutTheSheet, HISTORY, () =>
  historyShareIsGatedOnTheModel(historyWithoutTheSheet),
);

const historySecondMidiPath = mutate(
  HISTORY,
  'onSendMidi={() => (sendTake ? handleExportTake(sendTake) : undefined)}',
  'onSendMidi={() => exportTakeMidiSomewhereElse(sendTake)}',
);
probe('the sheet stops using the screen’s own MIDI export', historySecondMidiPath, HISTORY, () =>
  historyShareIsGatedOnTheModel(historySecondMidiPath),
);

const editorWithoutTheMount = mutate(EDITOR, '{listenRow}', '');
probe('the listen row is not mounted on the page (the owner’s bug)', editorWithoutTheMount, EDITOR, () =>
  takeEditorMountsTheOneListenRow(editorWithoutTheMount),
);

const editorSecondRow = mutate(
  EDITOR,
  'const listenRow = (',
  'const duplicateRow = <TakeListenRow onToggleTake={toggleYourTake} />;\n  const listenRow = (',
);
probe('a SECOND listen row is mounted (two pairs of players)', editorSecondRow, EDITOR, () =>
  takeEditorMountsTheOneListenRow(editorSecondRow),
);

const editorNotHandingTheRowOn = mutate(EDITOR, 'listenRow={listenRow}', 'listenRow={undefined}');
probe('the tab page is no longer handed that row', editorNotHandingTheRowOn, EDITOR, () =>
  takeEditorMountsTheOneListenRow(editorNotHandingTheRowOn),
);

const editorWithoutThePlayer = mutate(EDITOR, 'useTakeClipPlayer(', 'neverPlaysAnything(');
probe('“Play your Take” has no player behind it', editorWithoutThePlayer, EDITOR, () =>
  takeEditorMountsTheOneListenRow(editorWithoutThePlayer),
);

const videoWithoutTheEffect = mutate(VIDEO, "if (phase !== 'playback') return undefined;", 'if (false) return undefined;');
probe('the session is no longer applied before the player mounts (the owner’s bug)', videoWithoutTheEffect, VIDEO, () =>
  practiceVideoAppliesItsSessionBeforePlayback(videoWithoutTheEffect),
);

const videoWithoutTheTransport = mutate(VIDEO, 'onPress={() => void toggleVideo()}', 'onPress={() => undefined}');
probe('the watch surface has no play control', videoWithoutTheTransport, VIDEO, () =>
  practiceVideoAppliesItsSessionBeforePlayback(videoWithoutTheTransport),
);

const sendWithoutTheReadBack = mutate(
  SEND_DEVICE,
  'const problem = await verifyWrittenTakePdf(fileUri, bytes, deps);',
  'const problem = null;',
);
probe('the PDF is written and handed over without being read back (the owner’s bug)', sendWithoutTheReadBack, SEND_DEVICE, () =>
  takeShareVerifiesTheWrittenFile(sendWithoutTheReadBack),
);

const sendSharingBeforeTheVerdict = mutate(
  SEND_DEVICE,
  'verifyWrittenTakePdf(fileUri, bytes, deps)',
  'Promise.resolve(null)',
);
probe('the share sheet opens before anything is proven on disk', sendSharingBeforeTheVerdict, SEND_DEVICE, () =>
  takeShareVerifiesTheWrittenFile(sendSharingBeforeTheVerdict),
);

const tabsBackToTheStrip = mutate(
  TABS,
  'const windows = useMemo(() => tabWindows(layout), [layout]);',
  'const windows = useMemo(() => tabLines(layout), [layout]);',
);
probe('the tab page is a single horizontal strip again (the owner’s bug)', tabsBackToTheStrip, TABS, () =>
  takeTabsRendersEveryBlock(tabsBackToTheStrip),
);

const tabsWithTheStripAsWell = mutate(TABS, '>{TAB_WINDOWS_CAPTION}<', '>{TAB_WINDOWS_CAPTION}{tabLines(layout)}<');
probe('the strip is printed as well as the blocks', tabsWithTheStripAsWell, TABS, () =>
  takeTabsRendersEveryBlock(tabsWithTheStripAsWell),
);

const tabsWithoutTheListenRow = mutate(TABS, '{listenRow}', '');
probe('the tab page cannot be heard', tabsWithoutTheListenRow, TABS, () =>
  takeTabsRendersEveryBlock(tabsWithoutTheListenRow),
);

const packageWithoutTheSuite = mutate(
  PACKAGE,
  '/tmp/tier1-test/scripts/v40FixBatch.test.js',
  '/tmp/tier1-test/scripts/never-run.test.js',
);
probe('the new suite is missing from the gate chain', packageWithoutTheSuite, PACKAGE, () =>
  tier1ListsTheV40Fixes(TSCONFIG, packageWithoutTheSuite),
);

const tsconfigWithoutTheContract = mutate(
  TSCONFIG,
  `"${V40_TIER1_MODULES[0]}"`,
  '"src/services/not-this-file.ts"',
);
probe('the contract is missing from the compiled set', tsconfigWithoutTheContract, TSCONFIG, () =>
  tier1ListsTheV40Fixes(tsconfigWithoutTheContract, PACKAGE),
);

assertEq(V40_TIER1_SUITES.length, 1, 'this suite names itself once');
assert(V40_TIER1_MODULES.length >= 2, 'the module list names the contract and this suite');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
