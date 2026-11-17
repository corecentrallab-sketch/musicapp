/**
 * takeReadClock.ts — THE READ GETS A CLOCK (vc61 spec, part 1; owner 11-17).
 *
 * THE OWNER, verbatim: *"The speed… is too slow. It's almost unusable… there has to be a
 * faster way of processing the score. The user also needs to be made aware that the sample
 * is being processed… like some sort of countdown."* And on row 5: *"he cannot [do another
 * take] as you have to wait a long time for the notes to be processed."*
 *
 * WHAT THIS MODULE IS. The arithmetic of the clock the lane shows while the notes are being
 * read: elapsed seconds ALWAYS, and a remaining estimate **only when it is earned**.
 *
 * ── THE ONE RULE THAT MATTERS: NO FABRICATED COUNTDOWN ────────────────────────────
 *
 * A countdown that runs to zero and then sits there is worse than no countdown: it tells the
 * user the app is broken at the exact moment it is still working. So an estimate is only
 * offered once THIS DEVICE has completed a read and we know how many seconds of audio it
 * processed per second of wall clock (`throughput`). Before that, the lane prints the elapsed
 * time and the honest ceiling ("This can take up to a minute") — a bound, not a prediction.
 *
 * The throughput is persisted per device by `takeReadThroughput.ts`; this file is the pure
 * half (no react, no react-native, no storage, no network), so the tier1 gate can pin every
 * branch of the rule with no device in the loop.
 *
 * WHY IT IS NOT THE READ ITSELF. vc61 changes nothing about how the notes are read: it is
 * still the same network POST. This module only measures the wait and says what it knows.
 */

/** How often the lane re-reads the clock while a read is in flight (ms). */
export const READ_CLOCK_TICK_MS = 250;

/**
 * THE HONEST CEILING, said before any measurement exists. It is a bound on how long the app
 * will wait before it stops waiting quietly (`TAKE_DECODE_TIMEOUT_MS` is 45 s in the screen),
 * never a prediction of the time this take will take.
 */
export const READ_CEILING_SECONDS = 60;

/** The sentence that goes with the ceiling. */
export const READ_CEILING_LINE = 'This can take up to a minute.';

/**
 * HOW MANY COMPLETED READS THE DEVICE KEEPS. A handful, not a history: the estimate only
 * needs to know roughly how this phone behaves, and one slow read on a busy phone should not
 * poison the next one (the median does that job).
 */
export const READ_THROUGHPUT_MAX_SAMPLES = 5;

/**
 * The fastest and slowest throughput the clock will believe, in "seconds of audio processed
 * per second of wall clock". Below the floor a read would be so slow that any estimate is
 * noise; above the ceiling a sample is a measurement error (a 1-second take read in 1 ms).
 */
export const READ_THROUGHPUT_FLOOR = 0.02;
export const READ_THROUGHPUT_CEILING = 200;

/** The control that re-runs a failed or stalled read. Same words as the spec. */
export const READ_RETRY_CTA = 'Try the read again';

/**
 * THE WAY OUT OF THE ROW-5 TRAP, next to the clock: the user may start another take while a
 * read is still running. Nothing is cancelled — the read keeps going and lands on its own
 * take (see the screen's `startTakeRead`).
 */
export const READ_START_ANOTHER_CTA = 'Start another take';

/** One line of the progress state, before it is turned into a sentence. */
export interface ReadProgress {
  /** Whole seconds the read has been running. */
  elapsedSec: number;
  /** The take's own length in seconds, when it is known. */
  audioSec: number | null;
  /** Remaining seconds, or null when no estimate is earned yet. */
  remainingSec: number | null;
}

/** `0:07` — the elapsed clock, in the same shape as every other clock in the app. */
export function readClock(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/** A throughput sample, or null when the numbers cannot produce one. */
export function throughputFromRead(input: {
  audioSec?: number | null;
  readMs?: number | null;
}): number | null {
  const audio = Number(input?.audioSec);
  const ms = Number(input?.readMs);
  if (!Number.isFinite(audio) || !Number.isFinite(ms)) return null;
  if (audio <= 0 || ms <= 0) return null;
  const value = audio / (ms / 1000);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < READ_THROUGHPUT_FLOOR || value > READ_THROUGHPUT_CEILING) return null;
  return value;
}

/** Keep the most recent samples, oldest dropped first. */
export function pushThroughput(
  samples: ReadonlyArray<number> | null | undefined,
  sample: number | null,
  max: number = READ_THROUGHPUT_MAX_SAMPLES,
): number[] {
  const kept = (Array.isArray(samples) ? samples : []).filter(
    (value) => Number.isFinite(Number(value)) && Number(value) > 0,
  );
  if (sample === null || !Number.isFinite(sample) || sample <= 0) return kept.slice(-max);
  const limit = Math.max(1, Math.round(Number(max) || READ_THROUGHPUT_MAX_SAMPLES));
  return [...kept, sample].slice(-limit);
}

/**
 * The device's throughput: the MEDIAN of the samples it has kept. Median, not mean, so one
 * read taken while the phone was busy cannot move the estimate on its own. Null until there
 * is at least one sample — which is exactly "no estimate is earned yet".
 */
export function medianThroughput(samples: ReadonlyArray<number> | null | undefined): number | null {
  const values = (Array.isArray(samples) ? samples : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

/**
 * THE ESTIMATE, WHEN IT IS EARNED.
 *
 * `audioSec / throughput` is how long this take should take on this device; minus the time
 * already spent is what is left. Null when:
 *   • no completed read exists on this device (no throughput) — no estimate is earned;
 *   • the take's own length is unknown — nothing to estimate from;
 *   • the arithmetic lands at or below zero — the read is over its estimate, and a countdown
 *     stuck at zero is exactly the fabricated countdown this module exists to prevent. The
 *     caller shows the ceiling sentence instead, which is still true.
 */
export function estimateRemainingSec(input: {
  audioSec?: number | null;
  elapsedMs?: number | null;
  throughput?: number | null;
}): number | null {
  const audio = Number(input?.audioSec);
  const elapsedMs = Number(input?.elapsedMs);
  const throughput = Number(input?.throughput);
  if (!Number.isFinite(audio) || audio <= 0) return null;
  if (!Number.isFinite(throughput) || throughput <= 0) return null;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const expectedSec = audio / throughput;
  const remaining = expectedSec - elapsedMs / 1000;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  return Math.max(1, Math.round(remaining));
}

/** The whole progress state, from the numbers the screen holds. */
export function readProgress(input: {
  elapsedMs: number;
  audioSec?: number | null;
  throughput?: number | null;
}): ReadProgress {
  const elapsedMs = Math.max(0, Number(input?.elapsedMs) || 0);
  const audioSec =
    Number.isFinite(Number(input?.audioSec)) && Number(input?.audioSec) > 0
      ? Number(input?.audioSec)
      : null;
  return {
    elapsedSec: Math.round(elapsedMs / 1000),
    audioSec,
    remainingSec: estimateRemainingSec({
      audioSec,
      elapsedMs,
      throughput: input?.throughput ?? null,
    }),
  };
}

/**
 * THE LANE'S CLOCK LINE. Elapsed seconds always; the remaining time only when it is earned,
 * and the honest ceiling when it is not. No percentage, no progress bar: the app does not
 * know what fraction of the read is done and must not draw a number it cannot measure.
 */
export function readClockLine(progress: ReadProgress): string {
  const elapsed = readClock(progress?.elapsedSec ?? 0);
  const remaining = progress?.remainingSec ?? null;
  if (remaining === null) return `${elapsed} so far · ${READ_CEILING_LINE}`;
  const left = readClock(remaining);
  return `${elapsed} so far · about ${left} left.`;
}

/**
 * When the lane stops pretending the wait is normal. The read has NOT failed at this point
 * (the screen keeps waiting and the take still gets its notes when they land); this is the
 * moment the surface also offers the way out — the retry and the new take.
 */
export const READ_STALL_MS = 60000;

/** True once the read has been running longer than the app is comfortable with. */
export function readIsStalled(elapsedMs: number, stallMs: number = READ_STALL_MS): boolean {
  const elapsed = Number(elapsedMs);
  const limit = Number(stallMs);
  if (!Number.isFinite(elapsed) || elapsed < 0) return false;
  return elapsed >= (Number.isFinite(limit) && limit > 0 ? limit : READ_STALL_MS);
}
