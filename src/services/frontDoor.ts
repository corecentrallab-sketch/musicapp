/**
 * frontDoor.ts — the ONE-BUTTON FRONT DOOR (owner-approved 09-24).
 *
 * WHY THIS MODULE EXISTS. The Home screen used to offer a tier-1 row of three
 * rival modes next to the big round button — "Hum, whistle or sing the melody",
 * "Find any song & get the sheet music" and "Find a piece" — so the user had to
 * choose a MODE before they could be helped. Unofficial testers pressed the big
 * round (hum) button expecting song recognition, and the wrong-mode paths are
 * what produced the ZZ Top mislabel. The owner's decision (09-24): one large
 * button, no mode choice.
 *
 * The front door is therefore ONE hero CTA that runs the whole hybrid pipeline in
 * a single pass (our library landmark match, then the AudD modern pass), and when
 * the ambient pass hears nothing we recognise the SAME button becomes the
 * hum/whistle/sing fallback — inline, never a rival button. "Find a piece" is a
 * secondary SEARCH FIELD, not a hero.
 *
 * This module owns the state machine, every string the front door shows, the
 * hum-match → result-card mapping, and the source contracts that keep the wiring
 * from being silently removed (the `recognitionRetry` / `humBridge` recipe: pure
 * logic + source text scanning, so the tier1 gate can assert all of it with no
 * emulator and with node_modules absent). See scripts/frontDoor.test.ts.
 *
 * Pure by design — no react / react-native / fs / path imports.
 */
import type {
  HumMatch,
  HumResponse,
  Instrument,
  RecognitionResponse,
} from '../types';
import { maskComments } from './modalBackContract';
import { startResultIdentifiers } from './modernRetryContract';
// The band model's own source helpers (the band-C row contract lives here, the
// band shape lives there — see scripts/frontDoorBands.test.ts).
import { bandRegion } from './frontDoorBands';
import { HUM_TO_MODERN_BLURB } from './humBridge';
import {
  START_FAILURE_COPY,
  isPermissionFailure,
  type StartFailure,
} from './recognitionRetry';

// ─────────────────────── the one hero CTA's words ───────────────────────

/** Idle: the single primary action. */
export const HERO_CTA_IDENTIFY = 'Tap to identify';
/** A live ambient capture. */
export const HERO_CTA_LISTENING = 'Listening…';
/**
 * The hum fallback state — the SAME button, after an ambient miss. It names ALL
 * THREE input modes the capture accepts (owner 09-28, RC v28 Test 4b: "A hum is
 * a hum — a whistle is a whistle and a sing is a sing").
 */
export const HERO_CTA_HUM = 'Tap to hum, whistle or sing';
/** A live hum/whistle/sing capture. Says what it records, not which mode. */
export const HERO_CTA_HUMMING = 'Recording your melody…';
/** A recognition/hum request is in flight. */
export const HERO_CTA_BUSY = 'Identifying…';

/**
 * RETIRED FROM THE SCREEN in v45 (owner 10-26, designer notes §6 "DIES"): the
 * 16-word idle sentence that sat under the pair. Kept as a constant only so the
 * retirement is greppable — the status line now speaks the QUOTA
 * (`heroStatusLine`), never a paragraph. `equalSplitHeroWired` and the front-door
 * copy guards still scan for this symbol coming BACK onto the screen.
 */
export const HERO_SUPPORT_IDLE =
  'Hear a song you want to play? Tap to identify it and get the sheet music instantly.';

/**
 * THE FREE MONTHLY CAP the status line counts down (v45). It mirrors the
 * backend's enforced default (`FREE_RECOGNITIONS_PER_MONTH` = 5 on
 * /api/recognize) — it is NOT a new limit, just the number the door is honest
 * about. Recognition itself is never paywalled (owner 10-08).
 */
export const FREE_MONTHLY_LIMIT = 5;

/** Pro's status line: unlimited, and it never quotes the free counter. */
export const HERO_STATUS_PRO = 'Unlimited listens';

/**
 * "5 free listens left" — the v45 status line under the hero (designer notes §4
 * element 5). It counts DOWN from the enforced cap using the count the app
 * really holds (`getRecognitionCount`, the same number the retired "(3/5 free
 * recognitions)" printed), so the mock's wording and the app's actual
 * remaining-listen value can never disagree.
 */
export function freeListensLeft(usedRecognitions: number): number {
  const used = Number.isFinite(usedRecognitions)
    ? Math.max(0, Math.floor(usedRecognitions))
    : 0;
  return Math.max(0, FREE_MONTHLY_LIMIT - used);
}

export function heroStatusLine(opts: {
  isPro: boolean;
  freeRecognitions: number;
}): string {
  if (opts.isPro) return HERO_STATUS_PRO;
  const left = freeListensLeft(opts.freeRecognitions);
  return left === 1 ? '1 free listen left' : `${left} free listens left`;
}
/** The listening support line. */
export const HERO_SUPPORT_LISTENING =
  'Recording audio — move closer to the music source for best results.';
/**
 * The in-flight line. It is honest about the TWO passes a single tap now runs
 * (our own library first, then the wider modern catalog) so the screen is never
 * a wordless spinner while it works.
 */
export const HERO_SUPPORT_BUSY =
  'Checking our library, then the wider music catalog…';

// ─────────────────────── the inline hum fallback ───────────────────────

/**
 * The fallback prompt, shown under the SAME button once the ambient pass found
 * nothing (spec state 4). This is the "Couldn't hear it — hum, whistle or sing
 * the melody" line the owner asked for, and it is the reason there is no rival
 * hum button any more.
 */
export const HUM_FALLBACK_PROMPT =
  "Couldn't hear it — hum, whistle or sing the melody";
/** How the fallback works, in one line (shown while the door is in hum mode). */
export const HUM_FALLBACK_HINT =
  'Tap the button and hum, whistle or sing a phrase (8–12s), then tap again to find it.';
/** The no-match card's action that hands the user into the hum fallback. */
export const HUM_FALLBACK_BUTTON = '🎤 Hum, whistle or sing the melody';
/**
 * The line that LABELS that action as the secondary way in (owner 09-25): the
 * big red button is identify-first, so the card says in words that humming is
 * the alternative — it is not the door's primary action any more.
 *
 * All THREE input modes are named (owner 09-28, RC v28 Test 4b): the capture
 * accepts a hum, a whistle or a sung melody, so the CTA may not say "Hum it".
 */
export const HUM_SECONDARY_CTA = "Can't play it? Hum, whistle or sing the melody";
/** The honest library-size note under the fallback (same as the hum screen's). */
export const HUM_FALLBACK_LIBRARY_NOTE =
  'Library still growing — try a well-known melody (Für Elise, Ode to Joy).';

// ─────────────── the hum SIBLING CARD (v33 §E, owner 10-03) ───────────────

/**
 * The owner's 10-03 ask, and the designer's accepted treatment
 * (`design-capture-page-v33/home-hum-button.png`): Listen stays the DOMINANT
 * hero, and Hum becomes a real SIBLING CARD directly beneath it — same width,
 * same one-CTA structure, same weight class — NOT a chip, NOT a menu item, NOT
 * a text row tucked inside the hero card as it was in v32.
 *
 * It opens the existing hum flow (`handleHumEntry` → HumSearchScreen), whose
 * capture window starts recording on mount (v32 behaviour), so "opens the
 * capture window and records immediately" is the real behaviour, not a promise.
 *
 * Copy is deliberately split: the TITLE says what the user does ("Hum / sing a
 * melody"), the BODY carries the v32 CTA line (it names all three capture modes,
 * so the mode-honesty rule survives the move), and the SPLIT line under the pair
 * teaches which door is which. No mode is promoted: the hero button still runs
 * the identify pipeline first.
 */
export const HUM_SIBLING_TITLE = '🎤 Hum / sing a melody';
export const HUM_SIBLING_BODY = HUM_SECONDARY_CTA;
/**
 * RETIRED FROM THE SCREEN (v44 equal split, owner 10-22). The line is kept as a
 * constant only so the retirement is greppable: two labelled PEER panels teach
 * which door is which by structure, so the row is gone from Home
 * (`heroSplit.ts`'s `splitHeroCopyIsHonest` fails if it comes back).
 */
export const HUM_SPLIT_TEACH_LINE = 'Hear it → Listen · Think it → Hum';

// ──────────── the EQUAL SPLIT hero (v44, owner-approved 10-22) ─────────────
//
// Owner: "Equal split is great with the first time tooltip embedded."
// Spec: /home/team/shared/hum-button-concept/ENGINEER-NOTES.md §4.
//
// The user-test failure this fixes: the navy `#16213e` hum card with the teal
// outline read as INFORMATION, not as a button. Two panels of identical shape,
// size, fill weight and affordance fix it by STRUCTURE — hum can no longer read
// as a sub-paragraph of Listen. The copy below is the spec's, verbatim.
//
// Honest-claims discipline (spec §4 last bullet): Listen identifies audio you
// can already hear; hum/whistle/sing is the melody door. No "scan", "camera",
// "photo", "PDF" or "shazam" wording anywhere on the hero.
/** Listen's panel title (spec §4). */
export const HOME_SPLIT_LISTEN_TITLE = 'Listen';
/** Listen's panel body at rest — what the left door actually does. */
export const HOME_SPLIT_LISTEN_BODY = 'Listen to the music around you';
/**
 * Hum's panel title. REPLACES the on-screen use of `HUM_SIBLING_TITLE` (the
 * emoji prefix read as a secondary row); the constant itself is untouched.
 */
export const HOME_SPLIT_HUM_TITLE = 'Hum a Tune Instead';
/**
 * Hum's panel body. Deliberately NOT `HUM_SECONDARY_CTA`: that string is the
 * fallback path's own wording (via `HUM_SIBLING_BODY`) and keeps its job.
 */
export const HOME_SPLIT_HUM_BODY =
  "Can't find it playing? Hum, whistle or sing the melody.";
/** The one-time coach-mark bubble over the hum panel (spec §7, still 04). */
export const HOME_SPLIT_HUM_TIP = 'Stuck without sheet music? Hum your melody here';
/** The section label above the pair. */
export const HOME_SPLIT_SECTION_LABEL = 'RECOGNISE MUSIC';
/** Screen-reader label for the Listen panel (spec §5, measured not estimated). */
export const HOME_SPLIT_LISTEN_A11Y = 'Listen — identify the music around you';
/** Screen-reader label for the hum panel (spec §5). */
export const HOME_SPLIT_HUM_A11Y =
  'Hum a tune instead — hum, whistle or sing the melody';
/**
 * Wording the hero may NEVER carry: none of these surfaces takes a photo, scans
 * paper or reads a PDF, and the app is not Shazam. (The scanner/PDF reader are
 * real features elsewhere in the app — they are simply not this hero.)
 */
export const HERO_FORBIDDEN_WORDS: readonly string[] = [
  'scan',
  'camera',
  'photo',
  'pdf',
  'shazam',
];

// ─────────────────────── the home promise (genre-neutral) ───────────────

/**
 * The Home subtitle. It used to read "Curated Classical" whenever the user
 * skipped genre selection (onboarding defaulted to ['classical']), which told a
 * guitar or pop learner the app was not for them. The front door is
 * genre-neutral for everyone — and instrument-aware for guitar: the live guitar
 * story today is modern song → official TAB (Sheet Music Direct, affiliate
 * 67650), which is exactly what this line promises.
 *
 * NO OVERCLAIM: the TAB line talks about getting the official TAB for a song we
 * recognise. It does not promise a free in-app TAB library — that catalog is
 * still gated on a compliant source.
 */
export const HOME_PROMISE_ALL_GENRES =
  "Find any song — classical to today's hits";
export const HOME_PROMISE_GUITAR = 'Find any song — get the official TAB';

/** The subtitle for a given onboarding instrument (null = not answered yet). */
export function homePromiseCopy(instrument: Instrument | null | undefined): string {
  return instrument === 'guitar' || instrument === 'both'
    ? HOME_PROMISE_GUITAR
    : HOME_PROMISE_ALL_GENRES;
}

// ─────────────────────── the secondary way in: search ───────────────────

/**
 * "Find a piece" is no longer a hero: it is a search field entry under the one
 * button, for a learner who knows the piece's name and has no microphone input
 * to give (it opens the catalog search — no recorder involved).
 */
export const FIND_PIECE_ENTRY_LABEL = 'Find a piece — search by title or composer';
/** The field's placeholder-ish hint, so the row reads as a search box. */
export const FIND_PIECE_ENTRY_HINT = 'Search by title or composer';

// ─────────────────── the capture mode is named honestly ─────────────────

/**
 * The three input modes the capture surface ACCEPTS. The owner's rule (RC v28
 * Test 4b, 09-28): "A hum is a hum — a whistle is a whistle and a sing is a
 * sing." Copy that names one of these for a surface that takes all three tells a
 * whistler or a singer the feature is not for them.
 */
export const CAPTURE_MODES = ['hum', 'whistle', 'sing'] as const;

/** Which of the three modes a piece of copy names (lower-case word match). */
export function captureModesNamed(copy: string): string[] {
  const lower = copy.toLowerCase();
  return CAPTURE_MODES.filter((mode) => lower.indexOf(mode) >= 0);
}

/**
 * True when copy about the capture surface is HONEST: it either names all three
 * accepted modes, or names NO mode at all (a neutral state label such as
 * "Recording your melody…" is fine). Naming one or two is the defect — it is
 * literally the "Can't play it? Hum it" bug.
 */
export function copyNamesAllCaptureModes(copy: string): boolean {
  return captureModesNamed(copy).length === CAPTURE_MODES.length;
}

/** The honest-copy rule: all three modes, or no mode named. */
export function captureCopyIsHonest(copy: string): boolean {
  const named = captureModesNamed(copy).length;
  return named === 0 || named === CAPTURE_MODES.length;
}

/**
 * The retired hum-only copy (RC v28 Test 4b). Any of these reappearing on a
 * capture surface — a CTA, a state label, a hint, a card title — is the reported
 * defect coming back, so the tier1 scan rejects every one of them.
 */
export const RETIRED_HUM_ONLY_COPY = [
  "Can't play it? Hum it",
  'Hum it',
  'Hum Again',
  'Humming…',
  'Humming...',
  'hum a phrase',
  'hum the melody',
  'hum or whistle',
  'No match for that hum',
] as const;

/** True when a surface's source carries none of the retired hum-only copy. */
export function humOnlyCopyRetired(source: string): boolean {
  const masked = maskComments(source);
  return RETIRED_HUM_ONLY_COPY.every((retired) => masked.indexOf(retired) < 0);
}

// ─────────────────────── the hero state machine ───────────────────────

/**
 * The one button's states:
 *  - `idle` / `listening` — the ambient identification pass;
 *  - `hum` / `hum-listening` — the inline hum fallback, reached from the
 *    no-match card (or when the capture heard no audio at all);
 *  - `busy` — a pass is in flight (recognition or hum); a tap must never stack a
 *    second capture on top of it.
 */
export type HeroState = 'idle' | 'listening' | 'hum' | 'hum-listening' | 'busy';

export interface HeroInputs {
  /** The recorder is live right now. */
  recording: boolean;
  /** The door is in hum-fallback mode (armed by the no-match path). */
  humFallback: boolean;
  /** A recognition / hum request is in flight, or a start is being prepared. */
  busy: boolean;
}

/** The button's state, from the screen's flags. Pure and total. */
export function heroState(inputs: HeroInputs): HeroState {
  if (inputs.busy) return 'busy';
  if (inputs.recording) return inputs.humFallback ? 'hum-listening' : 'listening';
  return inputs.humFallback ? 'hum' : 'idle';
}

/** What a tap on the hero button does. */
export type HeroTapAction = 'start-ambient' | 'start-hum' | 'stop' | 'wait';

/**
 * The hero tap decision. A live capture is always stoppable (tap-to-stop, as
 * everywhere else); an in-flight pass swallows the tap rather than stacking a
 * second capture; otherwise the tap starts the pass the door is in.
 */
export function heroTapAction(inputs: HeroInputs): HeroTapAction {
  if (inputs.busy) return 'wait';
  if (inputs.recording) return 'stop';
  return inputs.humFallback ? 'start-hum' : 'start-ambient';
}

/** The label on the one button. */
export function heroLabel(state: HeroState): string {
  switch (state) {
    case 'listening':
      return HERO_CTA_LISTENING;
    case 'hum':
      return HERO_CTA_HUM;
    case 'hum-listening':
      return HERO_CTA_HUMMING;
    case 'busy':
      return HERO_CTA_BUSY;
    default:
      return HERO_CTA_IDENTIFY;
  }
}

/** The headline above the one button — what this door is for. */
export const HERO_TITLE = 'Identify any song';
/** The headline once the door is in hum-fallback mode. */
export const HERO_TITLE_HUM = 'Hum, whistle or sing the melody';

/** The headline above the one button, for a given state. */
export function heroTitle(state: HeroState): string {
  return state === 'hum' || state === 'hum-listening'
    ? HERO_TITLE_HUM
    : HERO_TITLE;
}

/** The support line under the one button. Every state has words. */
export function heroSupport(
  state: HeroState,
  opts: { isPro: boolean; freeRecognitions: number },
): string {
  switch (state) {
    case 'listening':
      return HERO_SUPPORT_LISTENING;
    case 'busy':
      return HERO_SUPPORT_BUSY;
    case 'hum':
      return HUM_FALLBACK_PROMPT;
    case 'hum-listening':
      return HUM_FALLBACK_HINT;
    default:
      // v45: the idle line is the QUOTA, not the retired paragraph (notes §6).
      return heroStatusLine(opts);
  }
}

/** A spoken description of the one button, for screen readers. */
export function heroAccessibilityLabel(state: HeroState): string {
  switch (state) {
    case 'listening':
      return 'Listening for music — tap to stop and identify';
    case 'hum':
      return 'Hum, whistle or sing the melody to find the piece';
    case 'hum-listening':
      return 'Recording your melody — tap to stop and search';
    case 'busy':
      return 'Identifying music — please wait';
    default:
      return 'Identify the music playing around you';
  }
}

// ─────────────────────── the honest start-failure path ───────────────────

/** What Home shows when a capture could not be started. `message` is never
 *  empty — that is what makes the old silent dead end impossible. */
export interface FrontDoorStartFailure {
  message: string;
  /** Keep the recorder hook's inline error (its "Open Settings" affordance)?
   *  Only permission problems are fixed in device settings. */
  keepHookError: boolean;
}

/**
 * Map a failed `startRecording()` to the result the screen must show. The
 * pre-fix HomeScreen did `if (!started) return;` — no state at all, so nothing
 * was rendered and every retry tap was eaten (tracked debt f9f8e4f3).
 */
export function frontDoorStartFailure(
  failure: StartFailure | null,
): FrontDoorStartFailure {
  return {
    message: failure ? failure.message : START_FAILURE_COPY['start-error'],
    keepHookError: failure ? isPermissionFailure(failure.reason) : false,
  };
}

// ─────────────────────── hum match → the existing result card ────────────

/**
 * The hosted score the CALLER resolved for a hum match (bundle A, owner 10-02).
 *
 * `HumMatch` carries identity only — no sheet URL — so the hum pass looks the
 * piece up in the catalog (`fetchPieceById`, best effort) and hands the result
 * here. Every field is optional: an offline device, an unknown id or a catalog
 * that holds no score all mean the SAME thing to this function (no hosted score),
 * and the surface then renders its honest "we don't hold a score for this one yet"
 * line instead of a block or a spinner that never ends.
 */
export interface HumResolvedSheet {
  /** The catalog's `sheet_music_url` for the piece, when it has one. */
  sheetMusicUrl?: string | null;
  /** The catalog's quality gate for that score. `false` beats a URL (§A.4). */
  sheetMusicAvailable?: boolean;
  /** The catalog's public-domain verdict; an explicit `false` withholds the score. */
  isPublicDomain?: boolean;
}

/**
 * Adapt a hum search result for the EXISTING recognition result card, so the
 * inline fallback reuses the surface the user already knows instead of growing a
 * second result UI.
 *
 * HONESTY RULES BAKED IN: a hum match comes from OUR public-domain melody
 * library, so `is_public_domain: true` — and therefore `purchase_url: null`. The
 * card can never offer a retail redirect for a public-domain hum match.
 *
 * The hosted score (bundle A) arrives as the caller's RESOLVED catalog record, and
 * only ever for the TOP match — the card renders one score. It is never
 * synthesised here: when the caller has nothing (no lookup, no URL, or the
 * catalog's own `sheet_music_available === false` / `is_public_domain === false`),
 * the score fields stay empty and the card shows its honest no-score line.
 *
 * The `result_provenance` marker is what lets the ONE surface say "You hummed it —
 * here it is" instead of claiming it heard the music; it is set by us, never
 * received from the server (types/index.ts).
 */
export function humMatchToResultResponse(
  hum: HumResponse,
  matches: readonly HumMatch[],
  sheet?: HumResolvedSheet | null,
): RecognitionResponse {
  const sheetUrl =
    sheet && sheet.isPublicDomain !== false && typeof sheet.sheetMusicUrl === 'string'
      ? sheet.sheetMusicUrl.trim()
      : '';
  const sheetAvailable = sheetUrl.length > 0 && sheet?.sheetMusicAvailable !== false;
  return {
    success: true,
    result_provenance: 'hum',
    query_duration_ms: hum.query_duration_ms,
    db_available: hum.db_available,
    matches: matches.map((m, index) => ({
      piece_id: m.piece_id,
      title: m.title,
      composer: m.composer,
      catalog: null,
      confidence: m.confidence,
      album_art_url: null,
      // The resolved catalog score belongs to the TOP match — the one the card
      // renders. The other matches keep their honest empty state and open their
      // piece page on a tap.
      sheet_music_url: index === 0 && sheetAvailable ? sheetUrl : null,
      tab_url: null,
      matched_at_s: 0,
      is_public_domain: true,
      sheet_music_available: index === 0 && sheetAvailable,
      purchase_url: null,
      affiliate_url: null,
    })),
  };
}

// ─────────────────────── source contracts (live scan) ───────────────────

/** The ONE handler the hero button may call. */
export const HERO_TAP_HANDLER = 'handleHeroTap';
/** Rival mode buttons that must no longer be wired on Home (the old tier-1 row). */
export const RIVAL_MODE_HANDLERS = [
  'handleOpenHumSearch',
  'handleOpenModernSearch',
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Source from the `{` at `open` to its matching `}` (or '' if unbalanced). */
function matchBraces(masked: string, open: number): string {
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

/** The `if (…) { … }` body whose `{` is the first one at or after `from`. */
function braceBlockFrom(masked: string, from: number): string {
  const open = masked.indexOf('{', from);
  return open < 0 ? '' : matchBraces(masked, open);
}

/** The JSX tag that carries `marker` (from its opening `<` to its `>`). */
function tagAround(masked: string, marker: string): string {
  const at = masked.indexOf(marker);
  if (at < 0) return '';
  const open = masked.lastIndexOf('<', at);
  if (open < 0) return '';
  // The tag's `>` — skipping the `>` of any `=>` inside the tag.
  for (let i = at; i < masked.length; i++) {
    if (masked[i] === '>' && masked[i - 1] !== '=') return masked.slice(open, i + 1);
  }
  return masked.slice(open);
}

/** The element that carries `marker` in its opening tag (its whole tag). */
export function elementWithMarker(source: string, marker: string): string {
  return tagAround(maskComments(source), marker);
}

/**
 * The ELEMENT that carries `marker`: its opening tag, extended through its
 * children to the matching close tag when the tag is not self-closing.
 *
 * The distinction matters for the hero label: v43's round button carries
 * `{heroLabel(hero)}` in its BODY (`<TouchableOpacity …><Text>{heroLabel(…)}`),
 * while v44's LISTEN panel is self-closing and names itself in its own props
 * (`variant="listen"`). A predicate that only reads the opening tag misses the
 * v43 shape and reports a healthy round button as unwired.
 */
function elementAround(masked: string, marker: string): string {
  const tag = tagAround(masked, marker);
  if (!tag) return '';
  if (/\/\s*>$/.test(tag)) return tag;
  const open = masked.lastIndexOf('<', masked.indexOf(marker));
  const close = masked.indexOf('</', open + tag.length);
  return close < 0 ? tag : masked.slice(open, close);
}

/**
 * The ONE primary CTA contract: exactly one `onPress={handleHeroTap}` on Home,
 * on the big round button, and NO rival mode button left wired (the old hum /
 * "find any song" hero buttons). A second hero, or a resurrected rival, fails.
 */
export function hasSingleHeroCta(source: string): boolean {
  const masked = maskComments(source);
  const hero = (masked.match(/onPress=\{handleHeroTap\}/g) ?? []).length;
  if (hero !== 1) return false;
  for (const handler of RIVAL_MODE_HANDLERS) {
    if (masked.indexOf(`onPress={${handler}}`) >= 0) return false;
  }
  return true;
}

/** True when the hero button itself (the big round red one — since v44 the rose
 *  LISTEN panel of the equal split) is wired to the ONE front-door handler and
 *  renders its label state. */
export function heroButtonWired(source: string): boolean {
  const masked = maskComments(source);
  const tag = tagAround(masked, 'styles.recognitionBtn');
  if (!tag) return false;
  // The element is the hero's own control and takes the ONE front-door tap.
  if (!/onPress=\{handleHeroTap\}/.test(tag)) return false;
  // v44 — the LISTEN panel of the equal split names its variant in its own tag.
  if (/variant="listen"/.test(tag)) return true;
  // v43 and earlier — the round red button keeps its label state in its BODY
  // (`<Text>{heroLabel(hero)}</Text>`), so the ELEMENT is what has to be read.
  return /heroLabel\(/.test(elementAround(masked, 'styles.recognitionBtn'));
}

/**
 * ONE tap runs the WHOLE hybrid pipeline, in this order: the library landmark
 * match, then the AudD modern pass, then (when both miss) the hum fallback. The
 * order matters — the cheap, free library pass goes first, and the hum fallback
 * is only ever reachable past the modern pass.
 */
export function heroRunsHybridPipeline(source: string): boolean {
  const masked = maskComments(source);
  const library = masked.indexOf('recognizeAudio(');
  const modern = masked.indexOf('recognizeModernSong(');
  const hum = masked.indexOf('humToSearch(');
  return library >= 0 && modern > library && hum > modern;
}

/** True when the front door's SAME button carries the hum fallback (copy from
 *  this module, armed by the no-match path) and no rival hum button exists. */
export function humFallbackIsInline(source: string): boolean {
  const masked = maskComments(source);
  return (
    /\{heroSupport\(/.test(masked) &&
    /setHumFallback\(true\)/.test(masked) &&
    !/onPress=\{handleOpenHumSearch\}/.test(masked)
  );
}

/** The ambient-miss branch's marker: it offers the hum way in on the card. */
export const AMBIENT_NO_MATCH_OFFER_MARKER = "setNoMatchOffer('hum')";
/** The marker of the "the recorder produced no clip at all" branch. */
export const EMPTY_CAPTURE_MARKER = "reason === 'empty'";

/**
 * True when the hero stays IDENTIFY-FIRST (owner 09-25): the big red button
 * reads "Tap to identify" unless the user themself chose the hum way in, and the
 * two miss paths never silently arm the hum fallback behind their back — which
 * is exactly what turned the big button into "Tap to hum it" after every failed
 * listen (v25: the capture never produced a clip, the door armed hum mode, and
 * the primary CTA changed its job without being asked).
 *
 * Contracts, in the order the screen runs them:
 *   1. the ambient no-match branch (the one that offers the hum affordance) must
 *      NOT call setHumFallback(true) — the CARD carries the hum path instead;
 *   2. the no-clip-at-all branch must show the honest capture-feedback card
 *      (setRecognitionPhase) rather than arming hum and returning wordlessly;
 *   3. the hum path is still reachable: the card's handler exists and is what
 *      arms it (setHumFallback(true) inside handleHumFallbackFromCard).
 */
export function heroStaysIdentifyFirst(source: string): boolean {
  const masked = maskComments(source);
  const offer = masked.indexOf(AMBIENT_NO_MATCH_OFFER_MARKER);
  if (offer < 0) return false;
  // The branch around the offer marker: the offer is the LAST statement of the
  // ambient no-match branch, so the branch's body runs from the no-match phase
  // it sets to the offer itself.
  const phaseAt = masked.lastIndexOf('setRecognitionPhase', offer);
  if (phaseAt < 0) return false;
  const branch = masked.slice(phaseAt, offer + 120);
  if (/setHumFallback\s*\(\s*true\s*\)/.test(branch)) return false;
  // The empty-capture branch: a card, never a silent mode switch.
  const empty = new RegExp(EMPTY_CAPTURE_MARKER).exec(masked);
  if (!empty) return false;
  const emptyBody = braceBlockFrom(masked, empty.index);
  if (!emptyBody) return false;
  if (/setHumFallback\s*\(\s*true\s*\)/.test(emptyBody)) return false;
  if (!/setRecognitionPhase\s*\(/.test(emptyBody)) return false;
  // The hum path is still reachable — the card's handler arms it.
  const handler = masked.indexOf('handleHumFallbackFromCard');
  if (handler < 0) return false;
  const handlerBody = braceBlockFrom(masked, handler);
  return /setHumFallback\s*\(\s*true\s*\)/.test(handlerBody);
}

/** True when "Find a piece" is the secondary search-field entry under the hero
 *  button (not a competing CTA), labelled from this module. */
export function findPieceIsSearchEntry(source: string): boolean {
  // v45 slice 2: on the REAL screen the row is gone and the "Find a song" bar is
  // the search entry, so a BAR that is wired satisfies this contract too (its own
  // geometry/wiring is pinned by `findASongBarWired`). The row checks below still
  // hold for any surface that renders the row.
  const masked = maskComments(source);
  // v46: the facet chips that used to carry `handleOpenFindPiece` here travelled
  // INTO the Discover surface with the browse block, so the door's search entry is
  // the BAR and nothing else. The "second hero" this contract exists to catch is
  // still caught: `findASongBarWired` fails when the bar wears the hero handler.
  if (masked.indexOf('styles.findPieceBtn') < 0) {
    return findASongBarWired(source);
  }
  if (masked.indexOf('FIND_PIECE_ENTRY_LABEL') < 0) return false;
  const tag = tagAround(masked, 'styles.findPieceBtn');
  return /onPress=\{handleOpenFindPiece\}/.test(tag);
}

/**
 * True when that secondary entry actually OPENS the "Find a piece" screen and the
 * screen is mounted behind it. `findPieceIsSearchEntry` proves the entry exists
 * and is styled as a search field; this proves the tap lands somewhere — the
 * version of the entry that renders but opens nothing is the dead CTA this app
 * keeps getting bitten by (owner: "NO DEAD AREAS").
 *
 * It matters more since the search box gained its EXTERNAL results section
 * (owner 10-01: internal library + "Official sheet music" retailers), because
 * that section is reached through this one entry — the front door must not
 * quietly detach it.
 *
 * v46: the door's entry is the "Find a song" bar, whose handler is
 * `handleFindAnySong`; the retired band-C row's `handleOpenFindPiece` is gone from
 * Home. Either handler is accepted, but whichever one the door actually has must
 * really set the flag — the dead-CTA half is what this asserts.
 */
export function findPieceOpensScreen(source: string): boolean {
  const masked = maskComments(source);
  if (!/import\s*\{[^}]*\bFindPieceScreen\b/.test(masked)) return false;
  const rowHandler = masked.indexOf('const handleOpenFindPiece = useCallback');
  const barHandler = masked.indexOf('const handleFindAnySong = useCallback');
  const declaration = rowHandler >= 0 ? rowHandler : barHandler;
  if (declaration < 0) return false;
  const body = braceBlockFrom(masked, declaration);
  if (!/setShowFindPiece\s*\(\s*true\s*\)/.test(body)) return false;
  // The screen is mounted behind that flag (the `if (showFindPiece) return …`
  // early-return the screen uses), not merely imported.
  const mount = /<FindPieceScreen\s/.exec(masked);
  if (!mount) return false;
  const flagAt = masked.lastIndexOf('showFindPiece', mount.index);
  if (flagAt < 0 || mount.index - flagAt > 400) return false;
  return /onClose=\{\(\) => setShowFindPiece\(false\)\}/.test(masked);
}

// ────────────── the front door's dev affordance (spec 09-24) ────────────────

/** The style marker of the demo button (the dev-only shortcut on Home). */
export const DEMO_BUTTON_STYLE = 'styles.demoBtn';
/** The handler the demo button calls (mock results, no microphone). */
export const DEMO_HANDLER = 'handleDemo';

/**
 * True when the demo button is a DEV-ONLY affordance.
 *
 * Spec (owner 09-24): "Demo button: dev-only shortcut — hide in production
 * builds (or keep a tiny dev affordance; owner-facing builds never show it)."
 * The owner tests the app from the Play closed-test track, so a demo button that
 * survived into a release bundle would sit right under the ONE hero CTA of an
 * owner-facing build and hand out mock results. Two things have to hold, and a
 * half fix fails this contract:
 *
 *   1. the button's own render site is gated (`{__DEV__ && …}` immediately
 *      around it) and there is exactly ONE such button — a second, ungated copy
 *      is the same defect wearing a different tag;
 *   2. the handler itself bails out in a production bundle (`if (!__DEV__)`)
 *      so the mock path cannot run even when something else calls it.
 */
export function demoButtonHiddenInProd(source: string): boolean {
  const masked = maskComments(source);
  const usages = masked.match(new RegExp(`style=\\{${DEMO_BUTTON_STYLE}\\}`, 'g')) ?? [];
  if (usages.length !== 1) return false;
  const at = masked.indexOf(`style={${DEMO_BUTTON_STYLE}}`);
  const open = masked.lastIndexOf('<TouchableOpacity', at);
  if (open < 0) return false;
  // The render gate sits immediately before the button, in the same tag chain.
  const before = masked.slice(Math.max(0, open - 160), open);
  if (!/\{\s*__DEV__\s*&&/.test(before)) return false;
  // …and the handler refuses to do anything outside a dev bundle.
  const declaration = masked.indexOf(`const ${DEMO_HANDLER}`);
  if (declaration < 0) return false;
  const body = braceBlockFrom(masked, declaration);
  if (!/if\s*\(\s*!\s*__DEV__\s*\)/.test(body)) return false;
  return true;
}

// ─────────────────────── the HOME hum entry (owner 09-25, build #3) ─────────

/**
 * The handler the home hum entry calls. Deliberately NOT one of the rival mode
 * handlers above (`handleOpenHumSearch`): this is a labelled secondary path under
 * the one hero button, and the big button stays identify-first.
 */
export const HUM_ENTRY_HANDLER = 'handleHumEntry';
/** The style marker the hum entry renders with — a distinct, lighter row. */
export const HUM_ENTRY_STYLE = 'styles.humEntryBtn';

/**
 * True when HOME carries a VISIBLE hum/whistle/sing affordance that routes into
 * the existing hum flow.
 *
 * Owner-reported (RC v26 Test 6, 09-25): "no 'Hum the melody' CTA on the home
 * screen — hum reachable only post-recognition via result-card levers". The one
 * button was correct (identify-first), but a musician who cannot play the audio
 * at all had no visible way in on the surface they land on. The affordance must
 * therefore be present, LABELLED as the alternative (HUM_SECONDARY_CTA — or, since
 * the v44 equal split, the peer panel's own HOME_SPLIT_HUM_BODY), styled
 * distinctly (its own panel style, never the Listen panel's), rendered BELOW or
 * BESIDE the one hero button as a PEER, and wired to open the EXISTING hum flow
 * (setShowHumSearch(true)) — one hum implementation, not two.
 */
export function humEntryWired(source: string): boolean {
  const masked = maskComments(source);
  const entry = masked.indexOf(`onPress={${HUM_ENTRY_HANDLER}}`);
  const hero = masked.indexOf(`onPress={${HERO_TAP_HANDLER}}`);
  if (entry < 0 || hero < 0) return false;
  // Not a rival ABOVE the hero: it renders after the one button (v44: it is the
  // right-hand peer of the pair, so this stays true).
  if (entry < hero) return false;
  // The door's OWN element — the label and the style must sit on the control the
  // user taps, not merely somewhere else in the file.
  const element = elementAround(masked, `onPress={${HUM_ENTRY_HANDLER}}`);
  if (!element) return false;
  // Labelled as the alternative from a COPY MODULE, never a retyped string:
  //   · the v26–v43 row — the shared HUM_SECONDARY_CTA on the door itself; or
  //   · v44's peer panel — its body slot, which heroSplit.splitPanelBody('hum', …)
  //     resolves from frontDoor.HOME_SPLIT_HUM_BODY (all three capture modes).
  const sharedRowLabel = element.indexOf('HUM_SECONDARY_CTA') >= 0;
  const splitPeerBody =
    element.indexOf('HOME_SPLIT_HUM_BODY') >= 0 ||
    /body=\{\s*splitPanelBody\(\s*['"]hum['"]/.test(element);
  if (!sharedRowLabel && !splitPeerBody) return false;
  // A peer panel is the hum VARIANT of the ONE split component — the body must
  // belong to the hum door, not be borrowed from the Listen panel beside it.
  if (splitPeerBody && !/variant=["']hum["']/.test(element)) return false;
  if (element.indexOf(HUM_ENTRY_STYLE) < 0) return false;
  // It opens the existing hum flow — the handler body is the arrow function the
  // declaration opens.
  const declaration = masked.indexOf(`const ${HUM_ENTRY_HANDLER}`);
  if (declaration < 0) return false;
  const body = braceBlockFrom(masked, declaration);
  if (!/setShowHumSearch\s*\(\s*true\s*\)/.test(body)) return false;
  // …and it is not a rival mode button: the old openers stay unwired.
  for (const handler of RIVAL_MODE_HANDLERS) {
    if (masked.indexOf(`onPress={${handler}}`) >= 0) return false;
  }
  return true;
}

/** True when the Home subtitle renders the genre-neutral promise from this
 *  module and the old classical-biased "Curated …" subtitle is gone. */
export function homePromiseRendered(source: string): boolean {
  const masked = maskComments(source);
  return (
    /\{homePromiseCopy\(/.test(masked) &&
    masked.indexOf('genreCopy') < 0 &&
    !/Curated\s/.test(masked)
  );
}

/** True when a failed capture start reaches a surface (an error phase) instead
 *  of being dropped — the rule that pays down debt f9f8e4f3. */
export function heroStartFailureSurfaced(source: string): boolean {
  const masked = maskComments(source);
  const idents = startResultIdentifiers(source);
  if (idents.length === 0) return false;
  for (const ident of idents) {
    const pattern = new RegExp(
      `if\\s*\\(\\s*!\\s*${escapeRegExp(ident)}\\s*\\)\\s*\\{`,
      'g',
    );
    let match = pattern.exec(masked);
    while (match) {
      const body = braceBlockFrom(masked, match.index);
      const surfaces = /setRecognitionPhase\s*\(/.test(body);
      if (surfaces && /\breturn\b/.test(body)) return true;
      match = pattern.exec(masked);
    }
  }
  return false;
}

/** The no-match phase marker in the result card. */
export const NO_MATCH_MARKER = "phase.type === 'no-match'";

/**
 * True when the result card's NO-MATCH phase offers BOTH ways forward: the
 * inline hum fallback (the front door's own next step) and the hum → modern
 * bridge (identify the recording and link the official sheet music). A card
 * with neither is the dead end this feature removed.
 */
export function noMatchOffersNextStep(source: string): boolean {
  const masked = maskComments(source);
  const at = masked.indexOf(NO_MATCH_MARKER);
  if (at < 0) return false;
  const end = masked.indexOf('phase.response.matches[0]', at);
  const block = masked.slice(at, end < 0 ? masked.length : end);
  return (
    /onHumFallback/.test(block) &&
    /onFindAnySong/.test(block) &&
    block.indexOf('HUM_FALLBACK_BUTTON') >= 0 &&
    // The hum affordance is LABELLED as the secondary way in (owner 09-25): the
    // identify pass is the door's primary action, so the card must say so.
    block.indexOf('HUM_SECONDARY_CTA') >= 0 &&
    block.indexOf('HUM_TO_MODERN_CTA') >= 0
  );
}

// ────────── BUNDLE B: the front-door "Find any song" chip ────────────────────

/**
 * The chip beside the hum row (owner sign-off (b), 10-02). It is the compact way
 * into the find-a-song SEARCH — the same `FindPieceScreen` the band-C row opens,
 * reached in one tap from the door — so a user who can hum nothing and cannot
 * play the audio still has a visible way into the app's own money path.
 *
 * Deliberately NOT `handleHeroTap`: the chip must never become a second hero
 * (`hasSingleHeroCta()` stays true), and it is deliberately NOT one of
 * `RIVAL_MODE_HANDLERS` either — it does not open a recorder, so it is not the
 * mode-menu coming back.
 */
export const FIND_ANY_SONG_CHIP_HANDLER = 'handleFindAnySong';
/**
 * The element's own style marker. v45: this is the full-width SEARCH BAR in the
 * Discover band (designer notes §3 row 3) — it was the v33 pill-shaped chip
 * (radius 999, no fill) before the owner's 10-26 "one search bar" call. The
 * marker is re-pointed, not retired: the bar is still a bar of the SEARCH
 * group, never the recognition core's button.
 */
export const FIND_A_SONG_BAR_STYLE = 'styles.findASongBar';
/** The bar's own geometry, pinned so a refactor cannot quietly re-chip it. */
export const FIND_A_SONG_BAR_MIN_HEIGHT = 56;
export const FIND_A_SONG_BAR_RADIUS = 16;

/**
 * The recording-identification claim the chip may NOT carry. The chip opens the
 * title/artist SEARCH (§B.1's honest limit); the sentence that promises "we'll
 * identify the recording" belongs to the modern door, so its own blurb is the
 * negative fixture here.
 */
export const RECORDING_IDENTIFICATION_CLAIMS: readonly string[] = [
  HUM_TO_MODERN_BLURB,
  'identify the recording',
  'identifies the recording',
  'play the song out loud',
];

/** The element (opening tag + children) that carries `marker`. */
function elementFromTag(masked: string, marker: string): string {
  const at = masked.indexOf(marker);
  if (at < 0) return '';
  const open = masked.lastIndexOf('<TouchableOpacity', at);
  if (open < 0) return '';
  const close = masked.indexOf('</TouchableOpacity>', at);
  return close < 0
    ? masked.slice(open)
    : masked.slice(open, close + '</TouchableOpacity>'.length);
}

/** The chip copy in a source file: the module's own chip constants AND the
 *  rendered chip element, so a retyped label is caught as well as the shared one.
 *  Empty when the file has neither (existence is `findASongBarWired`'s job). */
export function chipCopyRegion(source: string): string {
  const masked = maskComments(source);
  const parts: string[] = [];
  const first = masked.indexOf('FIND_ANY_SONG_CHIP_LABEL');
  const lastMarker = 'FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL';
  const last = masked.lastIndexOf(lastMarker);
  if (first >= 0 && last > first) {
    parts.push(masked.slice(first, last + lastMarker.length));
  }
  const element = elementFromTag(masked, FIND_A_SONG_BAR_STYLE);
  if (element) parts.push(element);
  return parts.join('\n');
}

/**
 * True when the chip's label/hint/accessibility copy names the find-a-song
 * SEARCH and never claims to identify a recording.
 *
 * The pre-fix fixture for the assertion this guards is the blurb itself: paste
 * `HUM_TO_MODERN_BLURB` into the chip's copy and this returns false.
 */
export function chipDoesNotClaimRecordingRecognition(source: string): boolean {
  const region = chipCopyRegion(source);
  if (region.length === 0) return true;
  return RECORDING_IDENTIFICATION_CLAIMS.every(
    (claim) => region.indexOf(claim) < 0,
  );
}

/** The `styles.<key>: { … }` declaration block for a style key. */
function styleBlock(masked: string, styleKey: string): string {
  const at = masked.indexOf(`${styleKey}: {`);
  if (at < 0) return '';
  return braceBlockFrom(masked, at);
}

/**
 * True when the front door really wires the "Find a song" SEARCH BAR (v45).
 *
 * This REPLACES `findAnySongChipWired` (v33 bundle B, owner 10-02): the element
 * changed shape — a pill chip became the full-width 56 dp bar with the drawn
 * magnifier (designer notes §3 row 3) — but its JOB, its copy source and its
 * handler are identical, so the contract keeps the wiring half and now pins the
 * bar half too:
 *
 *   1. it renders AFTER the hum entry (which itself renders after the hero
 *      button — the order `humEntryWired()` already requires), so the priority
 *      order of the door is unchanged;
 *   2. it is labelled and described from `frontDoorBands` (ONE source of copy);
 *   3. it is styled as a BAR — never `styles.recognitionBtn`, never wired to the
 *      hero handler, so it cannot out-shout the recognition core — and its style
 *      block really carries the bar's 56 dp height and 16 dp radius, so a
 *      "re-chip" (the pill, a 12 dp type row, a bare link) fails here;
 *   4. its handler body opens the destination `FIND_ANY_SONG_DESTINATION` names
 *      (`FindPieceScreen`, behind `setShowFindPiece(true)`) — a bar that renders
 *      and opens nothing is the dead-CTA class this app keeps getting bitten by.
 */
export function findASongBarWired(source: string): boolean {
  const masked = maskComments(source);
  const heroAt = masked.indexOf(`onPress={${HERO_TAP_HANDLER}}`);
  const humAt = masked.indexOf(`onPress={${HUM_ENTRY_HANDLER}}`);
  const barAt = masked.indexOf(`onPress={${FIND_ANY_SONG_CHIP_HANDLER}}`);
  if (heroAt < 0 || humAt < 0 || barAt < 0) return false;
  if (!(heroAt < humAt && humAt < barAt)) return false;

  const element = elementFromTag(masked, FIND_A_SONG_BAR_STYLE);
  if (!element) return false;
  if (element.indexOf(`onPress={${FIND_ANY_SONG_CHIP_HANDLER}}`) < 0) return false;
  // …rendering the module's copy BY REFERENCE (a retyped label would drift from
  // the band model's entry, which is the whole point of one source of copy).
  if (element.indexOf('FIND_ANY_SONG_CHIP_LABEL') < 0) return false;
  if (element.indexOf('FIND_ANY_SONG_CHIP_ACCESSIBILITY_LABEL') < 0) return false;
  // A search bar, not the recognition core's button, and never the hero's handler.
  if (element.indexOf('styles.recognitionBtn') >= 0) return false;
  if (element.indexOf(`onPress={${HERO_TAP_HANDLER}}`) >= 0) return false;
  // …and it is a BAR, not a chip: the numbers live in one place and are pinned.
  const bar = styleBlock(masked, FIND_A_SONG_BAR_STYLE.replace('styles.', ''));
  if (!bar) return false;
  if (!new RegExp(`minHeight:\\s*${FIND_A_SONG_BAR_MIN_HEIGHT}\\b`).test(bar)) return false;
  if (!new RegExp(`borderRadius:\\s*${FIND_A_SONG_BAR_RADIUS}\\b`).test(bar)) return false;

  // The handler's OWN declaration (not `handleFindAnySongFromCard`, the result
  // card's modern bridge, which lives above it).
  const declaration = masked.indexOf(`const ${FIND_ANY_SONG_CHIP_HANDLER} =`);
  if (declaration < 0) return false;
  const body = braceBlockFrom(masked, declaration);
  return /setShowFindPiece\s*\(\s*true\s*\)/.test(body);
}

/**
 * True when the band-C search row READS as a search entry (the audit's D9: the
 * real field is one tap away) — it sits inside band C, carries the front door's
 * own search wording, and its handler opens the screen behind a real text field.
 *
 * This is the row that used to be a hint line under the hero; it now lives in
 * band C, and the whole point of the re-flow is that a musician who knows the
 * piece's name is ONE tap from typing it.
 */
export function findPieceEntryIsSearchRow(source: string, discoverSource: string): boolean {
  const masked = maskComments(source);
  const band = retiredBrowseRegion(source);
  if (!band) {
    // v45 slice 2: the row is retired; the rows that REPLACED its job (the facet
    // chips + the free-library row) carry the contract — and since v46 they live
    // on the Discover surface, so the host source has to come with the call.
    return fragmentEntryPointsAreWired(source, discoverSource);
  }
  if (band.indexOf('styles.findPieceBtn') < 0) return false;
  if (band.indexOf('onPress={handleOpenFindPiece}') < 0) return false;
  // It renders the front door's search wording — a search entry, not a promise.
  if (band.indexOf('FIND_PIECE_ENTRY_HINT') < 0) return false;
  const declaration = masked.indexOf('const handleOpenFindPiece');
  if (declaration < 0) return false;
  const body = braceBlockFrom(masked, declaration);
  if (!/setShowFindPiece\s*\(\s*true\s*\)/.test(body)) return false;
  // …and the screen behind it is really mounted (its field is one tap away).
  return /<FindPieceScreen\s/.test(masked);
}

/**
 * THE FOLD'S ENTRY POINTS STILL OPEN THEIR DESTINATIONS (v45 slice 2, re-pointed
 * for the v46 corrective).
 *
 * The fold retired band C's own "Search by title or composer" row, so the guard
 * that used to prove THAT row existed (`findPieceEntryIsSearchRow`) has nothing
 * left to read. What must still be true — brief §11.8 — is that the rows the fold
 * MOVED are wired, and v46 moved them one screen further (off the door onto the
 * Discover surface, src/screens/FindPieceScreen.tsx, because Home and Discover
 * sat on one page):
 *   • the facet chips still render and every chip has a REAL destination —
 *     `handleFacetChip(facet.id)`, whose money arm builds the licensed search
 *     with `sheetMusicDirectSearchUrl(...)` and opens it via `handleOpenRetailer`
 *     (a chip that renders and does nothing is the dead-CTA class);
 *   • the free-library row still renders on that surface and its tap still
 *     reaches the Library tab — through the `onBrowseLibrary` prop Home hands the
 *     screen, back to `handleBrowseLibraryFromDiscover` and `navigate('Library')`;
 *   • `FindPieceScreen` is still mounted by Home (behind `showFindPiece`), so the
 *     surface every chip and the bar open has a real field.
 *
 * `source` is src/screens/HomeScreen.tsx; `discoverSource` is
 * src/screens/FindPieceScreen.tsx. The discover source is REQUIRED: the rows no
 * longer exist on the door, so a caller that cannot name their host cannot prove
 * they are wired — an empty source fails rather than passing vacuously.
 */
export function fragmentEntryPointsAreWired(source: string, discoverSource: string): boolean {
  const masked = maskComments(source);
  // The free-library row's destination, on the door: its own handler (it closes
  // the in-place search flow, then switches tabs) …
  const libraryDeclaration = masked.indexOf('const handleBrowseLibraryFromDiscover');
  if (libraryDeclaration < 0) return false;
  if (!/navigate\(\s*'Library'\s*\)/.test(braceBlockFrom(masked, libraryDeclaration))) {
    return false;
  }
  // … handed to the Discover surface as a prop, on a screen Home really mounts.
  if (!/<FindPieceScreen\s/.test(masked)) return false;
  if (masked.indexOf('onBrowseLibrary={handleBrowseLibraryFromDiscover}') < 0) return false;

  // The new host: the chips and the row, each wired to something real.
  const discover = maskComments(discoverSource);
  if (discover.length < 4000) return false;
  if (discover.indexOf('facets.map(') < 0) return false;
  if (discover.indexOf('onPress={() => handleFacetChip(facet.id)}') < 0) return false;
  // The money facet's arm — the licensed search, never a hand-written URL.
  if (discover.indexOf('sheetMusicDirectSearchUrl(') < 0) return false;
  if (discover.indexOf('handleOpenRetailer(') < 0) return false;
  // The free-library row + the handler the prop lands in.
  if (discover.indexOf('styles.browseLibraryRow') < 0) return false;
  if (discover.indexOf('onPress={handleBrowseLibrary}') < 0) return false;
  if (discover.indexOf('onBrowseLibrary()') < 0) return false;
  return true;
}

/** The retired band C's own container slice, for the two legacy guards below.
 *  Band `browse` is no longer a BandId, so `bandRegion` cannot take it. */
function retiredBrowseRegion(source: string): string {
  const masked = maskComments(source);
  const at = masked.indexOf('BAND_TEST_IDS.browse');
  return at < 0 ? '' : masked.slice(at, at + 3000);
}
