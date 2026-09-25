/**
 * PD cross-check regression suite (backlog 43c1c500 / 718da1e9).
 *
 * Pins the owner's exact 09-25 case end to end — Lang Lang's recording of Für
 * Elise must map to the catalogued public-domain work (NOT to a modern song to
 * buy) — and pins the honest-no-match half just as hard: a genuinely modern song,
 * an unreachable catalog and an ambiguous mapping must all produce NO `pd_match`,
 * because the app routes the PD card on that key's presence.
 *
 * The fixtures are the REAL catalog rows (values read from the live database on
 * 2026-09-25: id/title/composer/catalog/genre/difficulty/sheet state), so the
 * owner's case is exercised against the data the route will actually compare
 * against. The catalog is injected everywhere, so the gate needs no database.
 *
 * Run with: bun test src/services/modern-pd-crosscheck.test.ts
 */
import { describe, test, expect, afterEach } from "bun:test";
import {
  MATCH_CONFIDENCE,
  PD_CANDIDATE_SQL,
  PD_CATALOG_READ_TIMEOUT_MS,
  composerAgrees,
  composerSurname,
  crossCheckPdCatalog,
  crossCheckTitleKey,
  matchPdWork,
  toPdMatchWire,
  type PdCandidate,
} from "./modern-pd-crosscheck";
import { SMD_AFFILIATE_ID, SMD_SEARCH_PATH } from "./affiliate-url-contract";
import type { ModernRecognizeDeps } from "./modern-recognize-handler";

/** The catalogued work the owner's recording maps to (live row, 2026-09-25). */
const FUR_ELISE: PdCandidate = {
  id: "741700db-72cf-4c6d-9b61-cf1e091621ef",
  title: "Bagatelle in A Minor (Für Elise)",
  composer: "Ludwig van Beethoven",
  catalog: "WoO 59",
  genre: "Classical/Romantic",
  difficulty: 3,
  is_public_domain: true,
  // Our catalog holds the work but not a typeset score of it yet — the honest
  // "coming soon" state, which is exactly why the card must not claim a score.
  sheet_music_url: null,
  album_art_url: null,
};

/** A PD work that DOES carry a score + art — the available-score branch. */
const CLAIR_DE_LUNE: PdCandidate = {
  id: "0e1e4700-dc96-47f5-8ef9-11c7324150ef",
  title: "Clair de Lune (arrangement)",
  composer: "Claude Debussy",
  catalog: "L. 75",
  genre: "Impressionist",
  difficulty: 5,
  is_public_domain: true,
  sheet_music_url:
    "https://site-notesnap.vercel.app/api/sheets/0e1e4700-dc96-47f5-8ef9-11c7324150ef.pdf",
  album_art_url: "https://cdn.example.test/clair-de-lune.jpg",
};

/** The copyrighted rows the cross-check must never route to a free card. */
const COPYRIGHTED: PdCandidate[] = [
  {
    id: "fcc490a8-6c40-45c9-b5b5-7e7f4fc9af96",
    title: "Concierto de Aranjuez — Adagio (piano arrangement)",
    composer: "Joaquín Rodrigo",
    catalog: null,
    genre: "20th century",
    difficulty: 8,
    is_public_domain: false,
    sheet_music_url: null,
    album_art_url: null,
  },
];

const CATALOG: PdCandidate[] = [FUR_ELISE, CLAIR_DE_LUNE, ...COPYRIGHTED];

/** One confident mapping, or a test failure — keeps the assertions readable. */
function wireFor(
  input: { title?: string | null; artist?: string | null; composer?: string | null },
  candidates: PdCandidate[] = CATALOG,
) {
  const match = matchPdWork(input, candidates);
  expect(match).not.toBeNull();
  return toPdMatchWire(match!);
}

// ─── the title key ──────────────────────────────────────────────────────────
describe("crossCheckTitleKey — the work title, not the release metadata", () => {
  test("folds case and diacritics", () => {
    expect(crossCheckTitleKey("Für Elise")).toBe("fur elise");
    expect(crossCheckTitleKey("FUR ELISE")).toBe("fur elise");
  });

  test("OWNER 09-25: the version descriptor the provider sent is stripped", () => {
    // The owner's card literally read `Fur Elise (Piano Version)` — the SMD
    // money path cleans it for the same reason (no searchable title would
    // otherwise reach the retailer), and the cross-check must not be defeated by
    // it either.
    expect(crossCheckTitleKey("Fur Elise (Piano Version)")).toBe("fur elise");
    expect(crossCheckTitleKey("Für Elise [2003 Remaster]")).toBe("fur elise");
  });

  test("an absent or blank title is never a key", () => {
    expect(crossCheckTitleKey(null)).toBe("");
    expect(crossCheckTitleKey(undefined)).toBe("");
    expect(crossCheckTitleKey("   ")).toBe("");
    expect(crossCheckTitleKey("!!! ...")).toBe("");
  });
});

// ─── composer agreement ─────────────────────────────────────────────────────
describe("composer agreement", () => {
  test("surname is the last token of the normalised name", () => {
    expect(composerSurname("Ludwig van Beethoven")).toBe("beethoven");
    expect(composerSurname("Frédéric Chopin")).toBe("chopin");
    expect(composerSurname("")).toBe("");
    expect(composerSurname(null)).toBe("");
  });

  test("word order and particles do not matter, a different name does", () => {
    expect(composerAgrees("Ludwig van Beethoven", "Ludwig van Beethoven")).toBe(true);
    expect(composerAgrees("Ludwig van Beethoven", "Beethoven, Ludwig van")).toBe(true);
    expect(composerAgrees("Ludwig van Beethoven", "Beethoven")).toBe(true);
    expect(composerAgrees("Ludwig van Beethoven", "Frédéric Chopin")).toBe(false);
  });

  test("no provider composer: nothing to check (the Lang Lang case)", () => {
    expect(composerAgrees("Ludwig van Beethoven", undefined)).toBe(true);
    expect(composerAgrees("Ludwig van Beethoven", "")).toBe(true);
  });

  test("a proposal with no composer cannot be verified against a named one", () => {
    expect(composerAgrees(null, "Ludwig van Beethoven")).toBe(false);
    expect(composerAgrees("", "Ludwig van Beethoven")).toBe(false);
  });
});

// ─── the owner's case ───────────────────────────────────────────────────────
describe("PD cross-check — OWNER 09-25: Lang Lang's Für Elise is OUR work", () => {
  test("maps to the catalogued Für Elise (title + PD flag), not to a modern song", () => {
    const match = matchPdWork({ title: "Für Elise", artist: "Lang Lang" }, CATALOG);
    expect(match).not.toBeNull();
    expect(match!.candidate.id).toBe(FUR_ELISE.id);
    // Our catalog titles the work by its full name; the provider's short title
    // is the whole-word-contained one, so the relation is the third rule.
    expect(match!.kind).toBe("title-contained");
    expect(match!.confidence).toBe(MATCH_CONFIDENCE["title-contained"]);
  });

  test("the app's wire block carries identity, catalog, genre, difficulty and the SECONDARY retailer CTA", () => {
    const wire = wireFor({ title: "Für Elise", artist: "Lang Lang" });

    expect(wire.id).toBe("741700db-72cf-4c6d-9b61-cf1e091621ef");
    expect(wire.title).toBe("Bagatelle in A Minor (Für Elise)");
    expect(wire.composer).toBe("Ludwig van Beethoven");
    expect(wire.catalog).toBe("WoO 59");
    // The genre line the app renders when present — the catalog's own genre.
    expect(wire.genre).toBe("Classical/Romantic");
    expect(wire.difficulty_label).toBe("Beginner");
    expect(wire.is_public_domain).toBe(true);
    expect(wire.match_confidence).toBe(0.85);

    // Our catalog has no score for this work yet: say so, and send no score URL
    // (the app would otherwise claim a free score the user cannot open).
    expect(wire.sheet_music_available).toBe(false);
    expect("sheet_music_url" in wire).toBe(false);
    expect("album_art_url" in wire).toBe(false);

    // Secondary CTA: the shared piece affiliate builder, SMD, ID 67650.
    expect(wire.affiliate_url).toBeDefined();
    const url = new URL(wire.affiliate_url!);
    expect(url.pathname).toBe(SMD_SEARCH_PATH);
    expect(url.searchParams.get("tid")).toBe(SMD_AFFILIATE_ID);
    expect(url.searchParams.get("affiliateId")).toBe(SMD_AFFILIATE_ID);
    expect(url.searchParams.get("query")).toBe(
      "Bagatelle in A Minor (Für Elise) Ludwig van Beethoven",
    );
  });

  test("the provider's own card title (`Fur Elise (Piano Version)`) maps the same work", () => {
    const wire = wireFor({ title: "Fur Elise (Piano Version)", artist: "Lang Lang" });
    expect(wire.id).toBe(FUR_ELISE.id);
  });

  test("a composer the provider does supply must agree (word order tolerated)", () => {
    const straight = wireFor({
      title: "Für Elise",
      artist: "Lang Lang",
      composer: "Ludwig van Beethoven",
    });
    expect(straight.id).toBe(FUR_ELISE.id);
    const reversed = wireFor({
      title: "Für Elise",
      artist: "Lang Lang",
      composer: "Beethoven, Ludwig van",
    });
    expect(reversed.id).toBe(FUR_ELISE.id);
  });

  test("a provider composer from a DIFFERENT name vetoes the mapping", () => {
    // Same title, different composer metadata: never route on the title alone
    // when the provider told us who wrote it.
    expect(
      matchPdWork(
        { title: "Für Elise", artist: "Lang Lang", composer: "Frédéric Chopin" },
        CATALOG,
      ),
    ).toBeNull();
  });

  test("a PD work that carries a score advertises it (and its art)", () => {
    const wire = wireFor({ title: "Clair de Lune", composer: "Claude Debussy" });
    expect(wire.id).toBe(CLAIR_DE_LUNE.id);
    // Containment: the provider's title is the candidate's whole opening
    // ("clair de lune" inside "clair de lune arrangement").
    expect(wire.match_confidence).toBe(MATCH_CONFIDENCE["title-contained"]);
    expect(wire.sheet_music_available).toBe(true);
    expect(wire.sheet_music_url).toBe(CLAIR_DE_LUNE.sheet_music_url);
    expect(wire.album_art_url).toBe(CLAIR_DE_LUNE.album_art_url);
  });

  test("a two-word title that IS another title's opening matches by leading words", () => {
    const withCatalogNumber: PdCandidate = {
      id: "bbbbbbbb-0000-4000-8000-000000000009",
      title: "Für Elise WoO 59",
      composer: "Ludwig van Beethoven",
      is_public_domain: true,
    };
    const match = matchPdWork({ title: "Für Elise", artist: "Lang Lang" }, [withCatalogNumber]);
    expect(match?.candidate.id).toBe(withCatalogNumber.id);
    expect(match?.kind).toBe("title-leading-words");
    expect(match?.confidence).toBe(MATCH_CONFIDENCE["title-leading-words"]);
  });

  test("a shared generic prefix does not make a long title ambiguous (live catalog probe 09-25)", () => {
    // Real data: ~30 rows start with "Piano Sonata", so a loose first-two-words
    // rule made the owner-adjacent case below look ambiguous and suppressed a
    // correct exact-title mapping. Only the exact row may answer.
    const moonlight: PdCandidate = {
      id: "9d000000-0000-4000-8000-000000000010",
      title: "Piano Sonata No. 14 in C-sharp Minor (Moonlight)",
      composer: "Ludwig van Beethoven",
      catalog: "Op. 27 No. 2",
      is_public_domain: true,
    };
    const neighbours: PdCandidate[] = [
      {
        id: "9d000000-0000-4000-8000-000000000011",
        title: "Piano Sonata No. 1 in F Minor",
        composer: "Ludwig van Beethoven",
        is_public_domain: true,
      },
      {
        id: "9d000000-0000-4000-8000-000000000012",
        title: "Piano Sonata No. 10 in G Major",
        composer: "Ludwig van Beethoven",
        is_public_domain: true,
      },
    ];
    const match = matchPdWork(
      { title: "Piano Sonata No. 14 in C-sharp Minor (Moonlight)", composer: "Beethoven" },
      [moonlight, ...neighbours],
    );
    expect(match?.candidate.id).toBe(moonlight.id);
    expect(match?.kind).toBe("title-exact");
  });
});

// ─── the honest-no-match half ───────────────────────────────────────────────
describe("PD cross-check — never a guess", () => {
  test("a genuinely modern song has NO PD mapping (AC/DC 'Big Gun')", async () => {
    expect(matchPdWork({ title: "Big Gun", artist: "AC/DC" }, CATALOG)).toBeNull();
    expect(
      matchPdWork({ title: "Big Gun", artist: "AC/DC", composer: "Angus Young" }, CATALOG),
    ).toBeNull();
    // and the same input through the catalogue-reading entry point
    expect(await crossCheckPdCatalog({ title: "Big Gun", artist: "AC/DC" }, async () => CATALOG)).toBeNull();
  });

  test("an empty/absent title is never matched", () => {
    expect(matchPdWork({ title: "" }, CATALOG)).toBeNull();
    expect(matchPdWork({ title: "   " }, CATALOG)).toBeNull();
    expect(matchPdWork({ title: null, artist: "Lang Lang" }, CATALOG)).toBeNull();
    expect(matchPdWork(null, CATALOG)).toBeNull();
  });

  test("an empty catalog is never matched (and neither is a missing one)", () => {
    expect(matchPdWork({ title: "Für Elise" }, [])).toBeNull();
    expect(matchPdWork({ title: "Für Elise" }, null)).toBeNull();
    expect(matchPdWork({ title: "Für Elise" }, undefined)).toBeNull();
  });

  test("a copyrighted row can never be routed to a free-score card", () => {
    // The SQL already filters, and the matcher re-checks the flag: two
    // independent guards for the one claim we must never make.
    expect(
      matchPdWork(
        { title: "Concierto de Aranjuez — Adagio", composer: "Joaquín Rodrigo" },
        COPYRIGHTED,
      ),
    ).toBeNull();
    expect(
      matchPdWork({ title: "Für Elise", artist: "Lang Lang" }, [
        { ...FUR_ELISE, is_public_domain: false },
      ]),
    ).toBeNull();
    expect(PD_CANDIDATE_SQL).toContain("is_public_domain = true");
    expect(PD_CANDIDATE_SQL).toContain("LIMIT");
  });

  test("TWO candidates that fit equally well is ambiguous — no mapping", () => {
    // Same work catalogued twice (a duplicate row, or two near-identical
    // arrangements): picking one would be a guess, so the modern card stays.
    const ambiguous = [
      FUR_ELISE,
      { ...FUR_ELISE, id: "aaaaaaaa-0000-4000-8000-000000000001" },
    ];
    expect(matchPdWork({ title: "Für Elise", artist: "Lang Lang" }, ambiguous)).toBeNull();
  });

  test("a single generic word never latches onto a longer PD title", () => {
    const home: PdCandidate = {
      id: "cccccccc-0000-4000-8000-000000000002",
      title: "Home Sweet Home",
      composer: "Henry Bishop",
      is_public_domain: true,
    };
    expect(matchPdWork({ title: "Home", artist: "Some Band" }, [home])).toBeNull();
  });

  test("an unverifiable candidate composer blocks the mapping", () => {
    const unnamed: PdCandidate = {
      id: "dddddddd-0000-4000-8000-000000000003",
      title: "Für Elise",
      composer: "",
      is_public_domain: true,
    };
    expect(
      matchPdWork({ title: "Für Elise", composer: "Ludwig van Beethoven" }, [unnamed]),
    ).toBeNull();
  });

  test("rows without an id or title are skipped, not routed", () => {
    expect(
      matchPdWork({ title: "Für Elise" }, [
        { ...FUR_ELISE, id: "" },
        { ...FUR_ELISE, title: "   " },
      ]),
    ).toBeNull();
  });
});

// ─── the catalogue read + degradation ───────────────────────────────────────
describe("crossCheckPdCatalog — an enhancement that never breaks recognition", () => {
  test("reads the catalog once and maps the owner's case", async () => {
    let calls = 0;
    const wire = await crossCheckPdCatalog({ title: "Für Elise", artist: "Lang Lang" }, async () => {
      calls += 1;
      return CATALOG;
    });
    expect(calls).toBe(1);
    expect(wire?.id).toBe(FUR_ELISE.id);
  });

  test("no title: the catalog is not even read", async () => {
    let calls = 0;
    const wire = await crossCheckPdCatalog({ title: "", artist: "Lang Lang" }, async () => {
      calls += 1;
      return CATALOG;
    });
    expect(wire).toBeNull();
    expect(calls).toBe(0);
  });

  test("a failing catalog read degrades to NO mapping instead of throwing", async () => {
    const wire = await crossCheckPdCatalog({ title: "Für Elise" }, async () => {
      throw new Error("neon unavailable");
    });
    expect(wire).toBeNull();
  });

  test("a catalog read that HANGS is abandoned (recognition is never held open)", async () => {
    const started = Date.now();
    const wire = await crossCheckPdCatalog(
      { title: "Für Elise" },
      () => new Promise<PdCandidate[]>(() => {}), // never resolves
      25,
    );
    expect(wire).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("the production timeout leaves room for a cold database", () => {
    expect(PD_CATALOG_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
  });

  test("a read that returns nothing usable degrades too", async () => {
    expect(
      await crossCheckPdCatalog({ title: "Für Elise" }, async () => [] as PdCandidate[]),
    ).toBeNull();
  });
});

// ─── the wire block the app validates on arrival ─────────────────────────────
describe("pd_match wire shape — exactly the keys the app reads", () => {
  test("key set is the app's contract (no extra, no empty strings)", () => {
    const wire = wireFor({ title: "Für Elise", artist: "Lang Lang" });
    expect(Object.keys(wire).sort()).toEqual(
      [
        "affiliate_url",
        "catalog",
        "composer",
        "difficulty_label",
        "genre",
        "id",
        "is_public_domain",
        "match_confidence",
        "sheet_music_available",
        "title",
      ].sort(),
    );
    for (const value of Object.values(wire)) {
      expect(value).not.toBe("");
    }
  });

  test("only true is ever sent for the public-domain flag", () => {
    // The app vetoes the route on `is_public_domain: false`, so the flag is a
    // statement we make, never something we infer is absent.
    expect(wireFor({ title: "Für Elise" }).is_public_domain).toBe(true);
  });

  test("a PD row with no genre/catalog/difficulty omits those keys", () => {
    const bare: PdCandidate = {
      id: "eeeeeeee-0000-4000-8000-000000000004",
      title: "Für Elise",
      composer: "Ludwig van Beethoven",
      catalog: null,
      genre: null,
      difficulty: null,
      is_public_domain: true,
    };
    const wire = wireFor({ title: "Für Elise", composer: "Beethoven" }, [bare]);
    expect("catalog" in wire).toBe(false);
    expect("genre" in wire).toBe(false);
    expect("difficulty_label" in wire).toBe(false);
  });
});

// ─── the route wiring (/api/recognize-modern) ───────────────────────────────
describe("modern route — pd_match rides along with the modern match", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubAudD(result: unknown) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "success", result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
  }

  async function callModernRoute(deps?: ModernRecognizeDeps) {
    process.env.MODERN_RECOGNITION_PROVIDER = "audd";
    process.env.AUDD_API_TOKEN = "test-token-not-used";
    const { handleModernRecognize } = await import("./modern-recognize-handler");
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "capture.m4a", { type: "audio/mp4" }),
    );
    const req = new Request("https://site-notesnap.vercel.app/api/recognize-modern", {
      method: "POST",
      body: form,
    });
    const res = await handleModernRecognize(req, deps);
    return { status: res.status, body: (await res.json()) as any };
  }

  /** The production cross-check, over the fixture catalogue (no DB needed). */
  const crossCheckWithCatalog = (catalog: PdCandidate[]) => async (input: {
    title?: string | null;
    artist?: string | null;
    composer?: string | null;
  }) => crossCheckPdCatalog(input, async () => catalog);

  test("OWNER 09-25: AudD says 'Für Elise' (Lang Lang) — the response carries pd_match", async () => {
    stubAudD({
      artist: "Lang Lang",
      title: "Für Elise",
      album: "Piano Book",
      score: 100,
      apple_music: { composerName: "Ludwig van Beethoven", isrc: "QZTEST0000001" },
    });
    const { status, body } = await callModernRoute({ crossCheck: crossCheckWithCatalog(CATALOG) });

    expect(status).toBe(200);
    expect(body.recognized).toBe("modern");
    expect(body.pd_match).toBeDefined();
    expect(body.pd_match.id).toBe(FUR_ELISE.id);
    expect(body.pd_match.is_public_domain).toBe(true);
    expect(body.pd_match.title).toBe("Bagatelle in A Minor (Für Elise)");
    expect(body.pd_match.composer).toBe("Ludwig van Beethoven");
    expect(body.pd_match.sheet_music_available).toBe(false);

    // The modern match is STILL delivered — routing is the app's decision, and
    // the retailer CTAs the user asked for stay in the payload.
    expect(body.modern.song).toBe("Für Elise");
    expect(body.modern.retailerUrl).toBeDefined();
    expect(body.modern.musicnotesUrl).toBeDefined();
  });

  test("a provider match with NO composer metadata still maps (the performer is not a composer)", async () => {
    stubAudD({ artist: "Lang Lang", title: "Für Elise", album: "Piano Book", score: 100 });
    const { body } = await callModernRoute({ crossCheck: crossCheckWithCatalog(CATALOG) });
    expect(body.pd_match?.id).toBe(FUR_ELISE.id);
  });

  test("a genuinely modern song carries NO pd_match key at all (AC/DC 'Big Gun')", async () => {
    stubAudD({ artist: "AC/DC", title: "Big Gun", album: "Last Action Hero", score: 100 });
    const { status, body } = await callModernRoute({ crossCheck: crossCheckWithCatalog(CATALOG) });

    expect(status).toBe(200);
    expect(body.recognized).toBe("modern");
    expect("pd_match" in body).toBe(false);
    expect(body.modern.song).toBe("Big Gun");
  });

  test("a no-match pass does not touch the catalog", async () => {
    stubAudD(null);
    let calls = 0;
    const { body } = await callModernRoute({
      crossCheck: async () => {
        calls += 1;
        return null;
      },
    });
    expect(body.recognized).toBe("none");
    expect(body.modern).toBeNull();
    expect("pd_match" in body).toBe(false);
    expect(calls).toBe(0);
  });

  test("an unreachable catalog still returns the honest modern result", async () => {
    stubAudD({
      artist: "Lang Lang",
      title: "Für Elise",
      album: "Piano Book",
      score: 100,
      apple_music: { composerName: "Ludwig van Beethoven" },
    });
    // The real cross-check over a loader that fails: the enhancement must never
    // cost the user their recognition.
    const { status, body } = await callModernRoute({
      crossCheck: (input) =>
        crossCheckPdCatalog(input, async () => {
          throw new Error("neon unavailable");
        }),
    });
    expect(status).toBe(200);
    expect("pd_match" in body).toBe(false);
    expect(body.modern.song).toBe("Für Elise");
    expect(body.modern.retailerUrl).toContain("sheetmusicdirect.com");
  });
});
