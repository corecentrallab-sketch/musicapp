#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// ingest-local-mutopia.ts — Fingerprint locally downloaded Mutopia MIDIs.
//
// Walks the local Mutopia mirror (/home/team/shared/mutopia-data) and matches
// each MIDI against UNFINGERPRINTED DB pieces using COMPOSER-SCOPED matching
// (the reliable matchers already in this repo):
//
//   - fresh5/<ComposerSlug>/... paths  → matchPath() from
//     scripts/fingerprint-fresh5.ts (slug → composer, threshold 25)
//   - <CatalogDir>/... top-level paths → matchPiece() from
//     scripts/bulk-ingest-mutopia.ts (threshold 20), scoped to the composer
//     inferred from composer-name tokens in the filename/path. If no composer
//     can be inferred the MIDI is SKIPPED (the composer-agnostic matcher is
//     deliberately NOT used — it mislabels on cross-composer catalog
//     collisions, e.g. Chopin Op.10 vs Beethoven Op.10).
//
// Then synthesizes to a 16kHz mono WAV with fluidsynth and fingerprints with
// fpcalc (same pipeline as the recognition service: fpcalc -raw -length 120
// on 16kHz mono PCM).
//
// Usage:
//   bun run scripts/ingest-local-mutopia.ts [--dry-run] [--limit N] [--json-out PATH]
//
// Prerequisites:
//   - fluidsynth + FluidR3_GM.sf2 at /usr/share/sounds/sf2/FluidR3_GM.sf2
//   - fpcalc in PATH (bundled copy: .vercel/output/functions/render.func/fpcalc)
//   - DATABASE_URL set
// ---------------------------------------------------------------------------
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const OUT = "/home/team/shared/mutopia-data";
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1], 10) || Infinity : Infinity;
const JSON_OUT_ARG = process.argv.indexOf("--json-out");
const JSON_OUT = JSON_OUT_ARG >= 0 ? process.argv[JSON_OUT_ARG + 1] : null;
const MANIFEST_ARG = process.argv.indexOf("--manifest");
const MANIFEST = MANIFEST_ARG >= 0 ? process.argv[MANIFEST_ARG + 1] : null;

const sql = neon(process.env.DATABASE_URL!);

// ---------------------------------------------------------------------------
// Composer slug map — verbatim from scripts/fingerprint-fresh5.ts
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Matcher #1 — verbatim matchPath() from scripts/fingerprint-fresh5.ts
// (relPath like "BachJS/BWV846/bwv846-prelude/bwv846-prelude.mid")
// ---------------------------------------------------------------------------
function matchPathFresh5(
  relPath: string,
  pieces: { id: string; title: string; composer: string; catalog: string }[],
): { id: string; title: string; composer: string; catalog: string } | null {
  const parts = relPath.split("/");
  const catalogDir = parts.length >= 2 ? parts[1]?.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const filename = basename(relPath).replace(/\.(mid|midi)$/i, "").toLowerCase();

  const allWords = parts.join(" ").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 1);

  const cands: { p: { id: string; title: string; composer: string; catalog: string }; score: number }[] = [];
  for (const p of pieces) {
    const cat = (p.catalog || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const title = p.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    const titleWords = title.split(/\s+/).filter(w => w.length > 1);
    let score = 0;

    if (cat && catalogDir && cat === catalogDir) score += 100;
    if (cat && catalogDir && (catalogDir.includes(cat) || cat.includes(catalogDir))) score += 60;
    const catNums = catalogDir.match(/\d+/g) || [];
    const pNums = (p.catalog || "").match(/\d+/g) || [];
    for (const cn of catNums) {
      if (pNums.includes(cn)) { score += 30; break; }
    }
    const overlap = titleWords.filter(tw => allWords.some(aw => aw.includes(tw) || tw.includes(aw)));
    score += overlap.length * 15;
    for (const tw of titleWords) {
      if (filename.includes(tw)) score += 10;
    }

    if (score > 0) cands.push({ p, score });
  }
  cands.sort((a, b) => b.score - a.score);
  if (cands.length > 0 && cands[0].score >= 25) {
    const c = cands[0].p;
    return { id: c.id, title: c.title, composer: c.composer, catalog: c.catalog || "" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matcher #2 — verbatim matchPiece() from scripts/bulk-ingest-mutopia.ts
// (composer-scoped; midiUrl-style path)
// ---------------------------------------------------------------------------
function norm(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNums(s: string): number[] {
  return (s.match(/\d+/g) || []).map(Number);
}

function extractWords(s: string): string[] {
  return norm(s).split(/\s+/).filter(w => w.length > 1);
}

function matchPiece(midiUrl: string, allPieces: { id: string; title: string; composer: string; catalog: string }[]): { id: string; title: string; composer: string; catalog: string } | null {
  const urlPath = midiUrl;
  const parts = urlPath.split("/");
  const filename = basename(midiUrl).replace(/\.(mid|midi)$/i, "");

  const allTokens = parts.map(p => norm(p)).join(" ");
  const allWords = extractWords(allTokens);
  const allNums = extractNums(allTokens);
  const filenameWords = extractWords(filename);

  const catalogDir = parts.length >= 2 ? parts[1] : null;
  const catalogNorm = catalogDir ? norm(catalogDir) : "";
  const catalogNums = catalogDir ? extractNums(catalogDir) : [];

  let bestScore = 0;
  let bestPiece: { id: string; title: string; composer: string; catalog: string } | null = null;

  for (const piece of allPieces) {
    const pTitle = norm(piece.title);
    const pComposer = norm(piece.composer);
    const pCatalog = norm(piece.catalog || "");
    const pTitleWords = extractWords(pTitle);
    const pCatalogNums = extractNums(piece.catalog || "");

    let score = 0;

    if (catalogNums.length > 0 && pCatalogNums.length > 0) {
      for (const cn of catalogNums) {
        if (pCatalogNums.includes(cn)) {
          score += 50;
          break;
        }
      }
    }

    if (catalogNorm && pCatalog && catalogNorm.includes(pCatalog) || pCatalog.includes(catalogNorm)) {
      score += 40;
    }

    const catPrefix = catalogDir ? catalogDir.replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, 2) : "";
    const pCatPrefix = (piece.catalog || "").replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, 2);
    if (catPrefix && pCatPrefix && catPrefix[0] === pCatPrefix[0]) {
      score += 10;
    }

    const titleOverlap = pTitleWords.filter(w => allWords.includes(w) || filenameWords.includes(w));
    score += titleOverlap.length * 15;

    const composerSlug = parts[0];

    if (pTitle && allTokens.includes(pTitle)) {
      score += 30;
    }

    if (catalogNorm && pCatalog === catalogNorm) {
      score += 80;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPiece = piece;
    }
  }

  return bestScore >= 20 ? bestPiece : null;
}

// ---------------------------------------------------------------------------
// Composer inference for top-level dirs (no slug in path)
// ---------------------------------------------------------------------------
const normComposer = (s: string) => norm(s);
/** Return the composer whose name appears in the path, or null if 0 or 2+ match. */
function inferComposerFromPath(
  relPath: string,
  allPieces: { id: string; title: string; composer: string; catalog: string }[],
): string | null {
  const pathNorm = norm(relPath.replace(/\.(mid|midi)$/i, ""));
  const composers = new Map<string, number>(); // normalized composer → count
  for (const p of allPieces) {
    const cn = normComposer(p.composer);
    // Surname-ish tokens: skip generic words that appear in paths
    const tokens = cn.split(/\s+/).filter(t => t.length >= 4);
    let found = false;
    for (const t of tokens) {
      if (pathNorm.includes(t)) { found = true; break; }
    }
    if (found) composers.set(cn, (composers.get(cn) || 0) + 1);
  }
  if (composers.size === 1) return composers.keys().next().value as string;
  return null;
}

// ---------------------------------------------------------------------------
// Fingerprint helpers — same pipeline as ingest-fingerprints.ts
// ---------------------------------------------------------------------------

/** Parse fpcalc -raw output: handles both space- and comma-separated ints */
function parseFpcalcOutput(output: string): { fingerprint: number[]; duration: number } {
  let duration = 0;
  let fpRaw = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("DURATION=")) duration = parseFloat(line.substring(9));
    else if (line.startsWith("FINGERPRINT=")) fpRaw = line.substring(12);
  }
  if (!fpRaw) throw new Error("fpcalc output missing FINGERPRINT line");
  const fingerprint = fpRaw.trim()
    .split(/[\s,]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));
  if (fingerprint.length === 0) throw new Error("fpcalc produced empty fingerprint");
  return { fingerprint, duration };
}

/** Synthesize MIDI to 16kHz mono WAV, then fpcalc it */
function fingerprintMidi(midiPath: string, wavPath: string): { fingerprint: number[]; duration: number } {
  execSync(
    `fluidsynth -ni -r 16000 -g 2.0 -F "${wavPath}" "${SF2}" "${midiPath}"`,
    { timeout: 90000, stdio: "pipe" }
  );
  const fpOut = execSync(`fpcalc -raw -length 120 "${wavPath}"`, {
    encoding: "utf8",
    timeout: 30000,
  });
  return parseFpcalcOutput(fpOut);
}

/** Insert a fingerprint row (same statement as ingest-fingerprints.ts) */
async function insertFingerprint(
  pieceId: string,
  fingerprint: number[],
  duration: number,
): Promise<void> {
  const arrayLiteral = `{${fingerprint.join(",")}}`;
  await sql`
    INSERT INTO fingerprints (piece_id, segment_start_s, segment_end_s, fingerprint)
    VALUES (${pieceId}::uuid, 0, ${duration}, ${arrayLiteral}::bigint[])
  `;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function walkMidis(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkMidis(full));
    } else if (/\.(mid|midi)$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  console.log("=== NoteSnap Local Mutopia Fingerprint Ingestion ===\n");

  // Manifest mode: skip matching, fingerprint exactly the curated rows
  // [{ midi, piece_id, catalog, composer, title }]
  if (MANIFEST) {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
    console.log(`[manifest] ${manifest.length} curated rows from ${MANIFEST}`);
    const rows = manifest.map((m: any) => ({
      midiPath: `${OUT}/${m.midi}`,
      rel: m.midi,
      piece: { id: m.piece_id, title: m.title, composer: m.composer, catalog: m.catalog },
    }));
    if (DRY_RUN) {
      rows.forEach((r: any) => console.log(`  would fingerprint ${r.piece.catalog} <= ${r.rel}`));
      console.log("\nDRY RUN — nothing written");
      return;
    }
    console.log(`\nSynthesizing + fingerprinting ${rows.length} pieces...`);
    let ok = 0, fail = 0;
    const failures: { rel: string; reason: string }[] = [];
    const results: { rel: string; title: string; composer: string; catalog: string; ints: number; duration: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const { midiPath, rel, piece } = rows[i];
      process.stdout.write(`[${i + 1}/${rows.length}] ${piece.catalog} ... `);
      const tmpDir = mkdtempSync(join(tmpdir(), "fp-manifest-"));
      try {
        const wavPath = join(tmpDir, "output.wav");
        const { fingerprint, duration } = fingerprintMidi(midiPath, wavPath);
        await insertFingerprint(piece.id, fingerprint, duration);
        console.log(`OK (${fingerprint.length} ints, ${duration.toFixed(1)}s)`);
        ok++;
        results.push({ rel, title: piece.title, composer: piece.composer, catalog: piece.catalog, ints: fingerprint.length, duration });
      } catch (err: any) {
        const reason = err?.message || String(err);
        console.log(`FAILED: ${reason}`);
        fail++;
        failures.push({ rel, reason });
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
    console.log(`\nSummary: ${ok} fingerprinted, ${fail} failed`);
    if (failures.length) failures.forEach((f) => console.log(`  - ${f.rel}: ${f.reason}`));
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ results, failures }, null, 2));
    if (ok > 0) {
      const [{ count }] = await sql`SELECT COUNT(DISTINCT piece_id)::int as count FROM fingerprints`;
      console.log(`\nTotal distinct pieces with fingerprints in DB: ${count}`);
    }
    return;
  }

  const allMidi = walkMidis(OUT).sort();
  console.log(`[1/6] Found ${allMidi.length} MIDI files under ${OUT}`);

  const allPieces = await sql`
    SELECT id, title, composer, catalog
    FROM pieces
    WHERE id NOT IN (SELECT DISTINCT piece_id FROM fingerprints)
    ORDER BY composer, title
  `;
  const pieces = allPieces as { id: string; title: string; composer: string; catalog: string }[];
  console.log(`[2/6] ${pieces.length} unfingerprinted pieces loaded from DB`);

  // Group unfingerprinted pieces by normalized composer
  const byComposer = new Map<string, { id: string; title: string; composer: string; catalog: string }[]>();
  for (const p of pieces) {
    const c = normComposer(p.composer);
    if (!byComposer.has(c)) byComposer.set(c, []);
    byComposer.get(c)!.push(p);
  }

  const toProcess = LIMIT < allMidi.length ? allMidi.slice(0, LIMIT) : allMidi;

  // Match each MIDI with composer-scoped matchers
  const matched: { midiPath: string; rel: string; piece: { id: string; title: string; composer: string; catalog: string }; source: string }[] = [];
  const skipped: { rel: string; reason: string }[] = [];

  for (const midiPath of toProcess) {
    const rel = midiPath.replace(OUT + "/", "");
    const parts = rel.split("/");
    const slug = parts[0];

    if (slug === "fresh5") {
      // fresh5 layout: fresh5/<ComposerSlug>/<CatalogDir>/.../file.mid
      const compName = SLUG_TO_COMPOSER[parts[1] || ""];
      if (!compName) { skipped.push({ rel, reason: "unknown slug" }); continue; }
      const cnorm = normComposer(compName);
      const cands = byComposer.get(cnorm) || [];
      const piece = matchPathFresh5(rel.replace(/^fresh5\//, ""), cands);
      if (piece) matched.push({ midiPath, rel, piece, source: "fresh5" });
      else skipped.push({ rel, reason: "no fresh5 match (>=25)" });
      continue;
    }

    // Top-level layout: <CatalogDir>/.../file.mid — infer composer from path
    const compNorm = inferComposerFromPath(rel, pieces);
    if (!compNorm) { skipped.push({ rel, reason: "ambiguous composer" }); continue; }
    const cands = byComposer.get(compNorm) || [];
    if (cands.length === 0) { skipped.push({ rel, reason: "composer has no unfingerprinted pieces" }); continue; }
    const piece = matchPiece(rel, cands);
    if (piece) matched.push({ midiPath, rel, piece, source: "top-level" });
    else skipped.push({ rel, reason: `no match (>=20) in ${compNorm}` });
  }

  // Dedupe by piece (keep first — files are sorted, deterministic)
  const seenPieces = new Set<string>();
  const deduped = matched.filter(m => {
    if (seenPieces.has(m.piece.id)) return false;
    seenPieces.add(m.piece.id);
    return true;
  });

  console.log(`[3/6] Matched: ${deduped.length} distinct pieces (${matched.length} file-level matches)`);
  console.log(`       Skipped: ${skipped.length}`);
  const skippedComposerAmbiguous = skipped.filter(s => s.reason === "ambiguous composer").length;
  console.log(`         - ambiguous composer (skipped): ${skippedComposerAmbiguous}`);
  console.log(`         - no match / other: ${skipped.length - skippedComposerAmbiguous}`);
  console.log();
  console.log("       Matched pieces:");
  for (const m of deduped) {
    console.log(`         ${(m.piece.catalog || m.piece.title).padEnd(28)} | ${m.piece.composer.padEnd(24)} | ${m.source.padEnd(9)} | ${m.rel}`);
  }

  if (DRY_RUN) {
    console.log(`\n[4/6] DRY RUN — would fingerprint ${deduped.length} pieces (nothing written)`);
    return;
  }

  console.log(`\n[4/6] Synthesizing + fingerprinting ${deduped.length} pieces...`);
  let succeeded = 0;
  let failed = 0;
  const failures: { rel: string; reason: string }[] = [];
  const results: { rel: string; title: string; composer: string; catalog: string; ints: number; duration: number }[] = [];

  for (let i = 0; i < deduped.length; i++) {
    const { midiPath, rel, piece } = deduped[i];
    const progress = `[${i + 1}/${deduped.length}]`;
    process.stdout.write(`${progress} ${piece.catalog || piece.title} ... `);

    const tmpDir = mkdtempSync(join(tmpdir(), "fp-local-"));
    try {
      const wavPath = join(tmpDir, "output.wav");
      const { fingerprint, duration } = fingerprintMidi(midiPath, wavPath);
      await insertFingerprint(piece.id, fingerprint, duration);
      console.log(`OK (${fingerprint.length} ints, ${duration.toFixed(1)}s)`);
      succeeded++;
      results.push({ rel, title: piece.title, composer: piece.composer, catalog: piece.catalog, ints: fingerprint.length, duration });
    } catch (err: any) {
      const reason = err?.message || String(err);
      console.log(`FAILED: ${reason}`);
      failed++;
      failures.push({ rel, reason });
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ matched: results, failures, skipped }, null, 2));
    console.log(`\n   JSON out: ${JSON_OUT}`);
  }

  console.log(`\n[5/6] Summary`);
  console.log(`   MIDI files scanned: ${toProcess.length}`);
  console.log(`   Matched pieces:     ${deduped.length}`);
  console.log(`   Fingerprinted:      ${succeeded}`);
  console.log(`   Failed:             ${failed}`);
  if (failures.length > 0) {
    console.log(`   Failures:`);
    failures.forEach((f) => console.log(`     - ${f.rel}: ${f.reason}`));
  }
  if (succeeded > 0) {
    const [{ count }] = await sql`SELECT COUNT(DISTINCT piece_id)::int as count FROM fingerprints`;
    console.log(`\n[6/6] Total distinct pieces with fingerprints in DB: ${count}`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
