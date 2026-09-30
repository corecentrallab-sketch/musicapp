/**
 * historyDeadEndContract.ts — the source-scan contracts behind the History
 * dead-end sprint (owner 10-01, five messages, one coherent fix).
 *
 * Why this module exists: the owner reported that every road out of a saved
 * recognition ended nowhere — the sheet-music card on a modern song said
 * "coming soon" instead of opening the purchase page, the reference-melody card
 * said "coming soon" with no way to hear the melody, and the History search box
 * searched the whole catalog instead of the user's own saved recognitions. Two of
 * those three are WIRING defects (a value dropped at save time, an action never
 * attached), and a wiring defect cannot be caught by a logic test: the pure
 * functions were correct, the screens simply never called them. There is no
 * emulator on this box, so the guards are text predicates over the app's own
 * source — the same pattern as midiExportContract.ts / frontDoor.ts.
 *
 * The four theses these guards exist for:
 *   1. a modern recognition SAVES the retailer links it arrived with, so the row
 *      can still buy the sheet music it offered (dropped at save time = the
 *      owner's dead end);
 *   2. a public-domain / hum / find-a-piece save NEVER carries a purchase map —
 *      we do not invent a licensed link for a score we host;
 *   3. the piece page renders the purchase card when the piece carries links,
 *      opens it with the required WebView flags, and the coach card turns its
 *      dead "reference melody coming soon" text into that same live action;
 *   4. History's search box filters the SAVED recognitions in memory — it is
 *      never the global catalog search (no FindPieceScreen, no catalog query).
 *
 * Pure: no react / react-native / expo imports, so the tier1 gate compiles and
 * runs it under plain Node (tsconfig.tier1.json).
 */
import { maskComments } from './modalBackContract';

/** The persistence call every save site goes through. */
export const SAVE_RECOGNITION_CALL = 'saveRecognition(';
/** The genre identifier used ONLY on a modern-song save. */
export const MODERN_GENRE_IDENTIFIER = 'modernGenreLabel(';
/** The genre identifier used on a public-domain / hum save. */
export const PUBLIC_DOMAIN_GENRE_IDENTIFIER = 'PUBLIC_DOMAIN_GENRE';
/** The field the save must carry for a modern song. */
export const PURCHASE_URLS_FIELD = 'purchaseUrls';
/** The pure card builder the piece page must use. */
export const SHEET_CARD_CALL = 'modernSheetCard(piece)';
/** The primary-retailer resolution the piece page must go through. */
export const PRIMARY_PURCHASE_CALL = 'primaryPurchaseUrl(piece.purchaseUrls)';
/** The pure reference-melody decision the coach card must mirror. */
export const COACH_MELODY_CALL = 'coachMelodyCard(';
/** The pure History filter. */
export const HISTORY_FILTER_CALL = 'filterSavedPieces(';

/** Source from the `{` at `open` to its matching `}` (or '' if unbalanced). */
function objectBlock(masked: string, open: number): string {
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return masked.slice(open, i + 1);
    }
  }
  return '';
}

/**
 * Every `saveRecognition({ … })` argument object in one file, as source text.
 * Comments are masked first (a documented example in a comment must never
 * satisfy a guard), and each call's first `{` after the call name opens the
 * literal — which is how every save site in the app is written.
 */
export function saveRecognitionCalls(source: string): string[] {
  const masked = maskComments(source);
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const at = masked.indexOf(SAVE_RECOGNITION_CALL, from);
    if (at < 0) break;
    const open = masked.indexOf('{', at);
    const block = objectBlock(masked, open);
    if (block) calls.push(block);
    from = at + SAVE_RECOGNITION_CALL.length;
  }
  return calls;
}

/**
 * Thesis 1: EVERY modern-song save carries `purchaseUrls`.
 *
 * A save site counts as modern when its literal names the modern genre
 * identifier — the one field that can only describe a modern match. If such a
 * save drops the map, the row loses the only link it will ever have (the ISRC is
 * not a catalog id, so nothing can be looked up later) and the piece page falls
 * back to a dead "sheet music coming soon". False when the file has no modern
 * save at all, so a screen that stopped saving modern songs entirely fails too.
 */
export function modernSaveCarriesPurchaseUrls(source: string): boolean {
  const calls = saveRecognitionCalls(source);
  const modern = calls.filter((call) => call.includes(MODERN_GENRE_IDENTIFIER));
  if (modern.length === 0) return false;
  return modern.every(
    (call) => call.indexOf(PURCHASE_URLS_FIELD) >= 0 && call.includes('modernPurchaseUrls('),
  );
}

/**
 * Thesis 2: a public-domain save never carries a purchase map.
 *
 * A PD recognition's score is one we host, so a licensed link would be a
 * fabricated second offer for a work that is already free — and for a hum match
 * the user never saw a retailer at all. The map is the modern path's alone.
 */
export function publicDomainSaveOmitsPurchaseUrls(source: string): boolean {
  const pd = saveRecognitionCalls(source).filter((call) =>
    call.includes(PUBLIC_DOMAIN_GENRE_IDENTIFIER),
  );
  return pd.every((call) => call.indexOf(PURCHASE_URLS_FIELD) < 0);
}

/**
 * Thesis 3a: the piece page renders the sheet-music card for a piece whose links
 * it holds, and that card's press opens the page.
 *
 * Three things must all be true in PieceDetailScreen:
 *   • the card model comes from the pure builder (`modernSheetCard(piece)`), so
 *     the header text and the URL choice are the tested ones;
 *   • the piece's links resolve through `primaryPurchaseUrl(piece.purchaseUrls)`
 *     — the money-path resolver, never a retailer key named inline;
 *   • the card is a pressable surface (its own `onPress`) that hands the card's
 *     URL to the shell opener — an unpressed card is the owner's dead end again.
 */
export function pieceDetailOpensPurchaseCard(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(SHEET_CARD_CALL) < 0) return false;
  if (masked.indexOf(PRIMARY_PURCHASE_CALL) < 0) return false;
  // The card is the ELSE arm of the sheet-music decision (`piece.sheetMusicUrl ?
  // … : sheetCard ? …`): a curated score we host always wins, and the card can
  // never replace the page body.
  if (!/:\s*sheetCard\s*\?/.test(masked)) return false;
  // The press must pass the CARD's own url to the opener: `onPress={() =>
  // openInAppPurchase(sheetCardUrl)}` (the url variable is derived from the
  // card, which is why the card's url name is what is matched).
  return /onPress=\{\(\)\s*=>\s*[A-Za-z]*[Oo]pen[A-Za-z]*\(\s*[A-Za-z]*sheetCard[A-Za-z]*\s*\)\}/.test(
    masked,
  );
}

/**
 * Thesis 3b: the coach card turns "no reference melody" into the LIVE retailer
 * action when the piece carries a licensed link.
 *
 * The card must route through the pure decision (`coachMelodyCard(`) and render a
 * branch for the `'retailer'` kind whose action calls the shared opener with the
 * piece's own purchase URL. The 'coming-soon' branch stays for the piece we have
 * neither a melody nor a link for.
 */
export function coachCardRoutesToRetailerWhenNoMelody(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(COACH_MELODY_CALL) < 0) return false;
  const branch = retailerBranch(masked);
  if (!branch) return false;
  return (
    branch.includes('onOpenPurchase') &&
    branch.includes('purchaseUrl') &&
    /onPress=\{/.test(branch)
  );
}

/** The JSX of the coach card's `melody.kind === 'retailer' ? ( … )` branch. */
function retailerBranch(masked: string): string {
  // The JSX branch, not the sub-line ternary that names the same kind higher up
  // the file: the rendered action is the `? (` form.
  const marker = "melody.kind === 'retailer' ? (";
  const markerAt = masked.indexOf(marker);
  if (markerAt < 0) return '';
  const open = markerAt + marker.length - 1;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return masked.slice(open, i + 1);
    }
  }
  return '';
}

/**
 * Thesis 4: History's search box searches the SAVED recognitions, in memory.
 *
 * The box must (a) drive the query state, (b) narrow the list through the pure
 * filter over the saved `items`, and (c) render the narrowed list. It must NOT
 * reach the global catalog: no `FindPieceScreen` (the search that finds pieces the
 * user never recognized) and no catalog search call. The row-level
 * `fetchPieceById` lookup stays — that is the catalog FILL for a row the user
 * already saved, not a search.
 */
export function historySearchIsLocal(source: string): boolean {
  const masked = maskComments(source);
  if (!/filterSavedPieces\(\s*items\b/.test(masked)) return false;
  if (!/onChangeText=\{\s*set[A-Za-z]*Query\s*\}/.test(masked)) return false;
  if (!/data=\{\s*[A-Za-z]*[Ff]iltered[A-Za-z]*\s*\}/.test(masked)) return false;
  if (/\bFindPieceScreen\b/.test(masked)) return false;
  if (/\bcatalogSearch\b|\bsearchPieces\b/.test(masked)) return false;
  return true;
}

/** One-line report wording per guard, ready to print in a failure. */
export const HISTORY_DEAD_END_FIX_HINT =
  'a History surface must resolve to something real: the saved row keeps its retailer links, the item is pressable and opens them, ' +
  'and the search box filters the SAVED recognitions instead of the global catalog.';
