/**
 * scanOneDoorContract.ts — THERE IS EXACTLY ONE WAY TO SCAN A COVER (v43 item C6).
 *
 * WHY A GUARD AT ALL. v33 put a "Scan a cover" camera row on the find-a-piece
 * search bar, and the Library scanner grew a second read of the same kind of
 * photo. Two doors meant two behaviours: the search-bar one offered a garbage
 * read as a query (the owner's "4ox 2Apx ors white Freddie Mer"), and the framing
 * notice — the thing that makes a photo matchable — existed in neither. v43
 * retired the search-bar door. These guards are what keep it retired:
 *
 *   1. the on-device read is called from EXACTLY ONE place in the app;
 *   2. no screen mounts the retired modal;
 *   3. the find-a-piece screen carries no cover-scan affordance of any kind;
 *   4. a garbage read is never offered as a search (the pure model, not a check
 *      someone can forget to write);
 *   5. the camera screen TELLS the user how to frame the shot, before the first
 *      photo — the owner's triple-emphasised requirement.
 *
 * Every function takes SOURCE TEXT, so the tier1 suite can run it against the real
 * files without an emulator.
 */
import {
  SCAN_FIND_PAGE_OF_MUSIC_LINE,
  scanFindActions,
  scanFindView,
  type ScanFindRead,
} from './scanFind';

/** How many times `readCoverText(` is CALLED in a source (the import is not a call). */
export function readCoverTextCallSites(source: string): number {
  const text = typeof source === 'string' ? source : '';
  return (text.match(/readCoverText\(/g) ?? []).length;
}

/** 1. THE READ HAS ONE HOME: exactly one call site in the resolve component. */
export function oneDoorReadsTheCover(resolveSource: string): boolean {
  if (typeof resolveSource !== 'string' || resolveSource.length < 2000) return false;
  if (readCoverTextCallSites(resolveSource) !== 1) return false;
  // …and the read's result is what the view is built from. v44 #59 hands the
  // photo's KIND along with it (`scanFindView({ ...result, photoKind })`), so both
  // spellings are accepted — what this pins is that the recogniser's own result is
  // the input, never a different string.
  return (
    resolveSource.indexOf('scanFindView({ ...result, photoKind }') >= 0 ||
    resolveSource.indexOf('scanFindView(result') >= 0
  );
}

/** 2. NOTHING MOUNTS THE RETIRED MODAL. */
export function noScreenMountsTheRetiredModal(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  return sources.every(
    (source) => typeof source === 'string' && source.indexOf('<CoverScanModal') < 0,
  );
}

/** 3. THE FIND-A-PIECE SCREEN HAS NO COVER-SCAN AFFORDANCE. */
export function findPieceHasNoCoverScanAffordance(source: string): boolean {
  if (typeof source !== 'string' || source.length < 3000) return false;
  if (source.indexOf('coverScanAffordanceLabel(') >= 0) return false;
  if (source.indexOf('setShowCoverScan') >= 0) return false;
  if (source.indexOf('<CoverScanModal') >= 0) return false;
  return true;
}

/**
 * 4. A GARBAGE READ OFFERS NO READ-SEARCH — decided by the PURE model, so no
 * surface can offer one by forgetting a check. `SCAN_COVER_ONLY_HINT`-era reads
 * arrive here as the same `ScanFindRead` the component hands to `scanFindView`.
 */
export function garbageNeverOffersAReadSearch(read: ScanFindRead): boolean {
  const view = scanFindView(read);
  if (view.quality !== 'garbage') return false;
  if (view.query !== '') return false;
  if (view.canSearch) return false;
  const actions = scanFindActions(view);
  if (actions.offerReadSearch) return false;
  if (actions.showReadWords) return false;
  // …and the way out always exists.
  return actions.offerTypedSearch && actions.offerRetake;
}

/** 5. THE CAMERA SCREEN CARRIES THE FRAMING NOTICE, PERMANENTLY. */
export function captureScreenShowsTheFramingNotice(scanScreenSource: string): boolean {
  if (typeof scanScreenSource !== 'string' || scanScreenSource.length < 3000) return false;
  if (scanScreenSource.indexOf('{SCAN_COVER_ONLY_HINT}') < 0) return false;
  if (scanScreenSource.indexOf('pointerEvents="none"') < 0) return false;
  return scanScreenSource.indexOf('scanFramingHintTop(') >= 0;
}

// ─── v44 #58 / #59 / #60 — THE THREE OWNER DEFECTS, PINNED ───────────────────
//
// Each of these is a source-or-model predicate, so the tier1 suite can prove the
// fix is still in place WITHOUT an emulator — and each has an in-suite mutation in
// scripts/scanOneDoor.test.ts that tries to undo the fix at runtime.

/** The owner's exact durability line (v44 #60, backlog 33732422). */
export const SCAN_TAKE_SAVES_COPY = 'Your Take still saves to the library';

/** 6. THE FRAMING TIP SAYS THE OWNER'S WORDS, NOT THE HALF-READ OLD ONES. */
export function framingTipCarriesTheOwnerCopy(screenSource: string, takeLine: string): boolean {
  if (typeof screenSource !== 'string' || screenSource.length < 3000) return false;
  if (takeLine !== SCAN_TAKE_SAVES_COPY) return false;
  // …rendered as its own text, from the named constant, so it cannot be the half
  // of a longer sentence that a layout cuts off.
  return screenSource.indexOf('{SCAN_TAKE_SAVES_LINE}') >= 0;
}

/**
 * 7. THE TIP IS NEVER CLIPPED (v44 #60). No `maxHeight` on its panel, and the font
 * scale is capped at the model's own limit so the measured room still holds.
 */
export function framingTipIsNeverClipped(screenSource: string): boolean {
  if (typeof screenSource !== 'string' || screenSource.length < 3000) return false;
  const panel = styleBlockOf(screenSource, 'framingHintPanel');
  if (panel.length === 0) return false;
  if (/maxHeight\s*:/.test(panel)) return false;
  const capped = (screenSource.match(/maxFontSizeMultiplier=\{SCAN_TIP_MAX_FONT_SCALE\}/g) ?? []).length;
  return capped >= 3;
}

/**
 * 8. THE TIP'S INK CANNOT BE REPAINTED BLACK-ON-BLACK (v44 #58, bdb27d6c). The
 * panel carries NO colour literal of its own (a literal is what the themed
 * StyleSheet repaint turned near-black while the fill stayed dark), and the screen
 * paints it from the overlay palette instead.
 */
export function framingTipColoursCannotInvert(screenSource: string): boolean {
  if (typeof screenSource !== 'string' || screenSource.length < 3000) return false;
  const panel = styleBlockOf(screenSource, 'framingHintPanel');
  const title = styleBlockOf(screenSource, 'framingHintTitle');
  const body = styleBlockOf(screenSource, 'framingHintText');
  if (panel.length === 0 || title.length === 0 || body.length === 0) return false;
  const colourLiteral = /(color|backgroundColor|borderColor)\s*:\s*['"](rgba?\(|#)/;
  if ([panel, title, body].some((block) => colourLiteral.test(block))) return false;
  // …and every one of the three is painted inline from the model's palette.
  return (
    screenSource.indexOf('backgroundColor: SCAN_TIP_SCRIM') >= 0 &&
    screenSource.indexOf('color: SCAN_TIP_INK') >= 0 &&
    screenSource.indexOf('color: SCAN_TIP_TITLE_INK') >= 0
  );
}

/**
 * 9. A PAGE OF MUSIC NEVER OFFERS ITS DEBRIS AS A QUERY (v44 #59, ce3a2282).
 * The owner's real read — a tidy-looking line off a page of Bohemian Rhapsody —
 * is what a page door must refuse. The cover door keeps it (a real title we do not
 * hold looks the same) but flags it as uncorroborated, so the surface cannot label
 * it "Search for".
 */
export function pageScanNeverOffersAGarbageQuery(): boolean {
  const debris = 'Auio - Metal';
  const page = scanFindView({ text: debris, failed: false, photoKind: 'page' });
  if (page.query !== '' || page.canSearch) return false;
  if (page.quality !== 'garbage') return false;
  if (page.line !== SCAN_FIND_PAGE_OF_MUSIC_LINE) return false;
  const pageActions = scanFindActions(page);
  if (pageActions.offerReadSearch || pageActions.showReadWords) return false;
  // …and the way out always exists (no dead end).
  if (!pageActions.offerTypedSearch || !pageActions.offerRetake) return false;
  // THE COVER DOOR: still searchable, but never as a vouched-for title.
  const cover = scanFindView({ text: debris, failed: false, photoKind: 'cover' });
  return cover.canSearch === true && cover.uncorroborated === true;
}

/** The body of a StyleSheet entry, from `<name>: {` to its closing `},`. */
function styleBlockOf(source: string, name: string): string {
  const marker = `${name}: {`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const end = source.indexOf('\n  },', start);
  return end < 0 ? '' : source.slice(start, end);
}

