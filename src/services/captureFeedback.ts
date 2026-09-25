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
 * True when the capture metadata says the phone barely recorded anything.
 * A null field is NOT tiny evidence (we do not know) — it is only a defect when
 * a measurement exists and is clearly too small.
 */
export function isTinyCapture(d: CaptureNumbers | null | undefined): boolean {
  if (!d) return false;
  if (typeof d.bytes === "number" && d.bytes > 0 && d.bytes < TINY_CAPTURE_MAX_BYTES) return true;
  if (
    typeof d.durationMs === "number" &&
    d.durationMs > 0 &&
    d.durationMs < TINY_CAPTURE_MAX_DURATION_MS
  ) {
    return true;
  }
  return false;
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
