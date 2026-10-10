/**
 * videoSendTo.ts — THE PRACTICE-VIDEO "SEND TO…" MODEL (owner GO 10-10, decision
 * 5; backlog a49fbe2d; design brief §4.4).
 *
 * WHAT LEAVES, AND HOW (decision 5 — THE TWO-FILE PAIR). Stage 1's export is a
 * PAIR, and the surface says so plainly:
 *
 *   • PRACTICE VIDEO — the .mp4 the user filmed, handed to the PLATFORM's share
 *     sheet, exactly as v37's Send-to does. Nothing is uploaded, nothing is
 *     emailed from our side, and the video never leaves except through the sheet
 *     the user themselves operates.
 *   • TAKE AS PDF / TAKE AS MIDI — the corrected take's own notation and its
 *     existing MIDI export: the notes NoteSnap heard. The MIDI path is handed in
 *     by the editor (`onSendMidi`), never re-implemented here — one MIDI path.
 *   • PLAIN SUMMARY — the text fallback when the platform cannot attach a file.
 *
 * NO DEAD AREAS (release gate, owner 09-28, and decision 2's KEEP-SOUND rule): a
 * record with neither a video nor a take offers NO destination at all; a record
 * whose take could not be read still offers the VIDEO, because the user's filming
 * is theirs and is still worth sending.
 *
 * PURE: no react, no react-native, no expo, no fs, no network. Reuses the v37
 * send vocabulary (`SendToStatus`, `SEND_TO_HONESTY`) so both surfaces say the
 * same thing the same way.
 */
import { MIDI_EXPORT_LABEL, type SavedCaptureTake } from './midiExport';
import { TAKE_PDF_HINT, TAKE_PDF_LABEL } from './takeNotationPdf';
import {
  SEND_TO_HONESTY,
  takeHasSomethingToSend,
  takeSummaryHeadline,
  type SendToStatus,
} from './takeSendTo';
import {
  PRACTICE_VIDEO_MAX_SECONDS,
  practiceVideoIsUsable,
  type PracticeVideoRef,
} from './practiceVideoRef';
import { midiName } from './takeSendTo';

/** The button on the playback surface that opens this sheet. */
export const VIDEO_SEND_CTA = 'Send to…';
/** The sheet's title. */
export const VIDEO_SEND_TITLE = 'Send your practice';
/** The way back to the video. */
export const VIDEO_SEND_BACK_CTA = '← Back to my practice';
/** Shown while a file is being built or a share sheet is opening. */
export const VIDEO_SEND_BUSY_LABEL = 'Preparing…';
/** Nothing to send at all (no video, no take) — the honest empty state. */
export const VIDEO_SEND_EMPTY_LINE =
  'There is nothing to send from this recording yet — film a take first.';

/** DECISION 5's pair line, verbatim on the surface (Stage 1 truth). */
export const VIDEO_SEND_PAIR_LINE =
  'The video and the notes travel as a pair: the video is your filming, the PDF and the MIDI are what NoteSnap heard. The video file itself has no notes drawn on it yet.';

/** The video destination's own words (design brief §4.4 table). */
export const VIDEO_SEND_VIDEO_LABEL = 'Practice video';
export const VIDEO_SEND_VIDEO_HINT =
  'Your practice video — filmed on your phone. Opens your share sheet; pick the app yourself.';
/** The text fallback's own words. */
export const VIDEO_SEND_SUMMARY_LABEL = 'Plain summary';
export const VIDEO_SEND_SUMMARY_HINT =
  'If this device cannot attach a file, we share a plain summary of your take instead.';
/** The MIDI destination's own hint (the label is the export's own). */
export const VIDEO_SEND_MIDI_HINT =
  'Your take as a .mid file — opens in any DAW or notation app.';

/** What a practice recording is, for this model. */
export interface VideoSendRecord {
  video?: PracticeVideoRef | null;
  take?: SavedCaptureTake | null;
}

export type VideoSendKind = 'video' | 'pdf' | 'midi' | 'summary';

export interface VideoSendAction {
  kind: VideoSendKind;
  label: string;
  hint: string;
}

/**
 * THE DESTINATIONS FOR THIS RECORDING. The video is offered whenever a real video
 * file exists, the take's exports whenever the take has notes, and the plain
 * summary as the honest text fallback. An empty record gets NOTHING.
 */
export function videoSendActions(rec: VideoSendRecord | null | undefined): VideoSendAction[] {
  const hasVideo = practiceVideoIsUsable(rec?.video ?? null);
  const hasTake = takeHasSomethingToSend(rec?.take ?? null);
  if (!hasVideo && !hasTake) return [];
  const actions: VideoSendAction[] = [];
  if (hasVideo) {
    actions.push({
      kind: 'video',
      label: VIDEO_SEND_VIDEO_LABEL,
      hint: VIDEO_SEND_VIDEO_HINT,
    });
  }
  if (hasTake) {
    actions.push({ kind: 'pdf', label: TAKE_PDF_LABEL, hint: TAKE_PDF_HINT });
    actions.push({ kind: 'midi', label: MIDI_EXPORT_LABEL, hint: VIDEO_SEND_MIDI_HINT });
    actions.push({ kind: 'summary', label: VIDEO_SEND_SUMMARY_LABEL, hint: VIDEO_SEND_SUMMARY_HINT });
  }
  return actions;
}

/** 'file' hands the platform a file, 'text' a plain summary, 'none' nothing at all. */
export type VideoSendMode = 'file' | 'text' | 'none';

export interface VideoSendPlan {
  mode: VideoSendMode;
  reason: string;
}

/**
 * THE ONE DECISION: file, text, or nothing — the same three-way shape v37's
 * `sendToPlan` uses, extended to a record that may hold a video and no take.
 */
export function videoSendPlan(input: {
  hasVideo: boolean;
  hasTake: boolean;
  shareSheetAvailable: boolean;
}): VideoSendPlan {
  const hasVideo = input?.hasVideo === true;
  const hasTake = input?.hasTake === true;
  if (!hasVideo && !hasTake) {
    return { mode: 'none', reason: VIDEO_SEND_EMPTY_LINE };
  }
  if (input?.shareSheetAvailable === true) {
    return { mode: 'file', reason: 'Handed to your device’s share sheet.' };
  }
  if (hasVideo && !hasTake) {
    return {
      mode: 'none',
      reason:
        'This device has no share sheet to send your practice video with right now, and there is no take to summarise.',
    };
  }
  return {
    mode: 'text',
    reason: 'This device cannot attach files, so your take is shared as a plain summary.',
  };
}

/** The take's one-line facts, in the app's own words (never invented). */
export function videoSummaryHeadline(rec: VideoSendRecord | null | undefined): string {
  const parts = [takeSummaryHeadline(rec?.take ?? null)];
  const video = rec?.video ?? null;
  if (practiceVideoIsUsable(video)) {
    const seconds = Math.max(0, Math.round(Number(video?.durationSec) || 0));
    parts.push(`video ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
  }
  return parts.join(' · ');
}

/**
 * THE PLAIN SUMMARY, shared when the platform cannot attach a file. It carries the
 * take's own facts, the pair line and the honesty line — and it claims nothing
 * about the video's picture. `maxNotes` bounds the note names it prints.
 */
export function videoSummaryText(
  rec: VideoSendRecord | null | undefined,
  opts: { title?: string | null; maxNotes?: number } = {},
): string {
  const title = (opts.title ?? '').trim() || 'My practice take';
  const take = rec?.take ?? null;
  const notes = Array.isArray(take?.notes) ? take.notes : [];
  const max = typeof opts.maxNotes === 'number' && opts.maxNotes > 0 ? opts.maxNotes : 24;
  const shown = notes
    .filter((note) => !!note && Number.isFinite(Number(note?.midi)))
    .slice(0, max)
    .map((note) => midiName(Number(note.midi)));
  const more = notes.length > shown.length ? `, … (${notes.length - shown.length} more)` : '';
  return [
    `${title} — sent from NoteSnap`,
    videoSummaryHeadline(rec),
    shown.length > 0 ? `Notes: ${shown.join(', ')}${more}` : 'No notes were read from this take.',
    VIDEO_SEND_PAIR_LINE,
    SEND_TO_HONESTY,
  ].join('\n');
}

/** The honesty line, reused verbatim from the v37 Send-to surface. */
export function videoShareHonesty(): string {
  return SEND_TO_HONESTY;
}

/** DECISION 3's cap, as the surface states it (no invented numbers). */
export function maxRecordingLine(): string {
  return `Up to ${Math.round(PRACTICE_VIDEO_MAX_SECONDS / 60)} minutes per practice video — you can stop at any time.`;
}

/** The sentence the surface shows after an attempt, per destination. */
export function videoSendOutcomeMessage(status: SendToStatus, kind: VideoSendKind): string {
  const what =
    kind === 'video'
      ? 'your practice video'
      : kind === 'pdf'
        ? 'the PDF'
        : kind === 'midi'
          ? 'the MIDI file'
          : 'your take';
  if (status === 'shared') {
    return `Opened your share sheet with ${what} — pick the app you want to send it with.`;
  }
  if (status === 'dismissed') {
    return `${what.charAt(0).toUpperCase()}${what.slice(1)} is still on this device — nothing was sent.`;
  }
  if (status === 'unavailable') {
    return `This device has no share sheet to send ${what} with right now.`;
  }
  return `We could not prepare ${what} just now. Please try again.`;
}
