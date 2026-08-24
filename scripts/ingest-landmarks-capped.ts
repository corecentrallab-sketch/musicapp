#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// ingest-landmarks.ts — Bootstrap the landmark reference table (`piece_landmarks`)
// for every currently-fingerprinted piece (the 113 verified pieces), so the
// robust landmark matcher can recognise them.
//
// For each fingerprinted piece we locate a matching MIDI (local mutopia-data
// crawl or Cloudflare R2 `scores/*.mid`), synthesise the reference render with
// the SAME production pipeline (fluidsynth -r 16000 -g 2.0), extract landmark
// hashes (src/services/landmark.ts) and insert into `piece_landmarks`.
//
// Usage (from /home/team/shared/site):
//   export DATABASE_URL=... R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=...
//   bun run scripts/ingest-landmarks.ts [--only "WoO 59"] [--dry-run] [--limit N]
// ---------------------------------------------------------------------------

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import type { Landmark } from "../src/services/landmark";

const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const BUCKET = process.env.R2_BUCKET_NAME!;
const MUTOPIA_ROOT = "/home/team/shared/mutopia-data";
const SQL = neon(process.env.DATABASE_URL!);

const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1], 10) || Infinity : Infinity;
/** Max landmark hashes stored per piece (uniform temporal sample). Chosen so
 *  113 pieces fit Neon's 512MB project limit (full density was ~650MB). */
const CAP_PER_PIECE = 25000;

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});

// ---------------------------------------------------------------------------
// Catalog helpers (mirror of ingest-fingerprints.ts — proven in production)
// ---------------------------------------------------------------------------
const normCat = (s: string) => (s || "").toLowerCase().replace(/[.\-\s]+/g, " ").trim();
function extractNumbers(s: string): string { const m = s.match(/\d+/); return m ? m[0] : ""; }
function extractLetterPrefix(s: string): string { const m = s.match(/^[a-zA-Z]+/); return m ? m[0].toLowerCase() : ""; }

function matchPieceFromList(
  key: string,
  allPieces: { id: string; title: string; composer: string; catalog: string | null }[],
): { id: string; title: string; composer: string; catalog: string } | null {
  const r2Catalog = extractCatalogFromKey(key);
  if (!r2Catalog) return null;
  const r2Norm = normCat(r2Catalog);
  const r2Nums = extractNumbers(r2Catalog);
  const r2Prefix = extractLetterPrefix(r2Catalog);
  const filename = key.split("/").pop()?.replace(/\.midi?$/i, "").toLowerCase() || "";
  const fileWords = filename.split(/[_\-\s]+/).filter((w) => w.length > 1);

  interface ScoredPiece { piece: typeof allPieces[0]; score: number; }
  const scored: ScoredPiece[] = [];
  for (const piece of allPieces) {
    const dbCat = piece.catalog || "";
    const dbNorm = normCat(dbCat);
    const dbNums = extractNumbers(dbCat);
    const dbPrefix = extractLetterPrefix(dbCat);
    const dbTitle = piece.title.toLowerCase();
    const dbTitleWords = dbTitle.split(/\s+/).filter((w) => w.length > 2);
    let score = 0;
    if (dbNorm === r2Norm) score += 100;
    if (r2Prefix && dbPrefix && r2Nums && dbNums) {
      if (r2Prefix === dbPrefix && r2Nums === dbNums) score += 80;
      else if (r2Nums === dbNums && r2Prefix.length >= 1 && dbPrefix.startsWith(r2Prefix)) score += 60;
    }
    if (r2Nums && r2Nums === dbNums && r2Nums.length >= 2) score += 40;
    const titleOverlap = dbTitleWords.filter((tw) => fileWords.some((fw) => fw.includes(tw) || tw.includes(fw)));
    score += titleOverlap.length * 15;
    const dirName = key.split("/").slice(1, -1).join("/").toLowerCase().replace(/[_\-\s]+/g, " ");
    const dirOverlap = dbTitleWords.filter((tw) => dirName.includes(tw));
    score += dirOverlap.length * 10;
    if (dbNorm.length > 1 && r2Norm.includes(dbNorm)) score += 20;
    if (score > 0) scored.push({ piece, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0 && scored[0].score >= 15) {
    const p = scored[0].piece;
    return { id: p.id, title: p.title, composer: p.composer, catalog: p.catalog || "" };
  }
  return null;
}

/** Catalog segment = first path segment (after any composer layer) containing a digit. */
function extractCatalogFromKey(key: string): string {
  const rel = key.replace(/^scores\//, "");
  const parts = rel.split("/");
  // fresh5 layering: skip "fresh5/ComposerDir", else use parts[0]
  let start = 0;
  if (parts[0] === "fresh5" && parts.length >= 3) start = 2;
  else if (parts[0] === "fresh5") start = 1;
  for (let i = start; i < parts.length; i++) {
    if (/\d/.test(parts[i])) return parts[i];
  }
  return parts[start] || "";
}

function walkMidis(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkMidis(p, out);
    else if (/\.midi?$/i.test(e)) out.push(p);
  }
  return out;
}

async function listR2Midis(): Promise<string[]> {
  const keys: string[] = [];
  let tok: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "scores/", ContinuationToken: tok, MaxKeys: 1000 }));
    for (const o of r.Contents || []) {
      const k = o.Key || "";
      if (/\.midi?$/i.test(k)) keys.push(k);
    }
    tok = r.NextContinuationToken;
  } while (tok);
  return keys;
}

async function downloadR2(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const c of r.Body as AsyncIterable<Uint8Array>) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Fluidsynth a midi (buffer or path) → 16kHz mono Float32 samples. */
async function synthToMonoSamples(midi: Buffer | string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "lm-ingest-"));
  try {
    const midiPath = join(dir, "in.mid");
    if (typeof midi === "string") writeFileSync(midiPath, readFileSync(midi));
    else writeFileSync(midiPath, midi);
    const wavPath = join(dir, "out.wav");
    execSync(`fluidsynth -ni -r 16000 -g 2.0 -F "${wavPath}" "${SF2}" "${midiPath}"`, {
      timeout: 90000, stdio: "pipe",
    });
    const buf = readFileSync(wavPath);
    const decoded = await decode(buf);
    const channels = decoded.channelData;
    if (!channels || channels.length === 0 || channels[0].length === 0) throw new Error("no audio");
    if (channels.length === 1) return channels[0];
    const n = channels[0].length;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const ch of channels) s += ch[i] ?? 0;
      mono[i] = s / channels.length;
    }
    return mono;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function ensureTable(): Promise<void> {
  await SQL`CREATE TABLE IF NOT EXISTS piece_landmarks (
    id BIGSERIAL PRIMARY KEY,
    piece_id UUID NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    hash INTEGER NOT NULL,
    tc INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await SQL`CREATE INDEX IF NOT EXISTS idx_piece_landmarks_hash ON piece_landmarks(hash)`;
  await SQL`CREATE INDEX IF NOT EXISTS idx_piece_landmarks_piece ON piece_landmarks(piece_id)`;
}

async function insertPieceLandmarks(pieceId: string, lms: Landmark[]): Promise<void> {
  const hashes = lms.map((l) => l.hash);
  const tcs = lms.map((l) => l.timeCs);
  await SQL`
    INSERT INTO piece_landmarks (piece_id, hash, tc)
    SELECT ${pieceId}::uuid, * FROM unnest(${hashes}::int[], ${tcs}::int[])
  `;
}

/** Evenly sample `lms` down to at most `cap` landmarks, preserving temporal
 *  spread across the whole piece (keeps matching robust at any offset). */
function capLandmarks(lms: Landmark[], cap: number): Landmark[] {
  if (lms.length <= cap) return lms;
  const stride = lms.length / cap;
  const out: Landmark[] = new Array(cap);
  for (let i = 0; i < cap; i++) {
    out[i] = lms[Math.min(lms.length - 1, Math.floor(i * stride))];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await ensureTable();
  console.log("[1/5] Ensuring table OK");
  // Rebuild from scratch at capped density to stay within Neon's 512MB project
  // limit (full-density landmark sets overflowed it — SQLSTATE 53100).
  await SQL`TRUNCATE piece_landmarks`;
  console.log("      TRUNCATED piece_landmarks (capped re-ingest)");

  const pieces = (await SQL`
    SELECT DISTINCT p.id, p.title, p.composer, p.catalog
    FROM fingerprints f JOIN pieces p ON p.id = f.piece_id
    ORDER BY p.title
  `) as unknown as { id: string; title: string; composer: string; catalog: string | null }[];
  console.log(`[2/5] ${pieces.length} fingerprinted pieces to cover`);

  // Build the midi source list (local + R2). Lazy: local midis at startup,
  // R2 only downloaded when matched (to avoid downloading everything upfront).
  console.log("[3/5] Indexing local mutopia-data midis...");
  const localMidis = walkMidis(MUTOPIA_ROOT);
  console.log(`      ${localMidis.length} local midis`);
  const r2Keys = await listR2Midis();
  console.log(`      ${r2Keys.length} R2 midis`);

  // Index local midis by their derived "key" (so matchPieceFromList can score them)
  const keyByLocal = new Map<string, string>(); // absPath -> key
  for (const abs of localMidis) {
    const rel = abs.replace(MUTOPIA_ROOT + "/", "");
    keyByLocal.set(abs, `scores/${rel}`);
  }

  let succeeded = 0, failed = 0, skipped = 0;
  const failures: string[] = [];
  const coveredPieces = new Set<string>();

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (ONLY && !(piece.title.toLowerCase().includes(ONLY.toLowerCase()) || (piece.catalog || "").toLowerCase().includes(ONLY.toLowerCase()))) {
      continue;
    }
    if (succeeded >= LIMIT) break;

    // Locate best local midi for this piece
    let best: { src: "local" | "r2"; data: string | Buffer } | null = null;
    let bestScore = -1;
    for (const [abs, key] of keyByLocal) {
      const m = matchPieceFromList(key, [piece]);
      if (m && m.id === piece.id) {
        const s = scoreKey(key, piece);
        if (s > bestScore) { bestScore = s; best = { src: "local", data: abs }; }
      }
    }
    // If no local match and we opened R2 keys, try those
    if (!best) {
      for (const key of r2Keys) {
        const m = matchPieceFromList(key, [piece]);
        if (m && m.id === piece.id) {
          const s = scoreKey(key, piece);
          if (s > bestScore) { bestScore = s; best = { src: "r2", data: key }; }
        }
      }
    }

    if (!best) {
      failures.push(`${piece.catalog || piece.title}: no MIDI found`);
      failed++;
      continue;
    }

    let mono: Float32Array;
    try {
      mono = best.src === "local"
        ? await synthToMonoSamples(best.data as string)
        : await synthToMonoSamples(await downloadR2(best.data as string));
    } catch (err: any) {
      failures.push(`${piece.catalog || piece.title}: synth fail ${err?.message || err}`);
      failed++;
      continue;
    }

    const lms = extractLandmarks(mono);
    if (lms.length === 0) {
      console.error(`   DEBUG ${piece.catalog || piece.title}: best=${best?.src} ${typeof best?.data === "string" ? best.data : "(r2)"} mono_len=${mono.length} dur_s=${(mono.length / 16000).toFixed(1)} max=${mono.length ? Math.max(...Array.from(mono.slice(0, 100000))) : 0}`);
      failures.push(`${piece.catalog || piece.title}: 0 landmarks (silent?)`);
      failed++;
      continue;
    }
    // Cap per-piece landmark count via uniform temporal sampling so the whole
    // 113-piece reference fits Neon's 512MB project limit while keeping robust
    // Shazam-style matching (a bounded landmark set still aligns densely).
    const capped = capLandmarks(lms, CAP_PER_PIECE);

    if (DRY_RUN) {
      console.log(`   [dry] ${piece.catalog || piece.title} -> ${capped.length} landmarks (raw ${lms.length})`);
      coveredPieces.add(piece.id);
      succeeded++;
      continue;
    }

    const existing = (await SQL`SELECT count(*)::int AS c FROM piece_landmarks WHERE piece_id=${piece.id}::uuid`)[0] as { c: number };
    if (existing.c > 0) {
      await SQL`DELETE FROM piece_landmarks WHERE piece_id=${piece.id}::uuid`;
    }
    await insertPieceLandmarks(piece.id, capped);
    coveredPieces.add(piece.id);
    succeeded++;
    console.log(`   [${i + 1}/${pieces.length}] ${piece.catalog || piece.title} -> ${capped.length} landmarks (raw ${lms.length}, ${best.src})`);
  }

  console.log(`\n[4/5] Summary: ${succeeded} ingested, ${failed} failed, ${skipped} skipped`);
  if (failures.length) console.log("   Failures:", failures.slice(0, 60));

  if (!DRY_RUN && coveredPieces.size) {
    const [{ c }] = (await SQL`SELECT count(DISTINCT piece_id)::int AS c FROM piece_landmarks`) as unknown as { c: number }[];
    const [{ h }] = (await SQL`SELECT count(*)::int AS h FROM piece_landmarks`) as unknown as { h: number }[];
    console.log(`\n[5/5] piece_landmarks: ${h} rows across ${c} distinct pieces`);
  }
}

/** Pick the canonical MIDI for a piece. Higher is better. Prefers the exact
 *  catalog token appearing in the filename/leaf dir (rules out alternate
 *  arrangements like "guitar-duo" for the same catalog). */
function scoreKey(key: string, piece: { catalog: string | null; title: string }): number {
  const cat = extractCatalogFromKey(key);
  const c = normCat(piece.catalog || "");
  const k = normCat(cat);
  const cn = extractNumbers(cat);
  const pn = extractNumbers(piece.catalog || "");
  let base = c && c === k ? 1000 : cn && cn === pn && cn.length >= 2 ? 500 : 0;
  // bonus when the normalized catalog token appears in the filename or leaf dir
  const tok = k.replace(/[^a-z0-9]/g, "");
  const leaf = key.split("/").slice(-2).join(" ").toLowerCase().replace(/[._\-\s]+/g, "");
  if (tok && tok.length >= 2 && leaf.includes(tok)) base += 300;
  return base;
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
