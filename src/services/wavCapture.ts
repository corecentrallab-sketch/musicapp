/**
 * wavCapture.ts — turn *bytes* of captured practice audio into the mono
 * Float32Array that the practice coach scores (slice 3).
 *
 * WHY THIS FILE EXISTS (read this before changing the capture path):
 * expo-av on Android can only record compressed AAC (.m4a). Its
 * `AndroidOutputFormat` has no WAV/LPCM/RAW member, and Android's MediaRecorder
 * cannot write a PCM container at all — so the app CANNOT hand the coach raw
 * samples straight off the microphone on Android (see docs/coach-capture.md for
 * the verified findings and the wiring options). The audio has to be decoded to
 * PCM somewhere; wherever that happens, the bytes that come back are decoded HERE:
 *
 *   - a future backend decode route (`POST /api/coach/pcm`) returning a WAV
 *     body, or a JSON body carrying base64 PCM16 (both shapes supported), or
 *   - a PCM-capable recorder dependency dropping a .wav on disk.
 *
 * Pure logic, no react-native / expo imports, so it compiles and runs under
 * plain Node (see scripts/coachRun.test.ts). Never throws on bad input without
 * a human-readable reason: a dead end we cannot see is worse than an error we
 * can show.
 */

/** Sample rate the coach runs at. 22.05 kHz is plenty for a monophonic line
 *  whose top note is ~1.5 kHz (see pitchDetection DEFAULT_MAX_FREQ_HZ) and
 *  halves the bytes we move compared with a 44.1 kHz capture. */
export const COACH_TARGET_SAMPLE_RATE = 22050;

/** WAVE format tags we can decode. Anything else is reported, not guessed. */
export const WAVE_FORMAT_PCM = 1;
export const WAVE_FORMAT_IEEE_FLOAT = 3;
export const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

export interface DecodedWav {
  /** Mono, −1…1. Channels are averaged (a stereo take of one instrument). */
  samples: Float32Array;
  sampleRate: number;
  /** Channels found in the file, before downmixing. */
  sourceChannels: number;
  bitsPerSample: number;
}

export interface CoachSamples {
  samples: Float32Array;
  sampleRate: number;
}

/** Raised when bytes are not decodable audio we understand. */
export class WavDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavDecodeError';
  }
}

// ─── base64 ────────────────────────────────────────────────────
const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode standard base64 to bytes WITHOUT atob/Buffer — the same code then runs
 * in Hermes, in the Android WebView-less app runtime and in plain Node.
 * Whitespace/newlines are ignored; '=' padding terminates the stream.
 */
export function bytesFromBase64(base64: string): Uint8Array {
  if (typeof base64 !== 'string') {
    throw new WavDecodeError('No base64 payload to decode.');
  }
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    lookup[B64_ALPHABET.charCodeAt(i)] = i;
  }
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < base64.length; i++) {
    const c = base64.charCodeAt(i);
    const value = c < 256 ? lookup[c] : -1;
    if (value < 0) {
      // Newlines/whitespace are legal in a wrapped base64 body; anything else
      // that is not the padding character is corrupt input.
      if (base64[i] === '=' || base64[i] === '\n' || base64[i] === '\r' || base64[i] === ' ' || base64[i] === '\t') {
        continue;
      }
      throw new WavDecodeError('Audio payload is not valid base64.');
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// ─── PCM → Float32 ─────────────────────────────────────────────
/** Clamp a float to the −1…1 audio range. */
export function clampSample(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

/** One PCM sample (little-endian) → −1…1. `bits` ∈ {8,16,24,32,32f}. */
function readSample(
  view: DataView,
  byteOffset: number,
  bits: number,
  format: number,
): number {
  if (format === WAVE_FORMAT_IEEE_FLOAT) {
    return bits === 64
      ? clampSample(view.getFloat64(byteOffset, true))
      : clampSample(view.getFloat32(byteOffset, true));
  }
  if (bits === 8) {
    // 8-bit WAV is UNSIGNED (128 = silence).
    return clampSample((view.getUint8(byteOffset) - 128) / 128);
  }
  if (bits === 16) {
    return view.getInt16(byteOffset, true) / 32768;
  }
  if (bits === 24) {
    const b0 = view.getUint8(byteOffset);
    const b1 = view.getUint8(byteOffset + 1);
    const b2 = view.getUint8(byteOffset + 2);
    let value = (b2 << 16) | (b1 << 8) | b0;
    if (value & 0x800000) value -= 0x1000000; // sign-extend
    return clampSample(value / 8388608);
  }
  if (bits === 32) {
    return view.getInt32(byteOffset, true) / 2147483648;
  }
  throw new WavDecodeError(`Unsupported PCM bit depth (${bits}-bit).`);
}

/**
 * Decode a RIFF/WAVE buffer to MONO Float32 samples.
 *
 * Supports PCM 8/16/24/32-bit and IEEE float 32/64-bit, any channel count
 * (downmixed by averaging), and tolerates extra chunks (LIST, fact, …) and
 * non-PCM `fmt ` extensions (WAVE_FORMAT_EXTENSIBLE). Rejects compressed WAV
 * (ADPCM/μ-law/MP3-in-WAV) with an explicit message rather than producing
 * noise that would score as a bad performance.
 */
export function decodeWavToFloat32(bytes: Uint8Array): DecodedWav {
  if (!bytes || bytes.byteLength < 12) {
    throw new WavDecodeError('Audio is too short to be a WAV file.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = String.fromCharCode(bytes[0] as number, bytes[1] as number, bytes[2] as number, bytes[3] as number);
  const wave = String.fromCharCode(bytes[8] as number, bytes[9] as number, bytes[10] as number, bytes[11] as number);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new WavDecodeError('Audio is not a WAV file (no RIFF/WAVE header).');
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(
      bytes[offset] as number,
      bytes[offset + 1] as number,
      bytes[offset + 2] as number,
      bytes[offset + 3] as number,
    );
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 16 > bytes.byteLength) {
        throw new WavDecodeError('WAV header is truncated (bad fmt chunk).');
      }
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE hides the real encoding in the first two bytes of
      // the SubFormat GUID, right after the 22-byte extensible extension.
      if (format === WAVE_FORMAT_EXTENSIBLE && body + 26 <= bytes.byteLength) {
        format = view.getUint16(body + 24, true);
      }
    } else if (id === 'data') {
      dataOffset = body;
      // A streamed WAV may carry a bogus/oversized length: keep what we have.
      dataLength = Math.min(size, bytes.byteLength - body);
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  if (!channels || !sampleRate || !bits) {
    throw new WavDecodeError('WAV file has no usable fmt chunk.');
  }
  if (format !== WAVE_FORMAT_PCM && format !== WAVE_FORMAT_IEEE_FLOAT && format !== WAVE_FORMAT_EXTENSIBLE) {
    throw new WavDecodeError(`Unsupported WAV encoding (format tag ${format}) — needs uncompressed PCM.`);
  }
  if (dataOffset < 0 || dataLength <= 0) {
    throw new WavDecodeError('WAV file contains no audio data.');
  }

  const bytesPerSample = Math.ceil(bits / 8);
  const frameBytes = bytesPerSample * channels;
  const frameCount = Math.floor(dataLength / frameBytes);
  if (frameCount <= 0) {
    throw new WavDecodeError('WAV file contains no complete audio frame.');
  }

  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    const base = dataOffset + frame * frameBytes;
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += readSample(view, base + channel * bytesPerSample, bits, format === WAVE_FORMAT_EXTENSIBLE ? WAVE_FORMAT_PCM : format);
    }
    samples[frame] = clampSample(sum / channels);
  }

  return { samples, sampleRate, sourceChannels: channels, bitsPerSample: bits };
}

/** Decode base64 PCM16 little-endian (the compact JSON shape for a decode route). */
export function decodePcm16Base64(base64: string, channels = 1): Float32Array {
  const bytes = bytesFromBase64(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = Math.floor(bytes.byteLength / 2 / Math.max(1, channels));
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += view.getInt16((frame * channels + channel) * 2, true) / 32768;
    }
    out[frame] = clampSample(sum / channels);
  }
  return out;
}

/**
 * Linear-interpolation resampler. Good enough for a monophonic pitch tracker
 * (it slightly attenuates the very top octave, which is above the range we
 * report) and dependency-free, unlike a windowed-sinc resampler.
 */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!samples || samples.length === 0) return new Float32Array(0);
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) {
    return samples.slice();
  }
  if (fromRate === toRate) return samples.slice();

  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = samples[index] ?? 0;
    const b = samples[index + 1] ?? a; // hold the last sample at the tail
    out[i] = clampSample(a + (b - a) * frac);
  }
  return out;
}

/**
 * The single funnel every capture path goes through: mono + coach sample rate.
 * Anything the coach scores came out of here, so the UI can state the rate it
 * actually ran at instead of assuming one.
 */
export function toCoachSamples(
  input: { samples: Float32Array; sampleRate: number },
  targetRate: number = COACH_TARGET_SAMPLE_RATE,
): CoachSamples {
  const mono = input?.samples instanceof Float32Array ? input.samples : new Float32Array(0);
  const rate = Number.isFinite(input?.sampleRate) && input.sampleRate > 0 ? input.sampleRate : 0;
  if (rate === 0) {
    throw new WavDecodeError('Captured audio has no sample rate.');
  }
  return {
    samples: resampleLinear(mono, rate, targetRate),
    sampleRate: targetRate,
  };
}
