import { musicnotesSearchUrlTemplate } from "./modern-retailer";

export interface AffiliateRetailer {
  name: string;
  urlTemplate: string;
  commission?: string;
  cookieWindow?: string;
  platform?: string;
}

/**
 * Retailer registry for copyrighted-song matches.
 *
 * Owner decision 08-24: Sheet Music Direct is the PRIMARY retailer (see
 * `modern-retailer.ts` / `piece-affiliate.ts` / `generate-purchase-urls.ts` —
 * every SMD link carries affiliate ID 67650) and **Sheet Music Plus was dropped
 * as primary** (its flow loops the user on sign-in). That entry was retired in
 * WAVE 1a so it stops shipping; Musicnotes stays as the backup path.
 *
 * LINK AUDIT 2026-09-22: the JW Pepper entry was retired too. It had NO affiliate
 * ID (`platform: "check availability"`) and is not an approved retailer, yet
 * `generatePurchaseUrls` iterated every key of this registry and therefore
 * emitted an unattributed jwpepper.com link on every copyrighted-song match —
 * the opposite of what the old "not linked by default" comment claimed. Approved
 * retailers are Sheet Music Direct (primary) and Musicnotes (backup); nothing
 * here is linked unless `generate-purchase-urls.ts` names it as approved.
 *
 * LINK AUDIT 2026-09-25: the Musicnotes template is no longer written out here.
 * It used to be a SECOND hand-written Musicnotes search URL ending in the tag
 * `w=NoteSnap`
 * — a "referrer tag" with no commission attached, which Musicnotes' search page
 * reads AS THE QUERY (on the owner's phone the box showed "NoteSnap" and the
 * engine searched the literal word, returning one unrelated result; owner 09-25,
 * RC v26 Test 4a finding #3). It now comes from the ONE builder in
 * `modern-retailer.ts` so the two copies can never drift again, and a source scan
 * (`scanSourcesForNoteSnapReferrerTag`) fails the gate on either the `w=NoteSnap`
 * tag or a fresh hand-written Musicnotes URL.
 */
export const AFFILIATE_RETAILERS: Record<string, AffiliateRetailer> = {
  musicnotes: {
    name: "Musicnotes",
    urlTemplate: musicnotesSearchUrlTemplate(),
    commission: "5%",
    cookieWindow: "1 day",
    platform: "Rakuten/LinkShare (MID 13770)",
  },
};
