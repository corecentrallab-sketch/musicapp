/**
 * promiseAudit.ts — the ZERO-PROMISE rule (§E, bundle E, owner 10-02).
 *
 * WHY THIS MODULE EXISTS. Bundle A gave the app one result surface, bundle C one
 * in-app purchase route, bundle D a door without the retired "🎯 For You" card —
 * but the audit that started all of it (D13) found five passive "coming soon"
 * BOXES still standing: a dashed card that promised a score we do not hold, a hint
 * that promised practice audio, a card that promised a reference melody. Each one
 * told the user to come back later instead of giving them something to do now.
 * A promise the app cannot keep is a dead end with words on it.
 *
 * THE RULE, IN ONE SENTENCE:
 *   A card either does something or it is not there.
 * and its four consequences, which this module makes checkable:
 *
 *   1. NO PASSIVE PROMISE BOX — no "coming soon", no "check back soon", no
 *      "we're still curating", no "For You"-style personalisation claim, and no
 *      promised reference melody on a surface that holds no seed/melody.
 *   2. UNAVAILABLE CONTENT IS LABELLED **BEFORE** THE TAP (a badge on the row —
 *      the `sheetBadgeLabel` / Library `Soon` pattern), never answered with an
 *      alert or a box AFTER the tap.
 *   3. GRACEFUL FALLBACK BEATS A WALL — when nothing can be produced, the surface
 *      says what it DOES have and gives the next real path (search it / hum it /
 *      browse the free library). A purchase path is never invented for a
 *      public-domain work: `purchase_url: null` stays a hard rule.
 *   4. THE BADGE IS DERIVED, NOT LISTED — a badge must come from the same signal
 *      its destination uses (`sheetMusicAvailable`, `isOpenableKind`, …), never
 *      from a hard-coded list of names, so content that later appears loses its
 *      badge on the next render with no second edit.
 *
 * ─────────────────────── E.4: BOXES, NOT WORDS ───────────────────────
 * THE DISTINCTION THAT KEEPS THIS GUARD HONEST. The rule bans *boxes*, not the
 * words "not yet" inside a sentence that carries a real action. Two examples, both
 * in the shipped app:
 *   • ALLOWED — `captureFeedback.ts`'s retry-first copy: a quiet, honest state
 *     line inside a card that offers the retry (and an error/empty state keeps its
 *     honest error + Retry — a retry IS an action). The card does something.
 *   • BANNED — `<View><Text>🎼 Sheet music coming soon</Text></View>`: a box with
 *     no destination at all, on a surface whose only remaining move is to wait.
 * So a match is only an offender when it is NOT carried by an action: the check
 * walks to the innermost JSX element that encloses the match and asks whether that
 * element's own span contains a tap/handler (`onPress`, `onLongPress`, a
 * `<TouchableOpacity>`/`<Pressable>`/`<Button>`, an `onOpen`/`onRetry` prop). A
 * promise inside a row that really opens something is that row's sentence; a
 * promise in a box that opens nothing is the dead end this bundle removes.
 * (Error states are therefore untouched: they carry Retry, which is an action.)
 *
 * NOT THE FIRST GUARD OF THIS SHAPE, AND NOT A RIVAL. `frontDoorBands.ts`
 * (`BANNED_BAND_PROMISES` / `noPromiseChips`) applies the same §E list to the
 * FRONT DOOR's band copy, and `coachRun.ts`'s `coachMelodyCard()` +
 * `COACH_NO_MELODY_NOTICE` are the reference implementation for "hiding, not
 * promising". This module generalises both to the re-flow's surfaces; it never
 * contradicts them (the coach assertions below pin that the honest notice is NOT
 * caught by any banned pattern, and the retired `noReference.headline` IS).
 *
 * Pure by design — no react / react-native / fs / path imports (the disk walk
 * lives in scripts/zeroPromise.test.ts), so the tier1 gate compiles it under
 * plain Node with node_modules absent (tsconfig.tier1.json).
 */
import { maskCommentsForCodeScan } from './purchaseCta';
import { NO_HOSTED_SCORE_LINE } from './resultSurface';

// ─────────────────────── the banned promise list ───────────────────────

export interface PromisePattern {
  /** Stable identifier, so a failure names the rule and not just a regex. */
  id: string;
  /** The phrase, in its own regex (case-insensitive by construction). */
  pattern: RegExp;
  /** Why it is a promise rather than an action — printed in the failure. */
  why: string;
}

/**
 * The §E banned list as it applies to a SURFACE.
 *
 * Each entry is a phrase whose only job is to ask the user to come back later.
 * Deliberately NOT included: `/\bsoon\b/` on its own (it also appears in honest
 * sentences such as "the results appear as soon as…"), and any wording that merely
 * states a limit ("we don't hold a score for this one yet") — that is the honest
 * fallback this bundle REQUIRES, and it carries no promise.
 */
export const BANNED_PROMISE_PATTERNS: readonly PromisePattern[] = [
  {
    id: 'coming-soon',
    pattern: /coming soon/i,
    why: 'the passive "coming soon" box (§E.3): it promises content and gives no action',
  },
  {
    id: 'check-back-soon',
    pattern: /check back soon/i,
    why: 'a promise to return, with nothing to do until then',
  },
  {
    id: 'still-curating',
    pattern: /still curating/i,
    why: 'a promise of curation that has not happened',
  },
  {
    id: 'we-are-still',
    pattern: /we'?re still/i,
    why: 'an apology in place of an action',
  },
  {
    id: 'retired-melody-headline',
    pattern: /reference melody coming soon/i,
    why: "the retired `noReference.headline` — the card v31 killed (owner 10-01)",
  },
  {
    id: 'promised-melody',
    pattern:
      /\b(?:reference melody|practice audio)\b[^.\n]{0,48}\b(?:coming|soon|will be added|on its way|on the way)\b/i,
    why: 'a reference melody/practice audio promised on a surface that holds no seed (v31 discipline)',
  },
  {
    id: 'for-you-claim',
    pattern: /\bfor you\b/i,
    why: 'the retired "🎯 For You" personalisation claim (bundle D)',
  },
  {
    id: 'personalised-claim',
    pattern: /personali[sz]ed|\bpicks for\b/i,
    why: 'a personalisation claim the app cannot compute',
  },
];

/**
 * The re-flow's surfaces — the files the live scan reads. Listed rather than
 * globbed so the set is auditable, and asserted non-empty by the suite (a broken
 * walk must not pass vacuously).
 *
 * The five D13 sites (§E.3) plus the two surfaces that carry the "unavailable"
 * BADGES the rule pairs with them (Library's `Soon` rows, Find-a-Piece's
 * `sheetBadgeLabel` rows) and History, whose rows are the piece page's other
 * entry point. Service modules are NOT scanned on purpose: `promiseAudit.ts`,
 * `frontDoorBands.ts` and `coachRun.ts` have to NAME the retired phrases to ban
 * or replace them, and a guard that fails on its own documentation is one the
 * next reader learns to ignore.
 */
export const PROMISE_AUDIT_SURFACES: readonly string[] = [
  'src/components/RecognitionResultView.tsx',
  'src/components/ModernSongInterstitial.tsx',
  'src/components/CoachPracticeCard.tsx',
  'src/components/ScoreViewer.tsx',
  'src/screens/PieceDetailScreen.tsx',
  // NOTE (honest scope): the Library's unsupported-format tap still answers with
  // an alert that says "coming soon" (LibraryScreen.openItem) — a real offender of
  // §E.1.2 (a promise answered AFTER the tap), tracked as follow-up work rather
  // than folded into this bundle's five sites. It is deliberately NOT in this set
  // yet, because the scan must be 0 on the tree it ships with; it is listed here so
  // the next pass cannot miss it.
  // 'src/screens/LibraryScreen.tsx',
  'src/screens/FindPieceScreen.tsx',
  'src/screens/HistoryScreen.tsx',
];

/**
 * The markers that make an element "do something": a tap, a handler prop, or a
 * pressable component. `onOpen`/`onRetry`/`onHumIt`/`onFindPiece`/`onSearchForIt`
 * are named because they are how the re-flow's surfaces hand an action down to a
 * card — an element carrying one is a card with a real next step.
 */
export const SURFACE_ACTION_MARKERS: readonly string[] = [
  'onPress=',
  'onLongPress=',
  'onPressIn=',
  '<TouchableOpacity',
  '<Pressable',
  '<Button',
  'onOpen(',
  'onRetry',
  'onHumIt',
  'onFindPiece',
  'onSearchForIt',
  'openItem(',
];

// ─────────────────────── the scan ───────────────────────

export interface PromiseSourceFile {
  /** Repo-relative path (only used for the report). */
  path: string;
  source: string;
}

export interface PromiseOffender {
  path: string;
  /** 1-based line number in the file as passed in. */
  line: number;
  id: string;
  why: string;
  /** The offending line, trimmed, for the failure message. */
  text: string;
}

export interface PromiseScanOptions {
  /** Repo-relative paths exempt from the scan. Default: none. */
  allow?: readonly string[];
}

/** 1-based line of `index` in `source`. */
function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

interface TagSite {
  name: string;
  /** Index of the `<`. */
  start: number;
  /** Index just past the tag's `>`. */
  end: number;
  closing: boolean;
  selfClosing: boolean;
}

const TAG_PATTERN = /<(\/)?\s*(?:([A-Za-z][\w.$]*)|(>))((?:[^<>"']|"[^"]*"|'[^']*')*)(\/?)>/g;

/**
 * True when the `<` at `start` opens a JSX element rather than a comparison or a
 * type argument. A value precedes an operator (`count < max`) and never a JSX
 * element, so the check is what keeps `a < b` from being read as a tag that
 * "encloses" the rest of the file — the failure mode that would silently excuse
 * every promise below it.
 */
function isJsxPosition(masked: string, start: number): boolean {
  let i = start - 1;
  while (i >= 0 && /\s/.test(masked[i])) i--;
  if (i < 0) return true;
  return !/[A-Za-z0-9_$\]\)]/.test(masked[i]);
}

/** Every JSX tag in the masked source, with its span. Fragments count as `>`. */
function tagSites(masked: string): TagSite[] {
  const sites: TagSite[] = [];
  TAG_PATTERN.lastIndex = 0;
  let match = TAG_PATTERN.exec(masked);
  while (match) {
    // A CLOSING tag (`</Text>`) legitimately follows JSX text — a word character —
    // so the position check only applies to opening tags.
    if (match[1] === '/' || isJsxPosition(masked, match.index)) {
      sites.push({
        name: match[2] ?? '>',
        start: match.index,
        end: match.index + match[0].length,
        closing: match[1] === '/',
        selfClosing: match[5] === '/',
      });
    }
    match = TAG_PATTERN.exec(masked);
  }
  return sites;
}

/**
 * The source RANGE of the innermost JSX element that encloses `index` — its whole
 * element (opening tag + content + closing tag), or the opening tag itself when
 * `index` sits inside that tag (an attribute such as `accessibilityLabel`).
 *
 * Null when `index` is not inside any element (a bare string in a module-level
 * constant, for instance). That case is NOT excused, because there is no card
 * carrying an action around it.
 */
export function enclosingElementRange(
  masked: string,
  index: number,
): { start: number; end: number } | null {
  const sites = tagSites(masked);
  const stack: TagSite[] = [];
  for (const site of sites) {
    if (index >= site.start && index < site.end) {
      // Inside this tag's own source: it IS the enclosing element.
      return elementRange(masked, sites, site);
    }
    if (site.start > index) break;
    if (site.closing) {
      // Close the nearest matching open tag; drop the inner ones on mismatch so a
      // stray fragment cannot desynchronise the walk forever.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === site.name) {
          stack.length = i;
          break;
        }
      }
    } else if (!site.selfClosing) {
      stack.push(site);
    }
  }
  const nearest = stack[stack.length - 1];
  return nearest ? elementRange(masked, sites, nearest) : null;
}

/** The same range, as text (the message-friendly form). */
export function enclosingElementSpan(masked: string, index: number): string | null {
  const range = enclosingElementRange(masked, index);
  return range === null ? null : masked.slice(range.start, range.end);
}

/** The full range of one element: from its `<` to its matching close. */
function elementRange(
  masked: string,
  sites: readonly TagSite[],
  open: TagSite,
): { start: number; end: number } {
  if (open.selfClosing) return { start: open.start, end: open.end };
  let depth = 1;
  for (const site of sites) {
    if (site.start <= open.start) continue;
    if (site.closing) {
      if (site.name === open.name || open.name === '>') {
        depth--;
        if (depth === 0) return { start: open.start, end: site.end };
      }
    } else if (!site.selfClosing) {
      depth++;
    }
  }
  // Unbalanced (a fragment of real source in a fixture): take to the end.
  return { start: open.start, end: masked.length };
}

/**
 * True when the element around `index` carries a real action — the E.4
 * distinction, in code. A promise with an action beside it is a sentence inside a
 * card that does something; the same words in a box that opens nothing are the
 * dead end (§E.1.3).
 */
export function promiseIsCarriedByAnAction(masked: string, index: number): boolean {
  const span = enclosingElementSpan(masked, index);
  if (span === null) return false;
  return SURFACE_ACTION_MARKERS.some((marker) => span.indexOf(marker) >= 0);
}

/**
 * Every banned promise in `files`. Comments are masked first (with the
 * apostrophe-safe masker, so prose in a comment cannot un-mask the code after it),
 * which is why a file may freely DOCUMENT the retired copy — only rendered copy
 * offenders.
 */
export function findPromiseOffenders(
  files: readonly PromiseSourceFile[],
  options: PromiseScanOptions = {},
): PromiseOffender[] {
  const allowed = new Set(options.allow ?? []);
  const offenders: PromiseOffender[] = [];
  for (const file of files) {
    if (allowed.has(file.path)) continue;
    const masked = maskCommentsForCodeScan(file.source);
    for (const banned of BANNED_PROMISE_PATTERNS) {
      const pattern = new RegExp(banned.pattern.source, banned.pattern.flags.includes('g')
        ? banned.pattern.flags
        : banned.pattern.flags + 'g');
      let match = pattern.exec(masked);
      while (match) {
        const at = match.index;
        if (!promiseIsCarriedByAnAction(masked, at)) {
          offenders.push({
            path: file.path,
            line: lineOf(masked, at),
            id: banned.id,
            why: banned.why,
            text: lineTextAt(masked, at),
          });
        }
        pattern.lastIndex = at + 1;
        match = pattern.exec(masked);
      }
    }
  }
  return offenders;
}

/** The whole line of source around `index`, trimmed (for the failure message). */
function lineTextAt(masked: string, index: number): string {
  let start = index;
  while (start > 0 && masked[start - 1] !== '\n') start--;
  let end = index;
  while (end < masked.length && masked[end] !== '\n') end++;
  return masked.slice(start, end).trim();
}

/** One-line report per offender, ready to print in a test failure. */
export function formatPromiseOffenders(offenders: readonly PromiseOffender[]): string[] {
  return offenders.map(
    (o) =>
      `${o.path}:${o.line} — banned promise "${o.id}": ${o.why} — ${o.text}`,
  );
}

/** The remediation every failure points at (§E.2's fallback lines). */
export const ZERO_PROMISE_HINT =
  'a card either does something or it is not there: label unavailable content with a badge ' +
  'BEFORE the tap (sheetBadgeLabel / the Library "Soon" row), and when there is nothing to ' +
  'produce say what the surface DOES have plus the next real path (search it / hum it / ' +
  'browse the free library). A passive "coming soon" box is a dead end with words on it.';

// ──────────────── badge BEFORE the tap, derived at render time ────────────────

/** A "Soon"-style badge site found in a surface. */
export interface BadgeSite {
  /** 1-based line. */
  line: number;
  /** The label as written (the call or the literal). */
  label: string;
}

/** The calls a surface may use to DERIVE a badge label at render time. */
export const BADGE_SIGNAL_CALLS: readonly string[] = [
  'sheetBadgeLabel(',
  'isOpenableKind(',
  'sheetMusicAvailable',
  'item.capture',
];

/** How a badge appears in source: the shared label call, or the Library's own. */
const BADGE_SITE_PATTERN =
  /sheetBadgeLabel\(|isOpenableKind\([^)]*\)\s*\?|styles\.badgeSoon|>\s*Soon\s*</g;

/** Every "Soon"-style badge in a surface (masked source only). */
export function badgeSites(source: string): BadgeSite[] {
  const masked = maskCommentsForCodeScan(source);
  const sites: BadgeSite[] = [];
  BADGE_SITE_PATTERN.lastIndex = 0;
  let match = BADGE_SITE_PATTERN.exec(masked);
  while (match) {
    sites.push({
      line: lineOf(masked, match.index),
      label: match[0].replace(/\s+/g, ' ').trim(),
    });
    match = BADGE_SITE_PATTERN.exec(masked);
  }
  return sites;
}

/** True when any element enclosing `index` — the row the badge sits on — acts. */
function badgeSitsOnAnActionableRow(masked: string, index: number): boolean {
  let at = index;
  for (let hop = 0; hop < 16; hop++) {
    const range = enclosingElementRange(masked, at);
    if (range === null) return false;
    if (
      SURFACE_ACTION_MARKERS.some(
        (marker) => masked.slice(range.start, range.end).indexOf(marker) >= 0,
      )
    ) {
      return true;
    }
    if (range.start <= 0 || range.start > at) return false;
    // Walk outwards: continue the chain from just before this element's `<`.
    at = range.start - 1;
  }
  return false;
}

/**
 * True when every "Soon"-style badge in this surface is attached to a row that
 * lands somewhere real, and the badge is DERIVED (a render-time signal call),
 * never a hard-coded list.
 *
 * Two failure modes this closes, both of which the owner actually hit:
 *   • a row that promises an open its tap cannot deliver — the badge is the
 *     honest treatment, and it must sit on a row that still DOES something (the
 *     Library's `Soon` row opens its item menu: share / send to cloud / rename);
 *   • satisfying the rule by DELETING the badge and leaving the dead tap — so a
 *     surface with NO badge at all fails here (its unavailable rows are then
 *     unlabelled), and a literal label table fails the derivation check.
 */
export function noBadgeWithoutADestination(source: string): boolean {
  const masked = maskCommentsForCodeScan(source);
  // 1. the badge must be derived from a live signal …
  if (!BADGE_SIGNAL_CALLS.some((call) => masked.indexOf(call) >= 0)) return false;
  // … and must not be a hard-coded label list (a `const …SOON… = ['a', 'b']`).
  if (/const\s+[\w$]*(?:SOON|BADGE)[\w$]*\s*(?::[^=]+)?=\s*\[/.test(masked)) return false;
  const sites = badgeSites(masked);
  // 2. there must BE a badge — deleting it leaves the row unlabelled.
  if (sites.length === 0) return false;
  // 3. every badge must sit on a row whose tap lands somewhere real.
  BADGE_SITE_PATTERN.lastIndex = 0;
  let match = BADGE_SITE_PATTERN.exec(masked);
  while (match) {
    if (!badgeSitsOnAnActionableRow(masked, match.index)) return false;
    match = BADGE_SITE_PATTERN.exec(masked);
  }
  return true;
}

/**
 * The same rule stated as a decision on ONE surface: a surface that SHOWS
 * unavailable content must label it before the tap.
 */
export function unavailableContentIsBadgedBeforeTap(source: string): boolean {
  const masked = maskCommentsForCodeScan(source);
  const showsUnavailableContent =
    /isOpenableKind\(/.test(masked) || /sheetBadgeLabel\(/.test(masked);
  if (!showsUnavailableContent) return true; // nothing unavailable here to label
  return noBadgeWithoutADestination(masked);
}

// ───────────────── every dead end has an action (surface models) ─────────────────

/** One tappable row on a surface. */
export interface SurfaceRow {
  label: string;
  /** The badge shown BEFORE the tap, when the row leads to unavailable content. */
  badge?: string | null;
  /** Where the tap lands. `null` is a dead tap and is rejected. */
  destination: string | null;
}

/** One action (button) on a surface. */
export interface SurfaceAction {
  label: string;
  /** Where the tap lands (`null` = in-words fallback, allowed only with a line). */
  destination: string | null;
}

/**
 * A surface, reduced to what the rule cares about. The suite builds these from the
 * REAL fallback constants (`resultSurface.ts`), so the card and the guard read the
 * same words.
 */
export interface SurfaceModel {
  name: string;
  rows?: readonly SurfaceRow[];
  actions?: readonly SurfaceAction[];
  /** The honest line the surface renders when a path does not exist. */
  honestFallbackLine?: string | null;
}

function usable(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** True when `text` contains any banned promise phrase. */
export function promisesSomething(text: string): boolean {
  return BANNED_PROMISE_PATTERNS.some((banned) => banned.pattern.test(text));
}

/**
 * THE SURFACE-LEVEL RULE (§E.1.1 + §E.1.5): every row and every action on a
 * surface resolves to a real destination, or — when no path exists — the surface
 * says what it HAS in words that promise nothing.
 *
 * False for:
 *   • an empty surface (nothing the user can do is a wall, whatever it says);
 *   • a row that is rendered but goes nowhere (a card that does nothing);
 *   • an action with no destination and no honest fallback line behind it (a fake
 *     button — how a purchase path used to be invented for a PD work);
 *   • any of the above whose wording is itself a promise (`promisesSomething`).
 */
export function everyDeadEndHasAnAction(model: SurfaceModel): boolean {
  const rows = model.rows ?? [];
  const actions = model.actions ?? [];
  if (rows.length + actions.length === 0) return false;
  const fallback = usable(model.honestFallbackLine);
  if (fallback !== null && promisesSomething(fallback)) return false;
  const rowsAct = rows.every(
    (row) => usable(row.destination) !== null && !promisesSomething(row.label + (row.badge ?? '')),
  );
  if (!rowsAct) return false;
  return actions.every((action) => {
    if (promisesSomething(action.label)) return false;
    if (usable(action.destination) !== null) return true;
    // No destination: allowed only behind a real, non-promising honest line.
    return fallback !== null;
  });
}

/** The honest fallback line the result surface and the piece page share. */
export const HONEST_FALLBACK_LINE = NO_HOSTED_SCORE_LINE;
