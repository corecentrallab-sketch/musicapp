#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// growth2-ambiguity-attribution.ts — WHY does the LIVE /api/recognize refuse a
// row, and did sprint-2 cause it?
//
// growth2-liveprobe.ts records only what the endpoint SERVED (and the endpoint
// returns `matches: []` when match-policy refuses). This script reproduces the
// endpoint's exact server-side path — decodeToMonoSamples() + extractLandmarksRobust()
// (NOT the plain extractLandmarks() the audit gate uses) + matchLandmarks() +
// applyMatchPolicy() — on the SAME 30s/16 kHz stereo WAV the probe uploads, and
// prints the raw candidate list the policy sees.
//
// Attribution: the same candidate list is re-scored with the sprint-2 pieces
// removed, then with the sprint-1 pieces removed too. If a row serves correctly
// once a new piece is filtered out, that new piece's cross-hit is what made the
// row ambiguous.
//
// Usage: bun scripts/growth2-ambiguity-attribution.ts <manifest.json>
// ---------------------------------------------------------------------------
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { decodeToMonoSamples } from "../src/services/fpcalc.ts";
import { extractLandmarksRobust } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";

const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const SR = 16000;
const SECS = 30;
const SPRINT1_MANIFEST = "/home/team/shared/catalog-growth-sprint-1/growth-1-manifest.json";
const SPRINT2_MANIFEST = "/tmp/g2/manifest.json";

interface Row { catalog?: string; db_catalog?: string; db_title: string; midi_file: string }

function encodeWav(chans: Float32Array[], sampleRate: number): Buffer {
  const frames = Math.min(...chans.map(c => c.length));
  const nch = chans.length >= 2 ? 2 : 1;
  const dataBytes = frames * nch * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "latin1");
  buf.write("fmt ", 12, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * nch * 2, 28);
  buf.writeUInt16LE(nch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const s = chans[c] ?? chans[0];
      const v = Math.max(-1, Math.min(1, s[i] ?? 0));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  return buf;
}

async function renderStereoWav(midi: string): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "g2w-"));
  try {
    const out = join(dir, "out.wav");
    execSync(`fluidsynth -ni -r ${SR} -g 2.0 -F "${out}" "${SF2}" "${midi}"`, { timeout: 180000, stdio: "pipe" });
    const decoded = (await decode(readFileSync(out))).channelData as Float32Array[];
    const trimmed = decoded.map(c => c.subarray(0, SECS * SR));
    return encodeWav(trimmed, SR);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function idsOf(path: string): Set<string> {
  const rows = JSON.parse(readFileSync(path, "utf8")) as { piece_id: string }[];
  return new Set(rows.map(r => r.piece_id));
}

async function main() {
  const rows: Row[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const s1 = idsOf(SPRINT1_MANIFEST);
  const s2 = idsOf(SPRINT2_MANIFEST);
  for (const row of rows) {
    const wav = await renderStereoWav(row.midi_file);
    const { mono, sampleRate } = await decodeToMonoSamples(wav);
    const raw = (await matchLandmarks(extractLandmarksRobust(mono, sampleRate))) as any[];
    console.log(`\n=== ${row.catalog ?? row.db_catalog} — ${row.db_title} (wav ${wav.length} B, ${mono.length / sampleRate}s)`);
    console.log(`raw candidates: ${raw.map(m => `${m.catalog}@${m.confidence}`).join(", ") || "(none)"}`);
    const variants: Array<[string, Set<string>]> = [
      ["live library (all 81)", new Set<string>()],
      ["minus sprint-2 (4 pieces)", s2],
      ["minus sprint-1+2 (33 pieces)", new Set([...s1, ...s2])],
    ];
    for (const [label, exclude] of variants) {
      const filtered = raw.filter(m => !exclude.has(m.piece_id));
      const pol = applyMatchPolicy(filtered);
      console.log(`  ${label}: ${pol.ok ? `SERVED ${(pol.top as any).title} conf=${pol.top.confidence}` : `REFUSED (${pol.reason})`}`);
    }
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
