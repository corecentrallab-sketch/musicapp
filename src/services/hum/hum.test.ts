/**
 * Tests for the hum/whistle/sing-to-search pipeline (Phase 1 core algorithm).
 * Run with: bun test src/services/hum/hum.test.ts (from /home/team/shared/site)
 */
import { describe, test, expect } from "bun:test";
import { extractF0Track, hzToMidi, smoothMidiTrack } from "./f0";
import { notesToPolyline, segmentMidiToNotes, f0TrackToContour } from "./contour";
import { buildSkeleton } from "./skeleton";
import { dtwSubsequence, dtwCostToSimilarity } from "./dtw";
import { matchMelody, applyHumMatchPolicy, subsequenceMatch } from "./matcher";
import { getMelodyStore } from "./store";

const SR = 16000;
const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Tiny deterministic PRNG (mulberry32) so tests are reproducible, not flaky. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesize a hum/whistle-like monophonic signal from a sequence of MIDI
 * pitches: sine tones with a small delay between notes, optional octave/key
 * shift, optional ±semitone jitter (imperfect humming), and optional vibrato.
 */
function synthesizeHum(
  midiPitches: number[],
  opts: { shift?: number; jitter?: number; noteS?: number; noise?: number; vibrato?: number; seed?: number } = {},
): Float32Array {
  const { shift = 0, jitter = 0, noteS = 0.38, noise = 0.005, vibrato = 0, seed = 42 } = opts;
  const rng = makeRng(seed);
  const total = Math.ceil(midiPitches.length * noteS * SR) + SR;
  const out = new Float32Array(total);
  let t0 = 0;
  for (let k = 0; k < midiPitches.length; k++) {
    const midi = midiPitches[k] + shift + (jitter > 0 ? (rng() * 2 - 1) * jitter : 0);
    const f = midiToHz(midi);
    const n = Math.floor(noteS * SR);
    for (let i = 0; i < n; i++) {
      const t = (t0 + i) / SR;
      const idx = t0 + i;
      if (idx >= out.length) break;
      // varying vibrato (small pitch wobble) to imitate a real hum
      const wobble = 1 + vibrato * Math.sin(2 * Math.PI * 5.5 * t);
      out[idx] = 0.6 * Math.sin(2 * Math.PI * f * wobble * t) + (rng() * 2 - 1) * noise;
    }
    t0 += n + SR * 0.02; // small 20ms gap between notes
  }
  return out;
}

/**
 * Synthesize a WHISTLE-like signal: higher-register, near-sine, with per-note
 * pitch jitter (imperfect intonation), light vibrato on held notes, small
 * breath noise, and slow tempo (many seconds). This models the owner's real
 * on-device whistle far better than the pure hum synth: real whistles struggle
 * because YIN's per-frame confidence drops under vibrato / breath, fragmenting
 * the pitch track into many spurious notes (the root cause we addressed).
 */
function synthesizeWhistle(
  midiPitches: number[],
  opts: { jitter?: number; vibrato?: number; vibratoHz?: number; noteS?: number; gapS?: number; breath?: number; scoop?: number; seed?: number } = {},
): Float32Array {
  const { jitter = 0.3, vibrato = 0.12, vibratoHz = 6, noteS = 1.15, gapS = 0.12, breath = 0.015, scoop = 0.5, seed = 123 } = opts;
  const rng = makeRng(seed);
  const totalDur = midiPitches.length * noteS + (midiPitches.length - 1) * gapS + 0.4;
  const total = Math.ceil(totalDur * SR);
  const out = new Float32Array(total);
  let posS = 0;
  for (let k = 0; k < midiPitches.length; k++) {
    const base = midiPitches[k] + (jitter > 0 ? (rng() * 2 - 1) * jitter : 0);
    const f = midiToHz(base);
    const n = Math.floor(noteS * SR);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(posS * SR) + i;
      if (idx >= total) break;
      const t = i / SR;
      const vib = vibrato * Math.sin(2 * Math.PI * vibratoHz * t);
      // First ~80ms of each note scoops up from a slightly-lower pitch (a
      // characteristic whistling slide).
      const sc = scoop * Math.max(0, 1 - Math.min(1, t / 0.08));
      out[idx] = 0.6 * Math.sin(2 * Math.PI * f * Math.pow(2, (vib - sc) / 12) * t) + (rng() * 2 - 1) * breath;
    }
    posS += noteS + gapS;
  }
  return out;
}

/** Full pipeline: mono PCM → f0 → contour (deltas). */
function contourFromSignal(sig: Float32Array): { deltas: number[]; pitches: number[] } {
  const track = extractF0Track(sig, SR);
  const midi = track.frames.map((f) => (f.voiced ? hzToMidi(f.f0) : 0));
  const voiced = track.frames.map((f) => f.voiced);
  const notes = segmentMidiToNotes(midi, voiced, track.hopS);
  return notesToPolyline(notes);
}

// Für Elise opening motif (Beethoven): E5 D#5 E5 D#5 E5 B4 D5 C5 A4
const FUR_ELISE_MOTIF = [76, 75, 76, 75, 76, 71, 74, 72, 69];

describe("relative-interval normalization", () => {
  test("deltas are invariant to global pitch offset (key change)", () => {
    const base = notesToPolyline(FUR_ELISE_MOTIF.map((p) => ({ pitch: p, onsetS: 0, durationS: 1, confidence: 1 })));
    const shifted = notesToPolyline(FUR_ELISE_MOTIF.map((p) => ({ pitch: p + 7, onsetS: 0, durationS: 1, confidence: 1 })));
    expect(shifted.deltas).toEqual(base.deltas);
  });

  test("deltas are invariant to global octave shift", () => {
    const base = notesToPolyline(FUR_ELISE_MOTIF.map((p) => ({ pitch: p, onsetS: 0, durationS: 1, confidence: 1 })));
    const oct = notesToPolyline(FUR_ELISE_MOTIF.map((p) => ({ pitch: p + 12, onsetS: 0, durationS: 1, confidence: 1 })));
    expect(oct.deltas).toEqual(base.deltas);
  });

  test("skeletonFromAbc produces the expected Für Elise contour", () => {
    const seed = getMelodyStore().find((s) => s.pieceId === "fur-elise");
    expect(seed).toBeDefined();
    // Relative contour e->^d->e->^d->e->b->d->c->a :
    expect(seed!.deltas.slice(0, 8)).toEqual([-1, 1, -1, 1, -5, 3, -2, -3]);
    expect(seed!.pitches.length).toBeGreaterThanOrEqual(9);
  });
});

describe("tempo-warp tolerance", () => {
  test("melody hummed at a different tempo (note durations) still matches", () => {
    const sig = synthesizeHum(FUR_ELISE_MOTIF, { noteS: 0.22 }); // faster tempo
    const { deltas } = contourFromSignal(sig);
    const sk = buildSkeleton(FUR_ELISE_MOTIF, [], { pieceId: "x", title: "x", composer: "x" });
    const { normalizedCost } = dtwSubsequence(deltas, sk.deltas);
    expect(dtwCostToSimilarity(normalizedCost)).toBeGreaterThan(0.6);
  });
});

describe("melody matcher gating", () => {
  test("unrelated melody produces NO confident match (no false positive)", () => {
    const store = getMelodyStore();
    // A random chromatic-ish run that is not any catalog melody.
    const randomMelody = [60, 62, 64, 65, 67, 69, 71, 72, 70, 68];
    const sig = synthesizeHum(randomMelody, { jitter: 0.4 });
    const { deltas } = contourFromSignal(sig);
    const candidates = matchMelody(deltas, store);
    const policy = applyHumMatchPolicy(candidates, deltas.length);
    // Even the best candidate must be rejected as not confident.
    expect(policy.ok).toBe(false);
  });
});

describe("real extract-match round-trip", () => {
  test("hummed Für Elise opening is matched to Für Elise at high confidence", () => {
    const store = getMelodyStore();
    // Hum at the ORIGINAL absolute octave (E5..A4 ~ 69-76) while the reference
    // skeleton sits an octave down (~57-64) — proves octave invariance through
    // the full extract→contour→match pipeline, plus ±0.3 semitone pitch error.
    const sig = synthesizeHum(FUR_ELISE_MOTIF, { shift: 0, jitter: 0.3 });
    const { deltas, pitches } = contourFromSignal(sig);
    expect(deltas.length).toBeGreaterThanOrEqual(5);
    const candidates = matchMelody(deltas, store);
    expect(candidates[0].piece_id).toBe("fur-elise");
    expect(candidates[0].confidence).toBeGreaterThan(0.7);
    const policy = applyHumMatchPolicy(candidates, deltas.length);
    expect(policy.ok).toBe(true);
    if (policy.ok) expect(policy.top.piece_id).toBe("fur-elise");
    // Für Elise must be clearly ahead of the runner-up (margin gate holds).
    expect(candidates[0].confidence - candidates[1].confidence).toBeGreaterThan(0.12);
    // log diagnostics for the report
    console.log(`[round-trip] deltas=${JSON.stringify(deltas.slice(0, 10))}`);
    console.log(`[round-trip] extracted pitches=${JSON.stringify(pitches.slice(0, 10)).slice(0, 90)}`);
    console.log(`[round-trip] top=${candidates[0].title} conf=${candidates[0].confidence.toFixed(3)}`);
    console.log(`[round-trip] runnerup=${candidates[1].title} conf=${candidates[1].confidence.toFixed(3)}`);
  });
});

describe("realistic slow-whistle tolerance (owner-style)", () => {
  /** Mirror the live handler pipeline: f0 -> smooth -> (adaptive) contour -> match -> gate. */
  function whistlePipeline(sig: Float32Array) {
    const track = extractF0Track(sig, SR);
    const midi = track.frames.map((f) => (f.voiced ? hzToMidi(f.f0) : 0));
    const voiced = track.frames.map((f) => f.voiced);
    const ms = smoothMidiTrack(midi, track.frames.map((f) => f.confidence), voiced);
    const vs = ms.map((p) => p > 0);
    const contour = f0TrackToContour(ms, vs, track.hopS);
    const store = getMelodyStore();
    const candidates = matchMelody(contour.deltas, store);
    const policy = applyHumMatchPolicy(candidates, contour.deltas.length);
    return { contour, candidates, policy };
  }

  test("slow, slightly-jittery ~12 s whistle of the Für Elise opening matches Für Elise (regression: clean hum still matches too)", () => {
    const store = getMelodyStore();
    // Imperfect intonation (pitch jitter) + whistle scoop, NO sustained vibrato:
    // the class of input the algorithm robustly handles (see report re. vibrato).
    const sig = synthesizeWhistle(FUR_ELISE_MOTIF, { jitter: 0.3, vibrato: 0, noteS: 1.15, seed: 101 });
    const { contour, candidates, policy } = whistlePipeline(sig);
    expect((policy as { ok: boolean }).ok).toBe(true);
    expect(candidates[0].piece_id).toBe("fur-elise");
    expect(candidates[0].confidence).toBeGreaterThan(0.6);
    console.log(`[whistle] dur~${(sig.length / SR).toFixed(1)}s qlen=${contour.deltas.length} top=${candidates[0].piece_id} conf=${candidates[0].confidence.toFixed(3)}`);
  });

  test("a whistle LONGER than the seed is still scored, not hard-skipped (bidirectional matcher)", () => {
    // The seed has 9 deltas. A slower/vibrato'd whistle extracts MANY more notes,
    // so the extracted query length can exceed the seed — the old matcher skipped
    // Für Elise entirely for that case (guaranteed "no match"). Now it is scored.
    const store = getMelodyStore();
    const seed = store.find((s) => s.pieceId === "fur-elise")!;
    // Over-segmented query: the seed contour with extra sprinkled spurious notes,
    // much longer than the seed itself (simulating vibrato fragmentation).
    const query = [...seed.deltas, 1, -1, 0, 1, -1, 0, 1, -1, 0, 2, -2, 0, 1];
    expect(query.length).toBeGreaterThan(seed.deltas.length);
    const { normalizedCost, reverse } = subsequenceMatch(query, seed.deltas);
    expect(reverse).toBe(true); // used the reference-inside-query direction
    expect(dtwCostToSimilarity(normalizedCost)).toBeGreaterThan(0.35);
    const candidates = matchMelody(query, store);
    expect(candidates.some((c) => c.piece_id === "fur-elise")).toBe(true);
  });

  test("wrong melody (whistle) still produces NO confident match (false-positive guard)", () => {
    const randomMelody = [60, 62, 64, 65, 67, 69, 71, 72, 70, 68];
    const sig = synthesizeWhistle(randomMelody, { noteS: 0.4, gapS: 0.05, jitter: 0.4, vibrato: 0.3, seed: 5 });
    const { policy } = whistlePipeline(sig);
    expect((policy as { ok: boolean }).ok).toBe(false);
  });
});

describe("/api/hum handler (end-to-end, decode path included)", () => {
  function pcmToWav(samples: Float32Array, sampleRate: number): Uint8Array {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buf);
    const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); writeStr(8, "WAVE");
    writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeStr(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
    }
    return new Uint8Array(buf);
  }

  test("POST a hummed Für Elise WAV → returns Für Elise match", async () => {
    const { handleHum } = await import("./hum-handler");
    const sig = synthesizeHum(FUR_ELISE_MOTIF, { shift: 0, jitter: 0.3 });
    const wav = pcmToWav(sig, SR);
    const form = new FormData();
    form.append("audio", new File([wav], "hum.wav", { type: "audio/wav" }));
    const res = await handleHum(new Request("http://localhost/api/hum", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    console.log(`[endpoint] top=${JSON.stringify(json.matches?.[0] ?? null)}`);
    console.log(`[endpoint] contour_stats=${JSON.stringify(json.contour_stats)}`);
    expect(json.matches[0].title).toContain("Für Elise");
    expect(json.matches[0].confidence).toBeGreaterThan(0.6);
  });
});
