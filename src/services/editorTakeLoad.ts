/**
 * editorTakeLoad.ts — WHICH TAKE THE CORRECTION EDITOR IS SHOWING, AND WHEN IT
 * RELOADS IT (v34, owner device pass 10-06: opening "Correct" from a History row
 * showed a BLANK "Your Corrected Take" and no key).
 *
 * THE CAUSE. `TakeCorrectionEditor` built its editable model exactly ONCE, in
 * `useState(() => createEditorState(take))` — i.e. at MOUNT, from whatever the
 * host happened to hold at that instant. Two ways that loses the take:
 *   • a host that mounts the editor permanently and opens it later
 *     (`HumSearchScreen`: `visible={editorOpen}`, `take={take}` starting as null)
 *     initializes the model from null, so every later open is blank;
 *   • a host that hydrates the row asynchronously (History opening the editor
 *     from a row whose take is read back from persistence) mounts with the old /
 *     missing take and never picks the loaded one up.
 * Both end at the same screen: an empty staff, "No key detected in this take",
 * nothing to correct — while the take is right there in persistence.
 *
 * THE RULE (pure, so it is asserted instead of hoped for). The model reloads when
 *   • the editor is OPENED (the host's take is authoritative on every open);
 *   • the incoming take is a DIFFERENT take (identity changed) and the user has
 *     not edited yet, so nothing of theirs can be lost;
 *   • the incoming take has notes and the model has none (the take arrived after
 *     the editor was already open — the History hydration case).
 * It never reloads under a user who has made an edit, so a correction can never
 * be wiped by a late state update.
 *
 * PURE: no react, no react-native, no expo. Asserted by scripts/v34Fixes.test.ts
 * (including a round-trip of a PERSISTED take into the editor model with its
 * notes and key intact), and the editor's use of it is scanned live by
 * scripts/v34UiWiring.test.ts.
 */
import type { SavedCaptureTake } from './midiExport';

/** The History row a take belongs to (null when the take is not saved yet). */
export type EditorRowId = string | null | undefined;

/**
 * A stable label for "which take is this". Two takes of the same row are the
 * same take when they carry the same capture stamp and the same note count — the
 * pair that changes when a take is re-recorded, corrected into a copy, or read
 * back from persistence.
 */
export function takeIdentityOf(
  take: SavedCaptureTake | null | undefined,
  rowId: EditorRowId,
): string {
  const row = typeof rowId === 'string' ? rowId : '';
  const stamp = typeof take?.capturedAt === 'string' ? take.capturedAt : '';
  const count = Array.isArray(take?.notes) ? take.notes.length : 0;
  return `${row}|${stamp}|${count}`;
}

/** How many notes a take really carries (never a guess, never a placeholder). */
export function takeNoteCount(take: SavedCaptureTake | null | undefined): number {
  return Array.isArray(take?.notes) ? take.notes.length : 0;
}

/** The facts the reload decision reads. */
export interface EditorLoadState {
  /** The identity the model was built from, or null before the first build. */
  loadedIdentity: string | null;
  /** The identity the host is handing over now. */
  incomingIdentity: string;
  /** True on the render where the editor goes from closed to open. */
  opened: boolean;
  /** True once the user has made any edit (undo/redo history is non-empty). */
  edited: boolean;
  /** How many notes the model currently holds. */
  currentNoteCount: number;
  /** How many notes the incoming take holds. */
  incomingNoteCount: number;
}

/**
 * Reload the model? See the header. Ordered by what the user would expect:
 * every open re-reads the host's take; a late-arriving take with notes fills a
 * blank editor; a different take replaces an untouched one; an edited model
 * survives everything short of a fresh open.
 */
export function shouldReloadEditorModel(input: EditorLoadState): boolean {
  if (input.opened) return true;
  if (input.incomingIdentity === input.loadedIdentity) return false;
  if (input.currentNoteCount === 0 && input.incomingNoteCount > 0) return true;
  return !input.edited;
}

/**
 * The honest line the editor shows when there is genuinely no take to correct —
 * never a blank page with "No key detected", which reads as a broken app rather
 * than as "this melody was saved without notes".
 */
export const EDITOR_NO_TAKE_LINE =
  'No notes were saved for this melody, so there is nothing to correct yet — record another take and its notes will be here.';

/** The chip the editor shows when a take DID load (so a loaded take is visible). */
export const EDITOR_LOADED_TAKE_LINE = 'Your saved take is loaded — correct any note below.';
