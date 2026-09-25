/**
 * captureFeedback.ts — what the NO-MATCH card says, and the capture numbers the
 * app sends to the server (V26 honest capture feedback, owner 09-25).
 *
 * WHY: the owner's repeated on-device "No Match Found" was a dead end — the same
 * card for "the microphone heard nothing" and for "we heard it but our library
 * does not have this piece", so neither the owner nor the team could tell which
 * pass failed. The capture path already measured everything needed
 * (src/services/captureTelemetry.ts), but those numbers were engineer-only.
 *
 * This module owns, in ONE place:
 *   • the tiny-capture defect decision (a <4KB or <0.5s clip — see
 *     captureTelemetry.looksSuspicious, which delegates here so the thresholds
 *     live once),
 *   • the card's two honest states:
 *       tiny  → "We couldn't hear enough — try again closer to the music (or in
 *               a quieter room)" + Retry,
 *       else  → "No match in our library yet" + the hum/whistle affordance,
 *   • the small, non-alarming capture line a screenshot can be measured from
 *     ("Captured 12.4s · level -18 dBFS"),
 *   • the request headers (x-capture-duration-ms / x-capture-peak-dbfs /
 *     x-capture-bytes) the server logs — never echoed back in a response body.
 *
 * Pure by design: no react / react-native / expo imports, so the tier1 gate
 * compiles it with node_modules absent. The CaptureNumbers input is structural —
 * captureTelemetry's CaptureDiagnostics satisfies it — which is why this module
 * can be gate-tested while captureTelemetry (expo-file-system) cannot.
 */

/** The numbers this module reasons about. A subset of CaptureDiagnostics. */
export interface CaptureNumbers {
  durationMs: number | null;
  peakDbFS: number | null;
  bytes: number | null;
}

// ─── the tiny-capture defect (thresholds live HERE, once) ───────────────

/** A clip under this size never carried 8–12s of audio (12s AAC ≈ 190KB). */
export const TINY_CAPTURE_MAX_BYTES = 4000;
/** A clip this short is a silently truncated capture, not a real listen. */
export const TINY_CAPTURE_MAX_DURATION_MS = 500;

/**
 * THE SILENCE FLOOR (owner-reported on device, RC v26 Test 4 → build #3).
 *
 * A capture can be perfectly healthy in bytes and duration and still carry no
 * audio at all: the owner held the phone with the microphone covered, the
 * recorder wrote a full-length 12s / ~190KB .m4a of digital near-silence, and
 * `isTinyCapture` — which only knew about bytes and duration — passed it. The
 * clip then travelled through landmark matching and AudD, matched nothing (of
 * course), and the user got "No match in our library yet": the wrong card, for
 * the wrong reason, with the wrong advice.
 *
 * The capture path already MEASURED the answer — `peakDbFS` (the loudest
 * metering sample of the listen, see captureTelemetry.buildCaptureTelemetry)
 * travels to the server as `x-capture-peak-dbfs`. It was simply never consulted
 * here. This floor is that consultation: a whole listen whose PEAK never rose
 * above −40 dBFS heard nothing a matcher can use, so it is a capture defect
 * ("we couldn't hear enough — try again closer to the music") rather than a
 * library miss.
 *
 * Why −40 dBFS: a room recording the owner's own working takes peaked around
 * −18 dBFS and a quiet-but-real take still lands well above −40; digital
 * near-silence lands far below it (metering floors at −60…−160). The comparison
 * is inclusive (<=) so a capture measured exactly at the floor counts as
 * silence — erring toward the honest retry card, never toward blaming the
 * library for a listen that heard nothing.
 *
 * A null / non-finite peak is NOT evidence (we do not know) — identical to the
 * bytes and duration rules below: only a MEASUREMENT can make the verdict.
 */
export const SILENT_CAPTURE_MAX_PEAK_DBFS = -40;

/**
 * True when a measured peak level says this listen heard (essentially) nothing.
 * Only a finite measurement counts; null/NaN/±Infinity mean "not measured".
 */
export function isSilentCapture(d: CaptureNumbers | null | undefined): boolean {
  if (!d) return false;
  const peak = d.peakDbFS;
  if (typeof peak !== "number" || !Number.isFinite(peak)) return false;
  return peak <= SILENT_CAPTURE_MAX_PEAK_DBFS;
}

/**
 * True when the capture metadata says the phone barely recorded anything.
 * A null field is NOT tiny evidence (we do not know) — it is only a defect when
 * a measurement exists and is clearly too small. A measured ZERO is the most
 * tiny evidence there is (no clip at all: the recorder's stop failure 'empty'),
 * so 0 bytes / 0 ms classify as tiny rather than being skipped as "unknown".
 *
 * Three ways a capture fails to be a listen: nothing on disk (bytes), nothing
 * long enough to be a listen (duration), and nothing AUDIBLE (the peak floor —
 * the owner's full-length silent capture, RC v26 Test 4).
 */
export function isTinyCapture(d: CaptureNumbers | null | undefined): boolean {
  if (!d) return false;
  if (typeof d.bytes === "number" && d.bytes >= 0 && d.bytes < TINY_CAPTURE_MAX_BYTES) return true;
  if (
    typeof d.durationMs === "number" &&
    d.durationMs >= 0 &&
    d.durationMs < TINY_CAPTURE_MAX_DURATION_MS
  ) {
    return true;
  }
  // The loudness floor: a full-length clip that never rose above it is silence.
  return isSilentCapture(d);
}

// ─── the no-match card's two honest states ──────────────────────────────

/** Title when the microphone barely captured anything. */
export const NO_MATCH_TITLE_TINY = "We couldn't hear enough";
/** The tiny-capture message the owner asked for, verbatim. */
export const NO_MATCH_BODY_TINY =
  "We couldn't hear enough — try again closer to the music (or in a quieter room)";
/** Title when we DID hear something and simply do not hold the piece. */
export const NO_MATCH_TITLE_LIBRARY = 'No match in our library yet';
/** The fallback body for a real listen that matched nothing. */
export const NO_MATCH_BODY_LIBRARY =
  "We couldn't identify this piece — try again closer to the speaker, or in a quieter environment.";

export interface NoMatchCardCopy {
  title: string;
  body: string;
  /** The card always offers Retry (the tiny case is a retry-first state). */
  showRetry: boolean;
  /** True when the reason is the capture itself, not our library. */
  tiny: boolean;
}

/**
 * The no-match card's words, from the capture numbers (and the server's own
 * reason when it declined to name a piece).
 *
 * A tiny capture says so — retrying is the fix. Anything else is honestly about
 * our library, so the card offers the hum/whistle way in instead of blaming the
 * user's microphone.
 */
export function noMatchCardCopy(
  diagnostics: CaptureNumbers | null | undefined,
  serverReason?: string | null,
): NoMatchCardCopy {
  if (isTinyCapture(diagnostics)) {
    return { title: NO_MATCH_TITLE_TINY, body: NO_MATCH_BODY_TINY, showRetry: true, tiny: true };
  }
  const reason = typeof serverReason === "string" && serverReason.trim().length > 0 ? serverReason.trim() : null;
  return {
    title: NO_MATCH_TITLE_LIBRARY,
    body: reason ?? NO_MATCH_BODY_LIBRARY,
    showRetry: true,
    tiny: false,
  };
}

/**
 * The card copy for a pass whose clip never existed at all (the recorder's stop
 * failure 'empty' — no file to measure). It is a tiny capture by definition, so
 * it gets the same honest words and the same retry-first state; the screen feeds
 * it NO_AUDIO_DIAGNOSTICS (0 bytes / 0 ms) so one code path serves both.
 */
export function noAudioCardCopy(): NoMatchCardCopy {
  return {
    title: NO_MATCH_TITLE_TINY,
    body: NO_MATCH_BODY_TINY,
    showRetry: true,
    tiny: true,
  };
}

// ─── the small, non-alarming capture line (measurable screenshots) ──────

/**
 * "Captured 12.4s · level -18 dBFS" — duration + level only, once each, with no
 * verdict words. null when there is nothing measured to show.
 */
export function captureDiagnosticLine(d: CaptureNumbers | null | undefined): string | null {
  if (!d) return null;
  const parts: string[] = [];
  if (typeof d.durationMs === "number" && d.durationMs > 0) {
    parts.push(`Captured ${Math.round((d.durationMs / 1000) * 10) / 10}s`);
  }
  if (typeof d.peakDbFS === "number" && Number.isFinite(d.peakDbFS)) {
    parts.push(`level ${Math.round(d.peakDbFS)} dBFS`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ─── the request headers (server-side diagnostics) ──────────────────────

export const CAPTURE_HEADER_DURATION = 'x-capture-duration-ms';
export const CAPTURE_HEADER_PEAK = 'x-capture-peak-dbfs';
export const CAPTURE_HEADER_BYTES = 'x-capture-bytes';

/**
 * The diagnostics headers for an upload. Only measured fields are sent, and
 * only finite numbers — a null measurement is simply absent, never "null" on
 * the wire. The server logs these and never echoes them in a response body.
 */
export function captureDiagnosticHeaders(
  d: CaptureNumbers | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!d) return headers;
  if (typeof d.durationMs === "number" && Number.isFinite(d.durationMs)) {
    headers[CAPTURE_HEADER_DURATION] = String(Math.round(d.durationMs));
  }
  if (typeof d.peakDbFS === 'number' && Number.isFinite(d.peakDbFS)) {
    headers[CAPTURE_HEADER_PEAK] = String(Math.round(d.peakDbFS * 10) / 10);
  }
  if (typeof d.bytes === 'number' && Number.isFinite(d.bytes)) {
    headers[CAPTURE_HEADER_BYTES] = String(Math.round(d.bytes));
  }
  return headers;
}

// ─── source contracts (live scan, the team's source-scanner recipe) ─────

/** The no-match phase marker inside RecognitionResultView. */
export const NO_MATCH_MARKER = "phase.type === 'no-match'";
/** The marker that ends the no-match block in that component. */
export const NO_MATCH_BLOCK_END_MARKER = 'phase.response.matches[0]';

/**
 * True when the no-match card renders THIS module's decision and the capture
 * line: the card must call noMatchCardCopy(...) with the phase's diagnostics AND
 * render captureDiagnosticLine(phase.diagnostics), and must not read a raw
 * capture line off anything else. A card that reverted to a single hardcoded
 * "No Match Found" (the v25 state) fails.
 */
export function noMatchCardWired(source: string): boolean {
  const at = source.indexOf(NO_MATCH_MARKER);
  if (at < 0) return false;
  const end = source.indexOf(NO_MATCH_BLOCK_END_MARKER, at);
  const block = source.slice(at, end < 0 ? source.length : end);
  return (
    block.includes('noMatchCardCopy(') &&
    block.includes('phase.diagnostics') &&
    block.includes('captureDiagnosticLine(')
  );
}

/**
 * True when BOTH upload paths attach the capture headers: api.ts must funnel its
 * request headers through one helper that spreads captureDiagnosticHeaders(...),
 * and every upload fetch must use that helper (not a bare inline header object —
 * which is exactly how the headers would silently go missing).
 */
export function headersAttachedOnUpload(source: string): boolean {
  if (!source.includes('captureDiagnosticHeaders(diagnostics)')) return false;
  const uses = source.match(/headers:\s*uploadHeaders\(/g) ?? [];
  if (uses.length < 2) return false; // /api/recognize + the shared postAudioMultipart
  // The pre-fix inline header object must be gone from every upload call.
  return !/headers:\s*\{\s*Accept:\s*"application\/json",\s*"x-user-id"/.test(source);
}
