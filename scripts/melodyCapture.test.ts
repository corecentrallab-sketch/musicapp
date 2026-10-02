/**
 * melodyCapture.test.ts — tier1 gate for src/services/melodyCapture.ts, the
 * pure half of the melody-idea capture window (owner 10-02, rank-2 creator's
 * tool).
 *
 * What it pins, in the order the window shows it:
 *   1. the note-by-note sequence ("A3 · B3 · C#4 · D4") and its truncation;
 *   2. the key's scale and the AUTO-CLEANING (pitch onto the scale, onsets onto
 *      the beat grid) — including the null-key case, where NOTHING may change;
 *   3. the mandatory honest labels ("Auto-cleaned", "Suggested") and the copy
 *      that may never promise anything the feature does not do;
 *   4. the suggested chords: I/IV/V/vi (major) and i/iv/v/VI/VII (minor), no
 *      key ⇒ no chords, always most-supported first;
 *   5. the three take states — ready / silent / unavailable — with their action
 *      gates (canSave / canExportMidi) and the reason attached to a disabled
 *      action (a button that could only fail is a dead end);
 *   6. the personal-melody History row identity (deterministic, never a piece id);
 *   7. the live trace (VU meter curve, silence line, and the honest "no live
 *      pitch source in this build" state).
 *
 * The last section is the INTEGRATION check: a synthetic take is built through
 * the REAL pipeline (pitchDetection frames → midiExport.buildCaptureTake →
 * keyDetection), then analysed — so the cleaning and the chords are proven
 * against the same seam the app uses, not against a hand-written fixture.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  ANALYSIS_UNAVAILABLE_LINE,
  ANALYSIS_UNAVAILABLE_REASON,
  ANALYSIS_UNAVAILABLE_TITLE,
  AUTO_CLEANED_LABEL_PREFIX,
  CAPTURE_HINT,
  CAPTURE_WINDOW_TITLE,
  CHORDS_HONESTY_LINE,
  CLEANED_SEQUENCE_LABEL,
  MELODY_ROW_COMPOSER,
  MELODY_ROW_TITLE,
  NO_KEY_NO_CHORDS_LINE,
  NOTE_SEQUENCE_SEPARATOR,
  NO_LIVE_NOTES_LINE,
  LISTENING_LINE,
  QUIET_TAKE_LINE,
  RAW_SEQUENCE_LABEL,
  SAVE_MELODY_HINT,
  SILENT_SAVE_REASON,
  SILENT_TAKE_LINE,
  SILENT_TAKE_TITLE,
  STOP_CTA_LABEL,
  SUGGESTED_CHORDS_LABEL,
  VU_BAR_COUNT,
  autoCleanTake,
  buildLiveTrace,
  buildMelodyAnalysis,
  chordCandidates,
  cleaningLabel,
  detectGridTempoBpm,
  isMelodyRowId,
  melodyRowId,
  meterFraction,
  nearestScaleShift,
  noteName,
  noteSequence,
  pitchClassInScale,
  quantizeNotesToKey,
  scalePitchClasses,
  snapOnsetsToGrid,
  suggestedChords,
} from '../src/services/melodyCapture';
import { promisesSomething } from '../src/services/promiseAudit';
import { detectKeyFromNotes, type KeyDecision } from '../src/services/keyDetection';
import { buildCaptureTake, type MidiNoteEvent } from '../src/services/midiExport';
import { detectPitchFrames, type PitchFrame } from '../src/services/pitchDetection';

declare const process: { exit(code: number): never };

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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  assert(actual === expected, `${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

function near(actual: number, expected: number, tolerance = 1e-6): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

// ─── fixtures ───────────────────────────────────────────────────

/** A key verdict, as keyDetection returns it. */
function key(tonic: number, mode: 'major' | 'minor', label: string): KeyDecision {
  return { tonic, mode, correlation: 0.9, confidence: 0.6, label };
}

/** One note event at `startSec`, `durationSec` long. */
function note(midi: number, startSec: number, durationSec = 0.4): MidiNoteEvent {
  return { midi, startSec, durationSec, velocity: 90 };
}

/**
 * A synthetic sung take: `segments` of (midi, seconds), turned into one pitch
 * frame every 25 ms — the same frame grid the tracker emits.
 */
function framesFrom(segments: ReadonlyArray<[number, number]>): PitchFrame[] {
  const hop = 0.025;
  const frames: PitchFrame[] = [];
  let tSec = 0;
  for (const [midi, seconds] of segments) {
    const count = Math.max(1, Math.round(seconds / hop));
    for (let i = 0; i < count; i++) {
      frames.push({ tSec, midi, rms: 0.2 });
      tSec += hop;
    }
  }
  return frames;
}

/** Raw mono samples of a pure tone, the shape the PCM seam hands the tracker. */
function sineSamples(midi: number, seconds: number, sampleRate = 22050): Float32Array {
  const length = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(length);
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  for (let i = 0; i < length; i++) {
    samples[i] = 0.35 * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return samples;
}

// ─── 1. the note sequence ───────────────────────────────────────

function sequenceTests(): void {
  console.log('\nthe note-by-note sequence, with octave letters');

  assertEq(noteName(57), 'A3', 'MIDI 57 is A3');
  assertEq(noteName(61), 'C#4', 'MIDI 61 is C#4 (sharp-spelled, like every key name)');
  assertEq(noteName(60), 'C4', 'MIDI 60 is C4 (scientific pitch notation)');
  assertEq(noteName(69), 'A4', 'MIDI 69 is A4');
  assertEq(noteName(Number.NaN), null, 'a non-finite pitch has no name (never a phantom note)');
  assertEq(noteName(undefined as unknown as number), null, 'a missing pitch has no name');

  const seq = noteSequence([note(57, 0), note(59, 0.4), note(61, 0.8), note(62, 1.2)]);
  assertEq(seq.text, `A3${NOTE_SEQUENCE_SEPARATOR}B3${NOTE_SEQUENCE_SEPARATOR}C#4${NOTE_SEQUENCE_SEPARATOR}D4`, 'the sequence string is the notes as hummed');
  assertEq(seq.shown, 4, 'all four notes are shown');
  assertEq(seq.hidden, 0, 'nothing was hidden');

  const short = noteSequence([note(57, 0), note(59, 0.4), note(61, 0.8)], { max: 2 });
  assertEq(short.shown, 2, 'a truncated sequence shows `max` notes');
  assertEq(short.hidden, 1, 'and REPORTS how many it hid (never a silent drop)');
  assert(short.text.indexOf('…') > 0, 'the truncation is marked with an ellipsis');

  assertEq(noteSequence([]).text, '', 'a take with no notes has an empty sequence');
  assertEq(noteSequence(null).text, '', 'a null take has an empty sequence');
}

// ─── 2. the scale + the auto-cleaning ───────────────────────────

function cleaningTests(): void {
  console.log('\nauto-cleaning: pitch onto the key scale, onsets onto the beat');

  assertEq(scalePitchClasses(0, 'major').join(','), '0,2,4,5,7,9,11', 'C major is the plain major scale');
  assertEq(scalePitchClasses(9, 'minor').join(','), '9,11,0,2,4,5,7', 'A minor is the NATURAL minor scale');
  assert(pitchClassInScale(7, 0, 'major'), 'G is in C major');
  assert(!pitchClassInScale(6, 0, 'major'), 'F# is not in C major');

  // A note exactly between two scale notes resolves DOWN and is deterministic:
  // C# between C and D in C major.
  assertEq(nearestScaleShift(1, 0, 'major'), -1, 'a tie resolves downward (C# → C in C major)');
  assertEq(nearestScaleShift(1, 0, 'major', { prefer: 'up' }), 1, 'the tie direction is a documented option, not an accident');
  assertEq(nearestScaleShift(6, 0, 'major'), -1, 'F# snaps a semitone down to F in C major');
  assertEq(nearestScaleShift(7, 0, 'major'), 0, 'a note already on the scale is not moved at all');

  const inScale = [note(60, 0), note(62, 0.4), note(64, 0.8)];
  const untouched = quantizeNotesToKey(inScale, key(0, 'major', 'C major'));
  assertEq(untouched.notesAdjusted, 0, 'an in-key take is left exactly as it was');
  assertEq(untouched.notes.map((n) => n.midi).join(','), '60,62,64', 'and its pitches are unchanged');
  assertEq(untouched.notes[1].startSec, 0.4, 'timings are never touched by pitch cleaning');

  const chromatic = [note(60, 0), note(61, 0.4), note(63, 0.8), note(66, 1.2)];
  const cleaned = quantizeNotesToKey(chromatic, key(0, 'major', 'C major'));
  assertEq(cleaned.notes.map((n) => n.midi).join(','), '60,60,62,65', 'every out-of-key note moves onto the scale');
  assertEq(cleaned.notesAdjusted, 3, 'and the number of nudged notes is reported');
  assert(cleaned.pitchCleaned, 'the pass is marked as having really run');

  // THE HONEST NULL KEY: no key ⇒ no cleaning, at all.
  const noKey = quantizeNotesToKey(chromatic, null);
  assertEq(noKey.notesAdjusted, 0, 'with no detected key NOTHING is nudged');
  assertEq(noKey.notes.map((n) => n.midi).join(','), '60,61,63,66', 'and the take stays exactly as hummed');
  assert(!noKey.pitchCleaned, 'the pass reports that it did not clean');

  // The beat grid.
  const steady = [note(60, 0), note(62, 0.5), note(64, 1.0), note(65, 1.5), note(67, 2.0)];
  assertEq(detectGridTempoBpm(steady), 120, 'a steady half-second pulse reads as 120 bpm');
  assertEq(detectGridTempoBpm([note(60, 0), note(62, 0.5)]), null, 'too few notes ⇒ no tempo claimed');
  assertEq(detectGridTempoBpm([]), null, 'an empty take has no pulse');
  const erratic = [note(60, 0), note(62, 0.2), note(64, 1.4), note(65, 1.5), note(67, 2.9)];
  assertEq(detectGridTempoBpm(erratic), null, 'an erratic take does not get an invented grid');

  const snapped = snapOnsetsToGrid(steady, 120, { division: 2 });
  assertEq(snapped.notes.map((n) => n.startSec).join(','), '0,0.5,1,1.5,2', 'onsets land on the eighth-note grid');
  assertEq(snapped.moved, 0, 'a take already on the grid is not reported as moved');
  const offGrid = snapOnsetsToGrid([note(60, 0.1), note(62, 0.6)], 120, { division: 2 });
  assertEq(offGrid.notes.map((n) => n.startSec).join(','), '0,0.5', 'off-grid onsets snap to the nearest line');
  assertEq(offGrid.moved, 2, 'and the moved onsets are counted');
  assertEq(offGrid.notes[1].durationSec, 0.4, 'snapping an onset leaves the note’s DURATION alone');
  const noGrid = snapOnsetsToGrid(steady, null);
  assertEq(noGrid.notes.map((n) => n.startSec).join(','), '0,0.5,1,1.5,2', 'no tempo ⇒ no grid, take unchanged');
  assert(!noGrid.applied, 'and the pass says so');

  const both = autoCleanTake(chromatic.concat(note(69, 2.0), note(71, 2.5)), key(0, 'major', 'C major'));
  assertEq(both.notesAdjusted, 3, 'the full pass cleans the pitches of the out-of-key notes');
  assert(both.pitchCleaned, 'the full pass reports the pitch half');

  // THE MANDATORY LABEL.
  const label = cleaningLabel(cleaned, key(0, 'major', 'C major'), 4);
  assert(label.indexOf(AUTO_CLEANED_LABEL_PREFIX) === 0, 'the label starts with "Auto-cleaned"');
  assert(label.indexOf('C major') > 0, 'it names the detected key');
  assert(label.indexOf('3 of 4 notes') > 0, 'it says how many notes were nudged');
  assert(!/studio|transcri/i.test(label), 'it never claims a studio transcription');
  assertEq(cleaningLabel(noKey, null, 4), `${RAW_SEQUENCE_LABEL} — no key was detected in this take, so nothing was changed.`, 'with no key the label says the sequence is as hummed');
}

// ─── 3. suggested chords ────────────────────────────────────────

function chordTests(): void {
  console.log('\nsuggested chords — always labelled, never a claim about harmony');

  const major = chordCandidates(7, 'major');
  assertEq(major.map((c) => c.degree).join(','), 'I,IV,V,vi', 'a major key offers I / IV / V / vi');
  assertEq(major[3].relative, 'relative minor', 'vi is named as the relative minor');
  const minor = chordCandidates(9, 'minor');
  assertEq(minor.map((c) => c.degree).join(','), 'i,iv,v,VI,VII', 'a minor key offers i / iv / v / VI / VII');
  assertEq(minor[3].relative, 'relative major', 'VI is named as the relative major');
  assertEq(minor[3].rootPc, 5, 'A minor’s VI is F (the relative major of A minor is C, so the triad root is F)');

  // G major take touching G, B, D and E.
  const gMajor = [note(67, 0), note(71, 0.4), note(74, 0.8), note(76, 1.2)];
  const suggestion = suggestedChords(gMajor, key(7, 'major', 'G major'));
  assertEq(suggestion.label, SUGGESTED_CHORDS_LABEL, 'the suggestion is labelled "Suggested"');
  assertEq(suggestion.chords.map((c) => c.name).join(','), 'G,Em,C,D', 'the family is ordered by how well the take supports it');
  assertEq(suggestion.line!.indexOf('Suggested: '), 0, 'the rendered line leads with the honest label');
  assert(suggestion.chords.every((c) => c.shared > 0), 'every suggested chord really shares a note with the take');
  assertEq(suggestion.chords[1].degree, 'vi', 'the relative minor (Em) is among them');

  // NO KEY ⇒ NO CHORDS. This is the fabrication boundary.
  const bare = suggestedChords(gMajor, null);
  assertEq(bare.chords.length, 0, 'with no detected key there are NO chords');
  assertEq(bare.honestLine, NO_KEY_NO_CHORDS_LINE, 'and the surface gets the honest line instead');
  assertEq(bare.line, null, 'no line is built that could imply a key');

  const emptyTake = suggestedChords([], key(7, 'major', 'G major'));
  assertEq(emptyTake.chords.length, 0, 'a take with no notes suggests no chords');
  assert(!!emptyTake.honestLine, 'and says why');

  assertEq(suggestedChords(gMajor, key(7, 'major', 'G major')).label, SUGGESTED_CHORDS_LABEL, 'the label is present on every suggestion');
  assert(
    chordCandidates(0, 'major').length === 4 && chordCandidates(0, 'minor').length === 5,
    'the candidate families are the ratified I/IV/V/vi and i/iv/v/VI/VII sets',
  );
  assert(!/the song|official chords|real chords/i.test(CHORDS_HONESTY_LINE), 'the honesty line never claims the chords are the song’s');
}

// ─── 4. the three take states ───────────────────────────────────

function takeStateTests(): void {
  console.log('\nthe take states: ready / silent / unavailable');

  const readyTake = {
    notes: [note(60, 0), note(62, 0.4), note(64, 0.8), note(65, 1.2), note(67, 1.6)],
    tempoBpm: 120,
    durationSec: 2,
    key: key(0, 'major', 'C major'),
    capturedAt: '2026-10-03T09:15:00.000Z',
  };
  const ready = buildMelodyAnalysis(readyTake);
  assertEq(ready.state, 'ready', 'a take with notes is ready');
  assertEq(ready.noteCount, 5, 'the note count is the take’s own');
  assertEq(ready.rawSequence, `C4${NOTE_SEQUENCE_SEPARATOR}D4${NOTE_SEQUENCE_SEPARATOR}E4${NOTE_SEQUENCE_SEPARATOR}F4${NOTE_SEQUENCE_SEPARATOR}G4`, 'the as-hummed sequence is shown');
  assertEq(ready.keyLine, 'Key: C major', 'the detected key is rendered with the existing caption');
  assert(ready.canSave && ready.canExportMidi, 'a ready take can be saved and exported');
  assertEq(ready.disabledReason, null, 'and nothing is disabled');
  assertEq(ready.rowTitle, MELODY_ROW_TITLE, 'the History row is titled "My melody"');
  assertEq(ready.rowComposer, MELODY_ROW_COMPOSER, 'and labelled a personal melody');
  assert(ready.cleanedLabel.indexOf(AUTO_CLEANED_LABEL_PREFIX) === 0, 'the cleaned sequence carries the mandatory label');
  assertEq(ready.durationSec, 2, 'the take duration comes through');

  // A silently-hummed take: the tracker heard nothing.
  const silent = buildMelodyAnalysis({
    notes: [],
    tempoBpm: 120,
    durationSec: 11,
    key: null,
    capturedAt: '2026-10-03T09:16:00.000Z',
  });
  assertEq(silent.state, 'silent', 'a take with no notes is the silent state');
  assertEq(silent.stateTitle, SILENT_TAKE_TITLE, 'the silent state has its own honest heading');
  assertEq(silent.stateLine, SILENT_TAKE_LINE, '…and its own honest line');
  assertEq(silent.canSave, false, 'a silent take cannot be saved');
  assertEq(silent.canExportMidi, false, 'and cannot be exported');
  assertEq(silent.disabledReason, SILENT_SAVE_REASON, 'the disabled actions carry the reason (never a silent dead button)');
  assertEq(silent.cleanedSequence, '', 'no sequence is invented for a silent take');
  assertEq(silent.keyLine, null, 'and no key is invented either');
  assertEq(silent.chords.chords.length, 0, 'a silent take suggests no chords');
  assertEq(buildMelodyAnalysis(null).state, 'silent', 'a null take is the silent state too');

  // The decoder was unavailable: the recording exists, nothing could be read.
  const unavailable = buildMelodyAnalysis(null, { unavailable: true });
  assertEq(unavailable.state, 'unavailable', 'a take that could not be read has its own state');
  assertEq(unavailable.stateTitle, ANALYSIS_UNAVAILABLE_TITLE, 'with its own heading');
  assertEq(unavailable.stateLine, ANALYSIS_UNAVAILABLE_LINE, 'and an honest line about the decoder');
  assertEq(unavailable.canSave, false, 'nothing is saved from a take we could not read');
  assertEq(unavailable.canExportMidi, false, 'and nothing is exported');
  assertEq(unavailable.disabledReason, ANALYSIS_UNAVAILABLE_REASON, 'both actions carry the reason');

  // The row identity.
  const id = melodyRowId('2026-10-03T09:15:00.000Z');
  assertEq(id, 'melody-20261003T091500000Z', 'the row id is the prefix + the capture stamp, slugged');
  assertEq(melodyRowId('2026-10-03T09:15:00.000Z'), id, 'the id is deterministic for the same take');
  assert(melodyRowId('2026-10-03T09:15:01.000Z') !== id, 'two takes get two rows');
  assert(isMelodyRowId(id), 'a melody row is recognisable by its id');
  assert(!isMelodyRowId('b2ffba94-0000-4000-8000-000000000000'), 'a catalog piece id is NOT a melody row');
  assertEq(ready.rowId, id, 'the analysis carries the take’s own row id');

  // The copy sweep: nothing this feature says is a promise it cannot keep.
  const copy = [
    CAPTURE_WINDOW_TITLE,
    CAPTURE_HINT,
    STOP_CTA_LABEL,
    CLEANED_SEQUENCE_LABEL,
    RAW_SEQUENCE_LABEL,
    CHORDS_HONESTY_LINE,
    NO_KEY_NO_CHORDS_LINE,
    SAVE_MELODY_HINT,
    SILENT_TAKE_TITLE,
    SILENT_TAKE_LINE,
    SILENT_SAVE_REASON,
    ANALYSIS_UNAVAILABLE_TITLE,
    ANALYSIS_UNAVAILABLE_LINE,
    ANALYSIS_UNAVAILABLE_REASON,
    NO_LIVE_NOTES_LINE,
    LISTENING_LINE,
    QUIET_TAKE_LINE,
  ];
  const promises = copy.filter((line) => promisesSomething(line));
  assertEq(promises.length, 0, `no window copy is a banned promise (${promises.join(' | ')})`);
  assert(!/studio/i.test(copy.join(' ')), 'no window copy claims a studio transcription');
}

// ─── 5. the live trace ──────────────────────────────────────────

function liveTraceTests(): void {
  console.log('\nthe live trace: a real meter, an honest note state');

  assertEq(meterFraction(0), 1, '0 dBFS is a full bar');
  assertEq(meterFraction(-60), 0, 'the floor is a silent bar');
  assertEq(meterFraction(-30), 0.5, '−30 dBFS is half a bar');
  assertEq(meterFraction(Number.NaN), 0, 'a broken sample is silence, never a peak');
  assertEq(meterFraction(3), 1, 'a positive sample is clipped to a full bar');

  const trace = buildLiveTrace({
    levels: [-100, -50, -10],
    elapsedMs: 12500,
    liveSourceReady: false,
  });
  assertEq(trace.bars.length, VU_BAR_COUNT, 'the meter always renders a full bar row');
  assertEq(trace.bars[VU_BAR_COUNT - 1], meterFraction(-10), 'the newest sample is the right-hand bar');
  assertEq(trace.bars[VU_BAR_COUNT - 3], meterFraction(-100), 'older samples sit to the left of it (time reads left → right)');
  assertEq(trace.bars[0], 0, 'a short history is padded with silence, never stretched');
  assertEq(trace.level, meterFraction(-10), 'the level is the newest sample');
  assert(trace.hearing, 'a −10 dBFS sample counts as hearing something');
  assertEq(trace.elapsedSec, 12.5, 'the elapsed time is in seconds, one decimal');
  assertEq(trace.liveNotesUnavailable, true, 'this build reports that it has NO live pitch source');
  assertEq(trace.statusLine, NO_LIVE_NOTES_LINE, 'and says honestly when the notes appear instead');
  assert(!promisesSomething(NO_LIVE_NOTES_LINE), 'the no-live-notes line promises nothing');

  const quiet = buildLiveTrace({ levels: [-120, -120] });
  assertEq(quiet.level, 0, 'a silent stretch reads as a flat meter');
  assert(!quiet.hearing, 'and is not treated as hearing the user');
  assertEq(quiet.statusLine, QUIET_TAKE_LINE, 'the quiet line asks for a clearer take (a real next step)');

  const listening = buildLiveTrace({ levels: [-20], liveSourceReady: true });
  assertEq(listening.statusLine, LISTENING_LINE, 'with a live source and no note yet, the line is "listening"');
  const live = buildLiveTrace({ levels: [-20], liveSourceReady: true, liveNotes: ['A3', 'B3'] });
  assertEq(live.statusLine, `A3${NOTE_SEQUENCE_SEPARATOR}B3`, 'live notes render as the notes they are, as they are detected');
  assertEq(live.liveNotesUnavailable, false, 'a live source means the honest state is OFF');
}

// ─── 6. the real pipeline, end to end ───────────────────────────

function integrationTests(): void {
  console.log('\nthe real seam: frames → take → analysis');

  // (a) SILENCE through the real tracker: one second of nothing is one second of
  // unvoiced frames, and that is a silent take — never a fabricated melody.
  const silentFrames = detectPitchFrames(new Float32Array(22050), 22050);
  assert(silentFrames.length > 0, 'the tracker produces frames for a silent second');
  assert(silentFrames.every((f) => f.midi === null), 'and every one of them is honestly unvoiced');
  const silentTake = buildCaptureTake(silentFrames, { capturedAt: '2026-10-03T09:59:00.000Z' });
  assertEq(silentTake, null, 'a silent recording produces NO take');
  assertEq(buildMelodyAnalysis(silentTake).state, 'silent', 'and the window lands in the honest silent state');

  // (b) A PURE TONE through the real tracker: a hummed A4 must read as A4.
  const toneFrames = detectPitchFrames(sineSamples(69, 0.6), 22050);
  const voiced = toneFrames.filter((f) => typeof f.midi === 'number');
  assert(voiced.length > 5, 'a 440 Hz tone is voiced in most frames');
  const toneMidi = voiced.length ? Math.round(voiced[Math.floor(voiced.length / 2)].midi as number) : -1;
  assertEq(noteName(toneMidi), 'A4', 'the tracker reads a 440 Hz hum as A4');

  // (c) A phrase through the REAL take builder, then the analysis.
  // A C-major phrase with the tonic held longest (a clear key, no chromatic note).
  const frames = framesFrom([
    [60, 2.0],
    [62, 0.5],
    [64, 0.5],
    [65, 0.5],
    [67, 0.5],
    [69, 0.5],
    [71, 0.5],
    [72, 1.0],
  ]);
  const take = buildCaptureTake(frames, { tempoBpm: 120, capturedAt: '2026-10-03T10:00:00.000Z' });
  assert(!!take, 'the real pipeline produces a take from a phrase');
  const analysis = buildMelodyAnalysis(take);
  assertEq(analysis.state, 'ready', 'and its analysis is ready');
  assertEq(analysis.noteCount, 8, 'every one of the eight sung notes is in the take');
  assertEq(analysis.keyLine, 'Key: C major', 'the key comes from the take’s own pitches');
  assert(analysis.cleanedSequence.length > 0, 'the cleaned sequence is filled');
  assertEq(analysis.notesAdjusted, 0, 'a diatonic take needs no pitch cleaning');
  assertEq(analysis.cleanedSequence, analysis.rawSequence, 'so the cleaned and as-hummed sequences agree');
  assert(analysis.chords.chords.length > 0, 'and the key yields suggested chords');
  assert(analysis.chords.chords.some((c) => c.name === 'C'), 'the tonic chord is among them');

  // The key the analysis shows is the key the MIDI file would carry.
  const viaKeyDetection = detectKeyFromNotes(take!.notes);
  assert(!!viaKeyDetection, 'the take’s key is the one keyDetection itself decides');
  assertEq(analysis.keyLine, `Key: ${viaKeyDetection ? viaKeyDetection.label : ''}`, 'the window shows the same key the export writes');

  // (d) A chromatic hum: the real pipeline takes it, and the cleaning is what
  // makes it readable — with the label saying exactly what happened.
  const chromaticFrames = framesFrom([
    [60, 0.8],
    [61, 0.3],
    [64, 0.3],
    [66, 0.3],
    [67, 0.3],
  ]);
  const chromaticTake = buildCaptureTake(chromaticFrames, { capturedAt: '2026-10-03T10:01:00.000Z' });
  const chromaticAnalysis = buildMelodyAnalysis(chromaticTake);
  assert(chromaticAnalysis.notesAdjusted >= 0, 'a chromatic take is analysed without throwing');
  assert(
    chromaticAnalysis.cleanedLabel.indexOf(AUTO_CLEANED_LABEL_PREFIX) === 0 ||
      chromaticAnalysis.cleanedLabel.indexOf(RAW_SEQUENCE_LABEL) === 0,
    'and its label is either the auto-cleaned label or the honest as-hummed one',
  );
}

function main(): void {
  sequenceTests();
  cleaningTests();
  chordTests();
  takeStateTests();
  liveTraceTests();
  integrationTests();
  if (failures > 0) {
    console.error(`\n${passes} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`\n${passes} passed, 0 failed`);
}

main();
