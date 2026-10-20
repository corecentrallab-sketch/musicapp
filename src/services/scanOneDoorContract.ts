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
import { scanFindActions, scanFindView, type ScanFindRead } from './scanFind';

/** How many times `readCoverText(` is CALLED in a source (the import is not a call). */
export function readCoverTextCallSites(source: string): number {
  const text = typeof source === 'string' ? source : '';
  return (text.match(/readCoverText\(/g) ?? []).length;
}

/** 1. THE READ HAS ONE HOME: exactly one call site in the resolve component. */
export function oneDoorReadsTheCover(resolveSource: string): boolean {
  if (typeof resolveSource !== 'string' || resolveSource.length < 2000) return false;
  if (readCoverTextCallSites(resolveSource) !== 1) return false;
  // …and the read's result is what the view is built from.
  return resolveSource.indexOf('scanFindView(result') >= 0;
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
