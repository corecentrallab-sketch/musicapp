#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// catalog-cleanup-2026-08.ts — One-off catalog repair (delegation 2026-08-12).
//
//  1. Fix Debussy Deux Arabesques catalog: L. 75 -> L. 66 (Lesure catalogue).
//  2. Insert 4 missing pieces (verified against local Mutopia .rdf metadata
//     and live Mutopia FTP dirs):
//       - Tchaikovsky  Op. 39 No. 5  "March of the Wooden Soldiers"
//       - Schumann     Op. 15 No. 2  Kinderszenen — Kuriose Geschichte
//       - Schumann     Op. 68 No. 2  Album for the Young — Soldatenmarsch
//       - Chopin       Op. 10 No. 9  Étude in F Minor
//     Each gets a matching sheet_music_sources row (platform 'mutopia',
//     format 'pdf', arrangement 'piano') pointing at the live piece dir.
//
// Idempotent: skips pieces that already exist (matched by composer+catalog).
// Run:  bun run scripts/catalog-cleanup-2026-08.ts
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const NEW_PIECES = [
  {
    title: "Children's Album — March of the Wooden Soldiers",
    composer: "Pyotr Ilyich Tchaikovsky",
    catalog: "Op. 39 No. 5",
    genre: "Romantic",
    difficulty: 2,
    mutopiaUrl: "https://www.mutopiaproject.org/ftp/TchaikovskyPI/O39/05MarchOfTheWoodenSoldiers/",
  },
  {
    title: "Kinderszenen — Kuriose Geschichte",
    composer: "Robert Schumann",
    catalog: "Op. 15 No. 2",
    genre: "Romantic",
    difficulty: 3,
    mutopiaUrl: "https://www.mutopiaproject.org/ftp/SchumannR/O15/SchumannOp15No02/",
  },
  {
    title: "Album for the Young — Soldatenmarsch",
    composer: "Robert Schumann",
    catalog: "Op. 68 No. 2",
    genre: "Romantic",
    difficulty: 1,
    mutopiaUrl: "https://www.mutopiaproject.org/ftp/SchumannR/O68/schumann-op68-02-marche-militaire/",
  },
  {
    title: "Étude in F Minor",
    composer: "Frédéric Chopin",
    catalog: "Op. 10 No. 9",
    genre: "Romantic",
    difficulty: 9,
    mutopiaUrl: "https://www.mutopiaproject.org/ftp/ChopinFF/O10/chopin-op-10-09-wfi/",
  },
];

async function main() {
  // --- 1. Arabesque catalog fix ---
  const fixed = await sql`
    UPDATE pieces SET catalog = 'L. 66'
    WHERE composer ILIKE '%debussy%' AND catalog = 'L. 75'
    RETURNING id, title, catalog
  `;
  console.log(`[1/3] Debussy Arabesque catalog fix: ${fixed.length} row(s) updated`);
  for (const r of fixed) console.log(`      ${r.title} -> ${r.catalog}`);

  // --- 2. Insert missing pieces + mutopia source rows ---
  let added = 0;
  for (const p of NEW_PIECES) {
    const existing = await sql`
      SELECT id FROM pieces
      WHERE composer = ${p.composer} AND catalog = ${p.catalog}
    `;
    if (existing.length > 0) {
      console.log(`[2/3] SKIP (exists): ${p.composer} ${p.catalog}`);
      continue;
    }
    const inserted = await sql`
      INSERT INTO pieces (title, composer, catalog, genre, difficulty, sheet_music_url)
      VALUES (${p.title}, ${p.composer}, ${p.catalog}, ${p.genre}, ${p.difficulty}, ${p.mutopiaUrl})
      RETURNING id, title, catalog
    `;
    const pieceId = (inserted[0] as any).id as string;
    await sql`
      INSERT INTO sheet_music_sources
        (piece_id, source_platform, source_url, format, arrangement_type, is_primary, is_flagged)
      VALUES (${pieceId}::uuid, 'mutopia', ${p.mutopiaUrl}, 'pdf', 'piano', true, false)
    `;
    await sql`
      INSERT INTO curation_log (piece_id, action, source_platform, details)
      VALUES (${pieceId}::uuid, 'catalog-add', 'mutopia',
              ${JSON.stringify({ source: "catalog-cleanup-2026-08.ts", url: p.mutopiaUrl, verified: true })})
    `;
    console.log(`[2/3] ADDED: ${p.composer} ${p.catalog} -> ${(inserted[0] as any).title}`);
    added++;
  }

  // --- 3. Summary counts ---
  const counts = await sql`
    SELECT
      (SELECT count(*) FROM pieces) AS pieces,
      (SELECT count(DISTINCT piece_id) FROM fingerprints) AS fingerprinted,
      (SELECT count(*) FROM sheet_music_sources) AS sms
  `;
  console.log(`[3/3] Added ${added} piece(s). DB now:`, counts[0]);

  // Sanity: no L.75 Arabesques left
  const bad = await sql`
    SELECT count(*)::int AS n FROM pieces
    WHERE composer ILIKE '%debussy%' AND catalog = 'L. 75'
  `;
  if ((bad[0] as any).n > 0) console.error("WARNING: L.75 rows still exist!");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
