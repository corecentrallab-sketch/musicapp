// ---------------------------------------------------------------------------
// Modern-song -> affiliate retailer URL mapping (Backlog #12, prep skeleton).
//
// Primary retailer = Sheet Music Direct (owner decision 08-24, app in progress).
// Prefer ISRC-based deep link (most precise) when we have one; else fall back
// to title+artist search. Musicnotes stays as a backup path (existing template).
//
// The Sheet Music Direct search-param names / ISRC-query support are
// TBD-to-verify at SMD affiliate sign-in — update SMD_URL once approved.
// ---------------------------------------------------------------------------

const SMD_AFFILIATE_ID = process.env.SHEETMUSICDIRECT_AFFILIATE_ID || "";

/**
 * SMD deep link. `searchText` supports title/artist/ISRC/catalog numbers on the
 * sheetmusicdirect search endpoint (param name TBD-to-verify at sign-in).
 * The affiliate click-id param (`tid` on many Hal Leonard links) is appended so
 * attribution survives the in-app WebView session.
 */
function smdUrl(query: string): string {
  const q = encodeURIComponent(query);
  const tid = SMD_AFFILIATE_ID ? `&tid=${encodeURIComponent(SMD_AFFILIATE_ID)}` : "";
  return `https://www.sheetmusicdirect.com/en-US/search?searchText=${q}${tid}`;
}

export function modernRetailerUrls(
  title: string,
  artist: string,
  isrc?: string,
): { primary?: string; musicnotes?: string } {
  if (!title || !artist) return {};
  const byIsrc = isrc ? smdUrl(isrc) : undefined;
  const byQuery = smdUrl(`${title} ${artist}`.trim());
  const q = encodeURIComponent(`${title} ${artist}`.trim());
  return {
    primary: byIsrc || byQuery,
    musicnotes: `https://www.musicnotes.com/search/go?q=${q}&w=NoteSnap`,
  };
}
