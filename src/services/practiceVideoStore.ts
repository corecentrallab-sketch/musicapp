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
import { getRecognitionHistory, saveRecognition, updateRecognitionPracticeVideo } from './storage';
import { personalMelodyPiece } from './melodyStore';
import {
  PRACTICE_VIDEO_DIR_NAME,
  PRACTICE_VIDEO_ROW_TITLE,
  practiceVideoFileName,
  type PracticeVideoRef,
} from './practiceVideoRef';
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
  try {
    await saveRecognition(piece);
  } catch {
    return null;
  }
  if (input.videoRef) {
    await attachPracticeVideo(piece.id, input.videoRef);
  }
  return piece;
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
