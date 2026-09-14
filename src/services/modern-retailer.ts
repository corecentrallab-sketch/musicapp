// ---------------------------------------------------------------------------
// Modern-song -> affiliate retailer URL mapping (Backlog #12).
//
// Primary retailer = Sheet Music Direct (owner decision 08-24).
// Prefer ISRC-based deep link (most precise) when we have one; else fall back
// to title+artist search. Musicnotes stays as a backup path (existing template).
//
// AFFILIATE ACCOUNT (owner relayed 09-14): Sheet Music Direct approved
// Affiliate ID 67650 — MUST be embedded in every SMD link so each click is
// commission-attributable.
//
// Attribution params: `tid` is the Hal Leonard affiliate click-id param
// (Sheet Music Direct is a Hal Leonard platform and this was the format this
// builder originally used); `affiliateId` is SMD's own documented affiliate
// link param. Both carry the same ID so attribution holds regardless of which
// the programme reads. If the owner's SMD dashboard shows a different param
// name, drop the redundant one here (one line + test update).
// ---------------------------------------------------------------------------

const SMD_AFFILIATE_ID = "67650";

/**
 * SMD deep link. `searchText` supports title/artist/ISRC/catalog numbers on the
 * sheetmusicdirect search endpoint. The affiliate params (`tid` / `affiliateId`)
 * are appended so attribution survives the in-app WebView session.
 */
function smdUrl(query: string): string {
  const q = encodeURIComponent(query);
  return (
    `https://www.sheetmusicdirect.com/en-US/search?searchText=${q}` +
    `&tid=${SMD_AFFILIATE_ID}&affiliateId=${SMD_AFFILIATE_ID}`
  );
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