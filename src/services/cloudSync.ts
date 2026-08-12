/**
 * Cloud sync engine — Phase 4b.
 *
 * A simple two-way merge between the local sheet music library and a cloud
 * provider's app folder (Dropbox /NotesSnap, or the Google Drive "NotesSnap"
 * folder). Merging is keyed by filename + size:
 *   - pull: cloud files not present locally are downloaded into the library;
 *     a same-name/different-size file is overwritten locally (last-wins,
 *     cloud version kept — reported in the sync note).
 *   - push: local items the user marked "Send to cloud" are uploaded; a cloud
 *     file with the same name + size is skipped, otherwise the upload
 *     overwrites (last-wins, local version kept).
 *
 * No network → a friendly error, never a crash.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LibraryItem } from '../types';
import {
  getLibraryItems,
  importCloudFileAsset,
  updateLibraryItem,
} from './libraryStore';
import {
  isCloudConnected,
  NotConnectedError,
  type CloudFileRef,
  type CloudProvider,
} from './oauthStore';
import {
  dropboxDownload,
  dropboxListFolder,
  dropboxUpload,
  getDropboxAccessToken,
} from './dropbox';
import {
  gdriveDownload,
  gdriveListFiles,
  gdriveUpload,
  getGDriveAccessToken,
  mimeTypeForName,
} from './gdrive';

const QUEUE_KEY = '@notesnap/cloudSyncQueue';
const LAST_SYNCED_KEY = '@notesnap/cloudSync/lastSynced';

/** What one Sync Now pass did for one provider. */
export interface SyncReport {
  provider: CloudProvider;
  pulled: number;
  updated: number;
  uploaded: number;
  skipped: number;
  errors: string[];
  note: string | null;
}

/** A local file of a library item, in the shape the cloud wants. */
interface ItemFilePart {
  name: string;
  uri: string;
  sizeBytes: number;
}

// ─── Filename helpers ─────────────────────────────────────────

function basename(uri: string): string {
  const parts = uri.split('/');
  return parts[parts.length - 1] ?? uri;
}

/** Makes a string safe to use as a cloud file name. */
export function sanitizeCloudName(name: string): string {
  const cleaned = name
    .replace(/[/\\\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const dot = cleaned.lastIndexOf('.');
  const base = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const ext = dot > 0 ? cleaned.slice(dot) : '';
  const limited = `${base.slice(0, 100)}${ext}`;
  return limited || 'untitled';
}

/**
 * The cloud file names a library item maps to. Single-file items keep their
 * stored file name; scanned scores upload each page as
 * `<sanitized title>-<page file name>` so different scans never collide.
 * Pages that were pulled from the cloud already carry that prefix, so they
 * keep their original name and dedupe correctly on the next sync. Page sizes
 * are read from disk so the name+size merge key is accurate.
 */
export async function cloudFilesForItem(
  item: LibraryItem
): Promise<ItemFilePart[]> {
  if (item.fileUri) {
    return [
      {
        name: sanitizeCloudName(basename(item.fileUri)),
        uri: item.fileUri,
        sizeBytes: item.sizeBytes,
      },
    ];
  }
  const prefix = sanitizeCloudName(item.title);
  const parts: ItemFilePart[] = [];
  for (const uri of item.pageUris ?? []) {
    const base = basename(uri);
    const name = base.startsWith(`${prefix}-`)
      ? sanitizeCloudName(base)
      : `${prefix}-${sanitizeCloudName(base)}`;
    let sizeBytes = 0;
    try {
      const info = await FileSystem.getInfoAsync(uri);
      sizeBytes = info.exists ? (info.size ?? 0) : 0;
    } catch {
      sizeBytes = 0;
    }
    parts.push({ name, uri, sizeBytes });
  }
  return parts;
}

// ─── Upload queue ─────────────────────────────────────────────

async function getUploadQueue(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persistQueue(queue: string[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Marks an item for the next Sync Now (dedupes). */
export async function markItemForUpload(itemId: string): Promise<void> {
  const queue = await getUploadQueue();
  if (!queue.includes(itemId)) {
    queue.push(itemId);
    await persistQueue(queue);
  }
}

async function unmarkItemForUpload(itemId: string): Promise<void> {
  const queue = await getUploadQueue();
  const next = queue.filter((id) => id !== itemId);
  if (next.length !== queue.length) {
    await persistQueue(next);
  }
}

// ─── Last-synced timestamps ───────────────────────────────────

async function getLastSynced(
  provider: CloudProvider
): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(`${LAST_SYNCED_KEY}/${provider}`);
  } catch {
    return null;
  }
}

async function setLastSynced(provider: CloudProvider): Promise<void> {
  await AsyncStorage.setItem(`${LAST_SYNCED_KEY}/${provider}`, new Date().toISOString());
}

/** Exported so the Cloud Sync screen can show the timestamp. */
export async function getLastSyncedAt(
  provider: CloudProvider
): Promise<string | null> {
  return getLastSynced(provider);
}

// ─── Connectivity helpers ─────────────────────────────────────

/** Whether the user has at least one cloud service connected. */
export async function hasAnyProviderConnected(): Promise<boolean> {
  return (await isCloudConnected('dropbox')) || (await isCloudConnected('gdrive'));
}

/**
 * Maps thrown errors to a friendly, human message. Network failures (the
 * fetch TypeError / "Network request failed" family) become a clear offline
 * hint; OAuth/session failures say to reconnect.
 */
export function friendlyCloudError(e: unknown): string {
  if (e instanceof NotConnectedError) {
    return e.message;
  }
  if (e instanceof TypeError) {
    return 'No network connection. Check your connection and try again.';
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/network request failed|fetch failed|network error|offline/i.test(message)) {
    return 'No network connection. Check your connection and try again.';
  }
  return message || 'Something went wrong.';
}

// ─── Provider dispatch ────────────────────────────────────────

async function accessTokenFor(provider: CloudProvider): Promise<string> {
  return provider === 'dropbox'
    ? getDropboxAccessToken()
    : getGDriveAccessToken();
}

async function listCloudFiles(
  provider: CloudProvider,
  token: string
): Promise<CloudFileRef[]> {
  return provider === 'dropbox'
    ? dropboxListFolder(token)
    : gdriveListFiles(token);
}

async function downloadCloudFile(
  provider: CloudProvider,
  token: string,
  file: CloudFileRef,
  destUri: string
): Promise<void> {
  if (provider === 'dropbox') {
    await dropboxDownload(token, file.id, destUri);
  } else {
    await gdriveDownload(token, file.id, destUri);
  }
}

async function uploadCloudFile(
  provider: CloudProvider,
  token: string,
  name: string,
  uri: string
): Promise<void> {
  if (provider === 'dropbox') {
    await dropboxUpload(token, name, uri);
  } else {
    await gdriveUpload(token, name, uri, mimeTypeForName(name));
  }
}

// ─── Sync ─────────────────────────────────────────────────────

function tempDir(): string {
  return `${FileSystem.cacheDirectory ?? ''}notesnap-sync/`;
}

async function downloadToTemp(
  provider: CloudProvider,
  token: string,
  file: CloudFileRef
): Promise<string> {
  await FileSystem.makeDirectoryAsync(tempDir(), { intermediates: true });
  const dest = `${tempDir()}${Date.now()}-${sanitizeCloudName(file.name)}`;
  await downloadCloudFile(provider, token, file, dest);
  return dest;
}

/**
 * Overwrites the local file for an existing item with new content
 * (last-wins). Scanned items are replaced on their first page.
 */
async function replaceLocalFile(
  item: LibraryItem,
  tmpUri: string,
  newSizeBytes: number
): Promise<void> {
  const dest = item.fileUri ?? item.pageUris?.[0];
  if (!dest) return;
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.copyAsync({ from: tmpUri, to: dest });
  await updateLibraryItem(item.id, { sizeBytes: newSizeBytes });
}

/**
 * Runs one two-way sync pass for a provider. Throws NotConnectedError if the
 * provider isn't connected; returns a report otherwise. Individual file
 * failures are collected in `errors` rather than aborting the whole pass.
 */
export async function syncCloud(provider: CloudProvider): Promise<SyncReport> {
  const report: SyncReport = {
    provider,
    pulled: 0,
    updated: 0,
    uploaded: 0,
    skipped: 0,
    errors: [],
    note: null,
  };

  const token = await accessTokenFor(provider); // throws if not connected
  const cloudFiles = await listCloudFiles(provider, token);
  const localItems = await getLibraryItems();

  const cloudKeys = new Set(cloudFiles.map((f) => `${f.name}:${f.sizeBytes}`));

  // Local file refs keyed by cloud name.
  const localRefs: ItemFilePart[] = [];
  for (const item of localItems) {
    localRefs.push(...(await cloudFilesForItem(item)));
  }

  // ── Pull: cloud → local ──
  for (const cf of cloudFiles) {
    const match = localRefs.find((r) => r.name === cf.name);
    try {
      if (!match) {
        const tmp = await downloadToTemp(provider, token, cf);
        try {
          await importCloudFileAsset({
            name: cf.name,
            uri: tmp,
            size: cf.sizeBytes,
          });
          report.pulled += 1;
        } finally {
          await FileSystem.deleteAsync(tmp, { idempotent: true });
        }
        continue;
      }
      if (match.sizeBytes === cf.sizeBytes) {
        continue; // up to date
      }
      // Same name, different size → last-wins, cloud version kept.
      const item = localItems.find((i) =>
        i.fileUri === match.uri || (i.pageUris ?? []).includes(match.uri)
      );
      const tmp = await downloadToTemp(provider, token, cf);
      try {
        if (item) {
          await replaceLocalFile(item, tmp, cf.sizeBytes);
          report.updated += 1;
        }
      } finally {
        await FileSystem.deleteAsync(tmp, { idempotent: true });
      }
    } catch (e) {
      report.errors.push(`"${cf.name}": ${friendlyCloudError(e)}`);
    }
  }

  // ── Push: queued local items → cloud ──
  const queue = await getUploadQueue();
  for (const itemId of queue) {
    const item = localItems.find((i) => i.id === itemId);
    if (!item) {
      await unmarkItemForUpload(itemId);
      continue;
    }
    const parts = await cloudFilesForItem(item);
    const allPresent = parts.every((p) => cloudKeys.has(`${p.name}:${p.sizeBytes}`));
    if (allPresent) {
      report.skipped += parts.length;
      await unmarkItemForUpload(itemId);
      continue;
    }

    let ok = true;
    for (const part of parts) {
      const existing = cloudFiles.find((cf) => cf.name === part.name);
      if (existing && existing.sizeBytes === part.sizeBytes) {
        continue; // already there with identical content
      }
      try {
        await uploadCloudFile(provider, token, part.name, part.uri);
        report.uploaded += 1;
        cloudKeys.add(`${part.name}:${part.sizeBytes}`);
      } catch (e) {
        ok = false;
        report.errors.push(`"${part.name}": ${friendlyCloudError(e)}`);
        break;
      }
    }
    if (ok) {
      await unmarkItemForUpload(itemId);
    }
  }

  await setLastSynced(provider);
  if (report.updated > 0) {
    report.note = `${report.updated} conflict(s) resolved — the cloud version was kept locally.`;
  }
  return report;
}

// ─── Item-level actions (used by the Library screen) ──────────

/**
 * Queues a library item for upload on the next Sync Now. Returns false when
 * no cloud service is connected yet (the caller should point the user at the
 * Cloud Sync screen).
 */
export async function sendItemToCloud(itemId: string): Promise<boolean> {
  if (!(await hasAnyProviderConnected())) {
    return false;
  }
  await markItemForUpload(itemId);
  return true;
}

/**
 * Shares a library item with the system share sheet (expo-sharing): the file
 * itself for single-file items, the first page for scanned scores.
 */
export async function shareLibraryItem(item: LibraryItem): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }
  const uri = item.fileUri ?? item.pageUris?.[0];
  if (!uri) {
    throw new Error('This item has no file to share.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: mimeTypeForName(uri),
    dialogTitle: item.title,
    UTI: undefined,
  });
}

/** Convenience for screens: is this provider connected right now? */
export async function providerConnected(provider: CloudProvider): Promise<boolean> {
  return isCloudConnected(provider);
}

/** Used by the Cloud Sync screen to clear a stale queue entry. */
export async function removeItemFromQueue(itemId: string): Promise<void> {
  await unmarkItemForUpload(itemId);
}
