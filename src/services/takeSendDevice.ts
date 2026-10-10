/**
 * takeSendDevice.ts — THE DEVICE HALF OF "SEND TO…" (v37 item 7, backlog
 * baa39e66).
 *
 * WHAT THIS IS. The three ways a corrected take leaves the device, through the
 * PLATFORM's own share sheet and nothing else:
 *
 *   • exportTakePdfFromTake — the take as a PDF (built and validated by the pure
 *     notation engine in `takeNotationPdf.ts`);
 *   • sendTakeToEmail — the SAME PDF when the platform can attach a file, and the
 *     plain text summary when it cannot. The user's own mail app does the sending:
 *     there is no endpoint here, no inbox of ours, and no claim of a send we did
 *     not make. `expo-sharing` (files) and React Native's `Share` (text) are both
 *     the system share sheet — one route, two carriers.
 *   • the MIDI export is NOT re-implemented here: it already exists
 *     (`captureMidiExport.exportCaptureMidiFromTake`, v37 item 6) and the editor
 *     hands its own handler to the surface. One MIDI path, not two.
 *
 * THE STRUCTURE GATE. The PDF's bytes are parsed back by `validateTakePdf` BEFORE
 * the write/share seam — exactly the rule item 6 applied to the .mid — so a file
 * that does not parse is never handed to the user.
 *
 * NOT tier1-compiled on purpose (it imports expo-file-system / expo-sharing /
 * react-native): the logic that must be testable lives in takeNotationPdf.ts,
 * guitarTab.ts and takeSendTo.ts. Same convention as captureMidiExport.ts.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { midiBytesToBase64, type SavedCaptureTake } from './midiExport';
import {
  TAKE_PDF_EMPTY_MESSAGE,
  TAKE_PDF_FAILED_MESSAGE,
  TAKE_PDF_STRUCTURE_INVALID_MESSAGE,
  TAKE_PDF_UNAVAILABLE_MESSAGE,
  buildTakeNotationPdf,
  exportedTakePdfMessage,
  takePdfFileName,
  validateTakePdf,
  type TakePdfChord,
} from './takeNotationPdf';
import {
  SEND_TO_HONESTY,
  sendToOutcomeMessage,
  sendToPlan,
  takeHasSomethingToSend,
  takeSummaryText,
  type SendToKind,
  type SendToStatus,
} from './takeSendTo';

/** Where derived take files are written (derived files only — never the library). */
export const TAKE_SEND_DIR = `${FileSystem.cacheDirectory ?? ''}notesnap-takes/`;

/** What a Send-to attempt did, with the sentence the surface renders. */
export interface TakeSendOutcome {
  status: SendToStatus;
  kind: SendToKind;
  /** The written file (present when one was handed to the share sheet). */
  fileUri?: string;
  message: string;
}

/** Injectable so the seam can be tested / swapped without touching the UI. */
export interface TakeSendDeps {
  /** Write the bytes and return the file URI (default: expo-file-system). */
  writeFile?: (name: string, bytes: Uint8Array) => Promise<string>;
  /** Hand a FILE to the OS (default: expo-sharing). */
  shareFile?: (fileUri: string, title: string) => Promise<SendToStatus | void>;
  /** Hand TEXT to the OS (default: React Native Share). */
  shareText?: (title: string, text: string) => Promise<SendToStatus | void>;
  /** Whether this device has a share sheet at all (default: expo-sharing). */
  shareSheetAvailable?: () => Promise<boolean>;
}

export interface TakeSendOptions {
  title?: string | null;
  /** The take's suggested chords, printed above the staff in the PDF. */
  chords?: ReadonlyArray<TakePdfChord> | null;
  deps?: TakeSendDeps;
}

/** Write the bytes into the cache directory and return the file URI. */
export async function writeTakeFile(name: string, bytes: Uint8Array): Promise<string> {
  const dirInfo = await FileSystem.getInfoAsync(TAKE_SEND_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(TAKE_SEND_DIR, { intermediates: true });
  }
  const uri = `${TAKE_SEND_DIR}${name}`;
  await FileSystem.writeAsStringAsync(uri, midiBytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

/** Hand the PDF to the OS share sheet (this is the ONLY way it leaves the app). */
export async function shareTakePdf(fileUri: string, title: string): Promise<SendToStatus> {
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: title,
  });
  return 'shared';
}

/** Share the plain summary through the OS sheet (text, not a file). */
export async function shareTakeSummary(title: string, text: string): Promise<SendToStatus> {
  const result = await Share.share({ title, message: text });
  return (result as { action?: string } | undefined)?.action === Share.dismissedAction
    ? 'dismissed'
    : 'shared';
}

async function shareSheetAvailable(deps: TakeSendDeps): Promise<boolean> {
  const check = deps.shareSheetAvailable ?? Sharing.isAvailableAsync;
  try {
    return Boolean(await check());
  } catch {
    return false;
  }
}

/**
 * EXPORT THE TAKE AS A PDF. Never throws: a take with no notes, a file that does
 * not pass its own structure check, a device with no share sheet and a share that
 * failed are four different, honest outcomes.
 */
export async function exportTakePdfFromTake(
  take: SavedCaptureTake | null | undefined,
  opts: TakeSendOptions = {},
): Promise<TakeSendOutcome> {
  const deps = opts.deps ?? {};
  if (!takeHasSomethingToSend(take)) {
    return { status: 'failed', kind: 'pdf', message: TAKE_PDF_EMPTY_MESSAGE };
  }

  const bytes = buildTakeNotationPdf(take, { title: opts.title, chords: opts.chords });
  if (!bytes) {
    return { status: 'failed', kind: 'pdf', message: TAKE_PDF_EMPTY_MESSAGE };
  }

  /**
   * THE STRUCTURE GATE — before anything is written or shared, the exact bytes
   * that would go out are parsed back. A PDF that does not parse is never handed
   * over (the same rule the .mid export follows).
   */
  const structure = validateTakePdf(bytes);
  if (!structure.ok) {
    return { status: 'failed', kind: 'pdf', message: TAKE_PDF_STRUCTURE_INVALID_MESSAGE };
  }

  const available = await shareSheetAvailable(deps);
  const plan = sendToPlan({ hasTake: true, shareSheetAvailable: available });
  if (plan.mode !== 'file') {
    return { status: 'unavailable', kind: 'pdf', message: TAKE_PDF_UNAVAILABLE_MESSAGE };
  }

  try {
    const name = takePdfFileName(opts.title);
    const write = deps.writeFile ?? writeTakeFile;
    const share = deps.shareFile ?? shareTakePdf;
    const fileUri = await write(name, bytes);
    const status = (await share(fileUri, opts.title ?? name)) ?? 'shared';
    return {
      status: status === 'dismissed' ? 'dismissed' : 'shared',
      kind: 'pdf',
      fileUri,
      message:
        status === 'dismissed'
          ? sendToOutcomeMessage('dismissed', 'pdf')
          : exportedTakePdfMessage(take),
    };
  } catch (err) {
    return {
      status: 'failed',
      kind: 'pdf',
      message: err instanceof Error && err.message ? err.message : TAKE_PDF_FAILED_MESSAGE,
    };
  }
}

/**
 * SEND THE TAKE TO THE USER'S OWN EMAIL — through the system share sheet, never
 * through us. A file (the PDF) when the platform can attach one, the plain
 * summary otherwise. `SEND_TO_HONESTY` is on the surface the whole time.
 */
export async function sendTakeToEmail(
  take: SavedCaptureTake | null | undefined,
  opts: TakeSendOptions = {},
): Promise<TakeSendOutcome> {
  const deps = opts.deps ?? {};
  if (!takeHasSomethingToSend(take)) {
    return { status: 'failed', kind: 'email', message: TAKE_PDF_EMPTY_MESSAGE };
  }

  const available = await shareSheetAvailable(deps);
  const plan = sendToPlan({ hasTake: true, shareSheetAvailable: available });
  if (plan.mode === 'none') {
    return { status: 'failed', kind: 'email', message: plan.reason };
  }

  try {
    if (plan.mode === 'file') {
      const bytes = buildTakeNotationPdf(take, { title: opts.title, chords: opts.chords });
      if (!bytes) {
        return { status: 'failed', kind: 'email', message: TAKE_PDF_EMPTY_MESSAGE };
      }
      const structure = validateTakePdf(bytes);
      if (!structure.ok) {
        return {
          status: 'failed',
          kind: 'email',
          message: TAKE_PDF_STRUCTURE_INVALID_MESSAGE,
        };
      }
      const name = takePdfFileName(opts.title);
      const write = deps.writeFile ?? writeTakeFile;
      const share = deps.shareFile ?? shareTakePdf;
      const fileUri = await write(name, bytes);
      const status = (await share(fileUri, opts.title ?? name)) ?? 'shared';
      return {
        status: status === 'dismissed' ? 'dismissed' : 'shared',
        kind: 'email',
        fileUri,
        message: sendToOutcomeMessage(status === 'dismissed' ? 'dismissed' : 'shared', 'email'),
      };
    }
    const text = `${takeSummaryText(take, { title: opts.title })}\n\n${SEND_TO_HONESTY}`;
    const share = deps.shareText ?? shareTakeSummary;
    const status = (await share(opts.title ?? 'Your NoteSnap take', text)) ?? 'shared';
    return {
      status: status === 'dismissed' ? 'dismissed' : 'shared',
      kind: 'email',
      message: sendToOutcomeMessage(status === 'dismissed' ? 'dismissed' : 'shared', 'email'),
    };
  } catch (err) {
    return {
      status: 'failed',
      kind: 'email',
      message: err instanceof Error && err.message ? err.message : TAKE_PDF_FAILED_MESSAGE,
    };
  }
}
