/**
 * takeReadProgress.ts — WHAT THE READ IS DOING, AND WHEN IT MOVED TO THE PHONE
 * (vc65; owner 11-17).
 *
 * THE OWNER, verbatim: *"The user also needs to be made aware that the sample is being
 * processed… like some sort of countdown."*
 *
 * vc61 built the clock (`takeReadClock.ts`): elapsed seconds always, a remaining time only
 * when this device has earned one. That clock is still the number on screen, and this file
 * does not touch it. What vc61 left open is the two things a clock alone cannot say:
 *
 *   1. THE STEP. A ticking clock with one unchanging sentence under it is still, to the
 *      user, a still screen. The read already reports each stage it finishes
 *      (`MidiExportDeps.onStage`: `upload` → `clientDecode` → `pitch` → `build`), so the
 *      surface can name the step it has reached. The lines below are written as ACTIONS
 *      ("Sending…", "Finding the notes…"), because a finished stage is exactly what the app
 *      knows: it never claims a percentage, and there is no progress bar anywhere in this
 *      file. Nothing here invents a number.
 *
 *   2. THE FALLBACK, SAID OUT LOUD. When the server answers without notes, the phone runs
 *      the pitch pass itself (`captureMidiExport.decodeTakeFromRecording` → `pitchSource:
 *      'device'`). That pass is 15–25 s of real work on a handset, and until vc65 the app
 *      did it in silence: the owner saw a clock that kept counting for no stated reason. A
 *      client that silently falls back is the defect class that hid a server returning
 *      nothing for two builds, so the seam now reports the fallback the moment it takes
 *      over (`onPitchFallback`) and the surface says which one happened.
 *
 * PURE: no react, no react-native, no network, no storage — so the tier1 gate can pin every
 * branch with no device in the loop.
 */
import type { TakeReadStage } from './takeReadTimings';

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE STEP — the read names what it is doing, from its own stage callbacks
// ─────────────────────────────────────────────────────────────────────────────

/** Before any stage has reported: the request is on its way. */
export const READ_STEP_SENDING_LINE = 'Sending your take to be read…';

/** `upload` finished: the take arrived and the phone is unpacking the answer. */
export const READ_STEP_UNPACKING_LINE = 'Your take arrived — unpacking the audio…';

/** `clientDecode` finished: the samples exist, so the notes are what is being worked out. */
export const READ_STEP_NOTES_LINE = 'Finding the notes in the sound…';

/** `pitch` finished: the notes exist, so what is left is turning them into a score. */
export const READ_STEP_WRITING_LINE = 'Writing the notes onto the score…';

/**
 * THE STEP THE READ HAS REACHED, as a sentence.
 *
 * `null` is "nothing has reported yet" — the press has just happened and the request is in
 * flight, which is a real state and gets its own line rather than an empty space.
 *
 * `pitch` and `build` share the writing line on purpose: both are the tail of the read, the
 * user cannot tell them apart, and inventing a fourth distinction would be noise dressed up
 * as information.
 */
export function readStepLine(stage: TakeReadStage | null | undefined): string {
  switch (stage) {
    case 'upload':
      return READ_STEP_UNPACKING_LINE;
    case 'clientDecode':
      return READ_STEP_NOTES_LINE;
    case 'pitch':
    case 'build':
      return READ_STEP_WRITING_LINE;
    default:
      return READ_STEP_SENDING_LINE;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FALLBACK — who read the notes, and why it changed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHY THE PHONE READ THE TAKE ITSELF.
 *
 *  • `server-sent-no-notes` — the route answered (it sent audio back) but sent no notes, so
 *    the phone did the pitch pass. This is the silent fallback vc65 exists to end.
 *  • `read-on-device`      — no server round trip happened at all (no round trip recorded on
 *    this read), so the phone is the only reader there is.
 */
export type ReadFallbackReason = 'server-sent-no-notes' | 'read-on-device';

/** The one sentence per reason. Plain words, no jargon, and no promise of a time. */
export const READ_FALLBACK_SERVER_LINE =
  'The notes could not be read on the server, so your phone is reading this take now. That is slower — the clock above keeps counting.';
export const READ_FALLBACK_DEVICE_LINE =
  'This take is being read on your phone, not on the server. That is slower — the clock above keeps counting.';

/** What the surface says, and why. */
export interface ReadFallbackNotice {
  reason: ReadFallbackReason;
  line: string;
}

/**
 * THE NOTICE FOR A READ, OR `null` WHEN THERE IS NOTHING TO SAY.
 *
 * `pitchSource: 'server'` means the route did the work — there is no fallback to announce and
 * a notice would be a lie. Only the device pass is announced.
 *
 * The round trip (`network`) is what separates the two reasons: a non-null round trip means
 * the request was made and answered, so the reader is the thing that came up short. A null
 * one means the read never went over the wire.
 */
export function readFallbackNotice(input: {
  pitchSource?: 'server' | 'device' | null;
  /** The round trip as recorded by the read; null = the request was never made. */
  network?: { httpStatus: number | null } | null;
}): ReadFallbackNotice | null {
  if (input?.pitchSource !== 'device') return null;
  const reachedServer = !!input?.network;
  return reachedServer
    ? { reason: 'server-sent-no-notes', line: READ_FALLBACK_SERVER_LINE }
    : { reason: 'read-on-device', line: READ_FALLBACK_DEVICE_LINE };
}
