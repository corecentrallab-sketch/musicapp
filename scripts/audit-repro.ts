#!/usr/bin/env bun
// Reproduce the Für Elise / Träumerei false positive using the REAL pipeline:
// render a verified-correct public-domain MIDI -> room-noise rendition -> extractLandmarks
// -> matchLandmarks against the LIVE DB. Mirrors what /api/recognize does for a real recording.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { neon } from "@neondatabase/serverless";

const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const SEGMENT_SECS = 22;

function addNoise(samples: Float32Array, snrDb: number): Float32Array {
  const out = new Float32Array(samples);
  const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const np = signal / Math.pow(10, snrDb / 10);
  let s = 42;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(np) * 2 * rnd();
  return out;
}

async function renderNoisy(midiPath: string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "rep-"));
  const midiFile = join(dir, "in.mid"); const wav = join(dir, "out.wav");
  writeFileSync(midiFile, readFileSync(midiPath));
  execSync(`fluidsynth -ni -r 16000 -g 2.0 -F "${wav}" "${SF2}" "${midiFile}"`, { timeout: 120000, stdio: "pipe" });
  const buf = readFileSync(wav); const dec = await decode(buf);
  let mono: Float32Array;
  if (dec.channelData.length === 1) mono = dec.channelData[0];
  else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
  rmSync(dir, { recursive: true, force: true });
  return addNoise(mono, 10).slice(0, SEGMENT_SECS * 16000);
}

async function run(midiPath: string, label: string) {
  const mono = await renderNoisy(midiPath);
  const lms = extractLandmarks(mono, 16000);
  const raw = await matchLandmarks(lms);
  const gated = raw.filter((m) => m.confidence >= 0.3);
  console.log(`\n===== ${label} ===== (queryLms=${lms.length})`);
  console.log(`  GATED(>=0.3): ${gated.length}`);
  for (const m of gated) console.log(`    [${m.catalog ?? m.title}] ${m.title} | ${m.composer} | conf=${m.confidence.toFixed(3)} piece=${m.piece_id}`);
  if (gated.length === 0) {
    console.log(`  raw top candidates:`);
    for (const m of raw.slice(0, 5)) console.log(`    [${m.catalog ?? m.title}] conf=${m.confidence.toFixed(3)} piece=${m.piece_id}`);
  }
  return { lms, raw, gated };
}

async function main() {
  const cases = [
    { p: "/home/team/shared/mutopia-data/fresh5/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.mid", label: "FUR ELISE (real style, md5 e6d43b90)" },
    { p: "/home/team/shared/mutopia-data/O15/SchumannOp15No07/SchumannOp15No07.mid", label: "TRAUMEREI (real style, md5 9042e81e)" },
    { p: "/home/team/shared/mutopia-data/O15/SchumannOp15No01/SchumannOp15No01.mid", label: "OP15 NO1 (real style)" },
  ];
  for (const c of cases) { try { await run(c.p, c.label); } catch (e:any) { console.error(`ERR ${c.label}: ${e?.message||e}`); } }
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
