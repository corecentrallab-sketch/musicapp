#!/usr/bin/env bun
// Fast parallel Mutopia MIDI crawler + downloader + fingerprinter
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { neon } from "@neondatabase/serverless";

const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const OUT = "/home/team/shared/mutopia-data/fresh2";
const BASE = "https://www.mutopiaproject.org/ftp";
const sql = neon(process.env.DATABASE_URL!);
const DRY_RUN = process.argv.includes("--dry-run");

// Composer map: DB composer name → Mutopia slug
const COMP_MAP: Record<string, string> = {
  "johann sebastian bach": "BachJS",
  "ludwig van beethoven": "BeethovenLv",
  "wolfgang amadeus mozart": "MozartWA",
  "frédéric chopin": "ChopinFF",
  "frederic chopin": "ChopinFF",
  "franz schubert": "SchubertF",
  "johannes brahms": "BrahmsJ",
  "claude debussy": "DebussyC",
  "franz liszt": "LisztF",
  "george frideric handel": "HandelGF",
  "robert schumann": "SchumannR",
  "joseph haydn": "HaydnFJ",
  "felix mendelssohn": "MendelssohnF",
  "pyotr ilyich tchaikovsky": "TchaikovskyPI",
  "edvard grieg": "GriegE",
  "antonio vivaldi": "VivaldiA",
  "domenico scarlatti": "ScarlattiD",
  "maurice ravel": "RavelM",
  "erik satie": "SatieE",
  "sergei rachmaninoff": "RachmaninoffS",
  "béla bartók": "BartokB",
  "bela bartok": "BartokB",
  "muzio clementi": "ClementiM",
  "antonín dvořák": "DvorakA",
  "antonin dvorak": "DvorakA",
  "isaac albéniz": "AlbenizIMF",
  "isaac albeniz": "AlbenizIMF",
  "gabriel fauré": "FaureG",
  "gabriel faure": "FaureG",
};

// Simple HTTP fetch
async function fetchPage(url: string): Promise<string | null> {
  const r = spawnSync("curl", ["-sf", "--connect-timeout", "10", "--max-time", "20", url], { 
    encoding: "utf-8", timeout: 25000 
  });
  return r.status === 0 && r.stdout ? r.stdout : null;
}

// Parse Apache listing into hrefs
function parseHrefs(html: string): { dirs: string[]; files: string[] } {
  const dirs: string[] = [], files: string[] = [];
  for (const m of html.matchAll(/<a href="([^"]+)">/g)) {
    const href = m[1];
    if (href === "../" || href === "/ftp/" || href.startsWith("?") || href === "/") continue;
    if (href.endsWith("/")) dirs.push(href.replace(/\/$/, ""));
    else files.push(href);
  }
  return { dirs, files };
}

// Download a file
async function downloadFile(url: string, dest: string): Promise<boolean> {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size > 0) return true;
  const r = spawnSync("curl", ["-sf", "--connect-timeout", "10", "--max-time", "60", url, "-o", dest], {
    timeout: 65000,
  });
  return r.status === 0 && existsSync(dest) && statSync(dest).size > 0;
}

// Synthesize and fingerprint
function fingerprint(midiPath: string): { fp: number[]; dur: number } | null {
  const tmpDir = join(tmpdir(), `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    const wav = join(tmpDir, "out.wav");
    spawnSync("fluidsynth", ["-ni", "-r", "16000", "-g", "2.0", "-F", wav, SF2, midiPath], {
      timeout: 120000, stdio: "pipe",
    });
    if (!existsSync(wav)) return null;
    const fpOut = spawnSync("fpcalc", ["-raw", "-length", "120", wav], {
      encoding: "utf-8", timeout: 30000,
    });
    if (fpOut.status !== 0) return null;
    let dur = 0, fpRaw = "";
    for (const line of fpOut.stdout!.split("\n")) {
      if (line.startsWith("DURATION=")) dur = parseFloat(line.slice(9));
      else if (line.startsWith("FINGERPRINT=")) fpRaw = line.slice(12);
    }
    if (!fpRaw) return null;
    const fp = fpRaw.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    return fp.length > 0 ? { fp, dur } : null;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Match a Mutopia path to a DB piece
function matchPath(mutopiaPath: string, pieces: { id: string; title: string; composer: string; catalog: string }[]): string | null {
  // mutopiaPath: "BachJS/BWV846/bwv846-prelude/bwv846-prelude.mid"
  const parts = mutopiaPath.split("/");
  const catalogDir = parts.length >= 2 ? parts[1].toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const filename = (parts.pop() || "").replace(/\.(mid|midi)$/i, "").toLowerCase();
  const allText = parts.join(" ").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  
  const cands: { id: string; score: number }[] = [];
  for (const p of pieces) {
    const cat = (p.catalog || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const title = p.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    let score = 0;
    if (cat && catalogDir && cat === catalogDir) score += 100;
    if (cat && catalogDir && catalogDir.includes(cat)) score += 60;
    if (cat && catalogDir && cat.includes(catalogDir)) score += 60;
    const catNums = catalogDir.match(/\d+/g) || [];
    const pNums = (p.catalog || "").match(/\d+/g) || [];
    for (const cn of catNums) if (pNums.includes(cn)) score += 30;
    const titleWords = title.split(/\s+/).filter((w: string) => w.length > 2);
    for (const tw of titleWords) if (filename.includes(tw)) score += 15;
    if (score > 0) cands.push({ id: p.id, score });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.length > 0 && cands[0].score >= 30 ? cands[0].id : null;
}

async function main() {
  console.log("=== Fast Mutopia MIDI Ingest ===\n");

  // 1. Load DB
  const allPieces = await sql`
    SELECT id, title, composer, catalog FROM pieces
    WHERE id NOT IN (SELECT DISTINCT piece_id FROM fingerprints)
  `;
  console.log(`[1] ${allPieces.length} pieces without fingerprints`);

  // Group by composer
  const byComposer = new Map<string, { id: string; title: string; composer: string; catalog: string }[]>();
  for (const p of allPieces) {
    const c = (p.composer as string).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!byComposer.has(c)) byComposer.set(c, []);
    byComposer.get(c)!.push(p as any);
  }

  // 2. Crawl top composers in parallel (depth 2: composer → piece dir → subdirs)
  console.log("[2] Crawling Mutopia for MIDI files...");
  
  interface MidiFile { url: string; localPath: string; mutopiaRelPath: string; composer: string; }
  const midis: MidiFile[] = [];

  // Prioritize: only crawl composers with many pieces
  const topComposers = [...byComposer.entries()]
    .filter(([c]) => COMP_MAP[c])
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20); // Top 20 composers

  for (const [composer, pieces] of topComposers) {
    const slug = COMP_MAP[composer];
    const url = `${BASE}/${slug}/`;
    process.stdout.write(`  ${slug} (${pieces.length} pieces)... `);
    
    const html = await fetchPage(url);
    if (!html) { console.log("FAIL"); continue; }
    const { dirs } = parseHrefs(html);
    
    const pieceUrls = dirs.slice(0, 40).map(d => `${url}${d}/`); // Cap per composer
    
    // Fetch piece directories in parallel (4 at a time)
    const batchSize = 4;
    for (let i = 0; i < pieceUrls.length; i += batchSize) {
      const batch = pieceUrls.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(pu => fetchPage(pu)));
      
      for (let j = 0; j < batch.length; j++) {
        const ph = results[j];
        if (!ph) continue;
        const piecePath = batch[j].replace(BASE + "/", "");
        const { dirs: subdirs, files } = parseHrefs(ph);
        
        // MIDI files at this level
        for (const f of files) {
          if (!/\.(mid|midi)$/i.test(f)) continue;
          const fullUrl = batch[j] + f;
          const relPath = piecePath + f;
          midis.push({ url: fullUrl, localPath: `${OUT}/${relPath}`, mutopiaRelPath: relPath, composer });
        }
        
        // MIDI in subdirectories (1 level deeper)
        for (const sd of subdirs.slice(0, 5)) {
          const sdUrl = batch[j] + sd + "/";
          const sdHtml = await fetchPage(sdUrl);
          if (!sdHtml) continue;
          const { files: sdFiles } = parseHrefs(sdHtml);
          for (const f of sdFiles) {
            if (!/\.(mid|midi)$/i.test(f)) continue;
            const fullUrl = sdUrl + f;
            const relPath = piecePath + sd + "/" + f;
            midis.push({ url: fullUrl, localPath: `${OUT}/${relPath}`, mutopiaRelPath: relPath, composer });
          }
        }
      }
    }
    console.log(`${midis.filter(m => m.composer === composer).length} found (total: ${midis.length})`);
  }

  console.log(`\n  Total MIDI files discovered: ${midis.length}\n`);

  // 3. Download in parallel
  console.log("[3] Downloading...");
  let dlNew = 0, dlHad = 0, dlFail = 0;
  const dlBatchSize = 10;
  for (let i = 0; i < midis.length; i += dlBatchSize) {
    const batch = midis.slice(i, i + dlBatchSize);
    const results = await Promise.all(batch.map(m => downloadFile(m.url, m.localPath)));
    for (const r of results) {
      if (r === true) {
        if (existsSync(batch[results.indexOf(r)]?.localPath)) dlHad++; else dlNew++;
      } else dlFail++;
    }
    if ((i / dlBatchSize) % 5 === 0) process.stdout.write(`  ${Math.round(i/midis.length*100)}%\r`);
  }
  console.log(`  Done. ${dlNew} new, ${dlHad} had, ${dlFail} failed\n`);

  // 4. Match
  console.log("[4] Matching to DB pieces...");
  const matched: { midi: MidiFile; pieceId: string }[] = [];
  for (const m of midis) {
    if (!existsSync(m.localPath)) continue;
    const pieces = byComposer.get(m.composer) || [];
    const id = matchPath(m.mutopiaRelPath, pieces);
    if (id) matched.push({ midi: m, pieceId: id });
  }
  const distinctPieces = new Set(matched.map(m => m.pieceId));
  console.log(`  Matched: ${matched.length} files → ${distinctPieces.size} distinct pieces\n`);

  // 5. Fingerprint
  console.log("[5] Fingerprinting...");
  let fpOk = 0, fpFail = 0;
  for (let i = 0; i < matched.length; i++) {
    const { midi, pieceId } = matched[i];
    const fname = midi.mutopiaRelPath.split("/").pop()!;
    process.stdout.write(`[${i+1}/${matched.length}] ${fname}... `);
    
    const result = fingerprint(midi.localPath);
    if (!result) { console.log("FAIL"); fpFail++; continue; }
    const { fp, dur } = result;
    
    if (DRY_RUN) {
      console.log(`DRY: ${fp.length} ints, ${dur.toFixed(1)}s`);
      fpOk++;
    } else {
      try {
        await sql`
          INSERT INTO fingerprints (piece_id, fingerprint, segment_start_s, segment_end_s, duration_s)
          VALUES (${pieceId}, ${fp}, 0, ${Math.round(dur)}, ${Math.round(dur)})
        `;
        console.log(`OK (${fp.length} ints, ${dur.toFixed(1)}s)`);
        fpOk++;
      } catch (e: any) {
        console.log(`FAIL: ${e.message}`);
        fpFail++;
      }
    }
  }

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`  MIDI found:     ${midis.length}`);
  console.log(`  Matched:        ${matched.length}`);
  console.log(`  Pieces matched: ${distinctPieces.size}`);
  console.log(`  Fingerprinted:  ${fpOk}`);
  console.log(`  FP failed:      ${fpFail}`);
  
  const [{ count }] = await sql`SELECT COUNT(DISTINCT piece_id)::int as count FROM fingerprints`;
  console.log(`  DB total distinct: ${count}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
