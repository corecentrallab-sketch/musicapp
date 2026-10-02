/**
 * Tests for MIDI export Batch A (owner backlog b1b8f380 / 33e1e7d4):
 * "Export MIDI" for a hum/whistle/sing capture + Krumhansl–Schmuckler key
 * detection on captures and library scores.
 *
 * The encoder is validated STRUCTURALLY, not by round-tripping through itself:
 * this script contains its OWN independent Standard MIDI File reader (chunk
 * walker, variable-length delta decoder, meta/note-event decoder) and checks the
 * bytes the product writes against the SMF spec and against the take's real
 * timings. A self-consistent encoder that wrote a malformed file would fail
 * here and in a DAW rather than pass.
 *
 * Sections:
 *   1. frames → notes: real onsets/durations, semitone quantization, honesty;
 *   2. SMF bytes: MThd, Type 1, division, chunk lengths, event decoding;
 *   3. real timings survive (no beat-grid quantization), tempo/time-sig/key-sig;
 *   4. the reserved (empty) chord track — Type 1 multi-track from the start;
 *   5. empty input → honest no-export (null, never an empty "success");
 *   6. key detection: Krumhansl–Schmuckler on known tonal examples, thin input
 *      → null, key signatures, the library-score (ABC) path, and the take's own
 *      detected key landing in the file's FF 59 02 sf mi bytes;
 *   7. base64 + file naming helpers;
 *   8. LIVE SCAN of the real screens AND the device export path, with mutation
 *      probes that must FAIL the wiring contracts (a guard that only ever sees
 *      healthy source proves nothing) — including the detected-key threading and
 *      the key caption on both surfaces.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  DEFAULT_TICKS_PER_QUARTER,
  MIDI_EXPORT_BUSY_LABEL,
  MIDI_EXPORT_LABEL,
  MIDI_FORMAT_TYPE_1,
  MIDI_NO_MELODY_MESSAGE,
  RESERVED_CHORD_TRACK_NAME,
  buildCaptureTake,
  captureTakeLabel,
  encodeMidiFile,
  exportedMidiMessage,
  framesToMidiNotes,
  midiBytesToBase64,
  midiFileName,
} from '../src/services/midiExport';
import {
  MIN_TOTAL_WEIGHT,
  detectKeyFromAbc,
  detectKeyFromHistogram,
  detectKeyFromNotes,
  detectKeyFromPitchFrames,
  histogramFromPitchFrames,
  keyCaption,
  keySignatureFor,
  pitchClassHistogram,
  pitchClassName,
  rankKeys,
} from '../src/services/keyDetection';
import {
  historyRowOffersMidiExport,
  humExportConsumesRecordedTake,
  humResultCardOffersMidiExport,
  humTakeReachesSurface,
  midiExportSurfacesOutcome,
  rendersDetectedKey,
  takeExportThreadsDetectedKey,
} from '../src/services/midiExportContract';
import {
  MIDI_EXPORT_LABEL_IDENTIFIER,
  RESULT_SURFACE_PATH,
} from '../src/services/midiExportContract';
import type { PitchFrame } from '../src/services/pitchDetection';

declare const process: { exit(code: number): never; cwd(): string };
declare const require: (moduleName: string) => any;

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
    console.error(`  ✗ FAILED: ${msg} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(
      `  ✗ FAILED: ${msg} (expected ${expected} ±${tol}, got ${String(actual)})`,
    );
  }
}

// ─── an INDEPENDENT Standard MIDI File reader ───────────────────

interface RawEvent {
  delta: number;
  tick: number;
  kind: 'meta' | 'note';
  /** meta */
  metaType?: number;
  data?: number[];
  /** note */
  noteOn?: boolean;
  channel?: number;
  midi?: number;
  velocity?: number;
}

interface RawTrack {
  id: string;
  declaredLength: number;
  events: RawEvent[];
  endOfTrackSeen: boolean;
  bytesConsumed: number;
  /** delta-times as they appear in the file, in order. */
  deltas: number[];
  noteEvents: RawEvent[];
}

interface RawFile {
  id: string;
  headerLength: number;
  format: number;
  trackCount: number;
  division: number;
  tracks: RawTrack[];
  totalBytes: number;
}

function readVarLen(bytes: Uint8Array, at: number): { value: number; next: number } {
  let value = 0;
  let cursor = at;
  for (let i = 0; i < 4; i++) {
    const byte = bytes[cursor++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: cursor };
  }
  throw new Error(`unterminated variable-length quantity at byte ${at}`);
}

function parseSmf(bytes: Uint8Array): RawFile {
  if (bytes.length < 14) throw new Error('file shorter than an SMF header');
  const id = ascii(bytes, 0, 4);
  const headerLength = u32(bytes, 4);
  const format = u16(bytes, 8);
  const trackCount = u16(bytes, 10);
  const division = u16(bytes, 12);

  let offset = 8 + headerLength;
  const tracks: RawTrack[] = [];
  while (offset < bytes.length) {
    const trackId = ascii(bytes, offset, 4);
    const declaredLength = u32(bytes, offset + 4);
    const start = offset + 8;
    const end = start + declaredLength;
    if (end > bytes.length) throw new Error('track chunk runs past the end of the file');

    const events: RawEvent[] = [];
    const deltas: number[] = [];
    let cursor = start;
    let tick = 0;
    let endOfTrackSeen = false;

    while (cursor < end) {
      const { value: delta, next } = readVarLen(bytes, cursor);
      cursor = next;
      const status = bytes[cursor++];
      if (status === 0xff) {
        const metaType = bytes[cursor++];
        const lengthRead = readVarLen(bytes, cursor);
        cursor = lengthRead.next;
        const data = Array.from(bytes.slice(cursor, cursor + lengthRead.value));
        cursor += lengthRead.value;
        deltas.push(delta);
        tick += delta;
        events.push({ delta, tick, kind: 'meta', metaType, data });
        if (metaType === 0x2f) {
          endOfTrackSeen = true;
          break;
        }
        continue;
      }
      const kind = status & 0xf0;
      if (kind === 0x90 || kind === 0x80) {
        const midi = bytes[cursor++];
        const velocity = bytes[cursor++];
        deltas.push(delta);
        tick += delta;
        events.push({
          delta,
          tick,
          kind: 'note',
          noteOn: kind === 0x90 && velocity > 0,
          channel: status & 0x0f,
          midi,
          velocity,
        });
        continue;
      }
      throw new Error(`unexpected status byte 0x${status.toString(16)} at byte ${cursor - 1}`);
    }

    tracks.push({
      id: trackId,
      declaredLength,
      events,
      endOfTrackSeen,
      bytesConsumed: cursor - start,
      deltas,
      noteEvents: events.filter((e) => e.kind === 'note'),
    });
    offset = end;
  }

  return { id, headerLength, format, trackCount, division, tracks, totalBytes: bytes.length };
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i]);
  return out;
}

/** The first meta event of `type` in a track (or null). */
function metaEvent(track: RawTrack, type: number): RawEvent | null {
  return track.events.find((e) => e.kind === 'meta' && e.metaType === type) ?? null;
}

/**
 * The raw `FF 59 02 sf mi` quartet read straight out of a track's CHUNK BYTES —
 * not through the parser. The key signature is a claim about the file the user
 * opens in a DAW, so the bytes are what gets asserted: the sf byte is signed
 * (a flat key is its two's-complement byte).
 */
function rawKeySignatureOfTrack(bytes: Uint8Array, trackIndex: number): number[] | null {
  let chunkAt = 8 + u32(bytes, 4); // MThd: 4 id + 4 length + 6 data
  for (let i = 0; i < trackIndex; i++) chunkAt += 8 + u32(bytes, chunkAt + 4);
  const start = chunkAt + 8;
  const end = start + u32(bytes, chunkAt + 4);
  for (let i = start; i + 4 < end; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 0x02) {
      return [bytes[i + 3], bytes[i + 4]];
    }
  }
  return null;
}

/** The conductor track's raw key-signature bytes (track 0). */
function rawConductorKeySignature(bytes: Uint8Array): number[] | null {
  return rawKeySignatureOfTrack(bytes, 0);
}

// ─── fixtures ───────────────────────────────────────────────────

/** A pitch frame at `tSec` with `midi` (null = unvoiced/silence). */
function frame(tSec: number, midi: number | null, rms = 0.2): PitchFrame {
  return { tSec, midi, rms: midi === null ? 0.0005 : rms };
}

/** A hummed/whistled note: `count` frames from `start`, `hop` apart. */
function heldFrames(start: number, count: number, midi: number, hop = 0.025): PitchFrame[] {
  const out: PitchFrame[] = [];
  for (let i = 0; i < count; i++) out.push(frame(start + i * hop, midi));
  return out;
}

/** The take the tests export: C4 (1.0 s), 0.1 s breath, E4 (1.0 s). */
function twoNoteTake(): PitchFrame[] {
  return [
    ...heldFrames(0, 40, 60.2),
    frame(1.0, null),
    frame(1.025, null),
    frame(1.05, null),
    frame(1.075, null),
    ...heldFrames(1.1, 40, 64.4),
  ];
}

/**
 * A C-major fragment whose NOTES carry enough weight (5 notes × 1.0 s ≥ the
 * key-finder's honesty floor) for the take itself to hold a detected key. The
 * two-note fixture deliberately yields `key: null` (two notes are not a key),
 * so it cannot exercise the key path at all.
 */
function keyedTakeFrames(): PitchFrame[] {
  const degrees = [60, 62, 64, 65, 67]; // C D E F G
  const frames: PitchFrame[] = [];
  degrees.forEach((midi, index) => frames.push(...heldFrames(index * 1.1, 40, midi)));
  return frames;
}

function expectedTicks(seconds: number, tempoBpm: number, division: number): number {
  return Math.round((seconds * tempoBpm * division) / 60);
}

// ─── 1. frames → notes ──────────────────────────────────────────

function frameToNoteTests(): void {
  console.log('\nthe captured take: frames → notes with the take’s own timings');

  const notes = framesToMidiNotes(twoNoteTake());
  assertEq(notes.length, 2, 'two held pitches separated by a breath → exactly two notes');
  assertEq(notes[0]?.midi, 60, 'a 60.2-frame run quantizes to MIDI 60 (semitone rounding)');
  assertClose(notes[0]?.startSec ?? -1, 0, 1e-9, 'the first note starts at the first frame’s own time (0 s)');
  assertClose(notes[0]?.durationSec ?? -1, 1.0, 1e-6, 'the first note lasts 1.0 s (40 frames of 25 ms)');
  assertEq(notes[1]?.midi, 64, 'the second run is MIDI 64 (E4), not the first note’s pitch');
  assertClose(notes[1]?.startSec ?? -1, 1.1, 1e-6, 'the second note starts at 1.1 s — after the breath, not on a beat grid');
  assertClose(notes[1]?.durationSec ?? -1, 1.0, 1e-6, 'the second note lasts 1.0 s');
  assertEq(notes[0]?.velocity, 90, 'notes carry the monophonic-voice velocity');

  // A drift ACROSS a semitone boundary starts a new note; a microtonally flat
  // take still lands on the nearest semitone.
  const glide = [...heldFrames(0, 40, 60.1), ...heldFrames(1.0, 40, 60.6)];
  const glideNotes = framesToMidiNotes(glide);
  assertEq(glideNotes.length, 2, 'a drift across the semitone boundary is two notes (not one wide smear)');
  assertEq(glideNotes[0]?.midi, 60, 'a flat frame run rounds to its nearest semitone');
  assertEq(glideNotes[1]?.midi, 61, 'a 60-cent-sharp frame run rounds up to the next semitone');

  // A voice take with a blip must not grow a note out of it.
  const blip = [...heldFrames(0, 2, 72), ...heldFrames(0.2, 40, 60)];
  const blipNotes = framesToMidiNotes(blip);
  assertEq(blipNotes.length, 1, 'a 50 ms blip (below the 0.12 s floor) is not a note');
  assertEq(blipNotes[0]?.midi, 60, 'the surviving note is the real one');

  // Silence only → no notes, never a fabricated note.
  assertEq(framesToMidiNotes([frame(0, null), frame(0.025, null)]).length, 0, 'silence yields no notes');
  assertEq(framesToMidiNotes([]).length, 0, 'an empty frame list yields no notes');
  assertEq(framesToMidiNotes(null).length, 0, 'a missing frame list yields no notes');
  assertEq(
    framesToMidiNotes([frame(0, 60), frame(0.025, 64)]).length,
    0,
    'two isolated frames (under the note floor) yield no notes — an honest miss',
  );
}

// ─── 2. SMF structure ───────────────────────────────────────────

function smfStructureTests(): void {
  console.log('\nthe Standard MIDI File: header, chunks and events decode cleanly');

  const take = buildCaptureTake(twoNoteTake(), { tempoBpm: 120, capturedAt: '2026-09-30T00:00:00.000Z' });
  assert(take !== null, 'the two-note take produces a take');
  const bytes = encodeMidiFile({ notes: take!.notes, tempoBpm: take!.tempoBpm, key: take!.key, title: 'Für Elise' });
  assert(bytes !== null, 'the take encodes to bytes');
  const file = parseSmf(bytes!);

  assertEq(file.id, 'MThd', 'the file opens with the MThd header chunk');
  assertEq(file.headerLength, 6, 'the header chunk declares its standard 6 data bytes');
  assertEq(file.format, MIDI_FORMAT_TYPE_1, 'the file is SMF format 1 (multi-track)');
  assertEq(file.trackCount, 3, 'three tracks: conductor + melody + reserved chord track');
  assertEq(file.tracks.length, 3, 'all three track chunks are present in the bytes');
  assertEq(file.division, DEFAULT_TICKS_PER_QUARTER, 'the division is 480 ticks per quarter note');
  assertEq(file.totalBytes, bytes!.length, 'the reader consumed exactly the encoded byte count');

  for (const [index, track] of file.tracks.entries()) {
    assertEq(track.id, 'MTrk', `track ${index} is an MTrk chunk`);
    assertEq(
      track.bytesConsumed,
      track.declaredLength,
      `track ${index}’s declared length matches the bytes it holds`,
    );
    assertEq(track.endOfTrackSeen, true, `track ${index} ends with an end-of-track meta event`);
    assert(
      track.events.length > 0 && track.events[track.events.length - 1].metaType === 0x2f,
      `track ${index}’s last event is the end-of-track (nothing follows it)`,
    );
    assert(
      track.deltas.every((d) => Number.isFinite(d) && d >= 0),
      `track ${index}’s delta-times are all non-negative`,
    );
  }

  const conductor = file.tracks[0];
  const melody = file.tracks[1];

  const tempo = metaEvent(conductor, 0x51);
  assert(tempo !== null, 'the conductor track carries a tempo meta event');
  assertEq(tempo!.data?.length, 3, 'the tempo event is the standard 3-byte microseconds-per-quarter');
  const micros = ((tempo!.data![0] << 16) | (tempo!.data![1] << 8) | tempo!.data![2]) >>> 0;
  assertClose(Math.round(60000000 / micros), 120, 0, 'the tempo decodes to the 120 bpm the take was written with');

  const timeSig = metaEvent(conductor, 0x58);
  assertEq(timeSig?.data?.[0], 4, 'the time signature numerator is 4');
  assertEq(timeSig?.data?.[1], 2, 'the time signature denominator byte is 2 (a quarter note)');
  assertEq(timeSig?.data?.[3], 8, 'the 32nd-notes-per-quarter byte is the SMF convention 8');

  assertEq(melody.noteEvents.length, 4, 'the melody track carries 2 notes as 4 note events');
  assertEq(melody.noteEvents[0]?.noteOn, true, 'the first melody event is a note-on');
  assertEq(melody.noteEvents[0]?.velocity, 90, 'the note-on carries the velocity');
  assertEq(melody.noteEvents[0]?.channel, 0, 'the notes sit on channel 0');
  assertEq(melody.noteEvents[1]?.noteOn, false, 'each note-on is followed by its note-off');
  assertEq(melody.noteEvents[1]?.midi, 60, 'the note-off names the same pitch as its note-on');
  assertEq(melody.noteEvents[1]?.velocity, 0x40, 'the note-off carries the release velocity');
  assertEq(melody.noteEvents[3]?.midi, 64, 'the second note’s note-off names the second pitch');

  // The delta-times on the wire must reproduce the note's own on/off ticks.
  const onDelta = melody.noteEvents[0].delta;
  assertEq(onDelta, 0, 'the first note starts at tick 0 (delta 0)');
  const offTick = melody.noteEvents[1].tick;
  assertEq(offTick, expectedTicks(1.0, 120, DEFAULT_TICKS_PER_QUARTER), 'the first note-off lands on its 1.0 s tick');
  const secondOnTick = melody.noteEvents[2].tick;
  assertEq(
    melody.noteEvents[2].delta,
    secondOnTick - offTick,
    'the second note-on’s delta is the real gap after the previous event',
  );
  assertEq(
    secondOnTick,
    expectedTicks(1.1, 120, DEFAULT_TICKS_PER_QUARTER),
    'the second note starts at its own 1.1 s tick (the breath is preserved)',
  );

  // A repeated pitch must not be cut off by its own release.
  const repeated = encodeMidiFile({
    notes: [
      { midi: 62, startSec: 0, durationSec: 0.25 },
      { midi: 62, startSec: 0.25, durationSec: 0.25 },
    ],
  });
  const repeatedTrack = parseSmf(repeated!).tracks[1];
  const kinds = repeatedTrack.noteEvents.map((e) => (e.noteOn ? 'on' : 'off')).join(',');
  assertEq(kinds, 'on,off,on,off', 'at one tick the note-off is written before the next note-on');

  // The documented option: a plain Type 1 file without the reserved track.
  const twoTrack = encodeMidiFile({ notes: take!.notes, includeChordTrack: false });
  const twoTrackFile = parseSmf(twoTrack!);
  assertEq(twoTrackFile.trackCount, 2, 'includeChordTrack:false writes a 2-track Type 1 file');
  assertEq(twoTrackFile.tracks.length, 2, 'and only two chunks are present');
}

// ─── 3. real timings + the meta events ──────────────────────────

function realTimingTests(): void {
  console.log('\nreal timings: the take is never snapped to a beat grid');

  // A note starting at 1.37 s (deliberately off any beat) taken from frames
  // whose hop is 10 ms.
  const frames: PitchFrame[] = [];
  for (let i = 0; i < 24; i++) frames.push(frame(1.37 + i * 0.01, 67));
  const notes = framesToMidiNotes(frames);
  assertEq(notes.length, 1, 'the off-grid held pitch becomes one note');
  assertClose(notes[0].startSec, 1.37, 1e-9, 'the note keeps the frame’s own onset (1.37 s)');

  const bytes = encodeMidiFile({ notes, tempoBpm: 120, key: { tonic: 0, mode: 'major', correlation: 1, confidence: 1, label: 'C major' } });
  const melody = parseSmf(bytes!).tracks[1];
  const onTick = melody.noteEvents[0].tick;
  assertEq(onTick, expectedTicks(1.37, 120, DEFAULT_TICKS_PER_QUARTER), 'the onset tick is the real 1.37 s');
  assertEq(
    onTick % DEFAULT_TICKS_PER_QUARTER !== 0,
    true,
    'the onset is NOT a beat boundary — the timing was not grid-quantized',
  );
  assertClose(
    onTick / ((120 / 60) * DEFAULT_TICKS_PER_QUARTER),
    1.37,
    0.0015,
    'decoding the tick back gives 1.37 s (sub-2 ms of tick rounding only)',
  );

  const conductor = parseSmf(bytes!).tracks[0];
  const keySig = metaEvent(conductor, 0x59);
  assert(keySig !== null, 'a known key writes the SMF key-signature meta event');
  assertEq(keySig!.data?.[0], 0, 'C major writes sf = 0 sharps/flats');
  assertEq(keySig!.data?.[1], 0, 'C major writes mi = 0 (major)');
  // …and the same verdict is asserted on the RAW BYTES (FF 59 02 sf mi), which
  // is what a DAW reads: an encoder that wrote the event in the wrong order, or
  // with a shortened length byte, would still parse through our own reader.
  assertEq(
    rawConductorKeySignature(bytes!)?.join(','),
    '0,0',
    'the conductor chunk really holds FF 59 02 00 00 for C major',
  );

  const minorBytes = encodeMidiFile({
    notes,
    key: { tonic: 6, mode: 'minor', correlation: 1, confidence: 1, label: 'F# minor' },
  });
  const minorKeySig = metaEvent(parseSmf(minorBytes!).tracks[0], 0x59);
  assertEq(minorKeySig!.data?.[0], 3, 'F# minor writes sf = 3 sharps');
  assertEq(minorKeySig!.data?.[1], 1, 'F# minor writes mi = 1 (minor)');
  assertEq(
    rawConductorKeySignature(minorBytes!)?.join(','),
    '3,1',
    'the raw bytes for F# minor are FF 59 02 03 01 (mi = 1 is the minor flag)',
  );

  const flatBytes = encodeMidiFile({
    notes,
    key: { tonic: 3, mode: 'major', correlation: 1, confidence: 1, label: 'D# major' },
  });
  const flatKeySig = metaEvent(parseSmf(flatBytes!).tracks[0], 0x59);
  const sf = flatKeySig!.data![0];
  assertEq(sf > 127 ? sf - 256 : sf, -3, 'a flat key writes a negative sf (two’s-complement byte)');
  assertEq(
    rawConductorKeySignature(flatBytes!)?.[0],
    253,
    'on the wire the flat key is the two’s-complement byte 253 (= −3)',
  );

  // No key known → no key-signature event at all (never a fabricated key).
  const noKey = parseSmf(encodeMidiFile({ notes })!).tracks[0];
  assertEq(metaEvent(noKey, 0x59), null, 'no detected key → no key-signature event');
  assertEq(
    rawConductorKeySignature(encodeMidiFile({ notes })!),
    null,
    'no detected key → the FF 59 02 quartet is absent from the bytes entirely',
  );

  // Tempo guards: an impossible tempo falls back to the documented default.
  const badTempo = metaEvent(parseSmf(encodeMidiFile({ notes, tempoBpm: 5000 })!).tracks[0], 0x51);
  const badMicros = ((badTempo!.data![0] << 16) | (badTempo!.data![1] << 8) | badTempo!.data![2]) >>> 0;
  assertEq(Math.round(60000000 / badMicros), 120, 'an out-of-range tempo falls back to 120 bpm');
}

// ─── 4. the reserved chord track ────────────────────────────────

function chordTrackTests(): void {
  console.log('\nthe reserved chord track: a Type 1 slot that holds no invented music');

  const take = buildCaptureTake(twoNoteTake());
  const file = parseSmf(encodeMidiFile({ notes: take!.notes })!);
  const chords = file.tracks[2];

  assertEq(chords.noteEvents.length, 0, 'the chord track carries NO note events (reserved, not faked)');
  assertEq(chords.events.length, 2, 'the chord track holds exactly its name and end-of-track');
  const name = metaEvent(chords, 0x03);
  const label = name ? String.fromCharCode(...name.data!) : '';
  assertEq(label, RESERVED_CHORD_TRACK_NAME, 'the chord track is labelled as reserved');
  assertEq(
    file.tracks[0].id === 'MTrk' && file.tracks[1].id === 'MTrk',
    true,
    'melody and conductor are their own chunks — Batch B only fills track 3',
  );
}

// ─── 5. honest no-export ────────────────────────────────────────

function noExportTests(): void {
  console.log('\nempty input: an honest no-export, never an empty file');

  assertEq(encodeMidiFile({ notes: [] }), null, 'no notes → encodeMidiFile returns null');
  assertEq(encodeMidiFile({ notes: null }), null, 'a missing note list → null');
  assertEq(encodeMidiFile({ notes: undefined }), null, 'an undefined note list → null');
  assertEq(
    encodeMidiFile({ notes: [{ midi: 60, startSec: 0, durationSec: 0 }] }),
    null,
    'a zero-length note is not music → null',
  );
  assertEq(
    encodeMidiFile({ notes: [{ midi: Number.NaN, startSec: 0, durationSec: 1 }] }),
    null,
    'a note with no pitch → null',
  );
  assertEq(
    buildCaptureTake([frame(0, null), frame(0.025, null)]),
    null,
    'a silent take produces no stored take (so History offers no export)',
  );
  assertEq(buildCaptureTake(null), null, 'a missing frame list produces no take');
  assertEq(
    buildCaptureTake(twoNoteTake())?.capturedAt !== undefined,
    true,
    'a real take carries its capture timestamp',
  );

  const take = buildCaptureTake(twoNoteTake(), { tempoBpm: 0 });
  assertEq(take?.tempoBpm, 120, 'an unusable tempo falls back to the documented default');

  // The honest copy the screens render, derived from the take itself.
  const real = buildCaptureTake(twoNoteTake())!;
  const message = exportedMidiMessage(real);
  assert(message.includes('2 notes'), `the success sentence counts the notes (${message})`);
  assert(
    MIDI_NO_MELODY_MESSAGE.toLowerCase().includes('midi'),
    'the no-melody sentence names what could not be written',
  );
  assertEq(
    captureTakeLabel(real)?.startsWith('Your take · 2 notes'),
    true,
    'the History row label counts the take’s notes',
  );
  assertEq(captureTakeLabel({ ...real, key: null }), 'Your take · 2 notes', 'no detected key → the label claims none');
  assertEq(captureTakeLabel(null), null, 'a row without a take has no label (and no button)');
}

// ─── 6. key detection ───────────────────────────────────────────

/** MIDI notes of a scale from a tonic pitch class (one octave). */
function scaleNotes(tonicPc: number, intervals: number[]): number[] {
  return intervals.map((semitone) => 60 + tonicPc + semitone);
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11, 12];
const NATURAL_MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10, 12];
const HARMONIC_MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 11, 12];

function keyDetectionTests(): void {
  console.log('\nkey detection: Krumhansl–Schmuckler on known tonal examples');

  const cMajor = detectKeyFromNotes(scaleNotes(0, MAJOR_INTERVALS).map((midi) => ({ midi })));
  assertEq(cMajor?.label, 'C major', 'a C major scale is named C major');
  assertEq(cMajor?.mode, 'major', 'and its mode is major');
  assert(cMajor !== null && cMajor.confidence > 0.5, 'a full C major scale is a confident verdict');

  const aMinor = detectKeyFromNotes(scaleNotes(9, NATURAL_MINOR_INTERVALS).map((midi) => ({ midi })));
  assertEq(aMinor?.label, 'A minor', 'an A natural-minor scale is named A minor');
  assertEq(aMinor?.mode, 'minor', 'and its mode is minor');

  const aHarmonic = detectKeyFromNotes(scaleNotes(9, HARMONIC_MINOR_INTERVALS).map((midi) => ({ midi })));
  assertEq(aHarmonic?.label, 'A minor', 'an A harmonic-minor scale (with G#) is still A minor');

  const gMajor = detectKeyFromNotes(scaleNotes(7, MAJOR_INTERVALS).map((midi) => ({ midi })));
  assertEq(gMajor?.label, 'G major', 'a G major scale is named G major');

  const dMinor = detectKeyFromNotes(scaleNotes(2, NATURAL_MINOR_INTERVALS).map((midi) => ({ midi })));
  assertEq(dMinor?.label, 'D minor', 'a D natural-minor scale is named D minor');

  // Transposition invariance: the same melody in a different key moves the answer.
  const melody = [0, 4, 7, 12, 7, 4, 0].map((s) => ({ midi: 60 + 5 + s })); // F major arpeggio
  assertEq(detectKeyFromNotes(melody)?.label, 'F major', 'a melody transposed to F is detected as F major');

  // Duration weighting: a long tonic + short passing notes is not out-voted.
  const weighted = detectKeyFromNotes([
    { midi: 60, durationBeats: 8 },
    { midi: 64, durationBeats: 0.5 },
    { midi: 67, durationBeats: 0.5 },
    { midi: 62, durationBeats: 0.5 },
  ]);
  assertEq(weighted?.label, 'C major', 'duration weighting keeps the tonic key (a held C, passing notes)');

  // Honesty: too little pitch data is NOT a key.
  assertEq(detectKeyFromHistogram(new Array(12).fill(0)), null, 'an empty vector yields no key');
  assertEq(detectKeyFromNotes([]), null, 'an empty take yields no key');
  assertEq(detectKeyFromNotes([{ midi: 60 }]), null, 'one note yields no key');
  assertEq(detectKeyFromNotes([{ midi: 60 }, { midi: 72 }]), null, 'one pitch class (octaves) yields no key');
  assertEq(detectKeyFromNotes(null), null, 'a missing note list yields no key');
  const thin = pitchClassHistogram([60, 64]);
  assert(
    thin.reduce((a, b) => a + b, 0) < MIN_TOTAL_WEIGHT,
    'the two-note fixture really is below the honesty floor',
  );

  // The captured-take path: pitch frames, not just note lists.
  const frames = [...heldFrames(0, 20, 60), ...heldFrames(0.5, 20, 62), ...heldFrames(1.0, 20, 64), ...heldFrames(1.5, 20, 65), ...heldFrames(2.0, 20, 67)];
  const histogram = histogramFromPitchFrames(frames);
  assert(
    histogram.reduce((a, b) => a + b, 0) === 100,
    'every voiced frame contributes exactly once to the pitch-class vector',
  );
  assertEq(detectKeyFromPitchFrames(frames)?.mode, 'major', 'a captured major fragment resolves to a major key');
  assertEq(detectKeyFromPitchFrames([frame(0, null)]), null, 'frames with no pitch yield no key');

  // The 24-key ranking is a real ranking: each key appears once, best first.
  const ranked = rankKeys(histogram);
  assertEq(ranked.length, 24, 'all 24 keys are ranked');
  assertEq(new Set(ranked.map((k) => `${k.tonic}-${k.mode}`)).size, 24, 'no key is ranked twice');
  assert(ranked[0].correlation >= ranked[23].correlation, 'the ranking is ordered by correlation');
  assertEq(
    detectKeyFromHistogram(histogram)?.label,
    `${pitchClassName(ranked[0].tonic)} ${ranked[0].mode}`,
    'the decision is the top-ranked key',
  );
  // The library-score path: the same function on a piece's ABC melody.
  const cAbc = 'X:1\nT:Scale\nM:4/4\nL:1/4\nK:C\nC D E F|G A B c|';
  assertEq(detectKeyFromAbc(cAbc)?.label, 'C major', 'a C major ABC score is detected as C major');
  const gAbc = 'X:1\nT:Scale\nM:4/4\nL:1/4\nK:G\nG A B c|d e f g|';
  assertEq(detectKeyFromAbc(gAbc)?.label, 'G major', 'a G major ABC score is detected as G major');
  assertEq(detectKeyFromAbc(''), null, 'empty ABC yields no key');
  assertEq(detectKeyFromAbc('not abc at all'), null, 'unparsable ABC yields no key, never a guess');

  // Key signatures (the SMF sf/mi pair).
  assertEq(keySignatureFor(0, 'major').sf, 0, 'C major has no accidentals');
  assertEq(keySignatureFor(0, 'major').mi, 0, 'C major is major');
  assertEq(keySignatureFor(0, 'minor').sf, -3, 'C minor has three flats');
  assertEq(keySignatureFor(0, 'minor').mi, 1, 'C minor is minor');
  assertEq(keySignatureFor(6, 'minor').sf, 3, 'F# minor has three sharps');
  assertEq(keySignatureFor(5, 'major').sf, -1, 'F major has one flat');
  assertEq(keySignatureFor(11, 'major').sf, 5, 'B major has five sharps');
  assertEq(keySignatureFor(3, 'major').sf, -3, 'E-flat major has three flats');
  assertEq(keySignatureFor(99, 'major').sf, keySignatureFor(3, 'major').sf, 'a tonic outside 0..11 wraps into the octave');

  // ── the caption the Batch-A surfaces render ───────────────────
  // The key must be shown when there IS one, and NOTHING must be shown when
  // there is not (never a placeholder, never a guessed key).
  assertEq(keyCaption(cMajor), 'Key: C major', 'a detected key renders as "Key: C major"');
  assertEq(keyCaption(aMinor), 'Key: A minor', 'the mode is part of the caption');
  assertEq(keyCaption(dMinor), 'Key: D minor', 'a minor verdict is never dressed up as major');
  assertEq(keyCaption(null), null, 'no verdict → no key text at all');
  assertEq(keyCaption(undefined), null, 'a missing verdict → no key text at all');
  assertEq(
    keyCaption({ ...cMajor!, label: '' }),
    'Key: C major',
    'a verdict without a label is still named from its own tonic + mode',
  );
  assertEq(
    keyCaption({ tonic: Number.NaN, mode: 'major', correlation: 0, confidence: 0, label: '' }),
    null,
    'an unusable verdict (no tonic) renders no caption rather than "Key: ? major"',
  );

  // ── the take's own key reaches the FILE the user opens ────────
  // This is the wiring the device path (captureMidiExport.ts) must perform: the
  // key it holds is handed to the encoder, so the FF 59 bytes are really there.
  const keyedTake = buildCaptureTake(keyedTakeFrames());
  assert(keyedTake !== null, 'the C-major fragment produces a take');
  assert(keyedTake!.notes.length >= 4, `the fixture has enough notes to name a key (${keyedTake!.notes.length})`);
  assertEq(keyedTake!.key?.label, 'C major', 'the take carries its detected key');
  const keyedBytes = encodeMidiFile({
    notes: keyedTake!.notes,
    tempoBpm: keyedTake!.tempoBpm,
    title: 'C major fragment',
    key: keyedTake!.key,
  });
  assert(keyedBytes !== null, 'the keyed take encodes');
  const keyedSig = keySignatureFor(keyedTake!.key!.tonic, keyedTake!.key!.mode);
  assertEq(
    rawConductorKeySignature(keyedBytes!)?.join(','),
    `${keyedSig.sf & 0xff},${keyedSig.mi}`,
    'the take’s OWN detected key is the FF 59 02 sf mi the file carries',
  );
  assertEq(
    rawConductorKeySignature(encodeMidiFile({ notes: keyedTake!.notes, key: null })!),
    null,
    'the same take passed WITHOUT its key writes no key-signature bytes (the drop the guard exists for)',
  );
}

// ─── 7. helpers ─────────────────────────────────────────────────

function helperTests(): void {
  console.log('\nthe file-writing helpers: base64 and the .mid name');

  const bytes = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01]);
  const base64 = midiBytesToBase64(bytes);
  assertEq(base64, 'TVRoZAAAAAYAAQ==', 'the base64 matches the known encoding of an SMF header prefix');
  assertEq(decodeBase64(base64).join(','), Array.from(bytes).join(','), 'decoding the base64 returns the exact bytes');
  assertEq(midiBytesToBase64(new Uint8Array(0)), '', 'no bytes encode to an empty base64 string');
  assertEq(
    decodeBase64(midiBytesToBase64(Uint8Array.from([1, 2, 3, 4, 5]))).join(','),
    '1,2,3,4,5',
    'a non-multiple-of-three length survives the padding',
  );

  assertEq(midiFileName('Für Elise'), 'Fr Elise.mid', 'the file name drops characters a DAW names badly');
  assertEq(midiFileName(''), 'notesnap-take.mid', 'an empty title gets the honest default name');
  assertEq(midiFileName(null), 'notesnap-take.mid', 'a missing title gets the honest default name');
  assertEq(midiFileName('a/b\\c:d*e?f"g<h>i|j').indexOf('/'), -1, 'a title can never inject a path separator');
}

/** Independent base64 decoder (Node has Buffer, Hermes has atob — this is neither). */
function decodeBase64(value: string): number[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`bad base64 character ${char}`);
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

// ─── 8. live scan: the real screens ─────────────────────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

function listTsFiles(rel: string): string[] {
  const fs = require('fs');
  const path = require('path');
  return (fs.readdirSync(path.join(repoRoot(), rel)) as string[]).filter(
    (f) => f.endsWith('.ts') || f.endsWith('.tsx'),
  );
}

/** Replace the occurrence of `needle` that starts at `at` (for nth-of-a-kind edits). */
function replaceOnceAt(source: string, at: number, needle: string, replacement: string): string {
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

function wiringTests(): void {
  console.log('\nlive scan: the hum take reaches the shared result surface, and is really wired');

  const hum = readAppFile('src/screens/HumSearchScreen.tsx');
  const surface = readAppFile(RESULT_SURFACE_PATH);
  const history = readAppFile('src/screens/HistoryScreen.tsx');
  assert(hum.length > 3000, `read HumSearchScreen.tsx (${hum.length} chars)`);
  assert(surface.length > 3000, `read ${RESULT_SURFACE_PATH} (${surface.length} chars)`);
  assert(history.length > 3000, `read HistoryScreen.tsx (${history.length} chars)`);

  // The copy the scan expects the screens to render from the constant.
  assertEq(MIDI_EXPORT_LABEL, 'Export MIDI', 'the tested label is the product’s “Export MIDI”');
  assert(MIDI_EXPORT_BUSY_LABEL.length > 0, 'the busy label is not empty (a spinner state, never a dead button)');
  assertEq(
    MIDI_EXPORT_LABEL_IDENTIFIER,
    'MIDI_EXPORT_LABEL',
    'the scan pins the label IDENTIFIER the screens must use',
  );

  // BUNDLE A: the hum result is the ONE shared surface, so the affordance and the
  // take that feeds it live in two files — the contract is checked as a PAIR.
  assertEq(
    humTakeReachesSurface(hum, surface),
    true,
    'the hum screen hands the take it just recorded to the shared result surface',
  );
  assertEq(humResultCardOffersMidiExport(surface), true, 'the shared result surface renders the export affordance from that contract');
  assertEq(humExportConsumesRecordedTake(hum), true, 'the hum export consumes the recording the user just made');
  assertEq(
    midiExportSurfacesOutcome(hum, surface),
    true,
    'the hum export’s outcome sentence is rendered (the caller owns it, the surface shows it)',
  );
  assertEq(historyRowOffersMidiExport(history), true, 'a History row with a capture exports THAT capture');
  assertEq(midiExportSurfacesOutcome(history), true, 'the History row renders its export outcome sentence');
  assert(history.indexOf('captureTakeLabel(') >= 0, 'the History row labels the take (notes + detected key)');

  // ── mutation probes on the REAL source ──

  const noLabel = surface.replace(/MIDI_EXPORT_LABEL/g, 'EXPORT');
  assert(noLabel !== surface, 'the label mutation changed the real source');
  assertEq(
    humResultCardOffersMidiExport(noLabel),
    false,
    'MUTATION: dropping the tested label from the export button fails the contract',
  );

  const deadButton = surface.replace(
    /onPress=\{midiExport\.onExport\}/,
    'onPress={() => {}}',
  );
  assert(deadButton !== surface, 'the dead-button mutation changed the real source');
  assertEq(
    humResultCardOffersMidiExport(deadButton),
    false,
    'MUTATION: an export button detached from the caller’s handler fails the contract',
  );
  assertEq(
    humTakeReachesSurface(hum, deadButton),
    true,
    'the take-handoff contract still passes (it is about the data, not the handler name)',
  );

  // MUTATION: the button rendered with NO take — a control that can only fail.
  const alwaysShown = surface.replace(
    '{midiExport && midiExport.takeUri ? (',
    '{midiExport ? (',
  );
  assert(alwaysShown !== surface, 'the ungated-button mutation changed the real source');
  assertEq(
    humResultCardOffersMidiExport(alwaysShown),
    false,
    'MUTATION: rendering the export button with no take fails the contract',
  );

  // MUTATION: the caller stops handing its take to the surface (the take travels
  // nowhere, so the export could only write some other audio or nothing).
  const noTakeHandoff = hum.replace(/\n\s*takeUri,\n(\s*)exporting,/, '\n$1exporting,');
  assert(noTakeHandoff !== hum, 'the dropped-handoff mutation changed the real source');
  assertEq(
    humTakeReachesSurface(noTakeHandoff, surface),
    false,
    'MUTATION: a caller that no longer hands its take down fails the contract',
  );

  const otherAudio = hum.replace('setTakeUri(stopped.uri)', "setTakeUri('asset://preview.wav')");
  assert(otherAudio !== hum, 'the wrong-audio mutation changed the real source');
  assertEq(
    humExportConsumesRecordedTake(otherAudio),
    false,
    'MUTATION: exporting anything but the recorded take fails the contract',
  );
  assertEq(
    humTakeReachesSurface(otherAudio, surface),
    false,
    'MUTATION: a take that is not the recording the user just made fails the contract',
  );

  const silentFailure = surface.replace('{midiExport.note &&', '{false &&');
  assert(silentFailure !== surface, 'the silent-failure mutation changed the real source');
  assertEq(
    midiExportSurfacesOutcome(hum, silentFailure),
    false,
    'MUTATION: hiding the outcome sentence fails the contract (a silent dead button)',
  );

  const historyDetached = history.replace(
    'exportCaptureMidiFromTake(item.capture,',
    'exportCaptureMidiFromTake(null,',
  );
  assert(historyDetached !== history, 'the detached-capture mutation changed the real source');
  assertEq(
    historyRowOffersMidiExport(historyDetached),
    false,
    'MUTATION: a History export that ignores the row’s capture fails the contract',
  );

  // ── the DETECTED KEY reaches the file AND the screen ──
  //
  // The device path (captureMidiExport.ts) imports expo-file-system, so nothing
  // compiles or runs it under plain Node — its wiring is guarded by a source
  // contract, exactly like the other device seams (coachCapture). The value the
  // contract protects is asserted at RUNTIME above (the take's own key → the
  // FF 59 02 sf mi bytes).

  const capture = readAppFile('src/services/captureMidiExport.ts');
  assert(capture.length > 2000, `read captureMidiExport.ts (${capture.length} chars)`);

  assertEq(
    takeExportThreadsDetectedKey(capture),
    true,
    'the take export passes the DETECTED key into the encoder AND returns it in the outcome',
  );
  assertEq(
    rendersDetectedKey(hum, surface),
    true,
    'the hum caller derives the detected key and the shared surface renders it',
  );
  assertEq(rendersDetectedKey(history), true, 'the History capture row renders the detected key');

  // The pre-fix defect itself: the key is computed from the take, handed to
  // nothing, and the outcome omits it — a file with no key signature and a card
  // that can never name the key. Both halves must fail the contract.
  const KEY_FIELD_TEXT = 'key: take?.key ?? null';
  const firstKeyField = capture.indexOf(KEY_FIELD_TEXT);
  const secondKeyField = capture.indexOf(KEY_FIELD_TEXT, firstKeyField + 1);
  assert(
    firstKeyField >= 0 && secondKeyField > firstKeyField,
    'the export path carries the key in exactly the two places the guard checks (encoder args + outcome)',
  );
  const unusedKey = replaceOnceAt(capture, firstKeyField, KEY_FIELD_TEXT, 'key: null');
  assertEq(
    takeExportThreadsDetectedKey(unusedKey),
    false,
    'MUTATION: an encoder call that drops the detected key fails the contract (no FF 59 in the file)',
  );
  const outcomeWithoutKey = replaceOnceAt(capture, secondKeyField, KEY_FIELD_TEXT, 'key: null');
  assertEq(
    takeExportThreadsDetectedKey(outcomeWithoutKey),
    false,
    'MUTATION: an outcome that drops the key fails the contract (the screen could never name it)',
  );

  // MUTATION: removing the key caption from a real surface.
  const humNoKeyLine = hum.replace(/keyCaption\(/g, 'noKeyCaption(');
  assert(humNoKeyLine !== hum, 'the hum key-line mutation changed the real source');
  assertEq(
    rendersDetectedKey(humNoKeyLine, surface),
    false,
    'MUTATION: a caller that no longer derives the caption from the take fails the contract',
  );
  const historyNoKeyLine = history.replace(/keyCaption\(/g, 'noKeyCaption(');
  assert(historyNoKeyLine !== history, 'the History key-line mutation changed the real source');
  assertEq(
    rendersDetectedKey(historyNoKeyLine),
    false,
    'MUTATION: removing the key line from the History row fails the contract',
  );

  // MUTATION: a HARDCODED key — a guess the take never supported.
  const guessedKey = history.replace(
    /keyCaption\(item\.capture\?\.key\)/g,
    "keyCaption({ tonic: 0, mode: 'major', correlation: 1, confidence: 1, label: 'C major' })",
  );
  assert(guessedKey !== history, 'the guessed-key mutation changed the real source');
  assertEq(
    rendersDetectedKey(guessedKey),
    false,
    'MUTATION: a hardcoded/guessed key caption fails the contract',
  );

  // MUTATION: an UNCONDITIONAL key line (one that would print for a take with
  // no detected key — i.e. a placeholder the user would read as a real key).
  const placeholderKey = surface.replace('{midiExport.keyLine &&', '{');
  assert(placeholderKey !== surface, 'the unconditional-key mutation changed the real source');
  assertEq(
    rendersDetectedKey(hum, placeholderKey),
    false,
    'MUTATION: an unconditional key line fails the contract (a keyless take would print one)',
  );

  // ── exactly one SMF writer in the app ──

  const offenders: string[] = [];
  let scanned = 0;
  for (const dir of ['src/services', 'src/screens', 'src/components']) {
    for (const file of listTsFiles(dir)) {
      scanned++;
      const src = readAppFile(`${dir}/${file}`);
      if (/0x4d,\s*0x54,\s*0x68,\s*0x64/.test(src) && file !== 'midiExport.ts') {
        offenders.push(`${dir}/${file}`);
      }
    }
  }
  assert(scanned >= 40, `walked ${scanned} app source files (floor: 40)`);
  assertEq(offenders.join(', '), '', 'the MThd writer exists in exactly one module (midiExport.ts)');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== MIDI export Batch A (take → .mid) + key detection ===');
  frameToNoteTests();
  smfStructureTests();
  realTimingTests();
  chordTrackTests();
  noExportTests();
  keyDetectionTests();
  helperTests();
  wiringTests();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
