/**
 * humBridge.ts — the HUM → MODERN bridge, plus the hum screen's start-failure
 * contract (owner-approved 09-22, two-recognition-card product vision).
 *
 * WHY THE BRIDGE EXISTS. Recognition must not be capped by the size of our own
 * library. The hum card ("Hum it") matches a hummed melody against OUR melody
 * catalog only, so a hum we don't hold used to dead-end at "No match for that
 * hum" with nothing but retry and close — the user's tune stayed unidentified
 * and there was no path to the sheet music. The modern card ("Find any song")
 * already had the reverse lever (ModernSongInterstitial: "Can't play it? Hum the
 * melody…"). This module models the missing direction: on a hum miss, offer the
 * user the modern route, where a real recording of the song is identified by the
 * licensed third-party fingerprint service (AudD, 100M+ songs) and the official
 * sheet music is linked through our affiliate partner.
 *
 * So every hum miss becomes a modern-song identification + affiliate-purchase
 * opportunity instead of a wall. The copy here is deliberately honest: we claim
 * we will identify the RECORDING and link the official sheet music *if there is
 * a match* — we never promise the song is in our library, and never promise a
 * purchase link for a piece the retailer may not carry.
 *
 * The second half of this module is the start-failure contract. PR #115 found
 * src/screens/HumSearchScreen.tsx still carried the same silent dead end that
 * had just been removed from the modern screen: `const started = await
 * recorder.startRecording(); if (!started) return;` — a failed start (denied
 * mic, a start that threw, a start swallowed while another was in flight) set
 * NOTHING, so the screen sat there unchanged and every retry tap was eaten.
 * `humStartFailureOutcome()` is the single honest mapping from a start failure
 * to the stage/message the screen must show, modelled exactly like
 * recognitionRetry.startFailureSurface() for the modern path.
 *
 * Pure by design — no react / react-native / fs imports — so the tier1 gate
 * compiles and runs it with node_modules absent (tsconfig.tier1.json). The disk
 * walk lives in the test script (scripts/humModernBridge.test.ts); the
 * source-contract helpers below only reason about source text, and reuse the
 * comment masker from modalBackContract.ts (the guard that caught the v22 white
 * screen).
 */
import { maskComments } from './modalBackContract';
import { startResultIdentifiers } from './modernRetryContract';
import {
  isPermissionFailure,
  startFailureSurface,
  START_FAILURE_COPY,
  type StartFailure,
} from './recognitionRetry';

// ──────────────────────── the no-match card's actions ────────────────────

/** The no-match card's retry label (unchanged — the user can always hum again). */
export const HUM_RETRY_CTA = 'Hum Again';

/** The bridge CTA. Short, actionable, and about the ONE thing this route does:
 *  listen to the song itself rather than to the user's voice. */
export const HUM_TO_MODERN_CTA = 'Play the song instead';

/** The honest sentence under the bridge CTA. It says what actually happens on
 *  the other side: the recording is identified, and the official sheet music is
 *  linked when we have a match. No overclaim about our own library. */
export const HUM_TO_MODERN_BLURB =
  "Can't hum it? Play the song out loud and we'll identify the recording — " +
  'and link the official sheet music if there is a match.';

/** The two actions the hum no-match card must offer. */
export type HumNoMatchActionId = 'retry' | 'find-any-song';

export interface HumNoMatchAction {
  id: HumNoMatchActionId;
  /** The button label. */
  label: string;
  /** The honest supporting line (the bridge action only). */
  blurb?: string;
}

/**
 * Every action on the hum no-match card, in order. Both are ALWAYS present:
 * retrying the hum is the short path, and the modern route is what turns a miss
 * into an identified song + a sheet-music purchase instead of a dead end.
 */
export function humNoMatchActions(): HumNoMatchAction[] {
  return [
    { id: 'retry', label: HUM_RETRY_CTA },
    { id: 'find-any-song', label: HUM_TO_MODERN_CTA, blurb: HUM_TO_MODERN_BLURB },
  ];
}

// ─────────────────────── the hum screen's start failure ──────────────────

/** What the hum screen does when a capture could not be started. `stage` is
 *  always 'error' — the pre-fix code's silence is unreachable by construction. */
export interface HumStartFailureOutcome {
  stage: 'error';
  /** The honest message for the user. Never empty. */
  message: string;
  /** Keep the recorder hook's inline error (and its "Open Settings" affordance)?
   *  Only permission problems are fixed in device settings — everything else is
   *  a recording problem and is surfaced once, through this card. */
  keepHookError: boolean;
}

/**
 * Map a start failure to the stage the screen must show. ALWAYS a visible,
 * non-empty error card — this is what makes the silent dead end impossible
 * (`if (!started) return;` set no state at all, so nothing was ever rendered).
 */
export function humStartFailureOutcome(
  failure: StartFailure | null,
): HumStartFailureOutcome {
  return {
    stage: 'error',
    message:
      startFailureSurface(failure).error ?? START_FAILURE_COPY['start-error'],
    keepHookError: failure ? isPermissionFailure(failure.reason) : false,
  };
}

// ──────────────────────── source contracts (live scan) ───────────────────

/** The JSX expression whose opening `{` is the first one at or after `from`,
 *  up to its matching `}`. Returns '' when the braces do not balance. Used for
 *  an `if (…) { … }` body. */
function braceBlockFrom(masked: string, from: number): string {
  const open = masked.indexOf('{', from);
  return open < 0 ? '' : matchBraces(masked, open);
}

/** The JSX expression that ENCLOSES `at` — the nearest `{` at or before it, up
 *  to its matching `}`. Used for a `{cond && ( … )}` JSX block, where the opening
 *  brace sits just before the condition being searched for. */
function enclosingBraceBlock(masked: string, at: number): string {
  const open = masked.lastIndexOf('{', at);
  return open < 0 ? '' : matchBraces(masked, open);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The stage marker that opens the hum screen's no-match card. */
export const HUM_NO_MATCH_MARKER = "stage === 'no-match'";

/**
 * True when the hum screen's NO-MATCH card renders the bridge action: it calls
 * `onSwitchToModern` and labels the button from HUM_TO_MODERN_CTA. The pre-fix
 * card (retry only, then close) returns false — that is the dead end this
 * feature removes.
 */
export function humNoMatchOffersModern(source: string): boolean {
  const masked = maskComments(source);
  const at = masked.indexOf(HUM_NO_MATCH_MARKER);
  if (at < 0) return false;
  const block = enclosingBraceBlock(masked, at);
  if (!block) return false;
  return /onSwitchToModern/.test(block) && /HUM_TO_MODERN_CTA/.test(block);
}

/**
 * True when a failed `startRecording()` on the hum screen reaches a surface
 * instead of being dropped: the `if (!<ident>)` branch must set an error state
 * AND return. A bare `if (!started) return;` carries no block at all, so the
 * pre-fix source cannot satisfy this.
 */
export function humStartFailureSurfaced(source: string): boolean {
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
      const surfaces = /setErrorMessage\s*\(|setStage\s*\(\s*'error'\s*\)|setError\s*\(/.test(
        body,
      );
      if (surfaces && /\breturn\b/.test(body)) return true;
      match = pattern.exec(masked);
    }
  }
  return false;
}

/** True when `hostSource` renders <HumSearchScreen … onSwitchToModern={…} /> —
 *  the prop is only useful if the host that owns the full-screen flow passes it
 *  through to the modern flow. */
export function hostWiresHumBridge(hostSource: string): boolean {
  const masked = maskComments(hostSource);
  const at = masked.indexOf('<HumSearchScreen');
  if (at < 0) return false;
  const end = masked.indexOf('/>', at);
  if (end < 0) return false;
  return /onSwitchToModern/.test(masked.slice(at, end));
}

/** True when the host still renders <ModernSearchScreen … onHumIt={…} /> — the
 *  reverse lever (modern → hum) that already existed and must keep working. */
export function hostStillWiresModernToHum(hostSource: string): boolean {
  const masked = maskComments(hostSource);
  const at = masked.indexOf('<ModernSearchScreen');
  if (at < 0) return false;
  const end = masked.indexOf('/>', at);
  if (end < 0) return false;
  return /onHumIt\s*=/.test(masked.slice(at, end));
}
