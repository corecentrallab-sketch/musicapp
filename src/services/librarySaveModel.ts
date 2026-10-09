/**
 * librarySaveModel.ts — the PURE half of "Save to library" for a public-domain
 * piece (v37 item 4, backlog d9d458bb, owner v36 ask item 9).
 *
 * WHY IT EXISTS. The owner recognized a public-domain piece and had nowhere to
 * PUT it: the score was viewable for that session only, and the app's own
 * on-device library (Persistence Phase 4a — `library/` in the app's documents,
 * the registry in AsyncStorage) could only be filled from the import picker, the
 * camera and cloud sync. This is the missing door: one explicit action on a PD
 * result card and on the PD piece page that writes the score the user is looking
 * at into that SAME library, so it opens offline afterwards.
 *
 * WHAT IS PURE HERE. The words the button shows, the file name the saved copy
 * gets, which URL is worth saving at all, and the label for each state — every
 * decision a test can settle without a device. The write itself is in
 * services/pieceLibrarySave.ts (expo-file-system + the EXISTING library store);
 * this module imports nothing but its own constants, so it compiles and runs
 * under plain Node (tsconfig.tier1.json).
 *
 * HONESTY RULES THAT LIVE HERE.
 *   • the label is a FUNCTION of the real state — `saved` can only be shown after
 *     a successful write (or a registry read that found the item), never on the
 *     optimistic assumption that a tap worked;
 *   • there is nothing to save without a hosted score URL, and the caller says so
 *     (`SAVE_TO_LIBRARY_NO_SCORE_LINE`) instead of offering a button that can
 *     only fail;
 *   • the saved file keeps a real extension (the library's own kind mapping is
 *     extension-driven), so a saved score opens through the EXISTING viewer.
 */

/** The action's label, in the owner's words: an explicit verb, no icon-only tap. */
export const SAVE_TO_LIBRARY_LABEL = 'Save to library';
/** While the download + copy is running. */
export const SAVING_TO_LIBRARY_LABEL = 'Saving to library…';
/** The saved state — the button flips to this and stops acting. */
export const SAVED_TO_LIBRARY_LABEL = 'Saved to library ✓';
/** What the action really does: a copy on THIS device, offline afterwards. */
export const SAVE_TO_LIBRARY_HINT =
  'Keeps a copy on this device — your Library opens it offline.';
/** The line the surface shows once the write landed. */
export const SAVED_TO_LIBRARY_LINE =
  'Saved to your library — it opens offline, any time.';
/** A failed save is never silent (a silent failure reads as a dead button). */
export const SAVE_TO_LIBRARY_FAILED_MESSAGE =
  'We could not save that score — check your connection and try again.';
/** There is no hosted score we may hand out for this piece. */
export const SAVE_TO_LIBRARY_NO_SCORE_LINE =
  'There is no hosted score to save for this piece yet.';

/** The four real states of the action (never a fifth, "probably saved"). */
export type LibrarySaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The button's label for a state. `saved` is only ever passed in from a real
 * write result or a real registry read — see services/pieceLibrarySave.ts.
 */
export function saveToLibraryLabel(state: LibrarySaveState | null | undefined): string {
  switch (state) {
    case 'saving':
      return SAVING_TO_LIBRARY_LABEL;
    case 'saved':
      return SAVED_TO_LIBRARY_LABEL;
    default:
      return SAVE_TO_LIBRARY_LABEL;
  }
}

/** True when the action must not fire again (it is running, or already done). */
export function saveToLibraryIsBusy(state: LibrarySaveState | null | undefined): boolean {
  return state === 'saving' || state === 'saved';
}

/** Extensions the library store understands (mirrors its own kind mapping). */
const SAVEABLE_EXTENSIONS: readonly string[] = [
  'pdf',
  'musicxml',
  'mxl',
  'xml',
  'mid',
  'midi',
  'gp3',
  'gp4',
  'gp5',
  'gpx',
  'gp',
  'abc',
];

/**
 * The extension the saved copy should carry, read from the URL's PATH (never its
 * query or fragment: our scores are served through a proxy, and a `?v=2` tail is
 * not a file type). Anything the library cannot open falls back to `pdf`, which
 * is what every hosted PD score in this catalog is.
 */
export function scoreFileExtension(url: string | null | undefined): string {
  if (typeof url !== 'string') return 'pdf';
  const withoutQuery = url.split('#')[0].split('?')[0];
  const slash = withoutQuery.lastIndexOf('/');
  const last = slash >= 0 ? withoutQuery.slice(slash + 1) : withoutQuery;
  const dot = last.lastIndexOf('.');
  if (dot < 0) return 'pdf';
  const ext = last.slice(dot + 1).toLowerCase();
  return SAVEABLE_EXTENSIONS.indexOf(ext) >= 0 ? ext : 'pdf';
}

/** Strip anything that cannot live in a file name (the repo's own export rule). */
function safePart(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The name the saved copy gets: `<Title> - <Composer>.<ext>`, sanitised, bounded,
 * and never empty (a blank title must not produce a nameless library row).
 */
export function libraryScoreFileName(
  title: string | null | undefined,
  composer?: string | null,
  url?: string | null,
): string {
  const ext = scoreFileExtension(url);
  const head = safePart(title);
  const tail = safePart(composer);
  const base = [head, tail].filter((part) => part.length > 0).join(' - ');
  const safe = base.length > 0 ? base : 'notesnap-score';
  return `${safe.slice(0, 80)}.${ext}`;
}

/** True when this URL is something we can actually download and keep. */
export function isSaveableScoreUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length < 8) return false;
  return /^https?:\/\//i.test(trimmed);
}
