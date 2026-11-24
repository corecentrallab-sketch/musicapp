/**
 * incrementalNotes.ts — NOTES AS THEY ARE COMPUTED (streaming read, first increment).
 *
 * WHY THIS FILE EXISTS. Today the coach read is one POST and one render: the route
 * computes the whole pitch pass, the app waits for the whole answer, `framesToMidiNotes`
 * segments the WHOLE frame list, and ABCjs then draws every note at once. So a note cannot
 * appear until every frame exists — even though the segmentation itself is incremental by
 * nature (a note ends the moment a frame with a different pitch, or a silent frame, arrives).
 *
 * This is the smallest piece that has to exist before anything can be drawn early: a reader
 * that takes pitch frames in CHUNKS and hands back the notes that just closed. It changes no
 * behaviour on its own — nothing calls it yet — and it is pure (no react, no react-native, no
 * expo, no timers), so the tier1 gate pins it with no device in the loop.
 *
 * IT MUST NOT INVENT A SECOND READING OF THE SAME TAKE. The rules below are
 * `midiExport.framesToMidiNotes`'s rules, unchanged, and the gate asserts the reader's notes
 * are IDENTICAL to that function's over the same frames — fed in 1, 3, 7 and 50-frame chunks.
 * If the two ever disagree, the streaming screen would show a different melody from the one
 * the MIDI export and the History row carry, which is the defect this gate exists to stop.
 *
 * THE ONE THING A STREAM CANNOT KNOW: the frame hop, which `framesToMidiNotes` takes as the
 * MEDIAN of every delta in the list. A reader that has not seen the end of the list takes the
 * FIRST positive delta it sees instead. On the grid `detectPitchFrames` produces (a constant
 * `hopSamples`, so every delta is equal) those are the same number, which is why the gate's
 * equality holds exactly. On a non-uniform grid the notes would still be right and the
 * DURATIONS could differ by the hop difference — so `hopSeconds` is exposed and can be
 * overridden when a caller already knows the grid.
 *
 * TIMES. Frames must arrive in time order, which is the order the tracker and the route
 * produce them in. Unlike `framesToMidiNotes` this reader does not sort (sorting a growing
 * list per chunk is the quadratic work the stream exists to avoid); an out-of-order frame is
 * treated as the frame it is, in the order it arrived.
 */
import type { PitchFrame } from './pitchDetection';
import { median } from './pitchDetection';
import {
  DEFAULT_FRAME_HOP_SECONDS,
  DEFAULT_MIN_NOTE_SEC,
  DEFAULT_NOTE_VELOCITY,
  type MidiNoteEvent,
} from './midiExport';

/** Options mirror `midiExport.FrameNoteOptions` — same names, same defaults. */
export interface IncrementalNoteOptions {
  /** Shortest segment that becomes a note (default 0.12 s). */
  minNoteSec?: number;
  /**
   * Frame hop in seconds. Omit to infer it from the frames as they arrive (the first
   * positive delta), which matches `framesToMidiNotes` exactly on a uniform grid.
   */
  hopSeconds?: number;
  /** Velocity for every emitted note (default 90). */
  velocity?: number;
}

/**
 * A reader over a take that is still being read. Feed it frames, collect the notes it
 * closes, and call `flush()` once when the stream ends.
 */
export interface IncrementalNoteReader {
  /** Every note closed so far, oldest first. Notes are final: they never change later. */
  readonly notes: ReadonlyArray<MidiNoteEvent>;
  /**
   * Start time (seconds) of the note still sounding, or null when no note is open.
   * A surface can draw this as "a note in progress" — it is the only part of the take
   * that is not yet decided.
   */
  readonly openStartSec: number | null;
  /** Frames accepted so far. */
  readonly frameCount: number;
  /** Time (seconds) of the last frame seen, or null before the first. */
  readonly lastTimeSec: number | null;
  /** The hop being used, in seconds: the override, else the measured grid, else 25 ms. */
  readonly hopSeconds: number;
  /**
   * Add a chunk of frames. Returns ONLY the notes this chunk closed (empty when the chunk
   * ends mid-note) — the caller appends them to whatever it is drawing.
   */
  push(frames: ReadonlyArray<PitchFrame>): MidiNoteEvent[];
  /** Close the note still sounding (end of stream). Idempotent: a second call emits nothing. */
  flush(): MidiNoteEvent[];
}

/** Mirror of midiExport's private helper: round to the nearest semitone, clamp 0..127. */
function clampMidi(value: number): number {
  const v = Math.round(value);
  if (!Number.isFinite(v)) return 60;
  return Math.max(0, Math.min(127, v));
}

/** Mirror of midiExport's private helper: 3 decimal places, the take's own resolution. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Create a reader. `opts` are validated exactly as `framesToMidiNotes` validates them, so a
 * nonsense value cannot make the stream read a take differently from the batch function.
 */
export function createIncrementalNoteReader(
  opts: IncrementalNoteOptions = {},
): IncrementalNoteReader {
  const minNoteSec =
    typeof opts.minNoteSec === 'number' && Number.isFinite(opts.minNoteSec) && opts.minNoteSec > 0
      ? opts.minNoteSec
      : DEFAULT_MIN_NOTE_SEC;
  const velocityOverride = opts.velocity;
  const velocity =
    typeof velocityOverride === 'number' && Number.isFinite(velocityOverride)
      ? Math.max(1, Math.min(127, Math.round(velocityOverride)))
      : DEFAULT_NOTE_VELOCITY;
  const hopOverride =
    typeof opts.hopSeconds === 'number' && Number.isFinite(opts.hopSeconds) && opts.hopSeconds > 0
      ? opts.hopSeconds
      : null;

  const notes: MidiNoteEvent[] = [];
  let frameCount = 0;
  let lastTimeSec: number | null = null;
  /** The first positive delta between two frames — the grid, once we have two of them. */
  let measuredHop: number | null = null;

  // The open segment (the note still sounding).
  let startSec = -1;
  let endSec = -1;
  let currentKey: number | null = null;
  let values: number[] = [];

  const hop = (): number => hopOverride ?? measuredHop ?? DEFAULT_FRAME_HOP_SECONDS;

  /** The frame's own time, else its place on the 25 ms grid (same rule as midiExport). */
  const timeOf = (frame: PitchFrame | undefined, index: number): number => {
    const tSec = frame?.tSec;
    return typeof tSec === 'number' && Number.isFinite(tSec)
      ? tSec
      : index * DEFAULT_FRAME_HOP_SECONDS;
  };

  const reset = (): void => {
    startSec = -1;
    endSec = -1;
    currentKey = null;
    values = [];
  };

  /** Close the open segment into `out`, applying the same rules the batch function does. */
  const close = (out: MidiNoteEvent[]): void => {
    if (startSec < 0 || currentKey === null || values.length === 0) {
      reset();
      return;
    }
    const durationSec = endSec + hop() - startSec;
    const midi = median(values);
    if (durationSec >= minNoteSec && Number.isFinite(midi)) {
      out.push({
        midi: clampMidi(midi),
        startSec: round3(startSec),
        durationSec: round3(durationSec),
        velocity,
      });
    }
    reset();
  };

  return {
    get notes() {
      return notes;
    },
    get openStartSec() {
      return startSec >= 0 ? startSec : null;
    },
    get frameCount() {
      return frameCount;
    },
    get lastTimeSec() {
      return lastTimeSec;
    },
    get hopSeconds() {
      return hop();
    },

    push(frames: ReadonlyArray<PitchFrame>): MidiNoteEvent[] {
      const emitted: MidiNoteEvent[] = [];
      if (!Array.isArray(frames) || frames.length === 0) return emitted;

      for (const frame of frames) {
        const index = frameCount;
        frameCount += 1;
        const tSec = timeOf(frame, index);
        if (lastTimeSec !== null && measuredHop === null) {
          const delta = tSec - lastTimeSec;
          if (Number.isFinite(delta) && delta > 0) measuredHop = delta;
        }
        lastTimeSec = tSec;

        const midi = frame?.midi;
        if (typeof midi !== 'number' || !Number.isFinite(midi)) {
          // Silence or an unpitched frame ends the note — exactly as in the batch read.
          close(emitted);
          continue;
        }
        const semitone = clampMidi(midi);
        if (startSec >= 0 && currentKey === semitone) {
          values.push(midi);
          endSec = tSec;
          continue;
        }
        close(emitted);
        startSec = tSec;
        endSec = tSec;
        currentKey = semitone;
        values = [midi];
      }

      notes.push(...emitted);
      return emitted;
    },

    flush(): MidiNoteEvent[] {
      const emitted: MidiNoteEvent[] = [];
      close(emitted);
      notes.push(...emitted);
      return emitted;
    },
  };
}
