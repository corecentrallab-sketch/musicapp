/**
 * pieceLibrarySave.ts — the DEVICE half of "Save to library" for a public-domain
 * piece (v37 item 4, backlog d9d458bb, owner v36 ask item 9).
 *
 * WHAT IT DOES, IN ONE SENTENCE: it takes the hosted score URL a PD result card
 * or piece page is already showing, downloads it, and hands it to the app's
 * EXISTING library write path — so the piece lands in the user's own on-device
 * library with offline access, exactly as a picked or scanned score does.
 *
 * REUSE, NOT A SECOND STORE (the whole point of this file):
 *   • `FileSystem.downloadAsync` writes the score into the app's CACHE directory
 *     only as a staging copy;
 *   • `importDocumentAsset` (services/libraryStore.ts — the picker's own write
 *     path) copies it into `library/<id>/` inside the app's documents and
 *     registers the row in the SAME AsyncStorage registry every other library
 *     item lives in. There is no second registry, no second folder convention and
 *     no new sharing/sync/delete code: a saved PD piece renames, opens, shares,
 *     syncs to Dropbox/Drive and deletes through the pages that already exist.
 *   • the staging copy is deleted once the real copy exists, so the cache does
 *     not grow a second copy of every saved score.
 *
 * IDEMPOTENT AND HONEST. `savePieceScoreToLibrary` looks the piece up in the
 * registry first (by the piece id the row was written with), so tapping save
 * twice can never produce two rows or two downloads; and a URL we cannot download
 * is a thrown error the caller renders — never an optimistic "Saved".
 *
 * NOT tier1-compiled on purpose (it imports expo-file-system and the AsyncStorage
 * store, so it cannot run under plain Node) — same convention as
 * captureMidiExport.ts. The pure decisions live in services/librarySaveModel.ts.
 */
import * as FileSystem from 'expo-file-system';
import { getLibraryItems, importDocumentAsset } from './libraryStore';
import {
  SAVE_TO_LIBRARY_FAILED_MESSAGE,
  SAVE_TO_LIBRARY_NO_SCORE_LINE,
  isSaveableScoreUrl,
  libraryScoreFileName,
} from './librarySaveModel';
import type { LibraryItem } from '../types';

/** Where a score waits while it is being brought in. Cache only, never the library. */
export const LIBRARY_DOWNLOAD_DIR = `${FileSystem.cacheDirectory ?? ''}notesnap-library/`;

/** What a caller must hand over to save a piece. */
export interface SavePieceScoreInput {
  /** The catalog piece id — what marks the saved row as THIS piece. */
  pieceId: string;
  title: string;
  composer?: string | null;
  /** The hosted score URL the surface is already showing (`sheet_music_url`). */
  scoreUrl?: string | null;
}

/**
 * The library row this piece was already saved as, or null. Reads the EXISTING
 * registry (no second index): the row carries `sourcePieceId`, written by the
 * save below.
 */
export async function findSavedPieceCopy(
  pieceId: string | null | undefined,
): Promise<LibraryItem | null> {
  if (typeof pieceId !== 'string' || pieceId.length === 0) return null;
  const items = await getLibraryItems();
  return items.find((item) => item.sourcePieceId === pieceId) ?? null;
}

/**
 * Download a PD piece's hosted score into the on-device library and return the
 * row that was written. Idempotent (an already-saved piece returns its existing
 * row untouched) and never silently successful: every failure throws with a
 * sentence the surface shows.
 */
export async function savePieceScoreToLibrary(
  input: SavePieceScoreInput,
): Promise<LibraryItem> {
  const pieceId = typeof input?.pieceId === 'string' ? input.pieceId : '';
  if (pieceId.length === 0) {
    throw new Error(SAVE_TO_LIBRARY_FAILED_MESSAGE);
  }

  const existing = await findSavedPieceCopy(pieceId);
  if (existing) return existing;

  if (!isSaveableScoreUrl(input?.scoreUrl)) {
    throw new Error(SAVE_TO_LIBRARY_NO_SCORE_LINE);
  }

  const name = libraryScoreFileName(input.title, input.composer, input.scoreUrl);
  const dirInfo = await FileSystem.getInfoAsync(LIBRARY_DOWNLOAD_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(LIBRARY_DOWNLOAD_DIR, {
      intermediates: true,
    });
  }

  // Staged under the real file name so the library's extension → kind mapping
  // sees a real score type (a nameless temp file would be rejected as such).
  const stagingUri = `${LIBRARY_DOWNLOAD_DIR}${Date.now()}-${name}`;
  let downloaded;
  try {
    downloaded = await FileSystem.downloadAsync(input.scoreUrl as string, stagingUri);
  } catch (err) {
    throw new Error(
      err instanceof Error && err.message ? err.message : SAVE_TO_LIBRARY_FAILED_MESSAGE,
    );
  }
  if (!downloaded || downloaded.status !== 200) {
    throw new Error(SAVE_TO_LIBRARY_FAILED_MESSAGE);
  }

  const displayTitle = [input.title, input.composer]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(' — ');

  try {
    // THE EXISTING WRITE PATH: the registry row + the offline copy in the app's
    // documents, exactly as the import picker and the camera produce them.
    return await importDocumentAsset(
      { name, uri: downloaded.uri },
      { title: displayTitle || undefined, sourcePieceId: pieceId },
    );
  } finally {
    // Best effort: the library now holds its own copy of the file.
    await FileSystem.deleteAsync(stagingUri, { idempotent: true }).catch(() => undefined);
  }
}
