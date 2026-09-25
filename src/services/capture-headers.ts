/**
 * capture-headers.ts — the on-device capture diagnostics the app sends as
 * request headers (V26 honest capture feedback, owner 09-25).
 *
 * WHY: the owner's repeated on-device "No Match Found" was invisible in our
 * logs — the server only saw the bytes, never what the phone actually captured.
 * The app now attaches three numbers to the recognition request:
 *
 *   x-capture-duration-ms  — how long the captured clip really is
 *   x-capture-peak-dbfs    — the loudest metering value during capture (dB)
 *   x-capture-bytes        — the on-disk size of the file that was uploaded
 *
 * These are SERVER-SIDE diagnostics only. They are logged when present and are
 * NEVER echoed in a response body (the user already sees a plain-language line
 * on the no-match card — see the app's src/services/captureFeedback.ts).
 *
 * Everything here is tolerant: a missing, empty or unparseable header simply
 * reads as null and never breaks a recognition.
 */

export const CAPTURE_HEADER_NAMES = [
  "x-capture-duration-ms",
  "x-capture-peak-dbfs",
  "x-capture-bytes",
] as const;

export type CaptureHeaderName = (typeof CAPTURE_HEADER_NAMES)[number];

export interface CaptureHeaderReadout {
  durationMs: number | null;
  peakDbFS: number | null;
  bytes: number | null;
}

/** A finite number from a header, or null. Never NaN, never Infinity. */
function numberOrNull(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Read the three capture headers off a request. Pure, total, never throws. */
export function readCaptureHeaders(req: {
  headers: { get(name: string): string | null };
}): CaptureHeaderReadout {
  return {
    durationMs: numberOrNull(req.headers.get("x-capture-duration-ms")),
    peakDbFS: numberOrNull(req.headers.get("x-capture-peak-dbfs")),
    bytes: numberOrNull(req.headers.get("x-capture-bytes")),
  };
}

/** True when the client sent at least one usable capture number. */
export function hasCaptureHeaders(readout: CaptureHeaderReadout): boolean {
  return (
    readout.durationMs !== null ||
    readout.peakDbFS !== null ||
    readout.bytes !== null
  );
}

/** The compact "dur=…ms peak=…dB bytes=…" fragment, or null when nothing came. */
export function formatCaptureHeaders(readout: CaptureHeaderReadout): string | null {
  if (!hasCaptureHeaders(readout)) return null;
  const p = (v: number | null, unit: string) =>
    v === null ? "?" : `${Math.round(v * 10) / 10}${unit}`;
  return (
    `capture dur=${p(readout.durationMs, "ms")} ` +
    `peak=${p(readout.peakDbFS, "dB")} bytes=${p(readout.bytes, "B")}`
  );
}

/**
 * Log the capture diagnostics for one request, when the client sent any.
 *
 * The label is the route tag ("[recognize]" / "[hum]" / "[recognize-modern]"),
 * so one log line answers "what did the phone actually capture?" for the exact
 * pass that missed. Never logs the audio itself, and never puts these numbers
 * in a response body.
 */
export function logCaptureHeaders(
  label: string,
  req: { headers: { get(name: string): string | null } },
  log: (line: string) => void = (line) => console.log(line),
): void {
  const line = formatCaptureHeaders(readCaptureHeaders(req));
  if (line) log(`${label} ${line}`);
}
