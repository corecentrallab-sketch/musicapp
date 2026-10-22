/**
 * scorePdf.test.ts — v44 slice C: the transposed FULL SCORE as a real PDF.
 *
 * Four things are proven here, none of which a screenshot can show:
 *
 * 1. THE PDF IS REAL. Every bundled public-domain score is built into bytes,
 *    parsed back with the app's own PDF structure parser, and every drawing point
 *    is checked to lie on the paper. Byte-level: ASCII only, `%PDF` at byte 0.
 *
 * 2. THE PDF IS THE WHOLE SCORE. The bars drawn are compared with the ABC's own
 *    bar count (`countAbcBars`, the line the owner sees on screen) and the
 *    notational events drawn with the notes parsed. A 4-bar PDF of a 16-bar piece
 *    is the exact defect this slice exists to prevent, so it is a hard assert for
 *    every bundled piece, at the original key AND transposed.
 *
 * 3. IT SAYS WHAT IT IS, AND NOTHING MORE. The file name carries the piece and
 *    the key; the footer says "Transposed from NoteSnap's public-domain library";
 *    no edition/publisher claim may appear anywhere in the bytes.
 *
 * 4. THE SURFACE IS WIRED, AND THE GUARDS BITE. The reader screen and the device
 *    module are scanned as source, then MUTATED in-suite (cap the bars, revert the
 *    file name, strip the button, add an edition claim) and the same guard must
 *    fail — proof the guard is not a tautology.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
import { PUBLIC_DOMAIN_ABC_SCORES } from '../src/data/abcScores';
import { countAbcBars } from '../src/services/transposedScore';
import {
  SCORE_PDF_CTA,
  SCORE_PDF_FOOTER,
  SCORE_PDF_NOT_EDITION_LINE,
  abcDefaultUnits,
  abcKeySignature,
  abcMeter,
  asciiFold,
  buildScorePdf,
  editionClaimIn,
  parseAbcScore,
  scorePdfFileName,
  scorePdfHandedOverMessage,
  validateScorePdf,
} from '../src/services/scorePdf';
import {
  PDF_DEVICE_PATH,
  PDF_SERVICE_PATH,
  READER_SCREEN_PATH,
  pdfCopyMakesNoEditionClaim,
  pdfFileNameIsHonest,
  pdfIsValidatedAndShared,
  readerExportsTheWholeScore,
  readerHasPrintPdfControl,
  scorePdfBuilderHasNoBarCap,
} from '../src/services/v44PrintPdfContract';

declare const require: any;
declare const process: any;
declare const Buffer: any;

let passes = 0;
let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  try {
    assert.deepStrictEqual(actual, expected);
    passes += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(
      `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
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
function asciiOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] & 0xff);
  return out;
}

// ─── 1. ABC parsing ─────────────────────────────────────────────

console.log('\nv44C-1 — the ABC is parsed as written');
assertEq(abcKeySignature('Am').accidentals, 0, 'K:Am carries no sharps or flats');
assertEq(abcKeySignature('Bm').byLetter.F, 1, 'K:Bm raises F (two sharps: F#, C#)');
assertEq(abcKeySignature('Bm').byLetter.C, 1, 'K:Bm raises C');
assertEq(abcKeySignature('Bm').byLetter.G, 0, 'K:Bm leaves G natural');
assertEq(abcKeySignature('Eb').byLetter.B, -1, 'K:Eb flats B');
assertEq(abcKeySignature('Eb').accidentals, -3, 'K:Eb is three flats');
assertEq(abcKeySignature('Eb clarinet').label, 'Eb', 'a `K:` field with a suffix keeps its tonic as the label');
assertEq(abcMeter('3/8').beats, 3, 'M:3/8 is three beats');
assertEq(abcMeter('C').beats, 4, 'M:C is common time (4/4)');
assertEq(abcMeter('C|').unit, 2, 'M:C| is cut time (2/2)');
assertEq(abcDefaultUnits('1/8'), 1, 'L:1/8 is one eighth-note unit');
assertEq(abcDefaultUnits('1/4'), 2, 'L:1/4 is two eighth-note units');
assertEq(abcDefaultUnits('1/16'), 0.5, 'L:1/16 is half a unit');
assertEq(asciiFold('Für Elise'), 'Fur Elise', 'titles are folded to single-byte ASCII for the page');

const felix = PUBLIC_DOMAIN_ABC_SCORES.find((score) => score.id === 'fur-elise');
const parsedFelix = parseAbcScore(felix ? felix.abc : '');
assertEq(parsedFelix.measures.length, 16, 'Für Elise parses into its 16 bars');
assertEq(parsedFelix.key.accidentals, 0, 'Für Elise is in A minor (no key signature)');
assertEq(parsedFelix.meter.beats, 3, 'Für Elise is in 3/8');
const firstMeasure = parsedFelix.measures[0];
assertEq(firstMeasure.events.length, 3, 'bar 1 holds three eighth notes (E E E)');
assertEq(firstMeasure.events[0].letter, 'E', 'bar 1 note 1 is an E');
assertEq(firstMeasure.events[0].octave, 5, 'a lowercase ABC letter sounds an octave up (E5)');
assertEq(firstMeasure.events[1].accidental, 1, 'the ^ is read as a sharp, not guessed from the key');
assertEq(firstMeasure.events[1].letter, 'D', 'the sharpened note is D#');
assertEq(parsedFelix.measures[3].events[0].units, 2, 'a `2` after a note doubles its length');

const synthetic = parseAbcScore(
  ['X:1', 'T:Probe', 'M:4/4', 'L:1/4', 'K:C', '[CEG] c2 z2 |: d/e/f/g/ a4 :| [1 B8 |]'].join('\n'),
);
assertEq(synthetic.measures.length, 3, 'repeat marks, endings and the closing bar are bar lines, not music');
assertEq(synthetic.measures[0].events[0].chordSize, 3, 'a bracketed chord is ONE onset with three heads');
assertEq(synthetic.measures[0].events[1].chordSize, 3, '…and every member carries the chord size');
assertEq(synthetic.measures[0].events[4].rest, true, 'z is a rest');
assertEq(editionClaimIn('Rendered - not a published edition.'), null, 'a DENIAL of an edition is not a claim');
assertEq(editionClaimIn('Official edition of the work'), 'official edition', 'an asserted edition IS a claim');
assertEq(synthetic.measures[1].events.length, 5, 'slashed note groups are read as their notes (d e f g a)');

// ─── 2. The PDF is real and COMPLETE for every bundled score ─────

console.log('\nv44C-2 — every bundled PD score builds a real, COMPLETE PDF');
assertEq(PUBLIC_DOMAIN_ABC_SCORES.length >= 8, true, 'the bundled public-domain library is present');
for (const score of PUBLIC_DOMAIN_ABC_SCORES) {
  const keyboardBars = countAbcBars(score.abc);
  const original = buildScorePdf({ abc: score.abc, title: score.title, keyLabel: score.keyLabel, offset: 0 });
  if (!original) {
    assertEq(true, false, `${score.title}: a PDF was built`);
    continue;
  }
  const check = validateScorePdf(original);
  assertEq(check.ok, true, `${score.title}: the PDF parses back clean (${check.errors.join('; ') || 'no errors'})`);
  assertEq(original.drawnMeasures, keyboardBars, `${score.title}: all ${keyboardBars} bars are on the page (not a 4-bar window)`);
  assertEq(original.drawnNotes, original.noteCount, `${score.title}: all ${original.noteCount} notes are drawn`);
  assertEq(original.pageCount >= 1, true, `${score.title}: ${original.pageCount} page(s) written`);
  assertEq(asciiOf(original.bytes).startsWith('%PDF-1.4'), true, `${score.title}: the file starts with a PDF header`);
  assertEq(
    /[^\x00-\x7F]/.test(asciiOf(original.bytes)),
    false,
    `${score.title}: every byte is single-byte ASCII (no mangled glyphs)`,
  );
  const text = asciiOf(original.bytes);
  assertEq(text.indexOf(SCORE_PDF_FOOTER) >= 0, true, `${score.title}: the page carries the honest footer`);
  assertEq(
    text.indexOf('not a published edition') >= 0,
    true,
    `${score.title}: the page says it is not a published edition`,
  );
  // …and the transposed build is the SAME full score, re-keyed.
  const transposed = buildScorePdf({
    abc: score.abc,
    title: score.title,
    keyLabel: 'Bm',
    offset: 2,
  });
  assertEq(transposed ? transposed.drawnMeasures : -1, keyboardBars, `${score.title}: the transposed PDF still holds every bar`);
  assertEq(
    transposed ? transposed.headerLine.indexOf('transposed to Bm (+2 semitones)') >= 0 : false,
    true,
    `${score.title}: the transposed PDF says which key it is in and by how much`,
  );
}

console.log('\nv44C-3 — the honest file name');
assertEq(
  scorePdfFileName({ title: 'Für Elise', keyLabel: 'Bm', offset: 2 }),
  'Fur Elise (transposed Bm) - NoteSnap.pdf',
  'a transposed copy is named "<title> (transposed <key>) - NoteSnap.pdf"',
);
assertEq(
  scorePdfFileName({ title: 'Ode to Joy', keyLabel: 'C', offset: 0 }),
  'Ode to Joy (original key C) - NoteSnap.pdf',
  'an untransposed copy says it is the original key (no false "transposed" claim)',
);
assertEq(
  scorePdfFileName({ title: 'Für Elise', keyLabel: 'G', offset: -5 }),
  'Fur Elise (transposed G) - NoteSnap.pdf',
  'a downward transposition is named by the key it is IN, not by the direction',
);
assertEq(
  /official|edition|publisher/i.test(scorePdfFileName({ title: 'Test', keyLabel: 'C', offset: 0 })),
  false,
  'the file name claims no edition and no publisher',
);
assertEq(scorePdfFileName({ title: '', keyLabel: '', offset: 0 }), 'NoteSnap score (original key C) - NoteSnap.pdf', 'an untitled score still gets an honest, non-empty name');
assertEq(SCORE_PDF_CTA.indexOf('PDF') >= 0, true, 'the control names the thing it makes');
assertEq(scorePdfHandedOverMessage(16).indexOf('16 bars') >= 0, true, 'the confirmation counts the bars it printed');
assertEq(scorePdfHandedOverMessage(1).indexOf('1 bar)') >= 0, true, '…in the singular when there is one');

console.log('\nv44C-4 — nothing to write is reported, never faked');
assertEq(buildScorePdf({ abc: '', title: 'Empty' }), null, 'an empty ABC builds no PDF (a blank staff would be a lie)');
assertEq(buildScorePdf({ abc: 'X:1\nT:Nothing\nK:C\n| | |', title: 'No notes' }), null, 'bars with no notes build no PDF');
assertEq(validateScorePdf(null).ok, false, 'a missing build fails its own validation');

// ─── 3. The surfaces are wired ──────────────────────────────────

console.log('\nv44C-5 — the reader and the device half are wired');
const readerSource = read(READER_SCREEN_PATH);
const deviceSource = read(PDF_DEVICE_PATH);
const serviceSource = read(PDF_SERVICE_PATH);

assertEq(readerHasPrintPdfControl(readerSource), true, 'the reader renders the print / share-as-PDF control, and it calls the export');
assertEq(readerExportsTheWholeScore(readerSource), true, 'the reader hands over `abc` — the score on screen, in the chosen key — never a slice');
assertEq(scorePdfBuilderHasNoBarCap(serviceSource), true, 'the builder has no bar budget, no excerpt constant and no slice');
assertEq(pdfIsValidatedAndShared(deviceSource), true, 'the PDF is validated, read back off disk, then handed to the system share sheet as application/pdf');
assertEq(pdfFileNameIsHonest(serviceSource), true, 'the file name is built by scorePdfFileName with the transposed/original-key pattern');
assertEq(pdfCopyMakesNoEditionClaim(serviceSource), true, 'the builder\'s copy makes no edition claim and keeps the honest footer');

// ─── 4. The guards bite (in-suite mutations) ────────────────────

console.log('\nv44C-6 — each guard FAILS on a mutated copy of the real source');
const cappedReader = readerSource.replace(
  'const outcome = await shareScorePdf({\n        abc,',
  'const outcome = await shareScorePdf({\n        abc: abc.slice(0, 40),',
);
assertEq(cappedReader !== readerSource, true, 'mutation probe A applied (the export is fed a slice of the score)');
assertEq(readerExportsTheWholeScore(cappedReader), false, '…and the full-score guard FAILS on it (the 4-bar class is caught)');

const noButton = readerSource
  .replace(/onPress={handleExportPdf}/g, '')
  .replace(/\{READER_PDF_HINT\}/g, '');
assertEq(noButton !== readerSource, true, 'mutation probe B applied (the export control is stripped)');
assertEq(readerHasPrintPdfControl(noButton), false, '…and the control guard FAILS on it (a dead surface is caught)');

const typedName = deviceSource.replace(
  "const name = scorePdfFileName({\n    title: input.title,\n    keyLabel: input.keyLabel,\n    offset: input.offset,\n  });",
  "const name = `${input.title}.pdf`;",
);
assertEq(typedName !== deviceSource, true, 'mutation probe C applied (the file name is typed instead of built)');
assertEq(pdfIsValidatedAndShared(typedName), false, '…and the naming guard FAILS on it');

const renamedFooter = serviceSource.replace(/export function scorePdfFileName\(/, 'export function scorePdfFileNameBroken(');
assertEq(renamedFooter !== serviceSource, true, 'mutation probe D applied (the file-name builder is renamed away)');
assertEq(pdfFileNameIsHonest(renamedFooter), false, '…and the file-name guard FAILS on it');

const cappedService = serviceSource.replace(
  'const systems = layOutSystems(parsed.measures',
  'const systems = layOutSystems(parsed.measures.slice(0, 2)',
);
assertEq(cappedService !== serviceSource, true, 'mutation probe E applied (the builder caps the systems it prints)');
assertEq(scorePdfBuilderHasNoBarCap(cappedService), false, '…and the no-cap guard FAILS on it');

const claimed = serviceSource.replace(
  "export const SCORE_PDF_FOOTER =",
  "export const SCORE_PDF_CLAIM = 'Official edition - publisher';\nexport const SCORE_PDF_FOOTER =",
);
assertEq(claimed !== serviceSource, true, 'mutation probe F applied (an edition claim enters the copy)');
assertEq(pdfCopyMakesNoEditionClaim(claimed), false, '…and the no-claim guard FAILS on it');

const unverified = deviceSource.replace(/takePdfReadBackProblem\(/g, 'noopCheck(');
assertEq(unverified !== deviceSource, true, 'mutation probe G applied (the read-back proof is removed)');
assertEq(pdfIsValidatedAndShared(unverified), false, '…and the proof guard FAILS on it');

// ─── Totals ─────────────────────────────────────────────────────

console.log(`\nSCORE-PDF SUITE: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
