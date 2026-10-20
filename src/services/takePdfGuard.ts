/**
 * takePdfGuard.ts — THE "NOTHING RECORDED" GUARD ON THE TAKE PDF (v41 item 2).
 *
 * THE OWNER'S v40 DEVICE PASS (10-18): a practice-video take, exported with
 * "Take as PDF", shared a ~8 KB file that opened as an empty page — header text,
 * an empty staff and no music. Two things produced it: the video take itself had
 * captured nothing usable (item 1's dead audio path), and the PDF export happily
 * wrote a page for a take whose notes were not actually playable data (no
 * sounding length, so nothing a staff can place).
 *
 * THE RULE THIS FILE ENFORCES: a take with nothing usable recorded in it never
 * becomes a file. Not a stub, not a tilted empty staff, not "8 KB of nothing" in
 * the user's share sheet — an honest sentence instead, on the surface that offered
 * the export. A take that DOES hold usable notes keeps the real path unchanged
 * (the same bytes, the same structure gate, the same read-back).
 *
 * WHAT "USABLE" MEANS, exactly: at least one note that carries a real pitch
 * (a finite MIDI number in 0..127) AND a real sounding length (> 0 seconds).
 * A note with no length is not a note the page can draw honestly, and a take of
 * only those is exactly the stub PDF the owner was handed.
 *
 * PURE: no react, no react-native, no expo, no fs. Asserted by
 * scripts/uxr-v41-fixes.test.ts (and wired into services/takeSendDevice.ts and
 * services/videoSendTo.ts).
 */
import type { SavedCaptureTake } from './midiExport';

/** The honest state shown instead of a stub file. */
export const TAKE_PDF_NOTHING_RECORDED_MESSAGE =
  'Nothing was recorded in this take, so there is no PDF to make. Record a take with at least one note, then export again.';

/** The same rule, said in the send-to list (why the PDF row is not there). */
export const VIDEO_SEND_NOTHING_RECORDED_LINE =
  'This recording holds no notes yet, so there is no PDF or MIDI to send — the video itself is still yours to share.';

/** A note as the guard reads it (a stored take may carry anything at all). */
export interface PdfGuardNote {
  midi?: unknown;
  startSec?: unknown;
  durationSec?: unknown;
  [key: string]: unknown;
}

/** The take shape as the guard reads it — loose on purpose (loaded data). */
export interface PdfGuardTake {
  notes?: ReadonlyArray<PdfGuardNote> | null;
  durationSec?: unknown;
  [key: string]: unknown;
}

/** Does one note carry a real pitch and a real sounding length? */
export function noteIsUsable(note: PdfGuardNote | null | undefined): boolean {
  if (!note || typeof note !== 'object') return false;
  const midi = Number(note.midi);
  if (!Number.isFinite(midi) || midi < 0 || midi > 127) return false;
  const duration = Number(note.durationSec);
  return Number.isFinite(duration) && duration > 0;
}

/**
 * How many notes of this take are usable — the number the surface can trust.
 * Zero means: this take has nothing to draw, whatever its length says.
 */
export function takePdfUsableNoteCount(take: PdfGuardTake | SavedCaptureTake | null | undefined): number {
  const notes = (take as PdfGuardTake | null | undefined)?.notes;
  if (!Array.isArray(notes)) return 0;
  let count = 0;
  for (const note of notes) {
    if (noteIsUsable(note)) count += 1;
  }
  return count;
}

/** What the guard decided, with the sentence to show. */
export interface TakePdfGuardVerdict {
  /** True = do NOT write a file; show `message` instead. */
  refused: boolean;
  /** How many usable notes the take really held. */
  usableNotes: number;
  /** The honest sentence ('' when the export may proceed). */
  message: string;
}

/**
 * The verdict for one take. `refused` only when the take holds NOTHING usable —
 * a short take of one real note is still a real take and still exports.
 */
export function takePdfVerdict(
  take: PdfGuardTake | SavedCaptureTake | null | undefined,
): TakePdfGuardVerdict {
  const usableNotes = takePdfUsableNoteCount(take);
  return usableNotes > 0
    ? { refused: false, usableNotes, message: '' }
    : { refused: true, usableNotes, message: TAKE_PDF_NOTHING_RECORDED_MESSAGE };
}

/**
 * The size a real page cannot be under: a one-note page is already several
 * kilobytes (page furniture + fonts + one system). Anything smaller than this is
 * the stub the owner was handed, whatever the builder thought it drew — a second,
 * independent check on the BYTES rather than on the notes.
 */
export const TAKE_PDF_MIN_MEANINGFUL_BYTES = 900;

/** True when the built bytes are too small to be a real page. */
export function takePdfBytesLookEmpty(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes) return true;
  return bytes.length < TAKE_PDF_MIN_MEANINGFUL_BYTES;
}
