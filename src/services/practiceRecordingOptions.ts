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

/**
 * ── THE COUNT-IN'S CLOCK, AS AN ABSOLUTE DEADLINE (vc50 fix, owner 11-04) ─────
 *
 * THE DEFECT THIS REPLACES. The countdown was computed from a `started` stamp
 * taken INSIDE the effect that owned the interval. That effect listed the
 * capture callback in its dependency array, and that callback is rebuilt on every
 * render (`useAudioRecorder()` returns a fresh object each render), so the effect
 * was torn down and restarted on every render — resetting `started` and the
 * displayed number. The countdown therefore re-painted its first number forever:
 * "the count timer gets stuck and doesn't count down on 3 & 5 second intervals".
 *
 * THE RULE NOW. The count-in is a DEADLINE in epoch milliseconds, computed once
 * when the phase is entered, and the number on screen is a pure function of
 * (deadline, now). A re-render, a slow tick or a dropped frame cannot move it,
 * because nothing about it depends on when the effect last ran. The two pure
 * functions below are that rule, and `scripts/v50PracticeVideo.test.ts` proves
 * the number decrements once per second and reaches 0 exactly at the deadline.
 */
export function countInDeadline(countInSec: number, nowMs: number): number {
  const now = Number(nowMs);
  const base = Number.isFinite(now) ? now : 0;
  return base + normaliseCountIn(countInSec) * 1000;
}

/** How many whole seconds are left before the deadline (`0` = start filming). */
export function countInRemainingSec(deadlineMs: number, nowMs: number): number {
  const deadline = Number(deadlineMs);
  const now = Number(nowMs);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
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

/**
 * ── THE RECORDING CLOCK, MEASURED FROM THE START STAMP (vc50 fix, owner 11-04) ─
 *
 * THE DEFECT THIS REPLACES. The running clock took its `started` stamp inside the
 * effect that owned the interval, and that effect listed `handleStop` in its
 * dependencies — a callback rebuilt on every render (see `countInDeadline` above).
 * The metering hook re-renders the screen every 200 ms while recording, so the
 * effect restarted every 200 ms, `started` was reset every 200 ms, and the clock
 * read 0:00 for the whole take. Three owner-visible symptoms came from that one
 * line: the length timer never moved, the chosen length never triggered its stop,
 * and the take was stored with `durationSec: 0` — which is why the trim window had
 * no timeline and no length on it.
 *
 * The clock is now a pure function of (start stamp, now): the stamp is taken once,
 * when the camera is asked to record, so no ticker state can move it. The SAME
 * function measures the finished take at Stop, which is what makes a 40-second
 * take 40 seconds long no matter how many frames the JS thread dropped.
 */
export function recordingElapsedSec(startedAtMs: number, nowMs: number): number {
  const started = Number(startedAtMs);
  const now = Number(nowMs);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((now - started) / 1000));
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
