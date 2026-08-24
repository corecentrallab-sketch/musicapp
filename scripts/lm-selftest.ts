// Standalone self-test of the landmark extractor + alignment matcher (no DB).
// Run from /home/team/shared/site: bun run scripts/lm-selftest.ts <midi> [gain]
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import type { Landmark } from "../src/services/landmark";

const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";

async function synth(midiPath: string, gain: number, outDir: string): Promise<Float32Array> {
  writeFileSync(join(outDir, "in.mid"), readFileSync(midiPath));
  const wav = join(outDir, "out.wav");
  execSync(`fluidsynth -ni -r 16000 -g ${gain} -F "${wav}" "${SF2}" "${join(outDir, 'in.mid')}"`, { timeout: 90000, stdio: "pipe" });
  const dec = await decode(readFileSync(wav));
  const ch = dec.channelData;
  if (ch.length === 1) return ch[0];
  const mono = new Float32Array(ch[0].length);
  for (let i = 0; i < mono.length; i++) { let s = 0; for (const c of ch) s += c[i] ?? 0; mono[i] = s / ch.length; }
  return mono;
}

function addNoise(samples: Float32Array, snrDb: number): Float32Array {
  const out = new Float32Array(samples);
  const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const noisePower = signal / Math.pow(10, snrDb / 10);
  const rnd = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; }; })();
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(noisePower) * 2 * rnd();
  return out;
}

function bestAlign(query: Landmark[], ref: Landmark[]): { votes: number; frac: number } {
  const refByHash = new Map<number, number[]>();
  for (const r of ref) {
    let a = refByHash.get(r.hash); if (!a) { a = []; refByHash.set(r.hash, a); } a.push(r.timeCs);
  }
  const deltas: number[] = [];
  for (const q of query) {
    const a = refByHash.get(q.hash); if (!a) continue;
    for (const rt of a) deltas.push(q.timeCs - rt);
  }
  if (deltas.length === 0) return { votes: 0, frac: 0 };
  let min = Infinity, max = -Infinity;
  for (const d of deltas) { if (d < min) min = d; if (d > max) max = d; }
  const BIN = 40;
  const nb = Math.ceil((max - min) / BIN) + 2;
  const hist = new Int32Array(Math.max(1, nb));
  for (const d of deltas) hist[Math.floor((d - min) / BIN)]++;
  let best = 0;
  for (let b = 0; b < hist.length; b++) {
    let s = hist[b];
    if (b - 1 >= 0) s += hist[b - 1];
    if (b + 1 < hist.length) s += hist[b + 1];
    if (s > best) best = s;
  }
  return { votes: best, frac: best / query.length };
}

async function main() {
  const midi = process.argv[2];
  if (!midi) { console.error("usage: lm-selftest.ts <midi>"); process.exit(1); }
  const dir = mkdtempSync(join(tmpdir(), "lm-self-"));
  try {
    // Reference render (production params, gain 2.0)
    const ref = await synth(midi, 2.0, dir);
    const L_ref = extractLandmarks(ref);
    console.log("reference duration_s:", (ref.length / 16000).toFixed(1), "landmarks:", L_ref.length);

    // (a) self-match (bit-identical) -> expect very high frac
    const a = bestAlign(L_ref, L_ref);
    console.log(`[a] self-match: votes=${a.votes} frac=${a.frac.toFixed(3)}`);

    // (b) different rendering: lower gain + noise (real performance-like perturbation)
    const perturbed = addNoise(await synth(midi, 0.9, dir), 18); // ~18 dB SNR noise
    const L_q = extractLandmarks(perturbed);
    const b = bestAlign(L_q, L_ref);
    console.log(`[b] different gain + noise: query landmarks=${L_q.length} votes=${b.votes} frac=${b.frac.toFixed(3)}`);

    // (c) mp3 compression is covered by the ingest/verify pipeline test; skip here.
    // (d) unrelated: deterministic pseudo-music (random notes) -> expect near-zero frac
    const rnd = (() => { let s = 999; return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return s / 0xffffffff; }; })();
    const unrel = new Float32Array(16000 * 25);
    for (let i = 0; i < unrel.length; i++) unrel[i] = (rnd() * 2 - 1) * 0.4;
    const L_u = extractLandmarks(unrel);
    const d = bestAlign(L_u, L_ref);
    console.log(`[d] unrelated noise: query=${L_u.length} votes=${d.votes} frac=${d.frac.toFixed(3)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function toWav(samples: Float32Array, rate: number): Buffer {
  const n = samples.length; const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, samples[i])); b.writeInt16LE(v < 0 ? v * 32768 : v * 32767, 44 + i * 2); }
  return b;
}

main().catch((e) => { console.error(e); process.exit(1); });
