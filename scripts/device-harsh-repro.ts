#!/usr/bin/env bun
// device-harsh-repro.ts
// Reproduce the REAL on-device recognition failure with a HARSHER, more
// realistic phone-mic chain than audit-device-emu's gentle default:
//   clean 44.1k -> stronger room reverb -> phone speaker/mic band (HP ~200Hz
//   + LP ~6.5kHz with a mid emphasis bump) -> ADC/AAC encode at low bitrate
//   mono -> room/mic noise at low SNR -> (optional) full 44.1k->16k -> window
// It WRITES the degraded clip as an .m4a FILE so we have a real m4a artifact,
// then runs the EXACT server path: @audio/decode -> mono 16k ->
// extractLandmarks -> matchLandmarks vs LIVE Neon DB. Instrumented to show WHY
// a match fails (query landmark count, matched surface, best cluster, etc.).
//
// Usage: bun scripts/device-harsh-repro.ts [--in wav] [--window 12]
//        [--aac-kbps 64] [--snr 10] [--reverb 1.2] [--lp 6500] [--out m4a]
import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";

const args = process.argv.slice(2);
const get = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const IN = get("in", "/tmp/repro/furelise_clean.wav");
const WINDOW_S = parseFloat(get("window", "12"));
const AAC_KBPS = parseInt(get("aac-kbps", "64"), 10);
const SNR_DB = parseFloat(get("snr", "12"));
const REVERB_GAIN = parseFloat(get("reverb", "1.2"));
const LP = parseInt(get("lp", "6500"), 10);
const OUT = get("out", "/tmp/repro/furelise_harsh.m4a");
const SR = 44100;

function pcmToWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2; const wav = Buffer.allocUnsafe(44 + dataSize);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) { const v = Math.max(-1, Math.min(1, samples[i])); wav.writeInt16LE(v < 0 ? v * 32768 : v * 32767, 44 + i * 2); }
  return wav;
}
// Schroeder reverb with controllable strength (combG + wet gain).
function reverb(x: Float32Array, sampleRate: number, gain: number): Float32Array {
  const combDelays = [1116, 1188, 1277, 1356].map(d => Math.max(1, Math.round(d * sampleRate / 44100)));
  const allpassDelays = [556, 441].map(d => Math.max(1, Math.round(d * sampleRate / 44100)));
  const combG = 0.84, apG = 0.55; const n = x.length;
  const wet = new Float32Array(n);
  for (let c = 0; c < 4; c++) { const D = combDelays[c]; const buf = new Float32Array(D); let bi = 0; for (let i = 0; i < n; i++) { const y = x[i] + combG * buf[bi]; buf[bi] = y; bi = (bi + 1) % D; wet[i] += y; } }
  for (let i = 0; i < n; i++) wet[i] *= 0.25;
  for (let a = 0; a < 2; a++) { const D = allpassDelays[a]; const buf = new Float32Array(D); let bi = 0; let prev = 0; for (let i = 0; i < n; i++) { const insample = wet[i] + apG * prev; const y = -apG * insample + prev; buf[bi] = insample; prev = buf[bi]; bi = (bi + 1) % D; wet[i] = y; } }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (1.0 / (1 + gain)) * x[i] + gain * wet[i];
  let peak = 1e-9; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}
// phone speaker/mic band: gentle highpass + lowpass (one-pole) + mid emphasis bump
function phoneBand(x: Float32Array, sampleRate: number, lpCut: number): Float32Array {
  const out = new Float32Array(x.length);
  // 1st-order highpass at ~200Hz
  const hp = 200; const rcH = 1 / (2 * Math.PI * hp); const dt = 1 / sampleRate; const aH = rcH / (dt + rcH);
  let prevY = 0, prevX = 0;
  for (let i = 0; i < x.length; i++) { const y = aH * (prevY + x[i] - prevX); prevY = y; prevX = x[i]; out[i] = y; }
  // lowpass
  const rc = 1 / (2 * Math.PI * lpCut); const alpha = dt / (rc + dt);
  let lpPrev = out[0];
  for (let i = 1; i < x.length; i++) { lpPrev = lpPrev + alpha * (out[i] - lpPrev); out[i] = lpPrev; }
  return out;
}
function addNoise(samples: Float32Array, snrDb: number, seed: number): Float32Array {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  let sig = 1e-9; for (let i = 0; i < samples.length; i++) sig += samples[i] * samples[i];
  const rms = Math.sqrt(sig / samples.length);
  const noiseRms = rms / Math.pow(10, snrDb / 20);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] + noiseRms * 2 * rnd();
  return out;
}
function resample(x: Float32Array, from: number, to: number): Float32Array {
  const outLen = Math.max(1, Math.round(x.length * to / from)); const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) { const p = (i * from) / to; const l = Math.min(Math.floor(p), x.length - 1); const fr = p - l; const r = Math.min(l + 1, x.length - 1); out[i] = x[l] + (x[r] - x[l]) * fr; }
  return out;
}

async function main() {
  const cleanBuf = readFileSync(IN);
  const cleandec = await decode(cleanBuf);
  let clean: Float32Array;
  if (cleandec.channelData.length === 1) clean = cleandec.channelData[0];
  else { const nc = cleandec.channelData.length; const n = cleandec.channelData[0].length; clean = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of cleandec.channelData) s += c[i] ?? 0; clean[i] = s / nc; } }
  console.log(`clean: rate=${cleandec.sampleRate} ch=${cleandec.channelData.length} len=${clean.length}`);

  let x = clean;
  if (REVERB_GAIN > 0) x = reverb(x, SR, REVERB_GAIN);
  x = phoneBand(x, SR, LP);
  x = addNoise(x, SNR_DB, 42);
  let wavbuf = pcmToWav(x, SR);
  // AAC encode like a phone: mono low bitrate
  const dir = mkdtempSync(join(tmpdir(), "harsh-"));
  const inWav = join(dir, "in.wav"); const m4a = join(dir, "clip.m4a");
  writeFileSync(inWav, wavbuf);
  execSync(`ffmpeg -y -i "${inWav}" -ac 1 -c:a aac -profile:a aac_low -b:a ${AAC_KBPS}k "${m4a}" 2>/dev/null`, { timeout: 60000 });
  const aacBuf = readFileSync(m4a);
  writeFileSync(OUT, aacBuf);
  const aacSize = aacBuf.length;
  rmSync(dir, { recursive: true, force: true });
  console.log(`wrote harsh m4a: ${OUT} (${aacSize} B, aac ${AAC_KBPS}kbps, reverbG=${REVERB_GAIN} snr=${SNR_DB}dB lp=${LP})`);

  // ---- EXACT SERVER PATH ----
  const dec = await decode(aacBuf);
  let mono: Float32Array;
  if (dec.channelData.length === 1) mono = dec.channelData[0];
  else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
  console.log(`decoded harsh: rate=${dec.sampleRate} ch=${dec.channelData.length}`);
  const mono16 = resample(mono, dec.sampleRate as number, 16000);
  const start = Math.floor(0.4 * 16000);
  const end = Math.min(mono16.length, start + Math.floor(WINDOW_S * 16000));
  const win = mono16.slice(start, end);
  console.log(`window: ${(win.length / 16000).toFixed(2)}s at 16k`);

  const lms = extractLandmarks(win, 16000);
  console.log(`query landmarks: ${lms.length}`);
  const raw = await matchLandmarks(lms);
  console.log(`raw candidates: ${raw.length}`);
  for (const m of raw) {
    console.log(`  cand ${m.catalog} ${m.title} conf=${m.confidence.toFixed(3)} votes=${m.overlap_count}`);
  }
  const policy = applyMatchPolicy(raw as { confidence: number }[]);
  console.log(`policy: ${policy.ok ? "OK " + policy.top!.catalog + " conf=" + policy.top!.confidence.toFixed(3) : "NO-MATCH (" + policy.reason + ") " + policy.hint}`);
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
