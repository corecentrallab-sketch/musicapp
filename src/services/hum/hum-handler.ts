// ---------------------------------------------------------------------------
// hum-handler.ts — POST /api/hum  (hum/whistle/sing-to-search)
//
// Transcribes a monophonic hummed/whistled/sung melody into a relative-interval
// pitch contour and matches it against the melody-skeleton database, tolerant
// of key/pitch offset, octave, and tempo drift. The Tier-1 SoundHound-style
// differentiator.
//
// Input:  multipart/form-data with an `audio` file (.m4a/.wav/.ogg — same
//         upload as /api/recognize).
// Output: { success, matches: [{piece_id,title,composer,confidence}], ... }
//         honoring the "no confident-wrong" gate (empty matches = honest
//         no-match, never a wrong title).
// ---------------------------------------------------------------------------
import { decodeToMonoSamples } from "~/services/fpcalc.ts";
import { extractF0Track, hzToMidi, smoothMidiTrack } from "./f0";
import { f0TrackToContour } from "./contour";
import { matchMelody, applyHumMatchPolicy } from "./matcher";
import { getMelodyStore, loadSkeletonsFromNeon } from "./store";
import { evaluateCaptureQuality, QUALITY_REASONS } from "./hum-quality";
import { uploadScore } from "~/services/storage";
import { createHash } from "node:crypto";
import type { MelodySkeleton } from "./skeleton";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Debug-gated persistence of the raw received hum/whistle upload.
//
// Mirrors /api/recognize (see recognize-handler.ts): when
// PERSIST_RECOGNIZE_AUDIO=true (default OFF, so normal operation never pays for
// storage), each successful upload to /api/hum is ALSO written to Cloudflare R2
// under a `debug/` prefix — `debug/hum-<unixms>-<hash8>.m4a` — so genuine
// phone-mic whistle/hum recordings can be reviewed post-hoc to inspect the
// extracted pitch contour versus the reference seed (closed-test gate: the
// owner's real whistle isn't landing on the Für Elise seed; we need the actual
// bytes to tune the matcher).
//
// A failed debug write never breaks the hum path: it is logged and swallowed.
// The audio bytes are written only to the object storage key above — never
// logged or echoed back in any response.
// ---------------------------------------------------------------------------
const PERSIST_HUM_AUDIO = process.env.PERSIST_RECOGNIZE_AUDIO === "true";
/** Write the raw received audio to R2 under debug/ (best-effort, never throws). */
async function persistHumAudio(audioBuffer: Buffer): Promise<void> {
  if (!PERSIST_HUM_AUDIO) return;
  try {
    const hash = createHash("sha256").update(audioBuffer).digest("hex").slice(0, 8);
    // `.m4a` because the app uploads m4a (AAC) and the container is mp4-family
    // (same convention as /api/recognize's debug captures).
    const key = `debug/hum-${Date.now()}-${hash}.m4a`;
    await uploadScore(key, audioBuffer, "audio/mp4");
    console.log(`[hum] persisted received audio -> ${key} (${audioBuffer.length}B)`);
  } catch (err) {
    // Debug write must never degrade the hum path — log and continue.
    // (audioBuffer is intentionally NOT logged.)
    console.error("[hum] failed to persist received audio (continuing):", err);
  }
}

function corsResponse(body: unknown, init?: { status?: number }): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

export async function handleHum(req: Request): Promise<Response> {
  const startTime = performance.now();
  // --- Parse upload (same contract as /api/recognize) ---
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return corsResponse({ success: false, error: "Invalid form data" }, { status: 400 });
  }
  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof File)) {
    return corsResponse({ success: false, error: "Missing 'audio' file in form data" }, { status: 400 });
  }
  if (audioFile.size === 0) {
    return corsResponse({ success: false, error: "Audio file is empty" }, { status: 400 });
  }
  if (audioFile.size > MAX_UPLOAD_BYTES) {
    return corsResponse({ success: false, error: "Audio file too large" }, { status: 400 });
  }

  const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
  // Debug-gated: persist the raw upload to R2 (best-effort, never blocks/breaks)
  // BEFORE decoding, so the original bytes are preserved for offline tuning.
  await persistHumAudio(audioBuffer);

  // --- Decode to mono PCM ---
  let mono: Float32Array;
  let sampleRate: number;
  try {
    const decoded = await decodeToMonoSamples(audioBuffer);
    mono = decoded.mono;
    sampleRate = decoded.sampleRate;
  } catch {
    return corsResponse(
      { success: false, error: "Could not decode audio — ensure it contains an audible melody" },
      { status: 400 },
    );
  }

  // --- Pitch-contour extraction: f0 → MIDI → smooth → notes → intervals ---
  const track = extractF0Track(mono, sampleRate);
  const midiRaw = track.frames.map((f) => (f.voiced ? hzToMidi(f.f0) : 0));
  const voiced = track.frames.map((f) => f.voiced);
  const midiSmooth = smoothMidiTrack(midiRaw, track.frames.map((f) => f.confidence), voiced);
  const voicedSmoothed = midiSmooth.map((p) => p > 0);
  const contour = f0TrackToContour(midiSmooth, voicedSmoothed, track.hopS);
  const queryDeltas = contour.deltas;

  // --- Capture-quality guard ---
  // A bad take (over-driven mic, room noise, continuous pitch-glide, mains-hum
  // bleed) does not carry a clean stepped melody; no matcher threshold can
  // recover it. When the guard trips we short-circuit BEFORE matching and tell
  // the user the input was unclear and how to fix it — and we never name a
  // piece. A clean-but-simply-weak take passes through untouched to the normal
  // single-match/no-match gate below. All signals use data already extracted
  // here (the delta/note contour + the per-frame f0 track) — no extra compute.
  const quality = evaluateCaptureQuality(contour, track);
  if (quality.inputUnclear) {
    const reason = quality.reasons.includes(QUALITY_REASONS.WIDE_PITCH_RANGE)
      ? quality.reasons.includes(QUALITY_REASONS.UNSTABLE_PITCH)
        ? "Your recording captured unstable, jumping pitch — please move closer to the mic, head to a quieter room, and record a steady, slower, clearly-phrased melody, then try again."
        : "Your recording's pitch wandered too widely to be a steady melody — please move closer to the mic, head to a quieter room, and record a steady, slower phrase, then try again."
      : "Your recording didn't capture a clear melody — please move closer, find a quieter room, and record a steady, slower phrase, then try again.";
    return corsResponse({
      success: true,
      matches: [],
      input_unclear: true,
      input_unclear_reasons: quality.reasons,
      message: reason,
      hint: reason,
      query_duration_ms: Math.round(performance.now() - startTime),
      quality: {
        notes: quality.notes,
        max_abs_delta: quality.maxAbsDelta,
        voiced_frames: quality.voicedFrames,
        voiced_f0_span_octaves: quality.voicedF0SpanOctaves,
        low_f0_ratio: quality.lowF0Ratio,
      },
    });
  }

  // --- Load skeletons (DB-backed when available, else bundled seeds) ---
  let store: MelodySkeleton[] = getMelodyStore();
  const neonStore = await loadSkeletonsFromNeon();
  if (neonStore && neonStore.length > 0) store = neonStore;

  // --- Match + gate (no confident-wrong) ---
  const candidates = matchMelody(queryDeltas, store);
  const policy = applyHumMatchPolicy(candidates, queryDeltas.length);

  const response: Record<string, unknown> = {
    success: true,
    matches: policy.ok ? policy.matches.map((m) => ({
      piece_id: m.piece_id,
      title: m.title,
      composer: m.composer,
      confidence: Math.round(m.confidence * 100) / 100,
    })) : [],
    query_duration_ms: Math.round(performance.now() - startTime),
    db_available: true,
    contour_stats: {
      notes: contour.notes.length,
      deltas: queryDeltas.length,
      voiced_frames: voiced.filter(Boolean).length,
      total_frames: voiced.length,
      extracted_pitches: contour.pitches.slice(0, 16),
      extracted_deltas: queryDeltas.slice(0, 16),
    },
  };
  if (!policy.ok && policy.hint) response.no_confident_match_reason = policy.hint;
  return corsResponse(response);
}
