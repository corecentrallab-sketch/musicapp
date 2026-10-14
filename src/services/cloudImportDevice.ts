/**
 * cloudImportDevice.ts — THE DEVICE HALF OF "IMPORT FROM DROPBOX / GOOGLE DRIVE"
 * (v39 fix 2, owner 10-11: the cards under the sync section "are not functional").
 *
 * WHAT IT REALLY DOES. It opens the phone's OWN file picker (`expo-document-picker`,
 * already a dependency and already used by the Library screen's own import) and
 * copies every picked file into the Library through the Library's existing write
 * path (`libraryStore.importDocumentAsset`) — the same path, so an imported score
 * behaves exactly like one imported from the Library screen: it is on this device,
 * it opens offline, and it can be shared or sent to the cloud by the existing
 * actions.
 *
 * WHY THE PICKER AND NOT A FOLDER LINK. Linking a real Dropbox/Google Drive FOLDER
 * needs OAuth app keys (EXPO_PUBLIC_DROPBOX_APP_KEY / EXPO_PUBLIC_GOOGLE_CLIENT_ID)
 * that are not in the build, and the app must not pretend otherwise. Dropbox and
 * Google Drive both appear as SOURCES inside the system picker on Android and iOS,
 * so this route needs no key, no account setup and no network code of ours — it is
 * the honest, working version of those two cards today. The key-based connector row
 * stays on the screen for a build that has keys; it is never the only way in.
 *
 * NOT tier1-compiled (native module + fs writes), exactly like melodyStore.ts,
 * practiceVideoStore.ts and coverScanOcr.ts. Every sentence it shows comes from
 * services/cloudImport.ts, which IS compiled and guarded.
 */
import * as DocumentPicker from 'expo-document-picker';
import { importDocumentAsset } from './libraryStore';
import type { CloudImportOutcome } from './cloudImport';

/** What the picker hands back, in the shape `importDocumentAsset` wants. */
export interface PickedScoreFile {
  name: string;
  uri: string;
  size?: number;
}

/**
 * Import a batch of picked files into the Library. Each file is imported
 * INDEPENDENTLY: one unsupported or unreadable file never aborts the batch (the
 * user keeps whatever did work, and the count of what did not is reported).
 */
export async function importPickedFiles(
  files: ReadonlyArray<PickedScoreFile>,
): Promise<CloudImportOutcome> {
  const outcome: CloudImportOutcome = { imported: 0, skipped: 0, cancelled: false, firstError: null };
  for (const file of files) {
    try {
      await importDocumentAsset({
        name: file.name,
        uri: file.uri,
        size: typeof file.size === 'number' ? file.size : undefined,
      });
      outcome.imported += 1;
    } catch (e) {
      outcome.skipped += 1;
      if (!outcome.firstError) {
        outcome.firstError = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return outcome;
}

/**
 * OPEN THE PICKER AND IMPORT WHAT THE USER PICKS.
 *
 * The outcome is always a real one: a cancelled pick says so (`cancelled`), a
 * batch where every file was refused reports the count and the first reason, and
 * a successful batch reports how many scores are now in the Library. There is no
 * path here that shows a success message without a file having been written.
 */
export async function importFilesIntoLibrary(): Promise<CloudImportOutcome> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { imported: 0, skipped: 0, cancelled: true, firstError: null };
  }
  const files: PickedScoreFile[] = result.assets.map((asset) => ({
    name: asset.name,
    uri: asset.uri,
    size: typeof asset.size === 'number' ? asset.size : undefined,
  }));
  return importPickedFiles(files);
}
