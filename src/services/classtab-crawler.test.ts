/**
 * Tests for the classtab.org crawler + copyright gate.
 *
 * The fixtures are the real notice shapes found in the archive (2026-09-24
 * corpus scan, 3,955 tab files) — the OLGA-era restrictive header, a tab file
 * that grants rights outright, a file that grants and restricts at once, and a
 * file that only mentions "feel free to use your own fingering" (a false
 * positive the gate must NOT accept).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CLASSTAB_SOURCE_TRUST,
  type ClasstabEntry,
  composerSlug,
  classifyTabLicense,
  extractComposerDeathYear,
  gateTabForCatalog,
  isPublicDomainComposer,
  matchCatalogToClasstab,
  normalizeTitle,
  parseClasstabIndex,
  parseTabContent,
} from "./classtab-crawler";

// --- fixtures (real notice wording, trimmed to the lines that matter) --------

/** anon_greensleeves.txt / tarrega_*.txt — 240 files in the archive carry this. */
const RESTRICTIVE_TAB = `Greensleeves (Anon)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
1st version - by Kevin J Manges (easy)
#--------------------------------PLEASE NOTE-------------------------------#
#This file is the author's own work and represents his interpretation of   #
#the song. You may only use this file for private study, scholarship, or   #
#research.                                                                 #
#--------------------------------------------------------------------------#
        Title : Greensleeves
       Artist : Attributed to Henry VIII
e|--------------|----0---------|
B|--0--3--1-----|--------------|
G|--------------|--2--1-----0--|
D|--------4-----|--2-----2-----|
A|--------------|--0-----------|
E|-----0--------|--------------|
`;

/** sor_op14_grand_solo_in_d.txt — a real rights grant. */
const GRANTING_TAB = `#-------------------------------PLEASE NOTE---------------------------------#
# This song is public domain as the composer has been dead for around two   #
# hundred years therefore, feel free to use it for any purpose you see fit. #
#                          May you make it shine.                           #
#---------------------------------------------------------------------------#
Grand Solo
(Sonata "Gran Solo" in D Major, Opus 14)
By Fernando Sor (1778-1839)
FOR THE VIRTUOSO
Transcribed by Ranger Lacy
e|--2--|--0--|--2--|
B|--3--|-----|-----|
G|-----|--1--|-----|
D|-----|-----|--0--|
A|--0--|-----|-----|
E|-----|--3--|-----|
`;

/** regondi_op19_nocturne_reverie.txt — grant + restriction in one file. */
const MIXED_TAB = `!!These are my own left hand fingerings, so feel free to use whatever works for yourself.!!
#This file is the author's own work and represents their interpretation of the#
#song. You may only use this file for private study, scholarship, or research.#
e|--0--|--0--|--0--|
B|--1--|--1--|--1--|
G|--0--|--2--|--0--|
D|--2--|--0--|--2--|
A|--3--|--3--|--3--|
E|-----|--3--|-----|
`;

/** bach_js_bwv1006_..._bourree.txt — "feel free" about fingering only. */
const FINGERING_ONLY_TAB = `Bourree - BWV 1006 - Johann Sebastian Bach (1685-1750)
Of course, feel free to use your own fingering!
e|--0--|--0--|--0--|
B|--1--|--1--|--1--|
G|--0--|--2--|--0--|
D|--2--|--0--|--2--|
A|--3--|--3--|--3--|
E|-----|--3--|-----|
`;

const INDEX_FIXTURE = `<html><body>
<a href="barbieri_mario_la_serra_1_myosotis_alpestris.txt">La Serra (The Greenhouse) - 1</a><br>
Greensleeves - see <a href="#greensleeves">anonymous / traditional</a><br>
<a href="anon_greensleeves.txt">Greensleeves</a> - <a href="anon_greensleeves.mid">MIDI</a> - easy<br>
<a href="sor_op14_grand_solo_in_d.txt">Op 14, Grand Solo in D</a> - <a href="sor_op14_grand_solo_in_d.mid">MIDI</a><br>
<a href="tarrega_recuerdos_de_la_alhambra.txt">Recuerdos De La Alhambra</a><br>
<a href="albeniz_isaac_op047_no5_espanola_asturias.txt">Op 47 Suite Espa&ntilde;ola - 5. Asturias (Leyenda)</a><br>
</body></html>`;

const entry = (href: string, label: string, prefix: string): ClasstabEntry => ({
  href,
  label,
  url: `https://www.classtab.org/${href}`,
  midiHref: null,
  filePrefix: prefix,
});

// --- normalisation ----------------------------------------------------------

describe("normalizeTitle / composerSlug", () => {
  test("folds diacritics, opus numbers and punctuation", () => {
    expect(normalizeTitle("Capricho Árabe")).toBe("capricho arabe");
    expect(normalizeTitle("Study in C Major")).toBe("study in c major");
    expect(normalizeTitle("Op 47 Suite Española - 5. Asturias (Leyenda)")).toBe(
      "suite espanola 5 asturias leyenda",
    );
    expect(normalizeTitle("BWV 846 WTC Book 1 Prelude in C")).toBe("wtc book 1 prelude in c");
  });
  test("composerSlug uses the surname", () => {
    expect(composerSlug("Fernando Sor")).toBe("sor");
    expect(composerSlug("Johann Sebastian Bach")).toBe("bach");
    expect(composerSlug("Francisco Tárrega")).toBe("tarrega");
    expect(composerSlug("")).toBe("");
  });
});

// --- index parsing ---------------------------------------------------------

describe("parseClasstabIndex", () => {
  test("returns one entry per .txt link and decodes entities", () => {
    const entries = parseClasstabIndex(INDEX_FIXTURE);
    expect(entries.map((e) => e.href)).toEqual([
      "barbieri_mario_la_serra_1_myosotis_alpestris.txt",
      "anon_greensleeves.txt",
      "sor_op14_grand_solo_in_d.txt",
      "tarrega_recuerdos_de_la_alhambra.txt",
      "albeniz_isaac_op047_no5_espanola_asturias.txt",
    ]);
    const asturias = entries.find((e) => e.href.includes("asturias"))!;
    expect(asturias.label).toContain("Española");
    expect(asturias.url).toBe(
      "https://www.classtab.org/albeniz_isaac_op047_no5_espanola_asturias.txt",
    );
    expect(entries.find((e) => e.href.startsWith("anon_"))!.midiHref).toBe(
      "anon_greensleeves.mid",
    );
    expect(entries[0].filePrefix).toBe("barbieri");
  });
  test("ignores anchor links that are not tab files", () => {
    const entries = parseClasstabIndex(INDEX_FIXTURE);
    expect(entries.some((e) => e.href.startsWith("#"))).toBe(false);
  });
});

// --- matching --------------------------------------------------------------

describe("matchCatalogToClasstab", () => {
  const entries = parseClasstabIndex(INDEX_FIXTURE);
  test("matches a catalog piece to its tab", () => {
    const matches = matchCatalogToClasstab(
      [{ id: "p1", title: "Recuerdos de la Alhambra", composer: "Francisco Tárrega" }],
      entries,
    );
    expect(matches.length).toBe(1);
    expect(matches[0].entry.href).toBe("tarrega_recuerdos_de_la_alhambra.txt");
  });
  test("does not attach another composer's tab on a shared title word", () => {
    const matches = matchCatalogToClasstab(
      [{ id: "p2", title: "Prelude in C", composer: "Frédéric Chopin" }],
      entries,
    );
    expect(matches).toEqual([]);
  });
});

// --- licence classification -------------------------------------------------

describe("classifyTabLicense", () => {
  test("restrictive OLGA header -> RESTRICTED", () => {
    const a = classifyTabLicense(RESTRICTIVE_TAB);
    expect(a.verdict).toBe("RESTRICTED");
    expect(a.restrictions.join(" ")).toContain("You may only use this file for private study");
    expect(a.reason).toContain("restrictive notice");
  });
  test("explicit public-domain grant -> PD_CLEARED", () => {
    const a = classifyTabLicense(GRANTING_TAB);
    expect(a.verdict).toBe("PD_CLEARED");
    expect(a.grants[0]).toContain("public domain");
  });
  test("grant + restriction -> the restriction wins", () => {
    expect(classifyTabLicense(MIXED_TAB).verdict).toBe("RESTRICTED");
  });
  test("no rights statement at all -> NO_LICENSE_STATEMENT (silence is not a grant)", () => {
    const a = classifyTabLicense("Adelita\nFrancisco Tarrega (1852-1909)\ne|--0--|\n");
    expect(a.verdict).toBe("NO_LICENSE_STATEMENT");
  });
  test("'feel free to use your own fingering' is not a rights grant", () => {
    expect(classifyTabLicense(FINGERING_ONLY_TAB).verdict).toBe("NO_LICENSE_STATEMENT");
  });
  test("extractComposerDeathYear reads the header life dates", () => {
    expect(extractComposerDeathYear(RESTRICTIVE_TAB)).toBeNull();
    expect(extractComposerDeathYear(GRANTING_TAB)).toBe(1839);
    expect(extractComposerDeathYear("Francisco Tarrega (1852-1909)\n")).toBe(1909);
  });
  test("isPublicDomainComposer only accepts a verified, early-enough death year", () => {
    expect(isPublicDomainComposer(1839)).toBe(true);
    expect(isPublicDomainComposer(1909)).toBe(true);
    expect(isPublicDomainComposer(1944)).toBe(false); // Barrios — still protected
    expect(isPublicDomainComposer(null)).toBe(false); // unknown is not PD
  });
});

// --- tab content ------------------------------------------------------------

describe("parseTabContent", () => {
  test("finds the headline, transcriber, tuning and tablature frames", () => {
    const t = parseTabContent(GRANTING_TAB);
    expect(t.headline).toBe(
      "#-------------------------------PLEASE NOTE---------------------------------#",
    );
    expect(t.tabulator).toBe("Ranger Lacy");
    expect(t.hasTablature).toBe(true);
    expect(t.tabLineCount).toBeGreaterThanOrEqual(6);
  });
  test("a 404/stub page has no tablature", () => {
    const t = parseTabContent("<html><title>custom 404 error page for classtab.org</title></html>");
    expect(t.hasTablature).toBe(false);
  });
});

// --- the gate ---------------------------------------------------------------

describe("gateTabForCatalog", () => {
  const match = {
    pieceId: "11111111-1111-1111-1111-111111111111",
    pieceTitle: "Grand Solo",
    composer: "Fernando Sor",
    entry: entry("sor_op14_grand_solo_in_d.txt", "Op 14, Grand Solo in D", "sor"),
    score: 1,
    reason: "exact title",
  };
  test("PD-cleared tab with a PD composer becomes a guitar source row", () => {
    const d = gateTabForCatalog(match, GRANTING_TAB);
    expect(d.included).toBe(true);
    expect(d.row).toEqual({
      pieceId: match.pieceId,
      sourcePlatform: "classtab",
      sourceUrl: "https://www.classtab.org/sor_op14_grand_solo_in_d.txt",
      format: "text_tab",
      arrangementType: "guitar",
      rating: 0,
      voteCount: 0,
      downloadCount: 0,
      sourceTrust: CLASSTAB_SOURCE_TRUST,
      curationScore: 0.6,
      isPrimary: false,
      isFlagged: false,
    });
  });
  test("restrictive tab is excluded with the notice quoted", () => {
    const d = gateTabForCatalog(match, RESTRICTIVE_TAB);
    expect(d.included).toBe(false);
    expect(d.row).toBeNull();
    expect(d.reason).toContain("restrictive notice");
  });
  test("silent tab is excluded as ambiguous", () => {
    const d = gateTabForCatalog(match, "Grand Solo\nFernando Sor\ne|--0--|\n");
    expect(d.included).toBe(false);
    expect(d.verdict).toBe("NO_LICENSE_STATEMENT");
  });
  test("a grant is not enough when the composer is not verifiably PD", () => {
    const late = GRANTING_TAB.replace("(1778-1839)", "(1884-1944)");
    const d = gateTabForCatalog(match, late);
    expect(d.included).toBe(false);
    expect(d.reason).toContain("not clearly PD");
  });
  test("an unfetchable tab is excluded, not assumed free", () => {
    const d = gateTabForCatalog(match, null);
    expect(d.included).toBe(false);
    expect(d.reason).toContain("could not be fetched");
  });
  test("a fetched 404 page is excluded", () => {
    const d = gateTabForCatalog(match, "<html>custom 404 error page for classtab.org</html>");
    expect(d.included).toBe(false);
    expect(d.reason).toContain("not tablature");
  });
});

// --- source-scan regression guards -----------------------------------------

describe("classtab crawler source guards", () => {
  const cli = readFileSync(new URL("../../scripts/classtab-ingest.ts", import.meta.url), "utf8");
  const mod = readFileSync(new URL("./classtab-crawler.ts", import.meta.url), "utf8");

  test("rows are written only from the gate's `included` set", () => {
    // The CLI must route every insert through the ledger's included decisions.
    expect(cli).toContain("const included = decisions.filter((d) => d.included)");
    expect(cli).toContain("await writeRows(included)");
    expect(cli).toContain("await writeRows(ledger.included ?? [])");
    // No insert may run on an un-gated decision.
    expect(cli).not.toMatch(/writeRows\((?:decisions|matches|excluded)\)/);
  });

  test("the gate refuses anything that is not PD_CLEARED", () => {
    expect(mod).toContain('if (assessment.verdict !== "PD_CLEARED")');
    expect(mod).toContain("isPublicDomainComposer(assessment.composerDied");
  });

  test("guitar rows use the schema's arrangement_type/format values", () => {
    expect(mod).toContain('arrangementType: "guitar"');
    expect(mod).toContain('format: "text_tab"');
    expect(mod).toContain('sourcePlatform: "classtab"');
  });

  test("the crawler never touches recognition/fingerprint code", () => {
    for (const forbidden of ["piece_landmarks", "fingerprint", "extractLandmarks", "recognize"]) {
      expect(mod.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(cli.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
