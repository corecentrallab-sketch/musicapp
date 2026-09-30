/**
 * captureMidiExport.ts — the device-side half of "Export MIDI" (Batch A): turn
 * a hum/whistle/sing recording into a .mid file and hand it to the OS share
 * sheet, or serialize a take that was already derived and stored.
 *
 * TWO ENTRY POINTS, ONE FILE FORMAT:
 *
 *   • exportCaptureMidiFromRecording(uri) — the result screen's path. The
 *     recording is decoded to mono samples by the EXISTING capture seam
 *     (coachCapture.createDefaultSamplesProvider → POST /api/coach/pcm, live on
 *     the product backend), the samples go through the existing pitch tracker
 *     (pitchDetection.detectPitchFrames), and the frames become the take. No new
 *     decode path, no new network route, no second pitch tracker.
 *   • exportCaptureMidiFromTake(take) — the History path: the row already
 *     carries the derived take (real notes + timings + key), so no network and
 *     no re-decode is needed.
 *
 * WHERE THE FILE GOES: the app's cache directory (the same place the repo keeps
 * derived files), base64-written through expo-file-system exactly as
 * captureTelemetry.ts writes a capture, then shared with expo-sharing exactly
 * as cloudSync.shareLibraryItem shares a library file. The user's copy lives in
 * whatever they send it to — we do not invent a new document store, and nothing
 * here writes into the sheet-music library.
 *
 * EVERY OUTCOME IS HONEST AND VISIBLE: 'exported', 'no-melody' (the take was
 * too thin to be music), 'unavailable' (no decoder in this build / offline) or
 * 'failed' — each with a sentence the screen renders. `encodeMidiFile` returning
 * null is never dressed up as a success.
 *
 * Not tier1-compiled on purpose (it imports expo-file-system / expo-sharing, so
 * it cannot run under plain Node) — same convention as coachCapture.ts. The
 * logic that must be testable lives in midiExport.ts / keyDetection.ts.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  captureErrorMessage,
  createDefaultSamplesProvider,
  isCaptureUnavailable,
  type SamplesProvider,
} from './coachCapture';
import { detectPitchFrames } from './pitchDetection';
import {
  MIDI_FAILED_MESSAGE,
  MIDI_MIME_TYPE,
  MIDI_NO_MELODY_MESSAGE,
  MIDI_UNAVAILABLE_MESSAGE,
  MIDI_UTI,
  buildCaptureTake,
  encodeMidiFile,
  exportedMidiMessage,
  midiBytesToBase64,
  midiFileName,
  type MidiExportOutcome,
  type SavedCaptureTake,
} from './midiExport';

/** Where exported takes are written. Derived files only — never the library. */
export const MIDI_EXPORT_DIR = `${FileSystem.cacheDirectory ?? ''}notesnap-midi/`;

/** Injectable so the seam can be tested / swapped without touching the UI. */
export interface MidiExportDeps {
  /** Recording URI → mono samples (default: the existing backend decoder seam). */
  samplesProvider?: SamplesProvider;
  /** Write the bytes and return the file URI (default: expo-file-system). */
  writeFile?: (name: string, bytes: Uint8Array) => Promise<string>;
  /** Hand the file to the OS (default: expo-sharing). */
  shareFile?: (fileUri: string, title: string) => Promise<void>;
}

/** Write the SMF bytes into the cache directory and return the file URI. */
export async function writeMidiFile(name: string, bytes: Uint8Array): Promise<string> {
  const dirInfo = await FileSystem.getInfoAsync(MIDI_EXPORT_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(MIDI_EXPORT_DIR, { intermediates: true });
  }
  const uri = `${MIDI_EXPORT_DIR}${name}`;
  await FileSystem.writeAsStringAsync(uri, midiBytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

/** Open the system share sheet on a .mid file (the repo's export mechanism). */
export async function shareMidiFile(fileUri: string, title: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: MIDI_MIME_TYPE,
    dialogTitle: title,
    UTI: MIDI_UTI,
  });
}

export interface ExportTakeOptions {
  /** Piece title, used for the file name and the share dialog. */
  title?: string;
  deps?: MidiExportDeps;
}

/**
 * Encode → write → share an already-derived take (the History path, and the
 * tail of the recording path). Never throws: every failure is an outcome the
 * caller can render.
 */
export async function exportCaptureMidiFromTake(
  take: SavedCaptureTake | null | undefined,
  opts: ExportTakeOptions = {},
): Promise<MidiExportOutcome> {
  const bytes = encodeMidiFile({
    notes: take?.notes ?? null,
    tempoBpm: take?.tempoBpm,
    title: opts.title,
    // The take's DETECTED KEY goes INTO the file: with a key the encoder writes
    // the SMF key-signature meta event (FF 59 02 sf mi), and with none it writes
    // no key event at all — never a fabricated key.
    key: take?.key ?? null,
  });
  if (!bytes || !take) {
    return { status: 'no-melody', message: MIDI_NO_MELODY_MESSAGE };
  }

  try {
    const write = opts.deps?.writeFile ?? writeMidiFile;
    const share = opts.deps?.shareFile ?? shareMidiFile;
    const fileUri = await write(midiFileName(opts.title), bytes);
    await share(fileUri, opts.title ?? midiFileName(opts.title));
    return {
      status: 'exported',
      fileUri,
      take,
      // …and the same key comes back OUT to the screen, so the card/row can say
      // which key the file was written in (and print nothing when there was none).
      key: take?.key ?? null,
      message: exportedMidiMessage(take),
    };
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error && err.message ? err.message : MIDI_FAILED_MESSAGE,
    };
  }
}

export interface ExportRecordingInput {
  /** The recording the user just made (expo-av .m4a URI). */
  uri: string;
  title?: string;
  /** Tempo to write into the file (default 120 bpm — an honest placeholder). */
  tempoBpm?: number;
  /** ISO timestamp for the stored take (defaults to now). */
  capturedAt?: string;
}

/**
 * Decode the capture, derive its take and export it. The decoder is the
 * coach's existing seam; when it is unavailable (offline, route missing) the
 * user gets MIDI_UNAVAILABLE_MESSAGE instead of a spinner that never ends.
 */
export async function exportCaptureMidiFromRecording(
  input: ExportRecordingInput,
  deps: MidiExportDeps = {},
): Promise<MidiExportOutcome> {
  const uri = input?.uri;
  if (typeof uri !== 'string' || uri.length === 0) {
    return { status: 'failed', message: MIDI_FAILED_MESSAGE };
  }

  const provider = deps.samplesProvider ?? createDefaultSamplesProvider();
  let captured;
  try {
    captured = await provider(uri);
  } catch (err) {
    if (isCaptureUnavailable(err)) {
      return { status: 'unavailable', message: MIDI_UNAVAILABLE_MESSAGE };
    }
    return { status: 'failed', message: captureErrorMessage(err) };
  }

  const frames = detectPitchFrames(captured.samples, captured.sampleRate);
  const take = buildCaptureTake(frames, {
    tempoBpm: input.tempoBpm,
    capturedAt:
      typeof input.capturedAt === 'string' && input.capturedAt.length > 0
        ? input.capturedAt
        : new Date().toISOString(),
  });
  if (!take) {
    return { status: 'no-melody', message: MIDI_NO_MELODY_MESSAGE };
  }

  return exportCaptureMidiFromTake(take, { title: input.title, deps });
}
