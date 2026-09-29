/**
 * Affiliate URL contract tests (owner on-device bug 2026-09-22 — THE MONEY PATH).
 *
 * The owner tapped "Get the official sheet music" on device and landed on SMD's
 * own "Page Not Found … you appear to have found something broken on our
 * website" page. The builder was emitting `/en-US/search?searchText=…`, a route
 * SMD does not serve. These tests pin the live, probe-verified shape
 * (`/en-US/Search.aspx?query=…` + affiliate ID 67650) so the dead link can never
 * ship again — and they scan the real `src/` tree, because the bug class here is
 * "a URL was hand-written somewhere the unit tests never looked".
 *
 * Run with: bun test src/services/affiliate-url-contract.test.ts
 */
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  MUSICNOTES_RETIRED_QUERY_PARAM,
  MUSICNOTES_RETIRED_SEARCH_PATH,
  MUSICNOTES_RETIRED_TAG,
  MUSICNOTES_SEARCH_ORIGIN,
  MUSICNOTES_SEARCH_PATH,
  MUSICNOTES_SEARCH_QUERY_PARAM,
  SMD_AFFILIATE_ID,
  SMD_DEAD_SEARCH_PATHS,
  SMD_SEARCH_PATH,
  SMD_SEARCH_QUERY_PARAM,
  auditMusicnotesSearchUrl,
  auditSmdAffiliateUrl,
  isDeadSmdSearchPath,
  isDeadSmdSearchUrl,
  scanSourcesForDeadSmdRoute,
  scanSourcesForNoteSnapReferrerTag,
  scanSourcesForRetiredMusicnotesRoute,
  type ScannedSource,
} from "./affiliate-url-contract";
import {
  modernRetailerUrls,
  sheetMusicDirectSearchUrl,
} from "./modern-retailer";
import { pieceAffiliateUrl } from "./piece-affiliate";
import { probeMusicnotesSearch } from "./musicnotes-search-probe";

const SRC_ROOT = join(import.meta.dir, "..");
const THIS_FILE = "services/affiliate-url-contract.test.ts";
const CONTRACT_FILE = "services/affiliate-url-contract.ts";

function walkSources(dir: string, out: ScannedSource[] = []): ScannedSource[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkSources(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    out.push({ path: relative(SRC_ROOT, full), content: readFileSync(full, "utf8") });
  }
  return out;
}

describe("auditSmdAffiliateUrl — live route + attribution", () => {
  test("accepts the live builder output", () => {
    const url = sheetMusicDirectSearchUrl("Für Elise Ludwig van Beethoven")!;
    const audit = auditSmdAffiliateUrl(url);
    expect(audit.problems).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  test("REJECTS the retired dead route the owner hit on device", () => {
    const dead =
      "https://www.sheetmusicdirect.com/en-US/search" +
      `?searchText=Fur%20Elise&tid=${SMD_AFFILIATE_ID}&affiliateId=${SMD_AFFILIATE_ID}`;
    const audit = auditSmdAffiliateUrl(dead);
    expect(audit.ok).toBe(false);
    expect(audit.problems.join(" | ")).toContain("dead SMD search route");
    expect(audit.problems.join(" | ")).toContain("retired parameter present");
  });

  test("rejects a URL on the live path that lost its affiliate ID", () => {
    const stripped = `https://www.sheetmusicdirect.com${SMD_SEARCH_PATH}?${SMD_SEARCH_QUERY_PARAM}=Elise`;
    const audit = auditSmdAffiliateUrl(stripped);
    expect(audit.ok).toBe(false);
    expect(audit.problems.join(" | ")).toContain(`tid must be ${SMD_AFFILIATE_ID}`);
    expect(audit.problems.join(" | ")).toContain(
      `affiliateId must be ${SMD_AFFILIATE_ID}`,
    );
  });

  test("rejects a mismatched affiliate ID (attribution would go to someone else)", () => {
    const wrong = `https://www.sheetmusicdirect.com${SMD_SEARCH_PATH}?${SMD_SEARCH_QUERY_PARAM}=Elise&tid=99999&affiliateId=99999`;
    expect(auditSmdAffiliateUrl(wrong).ok).toBe(false);
  });

  test("rejects an empty query and a non-parseable string", () => {
    expect(
      auditSmdAffiliateUrl(
        `https://www.sheetmusicdirect.com${SMD_SEARCH_PATH}?${SMD_SEARCH_QUERY_PARAM}=&tid=${SMD_AFFILIATE_ID}&affiliateId=${SMD_AFFILIATE_ID}`,
      ).ok,
    ).toBe(false);
    expect(auditSmdAffiliateUrl("not a url").ok).toBe(false);
  });

  test("isDeadSmdSearchPath flags exactly the retired routes", () => {
    for (const dead of SMD_DEAD_SEARCH_PATHS) {
      expect(isDeadSmdSearchPath(dead)).toBe(true);
      expect(isDeadSmdSearchPath(dead.toUpperCase())).toBe(true);
    }
    expect(isDeadSmdSearchPath(SMD_SEARCH_PATH)).toBe(false);
    expect(isDeadSmdSearchPath("/en-US/Search.aspx")).toBe(false);
  });

  test("isDeadSmdSearchUrl compares the PATH, so the live .aspx route is not a false alarm", () => {
    const live = `https://www.sheetmusicdirect.com${SMD_SEARCH_PATH}?${SMD_SEARCH_QUERY_PARAM}=Elise&tid=${SMD_AFFILIATE_ID}&affiliateId=${SMD_AFFILIATE_ID}`;
    // the live URL *contains* the substring "/en-us/search" — a naive toContain() would flag it
    expect(live.toLowerCase()).toContain("/en-us/search");
    expect(isDeadSmdSearchUrl(live)).toBe(false);
    expect(isDeadSmdSearchUrl("https://www.sheetmusicdirect.com/en-US/search?searchText=x")).toBe(true);
    expect(isDeadSmdSearchUrl("garbage")).toBe(false);
  });
});

describe("every emitted affiliate URL satisfies the contract", () => {
  test("modern-song + 40 piece-page links, incl. awkward queries", () => {
    const queries = [
      "Für Elise Ludwig van Beethoven",
      "Clair de Lune Claude Debussy",
      "Rock & Roll Led Zeppelin",
      "Title #2 (Live) Band?",
      "Symphony No. 5 in C Minor, Op. 67",
      "Greensleeves",
    ];
    for (const q of queries) {
      const url = sheetMusicDirectSearchUrl(q);
      expect(url).toBeDefined();
      expect(auditSmdAffiliateUrl(url!).ok).toBe(true);
      const params = new URL(url!).searchParams;
      expect(params.get("tid")).toBe(SMD_AFFILIATE_ID);
      expect(params.get("affiliateId")).toBe(SMD_AFFILIATE_ID);
      expect(params.get(SMD_SEARCH_QUERY_PARAM)).toBe(q);
    }
    // the piece-page path (525 CTAs) funnels through the same builder
    const pieceUrl = pieceAffiliateUrl("Bagatelle in A Minor (Fur Elise)", "Ludwig van Beethoven")!;
    expect(isDeadSmdSearchUrl(pieceUrl)).toBe(false);
    expect(auditSmdAffiliateUrl(pieceUrl).ok).toBe(true);
  });

  test("no builder path returns an unattributed SMD URL", () => {
    for (const q of ["A", "Ünïcøde & query", "x".repeat(300)]) {
      const url = sheetMusicDirectSearchUrl(q)!;
      expect(url).toContain(`tid=${SMD_AFFILIATE_ID}`);
      expect(url).toContain(`affiliateId=${SMD_AFFILIATE_ID}`);
    }
    expect(sheetMusicDirectSearchUrl("   ")).toBeUndefined();
  });
});

describe("source scan — the dead route is gone from src/", () => {
  test("no source file (other than the contract module) still references /en-US/search or searchText=", () => {
    const files = walkSources(SRC_ROOT);
    // Floors: an empty/failed walk must never pass.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.content.includes("sheetmusicdirect.com"))).toBe(true);

    const offenders = scanSourcesForDeadSmdRoute(files, [CONTRACT_FILE, THIS_FILE]);
    expect(offenders.map((o) => `${o.path}:${o.line} ${o.text}`)).toEqual([]);
  });

  test("the scanner actually catches the retired URL (guard cannot silently no-op)", () => {
    const planted: ScannedSource[] = [
      {
        path: "services/planted-template.ts",
        content:
          'const u = `https://www.sheetmusicdirect.com/en-US/search?searchText=${q}`;\n',
      },
    ];
    const found = scanSourcesForDeadSmdRoute(planted, [CONTRACT_FILE]);
    expect(found.length).toBe(1);
    expect(found[0].path).toBe("services/planted-template.ts");
  });

  test("the scanner ignores the live Search.aspx route", () => {
    const live: ScannedSource[] = [
      {
        path: "services/live.ts",
        content: `const u = "https://www.sheetmusicdirect.com${SMD_SEARCH_PATH}?query=x";`,
      },
    ];
    expect(scanSourcesForDeadSmdRoute(live, [])).toEqual([]);
  });
});

/**
 * Musicnotes backup shape (owner on-device bug 2026-09-25, RC v26 Test 4a
 * finding #3 + Test 5). The backup URL used to carry the tag `w=NoteSnap`, and
 * Musicnotes' search page reads `w` AS ITS QUERY: the owner's phone showed
 * "NoteSnap" in the search box and the engine searched that literal word,
 * returning one unrelated fuzzy result. The tag bought no commission (Sheet Music
 * Direct carries affiliate ID 67650), so it is banned outright — along with any
 * SECOND hand-written Musicnotes URL builder, which is how the tag survived two
 * copies of the same template.
 */
describe("source scan — the Musicnotes backup shape cannot regress", () => {
  const CONTRACT_FILE = "services/affiliate-url-contract.ts";

  test("no source file still carries the retired w tag", () => {
    const files = walkSources(SRC_ROOT);
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.content.includes("musicnotes.com"))).toBe(true);

    const offenders = scanSourcesForNoteSnapReferrerTag(files, [
      CONTRACT_FILE,
      THIS_FILE,
    ]);
    expect(offenders.map((o) => `${o.path}:${o.line} ${o.rule} ${o.text}`)).toEqual(
      [],
    );
  });

  test("the live backup URL carries the query in `w` on the LIVE route (owner 09-28)", () => {
    const { musicnotes } = modernRetailerUrls("Let It Be", "The Beatles");
    const url = new URL(musicnotes!);
    expect(url.hostname).toBe("www.musicnotes.com");
    expect(url.pathname).toBe(MUSICNOTES_SEARCH_PATH);
    expect([...url.searchParams.keys()]).toEqual([MUSICNOTES_SEARCH_QUERY_PARAM]);
    expect(url.searchParams.get(MUSICNOTES_SEARCH_QUERY_PARAM)).toBe(
      "Let It Be The Beatles",
    );
    expect(musicnotes!).not.toContain(MUSICNOTES_RETIRED_SEARCH_PATH);
    expect(url.searchParams.has(MUSICNOTES_RETIRED_QUERY_PARAM)).toBe(false);
    expect(musicnotes!).not.toContain(MUSICNOTES_RETIRED_TAG);
    expect(musicnotes!).not.toContain("NoteSnap");
    // and the emitted link satisfies the Musicnotes audit
    expect(auditMusicnotesSearchUrl(musicnotes!).problems).toEqual([]);
  });

  test("the scanner catches a planted w tag (guard cannot silently no-op)", () => {
    const planted: ScannedSource[] = [
      {
        path: "services/planted-backup.ts",
        content:
          'const u = `https://www.musicnotes.com/search/go?q=${q}&w=NoteSnap`;\n',
      },
    ];
    const found = scanSourcesForNoteSnapReferrerTag(planted, []);
    expect(found.length).toBe(1);
    expect(found[0].path).toBe("services/planted-backup.ts");
    expect(found[0].rule).toBe("w=NoteSnap tag");
  });

  test("the scanner catches a planted hand-written Musicnotes URL — even without the tag", () => {
    const planted: ScannedSource[] = [
      {
        path: "services/planted-builder.ts",
        content:
          'return `https://www.musicnotes.com/search/go?q=${encodeURIComponent(q)}`;\n',
      },
    ];
    const found = scanSourcesForNoteSnapReferrerTag(planted, []);
    expect(found.length).toBe(1);
    expect(found[0].rule).toBe("hand-written Musicnotes URL");
  });

  test("the ONE builder module may spell the URL out (allowlisted, and still scanned for the tag)", () => {
    const builder: ScannedSource[] = [
      {
        path: "services/modern-retailer.ts",
        content:
          'const t = "https://www.musicnotes.com/search/go?q={{query}}";\n',
      },
    ];
    expect(scanSourcesForNoteSnapReferrerTag(builder, [])).toEqual([]);
    // ...but the tag is a violation THERE too (only the contract module and this
    // test may name the retired tag).
    const builderWithTag: ScannedSource[] = [
      {
        path: "services/modern-retailer.ts",
        content: 'const u = "https://www.musicnotes.com/search/go?q=x&w=NoteSnap";\n',
      },
    ];
    const found = scanSourcesForNoteSnapReferrerTag(builderWithTag, []);
    expect(found.length).toBe(1);
    expect(found[0].rule).toBe("w=NoteSnap tag");
  });

  test("a doc that merely NAMES the tag (no ? or & before it) is not an offender", () => {
    const doc: ScannedSource[] = [
      { path: "services/notes.ts", content: "// the retired w=NoteSnap tag\n" },
    ];
    expect(scanSourcesForNoteSnapReferrerTag(doc, [])).toEqual([]);
  });
});

/**
 * Musicnotes LIVE route + parameter (owner on-device bug 2026-09-28, RC v28
 * Test 12 / fc19fe16) — "the Musicnotes CTA shows the wrong page".
 *
 * TWO wrong-URL bugs lived in the backup link, and both produced the SAME page:
 *   * the builder emitted the RETIRED Musicnotes sub-route, and
 *   * `q` is not Musicnotes' search parameter either (its own form is
 *     `GET /search` with a single text field `w`).
 * The retailer answers a URL carrying neither with its EMPTY-QUERY "Popular"
 * browse grid — HTTP 200, `<title>Search:  | Musicnotes</title>` — whose all-time
 * top seller is Für Elise, i.e. exactly the wrong sheet the owner saw.
 *
 * Three layers guard it now: `auditMusicnotesSearchUrl()` on every emitted link,
 * a source scan for the retired route, and a LIVE probe that checks the rendered
 * document actually ran the query (Cloudflare can block this box — that verdict is
 * reported, never a failure).
 */
describe("Musicnotes LIVE route + parameter (owner 09-28, RC v28 Test 12)", () => {
  const QUERY = "Let It Be The Beatles";
  /** The emitted backup link — the artefact the device opens. */
  const liveUrl = modernRetailerUrls("Let It Be", "The Beatles").musicnotes!;
  /** The retired shape, reconstructed from the contract constants. */
  const retiredUrl =
    `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_RETIRED_SEARCH_PATH}` +
    `?${MUSICNOTES_RETIRED_QUERY_PARAM}=${encodeURIComponent(QUERY)}`;

  test("the emitter's audit accepts the builder output and pins the exact query", () => {
    const audit = auditMusicnotesSearchUrl(liveUrl, QUERY);
    expect(audit.problems).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  test("the audit REJECTS the retired sub-route (the wrong-page bug)", () => {
    const audit = auditMusicnotesSearchUrl(retiredUrl);
    expect(audit.ok).toBe(false);
    expect(audit.problems.join(" | ")).toContain("retired Musicnotes route");
    // `q` is not Musicnotes' parameter either, so this URL is doubly wrong
    expect(audit.problems.join(" | ")).toContain(
      `retired parameter present: ${MUSICNOTES_RETIRED_QUERY_PARAM}`,
    );
  });

  test("the audit REJECTS the live path carrying the retired parameter (empty-query page)", () => {
    // Repointing the ROUTE alone is not the fix: `?q=` on `/search` renders the
    // same empty-query "Popular" grid (probe-verified 09-28).
    const routeOnly =
      `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}` +
      `?${MUSICNOTES_RETIRED_QUERY_PARAM}=${encodeURIComponent(QUERY)}`;
    const audit = auditMusicnotesSearchUrl(routeOnly);
    expect(audit.ok).toBe(false);
    expect(audit.problems.join(" | ")).toContain("retired parameter present");
    expect(audit.problems.join(" | ")).toContain("missing/empty w parameter");
  });

  test("the audit rejects an empty query, a wrong query and the retired tag", () => {
    const noQuery = `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}`;
    expect(auditMusicnotesSearchUrl(noQuery).ok).toBe(false);
    expect(auditMusicnotesSearchUrl(noQuery).problems.join(" | ")).toContain(
      "missing/empty w parameter",
    );
    const blank =
      `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}?${MUSICNOTES_SEARCH_QUERY_PARAM}=`;
    expect(auditMusicnotesSearchUrl(blank).ok).toBe(false);
    // the query is the shopper's song, not whatever the caller thought
    expect(auditMusicnotesSearchUrl(liveUrl, "Some Other Song").ok).toBe(false);
    // the retired TAG VALUE is still banned: `w` is the query itself
    const tag =
      `${MUSICNOTES_SEARCH_ORIGIN}${MUSICNOTES_SEARCH_PATH}` +
      `?${MUSICNOTES_SEARCH_QUERY_PARAM}=${MUSICNOTES_RETIRED_TAG.split("=")[1]}`;
    const tagAudit = auditMusicnotesSearchUrl(tag);
    expect(tagAudit.ok).toBe(false);
    expect(tagAudit.problems.join(" | ")).toContain("retired w=NoteSnap tag present");
    expect(auditMusicnotesSearchUrl("not a url").ok).toBe(false);
    expect(auditMusicnotesSearchUrl("https://example.test/search?w=x").ok).toBe(false);
  });

  test("no source file spells the RETIRED Musicnotes route any more", () => {
    const files = walkSources(SRC_ROOT);
    // Floors: an empty/failed walk must never pass.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.content.includes("musicnotes.com"))).toBe(true);

    const offenders = scanSourcesForRetiredMusicnotesRoute(files, [
      CONTRACT_FILE,
      THIS_FILE,
    ]);
    expect(offenders.map((o) => `${o.path}:${o.line} ${o.text}`)).toEqual([]);
  });

  test("the retired-route scanner catches a planted template (guard cannot silently no-op)", () => {
    const planted: ScannedSource[] = [
      {
        path: "services/planted-musicnotes.ts",
        content:
          `const u = "https://www.musicnotes.com${MUSICNOTES_RETIRED_SEARCH_PATH}` +
          `?${MUSICNOTES_RETIRED_QUERY_PARAM}=\${q}";\n`,
      },
    ];
    const found = scanSourcesForRetiredMusicnotesRoute(planted, []);
    expect(found.length).toBe(1);
    expect(found[0].path).toBe("services/planted-musicnotes.ts");
    expect(found[0].line).toBe(1);
  });

  test("the retired-route scanner ignores the LIVE /search route", () => {
    const live: ScannedSource[] = [
      {
        path: "services/live.ts",
        content: `const u = "https://www.musicnotes.com${MUSICNOTES_SEARCH_PATH}?${MUSICNOTES_SEARCH_QUERY_PARAM}=x";\n`,
      },
    ];
    expect(scanSourcesForRetiredMusicnotesRoute(live, [])).toEqual([]);
  });

  test("LIVE PROBE: the retailer's rendered page runs the query the URL carries", async () => {
    // The only assertion that can see the wrong-page bug: the URL was always
    // well-formed. Musicnotes sits behind Cloudflare and a datacenter IP can get
    // its bot check (HTTP 403 "Just a moment...") — that is an environment fact,
    // NOT a product defect, so it is reported and the gate falls back to the
    // shape + source-scan assertions above. Real evidence of the bug (a Search
    // page with an EMPTY query) fails, because that is the owner's wrong sheet.
    const probe = await probeMusicnotesSearch(liveUrl, { timeoutMs: 15000 });
    console.log(`[musicnotes live probe] ${probe.requestedUrl} -> ${probe.detail}`);
    if (
      probe.verdict === "cloudflare-challenge" ||
      probe.verdict === "http-error" ||
      probe.verdict === "unrecognized-page"
    ) {
      // Fallback (documented, not silent): the link's shape is the contract.
      expect(auditMusicnotesSearchUrl(liveUrl, QUERY).problems).toEqual([]);
      return;
    }
    expect(
      probe.verdict,
      `Musicnotes rendered ${JSON.stringify(probe.title)} for ${probe.requestedUrl}`,
    ).toBe("query-executed");
    expect(probe.queryExecuted).toBe(true);
    // the page echoes the query it actually ran
    expect(probe.title).toContain("Musicnotes");
  });
});
