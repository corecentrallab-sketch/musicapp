/**
 * Tests for the catalog search predicate — the catalog-number / nickname dead
 * end (backlog 69688f6a, owner GO 2026-10-10).
 *
 * The bug: `GET /api/pieces?q=BWV 1068` returned total 0 while `?q=Air`
 * returned the piece, because the WHERE predicate only ever compared `title`
 * and `composer`. These tests have two layers:
 *
 *   1. PURE (always run, no database): the SQL the handler builds and the bound
 *      parameters it binds — the `catalog` column is searched, the squashed
 *      comparison exists so "BWV1068" ≡ "bwv 1068", the alias table's terms are
 *      added, and the pre-existing title/composer/composer-filter behaviour is
 *      unchanged (the regression guard).
 *   2. LIVE (opt-in, `CATALOG_LIVE_PROBE=1 bun test …`): the real handler
 *      against the real database in DATABASE_URL, asserting actual result sets
 *      (q=BWV 1068 → the Air, q=bwv1068 → the same piece, q=Air still works …).
 *      Kept opt-in so the default gate stays hermetic and reproducible offline;
 *      `scripts/catalog-search-check.ts` runs the same probes as a one-liner.
 *
 * Run with: bun test src/services/catalog-handler.test.ts
 */
import { describe, expect, test } from "bun:test";
import { buildCatalogWhere, handleCatalogList } from "./catalog-handler";
import {
  CATALOG_ALIASES,
  lookupCatalogAlias,
  normalizeAliasKey,
  squashCatalogTerm,
} from "./catalog-search-terms";

describe("squashCatalogTerm — catalog-number forms", () => {
  test("separators and case are irrelevant", () => {
    const forms = ["BWV 1068", "bwv 1068", "bwv1068", "BWV1068", "b w v 1 0 6 8"];
    for (const f of forms) expect(squashCatalogTerm(f)).toBe("bwv1068");
  });

  test("dotted / slashed catalog numbers collapse the same way", () => {
    expect(squashCatalogTerm("Op. 27 No. 2")).toBe("op27no2");
    expect(squashCatalogTerm("op.27 no.2")).toBe("op27no2");
    expect(squashCatalogTerm("OP 27 NO 2")).toBe("op27no2");
    expect(squashCatalogTerm("Hob. XVI/35")).toBe("hobxvi35");
    expect(squashCatalogTerm("hob xvi 35")).toBe("hobxvi35");
  });

  test("diacritics are folded (mirrors the SQL side's unaccent)", () => {
    expect(squashCatalogTerm("Étude Op. 10")).toBe(squashCatalogTerm("Etude Op. 10"));
  });
});

describe("normalizeAliasKey + alias table hygiene", () => {
  test("spelling variants collapse onto one key", () => {
    // The apostrophe is dropped, so "Man's" becomes "mans"; both the apostrophe
    // spelling and the spoken-out spelling have their own key in the table.
    expect(normalizeAliasKey("Jesu, Joy of Man's Desiring")).toBe("jesu joy of mans desiring");
    expect(normalizeAliasKey("jesu joy of man desiring")).toBe("jesu joy of man desiring");
    expect(normalizeAliasKey("  Well-Tempered   Clavier ")).toBe("well tempered clavier");
    expect(normalizeAliasKey("Air on a G-String")).toBe("air on a g string");
  });

  test("every alias key is already normalized (catches table typos)", () => {
    for (const alias of CATALOG_ALIASES) {
      expect(alias.keys.length).toBeGreaterThan(0);
      expect(alias.terms.length).toBeGreaterThan(0);
      for (const key of alias.keys) {
        expect(normalizeAliasKey(key)).toBe(key);
      }
    }
  });

  test("aliases are exact whole-query matches — no substring widening", () => {
    expect(lookupCatalogAlias("moonlight sonata")?.terms).toContain("C-sharp Minor (Moonlight)");
    // "clair de lune" must NOT be captured by the "air" key, and neither may a
    // query that merely contains a nickname.
    expect(lookupCatalogAlias("clair de lune")).toBeNull();
    expect(lookupCatalogAlias("air on the g string suite")).toBeNull();
    expect(lookupCatalogAlias("prelude")).toBeNull();
  });

  test("no alias entry invents a catalog number (every term occurs in title or catalog form)", () => {
    // Catalog-number-shaped terms must be a real numbering scheme we already
    // query, and every term must be non-empty and free of LIKE wildcards.
    for (const alias of CATALOG_ALIASES) {
      for (const term of alias.terms) {
        expect(term.trim().length).toBeGreaterThan(2);
        expect(term).not.toContain("%");
        expect(term).not.toContain("_");
        expect(alias.note.length).toBeGreaterThan(20); // the "why" is mandatory
      }
    }
  });
});

describe("buildCatalogWhere — the SQL the handler runs", () => {
  const accented = buildCatalogWhere({ q: "Air", composer: "", fold: true });
  const plain = buildCatalogWhere({ q: "Air", composer: "", fold: false });

  test("q searches the catalog column as well as title/composer", () => {
    expect(accented.whereSql).toContain("unaccent(p.catalog) ILIKE unaccent($1::text)");
    expect(accented.whereSql).toContain("unaccent(p.title) ILIKE unaccent($1::text)");
    expect(accented.whereSql).toContain("unaccent(p.composer) ILIKE unaccent($1::text)");
    expect(accented.params).toContain("%Air%");
  });

  test("a separator-free catalog query is compared against the squashed catalog", () => {
    const { whereSql, params } = buildCatalogWhere({ q: "bwv1068", composer: "", fold: true });
    expect(whereSql).toContain("regexp_replace(unaccent(p.catalog), '[^A-Za-z0-9]', '', 'g') ILIKE");
    expect(params).toContain("%bwv1068%");
  });

  test("q=BWV 1068 binds the verbatim pattern (catalog column matches it directly)", () => {
    const { params } = buildCatalogWhere({ q: "BWV 1068", composer: "", fold: true });
    expect(params).toContain("%BWV 1068%");
    expect(params).toContain("%bwv1068%"); // squashed form comes along for the ride
  });

  test("a nickname query adds that alias's real title/catalog fragments", () => {
    const air = buildCatalogWhere({ q: "g string", composer: "", fold: true });
    expect(air.params).toContain("%BWV 1068%");
    const moonlight = buildCatalogWhere({ q: "moonlight sonata", composer: "", fold: true });
    expect(moonlight.params).toContain("%C-sharp Minor (Moonlight)%");
    const wtc = buildCatalogWhere({ q: "well-tempered clavier", composer: "", fold: true });
    expect(wtc.params).toContain("%WTC%");
  });

  test("a non-nickname query adds no alias terms (policy stays narrow)", () => {
    const { params } = buildCatalogWhere({ q: "prelude", composer: "", fold: true });
    expect(params).toEqual(["%prelude%", "%prelude%"]);
  });

  test("REGRESSION: title/composer search behaviour is unchanged", () => {
    // Same two branches, same bound pattern, same result shape as before the
    // fix — the catalog and squashed branches are additions, not replacements.
    expect(accented.whereSql).toContain(
      "(unaccent(p.title) ILIKE unaccent($1::text) OR unaccent(p.composer) ILIKE unaccent($1::text)",
    );
    expect(accented.whereSql.startsWith("p.is_public_domain = true AND (")).toBe(true);
    // Without `unaccent` the folding wrapper disappears but the structure holds.
    expect(plain.whereSql).toContain("(p.title ILIKE $1::text");
    expect(plain.whereSql).not.toContain("unaccent(");
    expect(plain.params).toEqual(accented.params);
    // Empty query keeps returning the whole library (no q branch at all).
    const none = buildCatalogWhere({ q: "", composer: "", fold: true });
    expect(none.whereSql).toBe("p.is_public_domain = true");
    expect(none.params).toEqual([]);
  });

  test("REGRESSION: the composer filter is unchanged and combines with AND", () => {
    const { whereSql, params } = buildCatalogWhere({
      q: "prelude",
      composer: "Chopin",
      fold: true,
    });
    expect(whereSql).toContain(" AND unaccent(p.composer) ILIKE unaccent($3::text)");
    expect(params).toEqual(["%prelude%", "%prelude%", "%Chopin%"]);
  });

  test("wildcards in user input stay escaped (never a LIKE pattern)", () => {
    const { params } = buildCatalogWhere({ q: "100%", composer: "", fold: true });
    expect(params).toContain("%100\\%%");
  });
});

// ---------------------------------------------------------------------------
// Live layer — real handler, real Neon rows. Opt-in so the default gate stays
// hermetic; run with CATALOG_LIVE_PROBE=1 (see scripts/catalog-search-check.ts
// for the same probes as a script).
// ---------------------------------------------------------------------------
const LIVE = process.env.CATALOG_LIVE_PROBE === "1";

async function search(q: string): Promise<{ status: number; total: number; titles: string[] }> {
  const res = await handleCatalogList(
    new Request(`http://x/api/pieces?q=${encodeURIComponent(q)}`),
  );
  const body = (await res.json()) as {
    total?: number;
    pieces?: Array<{ title: string; catalog: string | null }>;
  };
  return {
    status: res.status,
    total: body.total ?? 0,
    titles: (body.pieces ?? []).map((p) => `${p.title} [${p.catalog ?? "-"}]`),
  };
}

describe.skipIf(!LIVE)("LIVE /api/pieces — catalog numbers and nicknames (opt-in)", () => {
  test("q=BWV 1068 finds the Air (was total 0 before the fix)", async () => {
    const r = await search("BWV 1068");
    expect(r.status).toBe(200);
    expect(r.total).toBe(1);
    expect(r.titles[0]).toContain("Air on the G String");
  });

  test("q=bwv1068 (no space, lower case) finds the same piece", async () => {
    const r = await search("bwv1068");
    expect(r.status).toBe(200);
    expect(r.total).toBe(1);
    expect(r.titles[0]).toContain("Air on the G String");
  });

  test("REGRESSION: q=Air still returns the Air (and never zero results)", async () => {
    const r = await search("Air");
    expect(r.status).toBe(200);
    expect(r.total).toBeGreaterThan(0);
    expect(r.titles.join(" | ")).toContain("Air on the G String");
  });

  test("REGRESSION: q=Beethoven still matches by composer", async () => {
    const r = await search("Beethoven");
    expect(r.status).toBe(200);
    expect(r.total).toBeGreaterThan(50);
  });

  test("q=fur elise still finds Für Elise (diacritic fold, unchanged)", async () => {
    const r = await search("fur elise");
    expect(r.status).toBe(200);
    expect(r.total).toBe(1);
    expect(r.titles[0]).toContain("Elise");
  });

  test("nicknames resolve to exactly the intended piece(s)", async () => {
    const cases: Array<[string, number, string]> = [
      ["g string", 1, "Air on the G String"],
      ["air on the g string", 1, "Air on the G String"],
      ["jesu joy of mans desiring", 1, "Jesu"],
      // 2 rows, both genuinely the Moonlight Sonata: Beethoven's Op. 27 No. 2
      // and Tárrega's guitar transcription "Claro de Luna (Beethoven's
      // Moonlight Sonata)" — the latter's own title contains the nickname.
      ["moonlight sonata", 2, "C-sharp Minor (Moonlight)"],
      ["song without words", 6, "Songs Without Words"],
      ["fifth symphony", 1, "Symphony No. 5 in C Minor"],
    ];
    for (const [q, expectedTotal, expectedTitle] of cases) {
      const r = await search(q);
      expect(r.status).toBe(200);
      expect(r.total).toBe(expectedTotal);
      expect(r.titles.join(" | ")).toContain(expectedTitle);
    }
  });

  test("the WTC nickname resolves to the whole Well-Tempered Clavier set", async () => {
    // 65 rows on 2026-10-10 (the Book 1/2 prelude+fugue pairs).
    const r = await search("well tempered clavier");
    expect(r.status).toBe(200);
    expect(r.total).toBeGreaterThan(30);
    expect(r.titles.every((t) => t.includes("WTC"))).toBe(true);
  });

  test("catalog numbers work for other numbering schemes too", async () => {
    for (const [q, expected] of [
      ["Op. 27 No. 2", "C-sharp Minor (Moonlight)"],
      ["op27no2", "C-sharp Minor (Moonlight)"],
      ["Hob. XVI/35", "Piano Sonata in C Major"],
      ["hob xvi 35", "Piano Sonata in C Major"],
      ["L. 75", "Clair de Lune"],
    ] as const) {
      const r = await search(q);
      expect(r.status).toBe(200);
      expect(r.total).toBeGreaterThan(0);
      expect(r.titles.join(" | ")).toContain(expected);
    }
  });

  test("a nonsense query is still an honest empty result (no dead-end fix overreaching)", async () => {
    const r = await search("zzzzqqqq not a piece 999");
    expect(r.status).toBe(200);
    expect(r.total).toBe(0);
  });
});
