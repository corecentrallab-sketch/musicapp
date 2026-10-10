/**
 * v37TakeExport.test.ts — THE PURE HALVES OF v37 ITEMS 7 + 8.
 *
 * ITEM 7 (backlog baa39e66, Send-to / export): the corrected take as a PDF, built
 * by NoteSnap's own notation model (services/takeNotationPdf.ts) and parsed back
 * before it is ever handed to the user; the destinations and the honest sentences
 * around them (services/takeSendTo.ts).
 *
 * ITEM 8 (backlog ee3a6e13, Tabs): the same take laid out as guitar tablature in
 * standard tuning (services/guitarTab.ts) — including what happens to a note the
 * guitar cannot reach at any fret (whole-octave folding, counted and said out
 * loud) and to a take that does not fit one hand position (the position covering
 * the most notes wins; the rest are marked).
 *
 * These suites are pure: no react-native, no fs, no network. The live-source side
 * of both items lives in scripts/v37UiWiring.test.ts (the guards in
 * src/services/v37UiContract.ts), and the on-disk mutation probes are recorded in
 * /home/team/shared/v37c-mutation-probes.txt.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  NOTES_PER_SYSTEM,
  PDF_PAGE_HEIGHT,
  PDF_PAGE_WIDTH,
  STAFF_BOTTOM_STEP,
  TAKE_PDF_CAPTION,
  TAKE_PDF_LEGEND,
  TAKE_PDF_SOURCE_LABEL,
  buildTakeNotationPdf,
  contentBounds,
  diatonicStep,
  exportedTakePdfMessage,
  parseTakePdfStructure,
  pdfText,
  placedNotesFor,
  staffSpellingFor,
  staffYForStep,
  takePdfFileName,
  validateTakePdf,
} from '../src/services/takeNotationPdf';
import { staffKeySignature } from '../src/services/takeStaff';
import { takeToAbc } from '../src/services/takeStaff';
import {
  HAND_SPAN,
  MAX_TAB_FRET,
  MAX_TAB_POSITION,
  STANDARD_TUNING,
  STANDARD_TUNING_LABELS,
  TAB_EMPTY_LINE,
  TAB_HONEST_LINE,
  TAB_LABEL,
  TAB_TUNING_LINE,
  buildGuitarTab,
  bestTakePosition,
  midiNoteName,
  positionLabel,
  tabCandidates,
  tabCell,
  tabEmptyCell,
  tabForMidi,
  tabHasNotes,
  tabHonestyLine,
  tabLines,
  tabNoteReadout,
  tabPitchSummary,
} from '../src/services/guitarTab';
import {
  SEND_TO_ACTIONS,
  SEND_TO_CTA,
  SEND_TO_EMAIL_LABEL,
  SEND_TO_HONESTY,
  midiName,
  sendToActions,
  sendToOutcomeMessage,
  sendToPlan,
  takeHasSomethingToSend,
  takeKeyLabel,
  takeSummaryText,
} from '../src/services/takeSendTo';
import { MIDI_EXPORT_LABEL, type SavedCaptureTake } from '../src/services/midiExport';

declare const process: { cwd(): string; exit(code: number): never };

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

/** A real take, as the capture window derives one (notes + tempo + key). */
function takeWith(
  notes: Array<{ midi: number; startSec: number; durationSec: number }>,
): SavedCaptureTake {
  return {
    notes,
    tempoBpm: 120,
    durationSec: notes.length > 0 ? notes[notes.length - 1].startSec + 1 : 0,
    key: { tonic: 0, mode: 'major', confidence: 0.9 } as SavedCaptureTake['key'],
    capturedAt: '2026-10-09T12:00:00.000Z',
  };
}

const SAMPLE = takeWith([
  { midi: 67, startSec: 0, durationSec: 0.5 },
  { midi: 69, startSec: 0.5, durationSec: 0.5 },
  { midi: 71, startSec: 1, durationSec: 1 },
  { midi: 72, startSec: 2, durationSec: 0.5 },
  { midi: 60, startSec: 2.5, durationSec: 0.25 },
  { midi: 62, startSec: 2.75, durationSec: 0.25 },
  { midi: 64, startSec: 3, durationSec: 2 },
]);

/** Decode/write helpers: the PDF is a single-byte file, so byte edits keep length. */
function pdfTextOf(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] & 0xff);
  return out;
}
function mutatePdf(
  bytes: Uint8Array,
  find: string,
  replace: string,
): Uint8Array | null {
  const text = pdfTextOf(bytes);
  const at = text.indexOf(find);
  if (at < 0 || find.length !== replace.length) return null;
  const next = text.slice(0, at) + replace + text.slice(at + find.length);
  const out = new Uint8Array(next.length);
  for (let i = 0; i < next.length; i += 1) out[i] = next.charCodeAt(i) & 0xff;
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// ITEM 7a — THE TAKE AS A PDF
// ═════════════════════════════════════════════════════════════════════════════
console.log('\nv37 item 7a — the PDF is a real, self-validating file');
const pdf = buildTakeNotationPdf(SAMPLE, { title: 'My hummed tune' });
assert(pdf !== null, 'a take with notes produces bytes');
const bytes = pdf as Uint8Array;
const verdict = validateTakePdf(bytes);
assertEq(verdict.ok, true, `the bytes pass their own structure check (${verdict.errors.join('; ')})`);
assertEq(verdict.report.version, '1.4', 'the file declares PDF 1.4');
assertEq(verdict.report.pageCount, 1, 'a seven-note take is one page');
assertEq(verdict.report.declaredPageCount, verdict.report.pageCount, '/Count agrees with the page objects');
assertEq(verdict.report.objectCount, verdict.report.xrefEntries - 1, 'every cross-reference entry points at a real object');
assert(verdict.report.streamBytes > 0, `the page really carries a content stream (${verdict.report.streamBytes} bytes drawn)`);
assertEq(verdict.report.totalBytes, bytes.length, 'the report accounts for the whole file');

const pdfText_LATIN = pdfTextOf(bytes);
assert(pdfText_LATIN.startsWith('%PDF-1.4'), 'the file starts with the PDF header');
assert(pdfText_LATIN.trimEnd().endsWith('%%EOF'), 'the file ends with %%EOF');
assert(
  pdfText_LATIN.indexOf(pdfText(TAKE_PDF_CAPTION)) >= 0,
  'the page carries the honest caption',
);
assert(pdfText_LATIN.indexOf('My hummed tune') >= 0, 'the page carries the take title');
assert(pdfText_LATIN.indexOf('key C major') >= 0, 'the header names the take’s own key');
assert(pdfText_LATIN.indexOf('120 bpm') >= 0, 'the header names the measured tempo');
assert(pdfText_LATIN.indexOf('7 notes') >= 0, 'the header names the note count');

// The page never claims to be an edition, and says how it was drawn.
assert(TAKE_PDF_CAPTION.indexOf('not a published edition') >= 0, `the caption is honest: "${TAKE_PDF_CAPTION}"`);
assert(TAKE_PDF_LEGEND.indexOf('Treble clef') >= 0, `the legend names the clef: "${TAKE_PDF_LEGEND}"`);
assert(TAKE_PDF_SOURCE_LABEL.indexOf('ABC') >= 0, 'the source block says it is the ABC the screen draws');

// The ABC block IS the on-screen notation source, byte for byte.
const onScreenAbc = takeToAbc(SAMPLE.notes as never, {
  signature: staffKeySignature(SAMPLE.key),
  eighthSec: 30 / 120,
  title: 'My hummed tune',
  suffix: 'your take',
});
const abcBody = onScreenAbc.split('\n')[0];
assert(pdfText_LATIN.indexOf(`(${abcBody}) Tj`) >= 0, `the printed source starts with the same ABC header the screen draws (${abcBody})`);

// Nothing is drawn off the paper.
/** The content streams, read back out of the file (each is `>>\nstream\n…endstream`). */
function streamsOf(text: string): string[] {
  return text
    .split('>>\nstream\n')
    .slice(1)
    .map((part) => part.split('\nendstream')[0]);
}
const streams = streamsOf(pdfText_LATIN);
assertEq(streams.length, 1, 'the single page has its own stream');
const bounds = contentBounds(streams[0]);
assertEq(bounds.outside, 0, `every point of the drawing is on the page (${bounds.points} points)`);
assert(bounds.minX >= 0 && bounds.maxX <= PDF_PAGE_WIDTH, `x stays inside the page box (${bounds.minX}…${bounds.maxX})`);
assert(bounds.minY >= 0 && bounds.maxY <= PDF_PAGE_HEIGHT, `y stays inside the page box (${bounds.minY}…${bounds.maxY})`);

console.log('\nv37 item 7a — the layout is the existing notation model');
assertEq(diatonicStep('E', 4), STAFF_BOTTOM_STEP, 'E4 is the staff’s bottom line (step 30)');
assertEq(diatonicStep('C', 4), 28, 'C4 is one step below it (its own ledger line)');
assertEq(diatonicStep('F', 5), 38, 'F5 is the staff’s top line');
assertEq(staffYForStep(STAFF_BOTTOM_STEP, 640), 640, 'the bottom line is where the system says it is');
assertEq(staffYForStep(38, 640), 672, 'four steps up is four line-gaps up (the top line)');
assertEq(staffYForStep(28, 640), 632, 'a note below the staff is drawn below it, not clamped');
assertEq(staffYForStep(40, 640), 680, 'A5 sits one octave above the bottom line (the top line is 672)');

const cMajor = staffKeySignature({ tonic: 0, mode: 'major' });
const dMajor = staffKeySignature({ tonic: 2, mode: 'major' });
assertEq(dMajor.sharps, 2, 'D major carries two sharps (the shared key model)');
const fSharpInD = staffSpellingFor(66, dMajor);
assertEq(fSharpInD.letter, 'F', 'F#4 in D major is spelled as an F');
assertEq(fSharpInD.alter, 1, '…and it needs a sharp');
assertEq(dMajor.accidentals.F, 1, '…which the signature already covers');
const fNaturalInD = staffSpellingFor(65, dMajor);
assertEq(fNaturalInD.alter, 0, 'F natural in D major needs the signature cancelled');
const placed = placedNotesFor(SAMPLE.notes as never, dMajor, 0.25);
assertEq(placed[0].marked, false, 'a note the signature already spells is drawn WITHOUT a redundant mark');
const sharpTake = takeWith([{ midi: 66, startSec: 0, durationSec: 0.5 }]);
const fSharpPlacedInC = placedNotesFor(sharpTake.notes as never, cMajor, 0.25);
assertEq(fSharpPlacedInC[0].letter, 'F', 'F#4 in C major is still spelled as an F');
assertEq(fSharpPlacedInC[0].marked, true, '…and it is drawn WITH its own sharp (the signature does not cover it)');
const fSharpPlacedInD = placedNotesFor(sharpTake.notes as never, dMajor, 0.25);
assertEq(fSharpPlacedInD[0].marked, false, 'the same note in D major needs no mark — the signature already carries it');
assertEq(placed[0].units, 2, 'the duration grid is the staff’s eighth grid (0.5s at 120bpm = 2 eighths)');
assertEq(placed[0].letter, 'G', 'the letters come from the same spelling rule the screen uses');

console.log('\nv37 item 7a — the PDF parser BITES on a damaged file');
const truncated = bytes.slice(0, Math.floor(bytes.length * 0.8));
assertEq(validateTakePdf(truncated).ok, false, 'a truncated file is refused');
const headless = mutatePdf(bytes, '%PDF-1.4', 'XPDF-1.4');
assert(headless !== null, 'the header mutation applied');
assertEq(validateTakePdf(headless).ok, false, 'a file whose header is not %PDF- is refused');
assertEq(validateTakePdf(new Uint8Array(10)).ok, false, 'a token amount of bytes is not a PDF');
assertEq(validateTakePdf(null).ok, false, 'nothing is not a PDF');

const badCount = mutatePdf(bytes, '/Count 1', '/Count 2');
assert(badCount !== null, 'the /Count mutation applied');
assertEq(validateTakePdf(badCount).ok, false, '/Count that disagrees with the page objects is refused');
assert(
  validateTakePdf(badCount).errors.some((error) => error.indexOf('/Count') >= 0),
  '…and the report says which invariant broke',
);
const badStream = (() => {
  const declared = /<< \/Length (\d+) >>\nstream\n/.exec(pdfText_LATIN);
  if (!declared) return null;
  return mutatePdf(
    bytes,
    `<< /Length ${declared[1]} >>`,
    `<< /Length ${Number(declared[1]) + 10} >>`,
  );
})();
assert(badStream !== null, 'the stream-length mutation applied (the declared /Length changed)');
const badStreamVerdict = validateTakePdf(badStream as Uint8Array);
assertEq(badStreamVerdict.ok, false, 'a content stream whose declared length is wrong is refused');
assert(
  badStreamVerdict.errors.some((error) => error.indexOf('declares') >= 0),
  `…with the byte counts in the message (${badStreamVerdict.errors.join('; ')})`,
);
const noEof = mutatePdf(bytes, '%%EOF', '%%EOX');
assert(noEof !== null, 'the %%EOF mutation applied');
assertEq(validateTakePdf(noEof).ok, false, 'a file with no %%EOF is refused');
// A single flipped digit in a cross-reference offset: the table must be read back.
const xrefAt = pdfText_LATIN.lastIndexOf('\nxref\n') + 6;
const offsetEntry = pdfText_LATIN.slice(xrefAt, xrefAt + 20);
const firstOffsetDigit = Number.parseInt(offsetEntry[0], 10);
const flippedOffset = mutatePdf(
  bytes,
  offsetEntry,
  `${String((firstOffsetDigit + 1) % 10)}${offsetEntry.slice(1)}`,
);
assert(flippedOffset !== null, 'the cross-reference-offset mutation applied');
assertEq(
  validateTakePdf(flippedOffset as Uint8Array).ok,
  false,
  'an xref offset that does not point at its object is refused',
);

console.log('\nv37 item 7a — nothing to draw is never dressed up');
assertEq(buildTakeNotationPdf(null), null, 'no take, no PDF');
assertEq(buildTakeNotationPdf(takeWith([])), null, 'an empty take has no staff to print (never a blank page)');
assertEq(
  buildTakeNotationPdf({ ...SAMPLE, notes: [{ midi: NaN, startSec: 0, durationSec: 1 }] } as never),
  null,
  'a take whose notes are not pitches produces no file',
);
assertEq(takePdfFileName('My hummed tune'), 'My hummed tune.pdf', 'the file name is the take title');
assertEq(takePdfFileName('../etc/passwd'), '..etcpasswd.pdf', 'the file name can never be a path');
assertEq(takePdfFileName(''), 'notesnap-take.pdf', 'an untitled take still gets a file name');
assert(exportedTakePdfMessage(SAMPLE).indexOf('7 notes') >= 0, 'the success sentence counts the notes it wrote');
assert(exportedTakePdfMessage(SAMPLE).indexOf('share sheet') >= 0, 'the success sentence names the share sheet');

console.log('\nv37 item 7a — the text layer is single-byte safe');
assertEq(pdfText('plain'), 'plain', 'plain ASCII passes through');
assertEq(pdfText('a (b) c'), 'a \\(b\\) c', 'parentheses are escaped for the PDF string layer');
assertEq(pdfText('back\\slash'), 'back\\\\slash', 'backslashes are escaped');
assertEq(pdfText('curly ’ quote — dash'), "curly ' quote - dash", 'typographic characters are mapped, never emitted raw');
assertEq(pdfText('emoji 🎵'), 'emoji ?', 'a character with no single-byte form becomes ? rather than corrupting the file');
const unicodeTitle = buildTakeNotationPdf(SAMPLE, { title: 'Étude — “no. 1” 🎵' });
assert(unicodeTitle !== null, 'a title full of typography still builds');
assertEq(validateTakePdf(unicodeTitle).ok, true, '…and still parses (the declared stream length is its byte length)');

console.log('\nv37 item 7a — a long take spills onto more pages, still valid');
const longNotes = [];
for (let i = 0; i < NOTES_PER_SYSTEM * 8 + 3; i += 1) {
  longNotes.push({ midi: 60 + (i % 12), startSec: i * 0.5, durationSec: 0.5 });
}
const longPdf = buildTakeNotationPdf(takeWith(longNotes), { title: 'Long take' }) as Uint8Array;
const longVerdict = validateTakePdf(longPdf);
assertEq(longVerdict.ok, true, `a ${longNotes.length}-note take still parses (${longVerdict.errors.join('; ')})`);
assert(longVerdict.report.pageCount >= 2, `it really spills over (${longVerdict.report.pageCount} pages)`);
assertEq(
  longVerdict.report.pageCount,
  longVerdict.report.declaredPageCount,
  'every page is counted in the page tree',
);
const longStreams = streamsOf(pdfTextOf(longPdf));
assertEq(longStreams.length, longVerdict.report.pageCount, 'one content stream per page');
for (let i = 0; i < longStreams.length; i += 1) {
  const streamBounds = contentBounds(longStreams[i]);
  assertEq(streamBounds.outside, 0, `page ${i + 1}: nothing is drawn off the paper`);
}
const boundsLong = contentBounds(longStreams[longStreams.length - 1]);
assert(boundsLong.points > 40, 'the last page really carries the tail of the take');

console.log('\nv37 item 7a — chords are printed above the staff');
const withChords = buildTakeNotationPdf(SAMPLE, {
  title: 'Chords',
  chords: [{ index: 0, name: 'C' }, { index: 3, name: 'Fmaj7' }],
}) as Uint8Array;
assertEq(validateTakePdf(withChords).ok, true, 'a take with chords still parses');
const chordText = pdfTextOf(withChords);
assert(chordText.indexOf('(C) Tj') >= 0, 'the first chord symbol is drawn');
assert(chordText.indexOf('(Fmaj7) Tj') >= 0, 'the seven-chord name is drawn too');

// ═════════════════════════════════════════════════════════════════════════════
// ITEM 8 — THE TAKE AS GUITAR TAB
// ═════════════════════════════════════════════════════════════════════════════
console.log('\nv37 item 8 — standard tuning and the string/fret mapping');
assertEq(STANDARD_TUNING.join(','), '64,59,55,50,45,40', 'the tuning is EADGBE (high E first)');
assertEq(STANDARD_TUNING_LABELS.join(' '), 'e B G D A E', 'the labels are the six strings a tab prints');
assertEq(MAX_TAB_FRET, 12, 'the renderer never asks for a fret past the 12th');
assertEq(HAND_SPAN, 4, 'a hand position spans four frets');
assertEq(MAX_TAB_POSITION, 9, 'the last position whose span stays under the 12th fret');
assertEq(TAB_LABEL, 'Tabs', 'the button says exactly what the owner asked for');
assertEq(midiNoteName(60), 'C4', '60 is middle C');
assertEq(midiNoteName(69), 'A4', '69 is the A the tuner shows');

assertEq(tabCandidates(64).length, 3, 'E4 is reachable on three strings (open high E, B string 5th, G string 9th)');
assertEq(tabCandidates(64)[0].string, 1, '…and the winner is the thinnest one');
assertEq(tabCandidates(64)[0].fret, 0, '…open (the lowest fret always wins)');
assertEq(tabCandidates(40)[0].string, 6, 'E2 is the low E string open');
assertEq(tabCandidates(60)[0].fret, 1, 'middle C prefers the LOWEST fret (string 2, fret 1)');
assertEq(tabCandidates(60)[0].string, 2, '…which is the B string');
assertEq(tabCandidates(84).length, 0, 'C6 is off the fretboard as written (nothing within twelve frets)');
assertEq(tabCandidates(20).length, 0, 'a pitch below the low E is off the fretboard too');

console.log('\nv37 item 8 — every pitch in the MIDI range lands on the neck');
let unmapped = 0;
let outOfRange = 0;
for (let midi = 0; midi <= 127; midi += 1) {
  const placedNote = tabForMidi(midi);
  if (!placedNote) unmapped += 1;
  else if (placedNote.fret < 0 || placedNote.fret > MAX_TAB_FRET) outOfRange += 1;
}
assertEq(unmapped, 0, 'all 128 pitches map to a string and fret (nothing is dropped)');
assertEq(outOfRange, 0, 'every mapped fret is between open and the 12th');
assertEq(tabForMidi(NaN), null, 'a note that is not a pitch maps to nothing, not to fret 0');

const high = tabForMidi(84);
assert(high !== null, 'C6 maps');
assertEq((high as { string: number }).string, 1, 'it is played on the high E string');
assertEq((high as { fret: number }).fret, 8, '…at the 8th fret');
assertEq((high as { foldedOctaves: number }).foldedOctaves, -1, '…one octave DOWN, and it says so');
assertEq((high as { playedMidi: number }).playedMidi, 72, 'the written pitch is C5, not C6');
const low = tabForMidi(28);
assert(low !== null, 'E1 maps');
assertEq((low as { foldedOctaves: number }).foldedOctaves, 1, '…one octave UP, and it says so');
assertEq((low as { playedMidi: number }).playedMidi, 40, 'the written pitch is the low E string');

console.log('\nv37 item 8 — one hand position for the take, deterministic');
const firstPosition = takeWith([
  { midi: 64, startSec: 0, durationSec: 0.5 },
  { midi: 62, startSec: 0.5, durationSec: 0.5 },
  { midi: 60, startSec: 1, durationSec: 0.5 },
]);
assertEq(bestTakePosition(firstPosition.notes), 0, 'a first-position take is played in the open position');
const highTake = takeWith([
  { midi: 72, startSec: 0, durationSec: 0.5 },
  { midi: 74, startSec: 0.5, durationSec: 0.5 },
  { midi: 76, startSec: 1, durationSec: 0.5 },
]);
assertEq(
  bestTakePosition(highTake.notes),
  7,
  'a take at frets 8/10/12 is played in the 7th position (the lowest position covering the most notes: 8 and 10)',
);
assertEq(bestTakePosition([]), null, 'no notes, no position');
assertEq(positionLabel(0), 'open position', 'position 0 is the open position');
assertEq(positionLabel(1), '1st position', '1st, not 1th');
assertEq(positionLabel(2), '2nd position', '2nd');
assertEq(positionLabel(3), '3rd position', '3rd');
assertEq(positionLabel(4), '4th position', '4th');
assertEq(positionLabel(11), '11th position', 'the teens keep the th');
assertEq(positionLabel(null), 'no position', 'no position is said, not guessed');

const layout = buildGuitarTab(firstPosition.notes);
assertEq(layout.position, 0, 'the layout carries the position it chose');
assertEq(layout.outsidePositionCount, 0, 'every note of a first-position take is under the hand');
assertEq(layout.foldedCount, 0, '…and none needed folding');
assert(
  tabHonestyLine(layout).indexOf('exactly as you played it') >= 0,
  `a clean layout says so: "${tabHonestyLine(layout)}"`,
);
assertEq(layout.lowestFret, 0, 'the lowest fret is reported');
assertEq(layout.highestFret, 3, 'the highest fret is reported');

const spread = buildGuitarTab(SAMPLE.notes);
assert(spread.position !== null, 'a spread take still gets one position');
assert(spread.outsidePositionCount > 0, 'notes outside that position are COUNTED, never hidden');
assert(
  tabHonestyLine(spread).indexOf('outside that position') >= 0,
  '…and the page says how many and what to do',
);
assert(spread.notes.every((note) => note.fret >= 0 && note.fret <= MAX_TAB_FRET), 'every written fret is playable');
assert(
  spread.notes.every((note) => note.string >= 1 && note.string <= 6),
  'every note is on one of the six strings',
);
assert(
  spread.notes.every((note) => note.midi === note.playedMidi || note.foldedOctaves !== 0),
  'a note only differs from its pitch when it was folded by octaves',
);
assert(
  spread.notes.every((note) => note.noteName === midiNoteName(note.playedMidi)),
  'the printed note name is the name of the pitch actually written',
);

const folded = buildGuitarTab(takeWith([
  { midi: 84, startSec: 0, durationSec: 0.5 },
  { midi: 86, startSec: 0.5, durationSec: 0.5 },
]).notes);
assertEq(folded.foldedCount, 2, 'both out-of-range notes are counted as folded');
assert(
  tabHonestyLine(folded).indexOf('moved by whole octaves') >= 0,
  `the page says the notes moved: "${tabHonestyLine(folded)}"`,
);
assert(
  tabHonestyLine(buildGuitarTab(takeWith([{ midi: 84, startSec: 0, durationSec: 1 }]).notes)).indexOf(
    '1 note was moved',
  ) >= 0,
  'a single folded note is said in the singular',
);

console.log('\nv37 item 8 — the printed grid');
const lines = tabLines(layout);
assertEq(lines.length, 6, 'a tab has six string lines');
assertEq(lines[0].indexOf('e|'), 0, 'the top line is the thinnest string');
assertEq(lines[5].indexOf('E|'), 0, 'the bottom line is the low E');
const lengths = lines.map((line) => line.length);
assertEq(new Set(lengths).size, 1, `all six lines are exactly the same width (${lengths[0]}) — the grid stays in register`);
assert(
  lines[0].indexOf(tabCell(layout.notes[0])) >= 0,
  'the first note is drawn on the string it is played on',
);
assertEq(
  lines.filter((line) => line.indexOf(tabCell(layout.notes[0])) >= 0).length,
  1,
  '…and on exactly one string (a note is never drawn twice)',
);
assertEq(tabEmptyCell().length, tabCell(layout.notes[0]).length, 'an empty cell is the same width as a note cell');
assertEq(tabCell({ ...spread.notes[0], fret: 12, outsidePosition: false }).length, 4, 'the cell width does not change at fret 12');
assertEq(tabCell({ ...layout.notes[0], fret: 0, outsidePosition: false }), '--0-', 'fret 0 prints as an open string');
assertEq(tabCell({ ...layout.notes[0], fret: 5, outsidePosition: true }), '+-5-', 'an off-position note is flagged in its own cell');

const wideNotes = Array.from({ length: 9 }, (_, i) => ({
  midi: 60 + i,
  startSec: i * 0.5,
  durationSec: 0.5,
}));
const wide = buildGuitarTab(wideNotes);
const wideLines = tabLines(wide);
assertEq(new Set(wideLines.map((line) => line.length)).size, 1, 'a longer take keeps all lines in register');
assert(wideLines[0].split('|').length >= 3, 'bar marks break the grid up as it grows');
assertEq(
  tabLines(buildGuitarTab(wideNotes)).join('\n'),
  wideLines.join('\n'),
  'the same take always renders the same tab (deterministic, no randomness)',
);

console.log('\nv37 item 8 — the honesty lines and the empty state');
assert(TAB_HONEST_LINE.indexOf('Auto-generated') >= 0, 'the tab says it is auto-generated');
assert(TAB_HONEST_LINE.indexOf('your own take') >= 0, '…and that it is the user’s own take');
assert(TAB_HONEST_LINE.indexOf('not an official guitar edition') >= 0, '…and that it is not an official edition');
assertEq(TAB_HONEST_LINE.indexOf('transcription'), -1, 'it never claims to be a transcription of anything');
assert(TAB_TUNING_LINE.indexOf('EADGBE') >= 0 || TAB_TUNING_LINE.indexOf('e B G D A E') >= 0, `the tuning is named: "${TAB_TUNING_LINE}"`);
const nothing = buildGuitarTab([]);
assertEq(tabHasNotes(nothing), false, 'an empty take has no tab');
assertEq(tabHasNotes(null), false, 'no layout has no tab');
assertEq(tabHasNotes(layout), true, 'a real take has a tab');
assertEq(tabLines(nothing).length, 6, 'an empty take still prints a six-line grid, not a broken one');
assertEq(tabHonestyLine(nothing), TAB_EMPTY_LINE, 'an empty take says why there is no tab');
assertEq(tabNoteReadout(nothing), '', 'an empty take has no readout to invent');
assert(tabNoteReadout(layout).indexOf('string 2, fret 1') >= 0, `the readout names string and fret: "${tabNoteReadout(layout)}"`);
assertEq(
  tabPitchSummary(layout),
  layout.notes.map((note) => note.noteName).join(' · '),
  `the pitch summary lists the written pitches in order (${tabPitchSummary(layout)})`,
);
assert(tabPitchSummary(layout).split(' · ').length === layout.notes.length, 'one pitch per note, in take order');

// ═════════════════════════════════════════════════════════════════════════════
// ITEM 7b — THE SEND-TO MODEL
// ═════════════════════════════════════════════════════════════════════════════
console.log('\nv37 item 7b — the Send-to destinations');
assertEq(SEND_TO_CTA, 'Send to…', 'the action reads as the owner asked');
assertEq(takeHasSomethingToSend(null), false, 'no take, nothing to send');
assertEq(takeHasSomethingToSend(undefined), false, 'an undefined take has nothing to send');
assertEq(takeHasSomethingToSend({ ...SAMPLE, notes: [] } as never), false, 'an empty take has nothing to send');
assertEq(
  takeHasSomethingToSend({ ...SAMPLE, notes: [{ midi: NaN, startSec: 0, durationSec: 1 }] } as never),
  false,
  'notes that are not pitches are not something to send',
);
assertEq(takeHasSomethingToSend(SAMPLE), true, 'a real take can be sent');
assertEq(sendToActions(null).length, 0, 'an empty take is offered NO destination (no dead buttons)');
assertEq(sendToActions(SAMPLE).length, 3, 'a real take is offered three destinations');
assertEq(
  sendToActions(SAMPLE).map((action) => action.kind).join(','),
  'pdf,midi,email',
  'the destinations are the PDF, the MIDI file and email',
);
assertEq(sendToActions(SAMPLE)[0].label, SEND_TO_ACTIONS[0].label, 'the PDF destination is labelled from the PDF model');
assertEq(sendToActions(SAMPLE)[1].label, MIDI_EXPORT_LABEL, 'the MIDI destination is labelled from the MIDI model (one label, one path)');
assertEq(sendToActions(SAMPLE)[2].label, SEND_TO_EMAIL_LABEL, 'the email destination is labelled from the model');
assertEq(SEND_TO_HONESTY.indexOf('nothing is emailed from our side') >= 0, true, `the surface says who sends: "${SEND_TO_HONESTY}"`);

console.log('\nv37 item 7b — file, text, or nothing');
assertEq(sendToPlan({ hasTake: false, shareSheetAvailable: true }).mode, 'none', 'no take → no route at all');
assertEq(sendToPlan({ hasTake: true, shareSheetAvailable: true }).mode, 'file', 'a share sheet that takes files gets the file');
assertEq(sendToPlan({ hasTake: true, shareSheetAvailable: false }).mode, 'text', 'a platform that cannot attach gets the plain summary');
assert(sendToPlan({ hasTake: true, shareSheetAvailable: false }).reason.indexOf('share') >= 0, '…and the reason says so');
assert(
  sendToPlan({ hasTake: true, shareSheetAvailable: false }).reason.indexOf('attach files') >= 0,
  '…in plain words a user can act on',
);

console.log('\nv37 item 7b — the summary text and the outcome sentences');
const summary = takeSummaryText(SAMPLE, { title: 'My hummed tune' });
assert(summary.indexOf('My hummed tune') >= 0, 'the summary carries the title');
assert(summary.indexOf('7 notes') >= 0, 'the summary carries the note count');
assert(summary.indexOf('key C major') >= 0, 'the summary carries the detected key');
assert(summary.indexOf('120 bpm') >= 0, 'the summary carries the tempo');
assert(summary.indexOf('G4, A4, B4, C5, C4, D4, E4') >= 0, 'the summary lists the notes in order');
assert(summary.indexOf('not a published score') >= 0, 'the summary is honest about what it is');
assert(takeSummaryText(SAMPLE, { title: 'x', maxNotes: 3 }).indexOf('4 more') >= 0, 'a long take is truncated with the count of the rest');
assertEq(midiName(60), 'C4', 'the summary spells pitches the same way the tab does');
assertEq(midiName(69), 'A4', 'A4 = 69 here too');
assertEq(takeKeyLabel(SAMPLE), 'C major', 'the key reads as a musician says it');
assertEq(takeKeyLabel(null), null, 'a take with no key has no key label (never a guessed one)');
assertEq(takeKeyLabel({ ...SAMPLE, key: null } as never), null, 'a null key stays null');
assertEq(takeKeyLabel({ ...SAMPLE, key: { tonic: 2, mode: 'minor' } } as never), 'D minor', 'a minor key reads as minor');

assert(sendToOutcomeMessage('shared', 'pdf').indexOf('share sheet') >= 0, 'a shared file says the share sheet opened');
assert(sendToOutcomeMessage('shared', 'midi').indexOf('MIDI') >= 0, 'the MIDI outcome names the MIDI file');
assert(sendToOutcomeMessage('dismissed', 'pdf').indexOf('nothing was sent') >= 0, 'leaving the share sheet unsent is said out loud');
assert(sendToOutcomeMessage('unavailable', 'email').indexOf('no share sheet') >= 0, 'a platform without a share sheet is said plainly');
assert(sendToOutcomeMessage('failed', 'pdf').indexOf('try again') >= 0, 'a failure offers the next step');
for (const kind of ['pdf', 'midi', 'email'] as const) {
  for (const status of ['shared', 'dismissed', 'unavailable', 'failed'] as const) {
    const line = sendToOutcomeMessage(status, kind);
    assert(line.length > 10 && line.indexOf('!') < 0, `the ${status}/${kind} outcome is a real sentence with no urgency punctuation`);
  }
}

// ── the suites are not vacuous ──────────────────────────────────
console.log('\nv37 items 7–8 — the pure suites are not vacuous');
assertEq(buildTakeNotationPdf(takeWith([])), null, 'an empty take never produces a PDF');
assertEq(tabHasNotes(buildGuitarTab([])), false, 'an empty take never produces a tab');
assertEq(sendToActions(null).length, 0, 'an empty take is never offered a destination');

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
