#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// ingest-fingerprints.ts — Download MIDI from R2, synthesize to WAV,
// fingerprint with fpcalc, and insert into Postgres fingerprints table.
//
// Usage:
//   bun run scripts/ingest-fingerprints.ts [--dry-run] [--limit N]
//
// Prerequisites:
//   - fluidsynth + SoundFont (apt install fluidsynth fluid-soundfont-gm)
//   - fpcalc in PATH (from Chromaprint static build)
//   - DATABASE_URL, R2_* env vars set
// ---------------------------------------------------------------------------

import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const BUCKET = process.env.R2_BUCKET_NAME!;
const MIDI_PREFIX = "scores/";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1], 10) || Infinity : Infinity;

const sql = neon(process.env.DATABASE_URL!);

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Download an object from R2 into a Buffer */
async function downloadFromR2(key: string): Promise<Buffer> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Parse fpcalc -raw output: handles both space- and comma-separated ints */
function parseFpcalcOutput(output: string): { fingerprint: number[]; duration: number } {
  let duration = 0;
  let fpRaw = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("DURATION=")) duration = parseFloat(line.substring(9));
    else if (line.startsWith("FINGERPRINT=")) fpRaw = line.substring(12);
  }
  if (!fpRaw) throw new Error("fpcalc output missing FINGERPRINT line");
  // Handle both space and comma separators
  const fingerprint = fpRaw.trim()
    .split(/[\s,]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));
  if (fingerprint.length === 0) throw new Error("fpcalc produced empty fingerprint");
  return { fingerprint, duration };
}

/** Synthesize MIDI to 16kHz mono WAV, then fpcalc it */
function fingerprintMidi(midiPath: string, wavPath: string): { fingerprint: number[]; duration: number } {
  // Step 1: fluidsynth MIDI → WAV (16kHz, mono)
  execSync(
    `fluidsynth -ni -r 16000 -g 2.0 -F "${wavPath}" "${SF2}" "${midiPath}"`,
    { timeout: 60000, stdio: "pipe" }
  );
  // Step 2: fpcalc on the WAV
  const fpOut = execSync(`fpcalc -raw -length 120 "${wavPath}"`, {
    encoding: "utf8",
    timeout: 30000,
  });
  return parseFpcalcOutput(fpOut);
}

/** Extract the catalog directory name from an R2 key.
 *  e.g. "scores/B130/TroisNouvellesEtudes_Chopin_n1/...mid" → "B130"
 *        "scores/O9/chopin_nocturne_op9_n2/...mid" → "O9"
 *        "scores/HOB-XVI-27/hob-xvi-27-i-allegro...mid" → "HOB-XVI-27"
 */
function extractCatalogFromKey(key: string): string {
  const relative = key.replace(MIDI_PREFIX, "");
  const parts = relative.split("/");
  return parts[0] || "";
}

// Normalize a catalog string for comparison: lowercase, collapse separators to spaces
const normCat = (s: string) => s.toLowerCase().replace(/[.\-\s]+/g, " ").trim();

// Extract the numeric portion from a catalog-like string: "O9" → "9", "Op.10" → "10"
function extractNumbers(s: string): string {
  const m = s.match(/\d+/);
  return m ? m[0] : "";
}

// Extract a letter prefix if present: "O9" → "o", "L66" → "l", "B130" → "b"
function extractLetterPrefix(s: string): string {
  const m = s.match(/^[a-zA-Z]+/);
  return m ? m[0].toLowerCase() : "";
}

/** Try to match an R2 MIDI key to a DB piece using all available pieces. */
function matchPieceFromList(
  key: string,
  allPieces: { id: string; title: string; composer: string; catalog: string | null }[],
): { id: string; title: string; composer: string; catalog: string } | null {
  const r2Catalog = extractCatalogFromKey(key);
  if (!r2Catalog) return null;

  const r2Norm = normCat(r2Catalog);
  const r2Nums = extractNumbers(r2Catalog);
  const r2Prefix = extractLetterPrefix(r2Catalog);

  // Extract filename stem for title matching
  const filename = key.split("/").pop()?.replace(/\.midi?$/i, "").toLowerCase() || "";
  const fileWords = filename.split(/[_\-\s]+/).filter(w => w.length > 1);

  // Score each piece candidate
  interface ScoredPiece { piece: typeof allPieces[0]; score: number; }
  const scored: ScoredPiece[] = [];

  for (const piece of allPieces) {
    const dbCat = piece.catalog || "";
    const dbNorm = normCat(dbCat);
    const dbNums = extractNumbers(dbCat);
    const dbPrefix = extractLetterPrefix(dbCat);
    const dbTitle = piece.title.toLowerCase();
    const dbTitleWords = dbTitle.split(/\s+/).filter(w => w.length > 2);
    let score = 0;

    // Exact normalized catalog match — highest confidence
    if (dbNorm === r2Norm) {
      score += 100;
    }

    // Catalog prefix + number match (e.g., "O9" ↔ "Op. 9")
    if (r2Prefix && dbPrefix && r2Nums && dbNums) {
      if (r2Prefix === dbPrefix && r2Nums === dbNums) {
        score += 80;
      } else if (r2Nums === dbNums && r2Prefix.length >= 1 && dbPrefix.startsWith(r2Prefix)) {
        score += 60; // "O9" ↔ "Op. 9" (prefix "o" matches "op")
      }
    }

    // Just number match with catalog length similarity
    if (r2Nums && r2Nums === dbNums && r2Nums.length >= 2) {
      score += 40;
    }

    // Title word overlap with filename
    const titleOverlap = dbTitleWords.filter(tw => fileWords.some(fw => fw.includes(tw) || tw.includes(fw)));
    score += titleOverlap.length * 15;

    // Directory name contains title words
    const dirName = key.split("/").slice(1, -1).join("/").toLowerCase().replace(/[_\-\s]+/g, " ");
    const dirOverlap = dbTitleWords.filter(tw => dirName.includes(tw));
    score += dirOverlap.length * 10;

    // Catalog appears in directory path (broad)
    if (dbNorm.length > 1 && r2Norm.includes(dbNorm)) {
      score += 20;
    }

    if (score > 0) scored.push({ piece, score });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  if (scored.length > 0 && scored[0].score >= 15) {
    const p = scored[0].piece;
    return { id: p.id, title: p.title, composer: p.composer, catalog: p.catalog || "" };
  }

  return null;
}

/** Insert a fingerprint row */
async function insertFingerprint(
  pieceId: string,
  fingerprint: number[],
  duration: number,
): Promise<void> {
  // PostgreSQL array literal: {1,2,3,...}
  const arrayLiteral = `{${fingerprint.join(",")}}`;
  await sql`
    INSERT INTO fingerprints (piece_id, segment_start_s, segment_end_s, fingerprint)
    VALUES (${pieceId}::uuid, 0, ${duration}, ${arrayLiteral}::bigint[])
  `;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== NoteSnap Fingerprint Ingestion ===\n");

  // 1. List all MIDI files in R2
  console.log("[1/4] Listing MIDI files in R2...");
  const midiKeys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: MIDI_PREFIX,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    const resp = await s3.send(cmd);
    for (const obj of resp.Contents || []) {
      const key = obj.Key || "";
      if (key.toLowerCase().endsWith(".mid") || key.toLowerCase().endsWith(".midi")) {
        midiKeys.push(key);
      }
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);
  console.log(`   Found ${midiKeys.length} MIDI files`);

  // Apply limit
  const toProcess = LIMIT < midiKeys.length ? midiKeys.slice(0, LIMIT) : midiKeys;
  if (LIMIT < midiKeys.length) {
    console.log(`   Limited to first ${LIMIT} files\n`);
  }

  // 2. Load all pieces from DB and match
  console.log("[2/4] Loading pieces and matching...");
  const allPieces = await sql`SELECT id, title, composer, catalog FROM pieces`;
  console.log(`   Loaded ${allPieces.length} pieces from DB`);

  const matched: { key: string; piece: ReturnType<typeof matchPieceFromList> }[] = [];
  const unmatched: string[] = [];

  for (const key of toProcess) {
    const piece = matchPieceFromList(key, allPieces as any);
    if (piece) {
      matched.push({ key, piece });
    } else {
      unmatched.push(key);
    }
  }
  console.log(`   Matched: ${matched.length}, Unmatched: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log(`   Unmatched files:`);
    unmatched.forEach((k) => console.log(`     - ${k}`));
  }
  console.log();

  // 3. Process each file
  console.log("[3/4] Processing files...");
  let succeeded = 0;
  let failed = 0;
  const failures: { key: string; reason: string }[] = [];

  for (let i = 0; i < matched.length; i++) {
    const { key, piece } = matched[i];
    const progress = `[${i + 1}/${matched.length}]`;
    process.stdout.write(`${progress} ${key} ... `);

    const tmpDir = mkdtempSync(join(tmpdir(), "fp-ingest-"));
    try {
      // Download MIDI
      const midiBuf = await downloadFromR2(key);
      const midiPath = join(tmpDir, "input.mid");
      const wavPath = join(tmpDir, "output.wav");
      writeFileSync(midiPath, midiBuf);

      // Fingerprint
      const { fingerprint, duration } = fingerprintMidi(midiPath, wavPath);

      if (DRY_RUN) {
        console.log(`DRY RUN: would insert ${fingerprint.length} ints, duration=${duration}s, piece_id=${piece.id}`);
        succeeded++;
      } else {
        await insertFingerprint(piece.id, fingerprint, duration);
        console.log(`OK (${fingerprint.length} ints, ${duration.toFixed(1)}s, piece=${piece.catalog || piece.title})`);
        succeeded++;
      }
    } catch (err: any) {
      const reason = err?.message || String(err);
      console.log(`FAILED: ${reason}`);
      failed++;
      failures.push({ key, reason });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 4. Summary
  console.log(`\n[4/4] Summary`);
  console.log(`   Total files:     ${toProcess.length}`);
  console.log(`   Matched to DB:   ${matched.length}`);
  console.log(`   Succeeded:       ${succeeded}`);
  console.log(`   Failed:          ${failed}`);
  console.log(`   Unmatched:       ${unmatched.length}`);

  if (failures.length > 0) {
    console.log(`\n   Failures:`);
    failures.forEach((f) => console.log(`     - ${f.key}: ${f.reason}`));
  }

  if (!DRY_RUN && succeeded > 0) {
    const [{ count }] = await sql`SELECT COUNT(DISTINCT piece_id)::int as count FROM fingerprints`;
    console.log(`\n   Distinct pieces with fingerprints: ${count}`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
