#!/usr/bin/env bun
// Generate a GENUINELY NON-CATALOG audio fixture for the no-match / false-positive
// smoke test. This is an ORIGINAL melody (not any piece in the 113-piece public-domain
// catalog), synthesized with fuzzy harmonics to generate plenty of spectral-peak
// landmarks, then a WAV is written. The recognize endpoint must return NO match.
import { writeFileSync } from "node:fs";
const SR = 16000;
function noteFreq(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }
// Original motif — deliberately un-catalogued (an invented phrase, not a real opus).
// [midi, beats]
const MOTIF: [number, number][] = [
  [72, 1], [76, 1], [79, 2], [74, 1], [77, 1], [71, 2],
  [69, 1], [72, 1], [76, 2], [71, 1], [74, 1], [79, 2],
  [81, 1], [78, 1], [75, 2], [72, 1], [67, 1], [64, 3],
];
const BPM = 96; const beatS = 60 / BPM;
function synth(): Float32Array {
  let total = 0; for (const [, b] of MOTIF) total += b * beatS;
  const n = Math.floor(total * SR); const out = new Float32Array(n);
  let t0 = 0;
  for (const [m, b] of MOTIF) {
    const dur = b * beatS; const f = noteFreq(m); const start = Math.floor(t0 * SR); const len = Math.floor(dur * SR);
    for (let i = 0; i < len && start + i < n; i++) {
      const tt = i / SR; const env = Math.min(1, tt / 0.02) * Math.exp(-3 * tt / dur);
      // fundamental + 3 partials (rich spectrum => landmark peaks)
      let s = Math.sin(2 * Math.PI * f * tt)
        + 0.5 * Math.sin(2 * Math.PI * 2 * f * tt)
        + 0.25 * Math.sin(2 * Math.PI * 3 * f * tt)
        + 0.12 * Math.sin(2 * Math.PI * 4 * f * tt);
      out[start + i] += 0.25 * env * s;
    }
    t0 += dur;
  }
  return out;
}
function writeWav16(path: string, samples: Float32Array, sr = SR): void {
  const n = samples.length; const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { let v = Math.max(-1, Math.min(1, samples[i])); b.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
  writeFileSync(path, b);
}
const s = synth();
writeWav16("/tmp/smoke_nomatch_original.wav", s);
console.log("done: /tmp/smoke_nomatch_original.wav  dur_s=", (s.length / SR).toFixed(1), "samples=", s.length, "peak=", Math.max(...s));
