#!/usr/bin/env bun
/**
 * curate-library.ts — Sheet music curation pipeline for NoteSnap
 *
 * Reads a target piece list (CSV), queries sources (Musopen API, local Mutopia
 * mirror), scores arrangements using the ranking algorithm, and upserts results
 * into the database.
 *
 * Usage:
 *   bun run scripts/curate-library.ts --source-list pieces.csv [--dry-run]
 *
 * Options:
 *   --source-list <path>   CSV file with columns: composer,catalog,title
 *   --dry-run              Score and print results without writing to DB
 *   --verbose              Show detailed scoring breakdowns
 *   --limit <n>            Max pieces to process (default: all)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
const LIMIT = getArg("limit") ? parseInt(getArg("limit")!, 10) : undefined;

if (!SOURCE_LIST) {
  console.error("Usage: bun run scripts/curate-library.ts --source-list <pieces.csv> [--dry-run] [--verbose] [--limit N]");
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
  musopen: 1.0,
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
    scoreBreakdown: {
      ratingComponent,
      voteComponent,
      downloadComponent,
      trustComponent,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV parser (simple, no external dependency)
// ---------------------------------------------------------------------------
function parseCSV(content: string): PieceTarget[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) {
    console.error("CSV must have a header row and at least one data row");
    process.exit(1);
  }

  // Parse header to find column indices
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const composerIdx = header.indexOf("composer");
  const catalogIdx = header.indexOf("catalog");
  const titleIdx = header.indexOf("title");

  if (composerIdx === -1 || titleIdx === -1) {
    console.error('CSV must have at least "composer" and "title" columns');
    process.exit(1);
  }

  const pieces: PieceTarget[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < Math.max(composerIdx, titleIdx) + 1) continue;
    if (!cols[composerIdx] || !cols[titleIdx]) continue;

    pieces.push({
      composer: cols[composerIdx],
      catalog: catalogIdx >= 0 ? (cols[catalogIdx] || "") : "",
      title: cols[titleIdx],
    });
  }

  return pieces;
}

// ---------------------------------------------------------------------------
// Musopen API stub (placeholder — API key may not be available yet)
// ---------------------------------------------------------------------------
async function queryMusopen(
  piece: PieceTarget,
): Promise<SourceResult[]> {
  const apiKey = process.env.MUSOPEN_API_KEY;

  if (!apiKey) {
    if (VERBOSE) {
      console.log(`  [musopen] No API key set — skipping Musopen for "${piece.title}"`);
    }
    return [];
  }

  // TODO: Real Musopen API integration when key is available
  // Endpoint: GET https://api.musopen.org/sheetmusic/?search=<title>&composer=<composer>
  // Returns JSON with: id, title, composer, downloads, formats (pdf, midi, mxl)
  //
  // const response = await fetch(
  //   `https://api.musopen.org/sheetmusic/?search=${encodeURIComponent(piece.title)}&composer=${encodeURIComponent(piece.composer)}`,
  //   { headers: { Authorization: `Bearer ${apiKey}` } }
  // );
  // const data = await response.json();

  if (VERBOSE) {
    console.log(`  [musopen] Stub: would query "${piece.composer} — ${piece.title}"`);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Local Mutopia lookup (searches staging directory)
// ---------------------------------------------------------------------------
async function queryMutopia(
  piece: PieceTarget,
): Promise<SourceResult[]> {
  const stagingDir = "/tmp/mutopia-staging";
  if (!existsSync(stagingDir)) {
    return [];
  }

  const composerSlug = piece.composer.toLowerCase().replace(/\s+/g, "-");
  const composerDir = `${stagingDir}/${composerSlug}`;

  if (!existsSync(composerDir)) {
    return [];
  }

  // Find piece directories that match the catalog or title
  const { readdirSync } = await import("node:fs");
  const results: SourceResult[] = [];

  try {
    const pieceDirs = readdirSync(composerDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of pieceDirs) {
      const dirName = dir.name.toLowerCase();
      const catalogSlug = piece.catalog.toLowerCase().replace(/\s+/g, "-");
      const titleSlug = piece.title.toLowerCase().replace(/\s+/g, "-");

      // Fuzzy match: check if directory name contains catalog or title
      if (
        (catalogSlug && dirName.includes(catalogSlug)) ||
        dirName.includes(titleSlug) ||
        titleSlug.includes(dirName)
      ) {
        const pieceDir = `${composerDir}/${dir.name}`;

        // Check for piano (PDF) availability
        const pdfDir = `${pieceDir}/pdf`;
        if (existsSync(pdfDir)) {
          const pdfFiles = readdirSync(pdfDir).filter((f) => f.endsWith(".pdf"));
          for (const pdf of pdfFiles) {
            results.push({
              sourcePlatform: "mutopia",
              sourceUrl: `file://${pdfDir}/${pdf}`,
              format: "pdf",
              arrangementType: "piano",
              rating: 0,
              voteCount: 0,
              downloadCount: 0,
              sourceTrust: SOURCE_TRUST["mutopia"],
              isFlagged: false,
            });
          }
        }

        // Check for guitar arrangements
        const guitarFiles = readdirSync(pieceDir, { recursive: true })
          .filter((f) =>
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
            rating: 0,
            voteCount: 0,
            downloadCount: 0,
            sourceTrust: SOURCE_TRUST["mutopia"],
            isFlagged: false,
          });
        }
      }
    }
  } catch {
    // Directory read failed — skip
  }

  return results;
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

    // Quick connectivity check
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
): Promise<void> {
  if (!(await isDbAvailable())) return;

  const url = process.env.DATABASE_URL!;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);

  try {
    // Upsert piece
    const pieceRows = await sql`
      INSERT INTO pieces (title, composer, catalog)
      VALUES (${piece.title}, ${piece.composer}, ${piece.catalog || null})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;

    let pieceId: string;
    if (pieceRows.length > 0) {
      pieceId = pieceRows[0].id as string;
    } else {
      // Piece already exists — look it up
      const existing = await sql`
        SELECT id FROM pieces
        WHERE title = ${piece.title} AND composer = ${piece.composer}
        LIMIT 1
      `;
      if (existing.length === 0) {
        console.error(`  Failed to find or create piece: ${piece.title}`);
        return;
      }
      pieceId = existing[0].id as string;
    }

    // Insert best piano and best guitar sources
    for (const result of scored) {
      await sql`
        INSERT INTO sheet_music_sources (
          piece_id, source_platform, source_url, format, arrangement_type,
          rating, vote_count, download_count, source_trust, curation_score,
          is_primary, curated_at
        ) VALUES (
          ${pieceId}, ${result.sourcePlatform}, ${result.sourceUrl},
          ${result.format}, ${result.arrangementType},
          ${result.rating}, ${result.voteCount}, ${result.downloadCount},
          ${result.sourceTrust}, ${result.curationScore},
          true, now()
        )
        ON CONFLICT DO NOTHING
      `;
    }

    // Log curation action
    await sql`
      INSERT INTO curation_log (piece_id, action, source_platform, details)
      VALUES (
        ${pieceId}, 'score',
        'curate-library.ts',
        ${JSON.stringify({
          sources_found: scored.length,
          top_score: scored[0]?.curationScore ?? 0,
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
  console.log("NoteSnap — Sheet Music Curator");
  console.log(`Source list: ${csvPath}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE"}`);
  console.log(`Limit: ${LIMIT ? LIMIT : "all pieces"}`);
  console.log("");

  // Parse CSV
  const raw = readFileSync(csvPath, "utf-8");
  let pieces = parseCSV(raw);

  if (LIMIT && LIMIT < pieces.length) {
    pieces = pieces.slice(0, LIMIT);
  }

  console.log(`Loaded ${pieces.length} pieces from CSV\n`);

  const results: CurationRow[] = [];
  let totalSources = 0;
  let totalScored = 0;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    console.log(`[${i + 1}/${pieces.length}] ${piece.composer} — ${piece.title}${piece.catalog ? ` (${piece.catalog})` : ""}`);

    const row: CurationRow = { piece, results: [], errors: [] };

    // --- Query all sources ---
    // Musopen API (stub)
    try {
      const musopenResults = await queryMusopen(piece);
      row.results.push(...musopenResults.map(computeCurationScore));
    } catch (err) {
      row.errors.push(`musopen: ${(err as Error).message}`);
    }

    // Mutopia local mirror
    try {
      const mutopiaResults = await queryMutopia(piece);
      row.results.push(...mutopiaResults.map(computeCurationScore));
    } catch (err) {
      row.errors.push(`mutopia: ${(err as Error).message}`);
    }

    // --- Sort and select winners ---
    row.results.sort((a, b) => b.curationScore - a.curationScore);

    const pianoResults = row.results.filter(
      (r) => r.arrangementType === "piano" || r.arrangementType === "both",
    );
    const guitarResults = row.results.filter(
      (r) => r.arrangementType === "guitar" || r.arrangementType === "both",
    );

    row.bestPiano = pianoResults[0];
    row.bestGuitar = guitarResults[0];

    totalSources += row.results.length;
    if (row.bestPiano || row.bestGuitar) totalScored++;

    // --- Verbose output ---
    if (VERBOSE) {
      for (const r of row.results.slice(0, 3)) {
        console.log(`  ${r.sourcePlatform.padEnd(12)} ${r.arrangementType.padEnd(8)} ${r.format.padEnd(10)} score=${r.curationScore.toFixed(2)} | R:${r.scoreBreakdown.ratingComponent.toFixed(2)} V:${r.scoreBreakdown.voteComponent.toFixed(2)} D:${r.scoreBreakdown.downloadComponent.toFixed(2)} T:${r.scoreBreakdown.trustComponent.toFixed(2)}`);
      }
    }

    // Summary line
    const bestTag = row.bestPiano
      ? `piano=${row.bestPiano.sourcePlatform}:${row.bestPiano.curationScore.toFixed(1)}`
      : "piano=none";
    const guitarTag = row.bestGuitar
      ? `guitar=${row.bestGuitar.sourcePlatform}:${row.bestGuitar.curationScore.toFixed(1)}`
      : "guitar=none";
    console.log(`  → ${bestTag} ${guitarTag} (${row.results.length} sources)`);

    if (row.errors.length > 0) {
      console.log(`  ⚠ errors: ${row.errors.join("; ")}`);
    }

    // --- Database upsert (skip in dry-run) ---
    if (!DRY_RUN) {
      const toUpsert = [row.bestPiano, row.bestGuitar].filter(
        (s): s is ScoredResult => s !== undefined,
      );
      if (toUpsert.length > 0) {
        await upsertPieceAndSource(piece, toUpsert);
      }
    }

    results.push(row);
  }

  // --- Final summary ---
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("Curation Summary");
  console.log("═══════════════════════════════════════════");
  console.log(`Pieces processed:    ${pieces.length}`);
  console.log(`Total sources found: ${totalSources}`);
  console.log(`Pieces with matches: ${totalScored}/${pieces.length}`);
  console.log(`Pieces with piano:   ${results.filter((r) => r.bestPiano).length}`);
  console.log(`Pieces with guitar:  ${results.filter((r) => r.bestGuitar).length}`);
  console.log(`Errors:              ${results.reduce((acc, r) => acc + r.errors.length, 0)}`);
  console.log(`Mode:                ${DRY_RUN ? "DRY RUN" : "LIVE (DB written)"}`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No database changes were made. Remove --dry-run to commit.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
