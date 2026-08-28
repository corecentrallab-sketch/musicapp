/**
 * loudnessGate.ts — pre-upload capture-quality gate for recognition.
 *
 * WHY: the server-side robust landmark matcher is proven correct on real captures
 * (a genuine Für Elise capture matches conf 1.000), yet on-device recognition
 * returns "No Match" because most real captures are silent or degraded (8/11 of
 * the owner's persisted captures decode to pure ~-91 dBFS digital silence; the
 * one audio-bearing degraded capture has music confined to its final ~2.5 s and
 * cannot name a piece without a false positive).
 *
 * The app's own on-screen capture meter showed healthy peaks even on those silent
 * recordings. Root cause (brief #2): the meter reads `MediaRecorder.getMaxAmplitude()`
 * (expo-av Android), which is the PRE-ENCODE AGC-boosted mic gain — NOT the actual
 * loudness of the signal that ends up encoded/uploaded. Android's AGC pumps gain
 * to maximum on quiet input, producing brief loud spikes (the on-screen "-4 dB
 * peak") while the encoded body stays at the room-noise floor (~-91 dBFS decoded).
 * So the metered value is genuinely the same buffer the app uploads, but it is
 * AGC-distorted and CANNOT be trusted to gate real loudness.
 *
 * Therefore the authoritative gate must run on the DECODED audio of the actual
 * uploaded buffer: peak, RMS and an "audible music spread across the window"
 * (active-fraction relative to the capture's own peak, so a loud tail buried
 * under a quiet floor is recognised as NOT spread). The decision rule below was
 * validated against the real decoded captures:
 *
 *   GENUINE Für Elise  (e2cc8a05, 132 s) -> PASS   (peak -3.2, rms -21.2, active 78%)
 *   Ctrl capture       (e9b5e432, 8 s)   -> PASS   (peak -4.5, rms -15.7, active 100%)
 *   Silent captures    (8 files)         -> BLOCK silent     (peak/rms ≈ -90 dB)
 *   Degraded tail-only (b270decd, 12 s)  -> BLOCK not-spread (active 32% < 40%)
 *
 * The thresholds are the values that separate those real captures; a genuine
 * capture MUST pass, and every silent/too-short/not-spread capture MUST fail.
 */

export type GateVerdict =
  | 'pass'
  | 'warn' // audible but marginal (quiet) — allow, but tell the user
  | 'block'; // silent / too-short / music-not-spread — do NOT upload a useless clip

export interface LoudnessMetrics {
  verdict: GateVerdict;
  reason:
    | 'ok'
    | 'quiet'
    | 'silent'
    | 'too-short'
    | 'not-spread'
    | 'empty'
    | 'unknown';
  peakDb: number;
  rmsDb: number;
  activeFraction: number; // 0..1
  durationSec: number;
}

// --- Thresholds (validated against the 11 real captures, see header) ---
const HARD_PEAK_DB = -50; // decoded peak below this => effectively digital silence
const HARD_RMS_DB = -55; // decoded RMS below this => effectively silence
const MIN_DURATION_SEC = 3; // clips shorter than this cannot carry recognisable music
const MIN_ACTIVE_FRACTION = 0.4; // audible music must cover >= 40% of the window
const REL_TO_PEAK_DB = 24; // a 50 ms frame is "active" if within 24 dB of global peak
const ABS_FRAME_FLOOR_DB = -55; // ...and above an absolute -55 dBFS floor
const WARN_PEAK_DB = -35; // below this (but not silent) => "quiet" warning
const WARN_RMS_DB = -45;

const DB_FLOOR = -90;

function toDb(x: number): number {
  return x > 1e-9 ? 20 * Math.log10(x) : DB_FLOOR;
}

/**
 * Evaluate loudness of a decoded mono PCM buffer.
 *
 * @param samples  decoded interleaved-mono float32 samples (range ~[-1, 1])
 * @param sampleRate  sample rate of `samples`
 */
export function evaluateLoudness(
  samples: Float32Array | number[],
  sampleRate: number,
): LoudnessMetrics {
  const n = samples.length;
  if (!n) {
    return {
      verdict: 'block',
      reason: 'empty',
      peakDb: -Infinity,
      rmsDb: -Infinity,
      activeFraction: 0,
      durationSec: 0,
    };
  }

  // Global peak + full-window RMS (decoded — the authoritative loudness).
  let peak = 0;
  let sumsq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumsq += a * a;
  }
  const rms = Math.sqrt(sumsq / n);
  const peakDb = toDb(peak);
  const rmsDb = toDb(rms);

  // Active-fraction: a 50 ms frame is musical only if its RMS is within
  // REL_TO_PEAK_DB of the global peak AND above an absolute floor. Relative-to-
  // peak is what separates a genuine full capture (music everywhere) from a
  // degraded tail-only capture whose energy sits on a quiet room-rumble floor.
  const frameLen = Math.max(1, Math.round(0.05 * sampleRate));
  const absFloor = 10 ** (ABS_FRAME_FLOOR_DB / 20);
  const relFloor = peak * 10 ** (-REL_TO_PEAK_DB / 20);
  let active = 0;
  let frames = 0;
  for (let off = 0; off < n; off += frameLen) {
    const end = Math.min(n, off + frameLen);
    let fsq = 0;
    for (let i = off; i < end; i++) fsq += samples[i] * samples[i];
    const f = Math.sqrt(fsq / (end - off));
    if (f >= absFloor && f >= relFloor) active++;
    frames++;
  }
  const activeFraction = frames ? active / frames : 0;
  const durationSec = n / sampleRate;

  // --- Decision rule (in priority order) ---
  let verdict: GateVerdict = 'pass';
  let reason: LoudnessMetrics['reason'] = 'ok';

  if (peakDb < HARD_PEAK_DB || rmsDb < HARD_RMS_DB) {
    verdict = 'block';
    reason = 'silent';
  } else if (durationSec < MIN_DURATION_SEC) {
    verdict = 'block';
    reason = 'too-short';
  } else if (activeFraction < MIN_ACTIVE_FRACTION) {
    verdict = 'block';
    reason = 'not-spread';
  } else if (peakDb < WARN_PEAK_DB || rmsDb < WARN_RMS_DB) {
    verdict = 'warn';
    reason = 'quiet';
  }

  return { verdict, reason, peakDb, rmsDb, activeFraction, durationSec };
}

/**
 * Best-available on-device fallback gate, run WITHOUT decoding the AAC (see the
 * module header for why the expo-av AGC meter can't measure true loudness).
 * It uses the metering time-series (dB) captured during recording plus capture
 * metadata, and blocks only the UNAMBIGUOUS dead captures: a dead mic / truly
 * silent room / truncated clip. It deliberately does NOT try to catch AGC-boosted
 * near-silence, because that signal is indistinguishable from quiet-but-real audio
 * on the metering scale — only the decoded `evaluateLoudness` gate can.
 *
 * This fallback runs today; `evaluateLoudness` becomes active once a Hermes-safe
 * AAC decode seam is wired (see NOTES in the build/report). The verdict shape is
 * identical so callers don't care which source produced it.
 */
export function gateFromMetering(
  meteringDb: number[],
  durationMs: number | null,
  bytes: number | null,
): LoudnessMetrics {
  const ms = meteringDb.filter((v) => Number.isFinite(v));
  const durationSec = durationMs != null ? durationMs / 1000 : 0;

  // Truncated / empty clip (reuse the captureTelemetry trick).
  if ((bytes != null && bytes > 0 && bytes < 4000) || (durationSec > 0 && durationSec < 0.5)) {
    return {
      verdict: 'block', reason: 'too-short', peakDb: -90, rmsDb: -90,
      activeFraction: 0, durationSec,
    };
  }

  if (ms.length === 0) {
    // No metering available — cannot judge real loudness this way. Let it through
    // (the server still 400s on true silence); the decoded gate is authoritative.
    return { verdict: 'pass', reason: 'ok', peakDb: -90, rmsDb: -90, activeFraction: 0, durationSec };
  }

  // Median metering — robust to brief AGC spikes (a dead mic yields a low median;
  // real music sustains a much higher median). Block only clear silence.
  const sorted = [...ms].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const peak = Math.max(...sorted);
  // A sustained signal must have a meaningful share of samples above -45 dB.
  const audibleCount = ms.filter((v) => v > -45).length;
  const audibleRatio = ms.length ? audibleCount / ms.length : 0;

  if (peak < -50 || (median < -48 && audibleRatio < 0.15)) {
    return {
      verdict: 'block', reason: 'silent', peakDb: peak, rmsDb: median,
      activeFraction: audibleRatio, durationSec,
    };
  }
  if (peak < -35 || median < -45) {
    return {
      verdict: 'warn', reason: 'quiet', peakDb: peak, rmsDb: median,
      activeFraction: audibleRatio, durationSec,
    };
  }
  return { verdict: 'pass', reason: 'ok', peakDb: peak, rmsDb: median, activeFraction: audibleRatio, durationSec };
}

/** Human-readble action message for a gate verdict. */
export function gateMessage(m: LoudnessMetrics): string {
  switch (m.reason) {
    case 'silent':
      return 'No audible audio detected in that recording. Make sure music is playing loudly right next to the phone for the whole capture, then try again.';
    case 'too-short':
      return 'That capture was too short to identify. Please record at least 3 seconds of music.';
    case 'not-spread':
      return 'Only a little audible music was captured and it was not spread across the recording. Keep music playing for the whole capture — not just the end — then try again.';
    case 'quiet':
      return 'The music was pretty quiet. Turn it up / move the phone closer for a cleaner match.';
    default:
      return '';
  }
}
