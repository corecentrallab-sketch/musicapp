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

/**
 * ── vc54, DEFECT 2 ── THE ONE-MIC PROBLEM, SAID PLAINLY, WITH THE WAY OUT.
 *
 * The notes are read from the take's own `.m4a` recording (`audioCacheUri`), made
 * by the app's recorder — NOT from the camera's soundtrack. On the handset that
 * recording can come back with no readable melody (the camera and the app's own
 * recorder share one microphone), and the take is then not a dead end: the same
 * phrase recorded with the camera OFF goes through the one decode path the hum
 * flow uses, and those notes are written onto the same row, under the same video.
 *
 * ── vc55, D22 ── THE SENTENCE USED TO NAME THE WRONG RECORDING. It said "the
 * sound the camera recorded", which is not where the notes come from — a wrong
 * cause stated confidently (defect class 11). It now names the take's audio.
 */
export const VIDEO_TAKE_ON_ITS_OWN_LINE =
  'NoteSnap could not hear a melody in the audio it recorded for this take. Play the phrase once more with the camera off — those notes are written onto this same take, under this video.';
export const VIDEO_TAKE_ON_ITS_OWN_CTA = 'Record the notes on their own';

/**
 * ── vc55, N6 ── THE SAME WAY OUT, ON THE WATCH PAGE.
 *
 * On the review page the camera-off take is written onto the row on screen. The
 * watch page is a row that is already saved WITH its video, so a camera-off take
 * started there is saved as its own take — and the line says so rather than
 * promising notes under a video they will not appear under.
 */
export const VIDEO_NOTES_ON_ITS_OWN_NEW_TAKE_LINE =
  'Play the phrase once more with the camera off — those notes are saved as their own take, and this video stays exactly as it is.';

/**
 * ── vc55, N5 ── WHAT THE EMPTY LANE SAYS WHEN THERE WAS NO MELODY AT ALL.
 *
 * The owner's row: record a take of silence or speech and the lane must say no
 * melody was heard — not that notes fell outside the window. This is the sentence
 * for a take that holds no notes at all, and it is deliberately NOT the same
 * sentence as `VIDEO_NOTES_OUTSIDE_LINE` (which is about notes that exist).
 */
export const VIDEO_NO_MELODY_LINE = 'No melody was heard in this take.';

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
  /**
   * ── vc54 ── THE TIMELINE THE CUES WERE MAPPED ONTO, in seconds. The video's
   * own length when it is known; the take's own span when it is not (see
   * `takeTimelineSec`). The surface needs it because "no cues" and "a video of
   * unknown length" are two different things and used to read the same.
   */
  timelineSec: number;
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
  /**
   * ── vc54, DEFECT 2: AN UNKNOWN VIDEO LENGTH MUST NOT SWALLOW THE TAKE ──────
   *
   * This used to be `Math.max(0, videoDurationSec)` alone, and every note with
   * `start >= duration` was dropped. So a take of twenty played notes mapped onto
   * a video whose stored length was 0 or missing produced ZERO cues — and the
   * lane, seeing an empty list, printed "there was no readable melody in this
   * take", which was not true: the melody was read, and then thrown away by this
   * line. The owner saw that sentence on every take.
   *
   * When the video's own length is not known, the take's own span IS the
   * timeline: the notes are drawn on it and nothing is dropped for being past an
   * end we do not have. A known length keeps the old drop-never-clamp rule.
   */
  const declared = Math.max(0, finiteOr(input?.videoDurationSec, 0));
  const span = takeTimelineSec(take, offsetSec);
  const duration = declared > 0 ? declared : span;
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
    timelineSec: duration,
  };
}

/**
 * ── vc54, DEFECT 2 ── THE TAKE'S OWN SPAN, in seconds on the video's timeline.
 *
 * The last moment any of the take's notes is still sounding: `max(start + len)`
 * over the notes, with the same offset the cues use. Zero when the take has no
 * timed note. It is the fallback timeline for a video whose own length was never
 * stored, so a real take of a played melody can never be mapped onto a
 * zero-length timeline and disappear.
 */
export function takeTimelineSec(
  take: SavedCaptureTake | null | undefined,
  offsetSec: number = 0,
): number {
  const notes: ReadonlyArray<MidiNoteEvent> = Array.isArray(take?.notes) ? take.notes : [];
  const offset = finiteOr(offsetSec, 0);
  let end = 0;
  for (const note of notes) {
    const start = Number(note?.startSec);
    if (!Number.isFinite(start)) continue;
    const length = Math.max(0, finiteOr(note?.durationSec, 0));
    end = Math.max(end, start + offset + length);
  }
  return Math.max(0, end);
}

/**
 * ── vc54, DEFECT 2 ── WHAT THE EMPTY LANE SAYS, AND WHY IT MATTERS.
 *
 * The lane printed ONE sentence whenever it had no cues: "there was no readable
 * melody in this take". That is only true when the take holds no notes at all.
 * A take that HAS notes but none of them inside the video window is a different
 * fact, and it has a different remedy (line them up), so it gets its own
 * sentence. The lane must never tell the owner it heard nothing when it did.
 *
 * ── vc55, N5 ── AND THE OTHER HALF, WHICH WAS STILL WRONG ON THE HANDSET. This
 * function returned `null` for a take with no notes at all, so the sentence fell
 * back to the LANE's own default — one fixed line that the owner read as "notes
 * outside the window" on a take of silence. The three cases are now decided in
 * one place and read differently:
 *   • no notes in the take at all   → VIDEO_NO_MELODY_LINE;
 *   • notes, but none on this video → VIDEO_NOTES_OUTSIDE_LINE (legitimate: the
 *     take does hold notes and they can be lined up);
 *   • an unknown video length       → NEVER a reason (the cue builder falls back
 *     to the take's own span, so nothing is dropped for it).
 */
export const VIDEO_NOTES_OUTSIDE_LINE =
  'This take has notes, but none of them fall inside the video — use “Set from my first note” to line them up.';

export function videoCueEmptyLine(set: VideoCueSet | null | undefined): string | null {
  if (!set) return null;
  if (set.cues.length > 0) return null;
  return set.totalCount > 0 ? VIDEO_NOTES_OUTSIDE_LINE : VIDEO_NO_MELODY_LINE;
}

/**
 * ── vc55, N6 ── AN EMPTY LANE IS NEVER A DEAD END (standing owner rule).
 *
 * True exactly when the lane has nothing to draw, which is when the surface owes
 * the user a real action — the camera-off take — instead of a sentence with
 * nowhere to go. Derived from the same cue set the lane draws, so the sentence
 * and the action can never disagree.
 */
export function emptyLaneNeedsAnAction(set: VideoCueSet | null | undefined): boolean {
  if (!set) return true;
  return set.cues.length === 0;
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
