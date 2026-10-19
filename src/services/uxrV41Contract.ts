/**
 * uxrV41Contract.ts — THE v41 SURFACE CONTRACTS (items 3 and 4).
 *
 * Two owner complaints from the v40 device pass are LAYOUT defects that no
 * behaviour test can see, so they are guarded by reading the app's own source —
 * the same pattern as uxr2's scan-viewport suite:
 *
 *  • ITEM 3, THE COVER-SCAN DEAD END (money path). The owner scanned a stylised
 *    cover ("Every Time I Think of You" by The Babys); the search box filled with
 *    the right words; the catalog said "No Match" — and the two licensed-retailer
 *    cards (SMD + Musicnotes, `external.visible === true`) were BUILT but laid out
 *    below the fold of a screen that could not scroll (the no-match block was
 *    `flex: 1`, the retailer frame was `flexGrow: 0, maxHeight: 340`). The money
 *    path existed and no user could reach it. The fix is ONE results scroller that
 *    holds the no-match block AND the retailer cards; these scanners prove it, and
 *    `noMatchStarvesRetailers` is the detector that returns TRUE on the old layout.
 *
 *  • ITEM 4, HOME'S "TODAY'S PIECE" (designer spec §1). The band read as an
 *    edge-to-edge divider rather than something you can open. It is now one card —
 *    358 × 92 dp, 16 dp side margins, radius 18, CARD fill + 1 dp CARD_LINE, a
 *    56 dp paper score tile, three type levels (eyebrow / title / composer), one
 *    SUB chevron — and the WHOLE card is the tap target. `todayCardMatchesSpec`
 *    reads those numbers out of the screen's own StyleSheet.
 *
 * PURE: no react, no react-native. Every function takes source text.
 */
import { maskSourceComments } from './audioFocusContract';

// ───────────────────────── §1 copy (designer spec, verbatim) ─────────────────

/** The card's eyebrow, exactly as the spec prints it (typographic apostrophe). */
export const TODAYS_PIECE_EYEBROW = 'TODAY\u2019S PIECE';
/** The title the card shows when the catalog holds no piece for today. */
export const TODAYS_PIECE_NO_PIECE_TITLE = 'Find a piece to practice';
/** The composer line in that state — the card's own destination, said plainly. */
export const TODAYS_PIECE_NO_PIECE_LINE =
  'Search the library — free scores, or the official sheet music';

// ───────────────────────── §1 geometry (designer spec) ───────────────────────

export const TODAY_CARD_SPEC = {
  /** Card width at 390 dp frame width, 16 dp side margins. */
  widthDp: 358,
  heightDp: 92,
  radius: 18,
  sideMarginDp: 16,
  tileDp: 56,
  eyebrowSize: 10,
  titleSize: 16,
  subSize: 12,
  chevronSize: 14,
  borderWidth: 1,
} as const;

/** Read one style block's numeric value out of a StyleSheet (name: { … }). */
export function styleValue(source: string, styleName: string, prop: string): string | null {
  const text = maskSourceComments(source);
  const key = `${styleName}: {`;
  const at = text.indexOf(key);
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  const close = matchingBrace(text, open);
  if (close < 0) return null;
  const body = text.slice(open, close);
  const match = new RegExp(`(?:^|[\\s{,])${prop}\\s*:\\s*('([^']*)'|"([^"]*)"|([-0-9.]+))`).exec(body);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

/** The index of the `}` that closes the `{` at `open` (quotes skipped). */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const ch = text.charAt(at);
    if (ch === '"' || ch === "'" || ch === '`') {
      const mark = ch;
      at += 1;
      while (at < text.length && text.charAt(at) !== mark) {
        if (text.charAt(at) === '\\') at += 1;
        at += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** The JSX of the Today's-Piece card: from its TouchableOpacity to its close tag. */
export function todayCardBlock(source: string): string {
  const text = maskSourceComments(source);
  const styleAt = text.indexOf('style={styles.todayCard}');
  if (styleAt < 0) return '';
  const open = text.lastIndexOf('<TouchableOpacity', styleAt);
  const close = text.indexOf('</TouchableOpacity>', styleAt);
  if (open < 0 || close < 0) return '';
  return text.slice(open, close + '</TouchableOpacity>'.length);
}

/**
 * ITEM 4's contract: the card is ONE tappable card built to spec §1 — the geometry
 * (radius 18, 92 dp tall, 16 dp side margins, 1 dp border, CARD fill + CARD_LINE),
 * the 56 dp paper tile, the three type levels, the chevron, and the eyebrow copy —
 * with no second tap target inside it (the chevron is decoration, the card is the
 * target) and no new colours (both themes come from the existing literals).
 */
export function todayCardMatchesSpec(source: string): boolean {
  const block = todayCardBlock(source);
  if (block.length === 0) return false;

  // The whole card is the tap: the ONE handler is on the card itself.
  if (block.indexOf('onPress={handleDailyChallengeTap}') < 0) return false;
  if (block.indexOf('{todayCardAccessibilityLabel(dailyChallenge)}') < 0) return false;
  // Inside: tile, eyebrow, title, composer, chevron — and no inner tap target.
  if (block.indexOf('styles.todayCardTile') < 0) return false;
  if (block.indexOf('{TODAYS_PIECE_EYEBROW}') < 0) return false;
  if (block.indexOf('styles.todayCardPiece') < 0) return false;
  if (block.indexOf('styles.todayCardComposer') < 0) return false;
  if (block.indexOf('styles.todayCardChevron') < 0) return false;
  if (block.indexOf('<TouchableOpacity') >= 0) return false;
  // ...and the CTA line that used to sit inside the band is gone with the band.
  if (block.indexOf('{todayCardCta(dailyChallenge)}') >= 0) return false;

  const spec = TODAY_CARD_SPEC;
  const number = (style: string, prop: string): number => {
    const raw = styleValue(source, style, prop);
    return raw === null ? Number.NaN : Number(raw);
  };
  // the card
  if (number('todayCard', 'borderRadius') !== spec.radius) return false;
  if (number('todayCard', 'minHeight') !== spec.heightDp) return false;
  if (number('todayCard', 'borderWidth') !== spec.borderWidth) return false;
  if (number('todayCard', 'marginHorizontal') !== spec.sideMarginDp) return false;
  if (styleValue(source, 'todayCard', 'backgroundColor') !== '#16213e') return false;
  if (styleValue(source, 'todayCard', 'borderColor') !== '#0f3460') return false;
  if (styleValue(source, 'todayCard', 'flexDirection') !== 'row') return false;
  // the paper tile
  if (number('todayCardTile', 'width') !== spec.tileDp) return false;
  if (number('todayCardTile', 'height') !== spec.tileDp) return false;
  if (styleValue(source, 'todayCardTile', 'backgroundColor') !== '#ffffff') return false;
  // the three type levels
  if (number('todayCardEyebrow', 'fontSize') !== spec.eyebrowSize) return false;
  if (styleValue(source, 'todayCardEyebrow', 'color') !== '#4ecdc4') return false;
  if (number('todayCardPiece', 'fontSize') !== spec.titleSize) return false;
  if (styleValue(source, 'todayCardPiece', 'color') !== '#ffffff') return false;
  if (number('todayCardComposer', 'fontSize') !== spec.subSize) return false;
  if (styleValue(source, 'todayCardComposer', 'color') !== '#a0a0b8') return false;
  // the affordance mark
  if (number('todayCardChevron', 'fontSize') !== spec.chevronSize) return false;
  if (styleValue(source, 'todayCardChevron', 'color') !== '#a0a0b8') return false;
  return true;
}

// ───────────────────── item 3: the no-match money path ──────────────────────

/**
 * ITEM 3's contract: the no-match block and the retailer section are children of
 * the SAME results scroller, the retailer render still hangs off `external.visible`
 * only (never off `status`), and the no-match block is a natural-height block — so
 * the retailer CTAs are reachable by scrolling on a zero-match query.
 */
export function noMatchSharesOneScrollerWithRetailers(source: string): boolean {
  const text = maskSourceComments(source);
  const noMatch = text.indexOf("status === 'empty'");
  const external = text.indexOf('<SearchExternalSection');
  if (noMatch < 0 || external < 0) return false;
  // The retailer section must still be gated on the query alone.
  const before = text.lastIndexOf('{external.visible', external);
  if (before < 0) return false;
  if (text.slice(before, external).indexOf('status') >= 0) return false;
  // The SAME scroller must open before the no-match block and close after it.
  const scroll = text.lastIndexOf('<ScrollView', external);
  if (scroll < 0 || scroll > noMatch) return false;
  const close = text.indexOf('</ScrollView>', external);
  if (close < 0) return false;
  const tag = text.slice(scroll, text.indexOf('>', scroll) + 1);
  if (tag.indexOf('styles.resultsScroll') < 0) return false;
  // The no-match block takes its natural height (never a flexible full-screen box).
  const block = text.slice(noMatch, external);
  if (block.indexOf('styles.stateBlock') < 0) return false;
  return block.indexOf('styles.center') < 0;
}

/**
 * THE PRE-FIX DETECTOR — TRUE on the layout the owner was given. It is what makes
 * the fix provable: the old screen had a `flex: 1` state box (which ate the whole
 * screen), a bounded retailer frame (`externalWrap` with a `maxHeight`), and no
 * shared scroller, so the retailer cards were laid out below the fold.
 */
export function noMatchStarvesRetailers(source: string): boolean {
  const text = maskSourceComments(source);
  const flexibleState = /center:\s*\{[^}]*flex:\s*1/.test(text);
  const noMatchUsesFlexibleBox = /status === 'empty'[\s\S]{0,240}?styles\.center/.test(text);
  const boundedRetailerFrame = /externalWrap:\s*\{[^}]*maxHeight/.test(text);
  const shared = noMatchSharesOneScrollerWithRetailers(source);
  return !shared || flexibleState || noMatchUsesFlexibleBox || boundedRetailerFrame;
}
