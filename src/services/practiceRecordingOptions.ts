/**
 * practiceRecordingOptions.ts — THE TWO RECORD-SCREEN CHOICES THE OWNER ASKED FOR
 * (vc49 device batch, owner email 11-03 "Edits"; both hit on a real device).
 *
 *   1. A COUNT-IN before capture starts (off / 3 s / 5 s), so the user can set the
 *      phone down and get to their instrument.
 *   2. A RECORDING LENGTH the user chooses, bounded by the existing 3-minute cap,
 *      with a running clock and the time remaining.
 *
 * ── THE CLOCK RULE (why the count-in cannot desynchronise the notes) ──────────
 *
 * The notes are placed on the VIDEO's clock: every cue is
 * `note.startSec + audioOffsetMs / 1000`, and `audioOffsetMs` is the MEASURED
 * difference between `videoStartMsRef` and `audioStartMsRef` — both stamped at the
 * moment each capture really starts (services/videoTakeSync.ts,
 * `captureSyncOffsetMs`). A count-in that ran INSIDE a capture, or that stamped a
 * start before it, would move that pair apart and every note would sit early by
 * the count-in's length.
 *
 * So the count-in is a PHASE BEFORE any capture exists: `startBothCaptures` — the
 * one function that stamps the two clocks and asks the camera to record — is only
 * ever called AFTER the countdown reaches zero, and it takes no count-in input at
 * all. Nothing is recording during the count-in, so there is nothing to offset.
 * The guard for this is `v49DeviceBatchContract.countInCannotShiftTheTakeStart`,
 * proven to bite by mutation.
 *
 * ── THE LENGTH RULE (why the control cannot exceed the cap) ───────────────────
 *
 * `PRACTICE_VIDEO_MAX_SECONDS` (180 s) is the hard bound and it stays on the
 * `recordAsync` call itself, so a device that ignores our timer still stops. The
 * user's choice is a SECOND, inner bound: `clampRecordingLength` never returns
 * more than the cap, and every write of the choice goes through it. The screen
 * stops itself when the chosen length is reached and hands the take to the trim
 * step — never a silent truncation, never a file left open.
 *
 * PURE: no react, no react-native, no expo, no fs, no network.
 */
import { PRACTICE_VIDEO_MAX_SECONDS } from './practiceVideoRef';

// ─────────────────────────────────────────────────────────────────────────────
// THE COUNT-IN
// ─────────────────────────────────────────────────────────────────────────────

/** Off, three seconds, five seconds — the owner's ask, and nothing longer. */
export const COUNT_IN_OPTIONS: readonly number[] = [0, 3, 5];
export const COUNT_IN_DEFAULT = 0;

export const COUNT_IN_LABEL = 'Count-in before filming';
export const COUNT_IN_HINT =
  'A countdown before anything is recorded, so you can put the phone down and pick up your instrument. Nothing is filmed during it, so your notes stay lined up with the video.';
export const COUNT_IN_OFF_LABEL = 'Off';
/** Said while the countdown runs — the honest reason it cannot move the notes. */
export const COUNT_IN_HONESTY =
  'Nothing is being recorded yet. Filming and the take both start together when the count reaches zero, so the notes stay on the video’s clock.';
export const COUNT_IN_CANCEL_CTA = 'Cancel the count-in';
export const COUNT_IN_DONE_LINE = 'Recording now.';

/** A stored/typed count-in value, forced onto one of the three real choices. */
export function normaliseCountIn(value: number): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return COUNT_IN_DEFAULT;
  return COUNT_IN_OPTIONS.indexOf(seconds) >= 0 ? seconds : COUNT_IN_DEFAULT;
}

/** `Off` / `3 s` / `5 s` — the chip's own label. */
export function countInLabel(value: number): string {
  const seconds = normaliseCountIn(value);
  return seconds === 0 ? COUNT_IN_OFF_LABEL : `${seconds} s`;
}

/** What the big countdown says on the record screen. */
export function countInCountdownLine(remaining: number): string {
  const left = Math.max(0, Math.round(Number(remaining) || 0));
  if (left <= 0) return COUNT_IN_DONE_LINE;
  return `Starting in ${left}…`;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RECORDING LENGTH
// ─────────────────────────────────────────────────────────────────────────────

/** The lengths the user may pick — every one at or below the 3-minute cap. */
export const RECORDING_LENGTH_OPTIONS: readonly number[] = [30, 60, 120, 180];
export const RECORDING_LENGTH_DEFAULT = PRACTICE_VIDEO_MAX_SECONDS;
/** Below this a take has nothing in it; the control never offers it. */
export const RECORDING_LENGTH_MIN_SECONDS = 5;

export const RECORDING_LENGTH_LABEL = 'Recording length';
export const RECORDING_LENGTH_HINT =
  'Filming stops itself at this length and your take goes straight to the trim step. You can always press Stop sooner.';
export const RECORDING_LENGTH_REACHED_LINE =
  'That is the length you chose — your take is saved. Trim it below if you want a shorter window.';

/**
 * THE BOUND. A choice can never exceed the app's cap: a longer value is cut to
 * `PRACTICE_VIDEO_MAX_SECONDS`, a nonsense value falls back to the default, and
 * anything under the minimum is raised to it. The record call keeps its own
 * `maxDuration` at the cap as well, so this is a second bound, not the only one.
 */
export function clampRecordingLength(value: number): number {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return RECORDING_LENGTH_DEFAULT;
  return Math.min(PRACTICE_VIDEO_MAX_SECONDS, Math.max(RECORDING_LENGTH_MIN_SECONDS, seconds));
}

/** `0:30` / `3:00` — a length, on a clock. */
export function recordingClock(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** `0:30` — the chip's own label. */
export function recordingLengthLabel(value: number): string {
  return recordingClock(clampRecordingLength(value));
}

/** How much of the CHOSEN length is left (0 means the length is reached). */
export function recordingLengthRemaining(elapsedSec: number, lengthSec: number): number {
  const elapsed = Math.max(0, Math.round(Number(elapsedSec) || 0));
  return Math.max(0, clampRecordingLength(lengthSec) - elapsed);
}

/**
 * THE RUNNING LINE: how long has been recorded and how much of the chosen length
 * is left. Both numbers come from the same clock the timer draws, so the surface
 * can never show a countdown that disagrees with the elapsed time beside it.
 */
export function recordingProgressLine(elapsedSec: number, lengthSec: number): string {
  const elapsed = Math.max(0, Math.round(Number(elapsedSec) || 0));
  const length = clampRecordingLength(lengthSec);
  const remaining = Math.max(0, length - elapsed);
  return `${recordingClock(elapsed)} recorded · ${recordingClock(remaining)} left of ${recordingClock(length)}`;
}

/** Has the chosen length been reached? (the screen's own stop trigger) */
export function recordingLengthReached(elapsedSec: number, lengthSec: number): boolean {
  const elapsed = Math.max(0, Math.round(Number(elapsedSec) || 0));
  return elapsed >= clampRecordingLength(lengthSec);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CAMERA FLIP
// ─────────────────────────────────────────────────────────────────────────────

/** Which way the camera looks. `back` is the default (films the room). */
export type CameraFacing = 'back' | 'front';

export const FLIP_CAMERA_CTA = '⟲ Flip camera';
export const FLIP_CAMERA_HINT =
  'Turn the camera around to film yourself playing. You can flip before you start filming — not while a recording is running.';
/** What the surface says when the flip is offered. */
export const CAMERA_BACK_LINE = 'Filming the room — flip to film yourself.';
export const CAMERA_FRONT_LINE = 'Filming you — flip back to film the room.';
/** Why the control is not usable mid-take: said, never a dead button. */
export const FLIP_LOCKED_LINE =
  'You can flip the camera before you start — not while it is filming.';
