/**
 * Tests for POST /api/coach/pcm — the practice-coach audio decode route.
 *
 * These pin the FROZEN contract the app's coachCapture.ts was merged against
 * (PR #93): multipart field `audio`, 200 JSON { success, sampleRate,
 * pcm16Base64, durationSec?, channels? } with little-endian int16 samples,
 * 400 for a missing/unparseable upload, 405 for a non-POST (the app reads
 * 404/405/501/503 as the honest "decoder unavailable" state, so a GET must
 * never look like a working decoder).
 *
 * The decode itself is the SAME one /api/hum uses (fpcalc.decodeToMonoSamples,
 * i.e. `audio-decode` + FAAD2 WASM for AAC); these tests assert the packaging.
 *
 * Run with: bun test src/services/coach-pcm.test.ts
 */
import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { handleCoachPcm, encodePcm16Base64, COACH_TARGET_SAMPLE_RATE } from "./coach-pcm-handler";

/** Minimal 16-bit mono WAV encoder (local copy; mirrors the hum tests). */
function pcmToWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] as number));
    view.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
  }
  return new Uint8Array(buf);
}

/** A deterministic non-silent tone. */
function tone(hz: number, seconds: number, sampleRate: number, amp = 0.6): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/**
 * EXACTLY what the app does with the response — a local mirror of
 * wavCapture.ts decodePcm16Base64 (base64 → Int16LE → Float32/clamp), so a
 * green test here means the frozen app decoder consumes our payload correctly.
 */
function appDecodePcm16Base64(base64: string, channels = 1): Float32Array {
  const bytes = Buffer.from(base64, "base64");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = Math.floor(bytes.byteLength / 2 / Math.max(1, channels));
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += view.getInt16((frame * channels + c) * 2, true) / 32768;
    out[frame] = Math.max(-1, Math.min(1, sum / channels));
  }
  return out;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

function postAudio(bytes: Uint8Array | Buffer, name: string, type: string, method = "POST") {
  const form = new FormData();
  form.append("audio", new File([bytes], name, { type }));
  return handleCoachPcm(new Request("http://localhost/api/coach/pcm", { method, body: form }));
}

describe("/api/coach/pcm — WAV in, PCM16 JSON out", () => {
  test("native-rate mono WAV round-trips sample-for-sample at the coach rate", async () => {
    const source = tone(440, 0.5, COACH_TARGET_SAMPLE_RATE);
    const res = await postAudio(pcmToWav(source, COACH_TARGET_SAMPLE_RATE), "take.wav", "audio/wav");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("json");

    const json = (await res.json()) as {
      success: boolean;
      sampleRate: number;
      pcm16Base64: string;
      durationSec: number;
      channels: number;
    };
    // Contract shape the app requires.
    expect(json.success).toBe(true);
    expect(json.sampleRate).toBe(COACH_TARGET_SAMPLE_RATE);
    expect(json.channels).toBe(1);
    expect(typeof json.pcm16Base64).toBe("string");
    expect(json.pcm16Base64.length).toBeGreaterThan(0);
    expect(typeof json.durationSec).toBe("number");
    expect(json.durationSec).toBeCloseTo(source.length / COACH_TARGET_SAMPLE_RATE, 3);

    // The app's own decoder must see the same waveform we encoded.
    const decoded = appDecodePcm16Base64(json.pcm16Base64, json.channels);
    expect(decoded.length).toBe(source.length);
    let maxError = 0;
    for (let i = 0; i < source.length; i++) {
      maxError = Math.max(maxError, Math.abs(decoded[i]! - source[i]!));
    }
    // 16-bit quantisation error only (|s|/32768 ≤ 3.1e-5).
    expect(maxError).toBeLessThan(1e-4);
    expect(rms(decoded)).toBeGreaterThan(0.1); // non-silent, i.e. real audio came back
  });

  test("44.1 kHz WAV is resampled to the coach rate (half the payload, same duration)", async () => {
    const source = tone(440, 1, 44100);
    const res = await postAudio(pcmToWav(source, 44100), "take44.wav", "audio/wav");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sampleRate: number; pcm16Base64: string; durationSec: number };
    expect(json.sampleRate).toBe(COACH_TARGET_SAMPLE_RATE);
    const decoded = appDecodePcm16Base64(json.pcm16Base64, 1);
    expect(decoded.length).toBeCloseTo(COACH_TARGET_SAMPLE_RATE, -2);
    expect(json.durationSec).toBeCloseTo(1, 1);
    expect(rms(decoded)).toBeGreaterThan(0.1);
  });

  test("encodePcm16Base64 is little-endian int16 (matches the app's byte reader)", () => {
    const encoded = encodePcm16Base64(new Float32Array([0, 1, -1, 0.5]));
    const bytes = Buffer.from(encoded, "base64");
    expect(bytes.length).toBe(8);
    expect(bytes.readInt16LE(0)).toBe(0);
    expect(bytes.readInt16LE(2)).toBe(32767);
    expect(bytes.readInt16LE(4)).toBe(-32768);
    expect(bytes.readInt16LE(6)).toBe(16383);
  });
});

describe("/api/coach/pcm — real .m4a (the app's actual recorder output)", () => {
  // The repo's hum tests read the owner's real on-device captures from this
  // shared fixture dir (they are deliberately NOT committed). Skip honestly if
  // the fixture is absent rather than failing on a machine that lacks it.
  const M4A = "/home/team/shared/gate-test/ondevice-0719-43373e94.m4a";
  const hasFixture = existsSync(M4A);

  test.skipIf(!hasFixture)("AAC/.m4a decodes to non-silent PCM16 at the coach rate", async () => {
    const bytes = await readFile(M4A);
    const res = await postAudio(bytes, "practice.m4a", "audio/mp4");
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      success: boolean;
      sampleRate: number;
      pcm16Base64: string;
      durationSec: number;
      channels: number;
    };
    expect(json.success).toBe(true);
    expect(json.sampleRate).toBe(COACH_TARGET_SAMPLE_RATE);
    expect(json.channels).toBe(1);
    expect(json.durationSec).toBeGreaterThan(0);

    const decoded = appDecodePcm16Base64(json.pcm16Base64, json.channels);
    expect(decoded.length).toBeGreaterThan(COACH_TARGET_SAMPLE_RATE); // > 1s of audio
    expect(rms(decoded)).toBeGreaterThan(0.001); // real, non-silent audio
    console.log(
      `[coach-pcm] real m4a → ${decoded.length} samples, ${json.durationSec.toFixed(2)}s, RMS=${rms(decoded).toFixed(4)}`,
    );
  });
});

/**
 * ── vc62 (D26) ── THE PITCH PASS COMES BACK FROM THE SERVER ──────────────────
 *
 * The app used to run its own YIN pass after this route answered; that pass is
 * what made the read "almost unusable". The route now returns `notes` (the pitch
 * frames) and `timings` (the spans it measured), and these tests pin BOTH:
 *
 *   • the frames match the APP'S OWN tracker, frame for frame, within a tolerance
 *     — the golden table below was produced by running
 *     `musicapp-update/src/services/pitchDetection.ts` (detectPitchFrames) over
 *     the same 1-second fixture at 22.05 kHz. A port that drifted would fail here;
 *   • a silent take still holds no melody (every frame `midi: null`);
 *   • the timings are real measurements, and the caps are untouched.
 */
describe("/api/coach/pcm — vc62: notes + timings", () => {
  /** 0.5 s of A4 then 0.5 s of E5 at the coach rate — the golden fixture. */
  function phrase(): Float32Array {
    const a = tone(440, 0.5, COACH_TARGET_SAMPLE_RATE);
    const b = tone(659.255, 0.5, COACH_TARGET_SAMPLE_RATE);
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  /**
   * REGENERATED FOR vc64 (D39) BY THIS MODULE, NOT BY THE APP:
   * `detectPitchFrames(phrase(), 22050)` over the same fixture, after the band-limit
   * (85 Hz high-pass), the 80–1200 Hz search band and the upward harmonic correction
   * landed. The pass deliberately no longer matches the app's unbanded tracker frame
   * for frame — that divergence IS the fix (the app's pass reported the room). What
   * this table still pins is the frame grid, the level, and the two notes read:
   * A4 (69) then E5 (76). `[tSec, midi, rms]`.
   */
  const GOLDEN: ReadonlyArray<readonly [number, number | null, number]> = [
    [0, 69.002103, 0.424616], [0.024988662131519273, 69.003227, 0.424584], [0.049977324263038546, 69.003234, 0.424550],
    [0.07496598639455783, 69.003234, 0.424516], [0.09995464852607709, 69.003235, 0.424480], [0.12494331065759637, 69.003236, 0.424444],
    [0.14993197278911566, 69.003237, 0.424407], [0.17492063492063492, 69.003238, 0.424369], [0.19990929705215418, 69.003240, 0.424331],
    [0.22489795918367347, 69.003241, 0.424292], [0.24988662131519274, 69.003243, 0.424254], [0.274875283446712, 69.003245, 0.424216],
    [0.2998639455782313, 69.003247, 0.424177], [0.32485260770975055, 69.003250, 0.424139], [0.34984126984126984, 69.003252, 0.424102],
    [0.37482993197278913, 69.003255, 0.424065], [0.39981859410430837, 69.003258, 0.424029], [0.42480725623582766, 69.340243, 0.423611],
    [0.44979591836734695, 56.991556, 0.423593], [0.47478458049886624, 75.497770, 0.423607], [0.4997732426303855, 75.999807, 0.423650],
    [0.5247619047619048, 76.003313, 0.423939], [0.549750566893424, 76.003310, 0.424100], [0.5747392290249433, 76.003310, 0.424278],
    [0.5997278911564626, 76.003312, 0.424455], [0.6247165532879818, 76.003313, 0.424611], [0.6497052154195011, 76.003314, 0.424730],
    [0.6746938775510204, 76.003315, 0.424800], [0.6996825396825397, 76.003316, 0.424812], [0.724671201814059, 76.003317, 0.424766],
    [0.7496598639455783, 76.003317, 0.424667], [0.7746485260770976, 76.003316, 0.424525], [0.7996371882086167, 76.003316, 0.424354],
    [0.824625850340136, 76.003315, 0.424175], [0.8496145124716553, 76.003313, 0.424004], [0.8746031746031746, 76.003312, 0.423861],
    [0.8995918367346939, 76.003311, 0.423762],
  ];

  type Payload = {
    success: boolean;
    pcm16Base64: string;
    notes: Array<{ tSec: number; midi: number | null; rms: number }>;
    timings: { decodeMs: number; pitchMs: number; totalMs: number };
    peak: number;
    rmsDb: number | null;
  };

  test("the frames are the app's own frames (same count, same grid, same pitch)", async () => {
    const source = phrase();
    const res = await postAudio(pcmToWav(source, COACH_TARGET_SAMPLE_RATE), "t.wav", "audio/wav");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Payload;

    expect(Array.isArray(json.notes)).toBe(true);
    expect(json.notes.length).toBe(GOLDEN.length);

    // Same grid, same pitch, same level — within 16-bit quantisation only: the
    // server analyses the PCM16 it returns, which is exactly what the device
    // would have analysed, so a hundredth of a semitone is generous and a drift
    // in the algorithm is not.
    let maxMidiError = 0;
    let maxRmsError = 0;
    for (let i = 0; i < GOLDEN.length; i++) {
      const want = GOLDEN[i]!;
      const got = json.notes[i]!;
      expect(got.tSec).toBeCloseTo(want[0], 5);
      if (want[1] === null) {
        expect(got.midi).toBeNull();
      } else {
        expect(typeof got.midi).toBe("number");
        maxMidiError = Math.max(maxMidiError, Math.abs((got.midi as number) - want[1]));
      }
      maxRmsError = Math.max(maxRmsError, Math.abs(got.rms - want[2]));
    }
    expect(maxMidiError).toBeLessThan(0.01);
    expect(maxRmsError).toBeLessThan(1e-3);

    // …and it really heard the two notes of the phrase (A4 then E5), not silence.
    expect(json.notes[0]!.midi).toBeCloseTo(69, 0);
    expect(json.notes[json.notes.length - 1]!.midi).toBeCloseTo(76, 0);

    // The PCM16 fallback is still there — an older app does its own pass on it.
    expect(json.pcm16Base64.length).toBeGreaterThan(0);
    const decoded = appDecodePcm16Base64(json.pcm16Base64, 1);
    expect(decoded.length).toBe(source.length);
  });

  test("a silent take returns frames with no melody in them", async () => {
    const silence = new Float32Array(COACH_TARGET_SAMPLE_RATE); // 1 s of digital zero
    const res = await postAudio(pcmToWav(silence, COACH_TARGET_SAMPLE_RATE), "s.wav", "audio/wav");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Payload;
    expect(json.notes.length).toBeGreaterThan(0);
    expect(json.notes.every((frame) => frame.midi === null)).toBe(true);
    // …and the level says so too, in the field vc60 added.
    expect(json.peak).toBe(0);
    expect(json.rmsDb).toBeNull();
  });

  test("the timings are measurements, not placeholders", async () => {
    const res = await postAudio(
      pcmToWav(tone(440, 1, COACH_TARGET_SAMPLE_RATE), COACH_TARGET_SAMPLE_RATE),
      "t2.wav",
      "audio/wav",
    );
    const json = (await res.json()) as Payload;
    const { decodeMs, pitchMs, totalMs } = json.timings;
    for (const value of [decodeMs, pitchMs, totalMs]) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    // The pitch pass really ran (a 1-second take is ~37 frames of work), and the
    // total covers the work this route did, not just the last span.
    expect(pitchMs).toBeGreaterThan(0);
    expect(totalMs).toBeGreaterThanOrEqual(decodeMs);
    expect(totalMs).toBeGreaterThanOrEqual(pitchMs);
  });

  test("the caps are unchanged: 4 MB upload, 60 s answer (owner 11-11)", async () => {
    // A 61-second take is truncated to 60 s of PCM and to 60 s of frames — the
    // cap is not raised by the pitch pass, and the answer cannot grow without it.
    const long = tone(440, 61, COACH_TARGET_SAMPLE_RATE);
    const res = await postAudio(pcmToWav(long, COACH_TARGET_SAMPLE_RATE), "long.wav", "audio/wav");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Payload & { durationSec: number; truncated: boolean };
    expect(json.durationSec).toBeCloseTo(60, 1);
    expect(json.truncated).toBe(true);
    const lastFrame = json.notes[json.notes.length - 1]!;
    expect(lastFrame.tSec).toBeLessThan(60);
  });
});

describe("/api/coach/pcm — bad input and method handling", () => {
  test("missing `audio` field → 400", async () => {
    const form = new FormData();
    form.append("notAudio", "hello");
    const res = await handleCoachPcm(
      new Request("http://localhost/api/coach/pcm", { method: "POST", body: form }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { success: boolean; error?: string };
    expect(json.success).toBe(false);
    expect(typeof json.error).toBe("string");
  });

  test("empty file → 400", async () => {
    const res = await postAudio(new Uint8Array(0), "empty.wav", "audio/wav");
    expect(res.status).toBe(400);
  });

  test("garbage bytes (not audio) → 400, not 500", async () => {
    const garbage = Buffer.from("this is definitely not an audio file at all, just text");
    const res = await postAudio(garbage, "garbage.m4a", "audio/mp4");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { success: boolean; error?: string };
    expect(json.success).toBe(false);
    expect(json.error).toBeTruthy();
  });

  test("truncated RIFF header → 400", async () => {
    const res = await postAudio(Buffer.from("RIFFxxxxWAVE"), "broken.wav", "audio/wav");
    expect(res.status).toBe(400);
  });

  test("GET → 405 (the app treats 405 as decoder-unavailable, never as success)", async () => {
    const res = await handleCoachPcm(
      new Request("http://localhost/api/coach/pcm", { method: "GET" }),
    );
    expect(res.status).toBe(405);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(false);
  });
});
