#!/usr/bin/env bun
// audit-device-emu.ts
// Reproduce the ON-DEVICE recognition failure pattern server-side, by degrading a
// known-good public-domain render to emulate a real phone-mic room capture:
//   44.1k render -> room reverb (Schroeder-style combs) -> speaker/mic lowpass ->
//   mic noise (SNR dB) -> AAC 128k round-trip (the app's codec; the server decodes
//   the m4a with @audio/decode exactly as /api/recognize does) -> mono 16k ->
//   an 8s (or configurable) window -> extractLandmarks -> matchLandmarks vs LIVE DB.
//
// This is the SAME pipeline as the app: the owner got (1) wrong-top Träumerei 0.57,
// (2) no-match, (3) correct Für Elise 0.33 on three retries of a room recording.
// We run N trials (fresh noise seed each) so a single run shows the spread the
// device actually sees, instead of one lucky/unlucky draw.
//
// Usage: bun scripts/audit-device-emu.ts [--window 8] [--trials 3] [--snr 15]
//        [--reverb on] [--aac on] [--lp 9000] [--focus "WoO 59|Op. 15 No. 7"]
import { neon } from "@neondatabase/serverless";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";

const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const MUTOPIA = "/home/team/shared/mutopia-data";

const args = process.argv.slice(2);
const get = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const WINDOW_S = parseFloat(get("window", "8"));
const TRIALS = parseInt(get("trials", "3"), 10);
const SNR_DB = parseFloat(get("snr", "15"));
const REVERB = get("reverb", "on") !== "off";
const AAC = get("aac", "on") !== "off";
const LP = get("lp", "9000") === "off" ? 0 : parseFloat(get("lp", "9000"));
const FOCUS = get("focus", "");

// catalog -> verified-correct Mutopia source (same manifest as the full audit)
const SRC: Record<string, string> = {
  "WoO 59": "fresh5/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.mid",
  "Op. 15 No. 7": "O15/SchumannOp15No07/SchumannOp15No07.mid",
  "Op. 15 No. 1": "O15/SchumannOp15No01/SchumannOp15No01.mid",
  "L. 75": "L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid",
  "Op. 9 No. 1": "O9/nocturne_in_b-flat_minor/nocturne_in_b-flat_minor.mid",
  "Op. 9 No. 2": "O9/chopin_nocturne_op9_n2/chopin_nocturne_op9_n2.mid",
  "Op. 46 No. 4": "fresh5/GriegE/O46/Dans_l_antre_du_roi_de_la_montagne/Dans_l_antre_du_roi_de_la_montagne.mid",
  "Op. 10 No. 1": "O10/chp-10-01/chp-10-01.mid",
};

// deterministic LCG noise
function lcg(seed: number) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; }; }

// --- Schroeder-style room reverb (freeverb-ish combs + allpasses) at 44.1k ---
function reverb(x: Float32Array, sampleRate: number): Float32Array {
  const combDelays = [1116, 1188, 1277, 1356].map(d => Math.max(1, Math.round(d * sampleRate / 44100)));
  const allpassDelays = [556, 441].map(d => Math.max(1, Math.round(d * sampleRate / 44100)));
  const combG = 0.78, apG = 0.5;
  const n = x.length;
  const wet = new Float32Array(n);
  // sum of 4 comb filters
  for (let c = 0; c < 4; c++) {
    const D = combDelays[c]; const buf = new Float32Array(D); let bi = 0;
    for (let i = 0; i < n; i++) { const y = x[i] + combG * buf[bi]; buf[bi] = y; bi = (bi + 1) % D; wet[i] += y; }
  }
  for (let i = 0; i < n; i++) wet[i] *= 0.25;
  // 2 allpasses
  for (let a = 0; a < 2; a++) {
    const D = allpassDelays[a]; const buf = new Float32Array(D); let bi = 0; let prev = 0;
    for (let i = 0; i < n; i++) { const insample = wet[i] + apG * prev; const y = -apG * insample + prev; buf[bi] = insample; prev = buf[bi]; bi = (bi + 1) % D; wet[i] = y; }
  }
  // dry + wet
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.85 * x[i] + 0.35 * wet[i];
  let peak = 1e-9; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

// simple one-pole lowpass (speaker/mic bandwidth roll-off)
function lowpass(x: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const out = new Float32Array(x.length);
  const rc = 1 / (2 * Math.PI * cutoff); const dt = 1 / sampleRate; const alpha = dt / (rc + dt);
  out[0] = x[0];
  for (let i = 1; i < x.length; i++) out[i] = out[i - 1] + alpha * (x[i] - out[i - 1]);
  return out;
}

function addNoise(samples: Float32Array, snrDb: number, seed: number): Float32Array {
  const rnd = lcg(seed);
  const out = new Float32Array(samples);
  const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const np = signal / Math.pow(10, snrDb / 10);
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(np) * 2 * rnd();
  return out;
}

function pcmToWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2; const wav = Buffer.allocUnsafe(44 + dataSize);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) { const v = Math.max(-1, Math.min(1, samples[i])); wav.writeInt16LE(v < 0 ? v * 32768 : v * 32767, 44 + i * 2); }
  return wav;
}

function resample(x: Float32Array, from: number, to: number): Float32Array {
  const outLen = Math.max(1, Math.round(x.length * to / from)); const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) { const p = (i * from) / to; const l = Math.min(Math.floor(p), x.length - 1); const fr = p - l; const r = Math.min(l + 1, x.length - 1); out[i] = x[l] + (x[r] - x[l]) * fr; }
  return out;
}

async function render(midiPath: string, rate: number): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "emu-"));
  const midiFile = join(dir, "in.mid"); const wav = join(dir, "out.wav");
  writeFileSync(midiFile, readFileSync(midiPath));
  execSync(`fluidsynth -ni -r ${rate} -g 2.0 -F "${wav}" "${SF2}" "${midiFile}"`, { timeout: 120000, stdio: "pipe" });
  const buf = readFileSync(wav); const dec = await decode(buf);
  let mono: Float32Array;
  if (dec.channelData.length === 1) mono = dec.channelData[0];
  else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
  rmSync(dir, { recursive: true, force: true });
  let peak = 1e-9; for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  for (let i = 0; i < mono.length; i++) mono[i] /= peak;
  return mono;
}

// Build a degraded device-like clip for one trial. Returns 16k mono Float32Array.
async function deviceClip(midiPath: string, trial: number): Promise<Float32Array> {
  const SR = 44100;
  let x = await render(midiPath, SR); // mono @ 44.1k, normalized
  if (REVERB) x = reverb(x, SR);
  if (LP > 0) x = lowpass(x, SR, LP);
  x = addNoise(x, SNR_DB, 1234 + trial * 1013);
  let buf = pcmToWav(x, SR);
  if (AAC) {
    const dir = mkdtempSync(join(tmpdir(), "aac-"));
    const inWav = join(dir, "in.wav"); const m4a = join(dir, "clip.m4a");
    writeFileSync(inWav, buf);
    execSync(`ffmpeg -y -i "${inWav}" -c:a aac -profile:a aac_low -b:a 128k "${m4a}" 2>/dev/null`, { timeout: 60000 });
    buf = readFileSync(m4a);
    rmSync(dir, { recursive: true, force: true });
  }
  // server decode path: @audio/decode (audio-decode) — identical to fpcalc.decodeToMonoSamples
  const dec = await decode(buf);
  let mono: Float32Array;
  if (dec.channelData.length === 1) mono = dec.channelData[0];
  else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
  const mono16 = resample(mono, dec.sampleRate as number, 16000);
  // take a window ~0.4s in (skip startup click), WINDOW_S long
  const start = Math.floor(0.4 * 16000);
  const end = Math.min(mono16.length, start + Math.floor(WINDOW_S * 16000));
  return mono16.slice(start, end);
}

async function main() {
  const pieces = (await SQL`SELECT DISTINCT p.id, p.catalog, p.title
    FROM piece_landmarks pl JOIN pieces p ON p.id=pl.piece_id`) as unknown as any[];
  const cases = pieces
    .filter((p) => SRC[p.catalog])
    .filter((p) => !FOCUS || p.catalog.includes(FOCUS.split("|")[0]) || p.catalog.includes(FOCUS.split("|")[1] || ""));
  const report: any[] = [];
  let correctTop = 0, wrongTop = 0, noMatch = 0;
  for (const p of cases) {
    const abs = join(MUTOPIA, SRC[p.catalog]);
    if (!existsSync(abs)) continue;
    const trialRows: any[] = [];
    for (let t = 0; t < TRIALS; t++) {
      const mono = await deviceClip(abs, t);
      const lms = extractLandmarks(mono, 16000);
      const raw = await matchLandmarks(lms);
      const top = raw[0] ?? null;
      const self = raw.find((m) => m.piece_id === p.id);
      const label = top && top.piece_id === p.id ? "CORRECT" : top && top.confidence >= 0.3 ? "WRONG-TOP" : "NOMATCH";
      if (label === "CORRECT") correctTop++; else if (label === "WRONG-TOP") wrongTop++; else noMatch++;
      trialRows.push({
        t, queryLms: lms.length,
        top: top ? { cat: top.catalog, title: top.title, conf: Math.round(top.confidence * 1000) / 1000, votes: top.overlap_count } : null,
        self: self ? Math.round(self.confidence * 1000) / 1000 : null,
        label,
      });
      console.log(`t${t} ${p.catalog} (${p.title}) -> ${label} ${top ? top.catalog + " " + top.confidence.toFixed(3) + " self=" + (self ? self.confidence.toFixed(3) : "-") : ""}`);
    }
    report.push({ catalog: p.catalog, title: p.title, trials: trialRows });
  }
  // Controls
  for (const [cn, seed] of [["white-noise", 1], ["sine-sweep", 2]] as const) {
    const len = Math.floor(WINDOW_S * 16000); const c = new Float32Array(len);
    if (cn === "white-noise") { const rnd = lcg(seed * 99); for (let i = 0; i < len; i++) c[i] = rnd() * 0.5; }
    else { for (let i = 0; i < len; i++) { const f = 200 + (i / len) * 3000; c[i] = 0.5 * Math.sin(2 * Math.PI * f * i / 16000); } }
    const gated = (await matchLandmarks(extractLandmarks(c, 16000))).filter((m) => m.confidence >= 0.3);
    report.push({ control: cn, gated: gated.map((m) => ({ cat: m.catalog, conf: m.confidence })) });
  }
  console.log("\n=========== DEVICE-EMU STATS ===========");
  console.log(`window=${WINDOW_S}s trials=${TRIALS} snr=${SNR_DB}dB reverb=${REVERB} aac=${AAC} lp=${LP}`);
  console.log(JSON.stringify({ correctTop, wrongTop, noMatch, report }, null, 1));
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
