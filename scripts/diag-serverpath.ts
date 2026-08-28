#!/usr/bin/env bun
// diag-serverpath.ts — replicate the EXACT /api/recognize processing path:
// full decoded buffer (native rate, e.g. 44.1k) fed to extractLandmarksRobust,
// then matchLandmarks against the LIVE DB + applyMatchPolicy. Use to compare
// what the live server computes vs the offline (16k-windowed) analyze script.
import { readFileSync } from "node:fs";
import decode from "audio-decode";
import { extractLandmarksRobust } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";
const FILE = process.argv[2];
const buf = readFileSync(FILE);
const dec = await decode(buf);
const mono = dec.channelData[0];
const landmarks = extractLandmarksRobust(mono, dec.sampleRate as number);
console.log("serverpath landmarks:", landmarks.length, "rate:", dec.sampleRate);
const raw = await matchLandmarks(landmarks);
for (const m of raw.slice(0,5)) console.log("  cand", m.title, "conf="+m.confidence.toFixed(3), "votes="+m.overlap_count);
const p = applyMatchPolicy(raw);
console.log("policy:", p.ok ? "OK "+p.top.title+" conf="+p.top.confidence.toFixed(3) : "NO-MATCH ("+p.reason+")");
