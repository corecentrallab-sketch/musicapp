/**
 * Create the anonymous `events` table used by POST /api/events (v47.2
 * instrumentation, owner ruling 2026-10-30: anonymous event logging ships
 * BEFORE launch, on our own Vercel + Neon).
 *
 * Why a script and not a request-time migration: the handler must never issue
 * DDL on a user request (the same rule `scripts/enable-unaccent.ts` follows).
 * This is the repo's migration convention — a small idempotent `scripts/*.ts`
 * that runs against whatever `DATABASE_URL` is in `.env`/the environment.
 *
 * Run it (idempotent — safe to re-run, safe on a restored database):
 *
 *   cd /home/team/shared/site-fresh && bun scripts/migrate-events-table.ts
 *
 * It prints the table's real column list and indexes afterwards, so the run is
 * its own evidence that the table exists. Exit code 1 if anything is missing.
 *
 * WHAT THIS TABLE MAY NEVER HOLD: no email, no person name, no phone, no
 * address, no IP, no user agent, no free text, no audio, no score or lyric
 * content. The only identity is a random per-install id the app generates on
 * first launch and stores locally; there are no accounts and no cross-device
 * identity. `props` is a small flat object of primitives, validated in
 * `src/services/events-handler.ts` before a row is ever written.
 */
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — nothing to do.");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

/**
 * Statements run ONE AT A TIME: the Neon HTTP driver sends a single query per
 * request, so a multi-statement string is not portable across drivers.
 * Every statement is `IF NOT EXISTS`, so the whole script is idempotent.
 */
const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "table events",
    sql: `CREATE TABLE IF NOT EXISTS events (
      id bigserial PRIMARY KEY,
      install_id text NOT NULL,
      name text NOT NULL,
      props jsonb NOT NULL DEFAULT '{}'::jsonb,
      app_version text,
      build_number text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  },
  {
    label: "index events (name, created_at)",
    sql: `CREATE INDEX IF NOT EXISTS events_name_created_at_idx
            ON events (name, created_at)`,
  },
  {
    label: "index events (install_id, created_at)",
    sql: `CREATE INDEX IF NOT EXISTS events_install_id_created_at_idx
            ON events (install_id, created_at)`,
  },
  {
    // Carries the no-PII rule into the database itself, where a future reader
    // (or a future migration author) will see it next to the columns.
    label: "comment on events",
    sql: `COMMENT ON TABLE events IS
      'Anonymous product events (v47.2). NO personal data: no email, name, phone, address, IP, user agent, audio, score or lyric content. Identity is a random per-install id only.'`,
  },
];

for (const statement of STATEMENTS) {
  console.log(`applying: ${statement.label}`);
  await sql.query(statement.sql);
}

const columns = (await sql.query(
  `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
    ORDER BY ordinal_position`,
)) as unknown as Array<{
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}>;

const indexes = (await sql.query(
  `SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'events'
    ORDER BY indexname`,
)) as unknown as Array<{ indexname: string; indexdef: string }>;

console.log("\ninformation_schema.columns (public.events):");
for (const c of columns) {
  console.log(
    `  ${c.column_name.padEnd(14)} ${c.data_type.padEnd(26)} null=${c.is_nullable} default=${c.column_default ?? "—"}`,
  );
}
console.log("\npg_indexes (public.events):");
for (const i of indexes) console.log(`  ${i.indexdef}`);

/** The columns the endpoint and the plan require, by name. */
const REQUIRED = [
  "id",
  "install_id",
  "name",
  "props",
  "app_version",
  "build_number",
  "created_at",
];
const missing = REQUIRED.filter(
  (name) => !columns.some((c) => c.column_name === name),
);
if (missing.length > 0) {
  console.error(`\nFAILED: events is missing columns: ${missing.join(", ")}`);
  process.exit(1);
}
const missingIndex = [
  "events_name_created_at_idx",
  "events_install_id_created_at_idx",
].filter((name) => !indexes.some((i) => i.indexname === name));
if (missingIndex.length > 0) {
  console.error(`\nFAILED: missing indexes: ${missingIndex.join(", ")}`);
  process.exit(1);
}
console.log("\nOK: events table + both indexes exist.");
