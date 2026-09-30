/**
 * searchExternalContract.ts — the source-scan contracts behind the search-box
 * external-results extension (owner direction 10-01).
 *
 * Why a source scan and not just a logic test: the logic half of this feature is
 * tiny and pure (`externalSearchSection()` builds two URLs and a visibility
 * flag), and a logic test can never see the failure that matters here — a screen
 * that computes the right section and then renders it in the WRONG PLACE (inside
 * the "we found something" branch, say) ships a dead end to the user with every
 * unit test green. That is the exact class of defect this team has shipped three
 * times (History's sheet-music card, the coach's melody card, the History search
 * box — see historyDeadEndContract.ts), and there is no emulator on this box, so
 * the guard is a text predicate over the app's own source, run by the tier1 gate.
 *
 * The four theses:
 *   1. the general search screen RENDERS the external section, and it renders it
 *      on a QUERY gate — never behind `status` (an internal-results state), so a
 *      zero-match query still resolves to the money path;
 *   2. the screen never hand-writes a retailer URL: both links come from
 *      `services/searchExternal.ts` (one builder, one attribution path);
 *   3. that builder keeps the LIVE shape of the ONE backend builder it mirrors —
 *      SMD `/en-US/Search.aspx?query=…&tid=67650&affiliateId=67650` (PR #118 /
 *      #122) and Musicnotes `/search?w=…` — and never the retired
 *      `/search/go?q=` route or the `w=NoteSnap` tag (fc19fe16);
 *   4. the section is tap-through only (no auto-redirect), and the zero-match
 *      state points at the retailers instead of stopping at "no match".
 *
 * Pure: no react / react-native / fs imports, so tsconfig.tier1.json compiles and
 * runs it under plain Node.
 */
import { maskComments } from './modalBackContract';

/** The pure decision the screen must render from. */
export const EXTERNAL_DECISION_CALL = 'externalSearchSection(';
/** The component that paints the section. */
export const EXTERNAL_SECTION_COMPONENT = '<SearchExternalSection';
/** The card that opens the PRIMARY licensed retailer (SMD, affiliate 67650). */
export const EXTERNAL_OPEN_CALL = 'onOpen(';
/** The one module allowed to spell a retailer URL for the search box. */
export const EXTERNAL_URL_BUILDER_PATH = 'src/services/searchExternal.ts';
/** The screen the owner's message is about. */
export const EXTERNAL_SEARCH_SCREEN_PATH = 'src/screens/FindPieceScreen.tsx';

/** Hosts the app is allowed to name in exactly one place (the URL builder). */
export const RETAILER_HOST_PATTERN =
  /(?:sheetmusicdirect\.com|musicnotes\.com|sheetmusicplus\.com|virtualsheetmusic\.com|jwpepper\.com)/i;
/** The retired Musicnotes sub-route — never emitted again (fc19fe16). */
export const RETIRED_MUSICNOTES_ROUTE = /\/search\/go\b/i;
/** The retired Musicnotes "referrer tag" that overwrote the search box. */
export const RETIRED_MUSICNOTES_TAG = /w=NoteSnap\b/i;
/** A SMD deep link that carries the affiliate id in both expected params. */
export const SMD_AFFILIATE_SHAPE =
  /\/en-US\/Search\.aspx\?query=[^"'\s]*&tid=67650&affiliateId=67650/;

/**
 * The source text of the JSX expression that WRAPS the first occurrence of `at`.
 *
 * The section's render site is `{external.visible ? (… <SearchExternalSection …)
 * …) : null}`, so the expression's own condition is the text between the opening
 * `{` and the tag. That is what decides whether a zero-match query renders the
 * money path — the exact thing a status-gated render gets wrong.
 */
export function enclosingJsxCondition(masked: string, at: number): string {
  if (at < 0) return '';
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) return masked.slice(i + 1, at);
      depth--;
    }
  }
  return '';
}

/**
 * Thesis 1: the search screen renders the external section from the PURE
 * decision, gated on the query's own visibility — not on internal results.
 *
 * All three must hold in FindPieceScreen:
 *   • the decision is built from the live query (`externalSearchSection(query…)`),
 *     so the section tracks what the user typed;
 *   • the component is rendered;
 *   • the expression that wraps the render mentions `visible` (the tested
 *     decision) and does NOT mention `status` — a `status === 'ready'` gate is
 *     precisely the regression that turns a zero-match query back into a dead end.
 */
export function searchScreenRendersExternalSection(source: string): boolean {
  const masked = maskComments(source);
  const renderAt = masked.indexOf(EXTERNAL_SECTION_COMPONENT);
  if (renderAt < 0) return false;
  if (!/externalSearchSection\(\s*query\b/.test(masked)) return false;
  const condition = enclosingJsxCondition(masked, renderAt);
  if (!/\bvisible\b/.test(condition)) return false;
  return !/\bstatus\b/.test(condition);
}

/**
 * Thesis 2: the screen never writes a retailer URL itself.
 *
 * One attribution path: both links come from `services/searchExternal.ts`, which
 * is where the affiliate id is appended. A floor-built URL on the screen would
 * lose `tid`/`affiliateId` (and was the shape of the original money-path bug).
 */
export function searchScreenUsesSharedUrlBuilder(source: string): boolean {
  const masked = maskComments(source);
  if (RETAILER_HOST_PATTERN.test(masked)) return false;
  if (/\btid\s*=|\baffiliateId\b/i.test(masked)) return false;
  if (RETIRED_MUSICNOTES_ROUTE.test(masked) || RETIRED_MUSICNOTES_TAG.test(masked)) {
    return false;
  }
  if (masked.indexOf(EXTERNAL_SECTION_COMPONENT) < 0) return false;
  return /from '\.\.\/services\/searchExternal'/.test(masked);
}

/**
 * Thesis 3: the one builder keeps the live retailer shapes it mirrors, and never
 * emits a retired one.
 *
 * The source of truth is the backend's `sheetMusicDirectSearchUrl()` (site repo,
 * `src/services/modern-retailer.ts`) because the app has never built a retailer
 * URL; the backend has no free-text search endpoint, so this module mirrors it.
 * The affiliate id appears in BOTH params SMD documents, the live path/parameter
 * are pinned, and the two retired Musicnotes forms are rejected.
 */
export function externalUrlBuilderKeepsLiveShapes(source: string): boolean {
  const masked = maskComments(source);
  // The file writes its route out as concatenated constants, so the shape is
  // pinned piecewise: every constant that makes the live URL up, then the
  // affiliate tail exactly as the backend builder appends it.
  const needs: RegExp[] = [
    /SMD_SEARCH_ORIGIN\s*=\s*'https:\/\/www\.sheetmusicdirect\.com'/,
    /SMD_SEARCH_PATH\s*=\s*'\/en-US\/Search\.aspx'/,
    /SMD_SEARCH_QUERY_PARAM\s*=\s*'query'/,
    /SMD_AFFILIATE_ID\s*=\s*'67650'/,
    /&tid=\$\{SMD_AFFILIATE_ID\}&affiliateId=\$\{SMD_AFFILIATE_ID\}/,
    /MUSICNOTES_SEARCH_PATH\s*=\s*'\/search'/,
    /MUSICNOTES_SEARCH_QUERY_PARAM\s*=\s*'w'/,
  ];
  if (needs.some((re) => !re.test(masked))) return false;
  if (RETIRED_MUSICNOTES_ROUTE.test(masked) || RETIRED_MUSICNOTES_TAG.test(masked)) {
    return false;
  }
  // The query must never be a catalogue/recording code path, and the two builders
  // must actually encode what they were handed.
  return /encodeURIComponent\(/.test(masked);
}

/**
 * Thesis 4a: the section is TAP-THROUGH only.
 *
 * Nothing in the section component may open a page on mount — no WebView tag of
 * its own (the shared `PurchaseWebView` shell owns the browser) and no effect that
 * fires `onOpen` — and every open must sit inside an `onPress` handler. The
 * owner's 08-24 rule: the retailer opens on an explicit tap, never a redirect.
 */
export function externalSectionOpensOnTapOnly(source: string): boolean {
  const masked = maskComments(source);
  // The needle is assembled so THIS file is not itself a WebView tag: the app's
  // flag-contract scanner reads every .ts/.tsx under src/ as raw text and would
  // demand the runtime flags from a file that only names the tag.
  if (masked.indexOf('<' + 'WebView') >= 0) return false;
  if (/useEffect\s*\(/.test(masked)) return false;
  // Both cards must open, and the PRIMARY card must open the section's own SMD
  // url — a card whose handler opens nothing is the dead card the owner keeps
  // finding.
  if (!/onPress=\{\(\)\s*=>\s*onOpen\(\s*smdUrl\s*\)\}/.test(masked)) return false;
  if (!/onPress=\{\(\)\s*=>\s*onOpen\(\s*section\.musicnotesUrl\s+as\s+string\s*\)\}/.test(masked)) {
    return false;
  }
  return masked.indexOf(EXTERNAL_OPEN_CALL) >= 0;
}

/**
 * Thesis 5: History keeps its own search (PR #141 scope).
 *
 * The owner's message was about the GENERAL search surfaces (the Discover/front
 * page box), and PR #141 deliberately narrowed History's box to the user's SAVED
 * recognitions. The external retailer section must not leak into that screen: a
 * History search answered with retailer results would be a different feature and
 * a different promise ("find the piece I just played").
 */
export function historyScreenHasNoExternalSection(source: string): boolean {
  const masked = maskComments(source);
  if (/searchExternal/.test(masked)) return false;
  if (masked.indexOf(EXTERNAL_SECTION_COMPONENT) >= 0) return false;
  return true;
}

/**
 * Thesis 4b: the zero-match state points at the retailers.
 *
 * "No pieces match — try another title or composer" alone is a wall for a song we
 * do not hold; the screen must add the honest hint that the retailers are right
 * below it, so the user is never left with nothing to tap.
 */
export function zeroMatchStatePointsAtRetailers(source: string): boolean {
  const masked = maskComments(source);
  if (!/NO_MATCH_MESSAGE/.test(masked)) return false;
  // The RENDER (`{EXTERNAL_NO_MATCH_HINT}`), not the import: a constant that is
  // imported but never placed in the tree is the same wall as before.
  return masked.indexOf('{EXTERNAL_NO_MATCH_HINT}') >= 0;
}

/** One-line hint printed with any failure of the predicates above. */
export const SEARCH_EXTERNAL_FIX_HINT =
  'the Find-a-Piece search box must resolve EVERY query: our own catalog first, then the licensed retailers ' +
  'for the queries we cannot answer (built through services/searchExternal.ts so the affiliate id is always attached), ' +
  'with the secondary Musicnotes CTA, tap-through only, and never gated on internal results.';
