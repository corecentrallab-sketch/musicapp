/**
 * Migration: give the catalogue a place to keep NOTES (Stage 1 of the guitar plan).
 *
 * Until this build the catalogue stored no notes at all — `/api/pieces` returned eleven fields
 * and none of them was a note, a MIDI URL or an instrument (`catalog-handler.ts`). A TAB engine
 * cannot be fed a PDF: it needs the pitches and their timing, which is what a Standard MIDI File
 * carries. This migration adds the two pieces of schema that make that possible, and nothing
 * else:
 *
 *   1. `pieces.instrument` — the instrument the piece is written for ("Guitar", "Classical
 *      Guitar", …). A fact about the piece, so it belongs on the piece row; the app's
 *      all-genres / guitar surface needs it to resolve a guitar tile to real music instead of
 *      a dead end. Nullable: 536 existing rows have no instrument and must not be invented.
 *
 *   2. `piece_notes` — one row per piece's stored note set, with the licence evidence, the
 *      content-type facts and the R2 key recorded beside it. This is the provenance table: the
 *      gate's decision is reproducible from the row itself (see `pd-notes-gate.ts`).
 *
 * THE UNIQUENESS RULES ARE THE POINT.
 *   UNIQUE (source_platform, source_id) — one Mutopia piece can back at most one note set, so a
 *                                         re-run of the ingest is idempotent and two rows for
 *                                         the same source cannot both land.
 *   UNIQUE (piece_id)                  — one note set per catalogue piece. The catalogue's
 *                                         ~31 surplus rows came from duplicate title+composer
 *                                         groups; this build must not add to that, and the
 *                                         database is where that promise is enforced.
 * The planner in `pd-notes-gate.ts` refuses duplicates too — belt and braces, because a planner
 * bug must not become a data defect.
 *
 * Idempotent: safe to run repeatedly (IF NOT EXISTS everywhere, and the constraints are added
 * only when absent).
 *
 * Run:  cd /home/team/shared/site-fresh && set -a && . ./.env && set +a
 *       bun run scripts/migrate-piece-notes.ts
 */
import { neon } from "@neondatabase/serverless";

export const PIECE_NOTES_DDL = `
CREATE TABLE IF NOT EXISTS piece_notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id          uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  source_platform   text NOT NULL,
  source_id         text NOT NULL,
  identity_key      text NOT NULL,
  work_key          text NOT NULL,
  title             text NOT NULL,
  composer          text NOT NULL,
  composer_died     integer NOT NULL,
  instrument        text,
  licence_label     text NOT NULL,
  licence_evidence  jsonb NOT NULL,
  source_url        text NOT NULL,
  engraving_url     text,
  r2_key            text NOT NULL,
  public_url        text NOT NULL,
  content_type      text NOT NULL,
  bytes             integer NOT NULL,
  sha256            text NOT NULL,
  midi_format       integer NOT NULL,
  midi_tracks       integer NOT NULL,
  midi_division     integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT piece_notes_source_unique UNIQUE (source_platform, source_id),
  CONSTRAINT piece_notes_piece_unique  UNIQUE (piece_id)
)`;

export async function migrate(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  // 1. pieces.instrument — nullable, no default, so nothing is invented for existing rows.
  await sql`ALTER TABLE pieces ADD COLUMN IF NOT EXISTS instrument text`;

  // 2. piece_notes + its uniqueness rules.
  await sql.query(PIECE_NOTES_DDL);

  // 3. Lookups the API does on every catalog page: join piece_notes by piece_id.
  await sql`CREATE INDEX IF NOT EXISTS piece_notes_piece_id_idx ON piece_notes (piece_id)`;
  await sql`CREATE INDEX IF NOT EXISTS pieces_instrument_idx ON pieces (instrument)`;

  const state = (await sql`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_name = 'pieces' AND column_name = 'instrument') AS instrument_column,
      (SELECT count(*)::int FROM information_schema.tables
        WHERE table_name = 'piece_notes') AS piece_notes_table,
      (SELECT count(*)::int FROM pg_constraint WHERE conname = 'piece_notes_source_unique') AS source_unique,
      (SELECT count(*)::int FROM pg_constraint WHERE conname = 'piece_notes_piece_unique') AS piece_unique,
      (SELECT count(*)::int FROM piece_notes) AS note_rows
  `) as unknown as Array<Record<string, number>>;
  console.log("migration state:", JSON.stringify(state[0]));
}

if (import.meta.main) {
  migrate().catch((err) => {
    console.error("migration failed:", err);
    process.exit(1);
  });
}
