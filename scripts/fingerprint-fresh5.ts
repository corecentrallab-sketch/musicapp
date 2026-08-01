#!/usr/bin/env bun
// Fingerprint all MIDI files in fresh5, match against DB, insert into Postgres
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { neon } from "@neondatabase/serverless";

const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const MIDI_DIR = "/home/team/shared/mutopia-data/fresh5";
const DRY_RUN = process.argv.includes("--dry-run");
const sql = neon(process.env.DATABASE_URL!);

// Composer slug → DB composer name
const SLUG_TO_COMPOSER: Record<string, string> = {
  "BachJS": "johann sebastian bach",
  "BeethovenLv": "ludwig van beethoven",
  "MozartWA": "wolfgang amadeus mozart",
  "ChopinFF": "frédéric chopin",
  "SchubertF": "franz schubert",
  "BrahmsJ": "johannes brahms",
  "DebussyC": "claude debussy",
  "LisztF": "franz liszt",
  "HandelGF": "george frideric handel",
  "SchumannR": "robert schumann",
  "HaydnFJ": "joseph haydn",
  "MendelssohnF": "felix mendelssohn",
  "TchaikovskyPI": "pyotr ilyich tchaikovsky",
  "GriegE": "edvard grieg",
  "VivaldiA": "antonio vivaldi",
};

// Collect all MIDI files
function collectMidiFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.match(/\.(mid|midi)$/i)) {
      results.push(join(entry.parentPath || dir, entry.name));
    }
  }
  return results;
}

// Synthesize and fingerprint
function fingerprint(midiPath: string): { fp: number[]; dur: number } | null {
  const tmpDir = join(tmpdir(), `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    const wav = join(tmpDir, "out.wav");
    const r = spawnSync("fluidsynth", ["-ni", "-r", "16000", "-g", "2.0", "-F", wav, SF2, midiPath], {
      timeout: 120000, stdio: "pipe",
    });
    if (!existsSync(wav)) return null;
    
    const fpOut = spawnSync("fpcalc", ["-raw", "-length", "120", wav], {
      encoding: "utf-8", timeout: 30000,
    });
    if (fpOut.status !== 0 || !fpOut.stdout) return null;
    
    let dur = 0, fpRaw = "";
    for (const line of fpOut.stdout.split("\n")) {
      if (line.startsWith("DURATION=")) dur = parseFloat(line.slice(9));
      else if (line.startsWith("FINGERPRINT=")) fpRaw = line.slice(12);
    }
    if (!fpRaw) return null;
    
    const fp = fpRaw.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    return fp.length > 0 ? { fp, dur } : null;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// Match a Mutopia path to a DB piece
function matchPath(
  relPath: string, // "BachJS/BWV846/bwv846-prelude/bwv846-prelude.mid"
  pieces: { id: string; title: string; composer: string; catalog: string }[],
  composerName: string,
): string | null {
  const parts = relPath.split("/");
  const catalogDir = parts.length >= 2 ? parts[1]?.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const filename = basename(relPath).replace(/\.(mid|midi)$/i, "").toLowerCase();
  
  // Extract all text
  const allWords = parts.join(" ").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 1);
  
  const cands: { id: string; score: number }[] = [];
  for (const p of pieces) {
    const cat = (p.catalog || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const title = p.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    const titleWords = title.split(/\s+/).filter(w => w.length > 1);
    let score = 0;
    
    // Exact catalog match
    if (cat && catalogDir && cat === catalogDir) score += 100;
    // Catalog contains the directory or vice versa
    if (cat && catalogDir && (catalogDir.includes(cat) || cat.includes(catalogDir))) score += 60;
    // Numeric match
    const catNums = catalogDir.match(/\d+/g) || [];
    const pNums = (p.catalog || "").match(/\d+/g) || [];
    for (const cn of catNums) {
      if (pNums.includes(cn)) { score += 30; break; }
    }
    // Title word overlap
    const overlap = titleWords.filter(tw => allWords.some(aw => aw.includes(tw) || tw.includes(aw)));
    score += overlap.length * 15;
    // Filename contains title words
    for (const tw of titleWords) {
      if (filename.includes(tw)) score += 10;
    }
    
    if (score > 0) cands.push({ id: p.id, score });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.length > 0 && cands[0].score >= 25 ? cands[0].id : null;
}

async function main() {
  console.log("=== Fingerprint fresh5 MIDI files ===\n");
  
  // Load all pieces
  const allPieces = await sql`
    SELECT id, title, composer, catalog FROM pieces
    WHERE id NOT IN (SELECT DISTINCT piece_id FROM fingerprints)
  `;
  console.log(`[1] ${allPieces.length} pieces without fingerprints`);
  
  // Group by normalized composer
  const byComposer = new Map<string, { id: string; title: string; composer: string; catalog: string }[]>();
  for (const p of allPieces) {
    const c = (p.composer as string).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!byComposer.has(c)) byComposer.set(c, []);
    byComposer.get(c)!.push(p as any);
  }
  
  // Collect MIDI files
  const midiFiles = collectMidiFiles(MIDI_DIR);
  console.log(`[2] ${midiFiles.length} MIDI files found in fresh5`);
  
  // Match
  console.log("[3] Matching to database...");
  const matched: { path: string; pieceId: string }[] = [];
  let unmatched = 0;
  
  for (const mp of midiFiles) {
    const relPath = mp.replace(MIDI_DIR + "/", "");
    const slug = relPath.split("/")[0];
    const compName = SLUG_TO_COMPOSER[slug];
    if (!compName) { unmatched++; continue; }
    
    const pieces = byComposer.get(compName.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) || [];
    const id = matchPath(relPath, pieces, compName);
    if (id) {
      matched.push({ path: mp, pieceId: id });
    } else {
      unmatched++;
    }
  }
  
  const distinctPieces = new Set(matched.map(m => m.pieceId));
  console.log(`   Matched: ${matched.length} files → ${distinctPieces.size} distinct pieces`);
  console.log(`   Unmatched: ${unmatched}\n`);
  
  // Fingerprint
  console.log("[4] Fingerprinting...");
  let ok = 0, fail = 0;
  
  for (let i = 0; i < matched.length; i++) {
    const { path, pieceId } = matched[i];
    const fname = basename(path);
    const slug = path.replace(MIDI_DIR + "/", "").split("/")[0];
    process.stdout.write(`[${i+1}/${matched.length}] ${slug}/${fname.substring(0,40)}... `);
    
    const result = fingerprint(path);
    if (!result) { console.log("FAIL"); fail++; continue; }
    const { fp, dur } = result;
    
    if (DRY_RUN) {
      console.log(`DRY: ${fp.length} ints, ${dur.toFixed(1)}s`);
      ok++;
    } else {
      try {
        await sql`
          INSERT INTO fingerprints (piece_id, fingerprint, segment_start_s, segment_end_s)
          VALUES (${pieceId}, ${fp}, 0, ${Math.round(dur)})
        `;
        console.log(`OK (${fp.length} ints, ${dur.toFixed(1)}s)`);
        ok++;
      } catch (e: any) {
        console.log(`FAIL: ${e.message}`);
        fail++;
      }
    }
  }
  
  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`   MIDI files:        ${midiFiles.length}`);
  console.log(`   Matched to DB:     ${matched.length}`);
  console.log(`   Distinct pieces:   ${distinctPieces.size}`);
  console.log(`   Fingerprinted:     ${ok}`);
  console.log(`   Failed:            ${fail}`);
  
  const [{ count }] = await sql`SELECT COUNT(DISTINCT piece_id)::int as count FROM fingerprints`;
  console.log(`   DB total distinct: ${count}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
