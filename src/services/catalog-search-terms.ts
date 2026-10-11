// ---------------------------------------------------------------------------
// catalog-search-terms.ts — pure search-term helpers for GET /api/pieces.
//
// WHY (backlog 69688f6a, owner GO 2026-10-10): `GET /api/pieces?q=BWV 1068`
// returned total 0 while `?q=Air` returned the piece. The WHERE predicate was
// built from `title ILIKE … OR composer ILIKE …` only, so the pieces.catalog
// column ("BWV 1068", "Op. 27 No. 2", "Hob. XVI/35") — the way a musician
// actually knows a piece — was never searched, and neither were the common
// names that the catalog's own titles do not contain. That is a dead end in the
// one place the whole product is a front door to: the 09-28 rule says every
// surface resolves to a result or an honest alternative, never to nothing.
//
// Two mechanisms, both pure and DB-free (no schema change, no migration):
//
//  1. CATALOG-NUMBER MATCHING (`squashCatalogTerm`). Catalog numbers are typed
//     with or without separators and in any case — "BWV 1068", "bwv1068",
//     "Op. 27 No. 2", "Op.27 No.2", "op 27 no 2". The predicate therefore also
//     compares the query against a SQUASHED catalog (diacritics folded, case
//     folded, all non-alphanumerics dropped) so every one of those forms finds
//     the same row. The squash is applied with the same JS rules here that the
//     SQL side applies to the column, so the two are comparable.
//
//  2. CURATED ALIASES (`CATALOG_ALIASES`). Real-world nicknames an owner or
//     tester types and the catalog title does not contain — "Well-Tempered
//     Clavier" (the rows say "(WTC Book 1)"), "Jesu, Joy of Man's Desiring"
//     (the row is titled "Jesu"), "moonlight sonata" (the title carries
//     "Moonlight" inside a trailing parenthetical, so the two-word phrase is
//     not a substring of it). Every entry is a name that genuinely refers to
//     that piece; every `terms` value is a literal substring of the real row
//     (title or catalog) and each entry's expected result count is pinned by a
//     test. NO invented catalog numbers, no generated variants.
//
// Alias lookup is an EXACT match on the normalized whole query — not a
// substring or prefix test — so an alias can never silently widen an unrelated
// search (a prefix rule would have mapped "clair" onto the Air, because "clair"
// ends in "air").
// ---------------------------------------------------------------------------

/**
 * Normalize a whole query for alias lookup: fold diacritics, fold case, drop
 * apostrophes/quote marks entirely (so "Man's" → "mans"), turn every other run
 * of punctuation/whitespace into a single space.
 *
 * Both the table's keys and the incoming query go through this, so every
 * spelling variant of a nickname collapses onto one key.
 */
export function normalizeAliasKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['`’‘"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Collapse a catalog-number term to bare alphanumerics: "BWV 1068" → "bwv1068",
 * "Op. 27 No. 2" → "op27no2", "Hob. XVI/35" → "hobxvi35".
 *
 * Diacritics are folded here too, mirroring the SQL side's `unaccent()`, so the
 * two sides of the comparison are always produced by the same rules.
 */
export function squashCatalogTerm(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface CatalogAlias {
  /** Whole-query keys, already in `normalizeAliasKey` form. A test asserts
   *  every key is idempotent under the normalizer, so a table typo is caught. */
  keys: readonly string[];
  /** Literal substrings searched in title / composer / catalog (OR'd). Each one
   *  must really occur in the intended row — pinned by the live-count test. */
  terms: readonly string[];
  /** Human-readable note. Explained here because an alias without a stated
   *  reason is indistinguishable from a fabricated one. */
  note: string;
}

/**
 * Curated aliases for top pieces. Deliberately small: only names that are in
 * genuine circulation AND are missing from the catalog's own title/composer
 * text. A piece whose nickname already sits in its title needs no entry.
 */
export const CATALOG_ALIASES: readonly CatalogAlias[] = [
  {
    keys: ["air", "air on the g string", "air on a g string", "g string", "gstring"],
    terms: ["BWV 1068"],
    note:
      "Bach's Air from Orchestral Suite No. 3 is catalogued as BWV 1068 and is " +
      "asked for by number or by the 'G string' name (owner's own ticket: " +
      "?q=BWV 1068 returned nothing).",
  },
  {
    keys: [
      "jesu joy of mans desiring",
      "jesu joy of man desiring",
      "joy of mans desiring",
    ],
    terms: ["BWV 147"],
    note:
      "The chorale is the catalog's 'Jesu' (BWV 147); the English title " +
      "'Jesu, Joy of Man's Desiring' appears nowhere in the row. The " +
      "apostrophe-free spelling normalizes to the same key.",
  },
  {
    keys: [
      "well tempered clavier",
      "the well tempered clavier",
      "das wohltemperierte klavier",
    ],
    terms: ["WTC"],
    note:
      "The WTC Book 1/2 rows only say '(WTC Book 1)' — the full name, English " +
      "or German, is not present in title, composer or catalog.",
  },
  {
    keys: ["song without words", "songs without words"],
    terms: ["Songs Without Words"],
    note:
      "The rows use the plural 'Songs Without Words', so the singular a user " +
      "types ('Song Without Words') is not a substring of any of them.",
  },
  {
    keys: ["moonlight sonata", "beethovens moonlight sonata", "beethoven moonlight sonata"],
    terms: ["C-sharp Minor (Moonlight)"],
    note:
      "Beethoven's Op. 27 No. 2 title is 'Piano Sonata No. 14 in C-sharp Minor " +
      "(Moonlight)' — the nickname is split by '-' and ')' around it, so " +
      "'moonlight sonata' is not a substring. The term is that exact title " +
      "fragment; it also legitimately matches Tárrega's guitar transcription " +
      "'Claro de Luna (Beethoven's Moonlight Sonata)', which names the nickname " +
      "itself (2 rows on 2026-10-10, both the same work).",
  },
  {
    keys: ["fifth symphony", "beethovens fifth symphony", "beethoven fifth symphony"],
    terms: ["Symphony No. 5 in C Minor"],
    note:
      "'Fifth Symphony' is how Beethoven's Op. 67 is asked for; the row is " +
      "titled 'Symphony No. 5 in C Minor (Fate)'.",
  },
];

/**
 * Look up a curated alias for a whole query. Returns null when the query is
 * not a recognized nickname (the normal case) — the caller then searches
 * term-only, exactly as before.
 */
export function lookupCatalogAlias(query: string): CatalogAlias | null {
  const key = normalizeAliasKey(query);
  if (key === "") return null;
  for (const alias of CATALOG_ALIASES) {
    if (alias.keys.includes(key)) return alias;
  }
  return null;
}
