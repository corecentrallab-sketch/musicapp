/**
 * pdRouting.ts — the PD-library cross-check on the modern-song route.
 *
 * OWNER-REPRODUCED (09-25, RC v26 follow-up probe): the owner played Lang Lang's
 * recording of Für Elise, the hero button identified it CORRECTLY, and the card
 * came up as "Recognised — Fur Elise (Piano Version) — Beethoven — Modern Song"
 * with retailer CTAs. A category error in the most visible place in the app: a
 * 200-year-old public-domain work, whose FREE score this app already holds, was
 * presented as a modern copyrighted song to be bought.
 *
 * WHY it happened: the one-tap pipeline is honest about its PASSES but the
 * ROUTING was missing. Pass 1 (our landmark matcher) can only match OUR
 * fingerprinted audio, so a commercial recording — Lang Lang's Für Elise — never
 * reaches it; pass 2 (the licensed music-ID provider, AudD) then identifies the
 * RECORDING and the app rendered that identification as a modern song. For a
 * modern work that is exactly right. For a recording OF a public-domain work it
 * is wrong: the work in our library IS the thing the user wants, and its score is
 * free and in-app.
 *
 * WHAT THIS MODULE OWNS: the app half of the fix. The backend now cross-checks an
 * AudD match's title/composer against the PD catalog (site:
 * src/services/modern-pd-crosscheck.ts, "the pieces table by normalized title +
 * composer surname") and, when the mapping is CONFIDENT, returns the PD-library
 * card alongside the modern match (`pd_match`). This module decides what the app
 * does with that:
 *
 *   • a response carrying a confident PD mapping becomes a PD LIBRARY result —
 *     the free, in-app score card the rest of the app already renders for a
 *     library match (never the modern interstitial, never "Modern Song");
 *   • a response WITHOUT one stays exactly what it is today (an honest modern
 *     match) — the cross-check is never allowed to guess, and an ambiguous
 *     mapping is simply absent from the payload;
 *   • the retailer CTAs are SECONDARY on this path: our own score is the
 *     primary offer, which is why the PD card is built with `purchase_url: null`
 *     (the same rule /api/recognize applies to every public-domain piece) and
 *     the affiliate search link rides along as `affiliate_url` for a secondary
 *     "get a printed arrangement" surface.
 *
 * Pure by design (no react / react-native / fs / path) so the tier1 gate compiles
 * it with node_modules absent — this is the module the gate can test end to end
 * with a stubbed backend payload.
 */

/** The PD piece the backend matched, as it arrives on the wire. */
export interface PdMatchPayload {
  id?: unknown;
  title?: unknown;
  composer?: unknown;
  catalog?: unknown;
  genre?: unknown;
  difficulty_label?: unknown;
  sheet_music_available?: unknown;
  sheet_music_url?: unknown;
  album_art_url?: unknown;
  affiliate_url?: unknown;
  confidence?: unknown;
  match_confidence?: unknown;
  /** Explicit PD flag from the backend; `false` vetoes the route. */
  is_public_domain?: unknown;
}

/** A PD library card in the app's own (library-match) result shape. */
export interface PdLibraryMatch {
  id: string;
  title: string;
  composer: string;
  catalog?: string;
  genre?: string;
  difficulty_label?: string;
  /** A fact for a public-domain piece — the card may offer the free score. */
  is_public_domain: true;
  sheet_music_available: boolean;
  sheet_music_url?: string;
  album_art_url?: string;
  /**
   * SECONDARY retailer CTA (Sheet Music Direct search for this work). The free
   * in-app score is the primary path, so this is never a purchase_url.
   */
  affiliate_url?: string;
  /**
   * Always null: we serve this score ourselves, so the card must never redirect
   * the user to a retailer as its primary action (the same rule the library
   * recognition route applies to every public-domain piece).
   */
  purchase_url: null;
  confidence: number;
}

/** The PD-library result response the existing result card renders. */
export interface PdLibraryResultResponse {
  success: true;
  matches: PdLibraryMatch[];
  /**
   * Where the mapping came from, for telemetry/debugging — never shown to a user.
   */
  pd_routed_from: 'modern-pd-crosscheck';
}

/** Anything with a `pd_match` block (the modern route's response). */
interface PdCarrier {
  pd_match?: unknown;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The PD mapping carried by a modern-recognition response, or null.
 *
 * Deliberately strict — every one of these must hold, because routing a modern
 * match to the PD card is a claim that WE hold this work:
 *   • `pd_match` is an object with a non-empty title (the backend omits the key
 *     entirely when its cross-check was ambiguous — the honest-no-match rule);
 *   • the mapping is marked public domain (never infer it from the title alone);
 *   • no explicit `is_public_domain: false` (a future backend flag must be able
 *     to veto the route).
 */
export function pdMatchFromModernResponse(
  resp: PdCarrier | null | undefined,
): PdLibraryMatch | null {
  const raw = resp?.pd_match;
  if (!raw || typeof raw !== 'object') return null;
  const pd = raw as PdMatchPayload;
  if (pd.is_public_domain === false) return null;
  const title = nonEmptyString(pd.title);
  if (!title) return null;

  const available = pd.sheet_music_available === true;
  const sheetUrl = nonEmptyString(pd.sheet_music_url);
  const confidenceRaw = pd.match_confidence ?? pd.confidence;
  return {
    id: nonEmptyString(pd.id) ?? title,
    title,
    composer: nonEmptyString(pd.composer) ?? 'Unknown',
    catalog: nonEmptyString(pd.catalog),
    // The catalog's own genre when it has one; the result card's genre helper
    // resolves "Public domain" for a library piece with no genre — never an
    // invented one, and never "Modern song" for a public-domain work.
    genre: nonEmptyString(pd.genre),
    difficulty_label: nonEmptyString(pd.difficulty_label),
    is_public_domain: true,
    sheet_music_available: available && !!sheetUrl,
    sheet_music_url: sheetUrl,
    album_art_url: nonEmptyString(pd.album_art_url),
    affiliate_url: nonEmptyString(pd.affiliate_url),
    purchase_url: null,
    confidence: typeof confidenceRaw === 'number' ? confidenceRaw : 1,
  };
}

/**
 * True when a modern route response carries a confident PD mapping — the one
 * decision the screens branch on.
 */
export function routesToPdLibrary(resp: PdCarrier | null | undefined): boolean {
  return pdMatchFromModernResponse(resp) !== null;
}

/**
 * The PD-library result response for a matched work, in the EXACT shape the
 * recognition result card already renders for a library match
 * (`{ success, matches: [piece] }`), so the PD path reuses the existing card
 * instead of growing a second one.
 */
export function pdLibraryResultResponse(pd: PdLibraryMatch): PdLibraryResultResponse {
  return {
    success: true,
    matches: [pd],
    pd_routed_from: 'modern-pd-crosscheck',
  };
}

// ─── source contract (live scan, the team's source-scanner recipe) ──────────

/** The marker that reads the PD mapping off the modern route's response. */
export const PD_ROUTE_READER = 'pdMatchFromModernResponse(';
/** The marker that puts the PD work on the library result card. */
export const PD_ROUTE_CARD = 'pdLibraryResultResponse(';

/**
 * True when a pipeline checks the modern route's response for a PD mapping and,
 * when there is one, renders the PD library card for it. Both halves matter: a
 * screen that reads the mapping and never shows the card is as broken as one that
 * never reads it, and the modern interstitial must NOT be opened for that pass.
 */
export function pdRouteWired(source: string): boolean {
  const read = source.indexOf(PD_ROUTE_READER);
  if (read < 0) return false;
  const card = source.indexOf(PD_ROUTE_CARD);
  if (card < 0) return false;
  // The card must be built from the mapping that was read (same pipeline).
  const body = source.slice(read, card);
  return /\bpd\b/.test(body) && !body.includes('setShowModernInterstitial(true)');
}

/**
 * True when the screen routes the PD mapping BEFORE it can open the modern
 * interstitial — the category error the owner saw (a PD work on the modern
 * card) is exactly the ordering bug, so the order is the contract.
 */
export function pdRoutePrecedesModernInterstitial(source: string): boolean {
  const read = source.indexOf(PD_ROUTE_READER);
  if (read < 0) return false;
  const interstitial = source.indexOf('setShowModernInterstitial(true)');
  return interstitial < 0 || read < interstitial;
}
