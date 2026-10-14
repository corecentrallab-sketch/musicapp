/**
 * takeNotes.ts — THE USER'S OWN WORDS ON A TAKE (v39 fix 3, owner 10-11: "a notes
 * box … where the user can type their own text to identify the take's contents",
 * on the History cards for their own melody takes and for practice-video takes).
 *
 * WHAT IT IS. One short line of the user's own text, attached to the take RECORD
 * (the same History row that already carries `capture`, `personalMelody` and
 * `practiceVideo`), editable on the card, kept with the take, and travelling with
 * the take when it is shared (see `takeSummaryText` in services/takeSendTo.ts).
 *
 * WHAT IT IS NOT, ON PURPOSE:
 *   • never generated — the app writes nothing into this field on its own, so a
 *     note on a card is always something the user typed;
 *   • never a second name for the PIECE — a take is the user's own recording and
 *     the row keeps its title; this is a label for the take's contents;
 *   • never required — a take with no note renders its label and nothing else, and
 *     clearing the field removes the note (the row keeps everything else).
 *
 * PURE (no react / react-native / fs / AsyncStorage): the label, the normalisation
 * and the share line are asserted by scripts/v39OwnerRound.test.ts. The write goes
 * through the History store (`storage.updateRecognitionNote`, wrapped for melody
 * rows by `melodyStore.updatePersonalMelodyNote`).
 */

/** The box's label — the owner's own words for it. */
export const TAKE_NOTE_LABEL = 'Name the take';
/** What the box is for, in one honest sentence. */
export const TAKE_NOTE_HINT =
  'Your own words for this take — they stay with it, on this device, and travel with it when you share it.';
/** The empty field's prompt. An example, never a claim. */
export const TAKE_NOTE_PLACEHOLDER = 'e.g. Take 3 · verse, slow';
/** The save action in the inline editor. */
export const TAKE_NOTE_SAVE_CTA = 'Save note';
/** The cancel action in the inline editor. */
export const TAKE_NOTE_CANCEL_CTA = 'Cancel';
/** Shown while the write is in flight. */
export const TAKE_NOTE_SAVING_LINE = 'Saving…';
/** The honest outcome lines — a failed write is never silent. */
export const TAKE_NOTE_SAVED_LINE = 'Saved with this take.';
export const TAKE_NOTE_CLEARED_LINE = 'Note removed — the take is unchanged.';
export const TAKE_NOTE_FAILED_LINE =
  'That note could not be saved just now — the take is unchanged. Please try again.';

/** The longest note we keep (one line's worth — never a paragraph box). */
export const TAKE_NOTE_MAX_LENGTH = 120;

/**
 * The note as it will be stored: whitespace collapsed, trimmed, cut to the limit,
 * and null when there is nothing left. Null (not '') is what the store records, so
 * "no note" and "an empty note" cannot drift apart.
 */
export function normaliseTakeNote(raw: string | null | undefined): string | null {
  const collapsed = (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, TAKE_NOTE_MAX_LENGTH).trim() || null;
}

/** The stored note, read back safely from a row (never a non-string). */
export function takeNoteOf(row: { takeNote?: unknown } | null | undefined): string | null {
  const value = row?.takeNote;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** The line the card shows when a note is set, or null when there is none. */
export function takeNoteLine(row: { takeNote?: unknown } | null | undefined): string | null {
  const note = takeNoteOf(row);
  return note ? `Notes: ${note}` : null;
}

/**
 * Can this row hold a note? A take row does — one of the user's OWN takes (a
 * melody row, a filmed take, or a row whose audio was kept); a recognized piece of
 * published music is not a take and gets no box.
 */
export function takeCanHoldNote(row: {
  personalMelody?: unknown;
  practiceVideo?: unknown;
  capture?: { notes?: unknown } | null;
  [key: string]: unknown;
} | null | undefined): boolean {
  if (!row || typeof row !== 'object') return false;
  if (row.personalMelody) return true;
  if (row.practiceVideo) return true;
  const notes = row.capture?.notes;
  return Array.isArray(notes) && notes.length > 0;
}

/** What a save attempt reports, from the store's own success flag. */
export function takeNoteSaveOutcome(input: {
  saved: boolean;
  /** True when the user cleared the field (the row keeps no note afterwards). */
  cleared: boolean;
}): string {
  if (!input.saved) return TAKE_NOTE_FAILED_LINE;
  return input.cleared ? TAKE_NOTE_CLEARED_LINE : TAKE_NOTE_SAVED_LINE;
}

/**
 * The note's line in a SHARE payload (the Send-to summary, the emailed take). Null
 * when there is no note, so nothing is invented on a shared take.
 */
export function takeNoteShareLine(raw: string | null | undefined): string | null {
  const note = normaliseTakeNote(raw);
  return note ? `Note: ${note}` : null;
}

// ────────── THE STORE CONTRACT (what the write path must expose) ──────────

/** The History-store write the note travels through. */
export const TAKE_NOTE_STORE_WRITE = 'updateRecognitionNote(';
/** The melody-row wrapper the History card calls. */
export const TAKE_NOTE_ROW_WRITE = 'updatePersonalMelodyNote(';
/** The field's own name on a saved row. */
export const TAKE_NOTE_FIELD = 'takeNote';

/**
 * True when the History screen really renders and persists the box: the label and
 * the field are on the screen, the row-level write is called, and the editor's
 * text is normalised by this module (never written raw).
 */
export function historyTakeNotesWired(historySource: string): boolean {
  const source = typeof historySource === 'string' ? historySource : '';
  if (source.length < 15000) return false;
  const markers = [
    'takeCanHoldNote(item)',
    'TAKE_NOTE_LABEL',
    'TAKE_NOTE_SAVE_CTA',
    'normaliseTakeNote(',
    'updatePersonalMelodyNote(',
    'TAKE_NOTE_PLACEHOLDER',
  ];
  return markers.every((marker) => source.indexOf(marker) >= 0);
}

/**
 * True when a shared take carries the user's note. `summary` is the payload the
 * share/email route builds; when the row has a note the payload must contain it.
 */
export function sharePayloadCarriesTheNote(summary: string, note: string | null | undefined): boolean {
  const line = takeNoteShareLine(note);
  if (!line) return true;
  return typeof summary === 'string' && summary.indexOf(line) >= 0;
}
