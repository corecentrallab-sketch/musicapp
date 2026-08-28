/**
 * Local sheet music library — Phase 4a.
 *
 * The registry of imported/scanned items lives in AsyncStorage (matching the
 * app's existing History/streaks pattern under the @notesnap/ namespace), and
 * the actual files live in the app's document directory under `library/`.
 * Files are copied into app storage so the library keeps working offline and
 * survives cache clears.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import type { LibraryItem, LibraryKind } from '../types';

const KEYS = {
  LIBRARY: '@notesnap/library',
} as const;

const LIBRARY_ROOT =
  FileSystem.documentDirectory != null
    ? `${FileSystem.documentDirectory}library/`
    : 'library/';

// ─── Helpers ──────────────────────────────────────────────────

function makeId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

/** Maps a file extension (lowercase, no dot) to a library kind. */
const EXTENSION_KINDS: Record<string, LibraryKind> = {
  pdf: 'pdf',
  musicxml: 'musicxml',
  mxl: 'musicxml',
  xml: 'musicxml',
  mid: 'midi',
  midi: 'midi',
  gp3: 'guitarpro',
  gp4: 'guitarpro',
  gp5: 'guitarpro',
  gpx: 'guitarpro',
  gp: 'guitarpro',
  abc: 'abc',
};

/** Recognised file extensions, shown in the document picker hint. */
export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_KINDS);

/** Image extensions that sync can pull back as single-page scanned scores. */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];

function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) {
    return null;
  }
  return filename.slice(dot + 1).toLowerCase();
}

/** Returns the library kind for a filename, or null if unsupported. */
export function kindFromFilename(filename: string): LibraryKind | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) {
    return null;
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_KINDS[ext] ?? null;
}

/** Human-friendly label for a library kind. */
export function kindLabel(kind: LibraryKind): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'musicxml':
      return 'MusicXML';
    case 'midi':
      return 'MIDI';
    case 'guitarpro':
      return 'Guitar Pro';
    case 'abc':
      return 'ABC';
    case 'scanned':
      return 'Scanned score';
  }
}

/** Derives a display title from a filename (strips the extension). */
function titleFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.trim() || filename;
}

// ─── Registry persistence ─────────────────────────────────────

export async function getLibraryItems(): Promise<LibraryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.LIBRARY);
    return raw ? (JSON.parse(raw) as LibraryItem[]) : [];
  } catch {
    return [];
  }
}

export async function getLibraryItem(id: string): Promise<LibraryItem | null> {
  const items = await getLibraryItems();
  return items.find((item) => item.id === id) ?? null;
}

async function persistLibrary(items: LibraryItem[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.LIBRARY, JSON.stringify(items));
}

// ─── Import (document picker) ─────────────────────────────────

/**
 * Copies a picked document into the library and registers it.
 * `asset` matches the shape of expo-document-picker's DocumentPickerAsset.
 */
export async function importDocumentAsset(asset: {
  name: string;
  uri: string;
  size?: number;
}): Promise<LibraryItem> {
  const kind = kindFromFilename(asset.name);
  if (!kind) {
    throw new Error(
      `Unsupported file type. Supported formats: ${SUPPORTED_EXTENSIONS.join(
        ', '
      )}.`
    );
  }

  const id = makeId();
  const dir = `${LIBRARY_ROOT}${id}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const destUri = `${dir}${asset.name}`;
  await FileSystem.copyAsync({ from: asset.uri, to: destUri });

  let sizeBytes = asset.size ?? 0;
  if (!sizeBytes) {
    const info = await FileSystem.getInfoAsync(destUri);
    sizeBytes = info.exists ? info.size ?? 0 : 0;
  }

  const item: LibraryItem = {
    id,
    kind,
    title: titleFromFilename(asset.name),
    fileUri: destUri,
    // Page count for PDFs is filled in when the file is first opened.
    pageCount: kind === 'pdf' ? 0 : 1,
    sizeBytes,
    createdAt: new Date().toISOString(),
  };

  const items = await getLibraryItems();
  items.unshift(item);
  await persistLibrary(items);
  return item;
}

// ─── Scanned scores (camera) ──────────────────────────────────

/**
 * Copies the captured page images into the library as one "scanned score"
 * item, preserving page order. The first page doubles as the thumbnail.
 */
export async function createScannedScore(pages: {
  uri: string;
  size?: number;
}[]): Promise<LibraryItem> {
  if (pages.length === 0) {
    throw new Error('No pages captured.');
  }

  const id = makeId();
  const dir = `${LIBRARY_ROOT}${id}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const pageUris: string[] = [];
  let sizeBytes = 0;
  for (let i = 0; i < pages.length; i += 1) {
    const padded = String(i + 1).padStart(3, '0');
    const destUri = `${dir}page-${padded}.jpg`;
    await FileSystem.copyAsync({ from: pages[i].uri, to: destUri });
    pageUris.push(destUri);
    // Prefer the real on-disk size of the copied file.
    const info = await FileSystem.getInfoAsync(destUri);
    sizeBytes += info.exists ? (info.size ?? pages[i].size ?? 0) : (pages[i].size ?? 0);
  }

  const item: LibraryItem = {
    id,
    kind: 'scanned',
    title: `Scanned score ${new Date().toLocaleDateString()}`,
    pageUris,
    pageCount: pageUris.length,
    thumbnailUri: pageUris[0],
    sizeBytes,
    createdAt: new Date().toISOString(),
  };

  const items = await getLibraryItems();
  items.unshift(item);
  await persistLibrary(items);
  return item;
}

// ─── Cloud sync imports (Phase 4b) ────────────────────────────

/**
 * Imports a file that came from cloud sync (Dropbox/Drive download). Works
 * like importDocumentAsset for score formats, and additionally imports image
 * pages as single-page scanned scores so synced scan pages round-trip.
 */
export async function importCloudFileAsset(asset: {
  name: string;
  uri: string;
  size?: number;
}): Promise<LibraryItem> {
  const ext = extensionOf(asset.name);
  const isImage = ext != null && IMAGE_EXTENSIONS.includes(ext);
  if (!isImage && !kindFromFilename(asset.name)) {
    throw new Error(
      `"${asset.name}" is not a supported score format (${SUPPORTED_EXTENSIONS.join(
        ', '
      )} or an image).`
    );
  }

  const id = makeId();
  const dir = `${LIBRARY_ROOT}${id}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const destUri = `${dir}${asset.name}`;
  await FileSystem.copyAsync({ from: asset.uri, to: destUri });

  let sizeBytes = asset.size ?? 0;
  if (!sizeBytes) {
    const info = await FileSystem.getInfoAsync(destUri);
    sizeBytes = info.exists ? info.size ?? 0 : 0;
  }

  const item: LibraryItem = isImage
    ? {
        id,
        kind: 'scanned',
        title: titleFromFilename(asset.name),
        pageUris: [destUri],
        pageCount: 1,
        thumbnailUri: destUri,
        sizeBytes,
        createdAt: new Date().toISOString(),
      }
    : {
        id,
        kind: kindFromFilename(asset.name) as LibraryKind,
        title: titleFromFilename(asset.name),
        fileUri: destUri,
        pageCount: kindFromFilename(asset.name) === 'pdf' ? 0 : 1,
        sizeBytes,
        createdAt: new Date().toISOString(),
      };

  const items = await getLibraryItems();
  items.unshift(item);
  await persistLibrary(items);
  return item;
}

// ─── Transposed ABC save (notation editor) ─────────────────────
/**
 * Saves an ABC score (typically a transposed copy produced by the notation
 * editor) into the user's local library as an `abc` item, distinctly labeled
 * from the original. PUBLIC-DOMAIN only — callers must gate on the piece's
 * public-domain status before invoking (the notation editor only offers this
 * for PD pieces).
 */
export async function addAbcToLibrary(input: {
  title: string;
  abc: string;
}): Promise<LibraryItem> {
  const id = makeId();
  const dir = `${LIBRARY_ROOT}${id}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const fileUri = `${dir}${id}.abc`;
  await FileSystem.writeAsStringAsync(fileUri, input.abc);
  const info = await FileSystem.getInfoAsync(fileUri);
  const item: LibraryItem = {
    id,
    kind: 'abc',
    title: input.title,
    fileUri,
    pageCount: 1,
    sizeBytes: info.exists ? info.size ?? 0 : 0,
    createdAt: new Date().toISOString(),
  };
  const items = await getLibraryItems();
  items.unshift(item);
  await persistLibrary(items);
  return item;
}

// ─── Mutations ────────────────────────────────────────────────

export async function removeLibraryItem(id: string): Promise<void> {
  const items = await getLibraryItems();
  await persistLibrary(items.filter((item) => item.id !== id));
  // Best-effort file cleanup; ignore if the folder is already gone.
  await FileSystem.deleteAsync(`${LIBRARY_ROOT}${id}/`, {
    idempotent: true,
  });
}

export async function renameLibraryItem(
  id: string,
  title: string
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) {
    return;
  }
  const items = await getLibraryItems();
  const next = items.map((item) =>
    item.id === id ? { ...item, title: trimmed } : item
  );
  await persistLibrary(next);
}

/** Updates stored metadata for an item (used e.g. to record PDF page count). */
export async function updateLibraryItem(
  id: string,
  patch: Partial<LibraryItem>
): Promise<void> {
  const items = await getLibraryItems();
  const next = items.map((item) =>
    item.id === id ? { ...item, ...patch } : item
  );
  await persistLibrary(next);
}
