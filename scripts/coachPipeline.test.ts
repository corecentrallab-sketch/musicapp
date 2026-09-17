/**
 * Unit tests for the practice-coach slice 2 pipeline: monophonic pitch
 * detection (src/services/pitchDetection.ts), ABC → reference notes
 * (src/services/abcToReference.ts) and the two wired together
 * (src/services/coachRecording.ts).
 *
 * Run with: npm run test:tier1
 * Compiles the pure modules + this test to CommonJS and runs under plain Node
 * (same convention as scripts/tier1.test.ts and scripts/practiceCoach.test.ts —
 * no test framework, no app runtime, no microphone).
 *
 * The audio cases are SYNTHETIC: sine tones at known MIDI pitches rendered into
 * a Float32Array at a known sample rate, with real silence between notes, so
 * every expected verdict is arithmetic rather than opinion. Nothing here needs
 * a device — the last section runs the full recording → score path end to end.
 */

import {
  detectPitchFrames,
  segmentsToPlayedNotes,
  hzToMidi,
  midiToHz,
  median,
  DEFAULT_HOP_SECONDS,
  DEFAULT_MIN_NOTE_SEC,
  DEFAULT_JITTER_CENTS,
  SILENCE_RMS_THRESHOLD,
  YIN_THRESHOLD,
  type PitchFrame,
} from '../src/services/pitchDetection';
import {
  parseAbcMelody,
  abcToReference,
  abcTempoBpm,
  keyAccidentalFor,
  DEFAULT_ABC_TEMPO_BPM,
} from '../src/services/abcToReference';
import { coachFromRecording } from '../src/services/coachRecording';
import {
  HIT_TOLERANCE_CENTS,
  NEIGHBOR_TOLERANCE_CENTS,
  type PlayedNote,
} from '../src/services/practiceCoach';

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
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function assertClose(actual: number, expected: number, tolerance: number, msg: string): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)} ±${tolerance})`,
    );
  }
}

// ─── helpers ───────────────────────────────────────────────────

const SAMPLE_RATE = 22050;

/** A sine tone at a MIDI pitch, with a 5 ms fade so there are no clicks. */
function tone(
  midi: number,
  seconds: number,
  sampleRate = SAMPLE_RATE,
  amplitude = 0.5,
): Float32Array {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const out = new Float32Array(n);
  const hz = midiToHz(midi);
  const fade = Math.max(1, Math.round(0.005 * sampleRate));
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = amplitude * env * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

function silence(seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.max(1, Math.round(seconds * sampleRate)));
}

function concatSamples(parts: Float32Array[]): Float32Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Deterministic white noise (LCG) so the noise case is reproducible. */
function noise(seconds: number, sampleRate = SAMPLE_RATE, amplitude = 0.3): Float32Array {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const out = new Float32Array(n);
  let seed = 123456789;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = amplitude * ((seed / 0x7fffffff) * 2 - 1);
  }
  return out;
}

/**
 * Render a melody into audio: one slot per entry, `beatSec` long. A non-null
 * entry sounds for the first `soundRatio` of its slot and is silent for the
 * rest (a staccato-ish performance — the silence also gives the tracker a
 * clean window between notes, exactly like a real player's articulation).
 * `null` entries are a completely empty slot (a note that was never played).
 */
function renderSlots(
  midis: Array<number | null>,
  beatSec: number,
  sampleRate = SAMPLE_RATE,
  soundRatio = 0.7,
): Float32Array {
  const parts: Float32Array[] = [];
  for (const midi of midis) {
    if (midi === null) {
      parts.push(silence(beatSec, sampleRate));
      continue;
    }
    parts.push(tone(midi, beatSec * soundRatio, sampleRate));
    parts.push(silence(beatSec * (1 - soundRatio), sampleRate));
  }
  return concatSamples(parts);
}

/** A frame timeline on a clean 25 ms grid from a script of pitch values. */
function framesFromValues(values: Array<number | null>, hopSec = DEFAULT_HOP_SECONDS): PitchFrame[] {
  return values.map((midi, i) => ({
    tSec: i * hopSec,
    midi,
    rms: midi === null ? 0 : 0.3,
  }));
}

/** A frame timeline from (pitch, duration) entries, on a 25 ms grid. */
function framesFromScript(
  entries: Array<{ midi: number | null; durSec: number }>,
  hopSec = DEFAULT_HOP_SECONDS,
): PitchFrame[] {
  const values: Array<number | null> = [];
  for (const entry of entries) {
    const count = Math.max(1, Math.round(entry.durSec / hopSec));
    for (let k = 0; k < count; k++) values.push(entry.midi);
  }
  return framesFromValues(values, hopSec);
}

const rawPercent = /\d\s*%/;

// ─── detectPitchFrames ──────────────────────────────────────────

function pitchDetectionTests(): void {
  console.log('\n— detectPitchFrames: pitches, grid, silence gate —');

  const a4 = tone(69, 0.5);
  const frames = detectPitchFrames(a4, SAMPLE_RATE);
  const hopSamples = Math.round(DEFAULT_HOP_SECONDS * SAMPLE_RATE);
  assertEq(
    frames.length,
    Math.floor((a4.length - 2048) / hopSamples) + 1,
    'one frame per hop (2048-sample window, 25 ms hop)',
  );
  assert(
    frames.every((f) => f.midi !== null),
    'a loud 440 Hz tone is pitched in every frame',
  );
  assertClose(frames[8].midi as number, 69, 0.05, '440 Hz reads as MIDI 69 (A4) to within 5 cents');
  assertClose(frames[8].rms, 0.5 / Math.SQRT2, 0.03, 'rms tracks the tone level (0.5 amplitude)');
  assertClose(frames[1].tSec - frames[0].tSec, 0.025, 0.0001, 'default hop is 25 ms');
  assertEq(frames[0].tSec, 0, 'the frame grid starts at sample 0');
  assertEq(hzToMidi(440), 69, 'hzToMidi(440) is exactly 69');
  assertEq(midiToHz(69), 440, 'midiToHz(69) is exactly 440');

  const c4 = detectPitchFrames(tone(60, 0.4), SAMPLE_RATE);
  const b4 = detectPitchFrames(tone(71, 0.4), SAMPLE_RATE);
  assertClose(median(c4.map((f) => f.midi ?? Number.NaN)), 60, 0.05, 'C4 (261.6 Hz) reads as MIDI 60');
  assertClose(median(b4.map((f) => f.midi ?? Number.NaN)), 71, 0.05, 'B4 (493.9 Hz) reads as MIDI 71');

  const quiet = detectPitchFrames(silence(0.4), SAMPLE_RATE);
  assert(quiet.every((f) => f.midi === null), 'silence produces no pitch at all');
  assert(quiet.every((f) => f.rms === 0), 'silence has zero rms');

  const belowGate = detectPitchFrames(tone(69, 0.4, SAMPLE_RATE, 0.002), SAMPLE_RATE);
  assert(
    belowGate.every((f) => f.midi === null),
    'a tone under the rms gate is reported as silence, not as a guess',
  );
  assertEq(SILENCE_RMS_THRESHOLD, 0.01, 'the documented silence gate is rms 0.01 (−40 dBFS)');
  assertEq(YIN_THRESHOLD, 0.2, 'the documented YIN threshold is 0.2');

  const coarse = detectPitchFrames(a4, SAMPLE_RATE, { hopSeconds: 0.05 });
  assertClose(coarse[1].tSec - coarse[0].tSec, 0.05, 0.0001, 'hopSeconds override is honoured');
  assert(coarse.length < frames.length, 'a coarser hop yields fewer frames');

  const narrow = detectPitchFrames(a4, SAMPLE_RATE, { minFreqHz: 400, maxFreqHz: 500 });
  assert(
    narrow.every((f) => f.midi !== null && Math.abs(f.midi - 69) < 0.1),
    'a narrow frequency range still locks 440 Hz',
  );

  const noisy = detectPitchFrames(noise(1), SAMPLE_RATE);
  const noisyPitched = noisy.filter((f) => f.midi !== null).length;
  assert(
    noisyPitched <= Math.ceil(noisy.length * 0.25),
    'noise is mostly unpitched (never a confident wrong note)',
  );

  assertEq(detectPitchFrames(tone(69, 0.01), SAMPLE_RATE).length, 0, 'a clip shorter than the window yields no frames');
  assertEq(detectPitchFrames(a4, 0).length, 0, 'a nonsense sample rate yields no frames');
  assertEq(
    detectPitchFrames([] as unknown as Float32Array, SAMPLE_RATE).length,
    0,
    'a missing buffer yields no frames rather than throwing',
  );
}

// ─── segmentsToPlayedNotes ──────────────────────────────────────

function segmentationTests(): void {
  console.log('\n— segmentsToPlayedNotes: grouping, jitter, minimum length —');

  const script = framesFromScript([
    { midi: 60, durSec: 0.475 },
    { midi: null, durSec: 0.25 },
    { midi: 64, durSec: 0.475 },
    { midi: null, durSec: 0.25 },
    { midi: 67, durSec: 0.475 },
  ]);
  const notes = segmentsToPlayedNotes(script, 120);
  assertEq(notes.length, 3, 'three sounded notes become three played notes');
  assertEq(notes[0].midi, 60, 'the first note keeps its pitch');
  assertClose(notes[1].midi, 64, 1e-9, 'the second note keeps its pitch');
  assertClose(notes[2].midi, 67, 1e-9, 'the third note keeps its pitch');
  assertClose(notes[0].startBeat, 0, 1e-9, 'the first note starts on beat 0');
  // Frame indices: 19 frames of note 1 (0…0.45 s), 10 of silence, so note 2
  // starts at frame 29 = 0.725 s = beat 1.45 at 120 bpm — the 25 ms frame grid
  // is the resolution of the onset, exactly as documented.
  assertClose(notes[1].startBeat, 1.45, 1e-9, 'a 0.725 s onset at 120 bpm is beat 1.45');
  assertClose(notes[2].startBeat, 2.9, 1e-9, 'a 1.45 s onset at 120 bpm is beat 2.9');
  assertClose(notes[0].durationBeats, 0.95, 1e-9, 'a 0.475 s note at 120 bpm is 0.95 beats long');

  const doubled = segmentsToPlayedNotes(script, 240);
  assertClose(doubled[1].startBeat, 2.9, 1e-9, 'doubling the tempo doubles every beat position');

  const fractional = segmentsToPlayedNotes(framesFromScript([{ midi: 60.3, durSec: 0.2 }]), 120);
  assertEq(fractional[0].midi, 60.3, 'sub-semitone pitch survives segmentation (not rounded)');

  const wobble = framesFromValues([60, 60.3, 60, 60.3, 60, 60.3, 60, 60.3, 60, 60.3]);
  const wobbled = segmentsToPlayedNotes(wobble, 120);
  assertEq(wobbled.length, 1, '±30 cents of wobble stays inside one note');
  assertClose(wobbled[0].midi, 60.15, 1e-9, 'the note pitch is the median of its frames');

  const stepped = framesFromValues([
    60, 60, 60, 60, 60, 60, 60, 60, 60.5, 60.5, 60.5, 60.5, 60.5, 60.5, 60.5, 60.5,
  ]);
  const split = segmentsToPlayedNotes(stepped, 120);
  assertEq(split.length, 2, 'a 50-cent jump (past the 40-cent jitter) starts a new note');
  assertEq(split[1].midi, 60.5, 'the new note keeps the new pitch');
  assertEq(DEFAULT_JITTER_CENTS, 40, 'the documented jitter allowance is ±40 cents');

  const blip = framesFromScript([
    { midi: 60, durSec: 0.475 },
    { midi: null, durSec: 0.1 },
    { midi: 64, durSec: 0.075 },
    { midi: null, durSec: 0.1 },
    { midi: 67, durSec: 0.475 },
  ]);
  const keptLarge = segmentsToPlayedNotes(blip, 120);
  assertEq(keptLarge.length, 2, 'a 0.075 s blip is dropped (under the 0.12 s minimum)');
  assertEq(DEFAULT_MIN_NOTE_SEC, 0.12, 'the documented minimum note is 0.12 s');
  const keptSmall = segmentsToPlayedNotes(blip, 120, { minNoteSec: 0.05 });
  assertEq(keptSmall.length, 3, 'lowering minNoteSec keeps the blip');

  const oneSecond = framesFromScript([{ midi: 60, durSec: 1 }]);
  const fallbackTempo = segmentsToPlayedNotes(oneSecond, 0);
  assertClose(fallbackTempo[0].durationBeats, 100 / 60, 1e-6, 'a nonsense tempo falls back to 100 bpm');

  const barred = segmentsToPlayedNotes(script, 120, { beatsPerBar: 3 });
  assertEq(barred.length, notes.length, 'beatsPerBar is accepted (reserved) without changing the timeline');
  assertClose(barred[1].startBeat, 1.45, 1e-9, 'beatsPerBar does not shift beat positions');

  assertEq(segmentsToPlayedNotes([], 120).length, 0, 'no frames means no notes');
  assertEq(
    segmentsToPlayedNotes(framesFromValues([null, null, null]), 120).length,
    0,
    'an all-silent timeline means no notes',
  );
  assertEq(
    segmentsToPlayedNotes(null as unknown as PitchFrame[], 120).length,
    0,
    'a missing frame list does not throw',
  );

  // The result is a plain PlayedNote[] — the slice-1 contract, unchanged.
  const asPlayed: PlayedNote[] = notes;
  assertEq(asPlayed.length, 3, 'segmentation returns slice-1 PlayedNote objects');
}

// ─── abcToReference ─────────────────────────────────────────────

const TWINKLE = `X:1
T:Twinkle Twinkle Little Star
C:Traditional
M:4/4
L:1/4
Q:1/4=100
K:C
C C G G | A A G2 | F F E E | D D C2 |`;

const FUR_ELISE = `X:1
T:Fur Elise (opening, simplified)
M:3/8
L:1/16
Q:3/8=60
K:Am
e ^d e ^d e B | d c A2 |`;

function abcTests(): void {
  console.log('\n— abcToReference: notes, beats, keys, lengths —');

  const twinkle = abcToReference(TWINKLE);
  assertEq(
    twinkle.map((n) => n.midi).join(','),
    '60,60,67,67,69,69,67,65,65,64,64,62,62,60',
    'Twinkle Twinkle in C reads as the right MIDI line (C4 = 60)',
  );
  assertEq(
    twinkle.map((n) => n.startBeat).join(','),
    '0,1,2,3,4,5,6,8,9,10,11,12,13,14',
    'beat positions accumulate across bar lines',
  );
  assertEq(twinkle[6].durationBeats, 2, 'G2 with L:1/4 is a half note (2 beats)');
  assertEq(twinkle[13].durationBeats, 2, 'the closing C2 is a half note (2 beats)');
  assertEq(twinkle[0].durationBeats, 1, 'a bare note takes the L: unit length (1 beat)');
  assertEq(abcTempoBpm(TWINKLE), 100, 'Q:1/4=100 is read as 100 bpm');
  assertEq(DEFAULT_ABC_TEMPO_BPM, 100, 'the documented default tempo is 100 bpm');

  const furElise = abcToReference(FUR_ELISE);
  assertEq(
    furElise.map((n) => n.midi).join(','),
    '76,75,76,75,76,71,74,72,69',
    'Für Elise opening reads E5 D#5 E5 D#5 E5 B4 D5 C5 A4',
  );
  assertEq(
    furElise.map((n) => n.startBeat).join(','),
    '0,0.25,0.5,0.75,1,1.25,1.5,1.75,2',
    '16th notes advance a quarter beat each',
  );
  assertEq(furElise[8].durationBeats, 0.5, 'A2 with L:1/16 is an eighth note (0.5 beats)');
  assertEq(abcTempoBpm(FUR_ELISE), 90, 'Q:3/8=60 (dotted quarter) means 90 quarter beats a minute');

  // Tempo forms and overrides.
  assertEq(abcTempoBpm('X:1\nK:C\nQ:1/4=120\nC'), 120, 'Q:1/4=120 → 120 bpm');
  assertEq(abcTempoBpm('X:1\nK:C\nQ:120\nC'), 120, 'a bare Q:120 → 120 bpm');
  assertEq(abcTempoBpm('X:1\nK:C\nQ:1/2=60\nC'), 120, 'Q:1/2=60 (half-note pulse) → 120 bpm');
  assertEq(abcTempoBpm('X:1\nK:C\nC'), 100, 'no Q: at all → the 100 bpm default');
  const overridden = parseAbcMelody(TWINKLE, { tempoBpm: 90 });
  assertEq(overridden.tempoBpm, 90, 'an explicit tempoBpm overrides the ABC Q:');
  assertEq(overridden.notes[1].startBeat, 1, 'overriding the tempo does not move the written beats');

  // Key signatures.
  const g = abcToReference('X:1\nM:4/4\nL:1/4\nK:G\nF B');
  assertEq(g[0].midi, 66, 'K:G makes F an F# (66)');
  assertEq(g[1].midi, 71, 'K:G leaves B natural (71)');
  assertEq(abcToReference('X:1\nL:1/4\nK:F\nB')[0].midi, 70, 'K:F makes B a Bb (70)');
  const d = abcToReference('X:1\nL:1/4\nK:D\nF C');
  assertEq(`${d[0].midi},${d[1].midi}`, '66,61', 'K:D carries F# and C#');
  const bb = abcToReference('X:1\nL:1/4\nK:Bb\nB E');
  assertEq(`${bb[0].midi},${bb[1].midi}`, '70,63', 'K:Bb carries Bb and Eb');
  assertEq(
    abcToReference('X:1\nL:1/4\nK:Am\nA C E')[0].midi,
    69,
    'K:Am has no sharps (A minor)',
  );
  const am = abcToReference('X:1\nM:3/8\nL:1/16\nK:Am\ne ^d e B');
  assertEq(`${am[0].midi},${am[1].midi},${am[3].midi}`, '76,75,71', 'a written ^ makes D#5 (75) in A minor');

  // Bar-scoped accidentals (the ABC rule).
  const barRule = abcToReference('X:1\nL:1/4\nK:C\n^F F | F');
  assertEq(
    barRule.map((n) => n.midi).join(','),
    '66,66,65',
    'an accidental holds for the rest of the bar, then the key signature returns',
  );
  const natural = abcToReference('X:1\nL:1/4\nK:G\n=F F | F');
  assertEq(
    natural.map((n) => n.midi).join(','),
    '65,65,66',
    '= cancels a key-signature sharp for the rest of the bar only',
  );
  assertEq(keyAccidentalFor({ F: 1 }, 'F'), 1, 'keyAccidentalFor reads a sharp');
  assertEq(keyAccidentalFor({}, 'F'), 0, 'keyAccidentalFor defaults to natural');

  // Rests, chords, grace notes, decorations, inline fields.
  const rested = abcToReference('X:1\nM:4/4\nL:1/4\nK:C\nC z C');
  assertEq(`${rested.length},${rested[1].startBeat}`, '2,2', 'a rest advances the beat cursor without a note');
  assertEq(abcToReference('X:1\nM:4/4\nL:1/4\nK:C\nz4 C')[0].startBeat, 4, 'a 4-beat rest pushes the next note to beat 4');
  const chord = abcToReference('X:1\nL:1/4\nK:C\n[CEG]2');
  assertEq(`${chord.length},${chord[0].midi},${chord[0].durationBeats}`, '1,60,2', 'a chord gives its first note plus the chord length');
  const grace = abcToReference('X:1\nL:1/4\nK:C\n{g}C');
  assertEq(`${grace.length},${grace[0].midi},${grace[0].startBeat}`, '1,60,0', 'grace notes add no note and no time');
  const decorated = abcToReference('X:1\nL:1/4\nK:C\n!f! C [M:4/4] D "Am" E ~F . G');
  assertEq(
    decorated.map((n) => n.midi).join(','),
    '60,62,64,65,67',
    'decorations, quoted annotations and inline fields are stripped',
  );
  assertEq(
    abcToReference('X:1\nL:1/4\nK:C\nC | D :| E')[2].startBeat,
    2,
    'repeat and bar marks advance no time',
  );
  assertEq(
    abcToReference('X:1\nL:1/4\nK:C\nC % a comment\n% whole-line comment\nD').length,
    2,
    'percent comments are ignored',
  );

  // Lengths.
  const lengths = abcToReference('X:1\nM:4/4\nL:1/8\nK:C\nC C2 C/ C/2 C3/2 C//');
  assertEq(
    lengths.map((n) => n.durationBeats).join(','),
    '0.5,1,0.25,0.25,0.75,0.125',
    'digit, slash and fractional lengths scale the L: unit',
  );
  assertEq(
    lengths.map((n) => n.startBeat).join(','),
    '0,0.5,1.5,1.75,2,2.75',
    'lengths add up into beat positions',
  );
  assertEq(
    abcToReference("X:1\nL:1/4\nK:C\nC, C c c'")
      .map((n) => n.midi)
      .join(','),
    '48,60,72,84',
    "ABC octaves: C, = C3, C = middle C, c = C5, c' = C6",
  );

  // Default unit note length (ABC rule).
  assertEq(
    parseAbcMelody('X:1\nM:4/4\nK:C\nCD').unitNoteLength.join('/'),
    '1/16',
    'M:4/4 with no L: infers a 1/16 unit note length',
  );
  assertEq(
    parseAbcMelody('X:1\nM:4/4\nK:C\nCD').notes[0].durationBeats,
    0.25,
    'the inferred 1/16 unit makes a bare note a 16th (0.25 beats)',
  );
  assertEq(
    parseAbcMelody('X:1\nM:2/4\nK:C\nCD').unitNoteLength.join('/'),
    '1/8',
    'a meter under 0.75 infers a 1/8 unit note length',
  );
  assertEq(
    parseAbcMelody('X:1\nK:C\nCD').unitNoteLength.join('/'),
    '1/8',
    'no M: and no L: → the 1/8 default',
  );
  assertEq(parseAbcMelody('X:1\nK:C\nCD').meter.join('/'), '4/4', 'no M: → the 4/4 default');

  // Overrides + ties + tuplets.
  const meterOverride = parseAbcMelody('X:1\nK:C\nCD', { meter: [2, 4] });
  assertEq(meterOverride.meter.join('/'), '2/4', 'the meter override is reported back');
  assertEq(meterOverride.unitNoteLength.join('/'), '1/8', 'the meter override feeds the unit-length rule');
  assertEq(meterOverride.notes[1].startBeat, 0.5, 'the override changes the implied note lengths');
  const tied = abcToReference('X:1\nM:4/4\nL:1/4\nK:C\nC- C');
  assertEq(`${tied.length},${tied[0].durationBeats},${tied[0].startBeat}`, '1,2,0', 'a tie extends the previous note');
  const tiedAcross = abcToReference('X:1\nM:4/4\nL:1/4\nK:C\nC- D');
  assertEq(tiedAcross.length, 2, 'a tie to a different pitch is still two notes');
  const triplet = abcToReference('X:1\nM:4/4\nL:1/8\nK:C\n(3 C D E F');
  assertEq(
    triplet.slice(0, 3).map((n) => n.durationBeats).join(','),
    '0.3333,0.3333,0.3333',
    'a (3 triplet scales its three notes by 2/3',
  );
  assertEq(triplet[3].startBeat, 1, 'the beat cursor is exact after a triplet');

  // Unusable input is never a crash.
  for (const bad of ['', '   \n  ', '%%score {1 2}', '% only a comment', 'T:no music here'] as const) {
    assertEq(abcToReference(bad).length, 0, `unusable ABC (${JSON.stringify(bad.slice(0, 12))}) yields no notes`);
  }
  assertEq(abcToReference(null as unknown as string).length, 0, 'a null tune does not throw');
  assertEq(parseAbcMelody(undefined as unknown as string).tempoBpm, 100, 'a missing tune still reports a tempo');
}

// ─── coachFromRecording (end to end) ────────────────────────────

const COACH_ABC_120 = `X:1
T:Coach pipeline test
M:4/4
L:1/4
Q:1/4=120
K:C
C D E F |`;

const COACH_ABC_3 = `X:1
M:4/4
L:1/4
Q:1/4=120
K:C
C D E |`;

function recordingTests(): void {
  console.log('\n— coachFromRecording: recording → notes → score → feedback —');

  const beatSec = 0.5; // 120 bpm
  // A reference-perfect take of C D E F, played exactly in time.
  const perfect = coachFromRecording({
    samples: renderSlots([60, 62, 64, 65], beatSec),
    sampleRate: SAMPLE_RATE,
    abc: COACH_ABC_120,
  });
  assertEq(perfect.tempoBpm, 120, 'the tempo comes from the ABC Q: when the caller has none');
  assertEq(perfect.reference.length, 4, 'the ABC yields four reference notes');
  assertEq(perfect.played.length, 4, 'the recording yields four played notes');
  assertEq(perfect.score.accuracyPct, 100, 'a reference-perfect take scores 100');
  assertEq(
    perfect.score.verdicts.filter((v) => v.status === 'hit').length,
    4,
    'every written note is a clean hit',
  );
  assertEq(perfect.score.verdicts[0].refMidi, 60, 'the verdicts carry the written pitch for the copy');
  assertEq(perfect.frames.length > 0, true, 'the raw pitch frames are returned for the UI');
  assert(perfect.feedback.headline.length > 0, 'feedback copy comes back with the score');
  assert(
    !rawPercent.test(perfect.feedback.headline) &&
      perfect.feedback.lines.every((l) => !rawPercent.test(l)),
    'no raw percentage leaks into user-facing feedback',
  );

  // Tempo override wins over the ABC.
  const override = coachFromRecording({
    samples: renderSlots([60, 62], beatSec),
    sampleRate: SAMPLE_RATE,
    abc: COACH_ABC_120,
    tempoBpm: 60,
  });
  assertEq(override.tempoBpm, 60, 'an explicit tempoBpm wins over the ABC Q:');
  assertEq(override.reference[1].startBeat, 1, 'the written beats are tempo-independent');
  assertClose(override.played[1].startBeat, 0.5, 0.1, 'the played beats follow the caller tempo (0.5 s = half a beat at 60 bpm)');

  // One note 70 cents flat, and the last note never played.
  // Slice 1's shipped metric: (hits + 0.5 × halfCredit) / reference.length, and
  // a 'flat' note is half credit — so 1 hit + 1 flat + 1 missed = (1+0.5)/3 = 50.
  const flatTake = coachFromRecording({
    samples: renderSlots([60, 62 - 0.7, null], beatSec),
    sampleRate: SAMPLE_RATE,
    abc: COACH_ABC_3,
  });
  assertEq(flatTake.reference.length, 3, 'the degraded take still has a three-note reference');
  assertEq(flatTake.played.length, 2, 'the un-played slot produces no played note');
  assertEq(flatTake.score.verdicts[0].status, 'hit', 'the in-tune note is a hit');
  assertEq(flatTake.score.verdicts[1].status, 'flat', 'a note 70 cents low is reported as flat');
  assertEq(flatTake.score.verdicts[2].status, 'missed', 'a note that was never played is reported as missed');
  const centsOff = flatTake.score.verdicts[1].centsOff ?? 0;
  assert(centsOff < 0, 'the flat verdict keeps the direction of the error (negative cents)');
  assertClose(centsOff, -70, 20, 'the reported error is about 70 cents low');
  assert(
    Math.abs(centsOff) > HIT_TOLERANCE_CENTS && Math.abs(centsOff) <= NEIGHBOR_TOLERANCE_CENTS,
    "70 cents is past slice 1's ±35-cent hit band but inside its ±120-cent note band — hence flat, not hit",
  );
  assertEq(flatTake.score.accuracyPct, 50, 'one hit + one flat + one missed scores 50');
  assert(
    flatTake.feedback.headline.length > 0 && !rawPercent.test(flatTake.feedback.headline),
    'the degraded take still gets banded, percentage-free feedback',
  );
  assert(
    flatTake.feedback.lines.every((line) => line.length > 0),
    'every feedback line is real copy (slice 1 owns the wording)',
  );

  // Hit + flat is 75 under slice 1's half-credit arithmetic (documents the metric).
  const halfCredit = coachFromRecording({
    samples: renderSlots([60, 62 - 0.7], beatSec),
    sampleRate: SAMPLE_RATE,
    abc: COACH_ABC_3.replace('C D E |', 'C D |'),
  });
  assertEq(halfCredit.played.length, 2, 'both slots sounded');
  assertEq(halfCredit.score.accuracyPct, 75, 'a 50/50 hit/flat take scores 75 (hits + half credit)');
  assert(
    /flat/i.test(halfCredit.feedback.lines.join(' ')),
    'feedback names the flat note for the player when it is the main issue',
  );

  // Silence is honest, not a crash.
  const empty = coachFromRecording({
    samples: silence(1),
    sampleRate: SAMPLE_RATE,
    abc: COACH_ABC_120,
  });
  assertEq(empty.played.length, 0, 'a silent recording plays nothing back');
  assertEq(empty.reference.length, 4, 'the reference is still there to aim at');
  assertEq(empty.score.accuracyPct, 0, 'nothing heard scores 0, not 100');
  assertEq(
    empty.score.verdicts.filter((v) => v.status === 'missed').length,
    4,
    'every written note is reported as missed (nothing was heard)',
  );
  assert(
    empty.feedback.headline.length > 0 && !rawPercent.test(empty.feedback.headline),
    'a silent take still gets banded, percentage-free feedback',
  );

  const noMusic = coachFromRecording({
    samples: renderSlots([60, 62], beatSec),
    sampleRate: SAMPLE_RATE,
    abc: '',
  });
  assertEq(noMusic.reference.length, 0, 'a tune with no music yields no reference');
  assertEq(noMusic.played.length, 2, 'the performance is still transcribed without a reference');
  assertEq(noMusic.tempoBpm, 100, 'no Q: and no caller tempo → the 100 bpm default');
  assertEq(noMusic.score.accuracyPct, 0, 'extras alone never score');

  const nothingAtAll = coachFromRecording({
    samples: silence(1),
    sampleRate: SAMPLE_RATE,
    abc: '',
  });
  assertEq(
    nothingAtAll.feedback.headline,
    'Nothing to score yet.',
    'no reference and nothing heard gets the honest empty-feedback copy',
  );

  const nonsense = coachFromRecording({
    samples: null as unknown as Float32Array,
    sampleRate: 0,
    abc: null as unknown as string,
  });
  assertEq(nonsense.played.length, 0, 'a nonsense recording does not throw');
  assertEq(nonsense.score.accuracyPct, 0, 'a nonsense recording scores 0');
}

// ─── run ────────────────────────────────────────────────────────

try {
  pitchDetectionTests();
  segmentationTests();
  abcTests();
  recordingTests();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: the pipeline tests threw', err);
}

console.log(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
