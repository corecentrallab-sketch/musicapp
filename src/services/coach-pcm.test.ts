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
