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
import {
  readNetworkLine,
  serverTimingsLine,
  type NetworkReadResult,
  type ServerReadTimings,
} from './readNetwork';

/**
 * The stages the current code can actually time.
 *
 * ── vc62 (D26) ── `pitch` now usually costs the phone NOTHING, because the server
 * returns the frames (`captureMidiExport.ts`). The stage is still recorded — a
 * measured ~0 ms of device work is the honest number, and it is the one that shows
 * the fix worked — and `pitchSource` says whose work it was.
 */
export type TakeReadStage = 'upload' | 'clientDecode' | 'pitch' | 'build';

/** Every stage key the timings line can print, including the two that are not separable. */
export type TakeReadLineStage = TakeReadStage | 'total' | 'draw';

/** vc62: whose pass produced the frames the take was built from. */
export type PitchSource = 'server' | 'device';

/** One read, as measured. */
export interface TakeReadTiming {
  /** ISO stamp of when the read finished — so a slow read can be told from a fast one. */
  at: string;
  /** The take's own length in seconds, when the screen knew it. */
  audioSec: number | null;
  /**
   * ── v66 (F5) ── HOW MUCH OF THAT TAKE THE READ ACTUALLY PRODUCED NOTES FOR.
   *
   * `audioSec` is the TAKE's length (a three-minute take is 180), which is not what
   * the read covered: a read stops at the payload cap, so the two numbers are
   * different facts and the card was printing the first as the second. Measured from
   * the notes the read made (`takeReadCoverage`); absent on an older record, which
   * then prints exactly the line it printed before.
   */
  coveredSec?: number | null;
  /** The measured spans, in milliseconds. A missing stage was not measured. */
  stages: Partial<Record<TakeReadStage, number>>;
  /** The whole read, press to result, in milliseconds. */
  totalMs: number | null;
  /**
   * ── vc62 ── WHICH TAKE THIS READ TIMED (D30), and where its frames came from.
   *
   * `label` is `services/takeReadLabel.ts`'s sentence for the take the read was
   * started on, so a clock or a timing row can never be mistaken for another take's.
   * `pitchSource` marks the pitch span as the server's work or the phone's; `server`
   * carries the spans the ROUTE measured, and `network` the round trip itself.
   */
  label?: string | null;
  pitchSource?: PitchSource | null;
  server?: ServerReadTimings | null;
  network?: NetworkReadResult | null;
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
 *   read: total=1500ms upload=1400ms unpack=180ms pitch=1ms@server build=220ms draw=?
 *
 * Key order is fixed so two builds can be compared by eye, and every stage that was not
 * measured is `?` rather than a guess. `@server` / `@device` is appended to the pitch span
 * (vc62) only when the read recorded whose pass it was — an older record prints exactly as
 * it did before.
 */
export function readTimingsLine(timing: TakeReadTiming | null | undefined): string {
  const value = timing ?? null;
  if (!value) return 'read: no read has finished on this phone yet.';
  const stages = value.stages ?? {};
  const parts = READ_STAGE_KEYS.map(({ stage, key }) => {
    if (stage === 'total') return `${key}=${timingValue(value.totalMs)}`;
    if (stage === 'draw') return `${key}=?`;
    const source = stage === 'pitch' && value.pitchSource ? `@${value.pitchSource}` : '';
    return `${key}=${timingValue(stages[stage])}${source}`;
  });
  return `read: ${parts.join(' ')}`;
}

/**
 * ── vc62 (D26/D32) ── WHAT THE SERVER AND THE WIRE SAID, BESIDE THE READ.
 *
 * Two real measurements, never invented: the spans the ROUTE reported for this
 * answer (`server: decode=… pitch=… total=…`) and the round trip as the phone saw
 * it (`net: HTTP 200 · sent … · got …`, or `net: stopped after 40s (AbortError)`).
 * Null when neither exists — an older deployment says nothing rather than zeros.
 */
export function readTimingsServerLine(timing: TakeReadTiming | null | undefined): string | null {
  const value = timing ?? null;
  if (!value) return null;
  const server = serverTimingsLine(value.server ?? null);
  const net = readNetworkLine(value.network ?? null);
  const parts = [server, net].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * ── v66 (F5) ── WHAT THE READ COVERED, SAID AS WHAT THE READ COVERED.
 *
 * vc61 printed the TAKE's own length here ("this read covered 180s of audio" on a
 * three-minute take). 180 s is how long the user held the phone up, not what the read
 * produced notes for: the read stops at the payload cap (D21, the owner's 60-second
 * ceiling), so on the owner's v65 take the notes stopped at 61.7 s while the line
 * claimed the whole three minutes. Coverage is now measured from the notes the read
 * actually made, and a read that stopped short says so, with the take's own length
 * beside it so the two facts cannot be mistaken for each other.
 *
 * A record with no `coveredSec` (written before vc66) prints exactly the line it
 * always printed — an older read says what it said, rather than a coverage it never
 * measured.
 */
export function readTimingsAudioLine(timing: TakeReadTiming | null | undefined): string | null {
  const audio = Number(timing?.audioSec);
  const hasAudio = Number.isFinite(audio) && audio > 0;
  const rawCovered = timing?.coveredSec;
  const covered = rawCovered === null || rawCovered === undefined ? Number.NaN : Number(rawCovered);
  const hasCovered = Number.isFinite(covered) && covered > 0;
  if (!hasAudio && !hasCovered) return null;
  if (!hasCovered) return `this read covered ${secondsLabel(audio)}s of audio`;
  if (hasAudio && audio - covered > COVERAGE_SHORTFALL_SEC) {
    return `this read covered the first ${secondsLabel(covered)}s of a ${secondsLabel(audio)}s take`;
  }
  return `this read covered ${secondsLabel(hasAudio ? Math.min(covered, audio) : covered)}s of audio`;
}

/** A span of seconds as the card says it: whole seconds from ten up, one decimal below. */
function secondsLabel(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  return safe.toFixed(safe >= 10 ? 0 : 1);
}

/** Under this much of the take left unread, a read is treated as having covered it. */
export const COVERAGE_SHORTFALL_SEC = 2;

/** The one note shape coverage is measured from (`MidiNoteEvent`, structurally). */
export interface CoverageNote {
  startSec?: number | null;
  durationSec?: number | null;
}

/**
 * ── v66 (F5) ── COVERAGE, MEASURED FROM THE NOTES THE READ MADE.
 *
 * The end of the last note the read produced, in seconds — the only honest answer to
 * "how much of this take did the read read?". No notes means NO coverage (null, never
 * 0 and never the take's length): a read that produced nothing covered nothing, and
 * saying "0" would be a measurement the read did not make.
 */
export function takeReadCoverage(input: {
  notes?: ReadonlyArray<CoverageNote> | null;
  audioSec?: number | null;
}): { coveredSec: number | null; audioSec: number | null } {
  const notes = Array.isArray(input?.notes) ? input.notes : [];
  const rawAudio = input?.audioSec;
  const audio = rawAudio === null || rawAudio === undefined ? Number.NaN : Number(rawAudio);
  let end = Number.NaN;
  for (const note of notes) {
    const start = Number(note?.startSec);
    if (!Number.isFinite(start)) continue;
    const duration = Number(note?.durationSec);
    const noteEnd = start + (Number.isFinite(duration) && duration > 0 ? duration : 0);
    if (!Number.isFinite(end) || noteEnd > end) end = noteEnd;
  }
  return {
    coveredSec: Number.isFinite(end) && end > 0 ? Math.round(end * 1000) / 1000 : null,
    audioSec: Number.isFinite(audio) && audio > 0 ? audio : null,
  };
}

/**
 * ── v66 (F5) ── THE PLAIN-WORDS LINE BESIDE THE NOTATION.
 *
 * The owner: if the notes stop short of the take, "then it plainly needs to say so for
 * the user". Null when the read covered the take (nothing to explain), and null when
 * either number is unknown — a shortfall is never invented from a missing measurement.
 */
export function takeCoverageLine(input: {
  audioSec?: number | null;
  coveredSec?: number | null;
}): string | null {
  const rawAudio = input?.audioSec;
  const rawCovered = input?.coveredSec;
  const audio = rawAudio === null || rawAudio === undefined ? Number.NaN : Number(rawAudio);
  const covered = rawCovered === null || rawCovered === undefined ? Number.NaN : Number(rawCovered);
  if (!Number.isFinite(audio) || audio <= 0) return null;
  if (!Number.isFinite(covered) || covered <= 0) return null;
  if (audio - covered <= COVERAGE_SHORTFALL_SEC) return null;
  return `The notes stop at the first ${Math.round(covered)} seconds of this ${Math.round(audio)}-second take — a read stops at the 60-second mark, so record a shorter take for the whole piece.`;
}

/**
 * ── v66 (F4) ── WHICH SPAN THE `pitch` STAGE CARRIES.
 *
 * On the server path the phone only assigns `captured.frames`, so timing that span
 * with `Date.now()` measured the phone's ~0 ms of work and printed it as
 * `pitch=0ms@server` against a server that had just measured 4283 ms (the owner's v65
 * card). The stage now carries the SERVER's own span. A server answer that came with
 * no span records NOTHING (null → the line prints `?@server`): a zero would be a
 * measurement nobody made, and it was the invented zero that made the fast path look
 * broken.
 */
export function pitchStageMs(input: {
  pitchSource?: PitchSource | null;
  serverPitchMs?: number | null;
  deviceMs?: number | null;
}): number | null {
  const source = input?.pitchSource === 'server' ? 'server' : input?.pitchSource === 'device' ? 'device' : null;
  if (source === null) return null;
  const raw = source === 'server' ? input?.serverPitchMs : input?.deviceMs;
  if (raw === null || raw === undefined) return null;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms);
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
  /** v66 (F5): how much of that take the read produced notes for (`takeReadCoverage`). */
  coveredSec?: number | null;
  at?: string;
  /** vc62: which take this read timed, and where its frames came from. */
  label?: string | null;
  pitchSource?: PitchSource | null;
  server?: ServerReadTimings | null;
  network?: NetworkReadResult | null;
}): TakeReadTiming {
  // AN UNMEASURED TOTAL IS NULL, NOT ZERO. `Number(null)` is 0, which would print a
  // real-looking `total=0ms` for a read nobody timed — the same invention the draw is
  // left out to avoid. Only a number that was actually handed in can be a measurement.
  const rawTotal = input?.totalMs;
  const total = rawTotal === null || rawTotal === undefined ? Number.NaN : Number(rawTotal);
  const audio = Number(input?.audioSec);
  const rawCovered = input?.coveredSec;
  const covered = rawCovered === null || rawCovered === undefined ? Number.NaN : Number(rawCovered);
  const source = input?.pitchSource === 'server' || input?.pitchSource === 'device' ? input.pitchSource : null;
  return {
    at: typeof input?.at === 'string' && input.at.length > 0 ? input.at : new Date().toISOString(),
    audioSec: Number.isFinite(audio) && audio > 0 ? audio : null,
    // v66 (F5) — additive: a caller that measured no coverage records none (null), so
    // the card says what it always said rather than a coverage nobody measured.
    coveredSec: Number.isFinite(covered) && covered > 0 ? covered : null,
    stages: { ...(input?.stages ?? {}) },
    totalMs: Number.isFinite(total) && total >= 0 ? Math.round(total) : null,
    // vc62 — additive: absent fields stay absent (null), so an older caller's timing
    // prints exactly the line it printed before.
    label: typeof input?.label === 'string' && input.label.length > 0 ? input.label : null,
    pitchSource: source,
    server: input?.server ?? null,
    network: input?.network ?? null,
  };
}
