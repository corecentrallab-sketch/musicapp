/**
 * correctedTakeStore.ts — WHERE A CORRECTED TAKE IS WRITTEN (v33 slice D).
 *
 * WHY IT IS ITS OWN MODULE. The take-correction editor is reached from TWO
 * places (the capture window and a History melody row) and it offers TWO save
 * actions ("Save & update" and "Save a copy"). Four call sites writing the take
 * four slightly different ways is exactly how a "corrected take" drifts from the
 * take History shows, the take the MIDI export serialises and the take the
 * preview plays. So both actions go through the ONE seam here, and both write a
 * PLAIN `SavedCaptureTake` (the open contract of take-correction-editor-brief.md
 * §1 — the corrected take is still a generic note list, never a special shape).
 *
 * THE TWO ACTIONS, HONESTLY:
 *   • `update` — "Save & update": the corrected take REPLACES the take on the
 *     row the editor was opened from (melodyStore.updatePersonalMelodyTake, the
 *     same seam the re-open path uses). No parallel row, no drift.
 *   • `copy` — "Save a copy": the corrected take is written as a NEW melody row,
 *     so the take the user started from stays exactly as it was. The new row is
 *     then given its take through the SAME updatePersonalMelodyTake seam, so
 *     there is one write path for a row's take and nothing can drift.
 *
 * Not tier1-compiled (it imports melodyStore → expo-file-system), exactly like
 * melodyStore itself; everything DECIDED about a take lives in
 * src/services/takeEditor.ts, which IS tier1-compiled.
 */
import { MELODY_ROW_TITLE, melodyRowId } from './melodyCapture';
import {
  savePersonalMelodyRow,
  updatePersonalMelodyTake,
} from './melodyStore';
import type { SavedCaptureTake } from './midiExport';

export type TakeSaveMode = 'update' | 'copy';

export const SAVE_UPDATE_CTA = 'Save & update';
export const SAVE_COPY_CTA = 'Save a copy';
export const SAVE_UPDATE_HINT =
  'Your corrections become this take everywhere: History, the MIDI export and the preview.';
export const SAVE_COPY_HINT =
  'Kept as a new History entry — the take you started from stays on its own row.';
export const SAVE_UPDATE_FAILED_LINE =
  'Could not write your corrections onto this take — nothing was changed. Try again.';
export const SAVE_COPY_FAILED_LINE =
  'Could not write the corrected copy — the take you started from is untouched.';
export const SAVE_NOTHING_REASON =
  'There is no take to save — the editor has no notes to write.';
export const SAVE_NO_ROW_REASON =
  'This take is not in your History yet, so there is nothing to update — use "Save a copy".';
/** The title a corrected copy lands under (it is a copy, and it says so). */
export const CORRECTED_COPY_TITLE = `${MELODY_ROW_TITLE} (corrected)`;

export interface CorrectedTakeSaveResult {
  ok: boolean;
  mode: TakeSaveMode;
  /** The row the corrected take ended up on (null when nothing was written). */
  rowId: string | null;
  /** The honest sentence the editor shows after the attempt. */
  line: string;
}

/**
 * Write a corrected take. Never throws: a failed write is a `false` result with
 * a line the surface can show, because a silent failure here loses the user's
 * work behind an apparently fine screen.
 */
export async function saveCorrectedTake(input: {
  rowId: string | null;
  take: SavedCaptureTake | null | undefined;
  audioUri?: string | null;
  mode: TakeSaveMode;
  /** Overrides the timestamp of a copy (tests pass their own). */
  capturedAt?: string;
}): Promise<CorrectedTakeSaveResult> {
  const mode: TakeSaveMode = input.mode === 'copy' ? 'copy' : 'update';
  const take = input.take ?? null;
  if (!take || !Array.isArray(take.notes) || take.notes.length === 0) {
    return { ok: false, mode, rowId: null, line: SAVE_NOTHING_REASON };
  }

  if (mode === 'update') {
    if (!input.rowId) {
      return { ok: false, mode, rowId: null, line: SAVE_NO_ROW_REASON };
    }
    let ok = false;
    try {
      ok = await updatePersonalMelodyTake(input.rowId, take);
    } catch {
      ok = false;
    }
    return {
      ok,
      mode,
      rowId: ok ? input.rowId : null,
      line: ok ? SAVE_UPDATE_HINT : SAVE_UPDATE_FAILED_LINE,
    };
  }

  // A COPY: a new row, so nothing already in History is overwritten.
  const capturedAt =
    typeof input.capturedAt === 'string' && input.capturedAt.length > 0
      ? input.capturedAt
      : new Date().toISOString();
  const copyId = melodyRowId(capturedAt, 'copy');
  let row: { id: string } | null = null;
  try {
    row = await savePersonalMelodyRow({
      rowId: copyId,
      capturedAt,
      take,
      audioUri: input.audioUri ?? null,
      title: CORRECTED_COPY_TITLE,
    });
  } catch {
    row = null;
  }
  if (!row) {
    return { ok: false, mode, rowId: null, line: SAVE_COPY_FAILED_LINE };
  }
  // The copy's take is written through the SAME seam a row's take always uses.
  let ok = false;
  try {
    ok = await updatePersonalMelodyTake(row.id, take);
  } catch {
    ok = false;
  }
  return {
    ok,
    mode,
    rowId: ok ? row.id : null,
    line: ok ? SAVE_COPY_HINT : SAVE_COPY_FAILED_LINE,
  };
}
