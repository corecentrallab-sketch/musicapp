// Generate two WAV fixtures for the live /api/recognize HTTP smoke test:
//  (a) Für Elise RE-RENDERED as a DIFFERENT rendition (lower gain + 18dB noise)
//      than the stored reference (which was gain 2.0, clean) -> must MATCH.
//  (b) Chopin Nocturne Op.9 No.2 — genuinely unrelated, NOT in the catalog
//      -> must return NO match.
// Run from /home/team/shared/site:  bun run scripts/smoke-gen.ts
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";

const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const ELISE = "/home/team/shared/mutopia-data/fresh5/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.mid";
const CHOPIN = "/home/team/shared/mutopia-data/O9/chopin_nocturne_op9_n2/chopin_nocturne_op9_n2.mid";

async function synthWav(midiPath: string, gain: number, outWav: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "smg-"));
  try {
    writeFileSync(join(dir, "in.mid"), readFileSync(midiPath));
    execSync(`fluidsynth -ni -r 16000 -g ${gain} -F "${outWav}" "${SF2}" "${join(dir, "in.mid")}"`, { timeout: 90000, stdio: "pipe" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function addNoise(wavPath: string, snrDb: number, outPath: string): void { }
async function readMono(wavPath: string): Promise<Float32Array> {
  const dec = await decode(readFileSync(wavPath));
  const ch = dec.channelData;
  if (ch.length === 1) return ch[0];
  const mono = new Float32Array(ch[0].length);
  for (let i = 0; i < mono.length; i++) { let s = 0; for (const c of ch) s += c[i] ?? 0; mono[i] = s / ch.length; }
  return mono;
}
function addNoiseSamples(samples: Float32Array, snrDb: number): Float32Array {
  const out = new Float32Array(samples);
  const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const np = signal / Math.pow(10, snrDb / 10);
  let s = 42; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(np) * 2 * rnd();
  return out;
}
// Write mono Float32 PCM as 16-bit WAV (16kHz)
function writeWav16(path: string, samples: Float32Array, sampleRate = 16000): void {
  const n = samples.length;
  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + n * 2, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buffer);
}
async function main() {
  // (a) Für Elise re-render: lower gain + 18dB noise (DIFFERENT from stored ref)
  const tmpA = join(tmpdir(), "elise_ref.wav");
  await synthWav(ELISE, 0.9, tmpA);
  const aSamples = addNoiseSamples(await readMono(tmpA), 18);
  writeWav16("/tmp/smoke_elise_rerender.wav", aSamples.slice(0, 25 * 16000));
  rmSync(tmpA, { force: true });
  // (b) Unrelated: Chopin Nocturne Op.9 No.2
  const chopinWav = "/tmp/smoke_chopin.wav";
  await synthWav(CHOPIN, 2.0, chopinWav);
  const cSamples = await readMono(chopinWav);
  writeWav16("/tmp/smoke_chopin_trim.wav", cSamples.slice(0, 60 * 16000));
  rmSync(chopinWav, { force: true });
  console.log("done: /tmp/smoke_elise_rerender.wav, /tmp/smoke_chopin_trim.wav");
}
main().catch((e) => { console.error(e); process.exit(1); });
