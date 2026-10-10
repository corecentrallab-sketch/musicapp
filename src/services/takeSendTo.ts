/**
 * takeSendTo.ts — THE "SEND TO…" SURFACE'S PURE MODEL (v37 item 7, backlog
 * baa39e66).
 *
 * WHAT THE OWNER ASKED FOR. A "Send to…" action on the Correct-Your-Take page so
 * the corrected take can leave the device for future use: (a) the take as a PDF,
 * (b) the take to the user's own email, (c) the MIDI export that already exists.
 *
 * THE RULE THIS MODULE ENFORCES. Nothing is ever emailed from our side. Every
 * destination is handed to the PLATFORM's share sheet and the user chooses there —
 * we do not run a mail server, we do not touch an inbox, and we never claim a send
 * that the user did not make themselves. `sendToPlan` is the decision in one
 * place: a file when the platform can carry one and we have one, the plain text
 * summary otherwise, and nothing at all when the take is empty.
 *
 * PURE: no react, no react-native, no fs, no network — so the tier1 gate pins the
 * destination list, the summary text and the outcomes with no device in the loop
 * (scripts/v37TakeExport.test.ts).
 */
import { MIDI_EXPORT_LABEL, type SavedCaptureTake } from './midiExport';
import { TAKE_PDF_HINT, TAKE_PDF_LABEL } from './takeNotationPdf';

/** The button on the editor that opens the surface. */
export const SEND_TO_CTA = 'Send to…';
/** The surface's title. */
export const SEND_TO_TITLE = 'Send your take';
/**
 * The line at the top of the surface. It says the whole truth about the route:
 * the user's own apps do the sending.
 */
export const SEND_TO_HONESTY =
  'Everything here leaves through your own device — nothing is emailed from our side.';
/** The email destination's own words. */
export const SEND_TO_EMAIL_LABEL = 'Send to my email';
export const SEND_TO_EMAIL_HINT =
  'Opens the system share sheet — pick your email app (or any other app) and send it yourself.';
/** What the email route does when the platform cannot hand a file to a share sheet. */
export const SEND_TO_TEXT_HINT =
  'If this device cannot attach a file, we share a plain summary of your take instead.';

/** What each destination does — the surface renders exactly this list. */
export type SendToKind = 'pdf' | 'midi' | 'email';

export interface SendToAction {
  kind: SendToKind;
  label: string;
  hint: string;
}

/** The label/hint for each destination, from the models (never re-typed). */
export const SEND_TO_ACTIONS: readonly SendToAction[] = [
  { kind: 'pdf', label: TAKE_PDF_LABEL, hint: TAKE_PDF_HINT },
  { kind: 'midi', label: MIDI_EXPORT_LABEL, hint: 'Your take as a .mid file — opens in any DAW or notation app.' },
  { kind: 'email', label: SEND_TO_EMAIL_LABEL, hint: SEND_TO_EMAIL_HINT },
];

/** A take can be sent only when it really holds notes we can write out. */
export function takeHasSomethingToSend(
  take: SavedCaptureTake | null | undefined,
): boolean {
  const notes = take?.notes;
  if (!Array.isArray(notes)) return false;
  return notes.some((note) => !!note && Number.isFinite(note?.midi));
}

/**
 * THE DESTINATIONS FOR THIS TAKE. An empty take gets NOTHING — a Send-to surface
 * whose every entry can only fail is exactly the dead area the release gate
 * forbids (no dead areas, owner 09-28). The order is the model's order: PDF,
 * MIDI, email.
 */
export function sendToActions(
  take: SavedCaptureTake | null | undefined,
): SendToAction[] {
  if (!takeHasSomethingToSend(take)) return [];
  return SEND_TO_ACTIONS.slice();
}

/** The one-line facts an email body can carry without inventing anything. */
export function takeSummaryHeadline(take: SavedCaptureTake | null | undefined): string {
  const count = Array.isArray(take?.notes) ? take.notes.length : 0;
  const tempo =
    typeof take?.tempoBpm === 'number' && Number.isFinite(take.tempoBpm) && take.tempoBpm > 0
      ? Math.round(take.tempoBpm)
      : null;
  const key = takeKeyLabel(take);
  const parts = [`${count} note${count === 1 ? '' : 's'}`];
  if (key) parts.push(`key ${key}`);
  if (tempo !== null) parts.push(`${tempo} bpm`);
  return parts.join(' · ');
}

/** The take's key in the app's own words, or null when it never had one. */
export function takeKeyLabel(take: SavedCaptureTake | null | undefined): string | null {
  const key = take?.key;
  if (!key || !Number.isFinite(key.tonic as number)) return null;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pc = ((Math.round(Number(key.tonic)) % 12) + 12) % 12;
  return `${names[pc]} ${key.mode === 'minor' ? 'minor' : 'major'}`;
}

/**
 * THE PLAIN SUMMARY shared when the platform cannot attach a file. It carries the
 * take's own facts (count, key, tempo, the note names in order) and the honest
 * framing: this is the user's own hummed take, not a transcription of anything.
 */
export function takeSummaryText(
  take: SavedCaptureTake | null | undefined,
  opts: { title?: string | null; maxNotes?: number } = {},
): string {
  const title = (opts.title ?? '').trim() || 'Your take';
  const notes = Array.isArray(take?.notes) ? take.notes : [];
  const max = typeof opts.maxNotes === 'number' && opts.maxNotes > 0 ? opts.maxNotes : 24;
  const shown = notes
    .filter((note) => !!note && Number.isFinite(note?.midi))
    .slice(0, max)
    .map((note) => midiName(Number(note.midi)));
  const more = notes.length > shown.length ? `, … (${notes.length - shown.length} more)` : '';
  return [
    `${title} — sent from NoteSnap`,
    takeSummaryHeadline(take),
    shown.length > 0 ? `Notes: ${shown.join(', ')}${more}` : 'No notes in this take.',
    'This is my own hummed take as NoteSnap heard it — not a published score.',
  ].join('\n');
}

/** Scientific pitch name (60 = C4) — the same spelling the tab and staff use. */
export function midiName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const value = Math.round(Number(midi));
  if (!Number.isFinite(value)) return '?';
  return `${names[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`;
}

/** What a Send-to attempt may report — never a silent no-op. */
export type SendToStatus = 'shared' | 'dismissed' | 'unavailable' | 'failed';
/** 'file' hands the platform a file, 'text' a plain summary, 'none' nothing at all. */
export type SendToMode = 'file' | 'text' | 'none';

export interface SendToPlan {
  mode: SendToMode;
  /** Why that mode — the sentence the surface can show when it matters. */
  reason: string;
}

/**
 * THE ONE DECISION: file, text, or nothing.
 *
 *   • no usable take → 'none' (the surface offers no destination at all);
 *   • the platform can carry a file → 'file' (the PDF, and for the MIDI entry the
 *     .mid the export already builds);
 *   • the platform cannot → 'text', the plain summary, which is still a real
 *     route out of the app rather than a button that does nothing.
 */
export function sendToPlan(input: {
  hasTake: boolean;
  shareSheetAvailable: boolean;
}): SendToPlan {
  if (!input.hasTake) {
    return { mode: 'none', reason: 'This take has no notes to send yet.' };
  }
  if (input.shareSheetAvailable) {
    return { mode: 'file', reason: 'Handed to your device’s share sheet.' };
  }
  return {
    mode: 'text',
    reason: 'This device cannot attach files, so your take is shared as a plain summary.',
  };
}

/** The sentence the surface shows after an attempt, per destination. */
export function sendToOutcomeMessage(status: SendToStatus, kind: SendToKind): string {
  const what =
    kind === 'pdf' ? 'the PDF' : kind === 'midi' ? 'the MIDI file' : 'your take';
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
