/**
 * Manual smoke check for the public catalog search (GET /api/pieces).
 *
 * Runs the REAL handler (src/services/catalog-handler.ts) against the database
 * in DATABASE_URL, so it exercises the same SQL the deployed endpoint runs —
 * which is the only way to catch the driver-side placeholder typing that made an
 * un-cast unaccent() placeholder fail with error 42883 on 2026-09-18.
 *
 *   bun run scripts/catalog-search-check.ts
 *
 * Read-only. Prints HTTP status + the first rows for a handful of queries;
 * expects them all to be 200 with sensible totals.
 */
import { handleCatalogList } from "../src/services/catalog-handler";

for (const url of [
  "http://x/api/pieces?q=fur",
  "http://x/api/pieces",
  "http://x/api/pieces?q=prelude&limit=3",
]) {
  try {
    const res = await handleCatalogList(new Request(url));
    const body = await res.text();
    console.log(`${url} -> ${res.status} ${body.slice(0, 220)}`);
  } catch (err) {
    console.log(`${url} -> THREW ${String(err)}`);
  }
}
