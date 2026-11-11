/**
 * practiceVideoStore.ts — WHERE A PRACTICE VIDEO IS KEPT (owner GO 10-10,
 * decisions 2/3/5; backlog a49fbe2d; design brief §2.2/§2.3/§2.5).
 *
 * THE CACHE TRAP THIS FILE EXISTS TO AVOID. `expo-camera`'s `recordAsync` returns
 * a file in the RECORDER'S CACHE. The cache is evictable and the recorder
 * overwrites its own file, so a History row pointing at it would go dead within
 * days — exactly the trap `melodyStore.ts` already documents for the audio take.
 * So the video is COPIED into the app's DOCUMENTS directory
 * (`notesnap-practice-videos/`) BEFORE any row references it. Nothing else in the
 * feature ever holds the camera's URI.
 *
 * THE PAIR (decision 5). The video is the story's picture; the take's notes and
 * audio stay where they already live (`capture` + `personalMelody`), so the
 * editor, the PDF and the MIDI export all keep working whether or not the video
 * survives — and deleting the video removes the FILE and the row's reference, and
 * touches nothing else.
 *
 * NEVER A DEAD END: a copy that cannot be made is reported (the caller then keeps
 * the camera URI for this session and says the video was not kept), and a delete
 * that fails leaves the reference alone rather than orphaning a file.
 *
 * Not tier1-compiled on purpose (it imports expo-file-system), exactly like
 * melodyStore.ts and captureMidiExport.ts. Everything DECIDED about a practice
 * video lives in src/services/practiceVideoRef.ts, which IS tier1-compiled.
 */
import * as FileSystem from 'expo-file-system';
import { getRecognitionHistory, saveRecognition, updateRecognitionCapture, updateRecognitionPracticeVideo } from './storage';
import { personalMelodyPiece } from './melodyStore';
import {
  PRACTICE_VIDEO_DIR_NAME,
  PRACTICE_VIDEO_ROW_TITLE,
  practiceVideoFileName,
  practiceVideoIsUsable,
  type PracticeVideoRef,
} from './practiceVideoRef';
// vc54 (DEFECT 1): the all-or-nothing write itself — pure, and run by the gate
// against a fake device (services/practiceVideoSave.ts).
import {
  writePracticeVideoRow,
  type PracticeVideoSavePort,
} from './practiceVideoSave';
import type { SavedCaptureTake } from './midiExport';
import type { SavedPiece } from '../types';

/** Where every practice video lives (the app's documents dir — never the cache). */
export const PRACTICE_VIDEO_DIR = `${FileSystem.documentDirectory ?? ''}${PRACTICE_VIDEO_DIR_NAME}/`;

/** The honest outcome of keeping a filmed take. */
export interface PersistedPracticeVideo {
  /** The documents URI, or null when the copy could not be made. */
  uri: string | null;
  /** The file's size once it is on disk (null when unknown). */
  sizeBytes: number | null;
  /** The sentence the screen shows about where the video ended up. */
  message: string;
}

export const PRACTICE_VIDEO_KEPT_LINE = 'Your video is kept on this device.';
export const PRACTICE_VIDEO_NOT_KEPT_LINE =
  'Your video could not be copied into NoteSnap’s own folder, so it is only here for this session — share it now if you want to keep it.';

/** The file's size in bytes, or null when it cannot be read. */
export async function practiceVideoFileSize(uri: string | null | undefined): Promise<number | null> {
  if (typeof uri !== 'string' || uri.length === 0) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? info.size : null;
  } catch {
    return null;
  }
}

/** True only when the file is really on this device. */
export async function practiceVideoFileExists(uri: string | null | undefined): Promise<boolean> {
  if (typeof uri !== 'string' || uri.length === 0) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!info && info.exists;
  } catch {
    return false;
  }
}

/**
 * COPY THE FILMED VIDEO INTO THE APP'S DOCUMENTS DIRECTORY, before any row
 * references it. Returns the persistent URI (with the file's size) or null with
 * the honest line when the copy could not be made.
 */
export async function persistPracticeVideo(
  uri: string,
  rowId: string,
): Promise<PersistedPracticeVideo> {
  if (typeof uri !== 'string' || uri.length === 0) {
    return { uri: null, sizeBytes: null, message: PRACTICE_VIDEO_NOT_KEPT_LINE };
  }
  if (!FileSystem.documentDirectory) {
    return { uri: null, sizeBytes: null, message: PRACTICE_VIDEO_NOT_KEPT_LINE };
  }
  try {
    const info = await FileSystem.getInfoAsync(PRACTICE_VIDEO_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(PRACTICE_VIDEO_DIR, { intermediates: true });
    }
    const stamped = new Date().toISOString();
    const target = `${PRACTICE_VIDEO_DIR}${practiceVideoFileName(rowId, stamped)}`;
    await FileSystem.copyAsync({ from: uri, to: target });
    const sizeBytes = await practiceVideoFileSize(target);
    if (sizeBytes === null) {
      return { uri: null, sizeBytes: null, message: PRACTICE_VIDEO_NOT_KEPT_LINE };
    }
    return { uri: target, sizeBytes, message: PRACTICE_VIDEO_KEPT_LINE };
  } catch {
    return { uri: null, sizeBytes: null, message: PRACTICE_VIDEO_NOT_KEPT_LINE };
  }
}

/** What a filmed take writes into History: the melody row PLUS the video block. */
export interface PracticeVideoRowInput {
  rowId: string;
  capturedAt: string;
  /** The take the pipeline read from the audio (null when it heard nothing). */
  take: SavedCaptureTake | null;
  /** The audio clip's documents URI, or null when it could not be kept. */
  audioUri: string | null;
  /** The ref, already pointing at a documents file. */
  videoRef: PracticeVideoRef | null;
  title?: string;
}

/**
 * WRITE THE FILMED TAKE INTO HISTORY — one row, both halves of the pair. The row
 * is the same melody row the capture window writes (`personalMelodyPiece`), so a
 * video row is a melody row in every existing respect (editor, exports, tap
 * behaviour); the practice-video block is additive on top of it.
 *
 * ── vc52 (owner 11-08, A5): A WRITE THAT DID NOT HAPPEN IS NOT A SAVE ─────────
 *
 * The owner filmed a take, force-quit from recents, reopened, opened History — and
 * the take was not there, while the screen had said "Saved to your History."
 *
 * WHY IT COULD SAY THAT. Nothing in this path could report a failure:
 *   • `saveRecognition` returns VOID and silently does nothing when the row's id
 *     is already in History (it is idempotent by id) — so a skipped write was
 *     indistinguishable from a real one, and this function returned the piece as
 *     if it had been stored;
 *   • `attachPracticeVideo`'s boolean was ignored;
 *   • the `catch` below turned every throw into `null` with the reason discarded.
 *
 * THE FIX, AND WHY IT IS A PROOF RATHER THAN A HOPE. After the write, the row is
 * READ BACK through `loadPracticeVideoRow` — the very same `getRecognitionHistory`
 * read the History tab performs. If the row is not there, this returns `null` and
 * the screen shows a loud failure with a retry (services/practiceVideoRef.ts,
 * `practiceVideoSaveState`). A row that survives that read is genuinely on the
 * device in the place History reads from, which is exactly what has to be true for
 * the take to survive a force-quit.
 */
export async function savePracticeVideoRow(
  input: PracticeVideoRowInput,
): Promise<SavedPiece | null> {
  const base = personalMelodyPiece({
    rowId: input.rowId,
    capturedAt: input.capturedAt,
    take: input.take,
    audioUri: input.audioUri,
    title: input.title ?? PRACTICE_VIDEO_ROW_TITLE,
  });
  const piece: SavedPiece = { ...base, practiceVideo: input.videoRef };
  /**
   * ── vc54 (DEFECT 1): THE WRITE IS ALL-OR-NOTHING, AND IT IS THE PURE ONE ────
   *
   * Everything this function used to do inline — write, attach, read back — now
   * lives in `services/practiceVideoSave.ts` behind a port, because the vc53
   * version had two silent-success paths the device could reach and no test could:
   *
   *   • `saveRecognition` SKIPS a row whose id is already in History and returns
   *     void, so the read-back found the OLD row and reported a save over a take
   *     that was never written (the owner's 2-in-3 failure, with no card);
   *   • a video file that had not landed on disk yet produced a row pointing at
   *     nothing, or a take silently saved without its video.
   *
   * The algorithm now: waits (bounded) for the video file, inserts, PATCHES the
   * take's own blocks when the id was already there, reads the row back through
   * the read History performs, and requires the video block that comes back to be
   * THIS take's. One automatic retry, then null — which the surface renders as the
   * loud card with its retry. It never returns a row it did not read back.
   *
   * The vc53 write queue is untouched: `insertRow` and `patchRow` still go through
   * `storage`, and every one of those writes is serialised by `enqueueHistoryWrite`.
   */
  return writePracticeVideoRow(
    { piece, take: input.take, audioUri: input.audioUri, videoRef: input.videoRef },
    practiceVideoSavePort,
  );
}

/**
 * THE DEVICE SIDE OF THE SAVE (vc54). Every call here is one the app already
 * makes elsewhere; the port exists so the algorithm above can be run against a
 * fake device in the tier1 gate and FAILED when its rules are removed.
 */
const practiceVideoSavePort: PracticeVideoSavePort = {
  readRow: (rowId) => loadPracticeVideoRow(rowId),
  insertRow: (piece) => saveRecognition(piece),
  patchRow: async (rowId, patch) => {
    // The take's blocks, written onto a row that is already in History. Both
    // writers go through the ONE History queue; a false means "the row is gone",
    // which is a failed save here, never a shrug.
    let ok = true;
    if (patch.videoRef) {
      ok = await attachPracticeVideo(rowId, patch.videoRef);
      if (!ok) return false;
    }
    if (patch.take) {
      ok = (await savePracticeVideoTake(rowId, patch.take)) && ok;
    }
    return ok;
  },
  fileExists: (uri) => practiceVideoFileExists(uri),
  waitForFile: async (uri, timeoutMs) => {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    // Bounded poll: the camera hands back its URI when it stops, and on a slow
    // device the file is still being flushed to disk for a moment afterwards.
    while (Date.now() <= deadline) {
      if (await practiceVideoFileExists(uri)) return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return practiceVideoFileExists(uri);
  },
};

/**
 * Is this row really in History? The read-back the save path and the retry share,
 * so "saved" always means "History can find it".
 */
export async function practiceVideoRowIsStored(rowId: string): Promise<boolean> {
  const stored = await loadPracticeVideoRow(rowId);
  return !!stored;
}


/**
 * ── THE TAKE ARRIVES AFTER THE VIDEO (vc50 fix, owner 11-04) ──────────────────
 *
 * The screen now lands the user on the review surface as soon as the VIDEO is on
 * disk, and reads the notes out of the audio afterwards (a decode over a
 * three-minute take can take seconds, and it used to hold the whole surface on a
 * spinner with nothing on it). `savePracticeVideoRow` cannot do that second write:
 * it skips a row that is already in History (`saveRecognition` is idempotent by
 * id), so the take is attached to the EXISTING row through the one seam that does
 * that — `updateRecognitionCapture`.
 *
 * Returns false when there was no take or the row is gone; callers say so.
 */
export async function savePracticeVideoTake(
  rowId: string,
  take: SavedCaptureTake | null,
): Promise<boolean> {
  if (!take) return false;
  if (typeof rowId !== 'string' || rowId.length === 0) return false;
  try {
    return await updateRecognitionCapture(rowId, take);
  } catch {
    return false;
  }
}

/**
 * Attach (or, with null, clear) the practice-video block on an existing row. Used
 * by the sync nudge (the offset changes) and by the delete path. Returns false
 * when the row is gone — "nothing to update", never a failure of the write.
 */
export async function attachPracticeVideo(
  rowId: string,
  ref: PracticeVideoRef | null,
): Promise<boolean> {
  if (typeof rowId !== 'string' || rowId.length === 0) return false;
  try {
    return await updateRecognitionPracticeVideo(rowId, ref);
  } catch {
    return false;
  }
}

/**
 * DELETE THE VIDEO, KEEP THE TAKE (decision 5, design brief §2.5). The FILE is
 * removed and the row's reference is cleared; the take, its notation, its PDF and
 * its MIDI export are untouched — that independence is the whole point of the
 * pair, and this is the one place that could break it.
 */
export async function deletePracticeVideo(
  rowId: string,
  ref: PracticeVideoRef | null,
): Promise<boolean> {
  const uri = ref?.uri;
  try {
    if (typeof uri === 'string' && uri.length > 0) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
    return await updateRecognitionPracticeVideo(rowId, null);
  } catch {
    return false;
  }
}

/** Read one History row for the playback surface (null when it is gone). */
export async function loadPracticeVideoRow(rowId: string): Promise<SavedPiece | null> {
  if (typeof rowId !== 'string' || rowId.length === 0) return null;
  try {
    const history = await getRecognitionHistory();
    return history.find((piece) => piece.id === rowId) ?? null;
  } catch {
    return null;
  }
}

/**
 * THE OTHER FILMED TAKES (v47 part B, item 1). The comparison surface needs a
 * second take to put beside the one the user is watching, and the only place one
 * exists is History — so this reads the rows that really carry a practice-video
 * file, newest first, skipping the row being watched.
 *
 * It never invents a take and never returns a row whose video block is empty: an
 * unusable block would open a comparison column with nothing in it, which is the
 * dead area the release gate forbids (owner 09-28). A device with no other filmed
 * take gets an empty list, and the surface then says so and offers to film one.
 */
export async function listPracticeVideoRows(excludeRowId?: string | null): Promise<SavedPiece[]> {
  try {
    const history = await getRecognitionHistory();
    return history
      .filter(
        (piece) =>
          !!piece &&
          piece.id !== excludeRowId &&
          practiceVideoIsUsable(piece.practiceVideo ?? null),
      )
      .sort((a, b) => {
        const left = String(a?.practiceVideo?.filmedAt ?? '');
        const right = String(b?.practiceVideo?.filmedAt ?? '');
        return right.localeCompare(left);
      });
  } catch {
    return [];
  }
}
