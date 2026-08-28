#!/usr/bin/env bun
// fp-control.ts — false-positive + regression check for the robust extractor.
// 1) white noise 12s, 2) sine sweep 12s at 16k: must be NO-MATCH (0 false pos).
// 3) clean 44.1k Für Elise render through the ROBUST path (real-pipeline regr).
import decode from "audio-decode";
import { readFileSync } from "node:fs";
import { extractLandmarksRobust } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";

function lcg(seed: number) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; }; }
function resample(x: Float32Array, from: number, to: number): Float32Array {
  const outLen = Math.max(1, Math.round(x.length * to / from)); const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) { const p = (i * from) / to; const l = Math.min(Math.floor(p), x.length - 1); const fr = p - l; const r = Math.min(l + 1, x.length - 1); out[i] = x[l] + (x[r] - x[l]) * fr; }
  return out;
}
async function report(label: string, win: Float32Array) {
  const lms = extractLandmarksRobust(win, 16000);
  const raw = await matchLandmarks(lms);
  const policy = applyMatchPolicy(raw as { confidence: number }[]);
  console.log(`${label}: lms=${lms.length} ${policy.ok ? "MATCH " + (policy.top as any).catalog + " conf=" + (policy.top as any).confidence.toFixed(3) : "NO-MATCH (" + policy.reason + ")"} ${raw.map(m => m.catalog + ":" + m.confidence.toFixed(2)).join(" ")}`);
}
async function main() {
  // controls at 16k
  const N = 12 * 16000;
  const noise = new Float32Array(N); { const r = lcg(5); for (let i = 0; i < N; i++) noise[i] = r() * 0.6; }
  await report("WHITE-NOISE", noise);
  const sweep = new Float32Array(N); for (let i = 0; i < N; i++) { const f = 200 + (i / N) * 3000; sweep[i] = 0.5 * Math.sin(2 * Math.PI * f * i / 16000); }
  await report("SINE-SWEEP", sweep);
  // clean Für Elise 44.1k -> robust downsample -> match (regression)
  const buf = readFileSync("/tmp/repro/furelise_clean.wav");
  const dec = await decode(buf);
  const mono16 = resample(dec.channelData[0], dec.sampleRate as number, 16000);
  const start = Math.floor(0.4 * 16000); const end = start + 12 * 16000;
  await report("CLEAN-FURELISE-44k(robust)", mono16.slice(start, Math.min(end, mono16.length)));
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
