/**
 * practiceVideoSave.ts — THE FILMED TAKE IS SAVED, OR THE USER IS TOLD.
 * (vc54, DEFECT 1 — the blocker.)
 *
 * ── WHAT THE OWNER SAW ON vc53 ──────────────────────────────────────────────
 *
 * "i tried x3 times — 1 worked and 2 failed", and no red failure card on the two
 * that failed. After a force-quit and reopen, the take that HAD saved was still
 * there and played. So the take is not being lost by the force-quit: the WRITE
 * itself silently does nothing, two times in three, and the screen says nothing.
 *
 * ── WHY IT WAS SILENT, AND WHY IT WAS INTERMITTENT ─────────────────────────
 *
 * `savePracticeVideoRow` wrote the row through `storage.saveRecognition`, which is
 * IDEMPOTENT BY ROW ID and returns void:
 *
 *     if (!history.some((p) => p.id === piece.id)) { …write… }   // else: nothing
 *
 * A skipped write and a real one were therefore indistinguishable. The save then
 * "verified" itself by reading the row back BY ID — and when the id was already in
 * History, that read found the OLD row and the save reported SUCCESS over a take
 * that was never written. Nothing threw, so no failure card could ever appear.
 * That is the owner's pair of answers in one mechanism: the new take is not in
 * History, and nothing on screen says so.
 *
 * The id can already be there because the screen keeps `rowIdRef` across takes
 * (only `handleRecordAgain` clears it) and because every retry re-uses the same
 * id. So take 1 saves, takes 2 and 3 land on take 1's id, are skipped, and are
 * reported as saved: "1 worked and 2 failed".
 *
 * ── THE RULE THIS FILE ENFORCES ────────────────────────────────────────────
 *
 * ALL-OR-NOTHING. The take is in History and readable, or this returns null and
 * the surface shows the failure card with its retry. There is no third outcome.
 *   1. THE FILE FIRST. If the take has a video ref, its file must be on disk —
 *      waited for, bounded — before any row is written. A row is never written
 *      pointing at a file that is not there.
 *   2. A SKIPPED INSERT IS NOT A SAVE. If the id is already in History, the take's
 *      own blocks are PATCHED onto that row, and the row is read back to prove the
 *      video block is THIS take's, not the one that was already there.
 *   3. ONE AUTOMATIC RETRY, then the loud failure the screen already renders.
 *   4. THE READ-BACK IS THE VERDICT. "Saved" only ever means History can find it.
 *
 * PURE: no react, no react-native, no expo, no fs, no network. The device work
 * (AsyncStorage, expo-file-system) arrives through `PracticeVideoSavePort`, so the
 * tier1 gate runs this exact algorithm against a fake device and can fail it.
 */
import type { SavedPiece } from '../types';
import type { SavedCaptureTake } from './midiExport';
import type { PracticeVideoRef } from './practiceVideoRef';

/** How long a write waits for the video file to land on disk (vc54, rule 1). */
export const PRACTICE_VIDEO_FILE_WAIT_MS = 6000;

/** One automatic retry, then the failure card (vc54, rule 3). */
export const PRACTICE_VIDEO_SAVE_ATTEMPTS = 2;

/** What `storage.saveRecognition` reports: it wrote the row, or the id was there. */
export type RecognitionWriteOutcome = 'inserted' | 'existing';

/** The take's own blocks — what a row must carry to BE this take. */
export interface PracticeVideoRowPatch {
  take: SavedCaptureTake | null;
  audioUri: string | null;
  videoRef: PracticeVideoRef | null;
}

/** Everything this algorithm needs from the device. */
export interface PracticeVideoSavePort {
  /** The History read the History tab itself performs (null = not there). */
  readRow(rowId: string): Promise<SavedPiece | null>;
  /** Insert the row. `existing` means the id was already in History. */
  insertRow(piece: SavedPiece): Promise<RecognitionWriteOutcome>;
  /** Patch this take's blocks onto a row that is already in History. */
  patchRow(rowId: string, patch: PracticeVideoRowPatch): Promise<boolean>;
  /** Is the video file really on disk right now? */
  fileExists(uri: string): Promise<boolean>;
  /** Wait (bounded) for a file that is not there yet. True when it appeared. */
  waitForFile(uri: string, timeoutMs: number): Promise<boolean>;
}

export interface PracticeVideoSaveInput {
  /** The row to write, already built (`personalMelodyPiece` + the video block). */
  piece: SavedPiece;
  /** The take the pipeline read from the audio (null when it heard nothing). */
  take: SavedCaptureTake | null;
  /** The audio clip's documents URI, or null when it could not be kept. */
  audioUri: string | null;
  /** The ref, already pointing at a documents file. */
  videoRef: PracticeVideoRef | null;
}

function uriOf(ref: PracticeVideoRef | null | undefined): string | null {
  const uri = ref?.uri;
  return typeof uri === 'string' && uri.trim().length > 0 ? uri.trim() : null;
}

/** One attempt: file first, then the row, then the read-back that decides. */
async function attemptSave(
  input: PracticeVideoSaveInput,
  port: PracticeVideoSavePort,
): Promise<SavedPiece | null> {
  const rowId = input.piece?.id;
  if (typeof rowId !== 'string' || rowId.length === 0) return null;

  const refUri = uriOf(input.videoRef);
  // ── 1. THE FILE FIRST (never a row pointing at a file that is not there) ────
  if (refUri) {
    let ready = false;
    try {
      ready = await port.fileExists(refUri);
    } catch {
      ready = false;
    }
    if (!ready) {
      try {
        ready = await port.waitForFile(refUri, PRACTICE_VIDEO_FILE_WAIT_MS);
      } catch {
        ready = false;
      }
    }
    if (!ready) return null;
  }

  // ── 2. THE WRITE, AND A SKIPPED INSERT IS NOT A SAVE ───────────────────────
  let outcome: RecognitionWriteOutcome | null = null;
  try {
    outcome = await port.insertRow(input.piece);
  } catch {
    outcome = null;
  }
  if (outcome === null) return null;
  if (outcome === 'existing') {
    let patched = false;
    try {
      patched = await port.patchRow(rowId, {
        take: input.take,
        audioUri: input.audioUri,
        videoRef: input.videoRef,
      });
    } catch {
      patched = false;
    }
    if (!patched) return null;
  }

  // ── 3. THE READ-BACK IS THE VERDICT ────────────────────────────────────────
  let stored: SavedPiece | null = null;
  try {
    stored = await port.readRow(rowId);
  } catch {
    stored = null;
  }
  if (!stored) return null;
  /**
   * …and with a video, the block that came back must be THIS take's. A row that
   * carries an older take's video block is exactly the "present but not the take
   * you filmed" state this defect was made of.
   */
  if (refUri) {
    const storedUri = uriOf(stored.practiceVideo ?? null);
    if (storedUri !== refUri) return null;
  }
  return stored;
}

/**
 * WRITE THE FILMED TAKE INTO HISTORY, ALL-OR-NOTHING.
 *
 * Returns the row exactly as History reads it back, or null — and null is the one
 * state the surface renders as a loud failure with a retry. One automatic retry
 * happens here, before the user is ever asked to do anything.
 */
export async function writePracticeVideoRow(
  input: PracticeVideoSaveInput,
  port: PracticeVideoSavePort,
): Promise<SavedPiece | null> {
  if (!input || !port) return null;
  for (let attempt = 0; attempt < PRACTICE_VIDEO_SAVE_ATTEMPTS; attempt += 1) {
    const stored = await attemptSave(input, port);
    if (stored) return stored;
  }
  return null;
}
