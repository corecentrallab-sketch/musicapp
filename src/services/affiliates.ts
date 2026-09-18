export interface AffiliateRetailer {
  name: string;
  urlTemplate: string;
  commission?: string;
  cookieWindow?: string;
  platform?: string;
}

/**
 * Backup retailer templates for copyrighted-song matches.
 *
 * Owner decision 08-24: Sheet Music Direct is the PRIMARY retailer (see
 * `modern-retailer.ts` / `piece-affiliate.ts` — every SMD link carries affiliate
 * ID 67650) and **Sheet Music Plus was dropped as primary** (its flow loops the
 * user on sign-in). The Sheet Music Plus entry was therefore retired in WAVE 1a
 * so it stops shipping; Musicnotes stays as the backup path, and JW Pepper's
 * template remains available but is not linked by default.
 */
export const AFFILIATE_RETAILERS: Record<string, AffiliateRetailer> = {
  musicnotes: {
    name: "Musicnotes",
    urlTemplate: "https://www.musicnotes.com/search/go?q={{query}}&w=NoteSnap",
    commission: "5%",
    cookieWindow: "1 day",
    platform: "Rakuten/LinkShare (MID 13770)",
  },
  jwpepper: {
    name: "JW Pepper",
    urlTemplate: "https://www.jwpepper.com/sheet-music/search.jsp?keywords={{query}}",
    platform: "ShareASale/Awin — check availability",
  },
};

