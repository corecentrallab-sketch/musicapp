/**
 * incrementalNotes.test.ts — THE STREAMING READ'S FIRST INCREMENT, PINNED.
 *
 * WHAT THIS SUITE IS FOR. `src/services/incrementalNotes.ts` lets the coach read turn a
 * growing stream of pitch frames into notes as they close, instead of waiting for the whole
 * frame list. That is only safe if it produces THE SAME MELODY the batch read produces —
 * otherwise the streaming screen would draw a different take from the one Export MIDI writes
 * and History stores. So the centre of this suite is one equality, asserted at six chunk
 * sizes, plus the invariants a streaming UI depends on:
 *
 *   1. SAME NOTES AS THE BATCH READ — fed all at once, in 1s, 2s, 3s, 7s, 50s and 97s.
 *   2. NOTES ARE FINAL — a note already emitted never changes when more frames arrive, and
 *      what is on screen at any moment is a PREFIX of the batch read of the frames so far.
 *   3. THE OPEN NOTE IS HELD BACK — the note still sounding is not emitted until a frame
 *      closes it (a different pitch, a silent frame) or `flush()` ends the stream. This is
 *      what stops a half-second note being drawn, deleted and redrawn.
 *   4. THE HONEST CASES SURVIVE — silence ends a note, a sub-0.12 s blip is never a note, a
 *      one-frame take is no melody, an empty chunk changes nothing, and `flush()` is
 *      idempotent.
 *   5. THE GRID — the hop is inferred from the frames when it is not given, an override is
 *      honoured, and the module stays free of react-native / expo so it can run in the gate.
 *
 * Plain Node, no react-native, no network, no timers. Run with: npm run test:tier1
 */
import { createIncrementalNoteReader } from '../src/services/incrementalNotes';
import { framesToMidiNotes } from '../src/services/midiExport';
import type { PitchFrame } from '../src/services/pitchDetection';

declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

let passes = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passes += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ✗ FAILED: ${label}`);
  }
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, a === b ? label : `${label} — got ${a}, wanted ${b}`);
}

const HOP = 0.025;

/** One segment of the synthetic take: a pitch held for N frames, or N frames of silence. */
interface Segment {
  midi: number | null;
  frames: number;
  /** Detune in semitones, applied as a slow wobble so the median has something to do. */
  wobble?: number;
}

/** Build a frame grid exactly as `detectPitchFrames` lays one out (constant hop from 0). */
function makeFrames(segments: Segment[]): PitchFrame[] {
  const frames: PitchFrame[] = [];
  for (const segment of segments) {
    for (let i = 0; i < segment.frames; i++) {
      const index = frames.length;
      const wobble = segment.wobble ?? 0;
      const midi =
        segment.midi === null
          ? null
          : segment.midi + wobble * Math.sin(index / 3);
      frames.push({
        tSec: Math.round(index * HOP * 1000) / 1000,
        midi,
        rms: segment.midi === null ? 0.001 : 0.2,
      });
    }
  }
  return frames;
}

/** Feed `frames` in chunks of `size` and return the reader, flushed at the end. */
function readInChunks(frames: PitchFrame[], size: number, hopSeconds?: number) {
  const reader = createIncrementalNoteReader(hopSeconds ? { hopSeconds } : {});
  for (let i = 0; i < frames.length; i += size) {
    reader.push(frames.slice(i, i + size));
  }
  reader.flush();
  return reader;
}

/**
 * A take with everything the rules care about: a held note, a silent gap, a repeated
 * pitch, a sub-threshold blip, a long note, a legato-ish wobble and a silent tail.
 */
const TAKE = makeFrames([
  { midi: 69, frames: 20 }, // 0.50 s A4
  { midi: null, frames: 4 }, // silence ends it
  { midi: 71, frames: 16 }, // 0.40 s B4
  { midi: 72, frames: 2 }, // 0.05 s blip — never a note
  { midi: 74, frames: 40, wobble: 0.18 }, // 1.00 s D5 with vibrato
  { midi: 74, frames: 24 }, // same pitch: one note, not two
  { midi: null, frames: 10 },
]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE SAME NOTES AS THE BATCH READ
// ─────────────────────────────────────────────────────────────────────────────

function testSameMelodyAsTheBatchRead(): void {
  console.log('\n1. the streamed read is the batch read');
  const batch = framesToMidiNotes(TAKE);
  assert(batch.length === 3, `the batch read of this take is 3 notes (got ${batch.length})`);

  for (const size of [TAKE.length, 1, 2, 3, 7, 50, 97]) {
    const reader = readInChunks(TAKE, size);
    equal(reader.notes, batch, `chunks of ${size} produce the batch read's notes, exactly`);
  }

  // A second, longer take: repeated pitches, a very long note and a silent tail.
  const long = makeFrames([
    { midi: 60, frames: 60 },
    { midi: 62, frames: 30, wobble: 0.2 },
    { midi: 62, frames: 60 },
    { midi: null, frames: 20 },
    { midi: 67, frames: 200, wobble: 0.25 },
    { midi: null, frames: 40 },
  ]);
  const longBatch = framesToMidiNotes(long);
  for (const size of [long.length, 1, 13, 64, 500]) {
    equal(readInChunks(long, size).notes, longBatch, `a ${long.length}-frame take matches in chunks of ${size}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. NOTES ARE FINAL — what is drawn early is a prefix of the finished take
// ─────────────────────────────────────────────────────────────────────────────

function testNotesAreFinal(): void {
  console.log('\n2. an emitted note never changes');
  const reader = createIncrementalNoteReader();
  const seen: PitchFrame[] = [];
  let prefixHeld = true;
  let emittedMonotonic = true;
  let previousCount = 0;

  for (let i = 0; i < TAKE.length; i += 5) {
    const chunk = TAKE.slice(i, i + 5);
    reader.push(chunk);
    seen.push(...chunk);

    const batchSoFar = framesToMidiNotes(seen);
    // Every note on screen now is the first N of the batch read of what has arrived.
    if (JSON.stringify(batchSoFar.slice(0, reader.notes.length)) !== JSON.stringify(reader.notes)) {
      prefixHeld = false;
    }
    if (reader.notes.length < previousCount) emittedMonotonic = false;
    previousCount = reader.notes.length;
  }

  assert(prefixHeld, 'after every chunk, the notes drawn so far are a prefix of the batch read of that chunk');
  assert(emittedMonotonic, 'the note count never goes backwards as the take streams in');

  reader.flush();
  equal(reader.notes, framesToMidiNotes(TAKE), 'and the finished stream equals the batch read');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE OPEN NOTE IS HELD BACK
// ─────────────────────────────────────────────────────────────────────────────

function testOpenNoteIsHeld(): void {
  console.log('\n3. the note still sounding is held back');
  const held = makeFrames([{ midi: 69, frames: 40 }]);
  const reader = createIncrementalNoteReader();
  const emitted = reader.push(held);

  assert(emitted.length === 0, 'a chunk that ends mid-note emits nothing');
  assert(reader.notes.length === 0, 'and nothing is on screen yet');
  assert(reader.openStartSec === 0, 'the note in progress is reported at its own start time');

  const closed = reader.flush();
  assert(closed.length === 1, 'flush() closes the note the stream ended on');
  assert(closed[0].startSec === 0, 'the closed note keeps the onset it started at');
  assert(Math.abs(closed[0].durationSec - 1.0) < 1e-9, `its length runs to the last frame plus one hop (${closed[0].durationSec}s)`);
  assert(reader.openStartSec === null, 'and no note is open afterwards');
  equal(reader.notes, framesToMidiNotes(held), 'the flushed read equals the batch read of the same frames');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE HONEST CASES
// ─────────────────────────────────────────────────────────────────────────────

function testHonestCases(): void {
  console.log('\n4. silence, blips, empty and repeated flushes');

  // Silence ends the note without waiting for the stream to end.
  const gap = makeFrames([{ midi: 69, frames: 20 }, { midi: null, frames: 1 }]);
  const gapReader = createIncrementalNoteReader();
  gapReader.push(gap);
  assert(gapReader.notes.length === 1, 'a silent frame closes the note before the stream ends');
  assert(gapReader.openStartSec === null, 'and leaves no note open');

  // A blip shorter than 0.12 s is never promoted to a note.
  const blip = makeFrames([{ midi: 72, frames: 2 }]);
  const blipReader = readInChunks(blip, 1);
  assert(blipReader.notes.length === 0, 'a 0.05 s blip is not a note');
  equal(blipReader.notes, framesToMidiNotes(blip), 'and the batch read agrees it is not a note');

  // A one-frame take is no melody at all (duration = one hop, under the floor).
  const single = makeFrames([{ midi: 69, frames: 1 }]);
  assert(readInChunks(single, 1).notes.length === 0, 'a one-frame take yields no note');
  equal(readInChunks(single, 1).notes, framesToMidiNotes(single), 'and matches the batch read');

  // An empty chunk changes nothing and does not throw.
  const emptyReader = createIncrementalNoteReader();
  const fromEmpty = emptyReader.push([]);
  assert(fromEmpty.length === 0 && emptyReader.notes.length === 0, 'an empty chunk emits nothing');
  assert(emptyReader.flush().length === 0, 'flushing an empty reader emits nothing');

  // Flush is idempotent: the second call cannot duplicate the last note.
  const onceReader = createIncrementalNoteReader();
  onceReader.push(makeFrames([{ midi: 69, frames: 20 }, { midi: null, frames: 1 }]));
  onceReader.flush();
  const countAfterFirst = onceReader.notes.length;
  onceReader.flush();
  assert(onceReader.notes.length === countAfterFirst, 'a second flush() does not duplicate a note');

  // A non-finite pitch is silence, exactly as in the batch read.
  const broken: PitchFrame[] = [
    { tSec: 0, midi: 69, rms: 0.2 },
    { tSec: 0.025, midi: Number.NaN, rms: 0.2 },
    { tSec: 0.05, midi: 69, rms: 0.2 },
  ];
  equal(readInChunks(broken, 2).notes, framesToMidiNotes(broken), 'a NaN pitch reads as silence in both');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE GRID, AND THE MODULE'S PURITY
// ─────────────────────────────────────────────────────────────────────────────

function testTheGrid(): void {
  console.log('\n5. the frame grid');
  const inferred = createIncrementalNoteReader();
  inferred.push(TAKE.slice(0, 10));
  assert(inferred.hopSeconds === HOP, `the hop is measured from the frames (${inferred.hopSeconds}s)`);

  const fresh = createIncrementalNoteReader();
  assert(fresh.hopSeconds === 0.025, 'before any frame, the hop is the tracker default (25 ms)');

  const overridden = createIncrementalNoteReader({ hopSeconds: 0.01 });
  assert(overridden.hopSeconds === 0.01, 'an explicit hop is used as given');
  overridden.push(makeFrames([{ midi: 69, frames: 20 }, { midi: null, frames: 1 }]));
  const overriddenBatch = framesToMidiNotes(makeFrames([{ midi: 69, frames: 20 }, { midi: null, frames: 1 }]), {
    hopSeconds: 0.01,
  });
  equal(overridden.notes, overriddenBatch, 'and the same override on the batch read agrees');

  // A nonsense hop is rejected the way the batch read rejects it.
  const nonsense = createIncrementalNoteReader({ hopSeconds: -5 });
  nonsense.push(TAKE.slice(0, 4));
  assert(nonsense.hopSeconds === HOP, 'a negative hop is ignored, not used');

  const counted = createIncrementalNoteReader();
  counted.push(TAKE.slice(0, 12));
  assert(counted.frameCount === 12, 'frames are counted as they arrive');
  assert(counted.lastTimeSec === TAKE[11].tSec, 'the last frame time is reported for progress');
}

function testTheModuleStaysPure(): void {
  console.log('\n6. the module can run in the gate');
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'services', 'incrementalNotes.ts'),
    'utf8',
  ) as string;
  // Import SPECIFIERS, not the words: the module's own header explains that it has no
  // react-native import, and a substring check would fail on its own documentation.
  assert(!/from\s+['"]react-native['"]/.test(source), 'no react-native import');
  assert(!/require\(\s*['"]react-native['"]/.test(source), 'no react-native require');
  assert(!/from\s+['"]expo/.test(source), 'no expo import');
  assert(!/from\s+['"]react['"]/.test(source), 'no react import');
  assert(source.indexOf('setTimeout') < 0, 'no timers — the caller owns when to read');
  assert(
    source.indexOf('export function createIncrementalNoteReader') >= 0,
    'and the reader is the module’s public surface',
  );
}

function main(): void {
  testSameMelodyAsTheBatchRead();
  testNotesAreFinal();
  testOpenNoteIsHeld();
  testHonestCases();
  testTheGrid();
  testTheModuleStaysPure();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
