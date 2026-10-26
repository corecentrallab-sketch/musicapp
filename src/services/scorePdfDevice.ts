/**
 * scorePdfDevice.ts — THE DEVICE HALF of "print / share as PDF" (v44 slice C).
 * The DECISION lives in the pure `scorePdf.ts`; this module does only the three
 * things that need a platform: write the bytes into the cache, read them BACK off
 * disk to prove the file is the file we built, and hand it to the OS share sheet
 * (`expo-sharing`, mimeType `application/pdf`).
 *
 * THE SAME PROOF THE TAKE PDF SHIPPED WITH (v40 fix K). The owner's take once
 * "arrived in Gmail but wouldn't open", and the lesson is not optional: a file is
 * never shared without being read back off disk and compared byte-for-byte with
 * what we wrote (`takePdfReadBackProblem`). A mismatch is refused out loud.
 *
 * NOT tier1-compiled on purpose (it imports expo-file-system / expo-sharing), the
 * same convention as takeSendDevice.ts / scoreShareDevice.ts. Everything the gate
 * asserts lives in scorePdf.ts, which this module only calls.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { midiBytesToBase64 } from './midiExport';
import { takePdfReadBackProblem } from './takeNotationPdf';
import {
  SCORE_PDF_FAILED_MESSAGE,
  SCORE_PDF_MIME_TYPE,
  SCORE_PDF_STRUCTURE_INVALID_MESSAGE,
  SCORE_PDF_UNAVAILABLE_MESSAGE,
  buildScorePdf,
  scorePdfFileName,
  validateScorePdf,
  type ScorePdfResult,
} from './scorePdf';

/** Where the exported PDFs are written (derived files — never the Library). */
export const SCORE_PDF_DIR = `${FileSystem.cacheDirectory ?? ''}notesnap-pdfs/`;

export type ScorePdfStatus = 'shared' | 'empty' | 'invalid' | 'unavailable' | 'failed';

export interface ScorePdfOutcome {
  status: ScorePdfStatus;
  /** The written file, when one was handed to the share sheet. */
  fileUri?: string;
  /** The sentence the surface shows when something went wrong. */
  message?: string;
  /** Bars printed (0 when nothing was built). */
  bars: number;
  /** The bytes we built, for the caller's own read-back/log line. */
  bytes?: Uint8Array;
}

export interface ScorePdfShareInput {
  abc: string;
  title: string;
  composer?: string;
  keyLabel: string;
  offset: number;
}

/** Write the PDF bytes into the cache directory and return the file URI. */
export async function writeScorePdfFile(name: string, bytes: Uint8Array): Promise<string> {
  const info = await FileSystem.getInfoAsync(SCORE_PDF_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(SCORE_PDF_DIR, { intermediates: true });
  }
  const uri = `${SCORE_PDF_DIR}${name}`;
  await FileSystem.writeAsStringAsync(uri, midiBytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

/** Read a written PDF back as base64 (and report nothing rather than lie). */
export async function readScorePdfBase64(fileUri: string): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return null;
  }
}

async function shareSheetAvailable(): Promise<boolean> {
  try {
    return Boolean(await Sharing.isAvailableAsync());
  } catch {
    return false;
  }
}

/**
 * BUILD → CHECK → WRITE → PROVE → SHARE. Never throws: every refusal is an
 * honest outcome with the sentence the reader shows. The score that is exported
 * is THE ABC IT IS GIVEN — the reader passes the score on screen, in the key the
 * user chose, with every bar.
 */
export async function shareScorePdf(input: ScorePdfShareInput): Promise<ScorePdfOutcome> {
  const result: ScorePdfResult | null = buildScorePdf({
    abc: input.abc,
    title: input.title,
    composer: input.composer,
    keyLabel: input.keyLabel,
    offset: input.offset,
  });
  if (!result) return { status: 'empty', message: SCORE_PDF_STRUCTURE_INVALID_MESSAGE, bars: 0 };

  const check = validateScorePdf(result);
  if (!check.ok) {
    return {
      status: 'invalid',
      message: SCORE_PDF_STRUCTURE_INVALID_MESSAGE,
      bars: result.measureCount,
      bytes: result.bytes,
    };
  }

  let available = false;
  try {
    available = await shareSheetAvailable();
  } catch {
    available = false;
  }
  if (!available) {
    return { status: 'unavailable', message: SCORE_PDF_UNAVAILABLE_MESSAGE, bars: result.measureCount };
  }

  const name = scorePdfFileName({
    title: input.title,
    keyLabel: input.keyLabel,
    offset: input.offset,
  });

  try {
    const uri = await writeScorePdfFile(name, result.bytes);
    const readBack = await readScorePdfBase64(uri);
    const problem = takePdfReadBackProblem(readBack, result.bytes);
    if (problem) {
      return { status: 'failed', message: problem, bars: result.measureCount, bytes: result.bytes };
    }
    await Sharing.shareAsync(uri, {
      mimeType: SCORE_PDF_MIME_TYPE,
      dialogTitle: `${input.title} — transposed score (PDF)`,
      UTI: 'com.adobe.pdf',
    });
    return { status: 'shared', fileUri: uri, bars: result.measureCount, bytes: result.bytes };
  } catch {
    return {
      status: 'failed',
      message: SCORE_PDF_FAILED_MESSAGE,
      bars: result.measureCount,
      bytes: result.bytes,
    };
  }
}
