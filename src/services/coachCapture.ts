/**
 * coachCapture.ts — THE SEAM (slice 3). One function decides how a recorded
 * practice take becomes the mono Float32Array the coach scores:
 *
 *     (recording uri) ──► SamplesProvider ──► { samples, sampleRate, durationSec }
 *
 * WHY A SEAM AND NOT A MIC READER
 * The existing recorder (hooks/useAudioRecorder.ts) is expo-av AAC (.m4a) and
 * exposes a file URI only — no samples. expo-av's AndroidOutputFormat has no
 * WAV/LPCM member (see wavCapture.ts's header), so on Android the app cannot
 * produce raw PCM in-app today. Uploading the clip is therefore the only real
 * path that a shipping build can take, and the backend already decodes AAC for
 * the hum pipeline. This module implements that path (`createRemoteDecodeProvider`)
 * against a frozen contract, and FAILS LOUDLY (`CoachCaptureUnavailableError`)
 * when the decoder is not there — the card then shows an honest "needs one more
 * piece" state. It never returns synthetic samples, so no score is ever faked.
 *
 * CONTRACT for the backend route (recommended in the slice-3 report):
 *   POST {baseUrl}/api/coach/pcm
 *     multipart/form-data, field `audio` = the recorded .m4a clip
 *   200 → either
 *     a) JSON: { success: true, sampleRate: number, pcm16Base64: string,
 *                durationSec?: number, channels?: number }   (preferred: small)
 *     or
 *     b) a WAV body (Content-Type: audio/wav), decoded by wavCapture.ts
 *   404/501 → the route is not deployed: the app reports capture-unavailable.
 *
 * Everything is injectable (baseUrl, fetchImpl) so the seam can be unit-tested
 * and so a later in-app decoder (e.g. a WebView/Web-Audio decode) can be
 * dropped in behind the same `SamplesProvider` type without touching the UI.
 */
import { getApiBaseUrl } from './api';
import {
  decodePcm16Base64,
  decodeWavToFloat32,
  toCoachSamples,
  COACH_TARGET_SAMPLE_RATE,
  WavDecodeError,
} from './wavCapture';

/** What every capture path must hand the coach: mono, coach sample rate. */
// vc61 (spec §2): the stage names the provider reports.
import type { TakeReadStage } from './takeReadTimings';
// vc62 (D26/D32): the frames the route now computes for us, and the honest record of
// the round trip (status, error name, bytes, the server's own spans).
import type { PitchFrame } from './pitchDetection';
import {
  READ_REQUEST_TIMEOUT_MS,
  READ_TIMEOUT_LINE,
  parseServerNotes,
  parseServerTimings,
  type NetworkReadResult,
  type ServerReadTimings,
} from './readNetwork';
import * as FileSystem from 'expo-file-system';

export interface CapturedSamples {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
  /**
   * ── vc60 ── THE LEVEL THE DECODER MEASURED, when it reported one.
   *
   * ADDITIVE and OPTIONAL: the five contract fields above are all this seam ever
   * needed, and every existing caller keeps working without these. They are here
   * so the read can tell "this take held no melody" apart from "this take held no
   * sound at all" (see captureMidiExport.ts `decodeTakeFromRecording`), and so
   * that fact covers ANY container the server can decode — not only the ones the
   * device's own recorder metering could watch.
   *
   * `peak` is the largest absolute sample (0…1); `rmsDb` is dBFS (<= 0), or null
   * when the decoder could not measure it. Both null when the server did not send
   * them (an older deployment), which means "not measured" — never "no sound".
   */
  peak?: number | null;
  rmsDb?: number | null;
  /**
   * ── vc62 (D26) ── THE PITCH FRAMES, WHEN THE SERVER COMPUTED THEM.
   *
   * The route runs a PORT of this app's own tracker (`pitchDetection.ts`) over the
   * exact samples it returns, so these ARE the frames `detectPitchFramesAsync`
   * would have produced — and the phone no longer spends 15–25 s producing them.
   * Null when the route is an older deployment, the payload was unusable, or the
   * read never reached the route: the caller then does the device pass, which is
   * the offline path and stays a promised feature.
   */
  frames?: PitchFrame[] | null;
  /** vc62: the spans the SERVER measured for this answer (null = not sent). */
  serverTimings?: ServerReadTimings | null;
  /** vc62: the round trip itself, as measured on this phone. */
  network?: NetworkReadResult | null;
}

/**
 * ── vc62 (D32) ── THE READ THAT FAILED, WITH ITS OWN ROUND TRIP ATTACHED.
 *
 * A plain Error cannot carry the measurement, and the surface needs it: without
 * it a failed read can only say "something went wrong", which is exactly the
 * state in which the retry control never appeared. `network` is null only when the
 * failure happened before any request was made.
 */
export class CoachReadFailedError extends Error {
  network: NetworkReadResult | null;

  constructor(message: string, network: NetworkReadResult | null = null) {
    super(message);
    this.name = 'CoachReadFailedError';
    this.network = network;
  }
}

/** Turns a finished recording into samples. The single injection point. */
export type SamplesProvider = (
  uri: string,
  meta?: { durationMs?: number | null },
) => Promise<CapturedSamples>;

/**
 * Thrown when this build genuinely cannot turn a recording into samples (no
 * decoder deployed / no in-app decode path). Distinct from a generic failure so
 * the UI can say WHY instead of "try again" forever.
 */
export class CoachCaptureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoachCaptureUnavailableError';
  }
}

/** Path of the decoder route (see the contract above). */
export const COACH_PCM_PATH = '/api/coach/pcm';

/** MIME type for the recorded clip we upload (expo-av records AAC/.m4a). */
const AUDIO_MIME_BY_EXT: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  caf: 'audio/x-caf',
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  '3gp': 'audio/3gpp',
};

function fileNameFromUri(uri: string): string {
  const tail = (uri.split('/').pop() ?? 'practice').split('?')[0];
  return tail || 'practice';
}

function mimeFromUri(uri: string): string {
  const name = fileNameFromUri(uri);
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return AUDIO_MIME_BY_EXT[ext] ?? 'audio/mp4';
}

/** Seconds of audio a decoded buffer represents. */
export function durationOf(samples: Float32Array, sampleRate: number): number {
  if (!samples || !Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  return samples.length / sampleRate;
}

/**
 * Build the samples provider that posts the clip to the backend decoder.
 * `baseUrl`/`fetchImpl` default to the app's API base and global fetch.
 */
export function createRemoteDecodeProvider(deps: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Override for tests: route not deployed is reported as unavailable. */
  unavailableStatuses?: number[];
  /**
   * ── vc61 (spec §2) ── THE PHONE'S OWN WORK AFTER THE ANSWER, MEASURED.
   *
   * `clientDecode` is base64 PCM16 → Float32 plus the resample to the coach rate. It is the
   * one part of this provider that is separable from the round trip, so it is the one part
   * reported; the POST itself (and the server's decode inside it) is timed by the caller as
   * the single `upload` span. A caller that passes nothing is untouched.
   */
  onStage?: (stage: TakeReadStage, ms: number) => void;
  /**
   * ── vc62 (D32) ── HOW LONG THE READ MAY HOLD THE SCREEN BEFORE IT IS CALLED DEAD.
   *
   * Defaults to `READ_REQUEST_TIMEOUT_MS` (40 s — the measured answers are 1–4 s, so this
   * only ever fires on a stalled connection). When it fires the read FAILS with a sentence
   * and a retry, instead of a clock that runs for ever: that is the difference between a
   * slow read and a hung one, and before vc62 the app could not tell them apart.
   */
  timeoutMs?: number;
  /**
   * vc62: the upload's size, measured before the request. Injectable so the figure can be
   * proven without a device; the default asks the file system, and `null` means "not
   * measured" (never zero).
   */
  fileSizeImpl?: (uri: string) => Promise<number | null>;
} = {}): SamplesProvider {
  const baseUrl = (deps.baseUrl ?? getApiBaseUrl?.() ?? '').replace(/\/+$/, '');
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const unavailableStatuses = deps.unavailableStatuses ?? [404, 405, 501, 503];
  const timeoutMs =
    typeof deps.timeoutMs === 'number' && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0
      ? deps.timeoutMs
      : READ_REQUEST_TIMEOUT_MS;

  return async function remoteDecodeProvider(uri, meta) {
    if (!fetchImpl) {
      throw new CoachCaptureUnavailableError(
        'This build has no network client available to decode practice audio.',
      );
    }
    if (!baseUrl) {
      throw new CoachCaptureUnavailableError(
        'No decoder is configured for practice audio in this build.',
      );
    }

    const name = fileNameFromUri(uri);
    const form = new FormData();
    // React Native's FormData accepts this {uri,name,type} shape for a file part.
    form.append('audio', {
      uri,
      name,
      type: mimeFromUri(uri),
    } as unknown as Blob);

    /**
     * ── vc62 (D32) ── THE DEADLINE, AND THE HONEST RECORD OF THE ROUND TRIP ──────
     *
     * Before this the request had no `AbortController` and no timeout, so a slow read
     * and a hung read were the same state: the screen waited on a clock that never
     * failed, which is exactly why "Try the read again" never had a failure to appear
     * on. Now the request is abortable, the abort is OURS (`timedOut`), and every
     * outcome — an answer, a status, a thrown error, the deadline — is recorded with
     * its measured bytes so the probe card can print it.
     */
    const bytesSent = await measureUploadBytes(uri, deps.fileSizeImpl);
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${COACH_PCM_PATH}`, {
        method: 'POST',
        body: form,
        signal: controller?.signal,
        // Do NOT set Content-Type: FormData sets the multipart boundary itself.
      });
    } catch (err) {
      const errorName = err instanceof Error && err.name ? err.name : 'Error';
      throw new CoachReadFailedError(
        timedOut
          ? READ_TIMEOUT_LINE
          : 'Could not reach the coach decoder. Check your connection and try again.',
        {
          httpStatus: null,
          errorName,
          timedOut,
          bytesSent,
          bytesReceived: null,
          serverTimings: null,
        },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    const bytesReceived = responseBytes(response);
    const networkBase: NetworkReadResult = {
      httpStatus: response.status,
      errorName: null,
      timedOut: false,
      bytesSent,
      bytesReceived,
      serverTimings: null,
    };

    if (unavailableStatuses.includes(response.status)) {
      throw new CoachCaptureUnavailableError(
        'The coach decoder is not available on the server yet.',
      );
    }
    if (!response.ok) {
      throw new CoachReadFailedError(
        `The coach decoder rejected that take (HTTP ${response.status}).`,
        networkBase,
      );
    }

    const declaredDurationSec =
      typeof meta?.durationMs === 'number' && meta.durationMs > 0
        ? meta.durationMs / 1000
        : null;

    const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase();

    try {
      if (contentType.includes('json')) {
        const payload = (await response.json()) as {
          success?: boolean;
          sampleRate?: number;
          pcm16Base64?: string;
          channels?: number;
          durationSec?: number;
          /** vc60, additive: the decoder's own level measurement (see CapturedSamples). */
          peak?: number;
          rmsDb?: number | null;
          /** vc62, additive: the frames the route computed, and its own spans. */
          notes?: unknown;
          timings?: unknown;
          error?: string;
        };
        if (!payload || payload.success === false) {
          throw new CoachReadFailedError(
            payload?.error ?? 'The coach decoder could not read that take.',
            networkBase,
          );
        }
        if (typeof payload.pcm16Base64 !== 'string' || !payload.pcm16Base64) {
          throw new CoachCaptureUnavailableError(
            'The coach decoder returned no audio to score.',
          );
        }
        /**
         * ── vc62 (D26) ── THE SERVER'S FRAMES AND ITS OWN SPANS ─────────────────
         *
         * Both are validated whole (`parseServerNotes` returns null for anything it
         * cannot fully trust) and both are OPTIONAL: an older deployment sends
         * neither, `frames` is null, and the caller does the device pass — the
         * offline path, which is a promised feature and stays untouched.
         */
        const serverNotes = parseServerNotes(payload);
        const serverTimings = parseServerTimings(payload);
        const channels = payload.channels === 2 ? 2 : 1;
        const unpackStartedAt = Date.now();
        const decoded = decodePcm16Base64(payload.pcm16Base64, channels);
        const coach = toCoachSamples({
          samples: decoded,
          sampleRate:
            typeof payload.sampleRate === 'number' && payload.sampleRate > 0
              ? payload.sampleRate
              : COACH_TARGET_SAMPLE_RATE,
        });
        deps.onStage?.('clientDecode', Date.now() - unpackStartedAt);
        return {
          samples: coach.samples,
          sampleRate: coach.sampleRate,
          durationSec:
            typeof payload.durationSec === 'number' && payload.durationSec > 0
              ? payload.durationSec
              : declaredDurationSec ?? durationOf(coach.samples, coach.sampleRate),
          // vc60: absent (an older deployment) reads as "not measured", never as 0.
          peak:
            typeof payload.peak === 'number' && Number.isFinite(payload.peak)
              ? payload.peak
              : null,
          rmsDb:
            typeof payload.rmsDb === 'number' && Number.isFinite(payload.rmsDb)
              ? payload.rmsDb
              : null,
          // vc62: the frames the phone no longer has to compute, when they came.
          frames: serverNotes,
          serverTimings,
          network: { ...networkBase, serverTimings },
        };
      }

      // WAV (or any byte body we can still sniff as RIFF/WAVE).
      const buffer = await response.arrayBuffer();
      const unpackStartedAt = Date.now();
      const decoded = decodeWavToFloat32(new Uint8Array(buffer));
      const coach = toCoachSamples({
        samples: decoded.samples,
        sampleRate: decoded.sampleRate,
      });
      deps.onStage?.('clientDecode', Date.now() - unpackStartedAt);
      return {
        samples: coach.samples,
        sampleRate: coach.sampleRate,
        durationSec:
          declaredDurationSec ?? durationOf(coach.samples, coach.sampleRate),
        // A WAV body carries no frames: the device does its own pass, as before.
        frames: null,
        serverTimings: null,
        network: networkBase,
      };
    } catch (err) {
      if (err instanceof CoachCaptureUnavailableError) throw err;
      if (err instanceof CoachReadFailedError) throw err;
      if (err instanceof WavDecodeError) throw new CoachCaptureUnavailableError(err.message);
      throw err instanceof Error ? new CoachReadFailedError(err.message, networkBase) : new CoachReadFailedError('Could not decode that take.', networkBase);
    }
  };
}

/**
 * ── vc62 ── HOW BIG THE UPLOAD WAS, MEASURED BEFORE IT IS SENT ────────────────
 *
 * `null` means "not measured" — never 0. The default asks the file system for the
 * file's own size (the same question the probe card asks), and an injectable seam
 * lets the gate prove the figure without a device.
 */
export async function measureUploadBytes(
  uri: string,
  fileSizeImpl?: (uri: string) => Promise<number | null>,
): Promise<number | null> {
  try {
    const size = fileSizeImpl
      ? await fileSizeImpl(uri)
      : await defaultFileSize(uri);
    const value = Number(size);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The file system's answer for a file's size, or null when it cannot say. */
async function defaultFileSize(uri: string): Promise<number | null> {
  const info = await FileSystem.getInfoAsync(uri);
  const size = (info as { size?: unknown })?.size;
  const value = Number(size);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The answer's size from its own header, or null when the server sent none. */
function responseBytes(response: Response): number | null {
  try {
    const header = response.headers?.get?.('content-length') ?? null;
    if (!header) return null;
    const value = Number(header);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * The provider the coach card uses by default: the backend decoder. When the
 * decoder is not deployed (or the device is offline) the card shows the honest
 * unavailable state — never a score, never a silent no-op.
 *
 * Set EXPO_PUBLIC_COACH_DECODE=off to disable the network path entirely (e.g.
 * for an offline demo build): the card then goes straight to the honest state.
 */
export function createDefaultSamplesProvider(deps: {
  /** vc61 (spec §2): the caller's stage recorder, passed straight through. */
  onStage?: (stage: TakeReadStage, ms: number) => void;
} = {}): SamplesProvider {
  const flag = (process.env.EXPO_PUBLIC_COACH_DECODE ?? '').toLowerCase();
  if (flag === 'off' || flag === '0' || flag === 'false') {
    return async () => {
      throw new CoachCaptureUnavailableError(
        'Practice-audio decoding is switched off in this build.',
      );
    };
  }
  return createRemoteDecodeProvider({ onStage: deps.onStage });
}

/** True when a thrown error means "no decoder in this build" (not a failure). */
export function isCaptureUnavailable(err: unknown): boolean {
  return err instanceof CoachCaptureUnavailableError;
}

/** Human-readable message for any thrown capture error. */
export function captureErrorMessage(err: unknown): string {
  if (err instanceof CoachCaptureUnavailableError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Could not process the recording. Please try again.';
}
