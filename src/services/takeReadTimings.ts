/**
 * takeReadTimings.ts — WHERE THE SECONDS GO (vc61 spec, part 2).
 *
 * THE QUESTION THIS ANSWERS. The owner says the read is *"almost unusable"*, and nobody on
 * this team knows yet whether the seconds are in the upload, the server's decode, the pitch
 * pass or the staff draw. vc62 — moving the read onto the on-device decoder — is 5–7
 * engineer-days and is HELD until these numbers say the network is the bottleneck. Building
 * "a faster way" on a guess is exactly how vc58 failed, so vc61 measures before it fixes.
 *
 * WHAT IS MEASURED, AND WHAT IS NOT. Every number here is a real elapsed millisecond span
 * taken on the device (`Date.now()` around the code that ran), never an estimate:
 *
 *   • `upload`       the provider call: the multipart POST, the server's decode and the
 *                    response coming back. ONE span, because in the current code the request
 *                    is a single awaited call and the client cannot see inside it. The
 *                    server's own decode is therefore inside this number, not beside it.
 *   • `clientDecode` the phone's own work after the answer: base64 PCM16 → Float32 and the
 *                    resample to the coach rate.
 *   • `pitch`        `detectPitchFramesAsync` — the sliced YIN pass on the JS thread.
 *   • `build`        `buildCaptureTake` — turning the frames into the notes the staff draws.
 *   • `total`        the whole read, measured by the screen from press to result.
 *
 * THE STAFF DRAW IS NOT SEPARABLE IN THIS CODE, AND IS NOT INVENTED HERE. The staff is drawn
 * by ABCjs inside a WebView, and the only thing that document ever posts back is its own
 * height (`services/scoreHeight.ts`). Nothing in the current code times the paint, so the
 * line prints `draw=?` and the module says why — a made-up draw time would steer vc62 at the
 * wrong stage, which is the whole failure this part exists to avoid.
 *
 * PURE: no react, no react-native, no fs, no network. Asserted by
 * scripts/vc61ReadClockAndReader.test.ts.
 */

/** The stages the current code can actually time. */
export type TakeReadStage = 'upload' | 'clientDecode' | 'pitch' | 'build';

/** Every stage key the timings line can print, including the two that are not separable. */
export type TakeReadLineStage = TakeReadStage | 'total' | 'draw';

/** One read, as measured. */
export interface TakeReadTiming {
  /** ISO stamp of when the read finished — so a slow read can be told from a fast one. */
  at: string;
  /** The take's own length in seconds, when the screen knew it. */
  audioSec: number | null;
  /** The measured spans, in milliseconds. A missing stage was not measured. */
  stages: Partial<Record<TakeReadStage, number>>;
  /** The whole read, press to result, in milliseconds. */
  totalMs: number | null;
}

/** How many reads are kept for comparison. */
export const READ_TIMINGS_MAX_KEPT = 5;

/** The card's own label: a measurement, said as one. */
export const READ_TIMINGS_LABEL = 'Read timings — where the time went on this phone';

/** Why the staff draw is missing from every line (see this file's header). */
export const READ_DRAW_NOT_MEASURED_NOTE =
  'draw=? — the staff is drawn by ABCjs inside a WebView and nothing in this build times the paint. It is left out rather than guessed.';

/**
 * The stage names as the line prints them. Short, stable keys on purpose: the owner and the
 * lead compare the same line across builds, so a renamed key would look like a new stage.
 */
export const READ_STAGE_KEYS: ReadonlyArray<{ stage: TakeReadLineStage; key: string }> = [
  { stage: 'total', key: 'total' },
  { stage: 'upload', key: 'upload' },
  { stage: 'clientDecode', key: 'unpack' },
  { stage: 'pitch', key: 'pitch' },
  { stage: 'build', key: 'build' },
  { stage: 'draw', key: 'draw' },
];

/** Milliseconds → `8400ms`, or `?` when the stage was not measured (never a zero). */
export function timingValue(value: unknown): string {
  if (value === null || value === undefined) return '?';
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return '?';
  return `${Math.round(ms)}ms`;
}

/**
 * THE ONE LINE the card prints for a read:
 *
 *   read: total=8400ms upload=6100ms unpack=180ms pitch=1900ms build=220ms draw=?
 *
 * Key order is fixed so two builds can be compared by eye, and every stage that was not
 * measured is `?` rather than a guess.
 */
export function readTimingsLine(timing: TakeReadTiming | null | undefined): string {
  const value = timing ?? null;
  if (!value) return 'read: no read has finished on this phone yet.';
  const stages = value.stages ?? {};
  const parts = READ_STAGE_KEYS.map(({ stage, key }) => {
    if (stage === 'total') return `${key}=${timingValue(value.totalMs)}`;
    if (stage === 'draw') return `${key}=?`;
    return `${key}=${timingValue(stages[stage])}`;
  });
  return `read: ${parts.join(' ')}`;
}

/** The take's own length beside the line, so a slow read can be scaled by what it read. */
export function readTimingsAudioLine(timing: TakeReadTiming | null | undefined): string | null {
  const audio = Number(timing?.audioSec);
  if (!Number.isFinite(audio) || audio <= 0) return null;
  return `this read covered ${audio.toFixed(audio >= 10 ? 0 : 1)}s of audio`;
}

/** Keep the newest reads first, capped — a slow read sits beside the fast one it beat. */
export function pushReadTiming(
  history: ReadonlyArray<TakeReadTiming> | null | undefined,
  timing: TakeReadTiming | null,
  max: number = READ_TIMINGS_MAX_KEPT,
): TakeReadTiming[] {
  const kept = Array.isArray(history) ? history.filter((entry) => !!entry) : [];
  if (!timing) return kept.slice(0, max);
  const limit = Math.max(1, Math.round(Number(max) || READ_TIMINGS_MAX_KEPT));
  return [timing, ...kept].slice(0, limit);
}

/** A stage recorder: the screen and the read pipeline hand spans into one of these. */
export interface StageRecorder {
  /** Record one measured span (milliseconds). Negative / non-finite spans are ignored. */
  record: (stage: TakeReadStage, ms: number) => void;
  /** Everything recorded so far. */
  stages: Partial<Record<TakeReadStage, number>>;
}

/**
 * Build a recorder. The pipeline reports into it as each stage finishes; the screen reads
 * `stages` when the read settles. Nothing here rounds or adjusts a measurement.
 */
export function createStageRecorder(): StageRecorder {
  const stages: Partial<Record<TakeReadStage, number>> = {};
  return {
    stages,
    record(stage, ms) {
      const value = Number(ms);
      if (!Number.isFinite(value) || value < 0) return;
      stages[stage] = Math.round(value);
    },
  };
}

/** Assemble the finished timing from what was recorded. */
export function finishReadTiming(input: {
  stages: Partial<Record<TakeReadStage, number>> | null | undefined;
  totalMs: number | null | undefined;
  audioSec?: number | null;
  at?: string;
}): TakeReadTiming {
  // AN UNMEASURED TOTAL IS NULL, NOT ZERO. `Number(null)` is 0, which would print a
  // real-looking `total=0ms` for a read nobody timed — the same invention the draw is
  // left out to avoid. Only a number that was actually handed in can be a measurement.
  const rawTotal = input?.totalMs;
  const total = rawTotal === null || rawTotal === undefined ? Number.NaN : Number(rawTotal);
  const audio = Number(input?.audioSec);
  return {
    at: typeof input?.at === 'string' && input.at.length > 0 ? input.at : new Date().toISOString(),
    audioSec: Number.isFinite(audio) && audio > 0 ? audio : null,
    stages: { ...(input?.stages ?? {}) },
    totalMs: Number.isFinite(total) && total >= 0 ? Math.round(total) : null,
  };
}
