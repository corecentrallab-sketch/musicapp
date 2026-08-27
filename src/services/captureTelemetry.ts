/**
 * captureTelemetry.ts — on-device capture-path diagnostics for recognition.
 *
 * WHY: the server-side landmark matcher is proven correct, yet on-device
 * recognition reproducibly returns "No Match Found". That means the gap is the
 * CAPTURE PATH — what the phone's microphone actually records and what reaches
 * the server. This module collects, from the phone itself, every number that
 * tells us where that pipeline breaks:
 *
 *   durationMs   — how long the captured clip actually is
 *   sampleRate   — the sample rate INSIDE the container (parsed, not assumed)
 *   channels     — channel count declared in the container
 *   peakDbFS     — loudest metering sample during capture (expo-av metering, dB)
 *   rmsDbFS      — mean metering sample during capture
 *   bytes        — on-disk file size of the uploaded clip
 *   format       — container brand sniffed from magic bytes
 *
 * Everything is best-effort: every extraction is wrapped so a parse failure
 * yields `null` for that field without ever breaking the recognition flow.
 */
import * as FileSystem from "expo-file-system";

export interface CaptureDiagnostics {
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  /** Peak metering level in dB (least negative = loudest). null if no metering. */
  peakDbFS: number | null;
  /** Mean metering level in dB. null if no metering. */
  rmsDbFS: number | null;
  bytes: number | null;
  /** Container format sniffed from magic bytes, e.g. "m4a", "wav". */
  format: string | null;
}

/** True when the clip metadata implies an empty/tiny capture (defect signal). */
export function looksSuspicious(d: CaptureDiagnostics): boolean {
  if (d.bytes === null) return false;
  // 12s @ 128kbps AAC should be ~190KB or more. A clip far below that, or a
  // recorded duration of a few ms, points at a silently-truncated capture.
  if (d.bytes > 0 && d.bytes < 4000) return true;
  if (d.durationMs !== null && d.durationMs > 0 && d.durationMs < 500) return true;
  return false;
}

/** Read magic bytes (ASCII helper) */
function ascii(buf: Uint8Array, i: number): string {
  return i < buf.length ? String.fromCharCode(buf[i]) : "";
}

/** Sniff container format from the leading bytes. */
export function sniffFormat(buf: Uint8Array): string | null {
  if (buf.length < 12) return buf.length === 0 ? "empty" : "too-short";
  // ISO BMFF / MP4-family: box size(4) + 'ftyp'(4) + brand(4)
  if (ascii(buf, 4) + ascii(buf, 5) + ascii(buf, 6) + ascii(buf, 7) === "ftyp") {
    const brand =
      ascii(buf, 8) + ascii(buf, 9) + ascii(buf, 10) + ascii(buf, 11);
    if (brand.startsWith("M4A")) return "m4a";
    if (brand.startsWith("isom") || brand.startsWith("mp4")) return `mp4(${brand})`;
    return `mp4(${brand})`;
  }
  if (
    ascii(buf, 0) === "R" &&
    ascii(buf, 1) === "I" &&
    ascii(buf, 2) === "F" &&
    ascii(buf, 3) === "F"
  ) {
    return "wav";
  }
  if (
    ascii(buf, 0) === "O" &&
    ascii(buf, 1) === "g" &&
    ascii(buf, 2) === "g" &&
    ascii(buf, 3) === "S"
  ) {
    return "ogg";
  }
  if (
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return "webm";
  }
  return "unknown";
}

function u32(b: Uint8Array, o: number): number {
  return (
    (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]
  ) >>> 0;
}
function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
function typeStr(b: Uint8Array, o: number): string {
  return `${String.fromCharCode(b[o])}${String.fromCharCode(b[o + 1])}${String.fromCharCode(b[o + 2])}${String.fromCharCode(b[o + 3])}`;
}

/**
 * Parse the sample rate + channel count out of an MP4-family container by
 * walking down to the first audio sample entry (stsd → mp4a/...). Written for
 * the specific layout Android MediaRecorder / expo-av produce (.m4a / MPEG-4 /
 * AAC), but tolerant of the parts moving. Returns nulls on any failure so it
 * never throws into the recognition flow.
 */
export function parseM4aInfo(
  buf: Uint8Array,
): { sampleRate: number | null; channels: number | null } {
  // Recursively locate the 'stsd' box.
  const CHILD_BOXES = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
  function findStsd(data: Uint8Array, start: number): number | null {
    let o = start;
    while (o + 8 <= data.length) {
      const size = u32(data, o);
      // 32-bit size == 1 means 64-bit largesize follows — bail on that rarity.
      if (size === 0) break; // box extends to EOF — only valid as last box
      if (size === 1) break;
      if (size < 8) break;
      const type = typeStr(data, o + 4);
      const bodyStart = o + 8;
      const end = o + size;
      if (type === "stsd") return bodyStart;
      if (CHILD_BOXES.has(type)) {
        const r = findStsd(data, bodyStart);
        if (r !== null) return r;
      }
      o = end;
      if (o <= start) break;
    }
    return null;
  }

  try {
    const stsdBody = findStsd(buf, 0);
    if (stsdBody === null) return { sampleRate: null, channels: null };
    // stsd FullBox: 4 (version/flags) + 4 (entry_count) → first entry at +8
    const entryStart = stsdBody + 8;
    if (entryStart + 8 > buf.length) return { sampleRate: null, channels: null };
    const entrySize = u32(buf, entryStart);
    if (entrySize < 40) return { sampleRate: null, channels: null };
    const ch = u16(buf, entryStart + 24);
    const rateFixed = u32(buf, entryStart + 32);
    const sampleRate = rateFixed >>> 16; // 16.16 fixed-point
    return {
      sampleRate: sampleRate > 0 ? sampleRate : null,
      channels: ch > 0 ? ch : null,
    };
  } catch {
    return { sampleRate: null, channels: null };
  }
}

/** Decode a base64 string into bytes (Hermes provides atob). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Build diagnostics for a finished clip from disk. Reads the whole file (it is
 * only ~200KB for a 12s AAC capture) so the moov box is found even when it is
 * written at the end of the file (the usual Android MediaRecorder layout).
 */
export async function buildCaptureTelemetry(
  uri: string,
  opts?: {
    durationMs?: number | null;
    metering?: number[];
  },
): Promise<CaptureDiagnostics> {
  const out: CaptureDiagnostics = {
    durationMs: opts?.durationMs ?? null,
    sampleRate: null,
    channels: null,
    peakDbFS: null,
    rmsDbFS: null,
    bytes: null,
    format: null,
  };

  // File size from filesystem (authoritative on-disk size = what we upload).
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof info.size === "number") {
      out.bytes = info.size;
    }
  } catch {
    out.bytes = null;
  }

  // Read + parse the container for format / sample rate / channels.
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (typeof b64 === "string" && b64.length > 0) {
      const bytes = base64ToBytes(b64);
      out.format = sniffFormat(bytes);
      const info = parseM4aInfo(bytes);
      out.sampleRate = info.sampleRate;
      out.channels = info.channels;
    }
  } catch {
    // Reading/parsing is best-effort.
  }

  // Metering (dB) collected live during capture.
  const meters = opts?.metering?.filter((m) => Number.isFinite(m)) ?? [];
  if (meters.length > 0) {
    out.peakDbFS = Math.max(...meters);
    out.rmsDbFS = meters.reduce((a, b) => a + b, 0) / meters.length;
  }

  return out;
}

/** Compact one-line summary for console logging. */
export function diagToString(d: CaptureDiagnostics): string {
  const p = (v: unknown) => (v === null || v === undefined ? "?" : String(v));
  return (
    `[capture] dur=${p(d.durationMs)}ms rate=${p(d.sampleRate)}Hz ch=${p(d.channels)} ` +
    `peak=${p(d.peakDbFS)}dB rms=${p(d.rmsDbFS)}dB bytes=${p(d.bytes)} fmt=${p(d.format)}`
  );
}
