/**
 * scoreShare.ts — how a TRANSPOSED SCORE is handed to the OS share sheet (v39
 * Part 2, owner direction 10-11: "save the transposed copy … and share it").
 *
 * WHY A NEW MODULE. The app already shares two things, and neither one fits a
 * score: `takeSendDevice`/`takeNotationPdf` are take-specific (a recorded
 * performance and its rendered PDF), and `shareCardShare` shares a captured PNG.
 * A score is TEXT — the ABC the reader is showing — so the payload is either the
 * `.abc` file itself through `expo-sharing` (the pattern shareCardShare proved on
 * Android, where React Native's `Share` only ever receives `{ title, message }`
 * and drops a file URL silently) or the score as text through `Share`.
 *
 * HONEST BY CONSTRUCTION. The copy never claims the sheet opened: the caller shows
 * `SCORE_SHARE_FAILED_HINT` when the OS refuses, exactly as the share card does.
 * No brand URL is embedded here on purpose — the `.abc` (or the ABC text) IS the
 * payload, and this module is covered by the v39 network sweep, which requires the
 * reader's whole path to be incapable of reaching the network.
 *
 * PURE: no react, no react-native, no fs, no network. Compiles and runs under
 * tsconfig.tier1.json.
 */

/** The `.abc` file's MIME type (plain text — ABC is a text notation). */
export const SCORE_SHARE_MIME_TYPE = 'text/plain';

/** Inline hint when the OS share sheet itself refused to open. */
export const SCORE_SHARE_FAILED_HINT =
  'Couldn’t open the share sheet — nothing was sent. Tap Share to try again.';

/** Inline hint when a real file could not be produced for the share. */
export const SCORE_SHARE_FILE_UNAVAILABLE_HINT =
  'Sharing the score as text — the .abc file could not be written';

/** The extension a shared score carries. */
export const SCORE_SHARE_EXTENSION = '.abc';

/** Reduced to this many characters, so an enormous title still makes a filename. */
const FILENAME_BASE_MAX = 60;

/**
 * A filename the OS can hold: lowercase, accent-folded, punctuation collapsed to
 * `-`, and capped. "Für Elise" + Am + 2 becomes `fur-elise-am-plus2.abc`, which is
 * recognisable in a share sheet and in the receiving app's downloads.
 */
export function scoreShareFilename(input: {
  title: unknown;
  keyLabel: unknown;
  offset: unknown;
}): string {
  const base = fold(input?.title) || 'notesnap-score';
  const key = fold(input?.keyLabel) || 'c';
  const rawOffset = Number(input?.offset);
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  const shift = offset === 0 ? 'original' : `${offset > 0 ? 'plus' : 'minus'}${Math.abs(offset)}`;
  return `${base}-${key}-${shift}${SCORE_SHARE_EXTENSION}`;
}

/** Lowercase, accent-folded, hyphenated, capped — or '' when nothing survives. */
function fold(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FILENAME_BASE_MAX)
    .replace(/-+$/g, '');
}

/**
 * The sentence that travels with the score (the Android chooser title, and the
 * text fallback's opening line). It names the piece, and says which key and shift
 * the copy is in — the thing the user actually chose.
 */
export function scoreShareText(input: {
  title: unknown;
  keyLabel: unknown;
  offset: unknown;
}): string {
  const title =
    typeof input?.title === 'string' && input.title.trim().length > 0
      ? input.title.trim()
      : 'Sheet music';
  const keyLabel =
    typeof input?.keyLabel === 'string' && input.keyLabel.trim().length > 0
      ? input.keyLabel.trim()
      : 'C';
  const rawOffset = Number(input?.offset);
  const offset = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  if (offset === 0) {
    return `“${title}” — sheet music in ABC notation (key of ${keyLabel})`;
  }
  const sign = offset > 0 ? '+' : '';
  return `“${title}” — sheet music in ABC notation, transposed to ${keyLabel} (${sign}${offset} semitones)`;
}

export type ScoreSharePayload =
  | {
      /** Hand the `.abc` file to the OS through expo-sharing. */
      mode: 'file';
      fileUri: string;
      mimeType: string;
      dialogTitle: string;
    }
  | {
      /** Text-only fallback through React Native's Share API. */
      mode: 'text';
      message: string;
    };

export interface ScoreSharePayloadInput {
  /** The ABC text being shared — the score itself (always the fallback payload). */
  abc: string;
  title: unknown;
  keyLabel: unknown;
  offset: unknown;
  /** Local file URI of the written `.abc`, when the caller managed to write one. */
  fileUri?: string | null;
  /**
   * Whether file sharing is usable here (`Sharing.isAvailableAsync()`; false on
   * web and some emulators) — the same check shareCardShare makes.
   */
  fileSharingAvailable: boolean;
}

/**
 * THE DECISION. A real `.abc` file is shared only when one exists AND the platform
 * can share files. Otherwise the score travels as TEXT: the ABC notation is what a
 * musician can paste into any notation app, so the fallback is the score, not a
 * dead end.
 */
export function buildScoreSharePayload(input: ScoreSharePayloadInput): ScoreSharePayload {
  const uri =
    typeof input.fileUri === 'string' && input.fileUri.length > 0 ? input.fileUri : undefined;
  const sentence = scoreShareText({
    title: input.title,
    keyLabel: input.keyLabel,
    offset: input.offset,
  });
  if (uri && input.fileSharingAvailable) {
    return {
      mode: 'file',
      fileUri: uri,
      mimeType: SCORE_SHARE_MIME_TYPE,
      // The sentence is where the piece and its key survive a file-only share.
      dialogTitle: sentence,
    };
  }
  const abc = typeof input.abc === 'string' ? input.abc.trim() : '';
  return {
    mode: 'text',
    message: abc.length > 0 ? `${sentence}\n\n${abc}` : sentence,
  };
}
