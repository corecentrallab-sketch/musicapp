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
import { detectPitchFramesAsync } from './pitchDetection';
// vc62 (D26/D32): the round trip as measured on this phone — the frames the server
// computed, its own spans, and what actually happened on the wire.
import type { NetworkReadResult, ServerReadTimings } from './readNetwork';
// vc61 (spec §2): the stage names this pipeline reports as each one finishes.
import type { TakeReadStage } from './takeReadTimings';
// vc60: the level verdict (nothing recorded / decode failed / no melody) is decided
// in ONE pure place, so every surface that reads a take speaks the same facts.
import { TAKE_NO_SOUND_LINE, levelIsNoSound, takeLevelDbFS } from './takeReadVerdict';
// vc65 (owner 11-17): the fallback is ANNOUNCED, not silent — see takeReadProgress.ts.
import { readFallbackNotice } from './takeReadProgress';
import type { ReadFallbackNotice } from './takeReadProgress';
import { MIDI_STRUCTURE_INVALID_MESSAGE, validateMidiStructure } from './midiStructure';
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
  /**
   * ── vc61 (spec §2) ── ONE MEASURED SPAN, AS EACH STAGE OF THE READ FINISHES.
   *
   * A measurement, not a behaviour: nothing about how a take is read changes, and a caller
   * that does not pass this (every caller before vc61) is untouched. The stages that are
   * separable HERE are reported here; the provider reports its own two (`upload`,
   * `clientDecode`), and the staff draw is not measurable at all in this build — see
   * services/takeReadTimings.ts, which says so in the code rather than inventing a number.
   */
  onStage?: (stage: TakeReadStage, ms: number) => void;
  /**
   * ── vc65 (owner 11-17) ── THE FALLBACK, REPORTED THE MOMENT IT TAKES OVER.
   *
   * When the route answers without notes, the phone runs its own pitch pass. That is a
   * real 15–25 s of work and it used to happen in complete silence, so the user saw a
   * clock counting for no stated reason. This is called BEFORE that pass starts, with the
   * reason and the sentence to print — see services/takeReadProgress.ts. A caller that
   * does not pass it is untouched: the read itself is unchanged.
   */
  onPitchFallback?: (notice: ReadFallbackNotice) => void;
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

  /**
   * THE STRUCTURE GATE (v37 item 6, backlog d2e9e2c5, owner v36 ask item 6).
   *
   * The owner has no MIDI hardware: the only way to check an export is to open it
   * on a desktop, so a malformed file costs a whole round trip. The encoder is
   * ours and pure, so the bytes it just produced are parsed HERE — the exact bytes
   * that would be written — and a file that does not parse is NEVER handed over.
   * This runs BEFORE the write/share seam below: a check after the share sheet
   * would guard nothing (the user already has the file).
   */
  const structure = validateMidiStructure(bytes);
  if (!structure.ok) {
    return { status: 'failed', message: MIDI_STRUCTURE_INVALID_MESSAGE };
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
  /**
   * ── vc60 ── THE LEVEL THE RECORDER MEASURED WHILE IT RECORDED, in dBFS.
   *
   * OPTIONAL and additive: a caller that does not measure (every caller before
   * vc60) leaves it out and nothing changes. A caller that does — the
   * practice-video screen hands in `stopRecording()`'s own
   * `diagnostics.peakDbFS` — gets the honest "nothing was recorded" verdict
   * instead of a take with no sound in it being reported as "no melody was heard"
   * (services/takeReadVerdict.ts).
   */
  peakDbFS?: number | null;
}

/** What reading a recording into a take produced (see deriveCaptureTakeFromRecording). */
export interface DerivedTake {
  /** The take the pipeline read from the recording, or null when it heard nothing. */
  take: SavedCaptureTake | null;
  /** True when this build/route cannot decode at all (no decoder, offline). */
  unavailable: boolean;
  /** One honest sentence when there is no usable take (`take` is null). */
  message: string | null;
  /**
   * ── vc60 ── THE DECODE ITSELF FAILED (offline, HTTP error, a timeout).
   *
   * NOT the same fact as `unavailable` (this build has no reader) and NOT a verdict
   * on the melody: the app never heard the take at all. Before vc60 both this and a
   * take of nothing printed "No melody was heard in this take."
   */
  decodeFailed?: boolean;
  /**
   * ── vc60 ── THE LEVEL SAYS THE TAKE HOLDS NO SOUND.
   *
   * Measured by the recorder's own metering, or (when that was not available) by
   * the decoder's `peak` — never by file size or duration, which cannot tell a
   * quiet take from a loud one. See services/takeReadVerdict.ts.
   */
  noSound?: boolean;
  /**
   * ── vc62 (D26) ── WHERE THE PITCH FRAMES CAME FROM.
   *
   * `'server'` is the fast path this build exists for: the route returns the frames
   * (a port of this app's own tracker), so the phone never runs its own YIN pass.
   * `'device'` is the offline fallback — the same arithmetic as before, and the
   * reason an offline phone still reads a take. Null when no read produced frames.
   */
  pitchSource?: 'server' | 'device' | null;
  /** vc62: the spans the server measured for this answer (null = it sent none). */
  serverTimings?: ServerReadTimings | null;
  /** vc62: the round trip itself — status, error name, bytes, timeout. */
  network?: NetworkReadResult | null;
}

/**
 * THE ONE DECODE PATH: recording URI → the take the pipeline read from it.
 *
 * `exportCaptureMidiFromRecording` (the export) and
 * `deriveCaptureTakeFromRecording` (the melody-capture window's analysis, owner
 * 10-02) both come through here, so there is exactly ONE decode seam
 * (`coachCapture.createDefaultSamplesProvider` → `detectPitchFrames` →
 * `buildCaptureTake`) and the two callers can never drift into two different
 * readings of the same take.
 *
 * Never throws: a decoder that is not there comes back `unavailable`, an empty
 * take comes back with the honest "we could not hear enough melody" sentence.
 */
async function decodeTakeFromRecording(
  input: ExportRecordingInput,
  deps: MidiExportDeps,
): Promise<DerivedTake> {
  const uri = input?.uri;
  if (typeof uri !== 'string' || uri.length === 0) {
    return { take: null, unavailable: false, message: MIDI_FAILED_MESSAGE };
  }

  /**
   * ── vc60 ── NOTHING WAS RECORDED IS ITS OWN FACT, AND IT IS FREE TO ESTABLISH ──
   *
   * The recorder meters every take (`isMeteringEnabled: true`, sampled every 200 ms,
   * turned into `peakDbFS` at stop). When the caller hands that in and it sits at or
   * below the sound floor, there is nothing to read and nothing to upload: the take
   * is answered honestly and the decode is never asked to pronounce on a melody it
   * could not have heard. A caller that does not measure is untouched (null = not
   * measured = no verdict — see takeReadVerdict.ts).
   */
  const meteredLevel = takeLevelDbFS({ meteredDbFS: input?.peakDbFS ?? null });
  if (levelIsNoSound(meteredLevel)) {
    return {
      take: null,
      unavailable: false,
      noSound: true,
      message: TAKE_NO_SOUND_LINE,
    };
  }

  const provider = deps.samplesProvider ?? createDefaultSamplesProvider({ onStage: deps.onStage });
  let captured;
  /**
   * ── vc61 (spec §2) ── THE `upload` SPAN, MEASURED.
   *
   * Everything from here to the answer is ONE awaited call: the multipart POST, the server's
   * decode of the file and the response coming back. The client cannot see inside it, so it
   * is timed as one span and labelled as one — the server's decode is INSIDE this number,
   * never a separate figure invented for it.
   */
  const uploadStartedAt = Date.now();
  try {
    captured = await provider(uri);
    deps.onStage?.('upload', Date.now() - uploadStartedAt);
  } catch (err) {
    if (isCaptureUnavailable(err)) {
      return { take: null, unavailable: true, message: MIDI_UNAVAILABLE_MESSAGE };
    }
    /**
     * ── vc60 ── A FAILED DECODE IS NOT A VERDICT ON THE MELODY.
     *
     * This used to come back indistinguishable from a take of nothing, so an
     * offline phone told the owner "No melody was heard in this take." The flag is
     * the fact; the surface picks the sentence (takeReadVerdict.takeReadLine).
     */
    return {
      take: null,
      unavailable: false,
      decodeFailed: true,
      message: captureErrorMessage(err),
      // vc62: the round trip that failed, so the surface can print what actually
      // happened (status, error name, bytes, the deadline) instead of "failed".
      network: networkOf(err),
    };
  }

  /**
   * ── vc60 ── THE DECODER'S OWN LEVEL, WHEN THE RECORDER COULD NOT MEASURE ─────
   *
   * The same verdict from the other end of the seam: the server reports the peak of
   * the PCM it decoded (any container), so a take that decoded to nothing is called
   * nothing here too. Only consulted when the device's metering gave no answer.
   */
  if (!levelIsNoSound(meteredLevel) && levelIsNoSound(takeLevelDbFS({ decodedPeak: captured?.peak ?? null }))) {
    return {
      take: null,
      unavailable: false,
      noSound: true,
      message: TAKE_NO_SOUND_LINE,
    };
  }

  /**
   * ── vc56 ── THE READ THAT USED TO FREEZE THE SCREEN, SLICED ────────────────
   *
   * This was `detectPitchFrames` — a single synchronous pass. On a 60-second take
   * that is ~2,400 YIN period searches, measured at 4,178 ms of solid CPU in Node
   * (and several times that on a handset's Hermes), all of it on the JS thread
   * while the review surface was on screen and the owner was pressing the
   * full-screen icon. The tap was not looked at until the read finished, which is
   * the 15–20 s of "the app did nothing". The sliced read produces the SAME frames
   * (the gate compares them frame for frame) and hands the thread back between
   * slices, so the window opens on the press.
   *
   * ── vc62 (D26) ── AND NOW THE PHONE DOES NOT RUN IT AT ALL, WHEN IT CAN ─────
   *
   * The route returns `notes`: the frames a PORT of this very tracker computed,
   * over the exact samples it returned. So the fast path is "use them and skip the
   * pass entirely" — that pass is the 15–25 s the owner called "almost unusable".
   * The device pass below is UNCHANGED and still runs whenever the route is
   * unreachable, is an older deployment, or sent a payload we cannot fully trust:
   * offline is a promised feature and must still read a take.
   */
  const pitchStartedAt = Date.now();
  /**
   * ── vc65 (owner 11-17) ── THE FALLBACK IS SAID BEFORE IT RUNS, NOT AFTER ──────
   *
   * This pass is the 15–25 s the owner experiences as "still processing" with nothing on
   * screen to explain it. The notice goes out HERE — before the work starts — so the
   * surface can name the reason while the user is waiting, not after the wait is over.
   */
  const framesFromServer = captured?.frames ?? null;
  if (!(Array.isArray(framesFromServer) && framesFromServer.length > 0)) {
    const notice = readFallbackNotice({
      pitchSource: 'device',
      network: captured?.network ?? null,
    });
    if (notice) deps.onPitchFallback?.(notice);
  }
  const serverFrames = captured?.frames ?? null;
  const frames =
    Array.isArray(serverFrames) && serverFrames.length > 0
      ? serverFrames
      : await detectPitchFramesAsync(captured.samples, captured.sampleRate);
  const pitchSource: 'server' | 'device' =
    Array.isArray(serverFrames) && serverFrames.length > 0 ? 'server' : 'device';
  deps.onStage?.('pitch', Date.now() - pitchStartedAt);
  const buildStartedAt = Date.now();
  const take = buildCaptureTake(frames, {
    tempoBpm: input.tempoBpm,
    capturedAt:
      typeof input.capturedAt === 'string' && input.capturedAt.length > 0
        ? input.capturedAt
        : new Date().toISOString(),
  });
  deps.onStage?.('build', Date.now() - buildStartedAt);
  if (!take) {
    return {
      take: null,
      unavailable: false,
      message: MIDI_NO_MELODY_MESSAGE,
      pitchSource,
      serverTimings: captured?.serverTimings ?? null,
      network: captured?.network ?? null,
    };
  }
  return {
    take,
    unavailable: false,
    message: null,
    pitchSource,
    serverTimings: captured?.serverTimings ?? null,
    network: captured?.network ?? null,
  };
}

/** The round trip carried by a failed read, when the error carries one. */
function networkOf(err: unknown): NetworkReadResult | null {
  const carried = (err as { network?: unknown } | null)?.network;
  if (!carried || typeof carried !== 'object') return null;
  return carried as NetworkReadResult;
}

/**
 * READ a finished recording into a take — no export, no share sheet.
 *
 * The melody-capture window needs the take to show its note sequence, its
 * detected key and its suggested chords, and it must NOT open a share sheet to
 * get one. Same seam, same honesty: `unavailable` means the decoder itself is
 * not reachable (the window then says so and offers to try again), and a null
 * take with `unavailable: false` means the take was read and held no melody.
 */
export async function deriveCaptureTakeFromRecording(
  input: ExportRecordingInput,
  deps: MidiExportDeps = {},
): Promise<DerivedTake> {
  return decodeTakeFromRecording(input, deps);
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
  const derived = await decodeTakeFromRecording(input, deps);
  if (!derived.take) {
    return {
      status: derived.unavailable ? 'unavailable' : derived.message === MIDI_NO_MELODY_MESSAGE ? 'no-melody' : 'failed',
      message: derived.message ?? MIDI_FAILED_MESSAGE,
    };
  }
  return exportCaptureMidiFromTake(derived.take, { title: input?.title, deps });
}
