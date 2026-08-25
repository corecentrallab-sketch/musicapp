// ---------------------------------------------------------------------------
// reground-clair-de-lune.ts — Verified re-grounding of ONE piece: Clair de Lune
// (Debussy, Suite Bergamasque III, catalog L. 75, piece id
// 9d948e91-9352-4ed3-a310-71777cae68de) into the landmark reference table.
//
// Why: this piece has ZERO landmark rows (piece_landmarks), so /api/recognize can
// never match it — it returns an honest no-match. Its only prior fingerprint was
// built from an unverified/wrong source MIDI and was REMOVED during the PR #53
// correctness re-grounding rather than return a wrong title. This script gives it
// a VERIFIED-CORRECT public-domain fingerprint using the SAME process PR #53 used
// to re-ground the 10 Chopin/Schumann pieces.
//
// Source (verified correct):
//   /home/team/shared/mutopia-data/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid
//   Mutopia-2010/12/21-1778 (maintainer Keith OHara), LilyPond 2.12.3,
//   source "E. Fromont (1905)" (the original published edition; IMSLP #02907),
//   licence "Public Domain". The .ly header and RDF both unambiguously name the
//   piece "Suite Bergamasque: Clair de Lune" / composer "Claude Debussy" / opus
//   "L75"; the opening (D-flat, 9/8, "Andante très expressif", 4-voice
//   \parallelMusic) is unmistakably the real Clair de Lune — NOT the wrong-file
//   problem that caused the original mislabelling.
//   md5 (byte-exact provenance evidence): d793583818c04502704200966ddbfa7b
//   (same file also present at fresh5/DebussyC/L75/..., byte-identical md5).
//
// Standing copyright rule: this is a clearly public-domain (Mutopia) source; only
// such sources are ingested.
//
// Usage (from /home/team/shared/site):
//   export DATABASE_URL=...
//   bun run scripts/reground-clair-de-lune.ts [--dry-run]
// Writes /tmp/clair_de_lune_report.json
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
const CAP_PER_PIECE = 25000; // must mirror ingest-landmarks-capped.ts
const DRY_RUN = process.argv.includes("--dry-run");

// Verified-correct public-domain source (see header).
const PIECE_ID = "9d948e91-9352-4ed3-a310-71777cae68de";
const MIDI = "/home/team/shared/mutopia-data/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid";
const SRC_MD5 = "d793583818c04502704200966ddbfa7b";

function md5(buf: Buffer | string): string { return createHash("md5").update(buf).digest("hex"); }

async function synthToMonoSamples(midi: string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "cdl-"));
  const midiPath = join(dir, "in.mid");
  const wavPath = join(dir, "out.wav");
  writeFileSync(midiPath, readFileSync(midi));
  execSync(`fluidsynth -ni -r 16000 -g 2.0 -F "${wavPath}" "${SF2}" "${midiPath}"`, { timeout: 120000, stdio: "pipe" });
  const buf = readFileSync(wavPath);
  const dec = await decode(buf);
  const ch = dec.channelData;
  if (!ch || ch.length === 0 || ch[0].length === 0) throw new Error("silent render");
  if (ch.length === 1) return ch[0];
  const n = ch[0].length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const c of ch) s += c[i] ?? 0; mono[i] = s / ch.length; }
  rmSync(dir, { recursive: true, force: true });
  return mono;
}

function capLandmarks(lms: Landmark[], cap: number): Landmark[] {
  if (lms.length <= cap) return lms;
  const stride = lms.length / cap;
  const out: Landmark[] = new Array(cap);
  for (let i = 0; i < cap; i++) out[i] = lms[Math.min(lms.length - 1, Math.floor(i * stride))];
  return out;
}

async function replacePieceLandmarks(pieceId: string, lms: Landmark[]): Promise<void> {
  const hashes = lms.map((l) => l.hash);
  const tcs = lms.map((l) => l.timeCs);
  await SQL`DELETE FROM piece_landmarks WHERE piece_id=${pieceId}::uuid`;
  await SQL`
    INSERT INTO piece_landmarks (piece_id, hash, tc)
    SELECT ${pieceId}::uuid, * FROM unnest(${hashes}::int[], ${tcs}::int[])`;
  // Keyset-paginated distinct-hash signature (mirrors PR #53 pieceSignature()).
  const hashesSet = new Set<number>();
  let cursor: number | null = null;
  for (;;) {
    const rows = (await SQL`
      SELECT DISTINCT hash FROM piece_landmarks WHERE piece_id=${pieceId}::uuid
        ${cursor !== null ? SQL`AND hash > ${cursor}` : SQL``}
      ORDER BY hash LIMIT 20000`) as unknown as { hash: number }[];
    for (const r of rows) hashesSet.add(r.hash);
    if (rows.length < 20000) break;
    cursor = rows[rows.length - 1].hash;
  }
  return md5([...hashesSet].sort((a, b) => a - b).join(","));
}

async function main() {
  const before = (await SQL`SELECT count(*)::int AS n FROM piece_landmarks WHERE piece_id=${PIECE_ID}::uuid`) as unknown as { n: number }[];
  // Byte-exact provenance check.
  const actualMd5 = md5(readFileSync(MIDI));
  const md5Match = actualMd5 === SRC_MD5;

  const mono = await synthToMonoSamples(MIDI);
  const lms = extractLandmarks(mono, 16000);
  if (lms.length === 0) throw new Error("0 landmarks extracted");
  const capped = capLandmarks(lms, CAP_PER_PIECE);

  let ensembleSig = "?";
  if (!DRY_RUN) {
    ensembleSig = await replacePieceLandmarks(PIECE_ID, capped);
  } else {
    // Fallback local signature in dry-run (not read back from DB).
    ensembleSig = md5([...new Set(capped.map((l) => l.hash))].sort((a, b) => a - b).join(","));
  }
  const after = (await SQL`SELECT count(*)::int AS n FROM piece_landmarks WHERE piece_id=${PIECE_ID}::uuid`) as unknown as { n: number }[];

  const report = {
    dryRun: DRY_RUN,
    pieceId: PIECE_ID,
    title: "Clair de Lune",
    composer: "Claude Debussy",
    catalog: "L. 75",
    source: MIDI,
    sourceMd5: actualMd5,
    sourceMd5Verified: md5Match,
    landmarkEnsembleMd5: ensembleSig,
    extracted: lms.length,
    inserted: DRY_RUN ? 0 : capped.length,
    beforeCount: before[0].n,
    afterCount: after[0].n,
  };
  writeFileSync("/tmp/clair_de_lune_report.json", JSON.stringify(report, null, 2));
  console.log(`source_md5=${actualMd5} verified=${md5Match}`);
  console.log(`extracted=${lms.length} inserted=${DRY_RUN ? 0 : capped.length} before=${before[0].n} after=${after[0].n}`);
  console.log(`dry_run=${DRY_RUN}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
