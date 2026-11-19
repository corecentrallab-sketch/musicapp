/**
 * readNetwork.ts — WHAT THE NETWORK ANSWERED, AS A MEASUREMENT (vc62, D26/D31/D32).
 *
 * WHY THIS MODULE EXISTS. vc61 made the wait visible but nothing ever FAILED: the
 * read had no deadline, so a slow answer and a hung one looked identical, and the
 * retry control the screen already renders never had a failure to appear on. This
 * module is the honest record of the round trip — the status, the error's own name,
 * the bytes in each direction, the timeout that fired, and the spans the SERVER
 * measured — plus the two parsers the client needs to consume the route's new
 * `notes` and `timings` fields.
 *
 * THREE RULES, all of them learned from this app's own defect history:
 *   1. A number here was MEASURED, or it is `null` and the line says `?`. Never a
 *      plausible-looking guess: a wrong figure steers the next fix at the wrong stage.
 *   2. A payload we cannot fully understand is REJECTED WHOLE (`null`), never
 *      half-consumed — a partial frame list would read a take wrongly, which is
 *      worse than falling back to the device's own pass.
 *   3. Nothing here invents a second algorithm. `notes` is validated and handed on;
 *      the frames themselves are the server's, produced by a port of this app's own
 *      tracker (`services/pitchDetection.ts` in the site repo).
 *
 * PURE: no react, no react-native, no expo, no storage, no network call of its own
 * (it is handed results). Asserted by scripts/vc62ServerNotesRead.test.ts.
 */
import type { PitchFrame } from './pitchDetection';

/**
 * HOW LONG THE READ MAY HOLD THE SCREEN BEFORE IT IS CALLED DEAD (D32).
 *
 * The measured server answers are 1–4 s; a handset on a poor connection is slower,
 * so this is generous on purpose. It is a DEADLINE, not an estimate: when it fires
 * the read FAILS (with a sentence and a retry), instead of sitting on a clock for
 * ever. It sits inside the screen's own 45 s bound (`TAKE_DECODE_TIMEOUT_MS`), so
 * the user always gets a failure with a way out rather than a "still reading" line.
 */
export const READ_REQUEST_TIMEOUT_MS = 40000;

/** The sentence a timed-out read shows. Plain words, and it says what to do. */
export const READ_TIMEOUT_LINE =
  'The notes read stopped waiting for an answer. Your video and its audio are saved — try the read again.';

/** The most frames a payload may carry: 60 s at a 25 ms hop is ~2,400. */
export const SERVER_NOTES_MAX = 20000;

/** The server's own spans for one answer, in milliseconds (null = not sent). */
export interface ServerReadTimings {
  decodeMs: number | null;
  pitchMs: number | null;
  totalMs: number | null;
}

/** One round trip, as measured on this phone. */
export interface NetworkReadResult {
  /** The HTTP status, or null when no response ever arrived. */
  httpStatus: number | null;
  /** The thrown error's own `name` (`AbortError`, `TypeError`), or null. */
  errorName: string | null;
  /** True only when OUR deadline fired (not the user leaving, not a dead network). */
  timedOut: boolean;
  /** The upload's size in bytes, when it could be measured. */
  bytesSent: number | null;
  /** The response's size in bytes (content-length), when the server sent one. */
  bytesReceived: number | null;
  /** The spans the SERVER measured for this answer, when it sent them. */
  serverTimings: ServerReadTimings | null;
}

function finiteOrNull(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

/** Bytes → `3.2MB` / `820B`, or `?` when nothing was measured. */
export function formatBytes(bytes: unknown): string {
  const value = finiteOrNull(bytes);
  if (value === null) return '?';
  if (value < 1000) return `${Math.round(value)}B`;
  if (value < 1e6) return `${(value / 1000).toFixed(1)}kB`;
  if (value < 1e9) return `${(value / 1e6).toFixed(1)}MB`;
  return `${(value / 1e9).toFixed(2)}GB`;
}

/** Milliseconds → `44ms`, or `?` when the span was not measured. */
export function formatMs(value: unknown): string {
  const ms = finiteOrNull(value);
  return ms === null ? '?' : `${Math.round(ms)}ms`;
}

/**
 * THE SERVER'S OWN SPANS, from the route's additive `timings` field.
 * Null when the field is absent (an older deployment) or malformed — and absent
 * means "not measured", never zero.
 */
export function parseServerTimings(payload: unknown): ServerReadTimings | null {
  const source = payload as { timings?: unknown } | null;
  const raw = source?.timings;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { decodeMs?: unknown; pitchMs?: unknown; totalMs?: unknown };
  const decodeMs = finiteOrNull(record.decodeMs);
  const pitchMs = finiteOrNull(record.pitchMs);
  const totalMs = finiteOrNull(record.totalMs);
  if (decodeMs === null && pitchMs === null && totalMs === null) return null;
  return { decodeMs, pitchMs, totalMs };
}

/**
 * THE PITCH FRAMES THE DEVICE WOULD HAVE COMPUTED, from the route's `notes` field.
 *
 * Returns NULL unless the whole list is usable: an array within the cap, every
 * entry an object with a finite non-negative `tSec`, a finite `rms`, and a `midi`
 * that is either a finite number or null. A list that fails any of that is not
 * half-trusted — the caller falls back to the on-device pass, which is slower but
 * is the app's own arithmetic on the app's own samples.
 */
export function parseServerNotes(payload: unknown): PitchFrame[] | null {
  const source = payload as { notes?: unknown } | null;
  const raw = source?.notes;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > SERVER_NOTES_MAX) return null;
  const frames: PitchFrame[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const frame = entry as { tSec?: unknown; midi?: unknown; rms?: unknown };
    const tSec = Number(frame.tSec);
    const rms = Number(frame.rms);
    if (!Number.isFinite(tSec) || tSec < 0) return null;
    if (!Number.isFinite(rms) || rms < 0) return null;
    const midi = frame.midi === null || frame.midi === undefined ? null : Number(frame.midi);
    if (midi !== null && !Number.isFinite(midi)) return null;
    frames.push({ tSec, midi, rms });
  }
  return frames;
}

/**
 * THE ONE NETWORK LINE the probe card prints:
 *
 *   net: HTTP 200 · sent 3.2MB · got 3.4MB
 *   net: no answer · stopped after 40s (AbortError) · sent 3.2MB
 *   net: HTTP 500 · sent 3.2MB · got 120B
 *
 * Null when there is no round trip to describe (no read has finished yet).
 */
export function readNetworkLine(result: NetworkReadResult | null | undefined): string | null {
  if (!result) return null;
  const sent = `sent ${formatBytes(result.bytesSent)}`;
  if (result.httpStatus === null) {
    const why = result.errorName ? ` (${result.errorName})` : '';
    const stopped = result.timedOut
      ? `stopped after ${Math.round(READ_REQUEST_TIMEOUT_MS / 1000)}s`
      : 'no answer';
    return `net: ${stopped}${why} · ${sent}`;
  }
  return `net: HTTP ${result.httpStatus} · ${sent} · got ${formatBytes(result.bytesReceived)}`;
}

/**
 * THE SERVER'S SPANS, AS ONE LINE:
 *
 *   server: decode=44ms pitch=2929ms total=3003ms
 *
 * Null when the answer carried none — an older deployment says nothing rather
 * than printing zeros.
 */
export function serverTimingsLine(timings: ServerReadTimings | null | undefined): string | null {
  if (!timings) return null;
  return `server: decode=${formatMs(timings.decodeMs)} pitch=${formatMs(timings.pitchMs)} total=${formatMs(
    timings.totalMs,
  )}`;
}
