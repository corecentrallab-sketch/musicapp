/**
 * searchNoMatch.ts — THE ZERO-MATCH STATE IS A MONEY PATH, NOT A WALL (v49).
 *
 * The owner's 11-03 report: a famous modern title typed into "Find a Piece"
 * ("heroes by David Bowie") produced a screen that read as dead. The search DID
 * run — the catalog answered, honestly, with nothing — but the state it landed on
 * said only "No match / try another title or composer". For a song our free
 * public-domain library will never hold, that is the wrong answer to give: the
 * licensed edition exists, the retailers are one tap away, and the user is left
 * thinking the app is broken.
 *
 * Plan rule (09-28, governing): "any search in NoteSnap should not be a dead end
 * — it should lead to a money path", and "every unscored row resolves honestly to
 * a licensed-retailer search". So the zero-match state must say three things, in
 * this order, and it must never say them conditionally on our own results:
 *
 *   1. THE SEARCH RAN. The user's own words are quoted back, so the state can
 *      never be mistaken for a frozen or unresponsive screen (the exact reading
 *      the owner had of the shipped build).
 *   2. WHY THERE IS NOTHING HERE. This is the free public-domain and classical
 *      library. Not holding a piece is a fact about our catalogue, not an error.
 *   3. WHERE THE PIECE ACTUALLY IS. The licensed retailers, deep-linked with the
 *      user's OWN words, in a CTA that is prominent rather than buried.
 *
 * Everything here is pure data and copy: the URL is never built in this module —
 * it is handed in by `services/searchExternal.ts` (`externalSearchSection()`),
 * which is the ONE place an affiliate link is spelled. If that decision says the
 * section is not visible (an empty query), this state offers no retailer at all
 * rather than inventing a search for words nobody typed.
 *
 * Pure: no react / react-native / expo imports, so tsconfig.tier1.json compiles
 * and runs it under plain Node.
 */
import {
  normalizeSearchQuery,
  type ExternalSearchSection,
} from './searchExternal';

/**
 * How much of a long query the headline quotes back. A pasted 120-character
 * phrase must not turn the state's title into four lines of noise — but the words
 * shown are always the user's own, truncated with an ellipsis, never rewritten.
 */
export const NO_MATCH_QUOTE_MAX_CHARS = 48;

/** The headline when the library itself answered with nothing (no query at all). */
export const NO_MATCH_EMPTY_LIBRARY_HEADLINE = 'The free library has nothing to show';

/** The label prefix of the prominent licensed-edition CTA. */
export const NO_MATCH_RETAILER_CTA_PREFIX = 'Get the official sheet music for';

/** Everything the zero-match state renders. */
export interface NoMatchState {
  /** (1) Proof the search ran: the user's own words, quoted. */
  headline: string;
  /** (1, said out loud) What was searched, so a zero result is never a freeze. */
  searchedLine: string;
  /** (2) Why there is nothing free to open here. */
  honestyLine: string;
  /** (3) The prominent money path, carrying the user's own words. */
  retailerCtaLabel: string;
  /** The licensed retailer search URL, from the shared builder — or undefined. */
  retailerUrl?: string;
  /** TRUE only when a real URL exists for a real, non-empty query. */
  showRetailer: boolean;
}

/**
 * The user's words, quoted for display, shortened with an ellipsis past
 * `NO_MATCH_QUOTE_MAX_CHARS`. Never rewritten, never re-ordered: the point of the
 * quote is that the user recognises what they typed.
 */
export function quotedQuery(raw: unknown): string {
  const query = normalizeSearchQuery(raw);
  if (query === '') return '';
  const shown =
    query.length > NO_MATCH_QUOTE_MAX_CHARS
      ? `${query.slice(0, NO_MATCH_QUOTE_MAX_CHARS - 1).trimEnd()}…`
      : query;
  return `“${shown}”`;
}

/**
 * THE zero-match decision. Total over its inputs: an empty query, a query with no
 * external section, and a query with a live retailer link all produce a state
 * that renders — and only the last one offers a retailer.
 */
export function noMatchState(
  rawQuery: unknown,
  external: ExternalSearchSection | null | undefined,
): NoMatchState {
  const query = normalizeSearchQuery(rawQuery);
  const quoted = quotedQuery(query);
  const retailerUrl =
    external && external.visible && external.smdUrl ? external.smdUrl : undefined;
  const showRetailer = quoted !== '' && !!retailerUrl;

  if (quoted === '') {
    // The catalogue answered with nothing and there are no words to search: the
    // honest state says only that, and offers no retailer (there is nothing to
    // search a retailer for).
    return {
      headline: NO_MATCH_EMPTY_LIBRARY_HEADLINE,
      searchedLine: 'The free library returned no pieces just now.',
      honestyLine: 'Nothing was typed, so nothing was searched.',
      retailerCtaLabel: '',
      retailerUrl: undefined,
      showRetailer: false,
    };
  }

  return {
    headline: `No match for ${quoted}`,
    searchedLine:
      'The search ran — nothing in our free public-domain and classical library matches those words.',
    /*
     * v51 (owner item 12): SHORTENED. This line used to be three sentences about
     * public-domain licensing, and it sat BETWEEN the no-match message and the
     * retailer button — so on a phone the money path was below the fold and behind
     * an essay ("then a long public-domain explanation, and the red retailer button
     * is below the fold"). The button now renders ABOVE this line, and the line
     * says only what the user needs: no free score here, the published edition is
     * the way to play it. The v49 assertion `/not in the free library/i` still
     * matches, and the fuller explanation of what the free library is lives in the
     * retailer section below, where it is not in the way.
     */
    honestyLine:
      'This piece is not in the free library, so the official published edition is the way to play it.',
    retailerCtaLabel: `${NO_MATCH_RETAILER_CTA_PREFIX} ${quoted}`,
    retailerUrl,
    showRetailer,
  };
}
