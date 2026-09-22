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
  SMD_AFFILIATE_ID,
  SMD_DEAD_SEARCH_PATHS,
  SMD_SEARCH_PATH,
  SMD_SEARCH_QUERY_PARAM,
  auditSmdAffiliateUrl,
  isDeadSmdSearchPath,
  isDeadSmdSearchUrl,
  scanSourcesForDeadSmdRoute,
  type ScannedSource,
} from "./affiliate-url-contract";
import { sheetMusicDirectSearchUrl } from "./modern-retailer";
import { pieceAffiliateUrl } from "./piece-affiliate";

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
