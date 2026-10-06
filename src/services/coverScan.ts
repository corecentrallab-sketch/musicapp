/**
 * coverScan.ts — "Scan the cover" for the find-a-piece search (v33 slice H,
 * owner 10-04 email batch).
 *
 * WHAT IT DOES. The search box gets a camera affordance: photograph the title
 * page of a score, turn the text into a search query, land on the SAME results a
 * typed search produces. It is a query-shortcut, never a second search: the
 * normalised text is handed to the existing catalog search, and the user always
 * sees the query before it runs (no dead ends, no silent guesses).
 *
 * ON-DEVICE TEXT READING — HONEST STATE OF THIS BUILD. Real OCR needs an
 * on-device recogniser, which in React Native is a NATIVE module (ML Kit /
 * equivalents). This build has no such dependency, so the scan flow ships as
 * capture → CONFIRM → search with the confirm field EMPTY and the surface saying
 * plainly that reading the photo is not in this build (COVER_SCAN_NO_OCR_LINE).
 * The OCR call itself is isolated behind `coverQueryFromScan`, so adding the
 * recogniser later is one function, not a rewrite. Nothing here pretends a photo
 * was read when it was not.
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

/** True when this build has an on-device recogniser wired (see the header). */
export const COVER_SCAN_OCR_AVAILABLE = false;

/** The honest line when the photo cannot be read for the user. */
export const COVER_SCAN_NO_OCR_LINE =
  'Reading text from a photo is not in this build — type the title you see (or paste it) and the same search runs.';
/** The honest line when a reader IS present but found nothing usable. */
export const COVER_SCAN_NO_TEXT_LINE =
  'We could not find a title in that photo — type it instead, or try again in better light.';
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

export type CoverScanStatus = 'ready' | 'no-text' | 'no-ocr';

export interface CoverScanOutcome {
  status: CoverScanStatus;
  /** The query the search would run ('' unless `ready`). */
  query: string;
  /** The honest line the surface shows for this status. */
  line: string;
}

/**
 * What the scan produced. `ocrText` is what an on-device recogniser returned
 * (null when this build has none — the honest `no-ocr` state, which still lets
 * the user type the title and search).
 */
export function coverQueryFromScan(input: {
  ocrText?: string | null;
  ocrAvailable?: boolean;
}): CoverScanOutcome {
  const available = input.ocrAvailable ?? COVER_SCAN_OCR_AVAILABLE;
  if (!available) {
    return { status: 'no-ocr', query: '', line: COVER_SCAN_NO_OCR_LINE };
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
