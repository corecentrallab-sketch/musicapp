// Verify the landmark matcher end-to-end against the DB (matchLandmarks).
// Run from /home/team/shared/site:
//   export DATABASE_URL=... && bun run scripts/verify-landmarks.ts
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";

const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";

async function synth(midiPath: string, gain: number, outDir: string): Promise<Float32Array> {
  writeFileSync(join(outDir, "in.mid"), readFileSync(midiPath));
  const wav = join(outDir, "out.wav");
  execSync(`fluidsynth -ni -r 16000 -g ${gain} -F "${wav}" "${SF2}" "${join(outDir, "in.mid")}"`, { timeout: 90000, stdio: "pipe" });
  const dec = await decode(readFileSync(wav));
  const ch = dec.channelData;
  if (ch.length === 1) return ch[0];
  const mono = new Float32Array(ch[0].length);
  for (let i = 0; i < mono.length; i++) { let s = 0; for (const c of ch) s += c[i] ?? 0; mono[i] = s / ch.length; }
  return mono;
}
function addNoise(samples: Float32Array, snrDb: number): Float32Array {
  const out = new Float32Array(samples);
  const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const np = signal / Math.pow(10, snrDb / 10);
  let s = 42; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(np) * 2 * rnd();
  return out;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "lm-ver-"));
  try {
    // (1) Für Elise identical-reference self-match
    const ref = await synth(ELISE, 2.0, dir);
    const L_ref = extractLandmarks(ref);
    const r1 = await matchLandmarks(L_ref);
    console.log("\n[1] Für Elise — bit-identical reference render");
    console.log("    query landmarks:", L_ref.length);
    console.log("    top:", JSON.stringify(r1.slice(0, 2).map((m) => ({ title: m.title, catalog: m.catalog, confidence: m.confidence, votes: m.overlap_count }))));

    // (2) Für Elise RE-RENDER — different gain + additive noise (a different performance/render)
    const rerender = addNoise(await synth(ELISE, 0.9, dir), 18);
    const L_rr = extractLandmarks(rerender);
    const r2 = await matchLandmarks(L_rr);
    console.log("\n[2] Für Elise — RE-RENDERED (lower gain + 18dB noise)  <<< THE PREVIOUSLY-FAILING CASE");
    console.log("    query landmarks:", L_rr.length);
    console.log("    top:", JSON.stringify(r2.slice(0, 3).map((m) => ({ title: m.title, catalog: m.catalog, confidence: m.confidence, votes: m.overlap_count }))));

    // (3) Short excerpt (20s) of the re-render — realistic user recording length
    const ex = rerender.slice(0, 20 * 16000);
    const L_ex = extractLandmarks(ex);
    const r3 = await matchLandmarks(L_ex);
    console.log("\n[3] Für Elise — 20s excerpt of re-render (realistic clip)");
    console.log("    query landmarks:", L_ex.length);
    console.log("    top:", JSON.stringify(r3.slice(0, 3).map((m) => ({ title: m.title, confidence: m.confidence, votes: m.overlap_count }))));

    // (4) Genuinely unrelated piece (NOT in DB) — should be empty
    const other = await synth(OTHER, 2.0, dir);
    const L_o = extractLandmarks(other);
    const r4 = await matchLandmarks(L_o);
    console.log("\n[4] Unrelated piece (not in catalog) — expected NO match");
    console.log("    query landmarks:", L_o.length, "matches:", r4.length, JSON.stringify(r4.map((m) => m.title)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ELISE = "/home/team/shared/mutopia-data/fresh5/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.mid";
// An unrelated piano piece definitely not yet in the landmark DB (not ingested).
const OTHER = "/home/team/shared/mutopia-data/O9/chopin_nocturne_op9_n2/chopin_nocturne_op9_n2.mid";

main().catch((e) => { console.error(e); process.exit(1); });
