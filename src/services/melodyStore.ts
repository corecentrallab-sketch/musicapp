/**
 * melodyStore.ts — where a captured melody is KEPT (owner 10-02: "stores the
 * sound in history once found for the user to come back to it").
 *
 * TWO THINGS ARE STORED FOR EVERY MELODY TAKE, and they are different things:
 *
 *   1. THE SOUND — the recording itself, copied out of the recorder's cache
 *      directory into the app's DOCUMENT directory (`notesnap-melodies/`). The
 *      cache is evictable and the recorder overwrites its own file on the next
 *      pass, so a History row pointing at the cache URI would go dead within
 *      days. The documents copy is the phone-local file the owner described:
 *      it survives, it is readable offline, and it is what a re-opened melody
 *      is re-read from. We write ONE file per take and never touch the library.
 *   2. THE TAKE — the notes/key/tempo the pipeline read from that sound
 *      (`SavedCaptureTake`), stored ON the History row exactly as MIDI export
 *      Batch A stores it, so "Export MIDI" works from the row later with no
 *      re-decode and no network.
 *
 * NEVER A DEAD END: if the copy fails (no writable directory, a full disk) the
 * take still lands in History carrying the recorder's own URI, and the caller
 * is told the audio was not kept — the row is still re-openable and still
 * exports; only the replay-in-place promise is missing, and the surface says so.
 *
 * Not tier1-compiled on purpose (it imports expo-file-system / the AsyncStorage
 * store), exactly like captureMidiExport.ts. Everything DECIDED about a melody
 * row lives in src/services/melodyCapture.ts, which IS tier1-compiled.
 */
import * as FileSystem from 'expo-file-system';
import { saveRecognition, updateRecognitionCapture } from './storage';
import { MELODY_ROW_COMPOSER, MELODY_ROW_TITLE, isMelodyRowId } from './melodyCapture';
import type { SavedCaptureTake } from './midiExport';
import type { SavedPiece } from '../types';

/** Where a saved take's audio lives (the app's documents dir — never the cache). */
export const MELODY_AUDIO_DIR = `${FileSystem.documentDirectory ?? ''}notesnap-melodies/`;

/** What a persisted melody row is built from. */
export interface PersonalMelodyInput {
  rowId: string;
  capturedAt: string;
  /** The take the pipeline read, or null when it could not be read. */
  take: SavedCaptureTake | null;
  /** The saved recording's URI (null when it could not be kept). */
  audioUri: string | null;
  title?: string;
}

/**
 * Copy the finished recording into the app's documents directory so it survives
 * the recorder's cache. Returns the persistent URI, or null when the copy could
 * not be made (the caller then keeps the cache URI and says the sound was not
 * kept rather than pretending it was).
 */
export async function persistMelodyAudio(
  uri: string,
  rowId: string,
): Promise<string | null> {
  if (typeof uri !== 'string' || uri.length === 0) return null;
  if (!FileSystem.documentDirectory) return null;
  try {
    const info = await FileSystem.getInfoAsync(MELODY_AUDIO_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(MELODY_AUDIO_DIR, { intermediates: true });
    }
    const safeId = rowId.replace(/[^0-9A-Za-z-]/g, '') || `take-${Date.now()}`;
    const extension = /\.([A-Za-z0-9]+)$/.exec(uri)?.[1] ?? 'm4a';
    const target = `${MELODY_AUDIO_DIR}${safeId}.${extension}`;
    await FileSystem.copyAsync({ from: uri, to: target });
    const written = await FileSystem.getInfoAsync(target);
    return written.exists ? target : null;
  } catch {
    return null;
  }
}

/** The History row for a personal melody. Pure — the shape, without the write. */
export function personalMelodyPiece(input: PersonalMelodyInput): SavedPiece {
  const capturedAt =
    typeof input.capturedAt === 'string' && input.capturedAt.length > 0
      ? input.capturedAt
      : new Date().toISOString();
  const rowId = isMelodyRowId(input.rowId) ? input.rowId : `melody-${Date.now()}`;
  return {
    id: rowId,
    title: input.title ?? MELODY_ROW_TITLE,
    composer: MELODY_ROW_COMPOSER,
    savedAt: capturedAt,
    // The derived take rides the row exactly as a MIDI export stores it, so the
    // row can export again later without re-decoding (and offline).
    capture: input.take ?? undefined,
    // The marker that makes the row re-openable as a MELODY rather than a piece.
    personalMelody: { audioUri: input.audioUri, capturedAt },
  };
}

/**
 * Write a captured melody into History. Returns the row that was stored (so the
 * caller can report the honest outcome) or null when the write threw.
 *
 * `saveRecognition` dedupes by id, and a melody id is unique per take, so
 * re-saving the same take is idempotent — never a second row, and never a
 * chance of merging with a recognized piece.
 */
export async function savePersonalMelodyRow(input: PersonalMelodyInput): Promise<SavedPiece | null> {
  const piece = personalMelodyPiece(input);
  try {
    await saveRecognition(piece);
    return piece;
  } catch {
    return null;
  }
}

/**
 * Re-write the take onto an EXISTING melody row (the re-open path: a melody
 * whose sound was saved but which could not be read at the time gets its take
 * the moment a later read succeeds). Returns false when the row is gone — the
 * caller treats that as "nothing to update", never as a failure of the read.
 */
export async function updatePersonalMelodyTake(
  rowId: string,
  take: SavedCaptureTake | null,
): Promise<boolean> {
  if (!isMelodyRowId(rowId) || !take) return false;
  try {
    return await updateRecognitionCapture(rowId, take);
  } catch {
    return false;
  }
}
