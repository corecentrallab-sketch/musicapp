/**
 * videoTakeSync.ts — THE SYNC MODEL FOR THE PRACTICE-VIDEO FEATURE (owner GO
 * 10-10, all five decisions; backlog a49fbe2d; design brief §3).
 *
 * THE RATIFIED BOUNDARY, IN ONE PLACE. The user films themselves playing. The
 * PICTURE is the video; the NOTES AND CHORDS come from the AUDIO OF THE SAME
 * TAKE, read by the pipeline the app already ships and corrected by the user in
 * the editor the app already has. Nothing here transcribes a video frame, nothing
 * detects anything while recording, and no note ever reaches the screen that the
 * audio pipeline did not produce or the user did not edit (decision 4 —
 * OWN-TAKE-ONLY).
 *
 * THE ONE LINE OF ARITHMETIC:
 *
 *   note.startSec   seconds from the start of the AUDIO recording  (existing, real)
 *   audioOffsetMs   ms the audio capture started AFTER the video capture (measured)
 *   ─────────────────────────────────────────────────────────────────────────────
 *   cue.startSec = note.startSec + audioOffsetMs / 1000      (the video's timeline)
 *
 * The mapping is LINEAR: ONE measured offset, no per-note warping, no invented
 * beat grid. Cues that do not fall inside the video are DROPPED, never clamped
 * (a note drawn at the video's edge would be a lie about when it was played),
 * and the surface reports how many were dropped.
 *
 * THE OFFSET IS MEASURED, NEVER ASSUMED TO BE ZERO: both captures are started from
 * one handler and the screen stamps when each really came up (decision 1). The
 * one case where a measured offset is meaningless — the one-mic fallback, where
 * the notes come from a SEPARATE take because the two microphones cannot run
 * together (decision 2) — returns the offset through `separateTakeOffset()` and
 * says so on the surface.
 *
 * THE READING NEVER WRITES. `noteCuesForVideo` and every nudge here only READ
 * `take.notes`; the playback clock must not mutate the take (the `takePreview`
 * rule, re-proved for video by scripts/v38VideoPractice.test.ts).
 *
 * PURE: no react, no react-native, no expo, no fs, no network — so the tier1 gate
 * pins the offset math, the drop-not-clamp counts, the bounds and the honest
 * lines with no device in the loop.
 */
import type { MidiNoteEvent, SavedCaptureTake } from './midiExport';

/** The fine step of the user-facing nudge. */
export const VIDEO_OFFSET_NUDGE_MS = 50;
/** The coarse step (a long press, and the ± controls' double step). */
export const VIDEO_OFFSET_COARSE_MS = 500;
/**
 * How far the user may move the offset by hand. It corrects the RESIDUAL start
 * latency the two encoders leave behind; it is not a re-timing tool.
 */
export const VIDEO_OFFSET_BOUNDS_MS = 1500;

/**
 * THE HONEST LINE UNDER THE VIDEO (brief §2.4, verbatim). It is the whole claim:
 * what NoteSnap heard in the take's audio, lined up with the video, and the
 * explicit denial that the picture carries notes.
 */
export const VIDEO_SYNC_HONESTY =
  'The notes are what NoteSnap heard in the audio of your take, lined up with the video. The video picture itself carries no notes.';

/** Shown once the user has moved the offset by hand (brief §3.3, verbatim). */
export const VIDEO_OFFSET_MANUAL_LINE =
  'You lined the notes up to the video by hand — that is your own alignment, not something we detected.';

/** The prefix of the count line when cues fell outside the video. */
export const VIDEO_NOTES_DROPPED_LINE =
  'Some notes fall outside the video and are not drawn';

/** The offset's own labels on the sync row. */
export const VIDEO_OFFSET_ROW_LABEL = 'Sync';
export const VIDEO_OFFSET_SET_FROM_FIRST_NOTE_CTA = 'Set from my first note';
export const VIDEO_OFFSET_RESET_CTA = 'Reset to measured';
export const VIDEO_OFFSET_MINUS_LABEL = '−';
export const VIDEO_OFFSET_PLUS_LABEL = '+';

/** What the surface says while the take is being read (decision 1's step 3). */
export const VIDEO_READING_LINE = 'Reading your take…';

/**
 * THE HONEST LINE ON EVERY RECORDING SURFACE (decision 4). It states the source
 * of the notes and the fact that the picture is not analysed.
 */
export const VIDEO_RECORD_HONESTY =
  'NoteSnap is listening to your take. The notes you see afterwards come from what it hears in the sound — the video is the picture, not the source of the notes.';

/** The storage promise the owner asked to be visible on the record screen. */
export const VIDEO_STAYS_ON_PHONE_LINE =
  'This video stays on your phone until you share it yourself.';

/** The locked scope: only the user's OWN take is filmed here (decision 4). */
export const VIDEO_OWN_TAKE_ONLY_LINE =
  'This films your own take, and the notes come from that same take. NoteSnap never reads the notes off the picture.';

/**
 * THE ONE-MIC FALLBACK'S OWN LINE (decision 2, KEEP-SOUND). When the phone will
 * not run the camera's microphone and the app's recorder at the same time, the
 * video keeps its own sound and the notes come from a separate take of the same
 * phrase — and the surface says exactly that, rather than pretending the two are
 * the same performance.
 */
export const VIDEO_SEPARATE_TAKE_LINE =
  'The notes here come from a separate take of the same phrase — your video kept its own sound. Use the sync buttons to line them up if you want.';

/** Why the one-mic fallback's offset starts at zero (it is not a measurement). */
export const VIDEO_SEPARATE_TAKE_OFFSET_REASON =
  'Two separate recordings start at their own beginnings; there is no shared start to measure.';

/** The video-only outcome: the picture is kept and is still sendable (no dead end). */
export const VIDEO_TAKE_FAILED_LINE =
  'Your video is saved and you can still send it. NoteSnap could not read a melody from this take, so there are no notes to draw.';

/** Shown when the video file itself is gone (a row never pretends to play it). */
export const VIDEO_MISSING_LINE =
  'The video for this recording is no longer on this device. Your take, its notation and its MIDI export are all still here.';

/** One cue on the video's timeline. */
export interface VideoCue {
  /** Index into the take's note list (the overlay addresses notes by this). */
  index: number;
  midi: number;
  /** Onset on the VIDEO's timeline, in seconds. */
  startSec: number;
  /** End on the VIDEO's timeline, in seconds. */
  endSec: number;
}

export interface VideoCueSet {
  cues: VideoCue[];
  /** How many of the take's notes fall inside the video. */
  inVideoCount: number;
  /** How many were dropped for falling outside it. */
  droppedCount: number;
  /** How many notes the take has in total. */
  totalCount: number;
  /** Why cues were dropped, or null when none were. */
  droppedReason: string | null;
}

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp an offset into the user-facing band (integer ms). */
export function clampVideoOffset(ms: number): number {
  const value = Math.round(Number(ms));
  if (!Number.isFinite(value)) return 0;
  return Math.min(VIDEO_OFFSET_BOUNDS_MS, Math.max(-VIDEO_OFFSET_BOUNDS_MS, value));
}

/**
 * THE MEASURED OFFSET (decision 1). `audioStartMs − videoStartMs`, integer ms,
 * positive when the audio capture came up after the video. Nothing is clamped
 * here: the measurement is stored as measured, and the CLAMP belongs to the
 * user-facing nudge (clamping a measurement would hide a capture that started
 * seconds late — the very thing worth seeing).
 */
export function captureSyncOffsetMs(input: {
  videoStartMs: number;
  audioStartMs: number;
}): number {
  const video = finiteOr(input?.videoStartMs, 0);
  const audio = finiteOr(input?.audioStartMs, 0);
  return Math.round(audio - video);
}

/**
 * THE ONE-MIC FALLBACK'S OFFSET (decision 2). The two recordings are separate
 * performances of the same phrase: neither is a measurement of the other, so the
 * pair starts at zero and the surface prints VIDEO_SEPARATE_TAKE_LINE so the user
 * knows the alignment is theirs to make. It exists as a function rather than a
 * literal `0` so that the "the offset is measured, never assumed" guard can never
 * be satisfied by a silent zero.
 */
export function separateTakeOffset(): number {
  return 0;
}

/** Move the offset by `delta`, hard-clamped to the band. */
export function nudgeOffset(
  current: number,
  delta: number,
  bounds: number = VIDEO_OFFSET_BOUNDS_MS,
): number {
  const limit = Math.max(0, Math.round(finiteOr(bounds, VIDEO_OFFSET_BOUNDS_MS)));
  const next = Math.round(finiteOr(current, 0)) + Math.round(finiteOr(delta, 0));
  return Math.min(limit, Math.max(-limit, next));
}

/** The first onset of the take, in seconds, or null when it has no notes. */
export function firstOnsetSec(take: SavedCaptureTake | null | undefined): number | null {
  const notes = Array.isArray(take?.notes) ? take.notes : [];
  let first: number | null = null;
  for (const note of notes) {
    const start = Number(note?.startSec);
    if (!Number.isFinite(start)) continue;
    if (first === null || start < first) first = start;
  }
  return first;
}

/**
 * THE `Set from my first note` ASSIST (brief §3.2, pure math). The user pauses
 * the video on their own first note and taps: the offset that puts the take's
 * first onset at the tap is `tapSec − firstOnsetSec`, clamped to the same band.
 * Returns null when the take has no notes — there is nothing to align.
 */
export function offsetFromFirstNoteTap(input: {
  tapSec: number;
  firstOnsetSec: number | null;
  bounds?: number;
}): number | null {
  const tap = Number(input?.tapSec);
  const onset = input?.firstOnsetSec;
  if (!Number.isFinite(tap) || onset === null || !Number.isFinite(Number(onset))) return null;
  const raw = (tap - Number(onset)) * 1000;
  const limit = Math.max(0, Math.round(finiteOr(input?.bounds, VIDEO_OFFSET_BOUNDS_MS)));
  return Math.min(limit, Math.max(-limit, Math.round(raw)));
}

/** `+120 ms`, `−80 ms`, `no offset` — the number as the sync row shows it. */
export function formatOffset(ms: number): string {
  const value = Math.round(finiteOr(ms, 0));
  if (value === 0) return 'no offset';
  return value > 0 ? `+${value} ms` : `−${Math.abs(value)} ms`;
}

/**
 * THE MAPPING (brief §3.1). Every cue comes from `SavedCaptureTake.notes` — the
 * same array the MIDI export and the PDF read — so the overlay cannot drift from
 * them: they are the same numbers. Cues whose onset falls outside
 * `[0, videoDurationSec)` are DROPPED, not clamped, and counted.
 *
 * READS ONLY: `take.notes` is never written, reordered or re-timed.
 */
export function noteCuesForVideo(
  take: SavedCaptureTake | null | undefined,
  input: { audioOffsetMs?: number; videoDurationSec: number },
): VideoCueSet {
  const notes: ReadonlyArray<MidiNoteEvent> = Array.isArray(take?.notes) ? take.notes : [];
  const offsetSec = finiteOr(input?.audioOffsetMs, 0) / 1000;
  const duration = Math.max(0, finiteOr(input?.videoDurationSec, 0));
  const cues: VideoCue[] = [];
  let dropped = 0;
  notes.forEach((note, index) => {
    const midiRaw = Number(note?.midi);
    const startRaw = Number(note?.startSec);
    if (!Number.isFinite(midiRaw) || !Number.isFinite(startRaw)) {
      dropped += 1;
      return;
    }
    const start = startRaw + offsetSec;
    const length = Math.max(0, finiteOr(note?.durationSec, 0));
    // DROP, NEVER CLAMP: a note that starts after the video ended (or before it
    // began, once the offset is negative) never happened on this timeline.
    if (start < 0 || start >= duration) {
      dropped += 1;
      return;
    }
    cues.push({
      index,
      midi: Math.round(midiRaw),
      startSec: start,
      endSec: start + length,
    });
  });
  return {
    cues,
    inVideoCount: cues.length,
    droppedCount: dropped,
    totalCount: notes.length,
    droppedReason: dropped > 0 ? VIDEO_NOTES_DROPPED_LINE : null,
  };
}

/** `"3 of 4 notes fall inside the video"` — the honest count under the lane. */
export function videoCueCountLine(set: VideoCueSet | null | undefined): string | null {
  if (!set || set.totalCount === 0) return null;
  if (set.droppedCount === 0) return null;
  return `${set.inVideoCount} of ${set.totalCount} notes fall inside the video`;
}

/** The length/size facts of a filmed take, both from real values only. */
export function videoClock(seconds: number): string {
  const total = Math.max(0, Math.round(finiteOr(seconds, 0)));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** `0:41 · 18.4 MB` — the size half is dropped when it is not known. */
export function videoSizeLine(seconds: number, bytes: number | null | undefined): string {
  const clock = videoClock(seconds);
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return clock;
  const mb = size / (1024 * 1024);
  return `${clock} · ${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}
