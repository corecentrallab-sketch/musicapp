/**
 * coverScan.ts — "Scan the cover" for the find-a-piece search (v33 slice H,
 * owner 10-04 email batch; the SCAN step itself landed in v36 fix 4, owner FAIL
 * 10-08: "snaps a picture and can save it — snaps but does not scan").
 *
 * WHAT IT DOES. The search box gets a camera affordance: photograph the title
 * page of a score, the on-device recogniser reads the TEXT on it, and the reading
 * becomes a search query that lands on the SAME results a typed search produces.
 * It is a query-shortcut, never a second search: the normalised text is handed to
 * the existing catalog search, and the user always sees the query — and can fix
 * it — before it runs (no dead ends, no silent guesses).
 *
 * ON-DEVICE TEXT READING — WHAT IS AND IS NOT READ (v36 fix 4). The reader is a
 * real on-device recogniser (see services/coverScanOcr.ts); the photo never
 * leaves the device. It reads the TITLE PAGE'S TEXT ONLY — never the notes, so
 * this is not, and never claims to be, OMR (score→notation) or a transcription:
 * nothing here produces note data, and a modern-song match still never renders
 * generated notation. A read that fails is its OWN honest state
 * (COVER_SCAN_OCR_FAILED_LINE) with an empty field to type into — a failure is
 * never dressed up as "we found nothing on that page".
 *
 * The OCR call is isolated behind this module's `coverQueryFromScan`, so the
 * pure decision (what text we got, what the user reads, whether a search may run)
 * is testable without the native module.
 *
 * PURE (no react / react-native / fs / camera): the query normalisation, the
 * noise dropping and the honest states are asserted by
 * scripts/v33TakeEditor.test.ts.
 */

export const COVER_SCAN_CTA = '📷 Scan a cover';
export const COVER_SCAN_TITLE = 'Scan the cover';
export const COVER_SCAN_BODY =
  'Photograph the title page of a score and we will search for it. You always see the search before it runs.';
export const COVER_SCAN_CONFIRM_LABEL = 'Search for';
export const COVER_SCAN_CONFIRM_HINT = 'Check this, fix anything wrong, then search.';
export const COVER_SCAN_SEARCH_CTA = 'Search this title';
export const COVER_SCAN_RETAKE_CTA = 'Retake photo';
export const COVER_SCAN_CANCEL_CTA = 'Cancel';

/** True when this build has an on-device recogniser wired (v36 fix 4). */
export const COVER_SCAN_OCR_AVAILABLE = true;

/** The honest line while the recogniser is working on the photo. */
export const COVER_SCAN_READING_LINE = 'Reading the title page on your device…';

/** The honest line when the photo cannot be read for the user. */
export const COVER_SCAN_NO_OCR_LINE =
  'Reading text from a photo is not in this build — type the title you see (or paste it) and the same search runs.';
/** The honest line when a reader IS present but found nothing usable. */
export const COVER_SCAN_NO_TEXT_LINE =
  'We could not find a title in that photo — type it instead, or try again in better light.';
/**
 * The honest line when the reader itself failed (module unavailable on this
 * device, or the read threw). Its own state: a broken read is not the same claim
 * as "your page has no title on it", and it is never a fabricated query.
 */
export const COVER_SCAN_OCR_FAILED_LINE =
  'We could not read that photo on this device — type the title you see and the same search runs.';
/**
 * What the scan does and does not read. The recogniser reads the title page's
 * TEXT only; it never reads the notes, so nothing here is OMR or a transcription.
 */
export const COVER_SCAN_TEXT_ONLY_LINE =
  'The scan reads the words on the cover only — never the notes. Nothing leaves your device.';
/** The camera is the app's own permission, and it can be refused. */
export const COVER_SCAN_PERMISSION_LINE =
  'Camera access is off — turn it on in Settings, or type the title instead.';
export const COVER_SCAN_PERMISSION_CTA = 'Open Settings';
/** No dead end: whatever the photo did, the typed search is one tap away. */
export const COVER_SCAN_FALLBACK_LINE =
  'You can always type the title instead — the results are the same search.';

/** The longest query we will build from a photo (the search field's own limit). */
export const COVER_SCAN_MAX_QUERY = 80;

/**
 * Lines a title page carries that are never the piece's title: price/ISBN/URL
 * furniture, publisher addresses, a bare opus/catalog number and the like.
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /^(isbn|issn|ean|upc)\b/i,
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /^[$\u00a3\u20ac]\s?\d/,
  /^\d+([.,]\d+)?$/,
  /^(price|printed in|publisher|edition|edition no|plate no|copyright|\u00a9)/i,
  /^(all rights reserved|no part of this)/i,
];

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return true;
  if (!/[a-z]/i.test(trimmed)) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export interface CoverQuery {
  /** The query the search will run — '' when nothing usable was found. */
  query: string;
  /** The lines that made it into the query, in order. */
  lines: string[];
  /** How many lines were dropped as noise (for the honest counter, if wanted). */
  dropped: number;
  /** True when the text was longer than the field and had to be cut. */
  truncated: boolean;
}

/**
 * Turn whatever text we have for a cover into a search query.
 *
 * The FIRST meaningful line is the title on a title page, so it leads; a second
 * line (the composer, usually) is appended because the catalog search matches
 * both title and composer. Nothing is invented: with no usable line the query is
 * empty and the caller asks the user to type instead.
 */
export function coverQueryFromText(text: string | null | undefined): CoverQuery {
  const raw = typeof text === 'string' ? text : '';
  const all = raw.split(/\r?\n/);
  const kept: string[] = [];
  let dropped = 0;
  for (const line of all) {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (isNoiseLine(cleaned)) {
      dropped += 1;
      continue;
    }
    kept.push(cleaned);
  }
  const lines = kept.slice(0, 2);
  let query = lines.join(' ').trim();
  let truncated = false;
  if (query.length > COVER_SCAN_MAX_QUERY) {
    query = query.slice(0, COVER_SCAN_MAX_QUERY).trim();
    truncated = true;
  }
  return { query, lines, dropped, truncated };
}

export type CoverScanStatus = 'ready' | 'no-text' | 'no-ocr' | 'ocr-failed';

export interface CoverScanOutcome {
  status: CoverScanStatus;
  /** The query the search would run ('' unless `ready`). */
  query: string;
  /** The honest line the surface shows for this status. */
  line: string;
}

/**
 * What the scan produced. `ocrText` is what the on-device recogniser returned
 * (null when nothing has been read yet, or when this build has no reader wired —
 * the honest `no-ocr` state, which still lets the user type the title and search);
 * `ocrFailed` is true when the READ ITSELF failed (module unavailable, or the
 * recogniser threw) — its own honest state, never confused with "blank page".
 *
 * Only `ready` ever yields a query, so a failed or empty read can never run a
 * search: the field stays empty and the user's own words are what search.
 */
export function coverQueryFromScan(input: {
  ocrText?: string | null;
  ocrAvailable?: boolean;
  ocrFailed?: boolean;
}): CoverScanOutcome {
  const available = input.ocrAvailable ?? COVER_SCAN_OCR_AVAILABLE;
  if (!available) {
    return { status: 'no-ocr', query: '', line: COVER_SCAN_NO_OCR_LINE };
  }
  // Checked BEFORE the text: a read that broke is not a page with no title on it,
  // and the difference is what the user needs to act on.
  if (input.ocrFailed) {
    return { status: 'ocr-failed', query: '', line: COVER_SCAN_OCR_FAILED_LINE };
  }
  const result = coverQueryFromText(input.ocrText ?? '');
  if (!result.query) {
    return { status: 'no-text', query: '', line: COVER_SCAN_NO_TEXT_LINE };
  }
  return { status: 'ready', query: result.query, line: COVER_SCAN_CONFIRM_HINT };
}

/** The label the search box carries once a scan flow is available. */
export function coverScanAffordanceLabel(): string {
  return COVER_SCAN_OCR_AVAILABLE ? COVER_SCAN_CTA : '📷 Photograph a cover';
}

// ─── WHAT THE SCAN'S RESULT SURFACE OFFERS (v37 item 5) ─────────
//
// THE OWNER'S FINDING (item 10, backlog bce8f6f2): the read works, but the
// result had NO WAY FORWARD. When the recogniser came back with nothing usable
// the confirm field was empty, and the only button that would have done anything
// ("Search this title") is disabled while the field is empty — a state the user
// could not leave except by retaking the photo. A scan is a piece of the user's
// own music; it must always be possible to KEEP it, and a title the user can see
// (typed or read) must always reach the money path for a song we do not hold.
//
// The actions are decided HERE, purely, so the surface renders exactly what the
// model says and the tier1 gate can prove no state is a dead end:
//   • SAVE — the captured photo goes into the app's own on-device library through
//     the EXISTING store write path for scans (`libraryStore.createScannedScore`,
//     the same store item 4's PD save writes to). It is offered in every state
//     after a capture, because it never depends on the read having worked;
//   • GET THIS SONG — the licensed-retailer route for a title we do not hold (a
//     modern/copyrighted piece). It is offered whenever there are words to search
//     with, and the host opens it through the EXISTING affiliate URL builder
//     (searchExternal.sheetMusicDirectSearchUrl) in the EXISTING in-app shell. No
//     new URL, no second checkout, no auto-redirect.

/** The save action's own name (the visible label comes from librarySaveModel). */
export const COVER_SCAN_SAVE_CTA = 'Save this scan to your library';
/** What saving the scan really does — the user's own photo, kept on the device. */
export const COVER_SCAN_SAVE_HINT =
  'Keeps the photo you just took in your Library — it opens offline.';
/** The honest line once the scan is in the library. */
export const COVER_SCAN_SAVED_LINE =
  'Saved to your library — it stays on this device and opens offline.';
/** A failed save is never silent. */
export const COVER_SCAN_SAVE_FAILED_LINE =
  'We could not save that scan — please try again.';
/** The money path for a title we do not hold (SMD, affiliate id 67650). */
export const GET_THIS_SONG_CTA = 'Get this Song';
/** What the money path does (we host nothing; their page does the selling). */
export const COVER_SCAN_GET_SONG_HINT =
  'Opens the licensed retailers for the title we read — inside NoteSnap.';
/** The line under the save action while the read produced nothing usable. */
export const COVER_SCAN_NO_READ_YET_NOTE =
  'Nothing readable came back? You can still keep the scan, or type the title and search.';

export interface CoverScanResultActions {
  /** The captured photo can be kept in the library (any read status). */
  canSave: boolean;
  /** The ordinary catalog search may run (a usable read landed). */
  canSearch: boolean;
  /** The licensed-retailer route for this title is offered. */
  canGetThisSong: boolean;
  /** The money CTA's label, or null when it is not offered. */
  getThisSongLabel: string | null;
  /** The honest line for the money path, or null. */
  moneyLine: string | null;
  /**
   * True when at least one action resolves in this state. Every state of the
   * result surface must satisfy this (the no-dead-end rule, plan 09-28).
   */
  hasWayForward: boolean;
}

/**
 * What the scan's result surface offers for this state. Null-safe on purpose:
 * a missing/garbage input resolves to the honest "nothing read yet" shape rather
 * than throwing, so a guard that mutates a caller cannot crash the suite.
 */
export function coverScanResultActions(input?: {
  status?: CoverScanStatus;
  query?: string | null;
  hasPhoto?: boolean;
  canGetThisSong?: boolean;
} | null): CoverScanResultActions {
  const safe = input && typeof input === 'object' ? input : {};
  const status: CoverScanStatus =
    safe.status === 'ready' ||
    safe.status === 'no-text' ||
    safe.status === 'no-ocr' ||
    safe.status === 'ocr-failed'
      ? safe.status
      : 'ready';
  const query = typeof safe.query === 'string' ? safe.query.trim() : '';
  // The photo is the one thing the save action needs; `hasPhoto !== false` keeps
  // the default (a captured photo) while letting a caller say there is none.
  const canSave = safe.hasPhoto !== false;
  const canSearch = status === 'ready' && query.length > 0;
  const wired = safe.canGetThisSong !== false;
  const canGetThisSong = wired && query.length > 0;
  return {
    canSave,
    canSearch,
    canGetThisSong,
    getThisSongLabel: canGetThisSong ? GET_THIS_SONG_CTA : null,
    moneyLine: canGetThisSong ? COVER_SCAN_GET_SONG_HINT : null,
    hasWayForward: canSave || canSearch || canGetThisSong,
  };
}
