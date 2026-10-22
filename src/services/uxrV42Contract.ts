/**
 * uxrV42Contract.ts — THE v42 FIX-BATCH CONTRACTS (owner, v41 on-device pass 10-20).
 *
 * Four complaints, each a defect in a SURFACE (layout, colour, a control that
 * cannot honestly work, a query that ran without the user), so each is guarded by
 * reading the app's own source — the same pattern as uxrV41Contract and the
 * uxr2 scan-viewport suite. Every detector returns TRUE ON THE PRE-FIX CODE, which
 * is what makes the suite bite (see scripts/uxr-v42-fixes.test.ts, and the
 * mutation-probe evidence in /home/team/shared/v42-fixes-evidence/).
 *
 *  • A — TRANSPOSED FULL SCORE, "ONLY 4 BARS AGAIN". The full-score READER was
 *    fixed in UX round 1 (a reported height is a measurement, not a box), but the
 *    notation EDITOR's own score card still grew from `abcScoreContainerHeight` —
 *    the app's 4000px BOX ceiling — while the viewer stayed non-interactive, so
 *    anything below the ceiling was unreachable on that surface. It now takes the
 *    same `wholeWork` band the reader uses and applies no height of its own.
 *  • B — BLACK NOTES + A ONE-BAR TAKE. The take's staff painted itself with DARK
 *    palette literals passed as PROPS (the theme remapper only repaints
 *    StyleSheets) — a black block in light mode — and its box was a FIXED 132px
 *    with `overflow: hidden`, so any take was clipped to about one bar. The paper
 *    and ink are now the palette in services/takeStaffPalette.ts (asserted legible
 *    against each other), and the box is a FLOOR the viewer grows into.
 *  • C — THE SCANNED SCORE'S DEAD CONTROLS. A raw photo has no notes the app can
 *    read (no OMR), no score following and no audio, so BPM auto-scroll there could
 *    only ever turn pages on a timer blind to the music. The honest-scope rule
 *    says such a control must not pretend: it is removed from that surface and the
 *    reason is stated. The PDF reader keeps it (real pages, and the presets were
 *    built for it).
 *  • D — THE OCR PREFILL. A scanned read was written into the query field and the
 *    debounced search ran on the first frame, so garbage ("a-thy,Be-cause I'm
 *    Freddie Mercury") became an invisible auto-query and a "No Match". A read is
 *    now a PROPOSAL (services/ocrPrefill.ts): visible, editable, and never searched
 *    until the user acts.
 *
 * PURE: no react, no react-native, no fs. Every function takes source text.
 */
import { maskSourceComments } from './audioFocusContract';
import { MIN_LEGIBLE_CONTRAST, contrastRatio, relativeLuminance } from './inkContrast';
import {
  TAKE_STAFF_CLEANED_INK,
  TAKE_STAFF_PAPER,
  TAKE_STAFF_RAW_INK,
} from './takeStaffPalette';

// ─────────────────────────────── helpers ─────────────────────────────────────

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

/** One StyleSheet block's body (`staffBox: { … }`), comments masked, or null. */
export function styleBlock(source: string, styleName: string): string | null {
  const text = maskSourceComments(source);
  const at = text.indexOf(`${styleName}: {`);
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  const close = matchingBrace(text, open);
  if (close < 0) return null;
  return text.slice(open, close);
}

/** A fixed `height:` in a style block (NOT minHeight/maxHeight), or null. */
export function fixedHeightOf(source: string, styleName: string): string | null {
  const block = styleBlock(source, styleName);
  if (block === null) return null;
  const match = /(?:^|[\s{,])height\s*:\s*([-0-9.]+|[A-Za-z_][\w.]*)/.exec(block);
  return match ? match[1] : null;
}

/** Whether a style block sets `minHeight`. */
export function hasMinHeight(source: string, styleName: string): boolean {
  const block = styleBlock(source, styleName);
  if (block === null) return false;
  return /(?:^|[\s{,])minHeight\s*:/.test(block);
}

/**
 * EVERY `<AbcScoreView …>` opening tag in a source (v43 slice 3).
 *
 * The editor mounts more than one staff since the full-screen window landed (the
 * page staff + the window's), so a "the score has the band" rule has to iterate
 * the tags instead of testing the file for one lucky match. Attribute slices stop
 * at the tag's own `>`, so a prop on one staff can never vouch for another.
 */
export function abcScoreStaffTags(source: string): string[] {
  const tags: string[] = [];
  const needle = '<AbcScoreView';
  let at = source.indexOf(needle);
  while (at >= 0) {
    const end = source.indexOf('>', at);
    if (end < 0) break;
    tags.push(source.slice(at, end + 1));
    at = source.indexOf(needle, end + 1);
  }
  return tags;
}

// ─────────────────────── FIX A — the editor's score card ─────────────────────

/**
 * THE PRE-FIX PATTERN, and the reason this fix exists: the notation editor grows
 * its score card from a measurement that has ALREADY been clamped to the app's
 * 4000px BOX ceiling. True for any source that caps the score it shows — the
 * pre-fix editor was exactly this.
 */
export function editorScorePreClampsBox(source: string): boolean {
  const masked = maskSourceComments(source);
  if (masked.indexOf('abcScoreContainerHeight') >= 0) return true;
  if (masked.indexOf('clampScoreHeight') >= 0) return true;
  if (masked.indexOf('ABC_SCORE_MAX_HEIGHT') >= 0) return true;
  // A literal 4000 cap applied to a score height, however it is spelled.
  if (/Math\.min\(\s*4000/.test(masked)) return true;
  return false;
}

/**
 * THE FIXED CONTRACT for the editor's score card: the SAME whole-work band the
 * full-score reader uses, applied to the transposed ABC, and NO height of its own
 * (so it cannot pre-cap the score again).
 */
export function editorScoreIsWholeWork(source: string): boolean {
  const masked = maskSourceComments(source);
  if (masked.length < 2000) return false;
  if (editorScorePreClampsBox(source)) return false;
  // Every viewer this screen mounts is handed the transposed score WITH the
  // whole-work band. v43 slice 3 (item E) made that a PER-INSTANCE rule: the editor
  // now renders a second <AbcScoreView> inside the full-screen window, so a
  // surviving band on one staff must not excuse a bandless one on the other (the
  // bandless staff is the clip this fix exists for, whichever surface it is on).
  const staves = abcScoreStaffTags(masked);
  if (staves.length < 1) return false;
  if (!staves.every((tag) => /\sabc=\{transposedAbc\}/.test(tag) && /\swholeWork\b/.test(tag))) {
    return false;
  }
  // …and the editor never applies a measured height of its own.
  if (masked.indexOf('onDocumentHeight') >= 0) return false;
  if (masked.indexOf('scoreHeight') >= 0) return false;
  return true;
}

// ──────────────────────── FIX B — the take's staff ───────────────────────────

/**
 * THE PAPER/INK PAIR IS LEGIBLE — measured, not eyeballed (v42 fix B1). True only
 * when the take's paper is a LIGHT surface and BOTH inks clear WCAG AA on it.
 * The pre-fix pair (raw #9aa0b4 on the dark palette's #16213e) is what the owner
 * described as "notes invisible on a black screen"; this predicate is the rule
 * that stops a palette edit from putting them back there.
 */
export function takeStaffPaletteIsLegible(): boolean {
  const paper = relativeLuminance(TAKE_STAFF_PAPER);
  if (paper === null || paper < 0.5) return false;
  const raw = contrastRatio(TAKE_STAFF_RAW_INK, TAKE_STAFF_PAPER);
  const cleaned = contrastRatio(TAKE_STAFF_CLEANED_INK, TAKE_STAFF_PAPER);
  if (raw === null || cleaned === null) return false;
  return raw >= MIN_LEGIBLE_CONTRAST && cleaned >= MIN_LEGIBLE_CONTRAST;
}

/** The two ratios, for the report (raw first, cleaned second). */
export function takeStaffContrast(): { raw: number | null; cleaned: number | null } {
  return {
    raw: contrastRatio(TAKE_STAFF_RAW_INK, TAKE_STAFF_PAPER),
    cleaned: contrastRatio(TAKE_STAFF_CLEANED_INK, TAKE_STAFF_PAPER),
  };
}

/**
 * THE PRE-FIX COLOUR PATTERN: the card owns DARK palette literals and hands one to
 * the renderer as a prop, where the app's theme remapper cannot reach it. True for
 * the pre-fix TakeStaffCard.
 */
export function takeStaffPaintsDarkLiterals(source: string): boolean {
  const masked = maskSourceComments(source);
  // The pre-fix card imported the DARK palette and passed its `surface` as the
  // renderer's paper — a prop the theme remapper can never repaint.
  return masked.indexOf('DARK_THEME') >= 0;
}

/** The card takes its paper/ink from the shared palette module (v42 fix B1). */
export function takeStaffUsesThePalette(source: string): boolean {
  const masked = maskSourceComments(source);
  if (masked.length < 1500) return false;
  if (masked.indexOf("'../services/takeStaffPalette'") < 0) return false;
  if (masked.indexOf('DARK_THEME') >= 0) return false;
  return true;
}

/**
 * THE PRE-FIX CLIP (v42 fix B2): the staff sits in a FIXED-height box with
 * `overflow: 'hidden'`, so a take of any length is drawn into ~one bar. True for
 * the pre-fix card (`height: STAFF_HEIGHT`, 132).
 */
export function takeStaffClipsToOneBar(source: string): boolean {
  const fixed = fixedHeightOf(source, 'staffBox');
  if (fixed !== null) return true;
  const block = styleBlock(source, 'staffBox');
  if (block !== null && /overflow\s*:\s*'hidden'/.test(block) && !hasMinHeight(source, 'staffBox')) {
    return true;
  }
  return false;
}

/**
 * THE FIXED CONTRACT (v42 fix B2): the box is a FLOOR, and the viewer is
 * NON-interactive by default so it measures its own document and grows the box to
 * the whole take.
 */
export function takeStaffShowsTheWholeTake(source: string): boolean {
  const masked = maskSourceComments(source);
  if (masked.length < 1500) return false;
  if (takeStaffClipsToOneBar(source)) return false;
  if (!hasMinHeight(source, 'staffBox')) return false;
  if (!/interactive\s*=\s*false/.test(masked)) return false;
  // Both rows still go through the shared renderer.
  if ((masked.match(/<AbcScoreView/g) || []).length < 2) return false;
  return true;
}

// ───────────────────── FIX C — the scanned score's controls ───────────────────

/**
 * THE PRE-FIX SURFACE (v42 fix C): a scanned page — a photo with no notes the app
 * can read — offering the BPM auto-scroll control and its Play/pause toggle.
 * True for the pre-fix ScannedViewerScreen.
 */
export function scannedViewerHasDeadControls(source: string): boolean {
  const masked = maskSourceComments(source);
  if (masked.indexOf('AutoScrollControl') >= 0) return true;
  if (masked.indexOf('useAutoScroll') >= 0) return true;
  if (masked.indexOf('usePageTurnSpeed') >= 0) return true;
  if (/accessibilityLabel=\{[^}]*'Start auto-scroll'/.test(masked)) return true;
  return false;
}

/** The surface states why there is no auto-scroll (the reason cannot be lost). */
export function scannedViewerExplainsNoAutoScroll(source: string): boolean {
  const masked = maskSourceComments(source);
  if (masked.indexOf('SCANNED_NO_AUTOSCROLL_LINE') < 0) return false;
  // It must be RENDERED, not merely declared.
  const renders = masked.indexOf('<Text style={styles.autoScrollNote}>{SCANNED_NO_AUTOSCROLL_LINE}</Text>');
  return renders >= 0;
}

/**
 * THE POSITIVE CONTROL for fix C: the PDF reader KEEPS the auto-scroll control.
 * The scanned surface lost it because a photo cannot be followed; a PDF the app
 * lays out itself is a different surface, and the page-turn presets were built for
 * it. If this ever goes false, fix C removed the feature instead of moving it.
 */
export function pdfViewerKeepsAutoScroll(source: string): boolean {
  const masked = maskSourceComments(source);
  return masked.indexOf('<AutoScrollControl') >= 0 && masked.indexOf('useAutoScroll') >= 0;
}

// ─────────────────────── FIX D — the OCR prefill ─────────────────────────────

/**
 * THE PRE-FIX PATTERN (v42 fix D): the query is seeded straight from the caller
 * and the debounced search has no gate, so a read-from-a-photo string becomes an
 * invisible auto-query. True for the pre-fix FindPieceScreen.
 */
export function ocrPrefillAutoSearches(source: string): boolean {
  const masked = maskSourceComments(source);
  if (/useState\(\s*initialQuery\s*\?\?\s*''\s*\)/.test(masked)) return true;
  if (masked.indexOf('prefillPending') < 0) return true;
  // The gate must sit BEFORE the request is scheduled (before the debounce).
  const gateAt = masked.indexOf('if (prefillPending)');
  const debounceAt = masked.indexOf('setTimeout(');
  if (gateAt < 0) return true;
  if (debounceAt >= 0 && gateAt > debounceAt) return true;
  return false;
}

/** THE FIXED CONTRACT: a read is a proposal — visible, editable, never auto-run. */
export function ocrPrefillIsExplicit(source: string): boolean {
  const masked = maskSourceComments(source);
  if (masked.length < 2000) return false;
  if (ocrPrefillAutoSearches(source)) return false;
  if (masked.indexOf('initialOcrPrefillState(') < 0) return false;
  // The one control that turns the proposal into a search, rendered and labelled.
  if (masked.indexOf('{OCR_PREFILL_SEARCH_CTA}') < 0) return false;
  if (masked.indexOf('onPress={handleSubmitPrefill}') < 0) return false;
  // The field stays EDITABLE — a prefill the user cannot correct is not honest.
  if (masked.indexOf('onChangeText={setQuery}') < 0) return false;
  // …and the waiting state is rendered instead of a "No match" for a read nobody
  // searched.
  if (masked.indexOf("{status === 'prefill'") < 0) return false;
  return true;
}
