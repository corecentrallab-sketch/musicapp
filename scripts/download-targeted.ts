#!/usr/bin/env bun
/**
 * Targeted Mutopia downloader — reads target-500.csv, maps composers to 
 * Mutopia slugs, constructs direct catalog URLs, downloads in parallel.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const OUT = "/home/team/shared/mutopia-data";
const PARALLEL = 8;
const CSV_PATH = resolve(import.meta.dir || ".", "target-500-clean.csv");

// Map CSV composer names to Mutopia directory slugs
const COMPOSER_MAP: Record<string, string> = {
  "johann sebastian bach": "BachJS",
  "ludwig van beethoven": "BeethovenLv",
  "wolfgang amadeus mozart": "MozartWA",
  "frédéric chopin": "ChopinFF",
  "frederic chopin": "ChopinFF",
  "claude debussy": "DebussyC",
  "franz schubert": "SchubertF",
  "johannes brahms": "BrahmsJ",
  "george frideric handel": "HandelGF",
  "franz joseph haydn": "HaydnFJ",
  "franz liszt": "LisztF",
  "felix mendelssohn": "MendelssohnF",
  "robert schumann": "SchumannR",
  "pyotr ilyich tchaikovsky": "TchaikovskyPI",
  "antonio vivaldi": "VivaldiA",
  "domenico scarlatti": "ScarlattiD",
  "giovanni pierluigi da palestrina": "PalestrinaG",
  "claudio monteverdi": "MonteverdiC",
  "johann pachelbel": "PachelbelJ",
  "dieterich buxtehude": "BuxtehudeD",
  "isaac albéniz": "AlbenizIMF",
  "isaac albeniz": "AlbenizIMF",
  "dionisio aguado": "AguadoD",
  "fernando sor": "SorF",
  "mauro giuliani": "GiulianiM",
  "matteo carcassi": "CarcassiM",
  "francisco tárrega": "TarregaF",
  "francisco tarrega": "TarregaF",
  "niccolò paganini": "PaganiniN",
  "niccolo paganini": "PaganiniN",
  "edvard grieg": "GriegE",
  "antonín dvořák": "DvorakA",
  "antonin dvorak": "DvorakA",
  "jean sibelius": "SibeliusJ",
  "maurice ravel": "RavelM",
  "gabriel fauré": "FaureG",
  "gabriel faure": "FaureG",
  "erik satie": "SatieE",
  "béla bartók": "BartokB",
  "bela bartok": "BartokB",
  "sergei prokofiev": "ProkofievS",
  "dmitri shostakovich": "ShostakovichD",
  "sergei rachmaninoff": "RachmaninoffS",
  "igor stravinsky": "StravinskyI",
  "richard wagner": "WagnerR",
  "giuseppe verdi": "VerdiG",
  "giacomo puccini": "PucciniG",
  "carl philipp emanuel bach": "BachCPE",
  "georg philipp telemann": "TelemannGP",
  "arcangelo corelli": "CorelliA",
  "henry purcell": "PurcellH",
  "william byrd": "ByrdW",
  "john dowland": "DowlandJ",
};

// ---------------------------------------------------------------------------
// Curl helpers
// ---------------------------------------------------------------------------
function curlFetch(url: string): string | null {
  const r = spawnSync("curl", [
    "-sf", "--connect-timeout", "20", "--tls-max", "1.2", "--max-time", "45", url
  ], { encoding: "utf-8", timeout: 50000 });
  return r.status === 0 && r.stdout ? r.stdout : null;
}

function curlDownload(url: string, dest: string): boolean {
  mkdirSync(dirname(dest), { recursive: true });
  
  // Skip if already exists and non-empty
  if (existsSync(dest) && statSync(dest).size > 0) return true;
  
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = spawnSync("curl", [
      "-sf", "--connect-timeout", "20", "--tls-max", "1.2", "--max-time", "90",
      url, "-o", dest
    ], { timeout: 95000 });
    if (r.status === 0 && existsSync(dest) && statSync(dest).size > 0) return true;
    if (attempt < 2) {
      // Sleep briefly
      const t = Date.now(); while (Date.now() - t < 1500) {}
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Parse Apache listing
// ---------------------------------------------------------------------------
function parseListing(html: string): { dirs: string[]; files: string[] } {
  const dirs: string[] = [];
  const files: string[] = [];
  const re = /<a href="([^"]+)">([^<]*)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (href === "/ftp/" || href === "../" || href.startsWith("?") || href === "/") continue;
    const name = href.replace(/\/$/, "");
    if (href.endsWith("/")) dirs.push(name);
    else files.push(name);
  }
  return { dirs, files };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Parse CSV
  const csv = readFileSync(CSV_PATH, "utf-8");
  const lines = csv.trim().split("\n");
  const header = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/"/g, ""));
  const composerIdx = header.indexOf("composer");
  const catalogIdx = header.indexOf("catalog");
  const titleIdx = header.indexOf("title");

  if (composerIdx === -1 || titleIdx === -1) {
    console.error("CSV must have composer and title columns");
    process.exit(1);
  }

  // Parse pieces
  interface Piece { composer: string; catalog: string; title: string; mutopiaSlug: string; catalogSlug: string; }
  const pieces: Piece[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const composerFull = (cols[composerIdx] || "").trim();
    const catalog = (cols[catalogIdx] || "").trim();
    const title = (cols[titleIdx] || "").trim();
    if (!composerFull || !title) continue;

    const composerLower = composerFull.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // strip accents
    const mutopiaSlug = COMPOSER_MAP[composerLower];
    if (!mutopiaSlug) continue;

    // Catalog: "BWV 846" → "BWV846", "Op. 28" → "Op28", "K. 545" → "K545"
    let catalogSlug = catalog.replace(/\s+/g, "").replace(/\./g, "");
    
    pieces.push({ composer: composerFull, catalog, title, mutopiaSlug, catalogSlug });
  }

  console.log(`Parsed ${pieces.length} pieces with Mutopia composer mappings`);
  console.log("");

  mkdirSync(OUT, { recursive: true });

  // Build download list
  const downloads: { url: string; dest: string; piece: Piece }[] = [];
  let catalogsFound = 0;
  let catalogsNotFound = 0;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const catUrl = `https://www.mutopiaproject.org/ftp/${piece.mutopiaSlug}/${piece.catalogSlug}/`;
    
    const html = curlFetch(catUrl);
    if (!html) {
      catalogsNotFound++;
      continue;
    }

    const { dirs: pieceDirs, files: directFiles } = parseListing(html);
    catalogsFound++;

    if (pieceDirs.length > 0) {
      // Has subdirectories - crawl each
      for (const pd of pieceDirs.slice(0, 5)) {
        const pieceUrl = `https://www.mutopiaproject.org/ftp/${piece.mutopiaSlug}/${piece.catalogSlug}/${pd}/`;
        const ph = curlFetch(pieceUrl);
        if (!ph) continue;
        const { files: pf } = parseListing(ph);
        const safePiece = pd.replace(/[^a-zA-Z0-9_-]/g, "_");
        for (const f of pf) {
          if (!/\.(pdf|ly|mid|midi|rdf|zip)$/i.test(f)) continue;
          downloads.push({
            url: `${pieceUrl}${f}`,
            dest: `${OUT}/${piece.mutopiaSlug}/${piece.catalogSlug}/${safePiece}/${f}`,
            piece,
          });
        }
      }
    }

    // Direct files at catalog level
    for (const f of directFiles) {
      if (!/\.(pdf|ly|mid|midi|rdf|zip)$/i.test(f)) continue;
      downloads.push({
        url: `${catUrl}${f}`,
        dest: `${OUT}/${piece.mutopiaSlug}/${piece.catalogSlug}/${f}`,
        piece,
      });
    }

    // Progress indicator
    if ((i + 1) % 50 === 0) {
      console.log(`  Scanned ${i + 1}/${pieces.length}... found ${downloads.length} files so far (${catalogsFound} catalogs hit)`);
    }
  }

  console.log(`\nCatalog hits: ${catalogsFound}, misses: ${catalogsNotFound}`);
  console.log(`Files to download: ${downloads.length}`);

  if (downloads.length === 0) {
    console.log("Nothing to download!");
    return;
  }

  // Download in parallel batches
  console.log(`\nDownloading ${downloads.length} files with ${PARALLEL} workers...`);
  let done = 0, failed = 0;
  const start = Date.now();

  for (let i = 0; i < downloads.length; i += PARALLEL) {
    const batch = downloads.slice(i, i + PARALLEL);
    const results = await Promise.all(
      batch.map(d => Promise.resolve(curlDownload(d.url, d.dest)))
    );
    done += results.filter(Boolean).length;
    failed += results.filter(r => !r).length;

    if ((i / PARALLEL) % 10 === 0 || i + PARALLEL >= downloads.length) {
      const pct = Math.round((i + batch.length) / downloads.length * 100);
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  [${pct}%] ${done}/${downloads.length} done, ${failed} failed, ${elapsed}s`);
    }
  }

  // Extract zips
  console.log("\nExtracting zip files...");
  let zipCount = 0;
  function extractZips(dir: string) {
    if (!existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) extractZips(full);
      else if (e.name.toLowerCase().endsWith(".zip")) {
        const destDir = full.replace(/\.zip$/i, "");
        mkdirSync(destDir, { recursive: true });
        const r = spawnSync("unzip", ["-o", full, "-d", destDir], { timeout: 60000 });
        if (r.status === 0) { zipCount++; try { unlinkSync(full); } catch {} }
      }
    }
  }
  extractZips(OUT);
  console.log(`  ${zipCount} zips extracted`);

  // Stats
  function countFiles(dir: string): number {
    if (!existsSync(dir)) return 0;
    let n = 0;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true, recursive: true }))
        if (e.isFile()) n++;
    } catch {}
    return n;
  }
  function totalSize(dir: string): number {
    let s = 0;
    if (!existsSync(dir)) return 0;
    try {
      for (const e of readdirSync(dir, { withFileTypes: true, recursive: true }))
        if (e.isFile()) try { s += statSync(resolve(e.parentPath || dir, e.name)).size; } catch {}
    } catch {}
    return s;
  }

  const fc = countFiles(OUT);
  const ts = totalSize(OUT);
  const elapsed = Math.round((Date.now() - start) / 1000);

  console.log(`\n=== Summary ===`);
  console.log(`Files downloaded: ${done}`);
  console.log(`Failed: ${failed}`);
  console.log(`Catalogs hit: ${catalogsFound} / ${pieces.length} pieces`);
  console.log(`Total files on disk: ${fc}`);
  console.log(`Total size: ${(ts / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Time: ${elapsed}s`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
