/**
 * Purchase-URL map for a recognized (non-public-domain) song — the money path.
 *
 * `/api/recognize` returns this map as the match's `purchase_url`, and the site's
 * recognition demo renders "Get the official sheet music" from it.
 *
 * ---------------------------------------------------------------------------
 * LINK AUDIT 2026-09-22 — two defects fixed here
 * ---------------------------------------------------------------------------
 * 1. The map had NO Sheet Music Direct entry: it iterated `AFFILIATE_RETAILERS`,
 *    which only holds Musicnotes (backup, ~5%) and JW Pepper. So every web
 *    surface built from this map sent the user — and the commission — to the
 *    BACKUP retailer while Sheet Music Direct (owner-approved PRIMARY, affiliate
 *    ID 67650, 10%, live since 09-14) carried the money path everywhere else
 *    (525/525 piece pages + the modern-song route). The primary entry is now
 *    built through the ONE verified builder (`sheetMusicDirectSearchUrl`), so
 *    `tid` and `affiliateId` are always attached.
 * 2. The same iteration emitted **JW Pepper**, a retailer that is NOT approved
 *    and has no affiliate ID (its registry entry says "check availability"), even
 *    though the source comment claimed it "is not linked by default". JW Pepper
 *    is now retired from the registry AND can no longer be emitted even if a
 *    caller explicitly asks for it.
 *
 * Approved retailers (owner decisions 08-24 / 09-14): Sheet Music Direct
 * (primary) and Musicnotes (backup) — nothing else.
 *
 * The registry in `affiliates.ts` stays a REGISTRY (what a retailer's template
 * would look like); this module decides what may actually reach a user.
 */
import { AFFILIATE_RETAILERS, type AffiliateRetailer } from "./affiliates";
import { sheetMusicDirectSearchUrl } from "./modern-retailer";

/** Map key carrying the PRIMARY retailer link (Sheet Music Direct, ID 67650). */
export const PRIMARY_PURCHASE_URL_KEY = "sheetmusicdirect";

/** Map key carrying the owner-approved BACKUP retailer link (Musicnotes). */
export const BACKUP_PURCHASE_URL_KEY = "musicnotes";

/**
 * The ONLY retailers allowed to appear in an emitted purchase-URL map, in
 * priority order. A purchase CTA resolves to the FIRST key present, so the
 * primary can never be skipped for the backup.
 */
export const APPROVED_PURCHASE_URL_KEYS: readonly string[] = [
  PRIMARY_PURCHASE_URL_KEY,
  BACKUP_PURCHASE_URL_KEY,
];

/** True when `key` names an owner-approved retailer. */
export function isApprovedPurchaseUrlKey(key: string): boolean {
  return APPROVED_PURCHASE_URL_KEYS.includes(key);
}

/**
 * Build the purchase-URL map for a song. Default callers get exactly the
 * approved retailers: Sheet Music Direct first (primary, always affiliate
 * attributed), then Musicnotes as the backup entry.
 *
 * A key that is not approved is skipped even when explicitly requested — the
 * emitted map is the user's money path, so "not approved" has to be
 * impossible, not merely unwired.
 */
export function generatePurchaseUrls(
  title: string,
  composer: string,
  retailerKeys?: string[],
): Record<string, string> {
  const query = `${title} ${composer}`.trim();
  const requested = retailerKeys ?? APPROVED_PURCHASE_URL_KEYS;
  const urls: Record<string, string> = {};

  for (const key of requested) {
    if (!isApprovedPurchaseUrlKey(key)) continue;

    if (key === PRIMARY_PURCHASE_URL_KEY) {
      // Built ONLY through the contract-verified SMD builder (live route +
      // tid/affiliateId). Returns undefined for an empty query, in which case
      // the backup entry below is what a CTA falls back to.
      const smd = sheetMusicDirectSearchUrl(query);
      if (smd) urls[key] = smd;
      continue;
    }

    const retailer = AFFILIATE_RETAILERS[key];
    if (retailer) {
      urls[key] = retailer.urlTemplate.replace("{{query}}", encodeURIComponent(query));
    }
  }

  return urls;
}

/**
 * The link a purchase CTA must use: the first APPROVED entry present, i.e. the
 * primary retailer, falling back to the backup only when the primary is absent.
 *
 * Every CTA goes through this function rather than naming a retailer key
 * directly — that is the bug this module's source scan guards (the demo CTA was
 * hard-wired to the backup retailer while the primary existed).
 */
export function primaryPurchaseUrl(
  urls: Record<string, string> | null | undefined,
): string | undefined {
  if (!urls) return undefined;
  for (const key of APPROVED_PURCHASE_URL_KEYS) {
    const url = urls[key];
    if (url && url.trim() !== "") return url;
  }
  return undefined;
}

export function getRetailer(key: string): AffiliateRetailer | undefined {
  return AFFILIATE_RETAILERS[key];
}

// ---------------------------------------------------------------------------
// Source-contract scanner: no surface may hard-wire a purchase CTA to a named
// retailer key (`.musicnotes`, `.jwpepper`, …) instead of resolving through
// `primaryPurchaseUrl`. That is exactly how the demo CTA ended up on the backup
// retailer: the URL tests all passed, because the link was live — just the wrong
// (and less valuable) one.
// ---------------------------------------------------------------------------

/** A `purchase_url` map dereferenced by a literal retailer key. */
export const RETAILER_KEY_DEREF_PATTERN =
  /\bpurchase[_A-Za-z]*\s*(?:\.|\[\s*["'])(musicnotes|jwpepper|sheetmusicdirect|sheetmusicplus)\b/i;

export interface PurchaseCtaOffender {
  path: string;
  line: number;
  key: string;
  text: string;
}

/**
 * Pure source scanner (the team's source-contract pattern). `allow` takes
 * repo-relative paths — the contract module below and the test that plants a
 * pattern on purpose.
 */
export function scanSourcesForHardwiredRetailerKey(
  files: readonly { path: string; content: string }[],
  allow: readonly string[] = [],
): PurchaseCtaOffender[] {
  const allowed = new Set(allow);
  const offenders: PurchaseCtaOffender[] = [];
  for (const file of files) {
    if (allowed.has(file.path)) continue;
    file.content.split("\n").forEach((text, index) => {
      const m = text.match(RETAILER_KEY_DEREF_PATTERN);
      if (m) {
        offenders.push({
          path: file.path,
          line: index + 1,
          key: m[1].toLowerCase(),
          text: text.trim().slice(0, 160),
        });
      }
    });
  }
  return offenders;
}
