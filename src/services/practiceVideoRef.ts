/**
 * practiceVideoRef.ts — THE PURE HALF OF A PRACTICE VIDEO'S STORAGE DECISIONS
 * (owner GO 10-10, decisions 2/3/5; backlog a49fbe2d; design brief §2.2, §5.1).
 *
 * WHAT A PRACTICE VIDEO IS, AS DATA. The video file and the take's audio/notes are
 * a PAIR (decision 5), and the pair rides ONE additive block on the History row
 * the melody already lives on:
 *
 *   practiceVideo: { uri, durationSec, audioOffsetMs, measuredOffsetMs,
 *                    filmedAt, sizeBytes?, pairedSeparately }
 *
 * The block is additive and optional, exactly like `capture` and `personalMelody`
 * before it, so every row saved before this feature (and every non-video row)
 * keeps today's behaviour. `uri` points at a file in the app's DOCUMENTS
 * directory — never the recorder's cache, which is evictable and would leave a
 * row pointing at a dead file (the trap melodyStore already documents).
 *
 * THE THREE OWNER DECISIONS THAT LIVE HERE:
 *   • DECISION 3 — THE 3-MINUTE CAP: `PRACTICE_VIDEO_MAX_SECONDS` (with a warning
 *     well before it and a size cap), and the line the record screen shows.
 *   • DECISION 5 — THE TWO-FILE PAIR: the ref names the video; the take's notes
 *     stay where they already are (`capture` + `personalMelody`), so the MIDI/PDF
 *     exports and the editor keep working with or without the video.
 *   • DECISION 4 — OWN-TAKE-ONLY: the ref carries no recognised piece, no
 *     transcription and no external source; a ref is only usable when it points
 *     at a real file (`practiceVideoIsUsable` never "half-works").
 *
 * PURE: no react, no react-native, no expo, no fs (the write lives in
 * practiceVideoStore.ts, which is NOT tier1-compiled for exactly that reason).
 */
import type { SavedCaptureTake } from './midiExport';

/** DECISION 3 — the cap on one practice video (seconds). */
export const PRACTICE_VIDEO_MAX_SECONDS = 180;
/** A warning is shown once past this length, so the user is never surprised. */
export const PRACTICE_VIDEO_WARN_SECONDS = 60;
/** The size cap handed to the camera (250 MB) — a second, independent bound. */
export const PRACTICE_VIDEO_MAX_FILE_BYTES = 250 * 1024 * 1024;

/** Where the video files live inside the app's documents directory. */
export const PRACTICE_VIDEO_DIR_NAME = 'notesnap-practice-videos';
/** Everything this feature records is MP4 — the extension and the MIME agree. */
export const PRACTICE_VIDEO_MIME = 'video/mp4';
/** The Apple share-sheet type for an MP4. */
export const PRACTICE_VIDEO_UTI = 'public.mpeg-4';
/** The file-name stem, so a shared file is recognisable in the user's apps. */
export const PRACTICE_VIDEO_FILE_PREFIX = 'notesnap-practice';

/** The title a practice-video row lands under in History. */
export const PRACTICE_VIDEO_ROW_TITLE = 'Practice video';
export const PRACTICE_VIDEO_ROW_COMPOSER = 'Filmed on your device';

/** The Practice Tools card (design brief §2.1). */
export const PRACTICE_VIDEO_CARD_TITLE = 'Record your practice';
export const PRACTICE_VIDEO_CARD_SUBTITLE =
  'Film yourself playing. NoteSnap listens to the take and shows the notes you played over the video — from the sound, not the picture.';

/** The record screen's own copy. */
export const PRACTICE_VIDEO_SCREEN_TITLE = 'Record your practice';
export const PRACTICE_VIDEO_STOP_CTA = '● Stop';
export const PRACTICE_VIDEO_START_LINE = 'Getting the camera and the microphone ready…';
export const PRACTICE_VIDEO_ARMING_LINE = 'Ready — recording starts on its own.';
export const PRACTICE_VIDEO_RECORDING_LINE = 'Filming and listening';
export const PRACTICE_VIDEO_KEEPING_LINE = 'Keeping your video on this device…';
export const PRACTICE_VIDEO_PERMISSION_LINE =
  'NoteSnap needs the camera and the microphone to film your practice with sound.';
export const PRACTICE_VIDEO_PERMISSION_DENIED_LINE =
  'Camera and microphone access are off, so there is nothing to film with. You can turn them on for NoteSnap in your device settings.';
export const PRACTICE_VIDEO_START_FAILED_LINE =
  'The camera did not start, so nothing was filmed. Nothing was lost — tap Record again.';
export const PRACTICE_VIDEO_OPEN_SETTINGS_CTA = 'Open Settings';
export const PRACTICE_VIDEO_RECORD_AGAIN_CTA = 'Record again';
export const PRACTICE_VIDEO_DONE_CTA = 'Watch with notes';
export const PRACTICE_VIDEO_TAKE_RECORDED_LINE =
  'Saved to your History. Correct the notes below, then watch them over your video.';

/** The History row's chip and actions (design brief §2.5). */
export const PRACTICE_VIDEO_CHIP_LABEL = 'Practice video';
export const WATCH_PRACTICE_VIDEO_CTA = 'Watch practice video';
export const WATCH_PRACTICE_VIDEO_MISSING_LINE =
  'The video for this recording is no longer on this device.';
export const DELETE_PRACTICE_VIDEO_CTA = 'Delete the video';
export const DELETE_PRACTICE_VIDEO_CONFIRM_TITLE = 'Delete this practice video?';
/**
 * DECISION 5's independence promise, verbatim on the confirm: deleting the video
 * keeps the take, and every export built on the take, working.
 */
export const DELETE_PRACTICE_VIDEO_KEEPS_TAKE_LINE =
  'Your take, its notation, its PDF and its MIDI export all stay exactly as they are — only the video is removed.';
export const DELETE_PRACTICE_VIDEO_CANCEL_CTA = 'Keep it';
export const DELETE_PRACTICE_VIDEO_CONFIRM_CTA = 'Delete the video';
export const DELETE_PRACTICE_VIDEO_FAILED_LINE =
  'Could not remove the video just now. Nothing else was touched.';

/** One filmed practice take, as the row carries it. */
export interface PracticeVideoRef {
  /** The video file's URI — in the app's documents directory, never the cache. */
  uri: string;
  /** The video's own length, in seconds. */
  durationSec: number;
  /**
   * DECISION 1/2: how far the AUDIO capture's start is from the video's start, in
   * ms, as used by the overlay (`noteCuesForVideo`). It equals
   * `measuredOffsetMs` until the user nudges it by hand.
   */
  audioOffsetMs: number;
  /** What the two captures actually measured — the `Reset to measured` target. */
  measuredOffsetMs: number;
  /** ISO timestamp of the filming. */
  filmedAt: string;
  /** The file's size, when it was readable (the surface shows it; no guess). */
  sizeBytes?: number | null;
  /**
   * DECISION 2's honest flag: true when the notes come from a SEPARATE take
   * because the phone would not run two microphone clients at once. The surface
   * then prints VIDEO_SEPARATE_TAKE_LINE instead of pretending they are one take.
   */
  pairedSeparately?: boolean;
}

/** What we know the moment the two captures are stopped. */
export interface PracticeVideoCaptureInput {
  uri: string;
  durationSec: number;
  audioOffsetMs: number;
  measuredOffsetMs: number;
  filmedAt: string;
  sizeBytes?: number | null;
  pairedSeparately?: boolean;
}

/** `notesnap-practice-2026-10-10T09-15-00.mp4` — no characters a file system hates. */
export function practiceVideoFileName(title: string | null | undefined, filmedAt: string): string {
  const stem =
    typeof title === 'string' && title.trim().length > 0
      ? title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      : '';
  const stamp = (typeof filmedAt === 'string' && filmedAt.length > 0 ? filmedAt : '')
    .replace(/[^0-9A-Za-z]+/g, '-')
    .replace(/-+$/, '');
  const name = [PRACTICE_VIDEO_FILE_PREFIX, stem || null, stamp || null]
    .filter((part): part is string => !!part)
    .join('-');
  return `${name}.mp4`;
}

/** The MIME for a recorded file, from its extension (mp4/mov → video/*). */
export function videoMimeByExt(uri: string | null | undefined): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(typeof uri === 'string' ? uri : '')?.[1];
  if (extension && extension.toLowerCase() === 'mov') return 'video/quicktime';
  return PRACTICE_VIDEO_MIME;
}

/** The UTI for a recorded file, from its extension. */
export function videoUtiByExt(uri: string | null | undefined): string {
  return videoMimeByExt(uri) === 'video/quicktime' ? 'public.quicktime-movie' : PRACTICE_VIDEO_UTI;
}

/** Build the row's block from what the capture produced. */
export function practiceVideoRefFromCapture(input: PracticeVideoCaptureInput): PracticeVideoRef {
  const measured = Math.round(Number(input?.measuredOffsetMs) || 0);
  const applied = Number.isFinite(Number(input?.audioOffsetMs))
    ? Math.round(Number(input.audioOffsetMs))
    : measured;
  return {
    uri: typeof input?.uri === 'string' ? input.uri : '',
    durationSec: Math.max(0, Number(input?.durationSec) || 0),
    audioOffsetMs: applied,
    measuredOffsetMs: measured,
    filmedAt:
      typeof input?.filmedAt === 'string' && input.filmedAt.length > 0
        ? input.filmedAt
        : new Date().toISOString(),
    sizeBytes: Number.isFinite(Number(input?.sizeBytes)) ? Number(input?.sizeBytes) : null,
    pairedSeparately: input?.pairedSeparately === true ? true : undefined,
  };
}

/**
 * A ref is usable only when it names a real file. A row whose video is gone shows
 * the honest missing line and keeps every other action working — it is never
 * handed to the player, and never silently "plays" nothing.
 */
export function practiceVideoIsUsable(ref: PracticeVideoRef | null | undefined): boolean {
  if (!ref) return false;
  return typeof ref.uri === 'string' && ref.uri.trim().length > 0;
}

/** True when the offset in use is the user's own hand alignment, not the measurement. */
export function practiceVideoIsManuallyAligned(ref: PracticeVideoRef | null | undefined): boolean {
  if (!practiceVideoIsUsable(ref)) return false;
  return Math.round(Number(ref?.audioOffsetMs) || 0) !== Math.round(Number(ref?.measuredOffsetMs) || 0);
}

/** The row's chip line: length, size and whether the pair is a separate take. */
export function practiceVideoChipLine(ref: PracticeVideoRef | null | undefined): string | null {
  if (!practiceVideoIsUsable(ref)) return null;
  const duration = Math.max(0, Number(ref?.durationSec) || 0);
  const minutes = Math.floor(duration / 60);
  const seconds = Math.round(duration % 60);
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return ref?.pairedSeparately
    ? `${PRACTICE_VIDEO_CHIP_LABEL} · ${clock} · notes from a separate take`
    : `${PRACTICE_VIDEO_CHIP_LABEL} · ${clock}`;
}

/** DECISION 3's own line for the record screen. */
export const PRACTICE_VIDEO_MAX_LINE =
  'Up to 3 minutes per practice video — you can stop at any time.';

/** The remaining-time line while recording (0:00 means the cap is reached). */
export function practiceVideoRemainingLine(elapsedSec: number): string {
  const remaining = Math.max(0, PRACTICE_VIDEO_MAX_SECONDS - Math.max(0, Math.round(Number(elapsedSec) || 0)));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} left`;
}

/** True when the recording has passed the warning point. */
export function practiceVideoNeedsWarning(elapsedSec: number): boolean {
  return Math.round(Number(elapsedSec) || 0) >= PRACTICE_VIDEO_WARN_SECONDS;
}

/** The take's own honest caption on the playback surface. */
export function practiceVideoTakeLine(take: SavedCaptureTake | null | undefined): string | null {
  const count = Array.isArray(take?.notes) ? take.notes.length : 0;
  if (count === 0) return null;
  return `${count} note${count === 1 ? '' : 's'} read from your take`;
}
