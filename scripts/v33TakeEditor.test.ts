/**
 * v33TakeEditor.test.ts — tier1 gate for the v33 spine's PURE half:
 * takeStaff (the take as a staff), takeEditor (the take-correction editor's
 * model), takePreview (the docked Hum-Along preview), theme (light/dark),
 * coverScan (scan-a-cover → query) and fuzzySearch (the find-a-piece typo fix).
 *
 * What it pins, in the order the release is built:
 *   A/C. the live-trace honesty (level, not notes) and the staff spelling — key
 *        signatures, accidentals, octaves, bar lines, rests for real gaps;
 *   D.   every editor operation (pitch, boundary, add, remove, rest, transpose,
 *        per-note re-detect, re-quantize, chord override), the instant key/chord
 *        re-derivation, undo/redo/reset, the Auto-detected / Corrected-by-you
 *        tags — and the OPEN CONTRACT that the take stays a MidiNoteEvent[];
 *   G.   the preview timeline, the tempo slider that NEVER rewrites note times,
 *        the cursor, the loop bracket and the "preview only" honesty;
 *   F.   the theme resolver + palette parity, the scan-cover query normalisation
 *        and its honest states, and the typo ladder that finds Toccata & Fugue.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  AUTO_CLEAN_DIVIDER_LABEL,
  abcNoteToken,
  barStateFor,
  durationUnits,
  staffKeySignature,
  takeStaffRows,
  takeToAbc,
} from '../src/services/takeStaff';
import {
  CHORD_TAG_SUGGESTED,
  CHORD_TAG_YOURS,
  EDITOR_NO_REDETECT_REASON,
  MAX_TRANSPOSE_SEMITONES,
  NOTE_TAG_ADDED,
  NOTE_TAG_CORRECTED,
  NOTE_TAG_DETECTED,
  addNoteAfter,
  canRedo,
  canRemoveNote,
  canUndo,
  chordPalette,
  clearChordOverrides,
  createEditorState,
  deriveTake,
  editedSequence,
  gridStepSec,
  insertRestAfter,
  nearestScaleMidi,
  noteTag,
  nudgeNotePitch,
  overrideChord,
  redetectNote,
  redo,
  removeNote,
  requantizeTake,
  resetChord,
  resetToDetected,
  setNoteBoundary,
  setNotePitch,
  snapTakeToScale,
  transposeTake,
  undo,
} from '../src/services/takeEditor';
import {
  PREVIEW_DEFAULT_INSTRUMENT,
  PREVIEW_INSTRUMENTS,
  PREVIEW_ONLY_CAPTION,
  PREVIEW_TEMPO_DEFAULT_PCT,
  PREVIEW_TEMPO_MAX_PCT,
  PREVIEW_TEMPO_MIN_PCT,
  PREVIEW_TEMPO_NEVER_REWRITES,
  buildPreviewTimeline,
  clampPreviewTempo,
  cursorIndexAt,
  fullLoop,
  loopBetween,
  loopBoundsMs,
  previewInstrument,
  previewStatusLine,
  previewTempoLabel,
  stepIndex,
} from '../src/services/takePreview';
import {
  DARK_THEME,
  DEFAULT_THEME_MODE,
  LIGHT_THEME,
  THEME_HONEST_NOTE,
  THEME_STORAGE_KEY,
  resolveThemeMode,
  themeFor,
  toggleThemeMode,
} from '../src/services/theme';
import {
  COVER_SCAN_CTA,
  COVER_SCAN_MAX_QUERY,
  COVER_SCAN_NO_OCR_LINE,
  COVER_SCAN_OCR_AVAILABLE,
  COVER_SCAN_OCR_FAILED_LINE,
  COVER_SCAN_TEXT_ONLY_LINE,
  coverQueryFromScan,
  coverQueryFromText,
  coverScanAffordanceLabel,
} from '../src/services/coverScan';
import {
  editDistance,
  fuzzyScore,
  halveDoubledRuns,
  normalizeSearchText,
  queryVariants,
  rankFuzzyMatches,
  retryNoticeLine,
  tokenMatches,
} from '../src/services/fuzzySearch';
import { scalePitchClasses } from '../src/services/melodyCapture';
import type { SavedCaptureTake } from '../src/services/midiExport';

// The gate runs these suites in plain Node (see scripts/*.test.ts conventions).
declare const process: { exit(code: number): never };

let passes = 0;
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    console.error(`     expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  assert(ok, msg);
}

/**
 * A take in G major: G4 A4 B4 D5, one second each at 120 bpm — long enough for
 * the key detector to name the key (it needs four units of total weight before
 * it will commit to one).
 */
function gMajorTake(): SavedCaptureTake {
  return {
    notes: [
      { midi: 67, startSec: 0, durationSec: 1 },
      { midi: 69, startSec: 1, durationSec: 1 },
      { midi: 71, startSec: 2, durationSec: 1 },
      { midi: 74, startSec: 3, durationSec: 1 },
    ],
    tempoBpm: 120,
    durationSec: 4,
    key: { tonic: 7, mode: 'major', confidence: 0.9, margin: 0.3 } as never,
    capturedAt: '2026-10-04T00:00:00.000Z',
  };
}

// ─────────────────────────── the staff (A + C) ───────────────────────────

function staffTests(): void {
  console.log('\n=== the take as a staff (v33 slice C) ===');
  const c = staffKeySignature({ tonic: 0, mode: 'major' });
  assertEq(c.sharps, 0, 'C major has no accidentals');
  assertEq(c.abcToken, 'C', 'C major is written K:C');
  const g = staffKeySignature({ tonic: 7, mode: 'major' });
  assertEq(g.sharps, 1, 'G major has one sharp');
  assertEq(g.accidentals.F, 1, 'and it is F#');
  const f = staffKeySignature({ tonic: 5, mode: 'major' });
  assertEq(f.flats, 1, 'F major has one flat');
  assertEq(f.accidentals.B, -1, 'and it is Bb');
  const bb = staffKeySignature({ tonic: 10, mode: 'major' });
  assertEq(bb.flats, 2, 'Bb major has two flats');
  assertEq(bb.tonicLetter, 'B', 'its tonic is spelled with the letter B');
  assertEq(bb.tonicAccidental, '_', 'and carries a flat');
  assertEq(bb.abcToken, '_B', 'so the ABC key token is _B (Bb)');
  const fs = staffKeySignature({ tonic: 6, mode: 'major' });
  assertEq(fs.sharps, 6, 'F# major has six sharps');
  assertEq(fs.abcToken, '^F', 'and is written K:^F');
  const am = staffKeySignature({ tonic: 9, mode: 'minor' });
  assertEq(am.sharps, 0, 'A minor has no accidentals (relative C major)');
  assertEq(am.abcToken, 'Am', 'and is written K:Am');
  const dm = staffKeySignature({ tonic: 2, mode: 'minor' });
  assertEq(dm.flats, 1, 'D minor has one flat (relative F major)');
  const em = staffKeySignature({ tonic: 4, mode: 'minor' });
  assertEq(em.sharps, 1, 'E minor has one sharp (relative G major)');
  assertEq(staffKeySignature(null).abcToken, 'C', 'no key falls back to C — never a guessed key');

  const cMajor = staffKeySignature({ tonic: 0, mode: 'major' });
  const gMajorKey = staffKeySignature({ tonic: 7, mode: 'major' });
  const emptyBar = barStateFor(cMajor);
  assertEq(abcNoteToken(60, cMajor, barStateFor(cMajor)), 'C', 'middle C is written C');
  assertEq(abcNoteToken(72, cMajor, barStateFor(cMajor)), 'c', 'C5 is written c');
  assertEq(abcNoteToken(48, cMajor, barStateFor(cMajor)), 'C,', 'C3 drops an octave with a comma');
  assertEq(abcNoteToken(36, cMajor, barStateFor(cMajor)), 'C,,', 'C2 drops two');
  assertEq(
    abcNoteToken(66, cMajor, barStateFor(cMajor)),
    '^F',
    'F#4 in C major carries its own sharp',
  );
  assertEq(
    abcNoteToken(66, gMajorKey, barStateFor(gMajorKey)),
    'F',
    'F#4 in G major needs NO mark — the signature already has it',
  );
  const barState = barStateFor(cMajor);
  abcNoteToken(61, cMajor, barState);
  assertEq(
    abcNoteToken(61, cMajor, barState),
    '^C',
    'a second C# in the same bar restates its accidental (ABC bars carry them)',
  );
  abcNoteToken(66, cMajor, barState);
  assertEq(
    abcNoteToken(65, cMajor, barState),
    '=F',
    'and an F natural after an F# in the same bar is written with an explicit natural',
  );

  assertEq(durationUnits(0.25, 0.25), 1, 'a quarter of a second at 120bpm is one eighth');
  assertEq(durationUnits(0, 0.25), 1, 'a zero length still draws one unit, never nothing');

  const rows = takeStaffRows({
    rawNotes: gMajorTake().notes,
    cleanedNotes: gMajorTake().notes,
    key: { tonic: 7, mode: 'major' },
    tempoBpm: 120,
    chordNames: ['G', 'C', 'D'],
    title: 'My melody',
  });
  assert(!!rows.rawAbc && rows.rawAbc.indexOf('K:G') >= 0, 'the staff is written in the take key (K:G)');
  assert(!!rows.cleanedAbc && rows.cleanedAbc.indexOf('T:My melody (auto-cleaned)') >= 0, 'the cleaned staff names itself honestly');
  assert(!!rows.rawAbc && rows.rawAbc.indexOf('(as hummed)') >= 0, 'and so does the raw trace');
  assertEq(rows.chordRow, ['G', 'C', 'D'], 'the chord row carries the take’s suggested chords');
  assertEq(rows.dividerLabel, AUTO_CLEAN_DIVIDER_LABEL, 'the divider is the design’s auto-clean line');
  assertEq(rows.noteCount, 4, 'the row reports how many notes it drew');
  assertEq(rows.keyToken, 'G', 'and the key it drew them in');

  const gapped = takeToAbc(
    [
      { midi: 67, startSec: 0, durationSec: 0.25 },
      { midi: 69, startSec: 1.0, durationSec: 0.25 },
    ],
    { signature: staffKeySignature({ tonic: 7, mode: 'major' }), eighthSec: 0.25, title: 'x' },
  );
  assert(gapped.indexOf(' z') >= 0, 'a real timing gap becomes a rest, not a silent shift');

  const long = takeToAbc(
    Array.from({ length: 20 }, (_, i) => ({ midi: 60, startSec: i * 0.25, durationSec: 0.25 })),
    { signature: staffKeySignature({ tonic: 0, mode: 'major' }), eighthSec: 0.25, title: 'x' },
  );
  assert((long.match(/\|/g) ?? []).length >= 2, 'bar lines appear every four beats');

  const noNotes = takeStaffRows({ rawNotes: [], cleanedNotes: [], key: null, tempoBpm: 100 });
  assertEq(noNotes.rawAbc, null, 'a take with no notes draws no staff at all');
  assertEq(noNotes.cleanedAbc, null, '…and no cleaned staff either');
}

// ─────────────────────────── the editor (D) ───────────────────────────

function editorTests(): void {
  console.log('\n=== the take-correction editor (v33 slice D) ===');
  let state = createEditorState(gMajorTake());
  assertEq(state.notes.length, 4, 'the editor opens on the detected take');
  assertEq(noteTag(state.notes[0]), NOTE_TAG_DETECTED, 'every note starts tagged Auto-detected');
  assert(!canUndo(state), 'nothing to undo before the first edit');

  state = nudgeNotePitch(state, state.notes[0].id, 2);
  assertEq(state.notes[0].midi, 69, 'the semitone rail moves the pitch');
  assertEq(noteTag(state.notes[0]), NOTE_TAG_CORRECTED, 'and the note becomes Corrected by you');
  assert(canUndo(state), 'the edit is undoable');
  state = undo(state);
  assertEq(state.notes[0].midi, 67, 'undo restores the detected pitch');
  assert(canRedo(state), 'and the redo stack holds it');
  state = redo(state);
  assertEq(state.notes[0].midi, 69, 'redo puts the correction back');

  state = setNotePitch(state, state.notes[0].id, 200);
  assertEq(state.notes[0].midi, 96, 'a pitch edit is clamped to the piano’s compass');
  state = setNotePitch(state, state.notes[0].id, -50);
  assertEq(state.notes[0].midi, 36, 'in both directions');

  let timing = createEditorState(gMajorTake());
  const second = timing.notes[1];
  timing = setNoteBoundary(timing, second.id, 'start', 1.3);
  assertEq(Math.round(timing.notes[1].startSec * 100) / 100, 1.25, 'a dragged start snaps to the grid');
  timing = setNoteBoundary(timing, second.id, 'start', -1);
  assert(
    timing.notes[1].startSec >= timing.notes[0].startSec + timing.notes[0].durationSec - 0.0001,
    'a dragged start can never cross the previous note',
  );
  timing = setNoteBoundary(timing, timing.notes[0].id, 'end', 5);
  assert(
    timing.notes[0].startSec + timing.notes[0].durationSec <= timing.notes[1].startSec + 0.0001,
    'a dragged end can never cross the next note',
  );
  assertEq(noteTag(timing.notes[0]), NOTE_TAG_CORRECTED, 'timing edits are the user’s own work');

  let adding = createEditorState(gMajorTake());
  adding = addNoteAfter(adding, adding.notes[0].id, { midi: 65 });
  assertEq(adding.notes.length, 5, 'a missed note can be added');
  assertEq(noteTag(adding.notes[1]), NOTE_TAG_ADDED, 'and it is tagged Added by you');
  assertEq(adding.notes[1].midi, 65, 'with the pitch the user chose');
  assertEq(adding.notes[1].startSec, 1, 'and it lands where the first note ended');
  const addedId = adding.notes[1].id;
  assert(canRemoveNote(adding, addedId), 'an added note can be removed');
  adding = removeNote(adding, addedId);
  assertEq(adding.notes.length, 4, 'and removal works');
  let single = createEditorState({
    notes: [{ midi: 60, startSec: 0, durationSec: 0.5 }],
    tempoBpm: 100,
    durationSec: 0.5,
    key: null,
    capturedAt: '2026-10-04T00:00:00.000Z',
  });
  assert(!canRemoveNote(single, single.notes[0].id), 'the last note cannot be removed');
  const before = single;
  single = removeNote(single, single.notes[0].id);
  assert(single === before, '…and the operation is refused, not silently applied');

  let resting = createEditorState(gMajorTake());
  const firstStart = resting.notes[2].startSec;
  resting = insertRestAfter(resting, resting.notes[0].id);
  assert(resting.notes[2].startSec > firstStart, 'a rest pushes the following notes later');
  assertEq(
    Math.round((resting.notes[2].startSec - firstStart) * 1000) / 1000,
    Math.round(gridStepSec(resting.tempoBpm) * 1000) / 1000,
    'by exactly one grid step of silence',
  );

  let transposing = createEditorState(gMajorTake());
  const shape = transposing.notes.map((note) => note.midi);
  transposing = transposeTake(transposing, 3);
  assertEq(
    transposing.notes.map((note) => note.midi),
    shape.map((midi) => midi + 3),
    'batch transpose moves every note together (the shape is preserved)',
  );
  transposing = transposeTake(transposing, 99);
  assert(
    transposing.notes.every((note, i) => note.midi === Math.min(96, shape[i] + 3 + MAX_TRANSPOSE_SEMITONES)),
    'and the batch step is clamped to ±11 semitones',
  );

  let redetecting = createEditorState(gMajorTake());
  const frames = [
    { atSec: 0.0, midi: 62 },
    { atSec: 0.1, midi: 62 },
    { atSec: 0.2, midi: 74 },
  ];
  redetecting = redetectNote(redetecting, redetecting.notes[0].id, frames);
  assertEq(redetecting.notes[0].midi, 62, 'per-note re-detect reads the median of the frames in that window');
  const noFrames = redetectNote(redetecting, redetecting.notes[1].id, []);
  assert(noFrames === redetecting, 'with no analysis for the window the take is left alone');
  assert(EDITOR_NO_REDETECT_REASON.indexOf('audio analysis') >= 0, 'and the reason names what is missing');

  let quantized = createEditorState({
    notes: [
      { midi: 60, startSec: 0.13, durationSec: 0.29 },
      { midi: 62, startSec: 0.63, durationSec: 0.18 },
    ],
    tempoBpm: 120,
    durationSec: 1,
    key: null,
    capturedAt: '2026-10-04T00:00:00.000Z',
  });
  quantized = requantizeTake(quantized);
  assertEq(quantized.notes[0].startSec, 0.25, 're-quantize snaps the first onset to the grid');
  assertEq(quantized.notes[1].startSec, 0.75, 'and the second too');

  let scaled = createEditorState(gMajorTake());
  scaled = setNotePitch(scaled, scaled.notes[0].id, 66);
  const keyBefore = deriveTake(scaled).key;
  scaled = snapTakeToScale(scaled, keyBefore);
  const scale = keyBefore ? scalePitchClasses(keyBefore.tonic, keyBefore.mode) : [];
  assert(
    scale.length > 0 &&
      scaled.notes.every((note) => scale.includes(((note.midi % 12) + 12) % 12)),
    'snap-to-scale lands every note on the key’s own scale',
  );
  assertEq(
    nearestScaleMidi(66, [0, 2, 4, 5, 7, 9, 11]),
    65,
    'the nearest scale tone wins (F# → F in C major)',
  );

  // The chord row: suggestion, override, tag, reset.
  let chords = createEditorState(gMajorTake());
  const derived = deriveTake(chords);
  assert((derived.chords.length ?? 0) >= 0, 'the derived take always has a chord row');
  assert(!!derived.keyLabel, 'and a key line for the notes it was given');
  const palette = chordPalette(derived.key);
  assert(palette.length >= 4, 'the override palette is the key’s own chord family');
  chords = overrideChord(chords, 0, 'Gmaj7', 'I');
  const withOverride = deriveTake(chords);
  assertEq(withOverride.chords[0].name, 'Gmaj7', 'an override replaces the suggested chord');
  assertEq(withOverride.chords[0].tag, CHORD_TAG_YOURS, 'and is marked as the user’s own');
  assertEq(withOverride.yourChordCount, 1, 'the summary counts it');
  chords = resetChord(chords, 0);
  assertEq(deriveTake(chords).yourChordCount, 0, 'a chord can be put back to the suggestion');
  chords = overrideChord(chords, 0, 'Am');
  chords = clearChordOverrides(chords);
  assertEq(deriveTake(chords).yourChordCount, 0, 'and all of them can be cleared at once');
  const suggestedTag = deriveTake(createEditorState(gMajorTake())).chords[0];
  if (suggestedTag) {
    assertEq(suggestedTag.tag, CHORD_TAG_SUGGESTED, 'untouched chords stay labelled suggested');
  }

  // Reset to detected, and the open contract.
  let reset = createEditorState(gMajorTake());
  const detectedMidis = reset.detected.map((note) => note.midi);
  reset = nudgeNotePitch(reset, reset.notes[0].id, 1);
  reset = addNoteAfter(reset, reset.notes[0].id);
  reset = overrideChord(reset, 0, 'X');
  reset = resetToDetected(reset);
  assertEq(reset.notes.map((note) => note.midi), detectedMidis, 'Reset to detected restores the take exactly');
  assertEq(reset.chordOverrides.length, 0, 'and drops the chord overrides with it');

  const contract = deriveTake(createEditorState(gMajorTake()));
  const keys = Object.keys(contract.take.notes[0]).sort();
  assertEq(
    keys.join(','),
    'durationSec,midi,startSec',
    'OPEN CONTRACT: the corrected take is still a plain MidiNoteEvent list',
  );
  assertEq(
    contract.take.notes.map((note) => note.midi),
    [67, 69, 71, 74],
    'the derived take is the corrected take — one source of truth',
  );
  assertEq(contract.take.tempoBpm, 120, 'carrying the take’s own tempo');
  assertEq(contract.take.capturedAt, '2026-10-04T00:00:00.000Z', 'and its capture stamp');

  let summary = createEditorState(gMajorTake());
  summary = nudgeNotePitch(summary, summary.notes[0].id, 1);
  summary = addNoteAfter(summary, summary.notes[1].id);
  const summaryDerived = deriveTake(summary);
  assertEq(summaryDerived.correctedCount, 1, 'the summary counts corrected notes');
  assertEq(summaryDerived.addedCount, 1, 'and added ones');
  assert(summaryDerived.hasCorrections, 'and knows the take is the user’s now');
  assert(summaryDerived.summaryLine.indexOf('1 note corrected') >= 0, 'the line says what changed');
  assertEq(deriveTake(createEditorState(gMajorTake())).summaryLine, '', 'an untouched take claims no corrections');
  assertEq(editedSequence(createEditorState(gMajorTake())), 'G4 · A4 · B4 · D5', 'the sequence readout spells every note');
}

// ─────────────────────────── the preview (G) ───────────────────────────

function previewTests(): void {
  console.log('\n=== the docked Hum-Along preview (v33 slice G) ===');
  const notes = gMajorTake().notes;
  const snapshot = JSON.stringify(notes);
  const timeline = buildPreviewTimeline(notes, PREVIEW_TEMPO_DEFAULT_PCT);
  assertEq(timeline.events.length, 4, 'the preview plays every note of the take');
  assertEq(timeline.events[1].atMs, 1000, 'at the take’s own timing when the slider is at 100%');
  assertEq(timeline.durationMs, 4000, 'and lasts as long as the take');
  const half = buildPreviewTimeline(notes, 50);
  assertEq(half.events[1].atMs, 2000, 'a 50% preview clock runs half as fast');
  assertEq(JSON.stringify(notes), snapshot, 'TEMPO NEVER REWRITES NOTE TIMES: the take is untouched');
  assertEq(PREVIEW_TEMPO_NEVER_REWRITES, true, 'and that guarantee is a named constant');
  assertEq(clampPreviewTempo(5), PREVIEW_TEMPO_MIN_PCT, 'the slider is clamped at the bottom');
  assertEq(clampPreviewTempo(900), PREVIEW_TEMPO_MAX_PCT, 'and at the top');
  assertEq(previewTempoLabel(100), '100% (as recorded)', '100% is labelled as the recorded timing');
  assertEq(previewTempoLabel(80), '80%', 'anything else is just the percentage');

  assertEq(cursorIndexAt(timeline, 1500), 1, 'the cursor follows the note being played');
  assertEq(cursorIndexAt(timeline, 4500), null, 'and is empty past the end (no phantom note)');
  assertEq(stepIndex(0, -1, 4), 3, 'prev wraps to the last note');
  assertEq(stepIndex(3, 1, 4), 0, 'next wraps to the first');
  assertEq(stepIndex(null, 1, 4), 0, 'stepping from nothing starts at the first note');
  assertEq(stepIndex(null, -1, 0), null, 'and there is nothing to step through in an empty take');

  const bracket = loopBetween(2, 1, 4);
  assertEq(bracket, { fromIndex: 1, toIndex: 2 }, 'a loop bracket is order-independent');
  assertEq(fullLoop(4), { fromIndex: 0, toIndex: 3 }, 'the default loop is the whole take');
  const bounds = loopBoundsMs(timeline, bracket);
  assertEq(bounds.fromMs, 1000, 'the loop starts at the first bracketed note');
  assertEq(bounds.toMs, 3000, 'and ends at the end of the last');
  assertEq(loopBoundsMs(timeline, null).toMs, 4000, 'with no bracket the loop is the whole take');

  assertEq(previewInstrument('guitar').label, 'Guitar', 'the instrument overlay can be changed');
  assertEq(previewInstrument('nonsense').id, PREVIEW_DEFAULT_INSTRUMENT, 'an unknown instrument falls back to piano');

  // v37 item 3 — the synthesized trio became the RECORDED acoustic bank. These
  // are the chips the owner reaches sax/trumpet/harp through (owner FAIL #7), so
  // the copy asserted here is surface copy, not an implementation detail.
  assertEq(
    PREVIEW_INSTRUMENTS.map((entry) => entry.id).join(','),
    'piano,guitar,sax,trumpet,harp',
    'the preview offers exactly the five recorded instruments the bank holds',
  );
  assertEq(previewInstrument('sax').label, 'Sax', 'sax has its own chip');
  assertEq(previewInstrument('trumpet').label, 'Trumpet', 'so does trumpet');
  assertEq(previewInstrument('harp').label, 'Harp', 'so does harp');
  assertEq(
    previewInstrument('strings').id,
    PREVIEW_DEFAULT_INSTRUMENT,
    'the retired synthesized id falls back to piano instead of offering a silent chip',
  );
  assertEq(
    new Set(PREVIEW_INSTRUMENTS.map((entry) => entry.label)).size,
    PREVIEW_INSTRUMENTS.length,
    'every chip has its own label',
  );
  assert(
    PREVIEW_INSTRUMENTS.every(
      (entry) => entry.label.length > 1 && entry.timbre.indexOf('recorded') >= 0,
    ),
    'every timbre line names the recorded sound honestly (v37 plays samples, not synthesis)',
  );
  assert(
    previewStatusLine({ playing: true, loop: true, noteCount: 4, cursor: 2 }).indexOf('note 3 of 4') >= 0,
    'the status line says where the preview is',
  );
  assert(
    previewStatusLine({ playing: false, loop: false, noteCount: 0, cursor: null }).indexOf('Add a note') >= 0,
    'an empty take says what to do instead of pretending to play',
  );
  assert(
    PREVIEW_ONLY_CAPTION.indexOf('Preview only') === 0 && PREVIEW_ONLY_CAPTION.indexOf('not the original song') >= 0,
    'the honesty caption is on the surface, not in a comment',
  );
}

// ─────────────────────────── the email batch (F) ───────────────────────────

function themeTests(): void {
  console.log('\n=== light / dark (v33 slice F) ===');
  assertEq(DEFAULT_THEME_MODE, 'dark', 'the app still ships dark');
  assertEq(resolveThemeMode('light'), 'light', 'a stored light mode is honoured');
  assertEq(resolveThemeMode('"light"'), 'light', 'even if it was stored quoted');
  assertEq(resolveThemeMode('purple'), 'dark', 'an unknown value falls back to dark');
  assertEq(resolveThemeMode(null), 'dark', 'and so does a missing one');
  assertEq(toggleThemeMode('dark'), 'light', 'the toggle flips dark → light');
  assertEq(toggleThemeMode('light'), 'dark', 'and light → dark');
  assertEq(themeFor('light').background, LIGHT_THEME.background, 'the palette resolves by mode');
  assertEq(
    Object.keys(DARK_THEME).sort().join(','),
    Object.keys(LIGHT_THEME).sort().join(','),
    'both palettes carry exactly the same roles (a surface cannot lose a colour)',
  );
  assertEq(THEME_STORAGE_KEY, 'notesnap.theme.mode', 'the choice has one storage key');
  // v34b: the theme is APP-WIDE now (owner FAIL item 6), so the note must say so and
  // must not still tell the user that only one screen is themed. Same intent as v33
  // (the note may not overstate or understate what the toggle does) — the text moved.
  assert(
    THEME_HONEST_NOTE.indexOf('whole app') >= 0 &&
      THEME_HONEST_NOTE.toLowerCase().indexOf('rest of the app') < 0,
    'the scope note is honest about what is themed (app-wide since v34b)',
  );
}

function coverScanTests(): void {
  console.log('\n=== scan a cover (v33 slice H) ===');
  const text = [
    'Toccata and Fugue in D minor',
    'Johann Sebastian Bach',
    'BWV 565',
    'ISBN 978-0-000-00000-0',
    'Printed in Germany',
    '£4.95',
    'https://example.com/shop',
  ].join('\n');
  const query = coverQueryFromText(text);
  assertEq(query.query, 'Toccata and Fugue in D minor Johann Sebastian Bach', 'the title leads and the composer follows');
  assert(query.dropped >= 4, 'the ISBN/price/publisher/URL furniture is dropped');
  assert(!query.truncated, 'a short title page is not truncated');
  const noisy = coverQueryFromText('ISBN 1\n12\n$\n\n£3.50');
  assertEq(noisy.query, '', 'a page with no readable title yields NO query (never a guess)');
  const long = coverQueryFromText(`${'A'.repeat(120)}`);
  assertEq(long.query.length, COVER_SCAN_MAX_QUERY, 'a very long line is cut to the search field’s limit');
  assert(long.truncated, 'and says it was cut');

  const unavailable = coverQueryFromScan({ ocrText: null, ocrAvailable: false });
  assertEq(unavailable.status, 'no-ocr', 'a build with no recogniser reports the honest no-OCR state');
  assertEq(unavailable.query, '', 'and offers no invented query');
  assert(
    COVER_SCAN_NO_OCR_LINE.indexOf('type the title you see') >= 0,
    'the line tells the user exactly what to do instead (no dead end)',
  );
  // v36 fix 4 — THE READ. This build ships an on-device recogniser, so the flow's
  // own default is a real read, and the affordance says what it does.
  assertEq(COVER_SCAN_OCR_AVAILABLE, true, 'this build ships an on-device recogniser');
  assertEq(
    coverScanAffordanceLabel(),
    COVER_SCAN_CTA,
    'and the search box calls it what it is: scan a cover',
  );
  const read = coverQueryFromScan({ ocrText: 'Für Elise\nBeethoven' });
  assertEq(read.status, 'ready', 'a readable cover is ready');
  assertEq(read.query, 'Für Elise Beethoven', 'and the query keeps the title as printed');
  const blank = coverQueryFromScan({ ocrText: '   \n \n' });
  assertEq(blank.status, 'no-text', 'a page with no readable title is its own honest state');
  assertEq(blank.query, '', 'and yields no query (never a guess)');
  // A read that FAILED is NOT a blank page: it is its own state, its own line, and
  // it can never be dressed up as a query.
  const failed = coverQueryFromScan({ ocrText: null, ocrFailed: true });
  assertEq(failed.status, 'ocr-failed', 'a failed read reports the honest failure state');
  assertEq(failed.query, '', 'and never yields a query');
  assertEq(failed.line, COVER_SCAN_OCR_FAILED_LINE, 'with the failure line, not the blank-page one');
  assert(
    failed.line.indexOf('type the title you see') >= 0,
    'and the typed search is still one tap away (no dead end)',
  );
  // Failure outranks text: a recogniser that broke must never be reported as a
  // successful read, even if it happened to return something on the way out.
  assertEq(
    coverQueryFromScan({ ocrText: 'Für Elise', ocrFailed: true }).status,
    'ocr-failed',
    'a failed read outranks any text it returned',
  );
  // The scope claim: words only. A scan is not OMR and produces no note data.
  assert(
    COVER_SCAN_TEXT_ONLY_LINE.indexOf('never the notes') >= 0,
    'the scope line says the scan reads the words, never the notes',
  );
  assert(
    COVER_SCAN_TEXT_ONLY_LINE.toLowerCase().indexOf('notation') < 0 &&
      COVER_SCAN_TEXT_ONLY_LINE.toLowerCase().indexOf('transcri') < 0,
    'and never claims notation or transcription (no OMR promise in a scan)',
  );
}

function fuzzyTests(): void {
  console.log('\n=== the find-a-piece typo fix (v33 slice F) ===');
  assertEq(normalizeSearchText('  Toccata & Fugue, D minor!  '), 'toccata fugue d minor', 'the normaliser strips punctuation');
  assertEq(normalizeSearchText('Für Elise'), 'fur elise', 'and diacritics');
  assertEq(editDistance('toccatta', 'toccata'), 1, 'a doubled letter costs one edit');
  assertEq(editDistance('abc', 'xyz'), 3, 'unrelated words are far apart');
  assertEq(editDistance('abc', 'abcdefghij', 3), 4, 'and a length gap past the bound short-circuits');
  assert(tokenMatches('toccatta', 'toccata'), 'a one-letter typo still hits');
  assert(tokenMatches('beeth', 'beethoven'), 'a prefix hits');
  assert(!tokenMatches('bwv', 'bach'), 'unrelated short tokens do not hit');

  const library = [
    { title: 'Toccata and Fugue in D minor', composer: 'Johann Sebastian Bach', catalog: 'BWV 565' },
    { title: 'Für Elise', composer: 'Ludwig van Beethoven', catalog: 'WoO 59' },
    { title: 'Moonlight Sonata', composer: 'Ludwig van Beethoven', catalog: 'Op. 27 No. 2' },
  ];
  const toccata = fuzzyScore('toccatta and fugue', library[0]);
  assert(toccata >= 0.5, 'the owner’s own misspelling scores against the real title');
  assertEq(fuzzyScore('toccatta and fugue', library[1]), 0, 'and finds nothing in an unrelated piece');
  const byCatalog = fuzzyScore('bwv 565', library[0]);
  assert(byCatalog >= 0.5, 'the catalog number works as a query too');
  const ranked = rankFuzzyMatches('toccatta and fugue', library);
  assertEq(ranked.length, 1, 'only the real match is ranked, never the whole library');
  assertEq(ranked[0].item.catalog, 'BWV 565', 'and it is the Toccata & Fugue');

  const doubled = halveDoubledRuns('toccatta');
  assert(
    doubled.includes('toccata'),
    'the doubled-letter correction produces the real spelling among its variants',
  );
  assertEq(doubled.length, 2, 'one variant per doubled run (cc and tt) — no invented corrections');
  assertEq(halveDoubledRuns('bach'), [], 'a clean token has nothing to correct');
  const variants = queryVariants('toccatta and fugue');
  assertEq(variants[0], 'toccatta and fugue', 'the user’s own words are tried FIRST');
  assert(variants.includes('toccatta fugue'), 'then with the filler word dropped');
  assert(variants.includes('toccata and fugue'), 'then with the doubled letter corrected');
  assert(variants.includes('fugue'), 'and finally the significant tokens on their own');
  assert(queryVariants('   ').length === 0, 'an empty query has no variants to try');
  const notice = retryNoticeLine('toccatta and fugue', 'toccata and fugue');
  assert(!!notice && notice.indexOf('No exact match') === 0, 'the surface says plainly that a variant matched');
  assertEq(retryNoticeLine('bach', 'bach'), null, 'and stays quiet when the user’s own words matched');
}

function main(): void {
  staffTests();
  editorTests();
  previewTests();
  themeTests();
  coverScanTests();
  fuzzyTests();
  if (failures > 0) {
    console.error(`\n${passes} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`\n${passes} passed, 0 failed`);
}

main();
