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
 *   3. the piece page renders the purchase card when the piece carries links and
 *      opens it with the required WebView flags, and that card is the page's ONE
 *      purchase action: the coach card holds no buy action at all (v31, owner
 *      10-01 "duplicate CTA box") and never promises a melody it cannot produce;
 *   4. History's search box filters the SAVED recognitions in memory — it is
 *      never the global catalog search (no FindPieceScreen, no catalog query).
 *
 * Pure: no react / react-native / expo imports, so the tier1 gate compiles and
 * runs it under plain Node (tsconfig.tier1.json).
 */
import { maskComments } from './modalBackContract';
// The apostrophe-safe masker (`maskComments` is prose-apostrophe-naive: one
// "page's own" in a comment opens a fake string and un-masks everything after it,
// which is how a guard ends up failing on its own documentation). The bundle-C row
// predicate scans for an exact call shape, so it uses the strict one.
import { maskCommentsForCodeScan } from './purchaseCta';

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
/** The ONE shared in-app retailer opener a piece page may hold (v31). */
export const PURCHASE_SHELL_OPENER = 'openInAppPurchase(';
/** The shared honest notice constant the modern-song state renders (v31). */
export const COACH_NOTICE_CONSTANT = 'COACH_NO_MELODY_NOTICE';
/** The pure History filter. */
export const HISTORY_FILTER_CALL = 'filterSavedPieces(';
/**
 * The money-path resolution a saved History row's action must go through: the
 * row's OWN saved purchase map, primary retailer first (bundle C, owner 10-02).
 * Nothing else can produce the row's URL — no hand-built link, no retailer key.
 */
export const HISTORY_ROW_PURCHASE_RESOLUTION = 'primaryPurchaseUrl(item.purchaseUrls)';
/** The row action's copy (the owner's wording: 2 taps to the sheet music). */
export const HISTORY_ROW_PURCHASE_LABEL = '🛒 Get sheet music';
/** The ONE shared in-app retailer shell a History row opens. */
export const HISTORY_PURCHASE_SHELL = 'PurchaseWebView';
/** The row action's own press, which hands its URL to the shell's state. */
export const HISTORY_ROW_PURCHASE_PRESS = 'setPurchaseWebUrl(';

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
 * it holds, and that card's press opens the page — and it is the page's ONLY
 * purchase action (v31, owner 10-01: "duplicate CTA box").
 *
 * Four things must all be true in PieceDetailScreen:
 *   • the card model comes from the pure builder (`modernSheetCard(piece)`), so
 *     the header text and the URL choice are the tested ones;
 *   • the piece's links resolve through `primaryPurchaseUrl(piece.purchaseUrls)`
 *     — the money-path resolver, never a retailer key named inline;
 *   • the card is a pressable surface (its own `onPress`) that hands the card's
 *     URL to the shell opener — an unpressed card is the owner's dead end again;
 *   • no SECOND purchase action is wired: the page must not hand the coach card
 *     an opener (`onOpenPurchase`), because a page with two retailer taps is the
 *     defect the owner reported.
 */
export function pieceDetailOpensPurchaseCard(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(SHEET_CARD_CALL) < 0) return false;
  if (masked.indexOf(PRIMARY_PURCHASE_CALL) < 0) return false;
  // The card is the ELSE arm of the sheet-music decision (`piece.sheetMusicUrl ?
  // … : sheetCard ? …`): a curated score we host always wins, and the card can
  // never replace the page body.
  if (!/:\s*sheetCard\s*\?/.test(masked)) return false;
  // ONE purchase action: the coach card never gets an opener (v31).
  if (/\bonOpenPurchase\b/.test(masked)) return false;
  // The press must pass the CARD's own url to the opener: `onPress={() =>
  // openInAppPurchase(sheetCardUrl)}` (the url variable is derived from the
  // card, which is why the card's url name is what is matched).
  return /onPress=\{\(\)\s*=>\s*[A-Za-z]*[Oo]pen[A-Za-z]*\(\s*[A-Za-z]*sheetCard[A-Za-z]*\s*\)\}/.test(
    masked,
  );
}

/**
 * Thesis 3b (v31, owner 10-01 D4): the coach card is NOT a purchase surface.
 *
 * A modern-song piece page carries exactly ONE retailer CTA — the sheet-music
 * card — so the coach card must (a) still route its reference-melody state
 * through the pure decision (`coachMelodyCard(`) and (b) hold no way to open a
 * retailer at all: no `onOpenPurchase` prop, no shared shell opener, no WebView,
 * no `Linking.openURL`. The duplicate box the owner saw (his History row first)
 * came from exactly this capability living in two components; deleting it here
 * is what keeps a piece page at one tap to buy.
 */
export function coachCardHasNoPurchaseAction(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(COACH_MELODY_CALL) < 0) return false;
  if (/\bonOpenPurchase\b/.test(masked)) return false;
  if (masked.indexOf(PURCHASE_SHELL_OPENER) >= 0) return false;
  if (masked.indexOf('PurchaseWebView') >= 0) return false;
  if (/\bLinking\.openURL\b/.test(masked)) return false;
  return true;
}

/**
 * Thesis 3c (v31, owner 10-01 D4 + DP8): the coach card never OFFERS a melody it
 * cannot produce.
 *
 * Three text facts, all pinned because they are silently breakable:
 *   • the `'hidden'` kind short-circuits the render (`return null`) BEFORE any
 *     card body — a public-domain piece with no melody and no licensed link shows
 *     nothing at all ("hiding, not promising");
 *   • the old promise copy is gone: no "coming soon" and no `noReference.headline`
 *     anywhere in the card's source;
 *   • a modern song (the `'notice'` kind) renders the ONE shared honest line via
 *     `COACH_NO_MELODY_NOTICE`.
 */
export function coachCardNeverPromisesMelody(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(COACH_MELODY_CALL) < 0) return false;
  if (masked.indexOf(COACH_NOTICE_CONSTANT) < 0) return false;
  if (!/melody\.kind === 'notice'/.test(masked)) return false;
  if (!/melody\.kind === 'hidden'[\s\S]{0,40}?return null/.test(masked)) return false;
  if (/noReference\.headline/.test(masked)) return false;
  if (/coming soon/i.test(masked)) return false;
  return true;
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

/**
 * Thesis 5 (bundle C / D7, owner 10-02): a saved MODERN row offers the purchase
 * itself, in one tap, in the app.
 *
 * The dead-end sprint gave the row its links back (thesis 1) and the piece page a
 * working card (thesis 3a) — but the row still took three taps to buy
 * (History → piece page → card). The fix is one inline action on the row, and this
 * predicate pins the four facts that make it real rather than decorative:
 *   • the row's URL comes from `primaryPurchaseUrl(item.purchaseUrls)` — the
 *     money-path resolver over the row's OWN saved map (never a hand-built link);
 *   • the action is GATED on that resolution (`rowPurchaseUrl ? … : null`), which
 *     is also what keeps a public-domain / hum row (which carries no map at all,
 *     thesis 2) free of any purchase action — no disabled button, no placeholder;
 *   • its press hands the URL to the shell's state (`setPurchaseWebUrl(…)`) —
 *     a row action that opened the system browser is the D5 defect again;
 *   • the screen mounts the shared shell (`PurchaseWebView`) with an `onClose`, so
 *     BACK returns to History rather than out of the app.
 */
export function historyRowOffersPurchase(source: string): boolean {
  const masked = maskCommentsForCodeScan(source);
  // 1. the resolver over the row's own saved map.
  if (masked.indexOf(HISTORY_ROW_PURCHASE_RESOLUTION) < 0) return false;
  // 2/3. the row action, gated on that resolution, pressing into the shell state.
  const urlBinding = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\s*=\\s*primaryPurchaseUrl\\(\\s*item\\.purchaseUrls\\s*\\)`,
  ).exec(masked);
  if (!urlBinding) return false;
  const rowUrl = urlBinding[1];
  const press = new RegExp(
    HISTORY_ROW_PURCHASE_PRESS.replace('(', '\\(') + '\\s*' + rowUrl + '\\s*\\)',
  ).test(masked);
  if (!press) return false;
  if (!new RegExp(`\\{\\s*${rowUrl}\\s*\\?`).test(masked)) return false;
  // 4. the shell itself, mounted by this screen, closable back to History.
  if (!new RegExp(`<${HISTORY_PURCHASE_SHELL}\\b`).test(masked)) return false;
  if (!/onClose=\{/.test(masked)) return false;
  // 5. and nothing on the row leaves the app.
  if (/\bLinking\s*\.\s*openURL\b/.test(masked)) return false;
  return true;
}

/** One-line report wording per guard, ready to print in a failure. */
export const HISTORY_DEAD_END_FIX_HINT =
  'a History surface must resolve to something real: the saved row keeps its retailer links, the item is pressable and opens them, ' +
  'and the search box filters the SAVED recognitions instead of the global catalog.';
