/**
 * midiExport.ts — the user's OWN captured take as a Standard MIDI File, plus
 * the honest decision logic around that export.
 *
 * Batch A of the MIDI-export feature (owner backlog b1b8f380 / 33e1e7d4):
 * "Export MIDI" on a hum/whistle/sing result and on the History row for a
 * capture serializes what the user actually sang/whistled/hummed as a `.mid`
 * they can open in any DAW, notation app or MIDI editor.
 *
 * WHY SMF, AND WHY TYPE 1. Standard MIDI Files (.mid / SMF) are the universal
 * interchange format — MIDI 2.0 is a transport protocol with no file format of
 * its own, and every DAW/notation app imports .mid. Type 1 is the multi-track
 * layout (a conductor track plus one track per part), so this encoder writes
 * THREE track chunks from the start:
 *
 *   0. the CONDUCTOR track — track name, tempo, time signature, key signature;
 *   1. the MELODY track — the user's monophonic take, as note-on/note-off pairs;
 *   2. the CHORDS track — RESERVED and EMPTY (end-of-track only), so a future
 *      chord track needs no file-layout change (Batch B: harmony detection).
 *
 * REAL TIMINGS, NOT A GRID. The brief is explicit: onsets and durations come
 * from the capture's own frame times, so a note that started at 1.37 s is
 * written at 1.37 s — never snapped to the nearest beat. The only rounding is
 * the file's tick resolution (480 ticks per quarter note), which is what SMF
 * itself is: at 120 bpm one tick is ~1 ms, two orders of magnitude finer than
 * any performance grid. PITCH is quantized to the nearest semitone (the MIDI
 * note number is an integer by definition) — that is a property of the format,
 * and it is why the pre-quantization pitch is kept out of this module's API and
 * stays in pitchDetection.ts where the intonation lives.
 *
 * HONEST NO-EXPORT. `encodeMidiFile` returns `null` for a take with no usable
 * notes rather than writing an empty file that looks like a successful export,
 * and `buildCaptureTake` returns `null` for the same reason. The messages below
 * are what the screens show in that case — never a silent no-op, never a
 * "success" toast for a file that has no music in it.
 *
 * Pure by design — no react / react-native / expo imports, no Node Buffer — so
 * the tier1 gate compiles and runs it under plain Node (tsconfig.tier1.json).
 * The file write + share sheet live in services/captureMidiExport.ts.
 */
import type { PitchFrame } from './pitchDetection';
import { detectKeyFromNotes, keySignatureFor, type KeyDecision } from './keyDetection';

// ─── Types ──────────────────────────────────────────────────────

/**
 * One note of the exported take. Times are in SECONDS from the start of the
 * recording (the capture grid), not beats — the beat grid depends on a tempo
 * nobody performed, and inventing one would be exactly the over-claim this
 * module avoids.
 */
export interface MidiNoteEvent {
  /** MIDI note number, integer 0..127 (69 = A4). */
  midi: number;
  /** Onset, seconds from the start of the recording. */
  startSec: number;
  /** Sounding length, seconds (> 0). */
  durationSec: number;
  /** MIDI velocity 1..127. */
  velocity?: number;
}

/**
 * A capture stored with the History row, so "Export MIDI" stays possible after
 * the screen is gone: the derived notes (from the real frames), the tempo the
 * file was written with, the detected key and the capture time.
 */
export interface SavedCaptureTake {
  notes: MidiNoteEvent[];
  tempoBpm: number;
  durationSec: number;
  /** The detected key, or null when the take was too thin to name one. */
  key: KeyDecision | null;
  /** ISO timestamp of the capture. */
  capturedAt: string;
}

export type MidiExportStatus = 'exported' | 'no-melody' | 'unavailable' | 'failed';

/** What an export attempt did — always with a user-facing, honest sentence. */
export interface MidiExportOutcome {
  status: MidiExportStatus;
  /** The written file (present only for 'exported'). */
  fileUri?: string;
  /** The take that was written (present only for 'exported'). */
  take?: SavedCaptureTake;
  /**
   * The key the written file carries — the same verdict the SMF key-signature
   * meta event (FF 59 02 sf mi) was written from — or `null` when the take was
   * too thin to name one. Present only for 'exported'.
   *
   * The surfaces turn it into text with keyDetection.keyCaption and render
   * NOTHING when it is null: a take with no detected key must never show a
   * placeholder or a guessed key.
   */
  key?: KeyDecision | null;
  /** One honest sentence for the user. Never empty. */
  message: string;
}

// ─── Copy the screens render ────────────────────────────────────

export const MIDI_EXPORT_LABEL = 'Export MIDI';
export const MIDI_EXPORT_BUSY_LABEL = 'Preparing MIDI…';
export const MIDI_EXPORT_HINT =
  'Your own take as a .mid file — opens in any DAW or notation app.';
export const MIDI_EXPORT_DIALOG_TITLE = 'Save your take as a MIDI file';
export const MIDI_MIME_TYPE = 'audio/midi';
/** Apple share-sheet type for a standard MIDI file (iOS keeps the extension). */
export const MIDI_UTI = 'public.midi-audio';

// ─── Frame grid constants (mirroring pitchDetection.ts) ─────────

/** Hop used when the frames themselves do not reveal one (25 ms). */
export const DEFAULT_FRAME_HOP_SECONDS = 0.025;
/** Segments shorter than this are not notes (same floor as the coach). */
export const DEFAULT_MIN_NOTE_SEC = 0.12;
/** Velocity written for every note of a monophonic voice take. */
export const DEFAULT_NOTE_VELOCITY = 90;

// ─── SMF constants ──────────────────────────────────────────────

export const MIDI_FORMAT_TYPE_1 = 1;
export const DEFAULT_TICKS_PER_QUARTER = 480;
export const DEFAULT_TEMPO_BPM = 120;
export const MIN_TEMPO_BPM = 20;
export const MAX_TEMPO_BPM = 400;
/** The maximum a 16-bit SMF division can hold. */
export const MAX_TICKS_PER_QUARTER = 0x7fff;
export const MELODY_TRACK_NAME = 'Melody (hum/whistle/sing take)';
export const CONDUCTOR_TRACK_NAME = 'NoteSnap take';
/** The reserved, deliberately EMPTY chord track (Batch B: harmony). */
export const RESERVED_CHORD_TRACK_NAME = 'Chords (reserved)';

// ─── Pitch frames → MIDI notes ──────────────────────────────────

export interface FrameNoteOptions {
  /** Shortest segment that becomes a note (default 0.12 s). */
  minNoteSec?: number;
  /** Frame hop to add to the last frame's onset (default: measured, else 25 ms). */
  hopSeconds?: number;
  /** Velocity for every note (default 90). */
  velocity?: number;
}

/**
 * Group the captured pitch frames into MIDI notes, with the take's REAL
 * timings:
 *
 *   • a frame with no pitch (silence / unpitched) ends the current note;
 *   • a frame whose nearest semitone differs starts a new note;
 *   • a frame with the same nearest semitone continues the current note
 *     (the note's pitch is the MEDIAN of its frames, rounded at the end);
 *   • the onset is the first frame's own time, the duration runs to the last
 *     frame's time plus one hop — no grid, no rounding to note values;
 *   • segments shorter than `minNoteSec` are dropped (a click or a smear is not
 *     a note).
 *
 * Returns [] for an empty/silent take: the caller then reports "we could not
 * hear enough melody", which is the truth.
 */
export function framesToMidiNotes(
  frames: ReadonlyArray<PitchFrame> | null | undefined,
  opts: FrameNoteOptions = {},
): MidiNoteEvent[] {
  if (!Array.isArray(frames) || frames.length === 0) return [];

  const minNoteSec =
    typeof opts.minNoteSec === 'number' && Number.isFinite(opts.minNoteSec) && opts.minNoteSec > 0
      ? opts.minNoteSec
      : DEFAULT_MIN_NOTE_SEC;
  const hopSeconds = resolveHop(frames, opts.hopSeconds);
  const velocity = resolveVelocity(opts.velocity);

  // A stable sort by time: a caller that hands us frames out of order (or a
  // repeated frame) still gets a monotonic melody.
  const ordered = frames
    .map((frame, index) => ({ frame, index }))
    .sort((a, b) => timeOf(a.frame, a.index) - timeOf(b.frame, b.index))
    .map((entry) => entry.frame);

  const notes: MidiNoteEvent[] = [];
  let startSec = -1;
  let lastSec = -1;
  let currentKey: number | null = null;
  let values: number[] = [];

  const close = (): void => {
    if (startSec < 0 || currentKey === null || values.length === 0) {
      startSec = -1;
      lastSec = -1;
      currentKey = null;
      values = [];
      return;
    }
    const durationSec = lastSec + hopSeconds - startSec;
    const midi = medianOf(values);
    if (durationSec >= minNoteSec && Number.isFinite(midi)) {
      notes.push({
        midi: clampMidi(midi),
        startSec: round3(startSec),
        durationSec: round3(durationSec),
        velocity,
      });
    }
    startSec = -1;
    lastSec = -1;
    currentKey = null;
    values = [];
  };

  for (let i = 0; i < ordered.length; i++) {
    const frame = ordered[i];
    const midi = frame?.midi;
    const tSec = timeOf(frame, i);
    if (typeof midi !== 'number' || !Number.isFinite(midi)) {
      close();
      continue;
    }
    const semitone = clampMidi(midi);
    if (startSec >= 0 && currentKey === semitone) {
      values.push(midi);
      lastSec = tSec;
      continue;
    }
    close();
    startSec = tSec;
    lastSec = tSec;
    currentKey = semitone;
    values = [midi];
  }
  close();

  return notes;
}

/** Frames → the take the History row carries (null when there is no melody). */
export function buildCaptureTake(
  frames: ReadonlyArray<PitchFrame> | null | undefined,
  opts: FrameNoteOptions & { tempoBpm?: number; capturedAt?: string } = {},
): SavedCaptureTake | null {
  const notes = framesToMidiNotes(frames, opts);
  if (notes.length === 0) return null;

  const tempoBpm = resolveTempo(opts.tempoBpm);
  const last = notes[notes.length - 1];
  const startOfLast = last ? last.startSec : 0;
  const endOfLast = last ? last.startSec + last.durationSec : 0;

  return {
    notes,
    tempoBpm,
    durationSec: round3(Math.max(endOfLast, startOfLast)),
    key: detectKeyFromNotes(notes),
    capturedAt:
      typeof opts.capturedAt === 'string' && opts.capturedAt.length > 0
        ? opts.capturedAt
        : new Date().toISOString(),
  };
}

// ─── The Standard MIDI File encoder ─────────────────────────────

export interface MidiFileInput {
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined;
  /** Playback tempo written to the conductor track (default 120). */
  tempoBpm?: number;
  /** Time signature as [numerator, denominator] (default [4, 4]). */
  timeSignature?: [number, number];
  /** Key for the SMF key-signature meta event; omitted when unknown. */
  key?: KeyDecision | null;
  /** Track name for the melody track (the piece title, when we have one). */
  title?: string;
  /** Ticks per quarter note (default 480). */
  ticksPerQuarter?: number;
  /**
   * Write the reserved (empty) chord track. Default TRUE: the file is Type 1
   * multi-track from the start so a future chord track needs no relayout.
   */
  includeChordTrack?: boolean;
}

/** Byte length of the header chunk (MThd + length + 6 data bytes). */
export const MIDI_HEADER_BYTES = 14;

/**
 * Serialize the take as a Type 1 Standard MIDI File.
 *
 * Returns `null` when there is nothing honest to write (no usable notes) — the
 * screens turn that into "we could not hear enough melody to write a MIDI
 * file", never an empty file presented as a success.
 */
export function encodeMidiFile(input: MidiFileInput): Uint8Array | null {
  const notes = sanitizeNotes(input?.notes);
  if (notes.length === 0) return null;

  const tempoBpm = resolveTempo(input?.tempoBpm);
  const ticksPerQuarter = resolveTicksPerQuarter(input?.ticksPerQuarter);
  const [beatsPerBar, beatUnit] = resolveTimeSignature(input?.timeSignature);
  const includeChordTrack = input?.includeChordTrack !== false;

  const tracks: number[][] = [
    conductorTrack({ tempoBpm, beatsPerBar, beatUnit, key: input?.key ?? null }),
    melodyTrack(notes, {
      tempoBpm,
      ticksPerQuarter,
      title: input?.title,
    }),
  ];
  if (includeChordTrack) tracks.push(reservedChordTrack());

  const bytes: number[] = [];
  pushHeader(bytes, {
    format: MIDI_FORMAT_TYPE_1,
    trackCount: tracks.length,
    ticksPerQuarter,
  });
  for (const track of tracks) {
    pushBytes(bytes, [0x4d, 0x54, 0x72, 0x6b]); // "MTrk"
    pushUint32(bytes, track.length);
    pushBytes(bytes, track);
  }
  return Uint8Array.from(bytes);
}

// ─── Track writers ──────────────────────────────────────────────

interface ConductorInput {
  tempoBpm: number;
  beatsPerBar: number;
  beatUnit: number;
  key: KeyDecision | null;
}

/** Track 0: the conductor track — name, tempo, time signature, key signature. */
function conductorTrack(input: ConductorInput): number[] {
  const track: number[] = [];
  pushMetaText(track, CONDUCTOR_TRACK_NAME);
  // FF 51 03 tttttt — microseconds per quarter note.
  const microsPerQuarter = Math.round(60000000 / input.tempoBpm);
  pushVarLen(track, 0);
  pushBytes(track, [0xff, 0x51, 0x03]);
  pushBytes(track, [
    (microsPerQuarter >> 16) & 0xff,
    (microsPerQuarter >> 8) & 0xff,
    microsPerQuarter & 0xff,
  ]);
  // FF 58 04 nn dd cc bb — nn/dd = time signature, cc = MIDI clocks per click
  // (24, the SMF convention), bb = 32nd notes per quarter (8).
  pushVarLen(track, 0);
  pushBytes(track, [0xff, 0x58, 0x04, input.beatsPerBar, input.beatUnit, 24, 8]);
  if (input.key) {
    pushVarLen(track, 0);
    pushBytes(track, [0xff, 0x59, 0x02, keySf(input.key), keyMi(input.key)]);
  }
  pushEndOfTrack(track);
  return track;
}

interface MelodyInput {
  tempoBpm: number;
  ticksPerQuarter: number;
  title?: string;
}

/** Track 1: the melody — note-on/note-off pairs on channel 0, real timings. */
function melodyTrack(notes: MidiNoteEvent[], input: MelodyInput): number[] {
  const track: number[] = [];
  const name =
    typeof input.title === 'string' && input.title.trim().length > 0
      ? input.title.trim()
      : MELODY_TRACK_NAME;
  pushMetaText(track, name);

  const events: MelodyEvent[] = [];
  for (const note of notes) {
    const onTick = secondsToTicks(note.startSec, input);
    const rawOffTick = secondsToTicks(note.startSec + note.durationSec, input);
    // A zero-length note would be inaudible in every DAW: give it one tick.
    const offTick = rawOffTick > onTick ? rawOffTick : onTick + 1;
    const velocity = resolveVelocity(note.velocity);
    events.push({ tick: onTick, order: 1, bytes: [0x90, note.midi, velocity] });
    events.push({ tick: offTick, order: 0, bytes: [0x80, note.midi, 0x40] });
  }
  // At an identical tick a note-off must precede a note-on, otherwise a
  // repeated pitch would be cut off by its own release.
  events.sort((a, b) => (a.tick === b.tick ? a.order - b.order : a.tick - b.tick));

  let previousTick = 0;
  for (const event of events) {
    pushVarLen(track, Math.max(0, event.tick - previousTick));
    pushBytes(track, event.bytes);
    previousTick = Math.max(previousTick, event.tick);
  }
  pushEndOfTrack(track);
  return track;
}

interface MelodyEvent {
  tick: number;
  /** 0 = note-off, 1 = note-on (the tie-break order at one tick). */
  order: number;
  bytes: number[];
}

/**
 * Track 2: the RESERVED chord track — end-of-track only, deliberately empty.
 * Batch B (harmony detection) fills this track with the chord notes; the file
 * layout, the division and the conductor track do not change.
 */
function reservedChordTrack(): number[] {
  const track: number[] = [];
  pushMetaText(track, RESERVED_CHORD_TRACK_NAME);
  pushEndOfTrack(track);
  return track;
}

// ─── Byte helpers ───────────────────────────────────────────────

function pushHeader(
  bytes: number[],
  input: { format: number; trackCount: number; ticksPerQuarter: number },
): void {
  pushBytes(bytes, [0x4d, 0x54, 0x68, 0x64]); // "MThd"
  pushUint32(bytes, 6);
  pushUint16(bytes, input.format);
  pushUint16(bytes, input.trackCount);
  pushUint16(bytes, input.ticksPerQuarter);
}

function pushMetaText(track: number[], text: string): void {
  const ascii = toAscii(text);
  pushVarLen(track, 0);
  pushBytes(track, [0xff, 0x03, ascii.length]);
  pushBytes(track, ascii);
}

function pushEndOfTrack(track: number[]): void {
  pushVarLen(track, 0);
  pushBytes(track, [0xff, 0x2f, 0x00]);
}

/** Variable-length quantity (SMF delta-times): 7 bits per byte, MSB = continue. */
export function pushVarLen(out: number[], value: number): void {
  let v = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const buffer: number[] = [v & 0x7f];
  v = Math.floor(v / 128);
  while (v > 0) {
    buffer.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  pushBytes(out, buffer);
}

function pushUint32(out: number[], value: number): void {
  const v = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  pushBytes(out, [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

function pushUint16(out: number[], value: number): void {
  const v = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  pushBytes(out, [(v >>> 8) & 0xff, v & 0xff]);
}

function pushBytes(out: number[], values: ReadonlyArray<number>): void {
  for (const value of values) out.push(value & 0xff);
}

/** Text → ASCII bytes (a track name in a MIDI file is 7-bit; accents are folded). */
function toAscii(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) continue;
    out.push(code <= 0x7e ? code : 0x3f); // '?' for anything non-ASCII
  }
  return out;
}

/**
 * Base64 of the file bytes, for expo-file-system's
 * `writeAsStringAsync(uri, base64, { encoding: Base64 })` — the write path the
 * repo already uses (captureTelemetry.ts). Pure, so it is tier1-testable (Hermes
 * has btoa but Node's test run does not).
 */
export function midiBytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] & 0xff;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] & 0xff : 0;
    const b2 = hasB2 ? bytes[i + 2] & 0xff : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += hasB1 ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += hasB2 ? alphabet[b2 & 0x3f] : '=';
  }
  return out;
}

/** File name for the exported take: `<safe title>.mid` (never empty, never a path). */
export function midiFileName(title?: string | null): string {
  const base =
    typeof title === 'string'
      ? title
          .replace(/[^A-Za-z0-9 _.-]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  const safe = base.length > 0 ? base.slice(0, 60) : 'notesnap-take';
  return `${safe}.mid`;
}

// ─── Outcome copy ───────────────────────────────────────────────

/** The success sentence: the note count the written file really holds. The
 *  detected key is NOT repeated here — the card renders it from the outcome's
 *  own `key` (keyDetection.keyCaption), so the key appears exactly once per
 *  surface and never as a second, possibly drifting, copy of the same text. */
export function exportedMidiMessage(take: SavedCaptureTake): string {
  const count = take.notes.length;
  const notesLabel = count === 1 ? '1 note' : `${count} notes`;
  return `Exported your take — ${notesLabel}. Open the .mid in any DAW or notation app.`;
}

export const MIDI_NO_MELODY_MESSAGE =
  'Could not hear enough melody in that take to write a MIDI file — hum or whistle a longer, clearer phrase and try again.';

export const MIDI_UNAVAILABLE_MESSAGE =
  'MIDI export needs the melody decoder, which is unavailable right now — check your connection and try again.';

export const MIDI_FAILED_MESSAGE =
  'Could not write the MIDI file on this device — please try again.';

/**
 * The one-line label for the take on a History row: the note count. The DETECTED
 * KEY is not repeated here either — the row renders its own key caption
 * (keyDetection.keyCaption on the take the row carries), so the key is printed
 * once per row, from the take that the export writes into the file.
 *
 * Returns null for a row with no take, so the UI can hide the whole affordance
 * rather than offer an export that could only fail.
 */
export function captureTakeLabel(take: SavedCaptureTake | null | undefined): string | null {
  const notes = take?.notes;
  if (!Array.isArray(notes) || notes.length === 0) return null;
  const count = notes.length === 1 ? '1 note' : `${notes.length} notes`;
  return `Your take · ${count}`;
}

// ─── Internals ──────────────────────────────────────────────────

function sanitizeNotes(
  notes: ReadonlyArray<MidiNoteEvent> | null | undefined,
): MidiNoteEvent[] {
  if (!Array.isArray(notes)) return [];
  const clean: MidiNoteEvent[] = [];
  for (const note of notes) {
    if (!note) continue;
    const midi = note.midi;
    const startSec = note.startSec;
    const durationSec = note.durationSec;
    if (!Number.isFinite(midi) || !Number.isFinite(startSec) || !Number.isFinite(durationSec)) {
      continue;
    }
    if (durationSec <= 0 || startSec < 0) continue;
    clean.push({
      midi: clampMidi(midi),
      startSec,
      durationSec,
      velocity: resolveVelocity(note.velocity),
    });
  }
  return clean.sort((a, b) => a.startSec - b.startSec);
}

function secondsToTicks(
  seconds: number,
  input: { tempoBpm: number; ticksPerQuarter: number },
): number {
  const ticks = (seconds * input.tempoBpm * input.ticksPerQuarter) / 60;
  return Number.isFinite(ticks) ? Math.max(0, Math.round(ticks)) : 0;
}

function resolveTempo(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TEMPO_BPM;
  if (value < MIN_TEMPO_BPM || value > MAX_TEMPO_BPM) return DEFAULT_TEMPO_BPM;
  return value;
}

function resolveTicksPerQuarter(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TICKS_PER_QUARTER;
  const ticks = Math.floor(value);
  if (ticks < 1 || ticks > MAX_TICKS_PER_QUARTER) return DEFAULT_TICKS_PER_QUARTER;
  return ticks;
}

/**
 * The SMF time-signature pair as [numerator, denominator BYTE]. The byte is the
 * power of two the SMF spec stores (2 = quarter, 3 = eighth), so a 4/4 default
 * is [4, 2] — passing [4, 4] to the clock would mean 4/16.
 */
function resolveTimeSignature(
  value: [number, number] | undefined,
): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [4, 2];
  const [numerator, denominator] = value;
  const num =
    Number.isFinite(numerator) && numerator >= 1 && numerator <= 255 ? Math.floor(numerator) : 4;
  // The SMF denominator byte is a power of two (2 = quarter, 3 = eighth, …).
  const den = Number.isFinite(denominator) && denominator >= 1 && denominator <= 128
    ? Math.round(Math.log2(denominator))
    : 2;
  return [num, den];
}

function resolveVelocity(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_NOTE_VELOCITY;
  const v = Math.round(value);
  if (v < 1) return 1;
  if (v > 127) return 127;
  return v;
}

function clampMidi(value: number): number {
  const v = Math.round(value);
  if (!Number.isFinite(v)) return 60;
  return Math.max(0, Math.min(127, v));
}

function timeOf(frame: PitchFrame | undefined, index: number): number {
  const tSec = frame?.tSec;
  return typeof tSec === 'number' && Number.isFinite(tSec) ? tSec : index * DEFAULT_FRAME_HOP_SECONDS;
}

/** Hop between frames, measured from the frames themselves when possible. */
function resolveHop(
  frames: ReadonlyArray<PitchFrame>,
  override: number | undefined,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override;
  const deltas: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const delta = timeOf(frames[i], i) - timeOf(frames[i - 1], i - 1);
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return DEFAULT_FRAME_HOP_SECONDS;
  const hop = medianOf(deltas);
  return Number.isFinite(hop) && hop > 0 ? hop : DEFAULT_FRAME_HOP_SECONDS;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The SMF key-signature `sf` byte (signed; pushBytes writes it two's-complement). */
function keySf(key: KeyDecision): number {
  return keySignatureFor(key.tonic, key.mode).sf;
}

function keyMi(key: KeyDecision): number {
  return keySignatureFor(key.tonic, key.mode).mi;
}
