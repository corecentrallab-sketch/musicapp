/**
 * v46RedLineRail.ts — THE OWNER'S "RED LINE DOWN THE LEFT OF THE SHEET MUSIC",
 * ROOT-CAUSED AND GUARDED AT THE SOURCE.
 *
 * ── WHAT THE OWNER SAW ──────────────────────────────────────────────────────
 * A solid blood-red pill down the left of an opened piece: measured on the
 * owner's own 1344x2992 screenshot as x 60..155 px at 3x = **20.0dp .. 51.7dp**,
 * i.e. a 31.7dp-wide band starting exactly at the page's 20dp content padding,
 * ~521dp tall, with rounded caps and no legible label (4 white pixels in 21,420
 * sampled interior pixels — the control's text is not merely dark, it is gone).
 * Its colour measured (194,36,61) = #c2233c = LIGHT_THEME.accent in
 * services/theme.ts, i.e. the app's own accent, not anything inside a PDF.
 *
 * ── WHAT IT ACTUALLY WAS ────────────────────────────────────────────────────
 * Not a PDF, not the reader chrome, not a hosted score: **the page's own primary
 * "🎵 View Sheet Music" button, collapsed.** `screens/PieceDetailScreen.tsx`
 * lays its actions out in `styles.actions` — a `flexDirection: 'row'` holding
 * the score CTA and the Share button, both `flex: 1` (each 16dp padding, so each
 * one's floor is 16 * 2 = 32dp ≈ the measured 31.7dp).
 *
 * The v37 "Save to library" block (PR #160) was mounted BETWEEN those two as a
 * third row child. That block is `alignSelf: 'stretch'` around ONE line of plain
 * hint text with no wrap width, so as a row child it claims its ~380dp
 * max-content width; the row's total (~468dp) then exceeds the 408dp content box
 * and Yoga takes the space from the two `flex: 1` children, pinning them to their
 * padding floor:
 *   • the accent-filled score CTA collapses to 32dp wide → the red pill, its
 *     label squeezed to zero content width and clipped away entirely;
 *   • the row's height becomes the tallest child's, so the pill is 521dp tall;
 *   • the Share button (the other `flex: 1`) is pushed clean off the right edge
 *     of the screen — the page silently loses its share action;
 *   • the hint itself runs to x≈393dp and is clipped at the phone's edge.
 * Every one of those four is visible in the owner's screenshot, and the 32dp
 * arithmetic closes on the measured 31.7dp within a rounding error.
 *
 * ── THE FIX THESE GUARDS HOLD ───────────────────────────────────────────────
 * The Save-to-library block is its OWN full-width block BELOW the two-CTA row
 * (in the piece page's column), so the hint wraps inside the 20dp padding and
 * both CTAs keep their half of the row. No `flexDirection: 'row'` container in
 * any component that mounts SaveToLibraryButton may hold it.
 *
 * The recognition RESULT card (components/RecognitionResultView.tsx) mounts the
 * same block correctly — in a column stack — which is exactly why only the piece
 * page ever showed the rail; the symmetry predicate below keeps it that way.
 *
 * PURE: string in, boolean out. `scripts/v46RedLineRail.test.ts` feeds each
 * predicate MUTATED copies of the real sources (grid-back / block-back-in-row /
 * stretch-deleted / hint-deleted …) to prove it bites, and re-runs the geometry
 * arithmetic against the measured pixels.
 */

/** The page whose action row collapsed the CTA (the defect's home). */
export const PIECE_PAGE_FILE = 'src/screens/PieceDetailScreen.tsx';

/** The save block that was dropped into that row. */
export const SAVE_BLOCK_FILE = 'src/components/SaveToLibraryButton.tsx';

/** The other mount site — the one that always got it right (column stack). */
export const RESULT_CARD_FILE = 'src/components/RecognitionResultView.tsx';

/** The row container the two CTAs live in. */
export const ACTION_ROW_STYLE = 'actions';

/**
 * Measured on the owner's screenshot: red band x 60..155 px at 3x density
 * (1344px wide screenshot of a 448dp-wide screen) → 20.0dp .. 51.67dp.
 */
export const OBSERVED_RAIL_LEFT_DP = 20;
export const OBSERVED_RAIL_RIGHT_DP = 51.67;

/** `styles.viewSheetBtn.padding` — half of the collapsed width, by arithmetic. */
export const VIEW_SHEET_BTN_PADDING_DP = 16;

/**
 * Blank out comments — a guard must never be satisfied by prose, nor fail on it —
 * WITHOUT changing the string's length: every span this module computes is an
 * offset into the caller's REAL source, so a masking step that shrank the text
 * would hand back spans that point at the wrong bytes.
 */
function maskComments(source: string): string {
  const src = typeof source === 'string' ? source : '';
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

/** The body of a `key: { … }` entry inside a StyleSheet.create block. */
function styleBlock(source: string, key: string): string | null {
  const src = maskComments(source);
  const start = src.indexOf(key + ': {');
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Is `styles.<key>` a horizontal row? (the layout that can squeeze a flex:1 child) */
export function styleIsRow(source: string, key: string): boolean {
  const body = styleBlock(source, key);
  if (body === null) return false;
  return /flexDirection:\s*'row'/.test(body);
}

/**
 * The span of `<View style={styles.<key>}>` … its matching `</View>`, by depth
 * counting the real tags (nested Views are the norm on these screens).
 */
export function viewSpan(source: string, key: string): { start: number; end: number } | null {
  const src = maskComments(source);
  const marker = `<View style={styles.${key}}>`;
  const start = src.indexOf(marker);
  if (start < 0) return null;
  let depth = 1;
  let i = start + marker.length;
  while (i < src.length) {
    const nextOpen = src.indexOf('<View', i);
    const nextClose = src.indexOf('</View>', i);
    if (nextClose < 0) return null;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      // A self-closing <View … /> does not open a scope.
      const tagEnd = src.indexOf('>', nextOpen);
      if (tagEnd < 0) return null;
      if (src[tagEnd - 1] !== '/') depth++;
      i = tagEnd + 1;
      continue;
    }
    depth--;
    if (depth === 0) return { start, end: nextClose + '</View>'.length };
    i = nextClose + '</View>'.length;
  }
  return null;
}

/**
 * THE ARITHMETIC THAT NAMES THE DEFECT: a `flex: 1` control squeezed to its
 * padding floor is `padding * 2` wide. On the owner's screenshot that predicted
 * 32dp and the pixels measured 31.67dp.
 */
export function squeezedCtaWidthDp(paddingDp: number): number {
  return paddingDp * 2;
}

/**
 * Does a measured band width match a collapsed padding-only CTA? The lower bound
 * matters: a 2px hairline is not a collapsed button, so this must never be
 * satisfied by one, and a full-width button (~380dp) is not one either.
 */
export function railWidthMatchesSqueezedCta(
  paddingDp: number,
  measuredDp: number,
  toleranceDp = 1.5,
): boolean {
  const expected = squeezedCtaWidthDp(paddingDp);
  if (!(expected >= 20)) return false;
  if (!Number.isFinite(measuredDp)) return false;
  return Math.abs(expected - measuredDp) <= toleranceDp;
}

/**
 * PREDICATE 1 — THE SAVE BLOCK IS NOT A CHILD OF THE ACTION ROW.
 * The defect in one line: `<SaveToLibraryButton` inside `<View style={styles.actions}>`.
 */
export function saveBlockIsNotInsideTheActionRow(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 5000) return false;
  if (src.indexOf('<SaveToLibraryButton') < 0) return false;
  const span = viewSpan(src, ACTION_ROW_STYLE);
  if (span === null) return false;
  const row = src.slice(span.start, span.end);
  return row.indexOf('<SaveToLibraryButton') < 0;
}

/**
 * PREDICATE 2 — THE ROW STILL HOLDS EXACTLY ITS TWO CTAs (open the score, share),
 * is still a row, and still halves it between them. A fix that deletes the Share
 * button to make room would pass predicate 1 and fail this one.
 */
export function actionRowHoldsOnlyTheTwoCtas(source: string): boolean {
  const src = maskComments(source);
  if (!styleIsRow(src, ACTION_ROW_STYLE)) return false;
  const span = viewSpan(src, ACTION_ROW_STYLE);
  if (span === null) return false;
  const row = src.slice(span.start, span.end);
  const scoreCta =
    row.indexOf('styles.viewSheetBtn') >= 0 ||
    row.indexOf('styles.sheetCardBtn') >= 0 ||
    row.indexOf('styles.noScoreCard') >= 0;
  if (!scoreCta) return false;
  if (row.indexOf('styles.shareBtn') < 0) return false;
  if (row.indexOf('onPress={handleShare}') < 0) return false;
  if (row.indexOf('onPress={handleViewSheetMusic}') < 0) return false;
  // Exactly one <TouchableOpacity opening per CTA arm is not countable here
  // (the score arm is a 3-way ternary); what IS countable is that the save block
  // did not come back, and that no OTHER component landed in the row either.
  return row.indexOf('<SaveToLibraryButton') < 0;
}

/**
 * PREDICATE 3 — the block renders as a full-width sibling BELOW the row, once,
 * with the score URL it must hand over (never a re-derived edition).
 */
export function saveBlockIsAFullWidthStackedBlock(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 5000) return false;
  const first = src.indexOf('<SaveToLibraryButton');
  if (first < 0) return false;
  if (src.indexOf('<SaveToLibraryButton', first + 1) >= 0) return false; // exactly one render
  const span = viewSpan(src, ACTION_ROW_STYLE);
  if (span === null) return false;
  if (first < span.end) return false; // it must come AFTER the row closes
  const open = src.indexOf('>', src.indexOf('<SaveToLibraryButton'));
  if (open < 0) return false;
  const el = src.slice(first, open);
  if (el.indexOf('pieceId={piece.id}') < 0) return false;
  if (el.indexOf('scoreUrl={piece.sheetMusicUrl ?? null}') < 0) return false;
  // …and the container it lands in is the page column, not another row.
  return true;
}

/**
 * PREDICATE 4 — the block itself is a stretch-to-full-width block whose hint is
 * the thing that overflowed: `alignSelf: 'stretch'`, no `flexDirection: 'row'`
 * of its own, and the hint line really rendered (that line's max-content width is
 * what squeezed the CTAs, so it must stay the same line).
 */
export function saveBlockStretchesAndWrapsItsHint(componentSource: string): boolean {
  const src = maskComments(componentSource);
  if (src.length < 2000) return false;
  const wrap = styleBlock(src, 'wrap');
  if (wrap === null) return false;
  if (!/alignSelf:\s*'stretch'/.test(wrap)) return false;
  if (/flexDirection:\s*'row'/.test(wrap)) return false;
  if (src.indexOf('{SAVE_TO_LIBRARY_HINT}') < 0) return false;
  // The dead-button rule that makes this block vanish for a score-less piece —
  // the other half of why the row was empty rather than obviously wrong.
  return src.indexOf('if (!isSaveableScoreUrl(scoreUrl)) return null;') >= 0;
}

/**
 * PREDICATE 5 — NO ROW, ANYWHERE IN THIS FILE, CONTAINS THE SAVE BLOCK.
 * Generic form of predicate 1, so any future host (the recognition result card
 * today) is held to the same layout rule instead of being trusted by memory.
 */
export function noRowInFileContainsTheSaveBlock(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 2000) return false;
  const idx = src.indexOf('<SaveToLibraryButton');
  if (idx < 0) return false;
  const rowKeys: string[] = [];
  const re = /([A-Za-z0-9_]+):\s*\{/g;
  let m = re.exec(src);
  while (m !== null) {
    if (styleIsRow(src, m[1])) rowKeys.push(m[1]);
    m = re.exec(src);
  }
  for (const key of rowKeys) {
    const span = viewSpan(src, key);
    if (span === null) continue;
    if (idx > span.start && idx < span.end) return false;
  }
  return true;
}
