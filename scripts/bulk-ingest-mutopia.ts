#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// bulk-ingest-mutopia.ts — Crawl Mutopia FTP for MIDI files, download them,
// match against our pieces DB with enhanced fuzzy matching, then synthesize
// to WAV and fingerprint into Postgres.
//
// Usage: bun run scripts/bulk-ingest-mutopia.ts [--dry-run] [--no-download]
// ---------------------------------------------------------------------------
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MUTOPIA = "https://www.mutopiaproject.org/ftp";
const OUT = "/home/team/shared/mutopia-data";
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const DRY_RUN = process.argv.includes("--dry-run");
const NO_DOWNLOAD = process.argv.includes("--no-download");
const sql = neon(process.env.DATABASE_URL!);

// Map our composer names (lowercase) to Mutopia directory slugs
const COMPOSER_TO_MUTOPIA: Record<string, string> = {
  "johann sebastian bach": "BachJS",
  "ludwig van beethoven": "BeethovenLv",
  "wolfgang amadeus mozart": "MozartWA",
  "frédéric chopin": "ChopinFF",
  "frederic chopin": "ChopinFF",
  "claude debussy": "DebussyC",
  "franz schubert": "SchubertF",
  "johannes brahms": "BrahmsJ",
  "george frideric handel": "HandelGF",
  "joseph haydn": "HaydnFJ",
  "franz liszt": "LisztF",
  "felix mendelssohn": "MendelssohnF",
  "robert schumann": "SchumannR",
  "pyotr ilyich tchaikovsky": "TchaikovskyPI",
  "antonio vivaldi": "VivaldiA",
  "domenico scarlatti": "ScarlattiD",
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
  "sergei rachmaninoff": "RachmaninoffS",
  "richard wagner": "WagnerR",
  "giuseppe verdi": "VerdiG",
  "giacomo puccini": "PucciniG",
  "carl philipp emanuel bach": "BachCPE",
  "georg philipp telemann": "TelemannGP",
  "arcangelo corelli": "CorelliA",
  "henry purcell": "PurcellH",
  "william byrd": "ByrdW",
  "john dowland": "DowlandJ",
  "carl czerny": "CzernyC",
  "muzio clementi": "ClementiM",
  "scott joplin": "JoplinS",
  "edward elgar": "ElgarE",
  "camille saint-saëns": "SaintSaensC",
  "giovanni battista pergolesi": "PergolesiGB",
  "jean-philippe rameau": "RameauJP",
  "césar franck": "FranckC",
  "françois couperin": "CouperinF",
  "anton diabelli": "DiabelliA",
  "john field": "FieldJ",
  "jacques offenbach": "OffenbachJ",
  "friedrich burgmüller": "BurgmullerJFF",
  "léo delibes": "DelibesL",
  "johann strauss ii": "StraussJ2",
};

// Stats
let downloaded = 0;
let alreadyHad = 0;
let downloadFailed = 0;
let fingerprinted = 0;
let fpFailed = 0;
let matchedPieces = 0;
let unmatchedPieces = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function curlFetch(url: string): string | null {
  const r = spawnSync("curl", [
    "-sf", "--connect-timeout", "15", "--tls-max", "1.2", "--max-time", "30", url
  ], { encoding: "utf-8", timeout: 35000 });
  return r.status === 0 && r.stdout ? r.stdout : null;
}

function curlDownload(url: string, dest: string): boolean {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size > 0) {
    alreadyHad++;
    return true;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = spawnSync("curl", [
      "-sf", "--connect-timeout", "15", "--tls-max", "1.2", "--max-time", "60",
      url, "-o", dest
    ], { timeout: 65000 });
    if (r.status === 0 && existsSync(dest) && statSync(dest).size > 0) {
      downloaded++;
      return true;
    }
    // Brief pause before retry
    const t = Date.now(); while (Date.now() - t < 1000) {}
  }
  downloadFailed++;
  return false;
}

// Parse Apache autoindex listing
function parseListing(html: string): { dirs: string[]; files: string[] } {
  const dirs: string[] = [];
  const files: string[] = [];
  const re = /<a href="([^"]+)">/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (href === "../" || href === "/ftp/" || href.startsWith("?") || href === "/") continue;
    const name = href.replace(/\/$/, "");
    if (href.endsWith("/")) dirs.push(name);
    else files.push(name);
  }
  return { dirs, files };
}

// Recursively find all MIDI files under a Mutopia composer directory
function findMidiFiles(composerSlug: string): string[] {
  const midiUrls: string[] = [];
  const seen = new Set<string>();

  function crawl(url: string, maxDepth: number) {
    if (maxDepth <= 0) return;
    const html = curlFetch(url);
    if (!html) return;
    const { dirs, files } = parseListing(html);

    for (const f of files) {
      if (/\.(mid|midi)$/i.test(f)) {
        const fullUrl = url + f;
        if (!seen.has(fullUrl)) {
          seen.add(fullUrl);
          midiUrls.push(fullUrl);
        }
      }
    }

    for (const d of dirs) {
      crawl(url + d + "/", maxDepth - 1);
    }
  }

  crawl(`${MUTOPIA}/${composerSlug}/`, 3);
  return midiUrls;
}

// ---------------------------------------------------------------------------
// Enhanced matching
// ---------------------------------------------------------------------------
interface DBPiece {
  id: string;
  title: string;
  composer: string;
  catalog: string;
}

// Normalize a string for comparison
function norm(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract numbers from a string
function extractNums(s: string): number[] {
  return (s.match(/\d+/g) || []).map(Number);
}

// Extract words from a string
function extractWords(s: string): string[] {
  return norm(s).split(/\s+/).filter(w => w.length > 1);
}

// Match a Mutopia MIDI filename/directory against DB pieces
function matchPiece(midiUrl: string, allPieces: DBPiece[]): DBPiece | null {
  // Extract info from the URL
  // Pattern: .../ComposerSlug/dir1/dir2/.../filename.mid
  const urlPath = midiUrl.replace(MUTOPIA + "/", "");
  const parts = urlPath.split("/");
  const filename = basename(midiUrl).replace(/\.(mid|midi)$/i, "");
  
  // Collect all text tokens from URL path
  const allTokens = parts.map(p => norm(p)).join(" ");
  const allWords = extractWords(allTokens);
  const allNums = extractNums(allTokens);
  const filenameWords = extractWords(filename);
  
  // Get the "catalog" directory (usually second-level dir like "BWV846" or "Op28")
  const catalogDir = parts.length >= 2 ? parts[1] : null;
  const catalogNorm = catalogDir ? norm(catalogDir) : "";
  const catalogNums = catalogDir ? extractNums(catalogDir) : [];
  
  // Score each piece
  let bestScore = 0;
  let bestPiece: DBPiece | null = null;
  
  for (const piece of allPieces) {
    const pTitle = norm(piece.title);
    const pComposer = norm(piece.composer);
    const pCatalog = norm(piece.catalog || "");
    const pTitleWords = extractWords(pTitle);
    const pCatalogNums = extractNums(piece.catalog || "");
    
    let score = 0;
    
    // 1. Catalog number match: most reliable
    if (catalogNums.length > 0 && pCatalogNums.length > 0) {
      for (const cn of catalogNums) {
        if (pCatalogNums.includes(cn)) {
          score += 50;
          break;
        }
      }
    }
    
    // 2. Catalog string match
    if (catalogNorm && pCatalog && catalogNorm.includes(pCatalog) || pCatalog.includes(catalogNorm)) {
      score += 40;
    }
    
    // Catalog prefix match (e.g., "o" prefix matches "op")
    const catPrefix = catalogDir ? catalogDir.replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, 2) : "";
    const pCatPrefix = (piece.catalog || "").replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, 2);
    if (catPrefix && pCatPrefix && catPrefix[0] === pCatPrefix[0]) {
      score += 10;
    }
    
    // 3. Title word overlap
    const titleOverlap = pTitleWords.filter(w => allWords.includes(w) || filenameWords.includes(w));
    score += titleOverlap.length * 15;
    
    // 4. Composer check (URL already filtered by composer, but verify)
    // The composer slug tells us which composer this is — bonus
    const composerSlug = parts[0]; // "BachJS", "BeethovenLv", etc.
    
    // 5. Exact title substring match
    if (pTitle && allTokens.includes(pTitle)) {
      score += 30;
    }
    
    // 6. Opus/No./BWV exact match — extra strong
    if (catalogNorm && pCatalog === catalogNorm) {
      score += 80;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestPiece = piece;
    }
  }
  
  // Require minimum score for confident match
  return bestScore >= 20 ? bestPiece : null;
}

// ---------------------------------------------------------------------------
// Fingerprint helpers
// ---------------------------------------------------------------------------
function synthesizeAndFingerprint(midiPath: string, wavPath: string): { fingerprint: number[]; duration: number } | null {
  try {
    // Step 1: fluidsynth MIDI → WAV (16kHz, mono)
    spawnSync("fluidsynth", [
      "-ni", "-r", "16000", "-g", "2.0", "-F", wavPath, SF2, midiPath
    ], { timeout: 120000, stdio: "pipe" });
    
    if (!existsSync(wavPath)) return null;
    
    // Step 2: fpcalc on the WAV
    const fpOut = spawnSync("fpcalc", ["-raw", "-length", "120", wavPath], {
      encoding: "utf-8", timeout: 30000,
    });
    
    if (fpOut.status !== 0 || !fpOut.stdout) return null;
    
    // Parse fpcalc output
    let duration = 0;
    let fpRaw = "";
    for (const line of fpOut.stdout.split("\n")) {
      if (line.startsWith("DURATION=")) duration = parseFloat(line.substring(9));
      else if (line.startsWith("FINGERPRINT=")) fpRaw = line.substring(12);
    }
    
    if (!fpRaw) return null;
    
    const fingerprint = fpRaw.trim()
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));
    
    if (fingerprint.length === 0) return null;
    return { fingerprint, duration };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== NoteSnap Bulk MIDI Ingest from Mutopia ===\n");
  
  // 1. Load all pieces from DB
  console.log("[1/6] Loading pieces from database...");
  const allPieces = await sql`
    SELECT id, title, composer, catalog 
    FROM pieces 
    WHERE id NOT IN (SELECT DISTINCT piece_id FROM fingerprints)
    ORDER BY composer, title
  `;
  console.log(`   ${allPieces.length} pieces without fingerprints\n`);
  
  // Group pieces by composer
  const piecesByComposer = new Map<string, DBPiece[]>();
  for (const p of allPieces) {
    const c = norm(p.composer);
    if (!piecesByComposer.has(c)) piecesByComposer.set(c, []);
    piecesByComposer.get(c)!.push(p as any);
  }
  
  // Find which composers we have Mutopia mappings for
  const composersToCrawl: { name: string; slug: string; pieceCount: number }[] = [];
  for (const [composer, pieces] of piecesByComposer) {
    const slug = COMPOSER_TO_MUTOPIA[composer];
    if (slug) {
      composersToCrawl.push({ name: composer, slug, pieceCount: pieces.length });
    }
  }
  composersToCrawl.sort((a, b) => b.pieceCount - a.pieceCount);
  console.log(`   ${composersToCrawl.length} composers with Mutopia mappings`);
  console.log(`   ${allPieces.length - composersToCrawl.reduce((s, c) => s + c.pieceCount, 0)} pieces from unmapped composers\n`);
  
  // 2. Crawl Mutopia for MIDI files
  console.log("[2/6] Discovering MIDI files on Mutopia...");
  interface MidiToDownload { url: string; dest: string; composer: string; }
  const allMidiFiles: MidiToDownload[] = [];
  
  for (const comp of composersToCrawl) {
    process.stdout.write(`   ${comp.slug} (${comp.pieceCount} pieces)... `);
    const urls = findMidiFiles(comp.slug);
    console.log(`${urls.length} MIDI files found`);
    
    for (const url of urls) {
      const relativePath = url.replace(MUTOPIA + "/", "");
      const dest = `${OUT}/${relativePath}`;
      allMidiFiles.push({ url, dest, composer: comp.name });
    }
  }
  console.log(`\n   Total MIDI files discovered: ${allMidiFiles.length}\n`);
  
  // 3. Download (or use local if --no-download)
  if (!NO_DOWNLOAD) {
    console.log("[3/6] Downloading MIDI files...");
    for (let i = 0; i < allMidiFiles.length; i++) {
      const { url, dest, composer } = allMidiFiles[i];
      if ((i + 1) % 25 === 0 || i === allMidiFiles.length - 1) {
        process.stdout.write(`   [${i + 1}/${allMidiFiles.length}] downloaded:${downloaded} had:${alreadyHad} fail:${downloadFailed}\r`);
      }
      curlDownload(url, dest);
    }
    console.log(`\n   Done. ${downloaded} new, ${alreadyHad} already had, ${downloadFailed} failed\n`);
  } else {
    console.log("[3/6] Skipping download (--no-download)\n");
  }
  
  // 4. Match MIDI files to DB pieces
  console.log("[4/6] Matching MIDI files to database pieces...");
  const matched: { midi: MidiToDownload; piece: DBPiece }[] = [];
  const unmatched: MidiToDownload[] = [];
  
  for (const midi of allMidiFiles) {
    const composerPieces = piecesByComposer.get(midi.composer) || [];
    const piece = matchPiece(midi.url, composerPieces);
    if (piece) {
      matched.push({ midi, piece });
    } else {
      unmatched.push(midi);
    }
  }
  
  console.log(`   Matched: ${matched.length}, Unmatched: ${unmatched.length}`);
  const matchedPieceIds = new Set(matched.map(m => m.piece.id));
  console.log(`   Distinct pieces matched: ${matchedPieceIds.size}\n`);
  
  // 5. Fingerprint
  console.log("[5/6] Synthesizing and fingerprinting...");
  const sf2Exists = existsSync(SF2);
  console.log(`   SoundFont: ${sf2Exists ? "found" : "NOT FOUND"} at ${SF2}`);
  
  for (let i = 0; i < matched.length; i++) {
    const { midi, piece } = matched[i];
    const dest = midi.dest;
    
    if (!existsSync(dest)) {
      fpFailed++;
      continue;
    }
    
    const progress = `[${i + 1}/${matched.length}]`;
    process.stdout.write(`${progress} ${basename(dest)} ... `);
    
    const tmpDir = mkdtempSync(join(tmpdir(), "fp-"));
    try {
      const wavPath = join(tmpDir, "output.wav");
      const result = synthesizeAndFingerprint(dest, wavPath);
      
      if (!result) {
        console.log("FAILED: fpcalc/synthesis error");
        fpFailed++;
        continue;
      }
      
      const { fingerprint, duration } = result;
      
      if (DRY_RUN) {
        console.log(`DRY RUN: ${fingerprint.length} ints, ${duration.toFixed(1)}s → ${piece.catalog || piece.title}`);
        fingerprinted++;
      } else {
        await sql`
          INSERT INTO fingerprints (piece_id, fingerprint, segment_start_s, segment_end_s, duration_s)
          VALUES (${piece.id}, ${fingerprint}, 0, ${Math.round(duration)}, ${Math.round(duration)})
        `;
        console.log(`OK (${fingerprint.length} ints, ${duration.toFixed(1)}s → ${piece.catalog || piece.title.substring(0, 30)})`);
        fingerprinted++;
        matchedPieces++;
      }
    } catch (err: any) {
      console.log(`FAILED: ${err?.message || err}`);
      fpFailed++;
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
  
  // 6. Summary
  console.log("\n[6/6] Summary");
  console.log(`   Downloaded:      ${downloaded}`);
  console.log(`   Previously had:  ${alreadyHad}`);
  console.log(`   Download failed: ${downloadFailed}`);
  console.log(`   Total MIDI:      ${allMidiFiles.length}`);
  console.log(`   Matched to DB:   ${matched.length}`);
  console.log(`   Unmatched:       ${unmatched.length}`);
  console.log(`   Fingerprinted:   ${fingerprinted}`);
  console.log(`   FP failed:       ${fpFailed}`);
  
  if (!DRY_RUN) {
    const [{ count }] = await sql`SELECT COUNT(DISTINCT piece_id)::int as count FROM fingerprints`;
    console.log(`\n   Total distinct pieces with fingerprints in DB: ${count}`);
  }
  
  if (unmatched.length > 0 && unmatched.length <= 30) {
    console.log(`\n   Unmatched files:`);
    unmatched.forEach(u => console.log(`     - ${u.url}`));
  } else if (unmatched.length > 30) {
    console.log(`\n   (${unmatched.length} unmatched — too many to list)`);
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
