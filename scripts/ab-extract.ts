#!/usr/bin/env bun
// ab-extract.ts — A/B compare classic vs robust landmark extraction on a
// real device-style .m4a against the LIVE DB. Decodes the m4a ONCE (the exact
// server path: @audio/decode -> naive 44.1k->16k), then runs each extractor.
// Usage: bun scripts/ab-extract.ts path.m4a [--window 12]
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import decode from "audio-decode";
import { extractLandmarks, extractLandmarksRobust } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";

const args = process.argv.slice(2);
const FILE = args.find((a) => a.endsWith(".m4a")) ?? "/tmp/repro/furelise_harsh.m4a";
const wi = args.indexOf("--window");
const WINDOW_S = wi >= 0 ? parseFloat(args[wi + 1]) : 12;

function resample(x: Float32Array, from: number, to: number): Float32Array {
  const outLen = Math.max(1, Math.round(x.length * to / from)); const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) { const p = (i * from) / to; const l = Math.min(Math.floor(p), x.length - 1); const fr = p - l; const r = Math.min(l + 1, x.length - 1); out[i] = x[l] + (x[r] - x[l]) * fr; }
  return out;
}
async function run(name: string, extractor: (s: Float32Array, r: number) => any[], mono16: Float32Array) {
  const start = Math.floor(0.4 * 16000);
  const end = Math.min(mono16.length, start + Math.floor(WINDOW_S * 16000));
  const win = mono16.slice(start, end);
  const lms = extractor(win, 16000);
  const raw = await matchLandmarks(lms);
  console.log(`\n===== ${name} =====`);
  console.log(`query landmarks: ${lms.length}`);
  for (const m of raw) console.log(`  cand ${m.catalog} ${m.title} conf=${m.confidence.toFixed(3)} votes=${m.overlap_count}`);
  const policy = applyMatchPolicy(raw as { confidence: number }[]);
  console.log(`policy: ${policy.ok ? "OK " + (policy.top as any).catalog + " conf=" + (policy.top as any).confidence.toFixed(3) : "NO-MATCH (" + policy.reason + ")"}`);
}

async function main() {
  const buf = readFileSync(FILE);
  const dec = await decode(buf);
  let mono: Float32Array = dec.channelData[0];
  console.log(`file=${FILE} decoded: rate=${dec.sampleRate} ch=${dec.channelData.length}`);
  const mono16 = resample(mono, dec.sampleRate as number, 16000);
  await run("CLASSIC (extractLandmarks)", extractLandmarks, mono16);
  await run("ROBUST (extractLandmarksRobust)", extractLandmarksRobust, mono16);
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
