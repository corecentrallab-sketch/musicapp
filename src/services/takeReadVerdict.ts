/**
 * takeReadVerdict.ts — WHAT THE APP MAY SAY ABOUT A TAKE IT JUST TRIED TO READ.
 *
 * WHY THIS EXISTS (vc60 spec §2). Three completely different failures were printing
 * the SAME sentence on the practice-video page — "No melody was heard in this
 * take." — and one of those three was a lie:
 *
 *   1. the app could not decode at all (offline, HTTP error, a dead reader) — it
 *      never got to listen, and it told the owner it had listened and heard nothing;
 *   2. the take genuinely held no SOUND (a muted microphone, a quiet room) — a
 *      different fact with a different remedy;
 *   3. the take held sound but no melody — the only case the old sentence was ever
 *      true for.
 *
 * THE LEVEL, NOT THE FILE SIZE. A compressed AAC/MP4 file holding 60 seconds of
 * nothing is structurally identical to one holding 60 seconds of playing, so
 * `size > 0` can never tell them apart. What CAN is a level measurement, and the app
 * takes one twice already: the recorder meters every take (`peakDbFS`, see
 * services/captureTelemetry.ts) and the decoder now reports the level of the PCM it
 * actually decoded (`peak`/`rmsDb`, see the backend's coach-pcm-handler). This module
 * turns either measurement into ONE verdict, so no surface invents a threshold or a
 * sentence of its own.
 *
 * PURE: no react, no react-native, no fs. Asserted by
 * scripts/vc60TakeStaffAndLane.test.ts.
 */
import { VIDEO_NO_MELODY_LINE } from './videoTakeSync';

/**
 * BELOW THIS THE TAKE HELD NO SOUND THE USER MADE (≈ −45 dBFS).
 *
 * The floor is deliberately generous in the direction that matters: it must never
 * call a take of playing "no sound", so the only takes it catches are the ones no
 * melody could have been in. A phone in a quiet room, microphone open and nothing
 * played, meters far below it; any hummed, sung or played note is far above.
 */
export const TAKE_SOUND_FLOOR_DBFS = -45;

/** The take recorded, but there is nothing on it — a fact, with a way forward. */
export const TAKE_NO_SOUND_LINE =
  'Nothing was recorded in this take — the microphone heard no sound at all. Film it again, or record the notes with the camera off.';

/**
 * THE READ FAILED, WHICH IS NOT A VERDICT ON THE MELODY (vc60 spec §2 — the lie).
 * Distinct from "this build has no reader at all", which keeps the seam's own
 * message, because there the app never had a reader to fail.
 */
export const TAKE_DECODE_FAILED_LINE =
  'The notes could not be read from this take — the audio could not be sent to the reader just now. Your video and its audio are saved; try the notes again.';

/** What a finished read attempt established. */
export type TakeReadOutcome = 'unavailable' | 'decode-failed' | 'no-sound' | 'no-melody';

/** The facts a read attempt hands over (absent is not a verdict). */
export interface TakeReadFacts {
  /** True when this build/route has no decoder at all (never got to listen). */
  unavailable?: boolean | null;
  /** True when the decode itself failed (offline, HTTP error, timeout). */
  decodeFailed?: boolean | null;
  /** True when the level measurement says the take holds no sound. */
  noSound?: boolean | null;
}

/**
 * The ONE place the order of the verdicts is decided. The order is not arbitrary:
 * "we could not listen" outranks "we listened and there was nothing", which outranks
 * "we listened, there was sound, there was no melody".
 */
export function takeReadOutcome(facts: TakeReadFacts | null | undefined): TakeReadOutcome {
  if (facts?.unavailable === true) return 'unavailable';
  if (facts?.decodeFailed === true) return 'decode-failed';
  if (facts?.noSound === true) return 'no-sound';
  return 'no-melody';
}

/**
 * The sentence for that verdict.
 *
 * `unavailableMessage` is the seam's own message (coachCapture.ts explains WHY the
 * decoder is missing); `fallbackFailedLine` is the surface's own line for a take
 * that could not be kept. Neither is invented here — this module owns only the two
 * sentences no other surface had, and the no-melody verdict is the LANE's own
 * constant, imported so the two surfaces can never drift into two verdicts.
 */
export function takeReadLine(
  outcome: TakeReadOutcome,
  input: { unavailableMessage?: string | null; fallbackFailedLine?: string } = {},
): string {
  if (outcome === 'unavailable') {
    const message = typeof input.unavailableMessage === 'string' ? input.unavailableMessage : '';
    if (message.length > 0) return message;
    return input.fallbackFailedLine ?? TAKE_DECODE_FAILED_LINE;
  }
  if (outcome === 'decode-failed') return TAKE_DECODE_FAILED_LINE;
  if (outcome === 'no-sound') return TAKE_NO_SOUND_LINE;
  return VIDEO_NO_MELODY_LINE;
}

/** dBFS from a linear peak amplitude (0…1). 0 is digital nothing: −Infinity. */
export function peakDbFromAmplitude(peak: unknown): number | null {
  if (peak === null || peak === undefined) return null;
  const value = Number(peak);
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(value);
}

/**
 * THE LEVEL OF THE TAKE, from whichever measurement exists.
 *
 * The recorder's own metering wins: it watched the take as it was made, on the
 * device, and needs no network. The decoder's peak is the fallback and covers any
 * container the server can decode. NULL means "not measured" — and a take whose
 * level was never measured is NEVER called sound-less.
 */
export function takeLevelDbFS(
  input: { meteredDbFS?: number | null; decodedPeak?: number | null } | null | undefined,
): number | null {
  const metered = input?.meteredDbFS;
  if (typeof metered === 'number' && Number.isFinite(metered)) return metered;
  return peakDbFromAmplitude(input?.decodedPeak);
}

/** True only when a level WAS measured and it sits at or below the floor. */
export function levelIsNoSound(levelDbFS: number | null | undefined): boolean {
  if (typeof levelDbFS !== 'number') return false;
  if (Number.isNaN(levelDbFS)) return false;
  return levelDbFS <= TAKE_SOUND_FLOOR_DBFS;
}
