/**
 * scoreShareDevice.ts — THE DEVICE HALF of sharing a transposed score (v39 Part 2,
 * owner direction 10-11). The DECISION lives in the pure `scoreShare.ts`; this
 * module only does the three things that need a platform: write the `.abc` to the
 * cache, ask whether the platform can share a file, and hand the payload to the OS
 * share sheet (`expo-sharing` for the file, React Native's `Share` for the text).
 *
 * NOT tier1-compiled on purpose (it imports expo-file-system / expo-sharing /
 * react-native), the same convention as takeSendDevice.ts / captureMidiExport.ts.
 * The logic the gate asserts lives in scoreShare.ts, which this module only calls.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import {
  SCORE_SHARE_FAILED_HINT,
  buildScoreSharePayload,
  scoreShareFilename,
} from './scoreShare';

/** Where the shared `.abc` copies are written (derived files — never the Library). */
export const SCORE_SHARE_DIR = `${FileSystem.cacheDirectory ?? ''}notesnap-scores/`;

export type ScoreShareStatus = 'shared' | 'dismissed' | 'failed';

export interface ScoreShareOutcome {
  status: ScoreShareStatus;
  /** The written file, when one was handed to the share sheet. */
  fileUri?: string;
  /** The sentence the surface shows when something went wrong. */
  message?: string;
}

export interface ScoreShareInput {
  abc: string;
  title: string;
  keyLabel: string;
  offset: number;
}

/** Write the ABC text into the cache directory and return the file URI. */
export async function writeScoreShareFile(name: string, abc: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(SCORE_SHARE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(SCORE_SHARE_DIR, { intermediates: true });
  }
  const uri = `${SCORE_SHARE_DIR}${name}`;
  await FileSystem.writeAsStringAsync(uri, abc);
  return uri;
}

/** Hand the `.abc` file to the OS share sheet (the only way it leaves the app). */
export async function shareScoreFile(fileUri: string, dialogTitle: string): Promise<void> {
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/plain',
    dialogTitle,
  });
}

/** Hand the score TEXT to the OS share sheet (the fallback carrier). */
export async function shareScoreText(title: string, message: string): Promise<ScoreShareStatus> {
  const result = await Share.share({ title, message });
  return (result as { action?: string } | undefined)?.action === Share.dismissedAction
    ? 'dismissed'
    : 'shared';
}

async function fileSharingAvailable(): Promise<boolean> {
  try {
    return Boolean(await Sharing.isAvailableAsync());
  } catch {
    return false;
  }
}

/**
 * SHARE THE TRANSPOSED SCORE. Never throws: a device with no share sheet, a file
 * that could not be written and a sheet that failed are three honest outcomes, and
 * the caller renders `SCORE_SHARE_FAILED_HINT` for the last one. The user's own
 * share target does the sending — there is no endpoint of ours in this path.
 */
export async function shareTransposedScore(input: ScoreShareInput): Promise<ScoreShareOutcome> {
  const name = scoreShareFilename({
    title: input.title,
    keyLabel: input.keyLabel,
    offset: input.offset,
  });
  let fileUri: string | null = null;
  let available = false;
  try {
    available = await fileSharingAvailable();
    if (available) fileUri = await writeScoreShareFile(name, input.abc);
  } catch {
    // A file that cannot be written is not a failure — the score travels as text.
    fileUri = null;
  }

  const payload = buildScoreSharePayload({
    abc: input.abc,
    title: input.title,
    keyLabel: input.keyLabel,
    offset: input.offset,
    fileUri,
    fileSharingAvailable: available && fileUri !== null,
  });

  try {
    if (payload.mode === 'file') {
      await shareScoreFile(payload.fileUri, payload.dialogTitle);
      return { status: 'shared', fileUri: payload.fileUri };
    }
    const status = await shareScoreText(input.title, payload.message);
    return { status, fileUri: fileUri ?? undefined };
  } catch {
    return { status: 'failed', message: SCORE_SHARE_FAILED_HINT };
  }
}
