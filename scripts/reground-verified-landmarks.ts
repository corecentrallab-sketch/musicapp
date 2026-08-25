#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// reground-verified-landmarks.ts — Fix WRONG-GROUNDED recognition landmarks.
//
// Root cause (confirmed 2026-08-25): a large fraction of `piece_landmarks`
// rows were generated from the WRONG reference MIDI. The original ingest used
// a catalog-number-prefix resolver that collapsed many DISTINCT pieces onto a
// single wrong MIDI file, so multiple pieces now share byte-identical landmark
// sets (e.g. all 13 Chopin Op.28 Preludes share one set; 8 unrelated pieces
// share another). The robust matcher then returns confident WRONG titles,
// which the full-library validation (validate-library-direct.ts) exposed as
// 57 WRONG_MATCH / 51 PASS / 5 MISS across the 113 fingerprinted pieces.
//
// This script performs a VERIFIED re-grounding:
//   1. Detect contaminated pieces (those in identical-set groups of size > 1).
//   2. Re-ingest a manifest of {piece_id -> exact local PD MIDI} from the
//      CORRECT public-domain source, replacing those pieces' landmark rows,
//      with byte-exact md5 evidence for each.
//   3. DELETE landmark rows for any remaining contaminated pieces that we
//      cannot currently re-ground from a verified correct source — so they can
//      never return a confident WRONG title (they degrade to a clean MISS and
//      can be re-sourced later via the crawl workstream).
//
// Standing copyright rule: only clearly public-domain sources are ingested.
// The manifest below maps each piece to a Mutopia public-domain MIDI whose
// filename unambiguously names the piece.
//
// Usage (from /home/team/shared/site):
//   export DATABASE_URL=...
//   bun run scripts/reground-verified-landmarks.ts [--dry-run]
// Writes /tmp/reground_report.json
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import type { Landmark } from "../src/services/landmark";

const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const MUTOPIA = "/home/team/shared/mutopia-data";
const CAP_PER_PIECE = 25000; // must mirror ingest-landmarks-capped.ts
const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// VERIFIED CORRECT source manifest: piece_id -> exact Mutopia MIDI (relative
// to MUTOPIA). Each MIDI's filename unambiguously identifies the piece and it
// is a clearly public-domain (Mutopia) source. 2026-08-25.
// ---------------------------------------------------------------------------
const MANIFEST: Record<string, string> = {
  // Chopin Nocturnes Op.9
  "988a0149-821c-4cb1-b31f-d3d07d28e1b8": "O9/nocturne_in_b-flat_minor/nocturne_in_b-flat_minor.mid", // Op.9 No.1
  "5e74d931-ee6c-4ab5-a92b-3293fe7c7b95": "O9/chopin_nocturne_op9_n2/chopin_nocturne_op9_n2.mid",     // Op.9 No.2
  "6643a062-5db8-4ece-a7b9-bf3b876c2d7e": "O9/chopin_nocturne_op9_n3/chopin_nocturne_op9_n3.mid",     // Op.9 No.3
  // Chopin Études Op.10
  "f3b263bc-4100-402b-a87f-8c21d1853943": "O10/chp-10-01/chp-10-01.mid",                               // Op.10 No.1
  "014b481b-fdcc-4b62-b63c-1170732e8f87": "O10/chp-10-05/chp-10-05.mid",                               // Op.10 No.5
  "afa80d59-e32b-444b-9bfc-2955f92a1a63": "O10/chopin-op-10-09-wfi/chopin-op-10-09-wfi.mid",           // Op.10 No.9
  "13615737-9b42-4b09-9f79-1207b83241d2": "O10/op-10-12-wfi/op-10-12-wfi.mid",                         // Op.10 No.12
  // Schumann Kinderszenen Op.15
  "bc4b7071-ff55-416c-84ba-d11bd90ac748": "O15/SchumannOp15No01/SchumannOp15No01.mid",                 // Op.15 No.1
  "f5efc866-10e5-48ec-82c7-3241210755f3": "O15/SchumannOp15No02/SchumannOp15No02.mid",                 // Op.15 No.2
  "61068bff-232d-4dad-abe8-6d576bbc90e7": "O15/SchumannOp15No07/SchumannOp15No07.mid",                 // Op.15 No.7
};

function md5(s: string): string { return createHash("md5").update(s).digest("hex"); }
function emptyMd5(): string { return md5(""); }

/** Canonical identity signature of a piece's landmark set (sorted DISTINCT hashes). */
async function pieceSignature(pieceId: string): Promise<string> {
  const hashes = new Set<number>();
  let cursor: number | null = null;
  for (;;) {
    const rows = (await SQL`
      SELECT DISTINCT hash FROM piece_landmarks WHERE piece_id=${pieceId}::uuid
        ${cursor !== null ? SQL`AND hash > ${cursor}` : SQL``}
      ORDER BY hash LIMIT 20000`) as unknown as { hash: number }[];
    for (const r of rows) hashes.add(r.hash);
    if (rows.length < 20000) break;
    cursor = rows[rows.length - 1].hash;
  }
  return md5([...hashes].sort((a, b) => a - b).join(","));
}

async function synthToMonoSamples(midi: string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "rg-"));
  const midiPath = join(dir, "in.mid");
  const wavPath = join(dir, "out.wav");
  writeFileSync(midiPath, readFileSync(midi));
  execSync(`fluidsynth -ni -r 16000 -g 2.0 -F "${wavPath}" "${SF2}" "${midiPath}"`, { timeout: 120000, stdio: "pipe" });
  const buf = readFileSync(wavPath);
  const dec = await decode(buf);
  const ch = dec.channelData;
  if (!ch || ch.length === 0 || ch[0].length === 0) throw new Error("silent render");
  if (ch.length === 1) return ch[0];
  const n = ch[0].length; const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const c of ch) s += c[i] ?? 0; mono[i] = s / ch.length; }
  rmSync(dir, { recursive: true, force: true });
  return mono;
}

function capLandmarks(lms: Landmark[], cap: number): Landmark[] {
  if (lms.length <= cap) return lms;
  const stride = lms.length / cap; const out: Landmark[] = new Array(cap);
  for (let i = 0; i < cap; i++) out[i] = lms[Math.min(lms.length - 1, Math.floor(i * stride))];
  return out;
}

async function replacePieceLandmarks(pieceId: string, lms: Landmark[]): Promise<void> {
  const hashes = lms.map((l) => l.hash); const tcs = lms.map((l) => l.timeCs);
  await SQL`DELETE FROM piece_landmarks WHERE piece_id=${pieceId}::uuid`;
  await SQL`
    INSERT INTO piece_landmarks (piece_id, hash, tc)
    SELECT ${pieceId}::uuid, * FROM unnest(${hashes}::int[], ${tcs}::int[])`;
}

async function main() {
  const report: any = { dryRun: DRY_RUN, reground: [], deleted: [], deletedCount: 0, regroundCount: 0 };

  // Step 1: current contamination state.
  const sigRows = (await SQL`
    SELECT pl.piece_id, md5(string_agg(DISTINCT pl.hash::text, ',' ORDER BY pl.hash::text)) AS sig
    FROM piece_landmarks pl GROUP BY pl.piece_id`) as unknown as { piece_id: string; sig: string }[];
  const bySig = new Map<string, string[]>();
  for (const r of sigRows) { if (!bySig.has(r.sig)) bySig.set(r.sig, []); bySig.get(r.sig)!.push(r.piece_id); }
  const contaminated = new Set<string>();
  for (const [, ids] of bySig) if (ids.length > 1) for (const id of ids) contaminated.add(id);
  console.log(`[1/4] Before: ${sigRows.length} fingerprinted pieces, ${contaminated.size} contaminated (identical-set)`);

  // Step 2: verified re-ground.
  const metaRows = (await SQL`
    SELECT id, catalog, composer, title FROM pieces WHERE id = ANY(${Object.keys(MANIFEST)}::uuid[])`) as unknown as any[];
  const meta = new Map(metaRows.map((m: any) => [m.id, m]));
  for (const [pid, rel] of Object.entries(MANIFEST)) {
    const abs = join(MUTOPIA, rel);
    const m = meta.get(pid);
    let srcMd5 = "?", mono: Float32Array, lms: Landmark[];
    try {
      srcMd5 = md5(readFileSync(abs).toString("binary"));
      mono = await synthToMonoSamples(abs);
      lms = extractLandmarks(mono);
    } catch (e: any) {
      console.error(`   RE-GROUND FAIL ${pid} ${m?.catalog} (${rel}): ${e?.message || e}`); continue;
    }
    if (lms.length === 0) { console.error(`   RE-GROUND FAIL ${pid}: 0 landmarks`); continue; }
    const capped = capLandmarks(lms, CAP_PER_PIECE);
    const sig = md5([...new Set(capped.map((l) => l.hash))].sort((a, b) => a - b).join(","));
    report.reground.push({ pid, catalog: m?.catalog, composer: m?.composer, title: m?.title, src: rel, srcMd5, landmarkEnsembleMd5: sig, n: capped.length });
    if (!DRY_RUN) await replacePieceLandmarks(pid, capped);
    console.log(`   [re-ground] ${m?.catalog} | ${m?.composer} | ${rel} | src_md5=${srcMd5.slice(0, 10)} n=${capped.length}`);
  }
  report.regroundCount = report.reground.length;

  // Step 3: recompute contamination and delete the unfixable remainder.
  const sigRows2 = (await SQL`
    SELECT pl.piece_id, md5(string_agg(DISTINCT pl.hash::text, ',' ORDER BY pl.hash::text)) AS sig
    FROM piece_landmarks pl GROUP BY pl.piece_id`) as unknown as { piece_id: string; sig: string }[];
  const bySig2 = new Map<string, string[]>();
  for (const r of sigRows2) { if (!bySig2.has(r.sig)) bySig2.set(r.sig, []); bySig2.get(r.sig)!.push(r.piece_id); }
  const contaminated2 = new Set<string>();
  for (const [, ids] of bySig2) if (ids.length > 1) for (const id of ids) contaminated2.add(id);
  const toDelete = [...contaminated2];
  const delMeta = (await SQL`
    SELECT id, catalog, composer, title FROM pieces WHERE id = ANY(${toDelete}::uuid[])`) as unknown as any[];
  const delMap = new Map(delMeta.map((m: any) => [m.id, m]));
  if (!DRY_RUN && toDelete.length) {
    await SQL`DELETE FROM piece_landmarks WHERE piece_id = ANY(${toDelete}::uuid[])`;
  }
  for (const pid of toDelete) {
    const m = delMap.get(pid);
    report.deleted.push({ pid, catalog: m?.catalog, composer: m?.composer, title: m?.title });
    console.log(`   [delete] ${m?.catalog} | ${m?.composer} | ${m?.title}  (no verified correct source)`);
  }
  report.deletedCount = toDelete.length;

  // Step 4: after counts.
  const after = (await SQL`SELECT count(DISTINCT piece_id)::int AS c FROM piece_landmarks`) as unknown as { c: number }[];
  const afterContam = contaminated2.size;
  console.log(`[4/4] After: ${after[0].c} fingerprinted pieces, ${afterContam} contaminated (identical-set)`);
  writeFileSync("/tmp/reground_report.json", JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
