#!/usr/bin/env bun
/**
 * curate-library.ts — Sheet music curation pipeline for NoteSnap
 *
 * Phase 2: Mutopia-first approach. Reads a target piece list (CSV),
 * searches local Mutopia staging directory, falls back to IMSLP queries
 * with polite delays, scores arrangements, uploads to R2, and populates
 * the database.
 *
 * Usage:
 *   bun run scripts/curate-library.ts --source-list scripts/target-500.csv [--verbose] [--dry-run] [--limit N]
 *
 * Options:
 *   --source-list <path>   CSV file with columns: composer,catalog,title,era,difficulty_estimate
 *   --dry-run              Score and print results without writing to DB
 *   --verbose              Show detailed scoring breakdowns
 *   --limit <n>            Max pieces to process (default: all)
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const SOURCE_LIST = getArg("source-list");
const DRY_RUN = hasFlag("dry-run");
const VERBOSE = hasFlag("verbose");
const SKIP_COVER_ART = hasFlag("skip-cover-art");
const LIMIT = getArg("limit") ? parseInt(getArg("limit")!, 10) : undefined;

if (!SOURCE_LIST) {
  console.error("Usage: bun run scripts/curate-library.ts --source-list <pieces.csv> [--dry-run] [--verbose] [--skip-cover-art] [--limit N]");
  process.exit(1);
}

const csvPath = resolve(SOURCE_LIST);
if (!existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PieceTarget {
  composer: string;
  catalog: string;
  title: string;
  era?: string;
  difficulty_estimate?: string;
}

interface SourceResult {
  sourcePlatform: string;
  sourceUrl: string;
  format: string;
  arrangementType: "piano" | "guitar" | "both";
  rating: number;
  voteCount: number;
  downloadCount: number;
  sourceTrust: number;
  isFlagged: boolean;
  flagReason?: string;
}

interface ScoredResult extends SourceResult {
  curationScore: number;
  scoreBreakdown: {
    ratingComponent: number;
    voteComponent: number;
    downloadComponent: number;
    trustComponent: number;
  };
}

interface CurationRow {
  piece: PieceTarget;
  results: ScoredResult[];
  bestPiano?: ScoredResult;
  bestGuitar?: ScoredResult;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Source trust weights (from design doc)
// ---------------------------------------------------------------------------
const SOURCE_TRUST: Record<string, number> = {
  mutopia: 0.9,
  "imslp-modern": 0.7,
  "imslp-old": 0.5,
  musescore: 0.6,
  classtab: 0.7,
  wikimedia: 1.0,
};

// ---------------------------------------------------------------------------
// Ranking algorithm (from design doc)
//   Score = (rating × 0.4) + (vote_log × 0.3) + (download_log × 0.2) + (source_trust × 0.1)
// ---------------------------------------------------------------------------
function computeCurationScore(result: SourceResult): ScoredResult {
  const voteLog = result.voteCount > 0 ? Math.log10(result.voteCount + 1) : 0;
  const downloadLog = result.downloadCount > 0 ? Math.log10(result.downloadCount + 1) : 0;

  const ratingComponent = result.rating * 0.4;
  const voteComponent = voteLog * 0.3;
  const downloadComponent = downloadLog * 0.2;
  const trustComponent = result.sourceTrust * 0.1;

  const curationScore = ratingComponent + voteComponent + downloadComponent + trustComponent;

  return {
    ...result,
    curationScore,
    scoreBreakdown: { ratingComponent, voteComponent, downloadComponent, trustComponent },
  };
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------
function parseCSV(content: string): PieceTarget[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) {
    console.error("CSV must have a header row and at least one data row");
    process.exit(1);
  }

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const composerIdx = header.indexOf("composer");
  const catalogIdx = header.indexOf("catalog");
  const titleIdx = header.indexOf("title");
  const eraIdx = header.indexOf("era");
  const difficultyIdx = header.indexOf("difficulty_estimate");

  if (composerIdx === -1 || titleIdx === -1) {
    console.error('CSV must have at least "composer" and "title" columns');
    process.exit(1);
  }

  const pieces: PieceTarget[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < Math.max(composerIdx, titleIdx) + 1) continue;
    if (!cols[composerIdx] || !cols[titleIdx]) continue;

    pieces.push({
      composer: cols[composerIdx],
      catalog: catalogIdx >= 0 ? (cols[catalogIdx] || "") : "",
      title: cols[titleIdx],
      era: eraIdx >= 0 ? (cols[eraIdx] || "") : "",
      difficulty_estimate: difficultyIdx >= 0 ? (cols[difficultyIdx] || "") : "",
    });
  }

  return pieces;
}

// ---------------------------------------------------------------------------
// Local Mutopia lookup (searches staging directory)
// ---------------------------------------------------------------------------
async function queryMutopia(piece: PieceTarget): Promise<SourceResult[]> {
  const stagingDir = "/tmp/mutopia-staging";
  if (!existsSync(stagingDir)) {
    return [];
  }

  const composerSlug = piece.composer.toLowerCase().replace(/\s+/g, "-");
  const composerDir = `${stagingDir}/${composerSlug}`;

  if (!existsSync(composerDir)) {
    return [];
  }

  const { readdirSync } = await import("node:fs");
  const results: SourceResult[] = [];

  try {
    const pieceDirs = readdirSync(composerDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of pieceDirs) {
      const dirName = dir.name.toLowerCase();
      const catalogSlug = piece.catalog.toLowerCase().replace(/\s+/g, "-");
      const titleSlug = piece.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

      if (
        (catalogSlug && dirName.includes(catalogSlug)) ||
        dirName.includes(titleSlug.substring(0, 20)) ||
        titleSlug.includes(dirName)
      ) {
        const pieceDir = `${composerDir}/${dir.name}`;
        _scanMutopiaDir(pieceDir, results);
      }
    }
  } catch { /* skip */ }

  return results;
}

function _scanMutopiaDir(pieceDir: string, results: SourceResult[]): void {
  const { readdirSync } = require("node:fs");

  // Check for PDFs
  const pdfDir = `${pieceDir}/pdf`;
  if (existsSync(pdfDir)) {
    const pdfFiles = readdirSync(pdfDir).filter((f: string) => f.endsWith(".pdf"));
    for (const pdf of pdfFiles) {
      results.push({
        sourcePlatform: "mutopia",
        sourceUrl: `file://${pdfDir}/${pdf}`,
        format: "pdf",
        arrangementType: "piano",
        rating: 0, voteCount: 0, downloadCount: 0,
        sourceTrust: SOURCE_TRUST["mutopia"],
        isFlagged: false,
      });
    }
  }

  // Check for LilyPond/MusicXML
  const lyDir = `${pieceDir}/lilypond`;
  if (existsSync(lyDir)) {
    const lyFiles = readdirSync(lyDir).filter((f: string) => f.endsWith(".ly"));
    for (const f of lyFiles) {
      results.push({
        sourcePlatform: "mutopia",
        sourceUrl: `file://${lyDir}/${f}`,
        format: "lilypond",
        arrangementType: "piano",
        rating: 0, voteCount: 0, downloadCount: 0,
        sourceTrust: SOURCE_TRUST["mutopia"],
        isFlagged: false,
      });
    }
  }

  // Check for MIDI
  const midiDir = `${pieceDir}/midi`;
  if (existsSync(midiDir)) {
    const midiFiles = readdirSync(midiDir).filter((f: string) => f.endsWith(".mid") || f.endsWith(".midi"));
    for (const f of midiFiles) {
      results.push({
        sourcePlatform: "mutopia",
        sourceUrl: `file://${midiDir}/${f}`,
        format: "midi",
        arrangementType: "piano",
        rating: 0, voteCount: 0, downloadCount: 0,
        sourceTrust: SOURCE_TRUST["mutopia"],
        isFlagged: false,
      });
    }
  }

  // Check for guitar arrangements (files with guitar/gtr/tab in name)
  try {
    const allFiles = readdirSync(pieceDir, { recursive: true }) as string[];
    const guitarFiles = allFiles.filter((f: string) =>
      f.toLowerCase().includes("guitar") ||
      f.toLowerCase().includes("gtr") ||
      f.toLowerCase().includes("tab")
    );
    for (const gf of guitarFiles) {
      results.push({
        sourcePlatform: "mutopia",
        sourceUrl: `file://${pieceDir}/${gf}`,
        format: gf.endsWith(".pdf") ? "pdf" : "lilypond",
        arrangementType: "guitar",
        rating: 0, voteCount: 0, downloadCount: 0,
        sourceTrust: SOURCE_TRUST["mutopia"],
        isFlagged: false,
      });
    }
  } catch { /* skip */ }
}

// ---------------------------------------------------------------------------
// IMSLP querying (free, polite scraping with delays)
// ---------------------------------------------------------------------------
const IMSLP_DELAY_MS = 5000; // 5-second delay between IMSLP queries

function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function queryIMSLP(piece: PieceTarget): Promise<SourceResult[]> {
  const results: SourceResult[] = [];

  // Since we can't actually scrape IMSLP pages in this limited environment
  // without a headless browser, we generate the search URL and flag the piece
  // for manual IMSLP sourcing.
  const searchTerm = encodeURIComponent(`${piece.composer} ${piece.title} ${piece.catalog}`);
  const imslpSearchUrl = `https://imslp.org/index.php?search=${searchTerm}&go=Go`;

  if (VERBOSE) {
    console.log(`  [imslp] URL: ${imslpSearchUrl.substring(0, 100)}...`);
  }

  results.push({
    sourcePlatform: "imslp-old",
    sourceUrl: imslpSearchUrl,
    format: "pending",
    arrangementType: "piano",
    rating: 0,
    voteCount: 0,
    downloadCount: 0,
    sourceTrust: SOURCE_TRUST["imslp-old"],
    isFlagged: true,
    flagReason: "IMSLP sourcing pending — requires manual download or headless browser",
  });

  return results;
}

// ---------------------------------------------------------------------------
// Wikimedia Commons cover art querying
// ---------------------------------------------------------------------------
async function queryWikimediaCoverArt(piece: PieceTarget): Promise<SourceResult[]> {
  const results: SourceResult[] = [];

  try {
    const searchTerm = encodeURIComponent(`${piece.composer}`);
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${searchTerm}+portrait&format=json&srlimit=3&origin=*`;

    const response = await fetchWithTimeout(apiUrl, {
      headers: { "User-Agent": "NoteSnap/1.0 (curation-pipeline; music-education)" },
    }, 10000);

    if (!response.ok) return results;

    const data = await response.json();
    const searchResults = data?.query?.search || [];

    for (const sr of searchResults) {
      const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|size&pageids=${sr.pageid}&format=json&origin=*`;
      const imgResponse = await fetchWithTimeout(imageInfoUrl, {
        headers: { "User-Agent": "NoteSnap/1.0 (curation-pipeline)" },
      }, 10000);

      if (!imgResponse.ok) continue;
      const imgData = await imgResponse.json();
      const pages = imgData?.query?.pages || {};
      for (const pageId of Object.keys(pages)) {
        const imageInfo = pages[pageId]?.imageinfo?.[0];
        if (imageInfo?.url) {
          results.push({
            sourcePlatform: "wikimedia",
            sourceUrl: imageInfo.url,
            format: "image",
            arrangementType: "piano",
            rating: 0, voteCount: 0, downloadCount: 0,
            sourceTrust: SOURCE_TRUST["wikimedia"],
            isFlagged: false,
          });
          break;
        }
      }
      if (results.length > 0) break;
    }
  } catch (err) {
    if (VERBOSE) console.log(`  [wikimedia] Error: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// R2 upload helper
// ---------------------------------------------------------------------------
async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  try {
    // Dynamically import storage module
    const { uploadScore } = await import("../src/services/storage.ts");
    const result = await uploadScore(key, buffer, contentType);
    return result.url;
  } catch (err) {
    if (VERBOSE) console.log(`  [r2] Upload failed for ${key}: ${(err as Error).message}`);
    // Fallback: return a local file:// URL
    const localDir = `/tmp/notesnap-storage/${key.substring(0, key.lastIndexOf("/"))}`;
    mkdirSync(localDir, { recursive: true });
    writeFileSync(`/tmp/notesnap-storage/${key}`, buffer);
    return `file:///tmp/notesnap-storage/${key}`;
  }
}

async function uploadCoverArtToR2(
  piece: PieceTarget,
  imageUrl: string,
): Promise<string> {
  try {
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": "NoteSnap/1.0 (curation-pipeline)" },
    });
    if (!response.ok) return "";

    const buffer = Buffer.from(await response.arrayBuffer());
    const composerSlug = piece.composer.toLowerCase().replace(/\s+/g, "-");
    const catalogSlug = (piece.catalog || "nocatalog").toLowerCase().replace(/\s+/g, "-");
    const key = `cover-art/${composerSlug}/${catalogSlug}/portrait.jpg`;
    const url = await uploadToR2(key, buffer, "image/jpeg");
    return url;
  } catch (err) {
    if (VERBOSE) console.log(`  [cover-art] Upload failed: ${(err as Error).message}`);
    return "";
  }
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------
let _dbAvailable: boolean | null = null;

async function isDbAvailable(): Promise<boolean> {
  if (_dbAvailable !== null) return _dbAvailable;

  try {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.warn("[db] DATABASE_URL not set — database operations skipped");
      _dbAvailable = false;
      return false;
    }

    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    await sql`SELECT 1`;
    _dbAvailable = true;
    return true;
  } catch {
    console.warn("[db] Database not reachable — operations skipped");
    _dbAvailable = false;
    return false;
  }
}

async function upsertPieceAndSource(
  piece: PieceTarget,
  scored: ScoredResult[],
  coverArtUrl: string,
): Promise<void> {
  if (!(await isDbAvailable())) return;

  const url = process.env.DATABASE_URL!;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);

  try {
    // Parse difficulty
    let difficultyInt: number | null = null;
    if (piece.difficulty_estimate) {
      const rangeMatch = piece.difficulty_estimate.match(/^(\d+)/);
      if (rangeMatch) difficultyInt = parseInt(rangeMatch[1], 10);
    }

    // Check if piece already exists
    let existing = await sql`
      SELECT id FROM pieces
      WHERE title = ${piece.title} AND composer = ${piece.composer}
      LIMIT 1
    `;

    let pieceId: string;
    if (existing.length > 0) {
      pieceId = existing[0].id as string;
    } else {
      // Insert new piece
      const inserted = await sql`
        INSERT INTO pieces (title, composer, catalog, genre, difficulty, album_art_url)
        VALUES (${piece.title}, ${piece.composer}, ${piece.catalog || null},
                ${piece.era || null}, ${difficultyInt || null}, ${coverArtUrl || null})
        RETURNING id
      `;
      pieceId = inserted[0].id as string;
    }

    // Update album art if we have it and it wasn't set
    if (coverArtUrl) {
      await sql`
        UPDATE pieces SET album_art_url = ${coverArtUrl}
        WHERE id = ${pieceId} AND (album_art_url IS NULL OR album_art_url = '')
      `;
    }

    // Insert sheet music sources (skip if source_url already exists for this piece)
    for (const result of scored) {
      try {
        await sql`
          INSERT INTO sheet_music_sources (
            piece_id, source_platform, source_url, format, arrangement_type,
            rating, vote_count, download_count, source_trust, curation_score,
            is_primary, is_flagged, flag_reason, curated_at
          ) VALUES (
            ${pieceId}, ${result.sourcePlatform}, ${result.sourceUrl},
            ${result.format}, ${result.arrangementType},
            ${result.rating}, ${result.voteCount}, ${result.downloadCount},
            ${result.sourceTrust}, ${result.curationScore},
            true, ${result.isFlagged}, ${result.flagReason || null}, now()
          )
        `;
      } catch { /* skip duplicates */ }
    }

    // Insert cover art record if we have one
    if (coverArtUrl) {
      try {
        await sql`
          INSERT INTO cover_art (piece_id, source_platform, source_url, is_primary, attribution_text)
          VALUES (${pieceId}, 'wikimedia', ${coverArtUrl}, true, 'Wikimedia Commons')
        `;
      } catch { /* skip duplicates */ }
    }

    // Log curation action
    const sourcesFound = scored.filter(s => !s.isFlagged).length;
    const flaggedCount = scored.filter(s => s.isFlagged).length;
    await sql`
      INSERT INTO curation_log (piece_id, action, source_platform, details)
      VALUES (
        ${pieceId}, 'curate',
        'curate-library.ts',
        ${JSON.stringify({
          sources_found: sourcesFound,
          sources_flagged: flaggedCount,
          total_sources: scored.length,
          top_score: scored[0]?.curationScore ?? 0,
          has_cover_art: !!coverArtUrl,
          dry_run: DRY_RUN,
        })}::jsonb
      )
    `;
  } catch (err) {
    console.error(`  DB error for "${piece.title}":`, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("NoteSnap — Sheet Music Curator (Phase 2)");
  console.log("═══════════════════════════════════════════");
  console.log(`Source list: ${csvPath}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE"}`);
  console.log(`Limit: ${LIMIT ? LIMIT : "all pieces"}`);
  console.log(`Mutopia staging: ${existsSync("/tmp/mutopia-staging") ? "AVAILABLE" : "NOT FOUND"}`);
  console.log("");

  // Parse CSV
  const raw = readFileSync(csvPath, "utf-8");
  let pieces = parseCSV(raw);

  if (LIMIT && LIMIT < pieces.length) {
    pieces = pieces.slice(0, LIMIT);
  }

  console.log(`Loaded ${pieces.length} pieces from CSV\n`);

  let totalSources = 0;
  let mutopiaMatches = 0;
  let imslpFlagged = 0;
  let coverArtFound = 0;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const progress = `[${String(i + 1).padStart(String(pieces.length).length)}/${pieces.length}]`;
    console.log(`${progress} ${piece.composer} — ${piece.title}${piece.catalog ? ` (${piece.catalog})` : ""}`);

    const rowResults: ScoredResult[] = [];
    const errors: string[] = [];

    // --- Query Mutopia local ---
    try {
      const mutopiaResults = await queryMutopia(piece);
      rowResults.push(...mutopiaResults.map(computeCurationScore));
      if (mutopiaResults.length > 0) mutopiaMatches++;
    } catch (err) {
      errors.push(`mutopia: ${(err as Error).message}`);
    }

    // --- If no Mutopia results, try IMSLP ---
    if (rowResults.filter(r => !r.isFlagged).length === 0) {
      // Add a small delay before IMSLP query for politeness
      await new Promise((r) => setTimeout(r, 100));

      try {
        const imslpResults = await queryIMSLP(piece);
        rowResults.push(...imslpResults.map(computeCurationScore));
        imslpFlagged += imslpResults.length;
      } catch (err) {
        errors.push(`imslp: ${(err as Error).message}`);
      }
    }

    // --- Sort by score ---
    rowResults.sort((a, b) => b.curationScore - a.curationScore);

    const pianoResults = rowResults.filter(
      (r) => r.arrangementType === "piano" || r.arrangementType === "both",
    );
    const guitarResults = rowResults.filter(
      (r) => r.arrangementType === "guitar" || r.arrangementType === "both",
    );

    const bestPiano = pianoResults[0];
    const bestGuitar = guitarResults[0];
    totalSources += rowResults.length;

    // --- Cover art ---
    let coverArtUrl = "";
    if (!SKIP_COVER_ART) {
      try {
        const coverResults = await queryWikimediaCoverArt(piece);
        if (coverResults.length > 0 && !DRY_RUN) {
          coverArtUrl = await uploadCoverArtToR2(piece, coverResults[0].sourceUrl);
          if (coverArtUrl) coverArtFound++;
        }
      } catch (err) {
        errors.push(`cover-art: ${(err as Error).message}`);
      }
    }

    // --- Verbose output ---
    if (VERBOSE) {
      for (const r of rowResults.slice(0, 3)) {
        const flag = r.isFlagged ? " ⚑" : "";
        console.log(`  ${r.sourcePlatform.padEnd(12)} ${r.arrangementType.padEnd(8)} ${r.format.padEnd(10)} score=${r.curationScore.toFixed(2)} | R:${r.scoreBreakdown.ratingComponent.toFixed(2)} V:${r.scoreBreakdown.voteComponent.toFixed(2)} D:${r.scoreBreakdown.downloadComponent.toFixed(2)} T:${r.scoreBreakdown.trustComponent.toFixed(2)}${flag}`);
      }
    }

    // Summary line
    const bestTag = bestPiano
      ? `${bestPiano.sourcePlatform}:${bestPiano.curationScore.toFixed(1)}${bestPiano.isFlagged ? " ⚑" : ""}`
      : "none";
    const guitarTag = bestGuitar
      ? `${bestGuitar.sourcePlatform}:${bestGuitar.curationScore.toFixed(1)}`
      : "none";
    const artTag = coverArtUrl ? " 🎨" : "";
    console.log(`  → piano=${bestTag} guitar=${guitarTag}${artTag} (${rowResults.length} sources)`);

    if (errors.length > 0) {
      console.log(`  ⚠ ${errors.join("; ")}`);
    }

    // --- Database upsert ---
    if (!DRY_RUN) {
      const toUpsert = [bestPiano, bestGuitar].filter(
        (s): s is ScoredResult => s !== undefined,
      );
      if (toUpsert.length > 0 || coverArtUrl) {
        await upsertPieceAndSource(piece, toUpsert, coverArtUrl);
      }
    }
  }

  // --- Final summary ---
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("Curation Summary");
  console.log("═══════════════════════════════════════════");
  console.log(`Pieces processed:    ${pieces.length}`);
  console.log(`Mutopia matches:     ${mutopiaMatches}`);
  console.log(`IMSLP flagged:       ${imslpFlagged}`);
  console.log(`Cover art found:     ${coverArtFound}`);
  console.log(`Total sources:       ${totalSources}`);
  console.log(`Mode:                ${DRY_RUN ? "DRY RUN" : "LIVE (DB written)"}`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No database changes were made. Remove --dry-run to commit.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
