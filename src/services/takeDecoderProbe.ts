/**
 * takeDecoderProbe.ts — MEASURE BEFORE SWAPPING (vc60 spec §4, VC59-DECODER-PROBE.md).
 *
 * THE QUESTION. The practice-video notes read posts the app's own .m4a to
 * `/api/coach/pcm`, which caps the upload at 4 MB and the answer at 60 seconds —
 * so a 3-minute take cannot be read that way, and a 3-minute camera mp4 is 20–60 MB.
 * The app ALREADY ships an on-device decoder (`services/tunerDecoder.ts`: a hidden
 * WebView + Chromium `decodeAudioData`, no network, no cap), wired only to the tuner
 * on short clips. Whether a FULL 3-minute decode survives on the handset is the one
 * open question, and it cannot be answered from a desk.
 *
 * WHAT THIS MODULE IS. The pure half of a probe that answers it on the owner's own
 * phone: it takes the numbers a finished attempt produced and prints ONE line.
 *
 * NOTHING HERE IS INVENTED. Every figure comes from a measurement (`?` when the
 * measurement was not available — a made-up memory number is worse than none), and
 * `survived=no` is a real result, not an error to hide: the app or the WebView dying
 * under the decode is exactly what the owner needs to know before the swap.
 *
 * PURE: no react, no react-native, no expo, no fs. Asserted by
 * scripts/vc60DecoderProbe.test.ts.
 */

/** The control's label. A measurement tool, labelled as one. */
export const PROBE_CTA = 'Run the 3-minute decoder test';

/** What the control is, said plainly above it. */
export const PROBE_LABEL = 'Decoder probe — a measurement, not a feature';

/**
 * The promise the probe makes about the shipped path: it changes nothing about how
 * the notes are read today. The gate asserts the read never calls it.
 */
export const PROBE_HINT =
  'This reads this take’s own audio on the device, once, and prints one line of numbers. It changes nothing about your take, your notes or your History.';

/** Shown while the decode is running (it can take seconds, and it can kill the app). */
export const PROBE_RUNNING_LINE = 'Decoding the take on this device…';

/**
 * SAID BEFORE THE PRESS, because it can happen: the decode is the thing being
 * measured, and an app that dies under it has answered the question.
 */
export const PROBE_RISK_LINE =
  'A full-length take can use a lot of memory. If the app closes while this runs, that is the answer — open it again and the take is still here.';

/** The line printed when the attempt did not get as far as a decode. */
export const PROBE_FAILED_LINE =
  'probe: the decode did not finish — the app did not survive it or the reader never answered.';

/**
 * ── vc62 (D29) ── THE PROBE READS A CAPPED PREFIX, NOT THE WHOLE FILE ─────────
 *
 * The vc60/61 probe read the take's whole file as ONE base64 string
 * (`FileSystem.readAsStringAsync(uri, {encoding: Base64})`). A 3-minute camera
 * file is ~1 GB, so base64 alone is ~1.34 GB against a 256 MB JS heap: the probe
 * could not survive the read it was written to measure, and it still crashed on
 * vc61. This is the cap. 12 MB of file bytes is ~16 MB of base64 — comfortably
 * inside the heap — and it is enough of a container for the decoder to open, which
 * is what the probe is asking.
 */
export const PROBE_MAX_READ_BYTES = 12 * 1024 * 1024;

/**
 * WHAT THE PROBE ACTUALLY READ, SAID OUT LOUD:
 *
 *   read: the whole 2.9MB file
 *   read: the first 12.0MB of 1.34GB (the rest is not loaded — this is a capped read)
 *
 * A capped read is not the same measurement as a whole-file one, so the line says
 * which it was rather than letting the numbers be compared as if they were equal.
 */
export function probeReadBoundLine(input: {
  fileBytes?: number | null;
  readBytes?: number | null;
} | null | undefined): string {
  const file = Number(input?.fileBytes);
  const read = Number(input?.readBytes);
  const fileKnown = Number.isFinite(file) && file > 0;
  const readKnown = Number.isFinite(read) && read > 0;
  if (!readKnown) return 'read: nothing was loaded from the file.';
  if (fileKnown && read >= file) return `read: the whole ${mb(file)} file`;
  if (fileKnown) return `read: the first ${mb(read)} of ${mb(file)} (the rest is not loaded — this is a capped read)`;
  return `read: the first ${mb(read)} (the file's own size could not be measured)`;
}

/** One finished (or failed) attempt, as measured. */
export interface ProbeFacts {
  /** The file's size on disk, in bytes (null when it could not be read). */
  fileBytes?: number | null;
  /** The decoded length, in seconds. */
  decodedSec?: number | null;
  /** The decode's sample rate, in Hz. */
  sampleRate?: number | null;
  /** How many channels the decoded buffer held (the page downmixes after). */
  channels?: number | null;
  /** The PCM16 payload the page posted back, in bytes. */
  pcm16Bytes?: number | null;
  /** Wall-clock milliseconds the decode took. */
  decodeMs?: number | null;
  /** The JS heap after the decode, in bytes — null when it cannot be measured. */
  peakHeapBytes?: number | null;
  /** True only when the decode returned and the screen is still live to print it. */
  survived?: boolean | null;
}

/** Bytes → "2.9MB", or "?" when nothing was measured. */
function mb(bytes: unknown): string {
  if (bytes === null || bytes === undefined) return '?';
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '?';
  return `${(value / 1e6).toFixed(1)}MB`;
}

/** Seconds → "180.0s", or "?" when nothing was measured. */
function secs(value: unknown): string {
  if (value === null || value === undefined) return '?';
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '?';
  return `${seconds.toFixed(1)}s`;
}

/** Milliseconds → "8400ms", or "?" when nothing was measured. */
function ms(value: unknown): string {
  if (value === null || value === undefined) return '?';
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis < 0) return '?';
  return `${Math.round(millis)}ms`;
}

/**
 * THE SAMPLES THE DECODE HELD, from the PCM16 payload we actually received: two
 * bytes per mono frame. Not a guess — the payload is the measurement.
 */
export function probeSampleCount(pcm16Bytes: unknown): number | null {
  const bytes = Number(pcm16Bytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.floor(bytes / 2);
}

/**
 * Float32 bytes the decoded buffer occupied: samples × channels × 4. This is the
 * figure the swap has to survive, so it is computed rather than remembered.
 */
export function probeFloat32Bytes(input: {
  pcm16Bytes?: number | null;
  channels?: number | null;
}): number | null {
  const samples = probeSampleCount(input?.pcm16Bytes);
  if (samples === null) return null;
  const channels = Number(input?.channels);
  const channelCount = Number.isFinite(channels) && channels >= 1 ? Math.round(channels) : 1;
  return samples * channelCount * 4;
}

/**
 * THE ONE LINE the owner reads back:
 *
 *   probe: file=2.9MB decoded=180.0s float32=63.5MB pcm16=21.2MB decode=8400ms peak_heap=? survived=yes
 *
 * Key order is fixed so the line can be compared across builds, and every field is
 * `?` rather than a guess when it was not measured.
 */
export function probeLine(facts: ProbeFacts | null | undefined): string {
  const value = facts ?? {};
  const float32 = probeFloat32Bytes({
    pcm16Bytes: value.pcm16Bytes ?? null,
    channels: value.channels ?? null,
  });
  return [
    'probe:',
    `file=${mb(value.fileBytes)}`,
    `decoded=${secs(value.decodedSec)}`,
    `float32=${mb(float32)}`,
    `pcm16=${mb(value.pcm16Bytes)}`,
    `decode=${ms(value.decodeMs)}`,
    `peak_heap=${mb(value.peakHeapBytes)}`,
    `survived=${value.survived === true ? 'yes' : 'no'}`,
  ].join(' ');
}

/**
 * ── THE JS HEAP, ONLY IF IT IS REALLY THERE ────────────────────────────────────
 *
 * Hermes exposes `global.HermesInternal.getInstrumentedStats()`, whose `heapSize` is
 * the current JS heap in bytes. It is present on the app's release runtime and
 * absent everywhere else (JSC, Node, the web build), and a stats call can throw. So:
 * a number, or NULL. The line prints `?` for null — never a figure that was not
 * measured, because a wrong memory number would steer the next build.
 *
 * Injectable (`host`) so the gate can assert both halves without a Hermes runtime.
 */
export function hermesHeapBytes(host?: unknown): number | null {
  const scope = (host ?? (typeof globalThis === 'object' ? globalThis : null)) as {
    HermesInternal?: { getInstrumentedStats?: () => unknown };
  } | null;
  if (!scope) return null;
  try {
    const stats = scope.HermesInternal?.getInstrumentedStats?.();
    if (!stats || typeof stats !== 'object') return null;
    const heapSize = Number((stats as { heapSize?: unknown }).heapSize);
    if (!Number.isFinite(heapSize) || heapSize <= 0) return null;
    return heapSize;
  } catch {
    return null;
  }
}
