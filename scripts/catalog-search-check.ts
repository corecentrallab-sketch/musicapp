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
 * Read-only. Prints HTTP status + total + the first title for each probe, and
 * exits non-zero if any probe does not meet its expectation (so it can be run
 * as an evidence step, not just eyeballed).
 *
 * The catalog-number / nickname probes (backlog 69688f6a, owner GO 2026-10-10)
 * cover the dead end that was fixed: `?q=BWV 1068` returned total 0 before the
 * `catalog` column was searched.
 */
import { handleCatalogList } from "../src/services/catalog-handler";

/** [query, expected total, substring the first page must contain] */
const PROBES: Array<[string, number, string]> = [
  ["fur", -1, "Elise"], // -1 = "any non-zero total"
  ["prelude", -1, "Prelude"],
  ["BWV 1068", 1, "Air on the G String"],
  ["bwv1068", 1, "Air on the G String"],
  ["Air", -1, "Air on the G String"],
  ["Beethoven", -1, "Beethoven"],
  ["g string", 1, "Air on the G String"],
  ["jesu joy of mans desiring", 1, "Jesu"],
  ["moonlight sonata", 2, "Moonlight"],
  ["well tempered clavier", -1, "WTC"],
  ["Op. 27 No. 2", -1, "C-sharp Minor (Moonlight)"],
  ["op27no2", -1, "C-sharp Minor (Moonlight)"],
  ["Hob. XVI/35", -1, "Piano Sonata in C Major"],
];

let failures = 0;
for (const [q, expectedTotal, expectedSubstring] of PROBES) {
  const url = `http://x/api/pieces?q=${encodeURIComponent(q)}&limit=50`;
  try {
    const res = await handleCatalogList(new Request(url));
    const body = (await res.json()) as {
      total?: number;
      pieces?: Array<{ title: string; catalog: string | null }>;
    };
    const total = body.total ?? 0;
    const first = body.pieces?.[0];
    const firstLabel = first ? `${first.title} [${first.catalog ?? "-"}]` : "(none)";
    const page = (body.pieces ?? []).map((p) => p.title).join(" | ");
    const okTotal = expectedTotal === -1 ? total > 0 : total === expectedTotal;
    const okText = page.includes(expectedSubstring);
    if (!okTotal || !okText) failures++;
    console.log(
      `${okTotal && okText ? "OK  " : "FAIL"} q="${q}" -> ${res.status} total=${total} ` +
        `first=${firstLabel}`,
    );
  } catch (err) {
    failures++;
    console.log(`FAIL q="${q}" -> THREW ${String(err)}`);
  }
}
console.log(failures === 0 ? "ALL PROBES OK" : `${failures} PROBE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
