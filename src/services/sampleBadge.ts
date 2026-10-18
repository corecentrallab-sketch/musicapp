/**
 * sampleBadge.ts — the ONE place the SAMPLE / EXCERPT badge's words are decided
 * (UX round 1, step 1; owner 10-18 item 5, designer spec ux-round-1 §5).
 *
 * THE OWNER'S ASK. The app's built-in default score (the bundled four-bar Für
 * Elise) has to read as *"Sample · 4-bar excerpt"* so a teaching snippet is never
 * mistaken for a rendering bug.
 *
 * WHAT ALREADY EXISTED. `services/transposedScore.ts` derives the bar count from
 * the score itself (`sampleExcerptLabel`) and the reader/editor rendered that
 * label inline. This module turns that ONE derivation into the ONE badge copy
 * every surface shows, and it owns the part that is easy to get WRONG:
 *
 * THE HONEST-COPY RULE (binding — owner + lead, 10-18). The owner's fuller string
 * was *"Sample · 4-bar excerpt · tap for the full piece"*. That second half is a
 * claim about the world, not about the score, so it may appear ONLY where it is
 * really true. The three states below are the whole rule:
 *
 *   • `full-score-opens-on-tap`   → "… · tap for the full piece"
 *        A full (non-excerpt) score for this piece really exists in the app AND
 *        tapping the element that carries the badge opens it. Verified per
 *        surface, never assumed: the Home "Today" card passes this state only
 *        when `practiceTodayDestination()` resolves to 'sheet' — the same
 *        mapping the card's own tap uses, so the badge and the tap can never
 *        disagree.
 *
 *   • `nothing-fuller-in-library` → "… — this is the whole score in the free
 *        library"
 *        The surface HAS the catalog payload and it says the app hosts no score
 *        for this piece (`sheet_music_url` empty), so the bundled excerpt really
 *        is the whole score the free library holds for it. Evidence (live
 *        catalog, 10-18): Für Elise / Ode to Joy / Canon in D all report
 *        `sheet_music_available: false`; Air on the G String reports `true` —
 *        which is exactly why this state is never assumed from the score alone.
 *
 *   • `unverified` (the default, and the ONLY safe default)
 *        The surface cannot check the catalog at all (the notation editor, the
 *        full-score reader, a saved Library row — none of them may reach the
 *        network, see v39's no-network contract). Then the badge says only what
 *        the score itself proves: "… — a short excerpt, not the whole piece".
 *        Deliberately soft wording: claiming "the whole score in the free
 *        library" on a catalog-blind surface WOULD be false for a piece like the
 *        Air, where a full curated sheet exists and the bundled phrase is four
 *        bars.
 *
 * So this module can never emit a false "tap for the full piece", because that
 * clause is reachable only through a state that a surface must be able to prove.
 *
 * PURE: no react, no react-native, no fs, no network — compiled and run by
 * `tsconfig.tier1.json` and guarded by `scripts/sampleBadge.test.ts`.
 */
import { maskComments } from './modalBackContract';
import { practiceTodayDestination } from './homeCards';
import {
  SAMPLE_EXCERPT_FALLBACK_LABEL,
  SAMPLE_EXCERPT_MAX_BARS,
  countAbcBars,
  sampleExcerptLabel,
} from './transposedScore';

/** The clause that may ONLY appear where the tap really opens a full score. */
export const SAMPLE_BADGE_FULL_SCORE_ON_TAP_CLAUSE = ' · tap for the full piece';

/** The clause for a surface that knows the app hosts no fuller score. */
export const SAMPLE_BADGE_WHOLE_LIBRARY_CLAUSE =
  ' — this is the whole score in the free library';

/** The clause for a surface that cannot check the catalog — makes no library claim. */
export const SAMPLE_BADGE_EXCERPT_ONLY_CLAUSE = ' — a short excerpt, not the whole piece';

/**
 * What the SURFACE knows about a fuller score for this piece. Named for what it
 * has been proven to know, not for what the piece might have.
 */
export type SampleLibraryState =
  | 'full-score-opens-on-tap'
  | 'nothing-fuller-in-library'
  | 'unverified';

/** The default state: no catalog payload, so no library claim is made. */
export const SAMPLE_LIBRARY_STATE_UNVERIFIED: SampleLibraryState = 'unverified';

/**
 * The badge's text — DERIVED FROM THE SCORE, never passed in.
 *
 * `abc` is the score text itself (the ONLY way words reach this function);
 * `isSample` is the caller's own sample assertion (the reader carries it in its
 * route params — it comes from `isSampleScore` at the editor's door) and is
 * undefined on the surfaces that decide purely from the score; `libraryState` is
 * the honest-copy switch above. Returns null when there is nothing to badge: the
 * score is empty, unreadable, or longer than the excerpt limit.
 */
export function sampleBadgeLabel(input: {
  abc: unknown;
  isSample?: boolean;
  libraryState?: SampleLibraryState | null;
}): string | null {
  // The caller's flag can only NARROW what the score proves: it suppresses the
  // badge (`isSample: false`), supplies the fallback wording when the score's bar
  // count cannot be read, and NEVER badges a work the score itself measures past
  // the excerpt limit. The number in the words always comes from the score.
  if (input?.isSample === false) return null;
  const bars = countAbcBars(input?.abc);
  if (bars > 0 && bars > SAMPLE_EXCERPT_MAX_BARS) return null;
  const base =
    input?.isSample === true
      ? sampleExcerptLabel(input?.abc) ?? SAMPLE_EXCERPT_FALLBACK_LABEL
      : sampleExcerptLabel(input?.abc);
  if (base === null) return null;
  switch (input?.libraryState) {
    case 'full-score-opens-on-tap':
      return base + SAMPLE_BADGE_FULL_SCORE_ON_TAP_CLAUSE;
    case 'nothing-fuller-in-library':
      return base + SAMPLE_BADGE_WHOLE_LIBRARY_CLAUSE;
    default:
      return base + SAMPLE_BADGE_EXCERPT_ONLY_CLAUSE;
  }
}

// ─── The per-surface honest state ──────────────────────────────

/** The slice of a daily-challenge / piece payload the state reads. */
export interface SamplePieceLike {
  sheetMusicUrl?: string | null;
}

/**
 * The Home "Today" card's state. TRUE only when the card's OWN tap opens the full
 * score: `practiceTodayDestination()` is the reader of that card's tap, so this
 * cannot drift from where the tap really goes ('sheet' → the sheet reader;
 * 'piece' / 'find-piece' → no full score is opened on tap).
 */
export function featuredPieceLibraryState(
  challenge: SamplePieceLike | null | undefined,
): SampleLibraryState {
  return practiceTodayDestination(challenge) === 'sheet'
    ? 'full-score-opens-on-tap'
    : 'nothing-fuller-in-library';
}

/**
 * A piece page's state. The page carries the catalog payload, so it can tell:
 * a non-blank curated score URL means the page's own sheet control opens the full
 * piece, and none means the app hosts nothing fuller. A blank/whitespace URL is
 * NOT a score (the same honesty rule the catalog parser applies).
 */
export function piecePageLibraryState(
  piece: SamplePieceLike | null | undefined,
): SampleLibraryState {
  const url = piece?.sheetMusicUrl;
  return typeof url === 'string' && url.trim().length > 0
    ? 'full-score-opens-on-tap'
    : 'nothing-fuller-in-library';
}

// ─── Source-scan guards (a surface cannot silently drop the badge) ──

/**
 * The props a badge must never accept, because they would be the words themselves:
 * a JSX prop (`label={…}`) or a declared field (`label?: string`). `abcText` or
 * `title` are not in the list — the rule is about the COPY, not about naming.
 */
const FORBIDDEN_WORD_PROPS = /(?:^|[\s{])(label|text|copy|words)\s*\??\s*[:=]/;

/**
 * Every `<SampleBadge … />` element in a source, comments blanked out first so a
 * commented-out badge is not a badge. A JSX element without an explicit closing
 * `>` is dropped (a scan that guesses is worse than one that reports nothing).
 */
export function sampleBadgeBlocks(source: unknown): string[] {
  if (typeof source !== 'string' || source.length === 0) return [];
  const masked = maskComments(source);
  const blocks: string[] = [];
  let at = masked.indexOf('<SampleBadge');
  while (at >= 0) {
    const end = masked.indexOf('>', at);
    if (end < 0) break;
    blocks.push(masked.slice(at, end + 1));
    at = masked.indexOf('<SampleBadge', end + 1);
  }
  return blocks;
}

/**
 * True when this surface really renders the shared badge, fed the SCORE (`abc=`).
 * A badge with no score prop could not derive its words — so it is not one.
 */
export function sampleBadgeIsRenderedOn(source: unknown): boolean {
  return sampleBadgeBlocks(source).some((block) => /\babc\s*=/.test(block));
}

/**
 * True when this surface renders a badge AND passes it no copy: no `label=`,
 * `text=`, `copy=` or `words=` prop anywhere in any badge element. This is the
 * "the badge text is derived from the score, never passed as a string" rule.
 */
export function sampleBadgeTakesNoCopy(source: unknown): boolean {
  const blocks = sampleBadgeBlocks(source);
  if (blocks.length === 0) return false;
  return blocks.every((block) => !FORBIDDEN_WORD_PROPS.test(block));
}

/**
 * True when the badge COMPONENT itself derives its words: it builds them through
 * the shared pure module and declares no copy prop of its own.
 */
export function sampleBadgeDerivesItsWords(componentSource: unknown): boolean {
  if (typeof componentSource !== 'string') return false;
  const masked = maskComments(componentSource);
  if (masked.length < 800) return false;
  if (masked.indexOf('sampleBadgeLabel(') < 0) return false;
  if (masked.indexOf("import { Ionicons }") < 0) return false;
  // The props interface must not offer a way to pass the words in.
  const propsAt = masked.indexOf('interface SampleBadgeProps');
  if (propsAt < 0) return false;
  const propsEnd = masked.indexOf('}', propsAt);
  if (propsEnd < 0) return false;
  return !FORBIDDEN_WORD_PROPS.test(masked.slice(propsAt, propsEnd));
}

/**
 * True when a surface renders the badge with an EXPLICIT honest state, i.e. the
 * state is computed (through this module's per-surface helpers) rather than left
 * on the safe default of a surface that could prove more. Used for the two
 * catalog-carrying surfaces (Home's Today card, the piece page).
 */
export function sampleBadgeStatesItsLibraryState(
  source: unknown,
  stateFnName: string,
): boolean {
  return sampleBadgeBlocks(source).some(
    (block) =>
      typeof stateFnName === 'string' &&
      stateFnName.length > 0 &&
      block.indexOf(`libraryState={${stateFnName}(`) >= 0,
  );
}
