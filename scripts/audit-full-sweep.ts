#!/usr/bin/env bun
// FINAL full-accuracy audit sweep.
// For each fingerprinted piece, render a VERIFIED-CORRECT public-domain Mutopia MIDI
// (manual manifest, raw-byte md5) -> +10dB noise real-style 22s rendition ->
// extractLandmarks -> matchLandmarks against LIVE DB. Classify:
//   PASS       = top gated(>=0.3) is SELF and confidence>=0.3
//   WRONG      = a DIFFERENT piece is top at >=0.3 (confident wrong title!)
//   CROSS_FP   = SELF is top but a SECOND distinct piece also >=0.3 (potential confusion)
//   MISS       = no self at >=0.3
//   NOT_SOURCED= no verified correct MIDI available to test (deferred, not deleted)
// Also runs non-catalog controls (white noise, sine) => must return EMPTY (0 false positives).
// Writes /tmp/audit_full.json.
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";

const SQL = neon(process.env.DATABASE_URL!);
const MUTOPIA = "/home/team/shared/mutopia-data";
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const SEGMENT_SECS = 22;

// Correct public-domain Mutopia source per fingerprinted piece (catalog -> rel path).
// Raw-byte md5 recorded. Verified (PR53/56) sources marked *.
const SRC: Record<string, string> = {
  "D. 839": "fresh5/SchubertF/D839/SchubertF-D839_AveMaria/SchubertF-D839_AveMaria.mid",
  "WoO 59": "fresh5/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.mid",
  "Op. 52": "fresh5/ChopinFF/O52/ballade-4/ballade-4.mid",
  "L. 75": "L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid", // *PR56
  "D. 550": "fresh5/SchubertF/D550/forelle/forelle.mid",
  "D. 328": "fresh5/SchubertF/D328/Erlkoenig/Erlkoenig.mid",
  "D. 935 No. 2": "fresh5/SchubertF/D935/SchubertF-D935-2-Impromptu/SchubertF-D935-2-Impromptu.mid",
  "Op. 15 No. 2": "O15/SchumannOp15No02/SchumannOp15No02.mid", // *PR53
  "Op. 15 No. 7": "O15/SchumannOp15No07/SchumannOp15No07.mid", // *PR53
  "Op. 15 No. 1": "O15/SchumannOp15No01/SchumannOp15No01.mid", // *PR53
  "Op. 54 No. 3": "fresh5/GriegE/O54/Troldtog/Troldtog.mid",
  "Op. 65 No. 6": "fresh5/GriegE/O65/troldhaugen/troldhaugen.mid",
  "D. 780 No. 3": "fresh5/SchubertF/D780/MomentsNo3/MomentsNo3.mid",
  "Op. 9 No. 3": "O9/chopin_nocturne_op9_n3/chopin_nocturne_op9_n3.mid", // *PR53
  "Op. 9 No. 1": "O9/nocturne_in_b-flat_minor/nocturne_in_b-flat_minor.mid", // *PR53
  "Op. 72 No. 1": "fresh5/ChopinFF/O72/nocturne_in_e_minor/nocturne_in_e_minor.mid",
  "Op. 9 No. 2": "O9/chopin_nocturne_op9_n2/chopin_nocturne_op9_n2.mid", // *PR53
  "Op. 46 No. 4": "fresh5/GriegE/O46/Dans_l_antre_du_roi_de_la_montagne/Dans_l_antre_du_roi_de_la_montagne.mid",
  "Op. 31 No. 2": "fresh5/BeethovenLv/O31/LVB_Sonate_31no2_1/LVB_Sonate_31no2_1.mid",
  "Op. 57": "fresh5/BeethovenLv/O57/LVB_Sonate_57_2/LVB_Sonate_57_2.mid",
  "Op. 79": "fresh5/BeethovenLv/O79/LVB_Sonate_79_1/LVB_Sonate_79_1.mid",
  "Op. 90": "fresh5/BeethovenLv/O90/LVB_Sonate_90_1/LVB_Sonate_90_1.mid",
  "Op. 111": "fresh5/BeethovenLv/O111/lvb_sonate_111_1/lvb_sonate_111_1.mid",
  "Op. 13": "fresh5/BeethovenLv/O13/pathetique-1/pathetique-1.mid",
  "Op. 45": "fresh5/ChopinFF/O45/chopin_prelude_op45/chopin_prelude_op45.mid",
  "Op. 129": "fresh5/BeethovenLv/O129/beethoven_rondo_op129/beethoven_rondo_op129.mid",
  "Op. 67": "fresh5/BeethovenLv/O67/beethoven_fifth_op67/beethoven_fifth_op67.mid",
  "Op. 92": "fresh5/BeethovenLv/O92/Symphony7_1/Symphony7_1.mid",
  "Op. 37a": "fresh5/TchaikovskyPI/O37/Tschaikowsky-op37.1/Tschaikowsky-op37.1.mid",
  "BWV 565": "fresh5/BachJS/BWV565/ToccataFugue/ToccataFugue.mid",
  "Op. 69 No. 2": "fresh5/ChopinFF/O69/w10-h-moll-cfi/w10-h-moll-cfi.mid",
  "Op. 64 No. 1": "fresh5/ChopinFF/O64/chopin_valse_op64_no1/chopin_valse_op64_no1.mid",
  "Op. 10 No. 1": "O10/chp-10-01/chp-10-01.mid", // *PR53
  "Op. 10 No. 12": "O10/op-10-12-wfi/op-10-12-wfi.mid", // *PR53
  "Op. 10 No. 9": "O10/chopin-op-10-09-wfi/chopin-op-10-09-wfi.mid", // *PR53
  "Op. 10 No. 5": "O10/chp-10-05/chp-10-05.mid", // *PR53
};

function md5buf(b: Buffer): string { return createHash("md5").update(b).digest("hex"); }
function addNoise(samples: Float32Array, snrDb: number): Float32Array {
  const out = new Float32Array(samples);
  const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const np = signal / Math.pow(10, snrDb / 10);
  let s = 42; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(np) * 2 * rnd();
  return out;
}
async function renderNoisy(midiPath: string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "fs-"));
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

async function main() {
  const pieces = (await SQL`SELECT DISTINCT p.id, p.title, p.composer, p.catalog
    FROM piece_landmarks pl JOIN pieces p ON p.id=pl.piece_id ORDER BY p.title`) as unknown as any[];
  const results: any[] = [];
  let pass=0, wrong=0, ambiguous=0, miss=0, notSourced=0, err=0;
  for (const p of pieces) {
    const rel = SRC[p.catalog || ""];
    const rec: any = { catalog: p.catalog, composer: p.composer, title: p.title, id: p.id };
    if (!rel) { rec.status = "NOT_SOURCED"; notSourced++; results.push(rec); console.log(`NOT_SOURCED ${p.catalog}\t${p.title}`); continue; }
    const abs = join(MUTOPIA, rel);
    if (!existsSync(abs)) { rec.status = "NOT_SOURCED"; rec.note="manifest path missing"; notSourced++; results.push(rec); console.log(`NOT_SOURCED ${p.catalog}\t${p.title} (missing ${rel})`); continue; }
    try {
      rec.src = rel; rec.src_md5 = md5buf(readFileSync(abs));
      const mono = await renderNoisy(abs);
      const lms = extractLandmarks(mono, 16000);
      rec.queryLms = lms.length;
      const raw = await matchLandmarks(lms);
      // Classify through the EXACT production gate (threshold + margin + single).
      const policy = applyMatchPolicy(raw);
      const top = policy.ok ? policy.top : null;
      rec.raw = raw.slice(0, 5).map(m => ({ cat: m.catalog, conf: Math.round(m.confidence*1000)/1000, votes: m.overlap_count }));
      rec.gate = policy.ok ? "CONFIDENT" : policy.reason;
      if (policy.ok && top && top.piece_id === p.id) {
        rec.status = "PASS"; rec.conf = top.confidence; pass++;
      } else if (policy.ok && top) {
        rec.status = "WRONG"; rec.got = top.catalog; rec.conf = top.confidence; wrong++;
        console.log(`  ** CONFIDENT WRONG: ${p.catalog} -> ${top.catalog} conf=${top.confidence}`);
      } else if (!policy.ok && !["below-threshold"].includes(policy.reason)) {
        rec.status = "AMBIGUOUS"; rec.reason = policy.reason; ambiguous++;
      } else { rec.status = "MISS"; miss++; }
      console.log(`${rec.status} ${p.catalog}\t${p.title}\t srcMd5=${rec.src_md5.slice(0,10)} gate=${rec.gate} top=${top ? top.catalog + "@" + top.confidence.toFixed(3) : "-"}`);
    } catch (e:any) { rec.status = "ERR"; rec.error = String(e?.message||e); err++; console.log(`ERR ${p.catalog}\t${e?.message||e}`); }
    results.push(rec);
  }

  // Controls: non-catalog audio must return EMPTY under the policy (no false positives)
  const controls: any[] = [];
  const noise = new Float32Array(SEGMENT_SECS*16000); let s1=7; const rnd1=()=>{s1=(s1*1103515245+12345)&0x7fffffff; return s1/0x7fffffff-0.5;};
  for (let i=0;i<noise.length;i++) noise[i]=rnd1()*0.5;
  controls.push({ label:"white-noise", policy: applyMatchPolicy(await matchLandmarks(extractLandmarks(noise,16000))).ok });
  const sine=new Float32Array(SEGMENT_SECS*16000); for(let i=0;i<sine.length;i++){const f=200+(i/sine.length)*3000; sine[i]=0.5*Math.sin(2*Math.PI*f*i/16000);}
  controls.push({ label:"sine-sweep", policy: applyMatchPolicy(await matchLandmarks(extractLandmarks(sine,16000))).ok });
  const ctrlFps = controls.filter(c=>c.policy).length;

  const summary = { total: pieces.length, pass, wrong, ambiguous, miss, notSourced, err, controlFalsePositives: ctrlFps };
  console.log("\n=========== SUMMARY ==========="); console.log(summary);
  writeFileSync("/tmp/audit_full.json", JSON.stringify({ summary, controls, results }, null, 2));
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
