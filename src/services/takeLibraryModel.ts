/**
 * takeLibraryModel.ts — the PURE half of "Save to library" for the user's OWN
 * practice take (owner decision 2026-11-24, option A).
 *
 * WHY IT EXISTS. Library was written only from four deliberate buttons (Scan,
 * "Save to library" on a recognition result, a piece detail page, and the
 * notation editor's save). A practice video had NO route into Library at all: it
 * landed in History and stayed there. History is the record of everything the
 * user played; Library is what they deliberately kept. This module holds the
 * decisions that make the missing door cheap and honest:
 *
 *   • WHICH TAKE CAN BE SAVED — one with notes. A take that was never read has
 *     nothing to write, so no button is offered at all (`takeSaveOffered`).
 *   • WHAT THE SAVED COPY IS CALLED — `transposedCopyTitle`, the notation
 *     editor's OWN builder (services/transposedScore.ts), so a take saved from
 *     History and the same take saved from the result card cannot be named two
 *     different ways, and a take saved at its original key still says which key
 *     that is. Offset is always 0 here: a take is not a transposition.
 *   • WHAT TEXT IS WRITTEN — the ABC the take card already draws
 *     (`takeStaffRows`, the card's own model), not a second notation pipeline.
 *   • THE SENTENCE THAT EXPLAINS THE SPLIT — one line, shared by both surfaces.
 *
 * PURE (no react / react-native / expo / AsyncStorage): the write itself is
 * `addAbcToLibrary` in services/libraryStore.ts, called by the screens. This
 * module compiles under tsconfig.tier1.json and is asserted by
 * scripts/takeLibrarySave.test.ts.
 */
import { takeStaffRows } from './takeStaff';
import { transposedCopyTitle } from './transposedScore';
import type { SavedCaptureTake } from './midiExport';

/** The action's label — an explicit verb, the same words the other doors use. */
export const SAVE_TAKE_TO_LIBRARY_LABEL = 'Save to library';
/** While the write is running. */
export const SAVING_TAKE_TO_LIBRARY_LABEL = 'Saving to library…';
/** The saved state — shown only after a real write (or a real registry read). */
export const SAVED_TAKE_TO_LIBRARY_LABEL = 'Saved to library ✓';
/** What the action really does. */
export const SAVE_TAKE_TO_LIBRARY_HINT =
  'Keeps this take in your Library, so you can open it any time.';
/** The line the surface shows once the write landed. */
export const SAVED_TAKE_TO_LIBRARY_LINE =
  'Saved to your Library — it opens offline, any time.';
/** A failed save is never silent (a silent failure reads as a dead button). */
export const TAKE_SAVE_TO_LIBRARY_FAILED_LINE =
  'We could not save this take — try again.';
/**
 * THE ONE LINE THAT EXPLAINS THE SPLIT (owner 11-24: the invisible difference
 * between the two stores was half the complaint). Rendered once per surface,
 * outside the tap target, in the plainest words available.
 */
export const LIBRARY_VS_HISTORY_LINE =
  'History keeps every take you play. Library keeps only the ones you save.';
/** The title a take with no name of its own is saved under. */
export const TAKE_LIBRARY_FALLBACK_TITLE = 'Practice take';

/** The four real states of the action (never a fifth, "probably saved"). */
export type TakeLibrarySaveState = 'idle' | 'saving' | 'saved' | 'error';

/** True when this take has notes worth saving (a silent take offers nothing). */
export function takeSaveOffered(take: SavedCaptureTake | null | undefined): boolean {
  return !!take && Array.isArray(take.notes) && take.notes.length > 0;
}

/**
 * The ABC the saved copy carries: exactly the raw line the take card draws
 * (`takeStaffRows`), so the Library item and the card show the same notes.
 * Null when there is nothing to write.
 */
export function takeLibraryAbc(take: SavedCaptureTake | null | undefined): string | null {
  if (!takeSaveOffered(take) || !take) return null;
  const rows = takeStaffRows({
    rawNotes: take.notes,
    cleanedNotes: [],
    key: take.key ?? null,
    tempoBpm: take.tempoBpm,
    title: TAKE_LIBRARY_FALLBACK_TITLE,
  });
  const abc = rows.rawAbc;
  return typeof abc === 'string' && abc.trim().length > 0 ? abc : null;
}

/**
 * The saved copy's title, built by the notation editor's own builder. The key is
 * the take's DETECTED key (never a guess — `staffKeySignature` falls back to C
 * exactly as the card's staff does), and the offset is 0 because a take is saved
 * as it was read, not transposed.
 */
export function takeLibraryTitle(
  title: string | null | undefined,
  take: SavedCaptureTake | null | undefined,
): string {
  const rows = takeStaffRows({
    rawNotes: take?.notes ?? [],
    cleanedNotes: [],
    key: take?.key ?? null,
    tempoBpm: take?.tempoBpm,
    title: TAKE_LIBRARY_FALLBACK_TITLE,
  });
  const name =
    typeof title === 'string' && title.trim().length > 0
      ? title.trim()
      : TAKE_LIBRARY_FALLBACK_TITLE;
  return transposedCopyTitle({
    title: name,
    keyLabel: rows.keyLabel,
    offset: 0,
  });
}

/** The button's label for a state. */
export function takeLibrarySaveLabel(
  state: TakeLibrarySaveState | null | undefined,
): string {
  switch (state) {
    case 'saving':
      return SAVING_TAKE_TO_LIBRARY_LABEL;
    case 'saved':
      return SAVED_TAKE_TO_LIBRARY_LABEL;
    default:
      return SAVE_TAKE_TO_LIBRARY_LABEL;
  }
}

/** True when the action must not fire again (it is running, or already done). */
export function takeLibrarySaveBusy(
  state: TakeLibrarySaveState | null | undefined,
): boolean {
  return state === 'saving' || state === 'saved';
}
