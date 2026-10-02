/**
 * resultSurfaceContract.ts — the source contracts for the ONE result surface
 * (bundle A, owner 10-02).
 *
 * Bundle A moves every recognition outcome onto ONE card and renders the hosted
 * score INLINE in it. Both are WIRING facts — a card that renders a second result
 * UI, a score block that was deleted, a WebView tag that lost the runtime flags, a
 * modern card that grew notation, a sheet URL the app invented — and none of them
 * can be seen by a pure-logic test, and there is no emulator on this box. So the
 * predicates here read the app's own source text, in the house style
 * (humBridge.ts / midiExportContract.ts / historyDeadEndContract.ts), and
 * scripts/resultSurface.test.ts runs them on the REAL screens plus synthetic
 * pre-fix sources and a mutation probe per predicate.
 *
 * The five theses:
 *   1. `singleResultSurfaceWired` — a match is handled by ONE surface. The hum
 *      screen's own `stage === 'result'` card is retired: if it comes back, two
 *      cards render the same match and the inline-score work is undone.
 *   2. `sheetRendersInline` — the success branch embeds the viewer document
 *      (`buildSheetViewerHtml`) AND keeps the "⛶ Full screen" chip that opens the
 *      existing reader. Both halves, or the user has either no inline sheet or no
 *      way to read it properly.
 *   3. `inlineScoreCarriesFlags` — that tag carries `javaScriptEnabled` +
 *      `domStorageEnabled` (belt-and-braces on top of
 *      `inAppBrowserContract.findWebViewFlagViolations`, whose v26 lesson applies
 *      to every WebView we render, pdf.js included).
 *   4. `modernResultRendersNoNotation` — the modern (copyrighted) branch renders
 *      no notation at all: no viewer document, no ABC editor, no chords. This is
 *      the copyright boundary, frozen as a predicate.
 *   5. `resultSheetIsNeverInvented` — the surface never calls
 *      `sheetUrlForPieceId()`. That helper is a KEY BUILDER for ingesting gated
 *      batch content; calling it in a surface would fabricate a promise that a
 *      score exists for the piece — the class of dead link this re-flow removes.
 *
 * Pure by design — no react / react-native / fs / path imports.
 */
import { maskComments, readModalTag, type SourceFile } from './modalBackContract';
import {
  missingWebViewFlags,
  webViewTags,
  type WebViewFlagViolation,
} from './inAppBrowserContract';

export type { SourceFile };

// ─────────────── 1. ONE surface, not three ───────────────

/** The ONE shared result component (bundle A). */
export const RESULT_SURFACE_COMPONENT = 'RecognitionResultView';
/** Its mount site, as it appears in a host's JSX. */
export const SHARED_RESULT_SURFACE_MOUNT = `<${RESULT_SURFACE_COMPONENT}`;
/** The surface's own declaration (a file that IS the surface passes by being it). */
export const RESULT_SURFACE_DECLARATION = `export const ${RESULT_SURFACE_COMPONENT}`;

/**
 * The retired per-screen result cards. Each marks a second result UI rendering the
 * same match:
 *   • `stage === 'result'` — the hum screen's own result card (retired here: the
 *     screen keeps capture + no-match/error, the shared surface shows the match);
 *   • `styles.matchCard` — that card's inner piece box, which only ever existed
 *     inside it.
 */
export const RETIRED_PER_SCREEN_RESULT_MARKERS: readonly string[] = [
  "stage === 'result'",
  'styles.matchCard',
];

/**
 * True when a file's result rendering is the ONE shared surface: no retired
 * per-screen result card survives, and the file either MOUNTS the shared surface
 * or IS it.
 *
 * Run it per screen (the hum screen, the modern screen, the surface itself) — a
 * file that grew its own second result card fails wherever it lives.
 */
export function singleResultSurfaceWired(source: string): boolean {
  const masked = maskComments(source);
  for (const marker of RETIRED_PER_SCREEN_RESULT_MARKERS) {
    if (masked.indexOf(marker) >= 0) return false;
  }
  return (
    masked.indexOf(SHARED_RESULT_SURFACE_MOUNT) >= 0 ||
    masked.indexOf(RESULT_SURFACE_DECLARATION) >= 0
  );
}

// ─────────────── 2. the inline score + the reader chip ───────────────

/** The viewer document the inline score (and the reader) is built from. */
export const SHEET_VIEWER_HTML_CALL = 'buildSheetViewerHtml(';
/** The style marker of the inline score block. */
export const INLINE_SHEET_STYLE = 'styles.inlineSheet';
/** The chip that expands the inline score into the full-screen reader. */
export const FULL_SCREEN_CHIP_MARKER = 'SHEET_FULL_SCREEN_CHIP';
/** The existing full-screen sheet reader. */
export const SHEET_READER_COMPONENT = 'ScoreViewer';

/**
 * True when the surface renders the hosted score INLINE and keeps the way to read
 * it properly: the inline block exists, its `<WebView>` is fed the viewer document
 * built from the hosted URL, and the "⛶ Full screen" chip opens the existing
 * reader (`ScoreViewer`, on `setShowScoreViewer(true)` — an overlay inside the
 * card, never a replacement for it).
 */
export function sheetRendersInline(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(INLINE_SHEET_STYLE) < 0) return false;
  const webviewAt = masked.indexOf('<WebView');
  if (webviewAt < 0) return false;
  const tag = readModalTag(masked, webviewAt);
  if (tag === null || tag.indexOf(SHEET_VIEWER_HTML_CALL) < 0) return false;
  if (masked.indexOf(FULL_SCREEN_CHIP_MARKER) < 0) return false;
  if (!/setShowScoreViewer\s*\(\s*true\s*\)/.test(masked)) return false;
  return new RegExp(`<${SHEET_READER_COMPONENT}[\\s/>]`).test(masked);
}

// ─────────────── 3. the inline tag's runtime flags ───────────────

/**
 * Every WebView tag in `source` that renders the inline score document.
 * (Identified by the document builder in its `source={{ html }}` argument, so a
 * file with more than one WebView still tells the guard which tag is the score.)
 */
export function inlineSheetWebViewTags(source: string): Array<{ line: number; tag: string }> {
  return webViewTags(source).filter(
    (found) => found.tag.indexOf(SHEET_VIEWER_HTML_CALL) >= 0,
  );
}

/** The flags the inline score tag is missing (empty = compliant). */
export function inlineSheetMissingFlags(source: string): string[] {
  const tags = inlineSheetWebViewTags(source);
  if (tags.length === 0) return ['<no inline score WebView tag found>'];
  const missing: string[] = [];
  for (const { tag } of tags) {
    for (const flag of missingWebViewFlags(tag)) {
      if (!missing.includes(flag)) missing.push(flag);
    }
  }
  return missing;
}

/**
 * True when the inline score's `<WebView>` carries the runtime flags it needs
 * (`javaScriptEnabled` + `domStorageEnabled`).
 *
 * This is belt-and-braces on top of `inAppBrowserContract.findWebViewFlagViolations`
 * — which scans the same tag over the whole tree — because the pdf.js document
 * needs JavaScript and the viewer document touches storage, and because the v26
 * lesson (a bare WebView silently showing "No results" on Android, where
 * `domStorageEnabled` defaults to FALSE) applies to any document we embed, not
 * only to a retailer page.
 */
export function inlineScoreCarriesFlags(source: string): boolean {
  return inlineSheetMissingFlags(source).length === 0;
}

// ─────────────── 4. the modern card renders no notation ───────────────

/**
 * The surface's modern branch marker: the JSX branch that renders a copyrighted
 * match. The predicate reads the branch it delimits.
 */
export const MODERN_BRANCH_MARKER = "kind === 'modern'";

/**
 * Every spelling of notation the copyright boundary forbids on a modern match:
 * the sheet-viewer document, the ABC notation view / abcjs, and chord rendering.
 */
export const NOTATION_MARKERS: readonly string[] = [
  SHEET_VIEWER_HTML_CALL,
  'AbcScoreView',
  'abcjs',
  'chord',
];

/** The `{ … }` block whose opening brace is the one at/before `at`, brace-matched. */
function enclosingJsxBlock(masked: string, at: number): string {
  const open = masked.lastIndexOf('{', at);
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
 * True when the modern (copyrighted) branch renders NO notation.
 *
 * The branch must exist (a surface that never says "modern" is not this surface)
 * and must not contain any notation marker: we host no copyrighted music, and the
 * card's only money path is the in-shell licensed-retailer offer.
 */
export function modernResultRendersNoNotation(source: string): boolean {
  const masked = maskComments(source);
  const at = masked.indexOf(MODERN_BRANCH_MARKER);
  if (at < 0) return false;
  const block = enclosingJsxBlock(masked, at);
  if (!block) return false;
  return NOTATION_MARKERS.every(
    (marker) => block.toLowerCase().indexOf(marker.toLowerCase()) < 0,
  );
}

// ─────────────── 5. the sheet URL is never invented ───────────────

/**
 * The gated-ingest KEY BUILDER: it turns a piece id into the URL our backend
 * serves a score on, and exists for the ingestion path that has already proved it
 * holds a compliant score. A result surface calling it would be claiming a score
 * exists — the fabricated promise this re-flow removes — so no result surface may
 * call it. (The hosted URL comes from the backend/catalog, only.)
 */
export const INVENTED_SHEET_CALL = 'sheetUrlForPieceId(';

/**
 * The fields a hosted score URL may be read from: the recognition match's
 * `sheet_music_url`, the catalog's `sheetMusicUrl`, or the caller's resolved
 * `hostedSheetUrl` argument. Any of them is a URL the backend/catalog returned.
 */
export const HOSTED_SHEET_URL_READERS: readonly string[] = [
  'sheet_music_url',
  'sheetMusicUrl',
  'hostedSheetUrl',
];

/**
 * True when the surface takes its sheet URL from the backend/catalog and never
 * builds one itself.
 */
export function resultSheetIsNeverInvented(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(INVENTED_SHEET_CALL) >= 0) return false;
  return HOSTED_SHEET_URL_READERS.some((reader) => masked.indexOf(reader) >= 0);
}

// ─────────────── the whole contract, over a file set ───────────────

export interface ResultSurfaceViolation {
  path: string;
  predicate: string;
  message: string;
}

/**
 * Every result-surface contract problem across `files`. `surfacePath` is the file
 * that IS the shared surface (checked for the inline sheet, its flags and its
 * honesty); every other file is checked for "one surface, not three".
 */
export function findResultSurfaceViolations(
  files: readonly SourceFile[],
  surfacePath = 'src/components/RecognitionResultView.tsx',
): ResultSurfaceViolation[] {
  const violations: ResultSurfaceViolation[] = [];
  for (const file of files) {
    if (!singleResultSurfaceWired(file.source)) {
      violations.push({
        path: file.path,
        predicate: 'singleResultSurfaceWired',
        message:
          `${file.path} renders its own result card (or mounts no shared result surface): ` +
          'a match must be handled by the ONE shared surface ' +
          `(<${RESULT_SURFACE_COMPONENT}>) — the retired per-screen cards may not come back.`,
      });
    }
    if (file.path !== surfacePath) continue;
    if (!sheetRendersInline(file.source)) {
      violations.push({
        path: file.path,
        predicate: 'sheetRendersInline',
        message:
          `${file.path} does not render the hosted score inline with a way to open the reader: ` +
          `the success branch needs the <WebView> fed by ${SHEET_VIEWER_HTML_CALL} AND the ` +
          `${FULL_SCREEN_CHIP_MARKER} chip that opens <${SHEET_READER_COMPONENT}>.`,
      });
    }
    if (!inlineScoreCarriesFlags(file.source)) {
      violations.push({
        path: file.path,
        predicate: 'inlineScoreCarriesFlags',
        message:
          `${file.path} renders the inline score without ${inlineSheetMissingFlags(file.source).join(' + ')} — ` +
          'the viewer document needs JavaScript and storage on Android (domStorageEnabled defaults to false).',
      });
    }
    if (!modernResultRendersNoNotation(file.source)) {
      violations.push({
        path: file.path,
        predicate: 'modernResultRendersNoNotation',
        message:
          `${file.path} renders notation on a MODERN (copyrighted) match (the branch marked ` +
          `"${MODERN_BRANCH_MARKER}"): we host no copyrighted music, so a modern result shows no ` +
          'score, no ABC and no chords — only identity and the licensed-retailer offer.',
      });
    }
    if (!resultSheetIsNeverInvented(file.source)) {
      violations.push({
        path: file.path,
        predicate: 'resultSheetIsNeverInvented',
        message:
          `${file.path} builds or invents a sheet URL (${INVENTED_SHEET_CALL}): the hosted URL must come ` +
          `from the backend/catalog (${HOSTED_SHEET_URL_READERS.join(' / ')}).`,
      });
    }
  }
  return violations;
}

/** The WebView-flag violations of the inline score tag, as inAppBrowserContract
 *  would report them (re-exported shape for the gate's own reporting). */
export function inlineScoreFlagViolations(source: string, path: string): WebViewFlagViolation[] {
  const missing = inlineSheetMissingFlags(source);
  if (missing.length === 0) return [];
  const line = inlineSheetWebViewTags(source)[0]?.line ?? 1;
  return [
    {
      path,
      line,
      missing,
      message: `${path}:${line} — the inline score WebView is missing ${missing.join(' + ')}`,
    },
  ];
}

/** One-line report per violation, ready to print in a test failure. */
export function formatResultSurfaceViolations(
  violations: readonly ResultSurfaceViolation[],
): string[] {
  return violations.map((v) => `  ✗ [${v.predicate}] ${v.message}`);
}
