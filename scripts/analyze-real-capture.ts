#!/usr/bin/env bun
// analyze-real-capture.ts — one-stop diagnostic for a REAL phone-mic capture
// persisted from /api/recognize (R2 debug/ prefix) or any local audio file.
//
// It (1) decodes and reports waveform stats so you can tell at a glance whether
// the recording is silent (0 landmarks) or degraded, and (2) runs BOTH the
// classic and the robust landmark extractor against the LIVE landmark DB with
// the exact /api/recognize match policy — so a genuine capture's outcome is
// reproduced locally and the reason for a failure is visible (query landmark
// count, top candidates, confidences, votes, policy decision).
//
// Usage:
//   bun scripts/analyze-real-capture.ts /path/to/capture.m4a [--window 12]
// Requires DATABASE_URL and (optionally) R2 creds are NOT needed — only the DB.
import { readFileSync } from "node:fs";
import decode from "audio-decode";
import { extractLandmarks, extractLandmarksRobust } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";

const args = process.argv.slice(2);
const FILE = args.find((a) => !a.startsWith("--")) ?? process.argv[1];
const wi = args.indexOf("--window");
const WINDOW_S = wi >= 0 ? parseFloat(args[wi + 1]) : 12;

function db(x: number) { return 20 * Math.log10(Math.max(x, 1e-9)); }
function resample(x: Float32Array, from: number, to: number): Float32Array {
  const outLen = Math.max(1, Math.round((x.length * to) / from));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const p = (i * from) / to;
    const l = Math.min(Math.floor(p), x.length - 1);
    const fr = p - l;
    const r = Math.min(l + 1, x.length - 1);
    out[i] = x[l] + (x[r] - x[l]) * fr;
  }
  return out;
}
function stats(x: Float32Array) {
  const n = x.length;
  let peak = 0, sumSq = 0, clip = 0, active = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    sumSq += x[i] * x[i];
    if (a > 0.999) clip++;
    if (a > 0.1) active++;
  }
  const rms = Math.sqrt(sumSq / n);
  // active-energy profile (0.5s frames) -> detect "music in only part of window"
  const frame = Math.floor(16000 * 0.5);
  const frames: number[] = [];
  let e = 0;
  for (let i = 0; i < x.length; i++) {
    e += x[i] * x[i];
    if ((i + 1) % frame === 0) { frames.push(e / frame); e = 0; }
  }
  if (e > 0) frames.push(e / (x.length % frame || frame));
  const fmax = Math.max(...frames);
  const nzFrames = frames.filter((v) => v > fmax * 0.05).length;
  return {
    dB: { peak: db(peak), rms: db(rms) },
    clipFrac: clip / n,
    activeFrac: active / n,
    frames,
    nzFrames,
  };
}
async function run(name: string, extractor: any, mono16: Float32Array) {
  const start = Math.floor(0.4 * 16000);
  const end = Math.min(mono16.length, start + Math.floor(WINDOW_S * 16000));
  const lms = extractor(mono16.slice(start, end), 16000);
  const raw = await matchLandmarks(lms);
  console.log(`\n===== ${name} =====`);
  console.log(`query landmarks: ${lms.length}`);
  for (const m of raw.slice(0, 5))
    console.log(`  cand ${m.title} conf=${m.confidence.toFixed(3)} votes=${m.overlap_count}`);
  const p = applyMatchPolicy(raw);
  console.log(`policy: ${p.ok ? "OK " + p.top.title + " conf=" + p.top.confidence.toFixed(3) : "NO-MATCH (" + p.reason + ")"}`);
}
const buf = readFileSync(FILE);
const dec = await decode(buf);
const mono = dec.channelData[0];
console.log(`file=${FILE} decoded rate=${dec.sampleRate} ch=${dec.channelData.length} dur=${(mono.length / dec.sampleRate).toFixed(3)}s`);
const s = stats(resample(mono, dec.sampleRate as number, 16000));
console.log(`waveform: peak=${s.dB.peak.toFixed(1)}dBFS rms=${s.dB.rms.toFixed(1)}dBFS crest=${(s.dB.peak - s.dB.rms).toFixed(1)}dB clipping=${(s.clipFrac * 100).toFixed(3)}% active(>0.1)=${(s.activeFrac * 100).toFixed(1)}%`);
console.log(`energy profile: ${s.nzFrames}/${s.frames.length} non-silent frames (>5% of max)`);
const mono16 = resample(mono, dec.sampleRate as number, 16000);
await run("CLASSIC (extractLandmarks)", extractLandmarks, mono16);
await run("ROBUST (extractLandmarksRobust)", extractLandmarksRobust, mono16);
