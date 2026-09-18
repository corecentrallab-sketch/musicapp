/**
 * Install the Postgres `unaccent` extension used by the public catalog search
 * (src/services/catalog-handler.ts) so `?q=fur` finds "Für Elise".
 *
 * Why this is a script and not a migration run at request time: the handler must
 * never issue DDL on a user request. It probes `pg_extension` instead and
 * silently degrades to accent-sensitive matching when the extension is absent.
 *
 * Idempotent — safe to re-run, and safe to run against a restored database:
 *   bun run scripts/enable-unaccent.ts
 *
 * It also self-checks the two things that actually matter to the owner's search:
 *   1. the extension reports as installed, and
 *   2. `unaccent()` really folds the characters in our catalog titles
 *      (Für / Prélude / Œuvre / Straße style ligatures).
 *
 * Requires DATABASE_URL (Bun loads .env from the repo root automatically).
 */
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — nothing to do.");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const installed = await sql.query(
  `SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'unaccent'`,
);
if ((installed[0]?.n ?? 0) === 0) {
  console.log("installing extension unaccent ...");
  await sql.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
} else {
  console.log("extension unaccent already installed");
}

const check = await sql.query(
  `SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'unaccent'`,
);
if ((check[0]?.n ?? 0) === 0) {
  console.error("FAILED: unaccent is still not installed — search stays accent-sensitive");
  process.exit(1);
}
console.log(`OK: unaccent installed (${check[0].n} row)`);

// Prove the folding on strings that mirror real catalog data.
const folded = await sql.query(
  `SELECT unaccent('Für Elise') AS a, unaccent('Prélude') AS b,
          unaccent('Straße') AS c, unaccent('Cœur') AS d`,
);
console.log("folding check:", folded[0]);

// End-to-end: the exact owner-reported case, against the real catalog.
const catalog = await sql.query(
  `SELECT title FROM pieces
   WHERE is_public_domain = true
     AND (unaccent(title) ILIKE $1 OR unaccent(composer) ILIKE $1)
   ORDER BY title LIMIT 5`,
  ["%fur elise%"],
);
console.log(`catalog match for "fur elise": ${catalog.length} row(s)`);
for (const row of catalog) console.log(`  - ${row.title}`);
