#!/usr/bin/env bun
/**
 * download-mutopia.ts — Bulk download sheet music from Mutopia Project
 *
 * Uses child_process.execSync for curl (which needs --tls-max 1.2).
 * Crawls 46 composers, downloads .pdf/.ly/.mid/.midi/.rdf/.zip,
 * extracts zips, uploads to R2.
 *
 * Usage: bun run scripts/download-mutopia.ts [--skip-upload] [--composer-limit N]
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE = "https://www.mutopiaproject.org/ftp";
const OUT = "/home/team/shared/mutopia-data";
const PARALLEL = 6;
const MAX_RETRIES = 3;

const COMPOSERS = [
  "BachJS", "BeethovenLv", "MozartWA", "ChopinFF", "DebussyC", "SchubertF",
  "BrahmsJ", "HandelGF", "HaydnFJ", "LisztF", "MendelssohnF", "SchumannR",
  "TchaikovskyPI", "VivaldiA", "ScarlattiD", "PalestrinaG", "MonteverdiC",
  "PachelbelJ", "BuxtehudeD", "AlbenizIMF", "AguadoD", "SorF", "GiulianiM",
  "CarcassiM", "TarregaF", "PaganiniN", "GriegE", "DvorakA", "SibeliusJ",
  "RavelM", "FaureG", "SatieE", "BartokB", "ProkofievS", "ShostakovichD",
  "RachmaninoffS", "StravinskyI", "WagnerR", "VerdiG", "PucciniG",
  "BachCPE", "TelemannGP", "CorelliA", "PurcellH", "ByrdW", "DowlandJ",
];

const FILE_EXTS = /\.(pdf|ly|mid|midi|rdf|zip)$/i;

// Stats
let totalDownloaded = 0;
let totalBytes = 0;
let failedDownloads = 0;

// ---------------------------------------------------------------------------
// Curl helper
// ---------------------------------------------------------------------------
function curlFetch(url: string): string | null {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const r = spawnSync("curl", [
        "-sf", "--connect-timeout", "30", "--tls-max", "1.2", "--max-time", "60", url
      ], { encoding: "utf-8", timeout: 65000 });
      if (r.status === 0 && r.stdout) return r.stdout;
    } catch {}
    if (i < MAX_RETRIES - 1) {
      // brief pause before retry
      const start = Date.now(); while (Date.now() - start < 1000 * (i + 1)) {}
    }
  }
  return null;
}

function curlDownload(url: string, dest: string): boolean {
  mkdirSync(dirname(dest), { recursive: true });
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const r = spawnSync("curl", [
        "-sf", "--connect-timeout", "30", "--tls-max", "1.2", "--max-time", "90",
        url, "-o", dest
      ], { timeout: 95000 });
      if (r.status === 0 && existsSync(dest) && statSync(dest).size > 0) return true;
    } catch {}
    if (i < MAX_RETRIES - 1) {
      const start = Date.now(); while (Date.now() - start < 2000 * (i + 1)) {}
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------
function parseApacheListing(html: string): { dirs: string[]; files: string[] } {
  const dirs: string[] = [];
  const files: string[] = [];
  const linkRegex = /<a href="([^"]+)">([^<]*)<\/a>/g;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (href === "/ftp/" || href === "../" || href.startsWith("?") || href === "/") continue;
    const name = href.replace(/\/$/, "");
    if (href.endsWith("/")) {
      dirs.push(name);
    } else {
      files.push(name);
    }
  }
  return { dirs, files };
}

// ---------------------------------------------------------------------------
// Extract zips
// ---------------------------------------------------------------------------
function extractZips(rootDir: string): number {
  let count = 0;
  function walk(d: string) {
    if (!existsSync(d)) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = resolve(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.toLowerCase().endsWith(".zip")) {
        try {
          const destDir = full.replace(/\.zip$/i, "");
          mkdirSync(destDir, { recursive: true });
          const r = spawnSync("unzip", ["-o", full, "-d", destDir], { timeout: 60000 });
          if (r.status === 0) {
            count++;
            try { unlinkSync(full); } catch {}
          }
        } catch {}
      }
    }
  }
  walk(rootDir);
  return count;
}

// ---------------------------------------------------------------------------
// R2 Upload
// ---------------------------------------------------------------------------
async function uploadAllToR2(rootDir: string): Promise<{ uploaded: number; failed: number }> {
  let uploadScore: any;
  try {
    const mod = await import("../src/services/storage.ts");
    uploadScore = mod.uploadScore;
  } catch {
    console.log("  Storage module not available, skipping R2 upload");
    return { uploaded: 0, failed: 0 };
  }

  const contentTypes: Record<string, string> = {
    pdf: "application/pdf", mid: "audio/midi", midi: "audio/midi",
    ly: "text/plain", rdf: "application/rdf+xml",
  };

  let uploaded = 0;
  let failed = 0;

  // Collect all uploadable files
  const toUpload: { path: string; key: string; contentType: string }[] = [];
  function collect(d: string) {
    if (!existsSync(d)) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = resolve(d, entry.name);
      if (entry.isDirectory()) {
        collect(full);
      } else {
        const ext = entry.name.split(".").pop()?.toLowerCase() || "";
        if (["pdf", "mid", "midi", "ly", "rdf"].includes(ext)) {
          const rel = full.replace(rootDir, "").replace(/^\/+/, "");
          const key = `scores/${rel}`;
          const ct = contentTypes[ext] || "application/octet-stream";
          toUpload.push({ path: full, key, contentType: ct });
        }
      }
    }
  }
  collect(rootDir);

  console.log(`  ${toUpload.length} files to upload to R2`);

  // Upload in parallel batches
  for (let i = 0; i < toUpload.length; i += PARALLEL) {
    const batch = toUpload.slice(i, i + PARALLEL);
    const results = await Promise.all(
      batch.map(async (f) => {
        try {
          const buf = readFileSync(f.path);
          await uploadScore(f.key, buf, f.contentType);
          return true;
        } catch { return false; }
      })
    );
    uploaded += results.filter(Boolean).length;
    failed += results.filter(r => !r).length;

    if ((i / PARALLEL) % 5 === 0 || i + PARALLEL >= toUpload.length) {
      console.log(`  Upload progress: ${uploaded}/${toUpload.length} (${failed} failed)`);
    }
  }

  return { uploaded, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const skipUpload = args.includes("--skip-upload");

  let composerLimit = COMPOSERS.length;
  const limIdx = args.indexOf("--composer-limit");
  if (limIdx !== -1 && args[limIdx + 1]) {
    composerLimit = parseInt(args[limIdx + 1], 10);
  }

  const composersToProcess = COMPOSERS.slice(0, composerLimit);

  mkdirSync(OUT, { recursive: true });

  console.log("═══════════════════════════════════════════");
  console.log("NoteSnap — Mutopia Bulk Downloader");
  console.log("═══════════════════════════════════════════");
  console.log(`Composers: ${composersToProcess.length}`);
  console.log(`Parallel downloads: ${PARALLEL}`);
  console.log(`Output: ${OUT}`);
  console.log(`Upload to R2: ${skipUpload ? "SKIPPED" : "ENABLED"}`);
  console.log("");

  const startTime = Date.now();
  let totalPieces = 0;

  for (let ci = 0; ci < composersToProcess.length; ci++) {
    const composer = composersToProcess[ci];
    console.log(`[${ci + 1}/${composersToProcess.length}] ${composer}`);

    const composerUrl = `${BASE}/${composer}/`;
    const html = curlFetch(composerUrl);
    if (!html) {
      console.log(`  ✗ Failed to fetch composer listing`);
      continue;
    }

    const { dirs: catalogDirs } = parseApacheListing(html);
    console.log(`  ${catalogDirs.length} catalog entries`);

    // Collect all files to download for this composer
    const downloads: { url: string; dest: string }[] = [];

    for (const catalog of catalogDirs.slice(0, 100)) {
      const catUrl = `${BASE}/${composer}/${catalog}/`;
      const catHtml = curlFetch(catUrl);
      if (!catHtml) continue;

      const { dirs: pieceDirs, files: directFiles } = parseApacheListing(catHtml);

      if (pieceDirs.length > 0) {
        // 3-level: Composer/Catalog/PieceName/
        for (const piece of pieceDirs.slice(0, 10)) {
          const pieceUrl = `${BASE}/${composer}/${catalog}/${piece}/`;
          const pieceHtml = curlFetch(pieceUrl);
          if (!pieceHtml) continue;

          const { files: pieceFiles } = parseApacheListing(pieceHtml);
          const slugPiece = piece.replace(/[^a-zA-Z0-9_-]/g, "_");
          for (const f of pieceFiles) {
            if (!FILE_EXTS.test(f)) continue;
            const dest = `${OUT}/${composer}/${catalog}/${slugPiece}/${f}`;
            downloads.push({ url: `${BASE}/${composer}/${catalog}/${piece}/${f}`, dest });
          }
          totalPieces++;
        }
      }

      if (directFiles.length > 0) {
        // 2-level: Composer/Catalog/file
        for (const f of directFiles) {
          if (!FILE_EXTS.test(f)) continue;
          const dest = `${OUT}/${composer}/${catalog}/${f}`;
          downloads.push({ url: `${BASE}/${composer}/${catalog}/${f}`, dest });
        }
        if (directFiles.some(f => FILE_EXTS.test(f))) totalPieces++;
      }
    }

    console.log(`  → ${downloads.length} files to download`);

    // Download in parallel batches
    let compDone = 0;
    let compFailed = 0;
    for (let i = 0; i < downloads.length; i += PARALLEL) {
      const batch = downloads.slice(i, i + PARALLEL);
      const results = await Promise.all(
        batch.map(async (d) => {
          // Use sync in async wrapper to limit true parallelism
          return curlDownload(d.url, d.dest);
        })
      );
      compDone += results.filter(Boolean).length;
      compFailed += results.filter(r => !r).length;

      if ((i / PARALLEL) % 10 === 0 || i + PARALLEL >= downloads.length) {
        const pct = downloads.length > 0 ? Math.round(compDone / downloads.length * 100) : 100;
        console.log(`    ${pct}% (${compDone}/${downloads.length}) done, ${compFailed} failed`);
      }
    }

    totalDownloaded += compDone;
    failedDownloads += compFailed;

    // Calculate bytes for this composer
    function calcBytes(d: string): number {
      let bytes = 0;
      if (!existsSync(d)) return 0;
      try {
        for (const entry of readdirSync(d, { withFileTypes: true, recursive: true })) {
          if (entry.isFile()) {
            try { bytes += statSync(resolve(entry.parentPath || d, entry.name)).size; } catch {}
          }
        }
      } catch {}
      return bytes;
    }
    totalBytes += calcBytes(`${OUT}/${composer}`);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  ✓ composer done (${compDone} files). Running total: ${totalDownloaded} files, ${(totalBytes/1024/1024).toFixed(1)} MB, ${elapsed}s`);
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`Download Phase Complete`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`Files downloaded: ${totalDownloaded}`);
  console.log(`Failed: ${failedDownloads}`);
  console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Pieces covered: ${totalPieces}`);

  // Extract zips
  console.log(`\nExtracting zip files...`);
  const zipCount = extractZips(OUT);
  console.log(`${zipCount} zip files extracted`);

  // Count all files
  function countAllFiles(d: string): number {
    if (!existsSync(d)) return 0;
    let n = 0;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true, recursive: true })) {
        if (entry.isFile()) n++;
      }
    } catch {}
    return n;
  }
  const finalCount = countAllFiles(OUT);
  const finalSize = (() => {
    let s = 0;
    function sum(d: string) {
      if (!existsSync(d)) return;
      try {
        for (const e of readdirSync(d, { withFileTypes: true, recursive: true })) {
          if (e.isFile()) try { s += statSync(resolve(e.parentPath || d, e.name)).size; } catch {}
        }
      } catch {}
    }
    sum(OUT);
    return s;
  })();

  console.log(`Total files after extraction: ${finalCount}`);
  console.log(`Total size: ${(finalSize / 1024 / 1024).toFixed(1)} MB`);

  // Upload to R2
  if (!skipUpload) {
    console.log(`\nUploading to R2...`);
    const { uploaded, failed } = await uploadAllToR2(OUT);
    console.log(`R2 upload: ${uploaded} uploaded, ${failed} failed`);
  }

  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nDone in ${totalElapsed}s`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
