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
/** The hum fallback state — the SAME button, after an ambient miss. */
export const HERO_CTA_HUM = 'Tap to hum it';
/** A live hum capture. */
export const HERO_CTA_HUMMING = 'Humming…';
/** A recognition/hum request is in flight. */
export const HERO_CTA_BUSY = 'Identifying…';

/** The idle support line (unchanged owner-approved wording). */
export const HERO_SUPPORT_IDLE =
  'Hear a song you want to play? Tap to identify it and get the sheet music instantly.';
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
  'Tap the button and hum a phrase (8–12s), then tap again to find it.';
/** The no-match card's action that hands the user into the hum fallback. */
export const HUM_FALLBACK_BUTTON = '🎤 Hum, whistle or sing the melody';
/** The honest library-size note under the fallback (same as the hum screen's). */
export const HUM_FALLBACK_LIBRARY_NOTE =
  'Library still growing — try a well-known melody (Für Elise, Ode to Joy).';

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
      return opts.isPro
        ? `${HERO_SUPPORT_IDLE} Unlimited recognitions.`
        : `${HERO_SUPPORT_IDLE} (${opts.freeRecognitions}/5 free recognitions)`;
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
 * Adapt a hum search result for the EXISTING recognition result card, so the
 * inline fallback reuses the surface the user already knows instead of growing a
 * second result UI.
 *
 * HONESTY RULES BAKED IN: a hum match comes from OUR public-domain melody
 * library, so `is_public_domain: true` — and therefore `purchase_url: null` and
 * `sheet_music_url: null`. The card can never offer a retail redirect for a
 * public-domain hum match, and it shows the honest "sheet music coming soon"
 * state rather than a broken link.
 */
export function humMatchToResultResponse(
  hum: HumResponse,
  matches: readonly HumMatch[],
): RecognitionResponse {
  return {
    success: true,
    query_duration_ms: hum.query_duration_ms,
    db_available: hum.db_available,
    matches: matches.map((m) => ({
      piece_id: m.piece_id,
      title: m.title,
      composer: m.composer,
      catalog: null,
      confidence: m.confidence,
      album_art_url: null,
      sheet_music_url: null,
      tab_url: null,
      matched_at_s: 0,
      is_public_domain: true,
      sheet_music_available: false,
      purchase_url: null,
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

/** True when the hero button itself (the big round red one) is wired to the ONE
 *  front-door handler and renders its label state. */
export function heroButtonWired(source: string): boolean {
  const masked = maskComments(source);
  const at = masked.indexOf('styles.recognitionBtn');
  if (at < 0) return false;
  const open = masked.lastIndexOf('<TouchableOpacity', at);
  const end = masked.indexOf('</TouchableOpacity>', at);
  if (open < 0 || end < 0) return false;
  const tag = masked.slice(open, end);
  return (
    /onPress=\{handleHeroTap\}/.test(tag) && /heroLabel\(/.test(tag)
  );
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

/** True when "Find a piece" is the secondary search-field entry under the hero
 *  button (not a competing CTA), labelled from this module. */
export function findPieceIsSearchEntry(source: string): boolean {
  const masked = maskComments(source);
  if (!/onPress=\{handleOpenFindPiece\}/.test(masked)) return false;
  if (masked.indexOf('FIND_PIECE_ENTRY_LABEL') < 0) return false;
  const tag = tagAround(masked, 'styles.findPieceBtn');
  return /onPress=\{handleOpenFindPiece\}/.test(tag);
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
    block.indexOf('HUM_TO_MODERN_CTA') >= 0
  );
}
