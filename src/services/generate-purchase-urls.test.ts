/**
 * Regression tests for the /api/recognize purchase-URL map (LINK AUDIT 2026-09-22).
 *
 * Two money-path defects fixed here:
 *  1. The map had NO Sheet Music Direct entry, so every CTA built from it (the
 *     site's recognition demo) pointed at Musicnotes — the backup retailer, ~5%
 *     — while SMD (owner-approved PRIMARY, affiliate ID 67650, 10%) carries the
 *     link on all other surfaces. The primary is now built through the verified
 *     `sheetMusicDirectSearchUrl` builder, so `tid`/`affiliateId` are attached.
 *  2. The map emitted an unattributed **JW Pepper** link on every copyrighted
 *     match, because the builder iterated the whole `AFFILIATE_RETAILERS`
 *     registry, which included a retailer that is not approved and has no
 *     affiliate ID. It must not be emitted, even if a caller asks for it.
 *
 * Run with: bun test src/services/generate-purchase-urls.test.ts
 */
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  APPROVED_PURCHASE_URL_KEYS,
  BACKUP_PURCHASE_URL_KEY,
  PRIMARY_PURCHASE_URL_KEY,
  generatePurchaseUrls,
  isApprovedPurchaseUrlKey,
  primaryPurchaseUrl,
  scanSourcesForHardwiredRetailerKey,
} from "./generate-purchase-urls";
import { SMD_AFFILIATE_ID, auditSmdAffiliateUrl } from "./affiliate-url-contract";
import { AFFILIATE_RETAILERS } from "./affiliates";

const TITLE = "Let It Be";
const COMPOSER = "The Beatles";
const SRC_ROOT = join(import.meta.dir, "..");
const THIS_FILE = "services/generate-purchase-urls.test.ts";
const CONTRACT_FILE = "services/generate-purchase-urls.ts";

function walkSources(dir: string, out: { path: string; content: string }[] = []) {
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

describe("generatePurchaseUrls — SMD is the primary entry", () => {
  test("the map includes Sheet Music Direct, contract-verified and attributed", () => {
    const urls = generatePurchaseUrls(TITLE, COMPOSER);
    const smd = urls[PRIMARY_PURCHASE_URL_KEY];
    expect(smd).toBeDefined();
    // The link must satisfy the money-path contract (live route + both params)
    const audit = auditSmdAffiliateUrl(smd);
    expect(audit.problems).toEqual([]);
    expect(audit.ok).toBe(true);
    const params = new URL(smd).searchParams;
    expect(params.get("tid")).toBe(SMD_AFFILIATE_ID);
    expect(params.get("affiliateId")).toBe(SMD_AFFILIATE_ID);
    expect(params.get("query")).toBe(`${TITLE} ${COMPOSER}`);
  });

  test("the primary entry is first, and a CTA resolves to it", () => {
    const urls = generatePurchaseUrls(TITLE, COMPOSER);
    expect(Object.keys(urls)[0]).toBe(PRIMARY_PURCHASE_URL_KEY);
    expect(primaryPurchaseUrl(urls)).toBe(urls[PRIMARY_PURCHASE_URL_KEY]);
    // The regression: the demo CTA used to render the backup retailer's link.
    expect(primaryPurchaseUrl(urls)).not.toContain("musicnotes.com");
  });

  test("musicnotes stays as the backup entry (existing behaviour preserved)", () => {
    const urls = generatePurchaseUrls(TITLE, COMPOSER);
    expect(urls[BACKUP_PURCHASE_URL_KEY]).toContain(
      "https://www.musicnotes.com/search/go?q=",
    );
    expect(urls[BACKUP_PURCHASE_URL_KEY]).toContain(
      encodeURIComponent(`${TITLE} ${COMPOSER}`),
    );
  });

  test("the backup is only used when the primary cannot be built", () => {
    // An empty query is the one case the SMD builder declines (nothing to search)
    const urls = generatePurchaseUrls("", "");
    expect(urls[PRIMARY_PURCHASE_URL_KEY]).toBeUndefined();
    expect(primaryPurchaseUrl(urls)).toBe(urls[BACKUP_PURCHASE_URL_KEY]);
  });

  test("primaryPurchaseUrl is safe on every shape a caller can hand it", () => {
    expect(primaryPurchaseUrl(null)).toBeUndefined();
    expect(primaryPurchaseUrl(undefined)).toBeUndefined();
    expect(primaryPurchaseUrl({})).toBeUndefined();
    expect(primaryPurchaseUrl({ [PRIMARY_PURCHASE_URL_KEY]: "  " })).toBeUndefined();
    expect(primaryPurchaseUrl({ [BACKUP_PURCHASE_URL_KEY]: "https://x.test" })).toBe(
      "https://x.test",
    );
  });

  test("awkward titles still produce a contract-valid SMD link", () => {
    for (const [title, composer] of [
      ["Für Elise", "Ludwig van Beethoven"],
      ["Rock & Roll", "Led Zeppelin"],
      ["Title #2 (Live)", "Band?"],
      ["Symphony No. 5 in C Minor, Op. 67", ""],
    ] as const) {
      const urls = generatePurchaseUrls(title, composer);
      expect(auditSmdAffiliateUrl(urls[PRIMARY_PURCHASE_URL_KEY]).ok).toBe(true);
    }
  });
});

describe("no unapproved retailer can be emitted", () => {
  test("the approved list is exactly SMD + Musicnotes", () => {
    expect([...APPROVED_PURCHASE_URL_KEYS]).toEqual([
      PRIMARY_PURCHASE_URL_KEY,
      BACKUP_PURCHASE_URL_KEY,
    ]);
    expect(isApprovedPurchaseUrlKey("jwpepper")).toBe(false);
    expect(isApprovedPurchaseUrlKey("sheetmusicplus")).toBe(false);
    expect(isApprovedPurchaseUrlKey(PRIMARY_PURCHASE_URL_KEY)).toBe(true);
  });

  test("JW Pepper is retired from the registry (not approved, no affiliate ID)", () => {
    expect(AFFILIATE_RETAILERS.jwpepper).toBeUndefined();
    expect(isApprovedPurchaseUrlKey("jwpepper")).toBe(false);
  });

  test("the default map never contains an unattributed jwpepper link", () => {
    const urls = generatePurchaseUrls(TITLE, COMPOSER);
    expect(Object.keys(urls)).not.toContain("jwpepper");
    expect(JSON.stringify(urls)).not.toContain("jwpepper.com");
  });

  test("an explicit request for an unapproved retailer is refused, not honoured", () => {
    // The emitted map is the user's money path: "not approved" must be
    // impossible, not merely unwired.
    const urls = generatePurchaseUrls(TITLE, COMPOSER, ["jwpepper"]);
    expect(urls).toEqual({});
    expect(JSON.stringify(urls)).not.toContain("jwpepper.com");

    // An approved retailer can still be requested alone.
    const musicnotesOnly = generatePurchaseUrls(TITLE, COMPOSER, [BACKUP_PURCHASE_URL_KEY]);
    expect(Object.keys(musicnotesOnly)).toEqual([BACKUP_PURCHASE_URL_KEY]);
  });

  test("the map is JSON-safe for the API response", () => {
    const urls = generatePurchaseUrls(TITLE, COMPOSER);
    expect(JSON.parse(JSON.stringify(urls))).toEqual(urls);
  });
});

describe("source scan — no CTA hard-wires a retailer key", () => {
  test("nothing outside the contract module dereferences a purchase-url map by retailer", () => {
    const files = walkSources(SRC_ROOT);
    // Floors: an empty/failed walk must never pass.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.content.includes("purchase_url"))).toBe(true);

    const offenders = scanSourcesForHardwiredRetailerKey(files, [CONTRACT_FILE, THIS_FILE]);
    expect(offenders.map((o) => `${o.path}:${o.line} ${o.text}`)).toEqual([]);
  });

  test("the demo CTA resolves through primaryPurchaseUrl", () => {
    const demo = readFileSync(join(SRC_ROOT, "components", "RecognitionDemo.tsx"), "utf8");
    expect(demo).toContain("primaryPurchaseUrl");
  });

  test("the scanner actually catches the regression (guard cannot silently no-op)", () => {
    const planted = [
      {
        path: "components/Planted.tsx",
        content: '        <a href={purchaseUrl.musicnotes}>Get the official sheet music</a>\n',
      },
      {
        path: "components/Planted2.tsx",
        content: 'const u = purchase_url["jwpepper"];\n',
      },
    ];
    const found = scanSourcesForHardwiredRetailerKey(planted, [CONTRACT_FILE]);
    expect(found.length).toBe(2);
    expect(found[0].key).toBe("musicnotes");
    expect(found[1].key).toBe("jwpepper");
  });

  test("the scanner does not flag the resolver's own map access", () => {
    const clean = [
      {
        path: "components/Clean.tsx",
        content: "const href = primaryPurchaseUrl(purchaseUrl);\n",
      },
      {
        path: "services/clean.ts",
        content: "const u = urls[key];\nconst v = APPROVED_PURCHASE_URL_KEYS[0];\n",
      },
    ];
    expect(scanSourcesForHardwiredRetailerKey(clean, [])).toEqual([]);
  });
});
