/**
 * Piece-page affiliate links (SITE WAVE 1a, owner direction 09-18: the site must
 * make consistent money — practice engagement -> affiliate purchases).
 *
 * Every catalog piece page carries a "Get the official sheet music" CTA, and the
 * catalog API exposes the same URL as `affiliate_url` so the app and the site
 * share ONE attribution path. Both build the link here, on top of the verified
 * Sheet Music Direct builder in `modern-retailer.ts` (affiliate ID 67650).
 *
 * Sheet Music Direct is primary (owner decision, approved 09-14). Musicnotes is
 * the backup: it is only used when the SMD builder cannot produce a URL at all,
 * which today means "there is nothing to search for".
 *
 * The search query for a catalog piece is `"<title> <composer>"` (recommended
 * wiring for classical pieces — a title alone is often ambiguous, and SMD's
 * search endpoint takes free text).
 *
 * The module is pure: no environment, no network, no database. That keeps it
 * usable from the API handler (server) and from a route loader (SSR) alike, and
 * keeps the affiliate URL testable without a live request.
 */
import {
  musicnotesSearchUrl,
  sheetMusicDirectSearchUrl,
} from "./modern-retailer";

/** Retailer labels shown next to the CTA — never invented, always the real one. */
export const SMD_RETAILER_NAME = "Sheet Music Direct";
export const MUSICNOTES_RETAILER_NAME = "Musicnotes";

export interface PieceAffiliateLink {
  /** The exact search text a musician would type on the retailer's site. */
  query: string;
  url: string;
  /** Retailer the URL points at (the label we show the user). */
  retailer: string;
  /** True when the primary (Sheet Music Direct) builder failed and we fell back. */
  usedFallback: boolean;
}

/**
 * Builders, injected so the fallback branch is testable. Production callers use
 * the defaults; the defaults are the single shared builders from
 * `modern-retailer.ts`, so no surface can drift to an attribute-less URL.
 */
export interface PieceAffiliateBuilders {
  sheetMusicDirect: (query: string) => string | undefined;
  musicnotes: (query: string) => string | undefined;
}

const DEFAULT_BUILDERS: PieceAffiliateBuilders = {
  sheetMusicDirect: sheetMusicDirectSearchUrl,
  musicnotes: musicnotesSearchUrl,
};

/**
 * Search text for a catalog piece: title plus composer, whitespace-collapsed,
 * skipping whichever part is missing. Returns "" when there is nothing to
 * search for — the caller then renders no CTA rather than a dead link.
 */
export function pieceAffiliateQuery(title: string, composer: string): string {
  return [title, composer]
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part !== "")
    .join(" ");
}

/**
 * The piece's affiliate link, or null when no sensible query can be built.
 *
 * A catalog piece always has a title; a composer-only search would be a
 * meaningless (and noisy) query, so a piece without a title renders no CTA at
 * all rather than a dead link.
 *
 * Sheet Music Direct first (primary, affiliate ID 67650); Musicnotes only if the
 * SMD builder returns nothing. Never returns a URL without an affiliate ID.
 */
export function pieceAffiliateLink(
  title: string,
  composer: string,
  builders: PieceAffiliateBuilders = DEFAULT_BUILDERS,
): PieceAffiliateLink | null {
  if (title.replace(/\s+/g, " ").trim() === "") return null;

  const query = pieceAffiliateQuery(title, composer);
  if (query === "") return null;

  const smd = builders.sheetMusicDirect(query);
  if (smd) {
    return {
      query,
      url: smd,
      retailer: SMD_RETAILER_NAME,
      usedFallback: false,
    };
  }

  const musicnotes = builders.musicnotes(query);
  if (musicnotes) {
    return {
      query,
      url: musicnotes,
      retailer: MUSICNOTES_RETAILER_NAME,
      usedFallback: true,
    };
  }

  return null;
}

/** Convenience for API/catalog serialization: the URL only, or null. */
export function pieceAffiliateUrl(
  title: string,
  composer: string,
  builders?: PieceAffiliateBuilders,
): string | null {
  return pieceAffiliateLink(title, composer, builders)?.url ?? null;
}
