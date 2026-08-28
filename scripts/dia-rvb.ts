#!/usr/bin/env bun
// dia-rvb.ts — dense convolution-reverb device reproduction. The most faithful
// room model available without a real phone: clean 44.1k -> ffmpeg afir with a
// dense exponentially-decaying noise IR (wet/dry mix) -> broadband room noise ->
// AAC mono -> naive 44.1k->16k (the server path, which has NO anti-aliasing).
// Routes through extractLandmarks + matchLandmarks vs LIVE DB.
// Usage: bun scripts/dia-rvb.ts [--wet 0.9] [--snr 10] [--aac 96] [--window 12]
import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";
import { writeFile as wf, mkdtemp as mk } from "node:fs/promises";

const args = process.argv.slice(2);
const get = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const IN = get("in", "/tmp/repro/furelise_clean.wav");
const DRY = parseFloat(get("dry", "0.4"));
const WET = parseFloat(get("wet", "0.9"));
const SNR_DB = parseFloat(get("snr", "10"));
const AAC = parseInt(get("aac", "96"), 10);
const WINDOW_S = parseFloat(get("window", "12"));
const IR = get("ir", "/tmp/repro/room_ir.wav");
const OUT = get("out", "/tmp/repro/furelise_room.m4a");

function resample(x: Float32Array, from: number, to: number): Float32Array {
  const outLen = Math.max(1, Math.round(x.length * to / from)); const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) { const p = (i * from) / to; const l = Math.min(Math.floor(p), x.length - 1); const fr = p - l; const r = Math.min(l + 1, x.length - 1); out[i] = x[l] + (x[r] - x[l]) * fr; }
  return out;
}
function addNoise(samples: Float32Array, snrDb: number, seed: number): Float32Array {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  let acc = 1e-9; for (let i = 0; i < samples.length; i++) acc += samples[i] * samples[i];
  const rms = Math.sqrt(acc / samples.length); const nr = rms / Math.pow(10, snrDb / 20);
  const out = new Float32Array(samples.length); for (let i = 0; i < samples.length; i++) out[i] = samples[i] + nr * 2 * rnd();
  return out;
}

async function main() {
  const dir = await mk("/tmp/repro/rvb-");
  const dirName = dir;
  const roomed = join(dirName, "roomed.wav");   // dry+wet
  const mixed = join(dirName, "mixed.wav");     // + noise
  // dry + wet via ffmpeg afir
  execSync(`ffmpeg -y -i "${IN}" -i "${IR}" -filter_complex "[0:a][1:a]afir=dry=${DRY.toFixed(3)}:wet=${WET.toFixed(3)}" -ac 1 -ar 44100 "${roomed}" 2>/dev/null`, { timeout: 180000 });
  console.log("roomed written");
  // convert to float samples, NORMALIZE to loud (phone AGC), add noise, write back
  const { default: dec1 } = await import("audio-decode");
  const db = await dec1(readFileSync(roomed));
  let x = db.channelData[0];
  let peak = 1e-9; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const norm = peak > 1e-9 ? 0.9 / peak : 1.0;
  for (let i = 0; i < x.length; i++) x[i] *= norm;
  x = addNoise(x, SNR_DB, 99);
  // write pcm16 wav
  const dataSize = x.length * 2; const wav = Buffer.allocUnsafe(44 + dataSize);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(44100 * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < x.length; i++) { const v = Math.max(-1, Math.min(1, x[i])); wav.writeInt16LE(v < 0 ? v * 32768 : v * 32767, 44 + i * 2); }
  await wf(mixed, wav);
  // AAC mono encode -> OUT (the real .m4a artifact)
  execSync(`ffmpeg -y -i "${mixed}" -ac 1 -c:a aac -profile:a aac_low -b:a ${AAC}k "${OUT}" 2>/dev/null`, { timeout: 60000 });
  const aacBuf = readFileSync(OUT);
  console.log(`wrote ${OUT} (${aacBuf.length} B, aac ${AAC}k, wet=${WET} snr=${SNR_DB}dB)`);
  rmSync(dirName, { recursive: true, force: true });
  // server path: decode -> naive 44.1->16k -> window -> extract -> match
  const dec = await dec1(aacBuf);
  let mono: Float32Array = dec.channelData[0];
  console.log(`decoded: rate=${dec.sampleRate} ch=${dec.channelData.length}`);
  const mono16 = resample(mono, dec.sampleRate as number, 16000);
  const start = Math.floor(0.4 * 16000);
  const end = Math.min(mono16.length, start + Math.floor(WINDOW_S * 16000));
  const win = mono16.slice(start, end);
  const lms = extractLandmarks(win, 16000);
  console.log(`query landmarks: ${lms.length}`);
  const raw = await matchLandmarks(lms);
  console.log(`raw candidates: ${raw.length}`);
  for (const m of raw) console.log(`  cand ${m.catalog} ${m.title} conf=${m.confidence.toFixed(3)} votes=${m.overlap_count}`);
  const policy = applyMatchPolicy(raw as { confidence: number }[]);
  console.log(`policy: ${policy.ok ? "OK " + (policy.top as any).catalog + " conf=" + (policy.top as any).confidence.toFixed(3) : "NO-MATCH (" + policy.reason + ") " + policy.hint}`);
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
