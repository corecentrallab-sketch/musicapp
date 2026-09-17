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
export interface CapturedSamples {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
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
} = {}): SamplesProvider {
  const baseUrl = (deps.baseUrl ?? getApiBaseUrl?.() ?? '').replace(/\/+$/, '');
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const unavailableStatuses = deps.unavailableStatuses ?? [404, 405, 501, 503];

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

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${COACH_PCM_PATH}`, {
        method: 'POST',
        body: form,
        // Do NOT set Content-Type: FormData sets the multipart boundary itself.
      });
    } catch {
      throw new Error(
        'Could not reach the coach decoder. Check your connection and try again.',
      );
    }

    if (unavailableStatuses.includes(response.status)) {
      throw new CoachCaptureUnavailableError(
        'The coach decoder is not available on the server yet.',
      );
    }
    if (!response.ok) {
      throw new Error(`The coach decoder rejected that take (HTTP ${response.status}).`);
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
          error?: string;
        };
        if (!payload || payload.success === false) {
          throw new Error(payload?.error ?? 'The coach decoder could not read that take.');
        }
        if (typeof payload.pcm16Base64 !== 'string' || !payload.pcm16Base64) {
          throw new CoachCaptureUnavailableError(
            'The coach decoder returned no audio to score.',
          );
        }
        const channels = payload.channels === 2 ? 2 : 1;
        const decoded = decodePcm16Base64(payload.pcm16Base64, channels);
        const coach = toCoachSamples({
          samples: decoded,
          sampleRate:
            typeof payload.sampleRate === 'number' && payload.sampleRate > 0
              ? payload.sampleRate
              : COACH_TARGET_SAMPLE_RATE,
        });
        return {
          samples: coach.samples,
          sampleRate: coach.sampleRate,
          durationSec:
            typeof payload.durationSec === 'number' && payload.durationSec > 0
              ? payload.durationSec
              : declaredDurationSec ?? durationOf(coach.samples, coach.sampleRate),
        };
      }

      // WAV (or any byte body we can still sniff as RIFF/WAVE).
      const buffer = await response.arrayBuffer();
      const decoded = decodeWavToFloat32(new Uint8Array(buffer));
      const coach = toCoachSamples({
        samples: decoded.samples,
        sampleRate: decoded.sampleRate,
      });
      return {
        samples: coach.samples,
        sampleRate: coach.sampleRate,
        durationSec:
          declaredDurationSec ?? durationOf(coach.samples, coach.sampleRate),
      };
    } catch (err) {
      if (err instanceof CoachCaptureUnavailableError) throw err;
      if (err instanceof WavDecodeError) throw new CoachCaptureUnavailableError(err.message);
      throw err instanceof Error ? err : new Error('Could not decode that take.');
    }
  };
}

/**
 * The provider the coach card uses by default: the backend decoder. When the
 * decoder is not deployed (or the device is offline) the card shows the honest
 * unavailable state — never a score, never a silent no-op.
 *
 * Set EXPO_PUBLIC_COACH_DECODE=off to disable the network path entirely (e.g.
 * for an offline demo build): the card then goes straight to the honest state.
 */
export function createDefaultSamplesProvider(): SamplesProvider {
  const flag = (process.env.EXPO_PUBLIC_COACH_DECODE ?? '').toLowerCase();
  if (flag === 'off' || flag === '0' || flag === 'false') {
    return async () => {
      throw new CoachCaptureUnavailableError(
        'Practice-audio decoding is switched off in this build.',
      );
    };
  }
  return createRemoteDecodeProvider();
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
