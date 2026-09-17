// ---------------------------------------------------------------------------
// coach-pcm-handler.ts — POST /api/coach/pcm  (practice-coach audio decode)
//
// WHY THIS ROUTE EXISTS
// The app's recorder (expo-av) can only write compressed AAC/.m4a on Android —
// it exposes a file URI, never PCM samples, and AndroidOutputFormat has no
// WAV/LPCM member (see the app's docs/coach-capture.md). So the practice take
// has to be decoded somewhere; the app uploads the .m4a here and gets back the
// mono PCM16 the coach scores.
//
// The app side is ALREADY written and frozen against this contract
// (musicapp-update src/services/coachCapture.ts, merged in PR #93):
//
//   POST /api/coach/pcm
//     multipart/form-data, field `audio` = the recorded .m4a clip
//   200 → JSON { success: true, sampleRate, pcm16Base64, durationSec?, channels? }
//         pcm16Base64 = standard base64 of little-endian signed 16-bit samples
//         channels    = 1 (mono, what we return)
//   400 → missing/empty/unparseable upload (JSON { success: false, error })
//   500 → server-side failure
//   404/405/501/503 → the app shows its honest "decoder unavailable" state, so
//         a non-POST method MUST NOT answer 200 (we return 405).
//
// DECODE REUSE (do not re-implement): the bytes go through the SAME decoder the
// /api/hum and /api/recognize routes use — `decodeToMonoSamples()` in
// ~/services/fpcalc.ts, which wraps the `audio-decode` package. AAC/.m4a support
// there comes from @audio/decode-aac's FAAD2 WASM module, copied beside the
// bundled function entry by build-vercel.sh; there is NO ffmpeg anywhere.
// This route only adds the PCM16 + base64 packaging the app expects.
//
// NOTE ON PRIVACY: this route is decode-and-return. It never writes the upload
// to storage (unlike /api/recognize and /api/hum, whose debug persistence is
// gated behind PERSIST_RECOGNIZE_AUDIO) and never logs the audio bytes.
// ---------------------------------------------------------------------------
import { decodeToMonoSamples } from "~/services/fpcalc.ts";

/** Path the app posts to (mirrors coachCapture.ts COACH_PCM_PATH). */
export const COACH_PCM_PATH = "/api/coach/pcm";

/**
 * Sample rate of the PCM we return. 22.05 kHz matches the app's own coach rate
 * (wavCapture.ts COACH_TARGET_SAMPLE_RATE), so its `toCoachSamples()` funnel is
 * a no-op, and it halves the payload versus a 44.1 kHz capture. Anything above
 * ~1.5 kHz (the top note the pitch tracker reports) survives untouched.
 */
export const COACH_TARGET_SAMPLE_RATE = 22050;

/** Upload cap — same 4 MB the hum/recognize routes accept. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Seconds of audio we return. Vercel caps a function response body (~4.5 MB);
 * base64 costs 4/3 × PCM bytes, so 60 s of 22.05 kHz mono ≈ 3.5 MB — inside the
 * cap with headroom. A practice take is a phrase, not a recital; anything
 * longer is decoded and truncated at the tail, reported honestly via
 * `durationSec` + `truncated`.
 */
const MAX_RETURN_SECONDS = 60;

/** Simple per-IP fixed-window limiter (in-memory; see recognize-handler's note
 *  about DB-backed limits post-launch). Generous: normal coaching never trips it. */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateWindows = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateWindows.get(key);
  if (!entry || now > entry.resetAt) {
    // Bound the map so a flood of distinct IPs cannot grow it forever.
    if (rateWindows.size > 5_000) rateWindows.clear();
    rateWindows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

/**
 * Linear-interpolation resampler (same approach as fpcalc's 16 kHz path and the
 * app's wavCapture.resampleLinear). Cheap, dependency-free, and materially
 * better than the alternative — this signal feeds a monophonic pitch tracker,
 * where the slight top-octave attenuation is above the range we report.
 */
export function resampleMonoLinear(
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
    const fraction = position - index;
    const a = samples[index] ?? 0;
    const b = samples[index + 1] ?? a;
    out[i] = a + (b - a) * fraction;
  }
  return out;
}

/**
 * Encode mono Float32 (−1…1) as little-endian signed 16-bit PCM, base64.
 * This is exactly what the app's `decodePcm16Base64()` reverses: it reads
 * `getInt16(offset, true) / 32768` per frame, so the round-trip is lossless to
 * 1/32768 (and bit-identical after the app's own clamp).
 */
export function encodePcm16Base64(samples: Float32Array): string {
  const buffer = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] ?? 0;
    const clamped = value > 1 ? 1 : value < -1 ? -1 : value;
    // Match fpcalc's pcmToWav scaling exactly, so WAV and JSON paths agree.
    buffer.writeInt16LE(clamped < 0 ? clamped * 32768 : clamped * 32767, i * 2);
  }
  return buffer.toString("base64");
}

/** Decode a recorded practice take into the PCM16 JSON the coach card expects. */
export async function handleCoachPcm(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") {
      // 405 (not 200) so a GET never looks like a working decoder; the app
      // treats 405 as "route not available" and shows its honest state.
      return json({ success: false, error: "Method not allowed. Use POST." }, 405);
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return json({ success: false, error: "Invalid form data" }, 400);
    }

    const audioFile = formData.get("audio");
    if (!audioFile || !(audioFile instanceof File)) {
      return json({ success: false, error: "Missing 'audio' file in form data" }, 400);
    }
    if (audioFile.size === 0) {
      return json({ success: false, error: "Audio file is empty" }, 400);
    }
    if (audioFile.size > MAX_UPLOAD_BYTES) {
      return json({ success: false, error: "Audio file too large" }, 400);
    }

    if (!checkRateLimit(clientKey(req))) {
      return json(
        { success: false, error: "Too many practice takes — wait a moment and try again." },
        429,
      );
    }

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    let mono: Float32Array;
    let sourceSampleRate: number;
    let sourceChannels: number;
    try {
      const decoded = await decodeToMonoSamples(audioBuffer);
      mono = decoded.mono;
      sourceSampleRate = decoded.sampleRate;
      sourceChannels = decoded.channels;
    } catch {
      // Undecodable upload is the client's problem, not a server fault: 400,
      // with a message the card can show verbatim.
      return json(
        {
          success: false,
          error: "Could not decode that practice take — record a few seconds of clear audio and try again.",
        },
        400,
      );
    }

    if (mono.length === 0) {
      return json({ success: false, error: "That recording contains no audio." }, 400);
    }

    // Downmix-to-mono already happened inside decodeToMonoSamples; resample to
    // the coach rate so the payload is half size and the app's funnel is a no-op.
    const resampled = resampleMonoLinear(mono, sourceSampleRate, COACH_TARGET_SAMPLE_RATE);

    const maxSamples = MAX_RETURN_SECONDS * COACH_TARGET_SAMPLE_RATE;
    const truncated = resampled.length > maxSamples;
    const pcm = truncated ? resampled.subarray(0, maxSamples) : resampled;

    const durationSec = pcm.length / COACH_TARGET_SAMPLE_RATE;
    const pcm16Base64 = encodePcm16Base64(pcm);

    console.log(
      `[coach-pcm] decoded ${audioBuffer.length}B → ${pcm.length} samples ` +
        `(${durationSec.toFixed(2)}s @ ${COACH_TARGET_SAMPLE_RATE}Hz mono, ` +
        `source ${sourceSampleRate}Hz/${sourceChannels}ch${truncated ? ", truncated" : ""})`,
    );

    // Contract fields first; the source_* / truncated keys are additive
    // diagnostics the app ignores (coachCapture.ts reads only the five above).
    return json({
      success: true,
      sampleRate: COACH_TARGET_SAMPLE_RATE,
      channels: 1,
      pcm16Base64,
      durationSec,
      sourceSampleRate,
      sourceChannels,
      truncated,
    });
  } catch (err) {
    // Never leak a stack trace to the client; log it for the function logs.
    console.error("[coach-pcm] decode route failed", err);
    return json({ success: false, error: "Could not decode that practice take." }, 500);
  }
}
