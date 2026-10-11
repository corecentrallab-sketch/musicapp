/**
 * scanFind.ts — THE SCANNED SCORE'S WAY INTO THE ONE SEARCH (v39 fix 1b, owner
 * 10-11; backlog: CAMERA SCAN-TO-LIBRARY FLOW).
 *
 * WHAT THIS IS FOR. A user photographs a page of sheet music into their Library.
 * The owner's expectation is that the photo can reach the SAME purchase path a
 * "Find a song → camera" cover scan reaches (read the printed words on device →
 * the one catalog search → the licensed retailers). This module is the pure
 * half of that: the copy, and the honest decision about what a read produced.
 *
 * WHAT IT IS NOT. This reads WORDS. It is not OMR, there is no pitch reading, no
 * note extraction, no edition claim, and no second search surface: the confirmed
 * text goes to the host, which hands it to the app's ONE search (the find-a-piece
 * screen, the same one a typed title uses). The photo is the user's own capture
 * and never leaves the device — it is read for a title, nothing else.
 *
 * HONESTY RULES (shared with services/coverScan.ts, whose `coverQueryFromScan`
 * owns the decision — this module never invents a word for it):
 *   • nothing read      → the reader's own "no text" line, empty field, no search;
 *   • the read failed   → its own failure line, empty field, no search;
 *   • text read         → the field carries EXACTLY what was read, editable, so
 *                         the search the user sees is the search that runs.
 *
 * PURE: no react, no react-native, no camera, no fs — provable before a build.
 */
import { COVER_SCAN_OCR_AVAILABLE, coverQueryFromScan } from './coverScan';

/** The scan screen's own line about durability (v39 fix 1a). */
export const SCAN_SAVED_AS_YOU_GO_LINE =
  'Each page is saved to your Library the moment you take it, so leaving this screen cannot lose a page you have already captured.';

/** Where an unfinished scan is picked up again (v39 fix 1a). */
export const SCAN_SESSION_RESUMED_PREFIX = 'Unfinished scan picked up — ';
export const SCAN_SESSION_KEPT_LINE =
  'pages are already in your Library; carry on, or press Done to finish.';

/** The finish action's label, from the real page count. */
export function scanFinishCta(pageCount: number): string {
  const count = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 0;
  return count > 0 ? `Done (${count} ${count === 1 ? 'page' : 'pages'})` : 'Done';
}

/** The line that tells the user an unfinished scan is still on this device. */
export function scanSessionResumedLine(pageCount: number): string | null {
  const count = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 0;
  if (count === 0) return null;
  return `${SCAN_SESSION_RESUMED_PREFIX}${count} ${count === 1 ? 'page' : 'pages'} — ${SCAN_SESSION_KEPT_LINE}`;
}

/** The on-disk name of a scan's page (1-based, zero-padded — the store's own). */
export function scanPageFileLabel(index0: number): string {
  const safe = Number.isFinite(index0) && index0 > 0 ? Math.floor(index0) : 0;
  return `page-${String(safe + 1).padStart(3, '0')}.jpg`;
}

/** The title a scan session is registered under, from the device's own date. */
export function scanSessionTitle(dateLabel: string): string {
  const label = typeof dateLabel === 'string' ? dateLabel.trim() : '';
  return label ? `Scanned score ${label}` : 'Scanned score';
}

// ─── THE MONEY PATH'S OWN COPY ────────────────────────────────

export const SCAN_FIND_CTA = 'Find this music';
export const SCAN_FIND_HINT =
  'Reads the words printed on the page you photographed — on this device — and takes them to the same search a typed title opens, including the official sheet music from licensed retailers.';
export const SCAN_FIND_READING_LINE = 'Reading the words on your photo, on this device…';
export const SCAN_FIND_NO_PAGE_LINE =
  'Photograph a page first — there is nothing to read yet.';
export const SCAN_FIND_CONFIRM_LABEL = 'Search for';
export const SCAN_FIND_CONFIRM_HINT = 'Check this, fix anything wrong, then search.';
export const SCAN_FIND_SEARCH_CTA = 'Search this title';
export const SCAN_FIND_RAW_QUERY_NOTE =
  'This reads the printed words on your photo to search for the piece. NoteSnap does not read the printed notes into a score, and no particular edition is claimed — the search and the licensed retailers are the way in.';

export interface ScanFindRead {
  /** What the on-device recogniser returned, exactly. */
  text?: string | null;
  /** True when the READ failed (never when the page was simply wordless). */
  failed?: boolean;
}

export interface ScanFindView {
  /** The recogniser's own status, straight from `coverQueryFromScan`. */
  status: 'idle' | 'ready' | 'no-text' | 'no-ocr' | 'ocr-failed';
  /** The query the user may confirm — empty unless real words were read. */
  query: string;
  /** The honest line for this state, or null before any read. */
  line: string | null;
  /** True only when there is a real query to search with. */
  canSearch: boolean;
}

/**
 * What a read produced. The decision itself is `coverQueryFromScan`'s — the SAME
 * one the cover scan uses — so a wordless page, a failed read and a missing
 * recogniser each keep their own honest line here, and an empty query can never
 * run a search. `null` (nothing read yet) is its own state, not a failure.
 */
export function scanFindView(read: ScanFindRead | null | undefined): ScanFindView {
  if (!read) {
    return { status: 'idle', query: '', line: null, canSearch: false };
  }
  const outcome = coverQueryFromScan({
    ocrText: read.text ?? '',
    ocrFailed: read.failed === true,
    ocrAvailable: COVER_SCAN_OCR_AVAILABLE,
  });
  const query = typeof outcome.query === 'string' ? outcome.query.trim() : '';
  return {
    status: outcome.status,
    query,
    line: outcome.line,
    canSearch: query.length > 0,
  };
}

/** The words to actually search with, or null when there is nothing to run. */
export function scanFindQuery(read: ScanFindRead | null | undefined): string | null {
  const view = scanFindView(read);
  return view.canSearch ? view.query : null;
}
