export interface AffiliateRetailer {
  name: string;
  urlTemplate: string;
  commission?: string;
  cookieWindow?: string;
  platform?: string;
}

export const AFFILIATE_RETAILERS: Record<string, AffiliateRetailer> = {
  musicnotes: {
    name: "Musicnotes",
    urlTemplate: "https://www.musicnotes.com/search/go?q={{query}}&w=NoteSnap",
    commission: "5%",
    cookieWindow: "1 day",
    platform: "Rakuten/LinkShare (MID 13770)",
  },
  sheetmusicplus: {
    name: "Sheet Music Plus",
    urlTemplate: "https://www.sheetmusicplus.com/search?q={{query}}&aff_id=notesnap",
    commission: "8-15%",
    cookieWindow: "30 days",
    platform: "ShareASale/Awin — not on Rakuten",
  },
  jwpepper: {
    name: "JW Pepper",
    urlTemplate: "https://www.jwpepper.com/sheet-music/search.jsp?keywords={{query}}",
    platform: "ShareASale/Awin — check availability",
  },
};
