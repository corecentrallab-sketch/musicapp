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
//
// ── vc62 (D26) ── THE PITCH PASS COMES FROM HERE NOW ────────────────────────
// The owner: the read is *"almost unusable"*. Measured on this route, not
// guessed: a 78-second take answers in 4.07 s, so the network is not the
// bottleneck — the PHONE is, because after this route returns, the app runs its
// own YIN pass over the whole take (~2,400 period searches, ~4.2 s of solid CPU
// in Node and several times that on a handset). So this route now also returns
//   • `notes`   — the pitch frames the device would have computed, from a PORT of
//                 the app's own tracker (`services/pitchDetection.ts`), so the
//                 client can skip its own pass and get the same frames;
//   • `timings` — { decodeMs, pitchMs, totalMs }, measured here, so the app's
//                 probe card can print real numbers instead of guessing.
// ADDITIVE, and the fallback path is intact: `pcm16Base64` is still returned and
// a client that does not know about `notes` (or cannot reach this route at all)
// still does its own pass on the device — offline is a promised feature.
// The 60-second answer cap and the 4 MB upload cap are UNCHANGED (owner 11-11).
// ---------------------------------------------------------------------------
import { decodeToMonoSamples } from "~/services/fpcalc.ts";
import { detectPitchFrames, type PitchFrame } from "~/services/pitchDetection.ts";

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

/**
 * ── vc60 ── THE LEVEL OF A DECODED TAKE: `{ peak, rmsDb }`.
 *
 * ADDITIVE DIAGNOSTICS, not contract fields: the app's `coachCapture.ts` reads the
 * five contract fields and ignores everything else, so a client that does not know
 * about these is unaffected. They exist so the app can tell "this take held no
 * melody" from "this take held no sound at all" — two different facts with two
 * different sentences — and so the measurement covers any container the server can
 * decode, not only the ones the device's own metering could watch.
 *
 * `peak` is the largest absolute sample (0…1). `rmsDb` is the RMS in dBFS, i.e.
 * <= 0 dBFS, and NULL for a digitally silent take: the logarithm there is
 * -Infinity, and -Infinity is not JSON — a made-up floor number would be worse
 * than saying nothing.
 */
export function decodedLevel(samples: Float32Array): {
  peak: number;
  rmsDb: number | null;
} {
  let peak = 0;
  let sumSquares = 0;
  const count = samples.length;
  for (let i = 0; i < count; i++) {
    const value = Number(samples[i]) || 0;
    const magnitude = value < 0 ? -value : value;
    if (magnitude > peak) peak = magnitude;
    sumSquares += value * value;
  }
  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  return {
    peak: Math.round(peak * 1e6) / 1e6,
    rmsDb: rms > 0 ? Math.round(20 * Math.log10(rms) * 100) / 100 : null,
  };
}

/**
 * ── vc62 (D26) ── THE SPANS THIS ROUTE MEASURED, IN MILLISECONDS.
 *
 * `decodeMs` is the container decode + resample; `pitchMs` is the ported tracker
 * over the PCM we are returning; `totalMs` is the whole request's work here. Real
 * elapsed milliseconds, never an estimate — the app's probe card prints them so
 * the next speed question is aimed by numbers instead of by a guess.
 */
export interface CoachPcmTimings {
  decodeMs: number;
  pitchMs: number;
  totalMs: number;
}

/** Decode a recorded practice take into the PCM16 JSON the coach card expects. */
export async function handleCoachPcm(req: Request): Promise<Response> {
  const requestStartedAt = Date.now();
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
    // ── vc62: the decode span, measured from the moment the bytes are in hand.
    const decodeStartedAt = Date.now();
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
    const decodeMs = Date.now() - decodeStartedAt;

    // ── vc60: THE LEVEL OF WHAT WE DECODED, AS TWO ADDITIVE FIELDS ─────────────
    // WHY. The app has to be able to tell "the take held no melody" apart from
    // "the take held no SOUND" (vc60 spec §2), and it can only do that from a
    // level measurement. The device's own recorder metering covers the .m4a it
    // recorded, but not every container and not every path — this route has the
    // decoded mono in hand here, so the measurement is free and covers any
    // format we can decode. `peak` is the largest absolute sample (0..1);
    // `rmsDb` is the RMS in dBFS (<= 0; null for a digitally silent take, where
    // the log is -Infinity and a number would be a lie).
    const level = decodedLevel(pcm);

    // ── vc62 (D26) ── THE PITCH PASS, HERE, ON THE PCM WE ARE RETURNING ────────
    // WHY. This is the work the phone used to do after the answer arrived, and it
    // is the work that made the read feel unusable: ~2,400 YIN period searches on
    // a 60-second take. The tracker is a PORT of the app's own
    // (`services/pitchDetection.ts`), run over exactly the samples the client
    // receives, at exactly the coach rate — so the frames are the frames the
    // device would have computed, and the client skips its own pass.
    const pitchStartedAt = Date.now();
    const notes: PitchFrame[] = detectPitchFrames(pcm, COACH_TARGET_SAMPLE_RATE);
    const pitchMs = Date.now() - pitchStartedAt;
    const timings: CoachPcmTimings = {
      decodeMs,
      pitchMs,
      totalMs: Date.now() - requestStartedAt,
    };

    console.log(
      `[coach-pcm] decoded ${audioBuffer.length}B → ${pcm.length} samples ` +
        `(${durationSec.toFixed(2)}s @ ${COACH_TARGET_SAMPLE_RATE}Hz mono, ` +
        `source ${sourceSampleRate}Hz/${sourceChannels}ch${truncated ? ", truncated" : ""}) ` +
        `notes=${notes.length} decode=${decodeMs}ms pitch=${pitchMs}ms total=${timings.totalMs}ms`,
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
      // vc60 — additive level of the PCM we are returning (see decodedLevel).
      peak: level.peak,
      rmsDb: level.rmsDb,
      // vc62 — additive: the pitch frames the device would have computed, and the
      // spans this route measured. A client that ignores them still gets the
      // contract fields above and does its own pass on the device.
      notes,
      timings,
    });
  } catch (err) {
    // Never leak a stack trace to the client; log it for the function logs.
    console.error("[coach-pcm] decode route failed", err);
    return json({ success: false, error: "Could not decode that practice take." }, 500);
  }
}
