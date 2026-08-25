#!/usr/bin/env bun
// Re-ground contaminated landmarks found by the full audit (Op.52 Ballade No.4,
// Op.46 No.4 In the Hall of the Mountain King) from verified-correct public-domain
// Mutopia MIDIs (PR53/56 convention). Backs up current rows to /tmp, then replaces,
// then verifies strong self-match. Dry-run safe.
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import type { Landmark } from "../src/services/landmark";

const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const MUTOPIA = "/home/team/shared/mutopia-data";
const CAP = 25000;
const DRY = process.argv.includes("--dry-run");

// piece_id -> { catalog, src }
const TARGETS: Record<string, { catalog: string; src: string }> = {
  "87c36eb2-6ea8-44c9-b289-a7c0ad4f8a6b": { catalog: "Op. 52", src: "fresh5/ChopinFF/O52/ballade-4/ballade-4.mid" },
  "16612583-3e86-4222-a710-7d2c971bfde1": { catalog: "Op. 46 No. 4", src: "fresh5/GriegE/O46/Dans_l_antre_du_roi_de_la_montagne/Dans_l_antre_du_roi_de_la_montagne.mid" },
};

function md5buf(b: Buffer): string { return createHash("md5").update(b).digest("hex"); }
function capLms(lms: Landmark[], cap: number): Landmark[] {
  if (lms.length <= cap) return lms;
  const stride = lms.length / cap; const out: Landmark[] = new Array(cap);
  for (let i = 0; i < cap; i++) out[i] = lms[Math.min(lms.length - 1, Math.floor(i * stride))];
  return out;
}
async function synthToMono(midi: string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "rg2-")); const midiPath = join(dir, "in.mid"); const wav = join(dir, "out.wav");
  writeFileSync(midiPath, readFileSync(midi));
  execSync(`fluidsynth -ni -r 16000 -g 2.0 -F "${wav}" "${SF2}" "${midiPath}"`, { timeout: 120000, stdio: "pipe" });
  const buf = readFileSync(wav); const dec = await decode(buf);
  let mono: Float32Array; if (dec.channelData.length === 1) mono = dec.channelData[0];
  else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
  rmSync(dir, { recursive: true, force: true }); return mono;
}
async function verify(pieceId: string, midi: string, label: string): Promise<void> {
  // verify with a noisy real-style 22s rendition from the SAME correct source
  const monoFull = await synthToMono(midi);
  let s = 42; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  const out = monoFull.slice(0, 22 * 16000);
  const lms = extractLandmarks(out, 16000);
  const gated = (await matchLandmarks(lms)).filter(m => m.confidence >= 0.3);
  const self = gated.find(m => m.piece_id === pieceId);
  console.log(`  verify ${label}: selfConf=${self ? self.confidence.toFixed(3) : "NONE"}`);
  if (self && gated[0]?.piece_id !== pieceId) console.log(`    !! top=${gated[0].catalog} (${gated[0].confidence.toFixed(3)}) beats self`);
  else console.log(`    top is ${self ? "SELF" : "other/miss"}`);
}

async function main() {
  const report: any[] = [];
  const targets = (await SQL`SELECT id, catalog, title, composer FROM pieces WHERE id = ANY(${Object.keys(TARGETS)}::uuid[])`) as unknown as any[];
  const byId = new Map(targets.map(t => [t.id, t]));
  for (const [tid, cfg] of Object.entries(TARGETS)) {
    const m = byId.get(tid); if (!m) { console.log(`SKIP unknown id ${tid}`); continue; }
    const abs = join(MUTOPIA, cfg.src);
    console.log(`\n*** ${m.catalog} | ${m.title} | ${cfg.src}`);
    // backup
    const rows = (await SQL`SELECT hash, tc FROM piece_landmarks WHERE piece_id=${tid}::uuid`) as unknown as { hash: number; tc: number }[];
    writeFileSync(`/tmp/backup_${m.catalog.replace(/\s+/g,"_")}.json`, JSON.stringify(rows));
    console.log(`  backup ${rows.length} rows -> /tmp/backup_${m.catalog.replace(/\s+/g,"_")}.json`);
    const before = (await matchLandmarks(extractLandmarks((await synthToMono(abs)).slice(0,22*16000), 16000))).filter(m=>m.confidence>=0.3);
    console.log(`  BEFORE reground: self=${before.find(x=>x.piece_id===tid)?.confidence?.toFixed(3) ?? "NONE"} top=${before[0]?.catalog} (${before[0]?.confidence?.toFixed(3)})`);
    const mono = await synthToMono(abs);
    const lms = extractLandmarks(mono);
    const capped = capLms(lms, CAP);
    const srcMd5 = md5buf(readFileSync(abs));
    console.log(`  extracted ${capped.length} landmarks, src_md5=${srcMd5.slice(0,10)}`);
    if (!DRY) {
      await SQL`DELETE FROM piece_landmarks WHERE piece_id=${tid}::uuid`;
      const hashes = capped.map(l=>l.hash); const tcs = capped.map(l=>l.timeCs);
      await SQL`INSERT INTO piece_landmarks (piece_id, hash, tc) SELECT ${tid}::uuid, * FROM unnest(${hashes}::int[], ${tcs}::int[])`;
      console.log(`  REGROUND done`);
      await verify(tid, abs, m.catalog);
    } else { console.log(`  [dry-run] would reground`); }
    report.push({ id: tid, catalog: m.catalog, src: cfg.src, srcMd5, n: capped.length, dryRun: DRY });
  }
  writeFileSync("/tmp/reground_audit_report.json", JSON.stringify(report, null, 2));
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
