// ---------------------------------------------------------------------------
// build-melody-skeletons.ts — populate the `melody_skeletons` table from ABC.
//
// Phase 1 source: the bundled public-domain ABC seeds (MELODY_SEEDS, mirrored
// from the app's notation-editor bundle). Later phases can extend this to ingest
// the full catalog's ABC by feeding the `--abcFile` path or extending MELODY_SEEDS.
//
// Run:  bun scripts/build-melody-skeletons.ts   (requires DATABASE_URL)
// ---------------------------------------------------------------------------
import { MELODY_SEEDS } from "../src/services/hum/melody-seeds";
import { skeletonFromAbc } from "../src/services/hum/skeleton";
import { sql } from "../src/db";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — cannot connect to Neon.");
    process.exit(1);
  }
  // Ensure the table exists.
  await sql()`CREATE TABLE IF NOT EXISTS melody_skeletons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    piece_id UUID REFERENCES pieces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    composer TEXT NOT NULL,
    abc TEXT NOT NULL,
    deltas INTEGER[] NOT NULL,
    pitches INTEGER[] NOT NULL,
    source TEXT DEFAULT 'abc',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (piece_id)
  )`;

  let inserted = 0;
  for (const seed of MELODY_SEEDS) {
    const sk = skeletonFromAbc(seed.abc, {
      pieceId: seed.pieceId,
      title: seed.title,
      composer: seed.composer,
    });
    if (sk.deltas.length === 0) {
      console.warn(`[skel] skip ${seed.pieceId}: no intervals derived`);
      continue;
    }
    // Try to link to an existing pieces row by title match (best-effort);
    // otherwise insert with a null piece_id (still usable by /api/hum).
    const pieces = (await sql()`SELECT id FROM pieces WHERE lower(title) = lower(${seed.title}) LIMIT 1`) as unknown as Array<{ id: string }>;
    const pieceId = pieces.length > 0 ? pieces[0].id : null;
    await sql()`INSERT INTO melody_skeletons (piece_id, title, composer, abc, deltas, pitches)
      VALUES (${pieceId}, ${seed.title}, ${seed.composer}, ${seed.abc}, ${sk.deltas.map(Math.round)}, ${sk.pitches.map(Math.round)})
      ON CONFLICT (piece_id) DO UPDATE
        SET abc = EXCLUDED.abc, deltas = EXCLUDED.deltas, pitches = EXCLUDED.pitches, title = EXCLUDED.title, composer = EXCLUDED.composer`;
    inserted++;
    console.log(`[skel] + ${seed.pieceId} (${seed.title}) deltas=${sk.deltas.length} piece_id=${String(pieceId)}`);
  }
  console.log(`[skel] done: ${inserted}/${MELODY_SEEDS.length} skeletons upserted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
