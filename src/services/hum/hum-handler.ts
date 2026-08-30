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
import type { MelodySkeleton } from "./skeleton";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

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
