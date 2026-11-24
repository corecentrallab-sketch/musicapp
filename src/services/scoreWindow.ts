/**
 * scoreWindow.ts — THE FULL-SCREEN SCORE WINDOW'S OWN RULES (vc66, F1/F2/F3).
 *
 * THE OWNER'S v65 REPORT, three failures that turned out to be ONE surface:
 *
 *   1. "Page does not go to full screen ... only the page header and footer goes
 *      away and the page does not fill the screen" — the music kept its card size.
 *   2. "Does not rotate to landscape" — turning the phone changed nothing.
 *   3. "Library score ... full screen shows a cut-off page, score unreadable" —
 *      the same score that wraps correctly in its card was clipped in the window.
 *
 * WHY THEY ARE ONE ROOT. The window (`components/FullScreenScore`) is presentation
 * only: it hands the renderer the element the surface already draws, and the
 * renderer (`components/AbcScoreView`) picked its document from what that element
 * asked for. A score card asks for the READER document — a FIXED `staffwidth`
 * (four bars) at a fixed scale, so the drawing is the same pixels whatever box it
 * lands in: wider than a phone (it pans sideways, F3's cut-off page) and far
 * shorter than a full screen (the page does not fill it, F1). That document is
 * measured ONCE, from constants, and never re-measured for the window it is in —
 * which is also why rotating changed nothing (F2): the box changed, the drawing
 * did not.
 *
 * THE RULES HERE:
 *   • THE WINDOW LAYS THE SCORE OUT FOR THE WINDOW — the wrapped document (fit to
 *     the width it really has, then stack systems down the page), at the reader's
 *     legibility floor. Nothing is wider than the window (F3), and the music uses
 *     the height it is given (F1). The wrapped document redraws on `resize`, so a
 *     rotation re-lays it out instead of keeping the old one (F2).
 *   • THE WINDOW HOLDS THE PHONE FREE TO ROTATE, by LOCKING to
 *     `ALL_BUT_UPSIDE_DOWN` — not by unlocking. `unlockAsync()` hands the decision
 *     back to the device's auto-rotate setting, which is off on a phone that has
 *     been locked upright (and the app itself locks phones to portrait at startup,
 *     App.tsx), so "unlock" was a no-op on the owner's handset. A lock that
 *     permits both orientations is honoured whatever that setting says.
 *
 * PURE: no react, no react-native, no expo. Asserted by
 * scripts/vc66ScoreWindow.test.ts.
 */
import { READER_MIN_SCALE, WRAP_DEFAULT_SCALE } from './abcHtml';

/**
 * The orientation the window holds while it is open. Both upright orientations and
 * both sideways ones: a score reads fine either way, and the user's own hand is
 * the authority — but the phone is never left upside down.
 */
export const SCORE_WINDOW_ORIENTATION_LOCK = 'ALL_BUT_UPSIDE_DOWN';

/** What the window asks the orientation service for, opening and closing. */
export interface ScoreWindowOrientationPlan {
  /** The lock to take while the window is open (always a real lock, never an unlock). */
  open: string;
  /** The lock that was in force before, or null when there was none to restore. */
  close: string | null;
}

/**
 * THE PLAN, from the lock the window found on open.
 *
 * `priorLock` is whatever `getOrientationLockAsync()` returned — read as `unknown`
 * because the orientation service is allowed to be missing or to answer junk, and
 * a failure to READ the previous lock must never cancel the lock this window needs
 * (the old code did both inside one `try`, so an unreadable lock silently skipped
 * the unlock as well). A previous lock that is not a usable string restores as
 * "unlock", which is the honest default: nothing was readable, so nothing is
 * claimed.
 */
export function scoreWindowOrientationPlan(priorLock: unknown): ScoreWindowOrientationPlan {
  const prior = typeof priorLock === 'string' && priorLock.length > 0 ? priorLock : null;
  return { open: SCORE_WINDOW_ORIENTATION_LOCK, close: prior };
}

/** Which document the renderer must draw inside the window. */
export type ScoreWindowDocument = 'wrapped' | 'as-given';

/**
 * THE DOCUMENT RULE (F1/F3). Inside the window the score is always laid out for the
 * window — `wrapped` — whatever the surface's card asked for. Outside it, the
 * caller's own choice stands untouched (a card keeps the D27/D40b decision it
 * already makes, byte for byte).
 */
export function scoreWindowDocument(input: {
  inWindow: boolean;
  /** The surface asked for the wrapped document by name (a take). */
  wrapSystems?: boolean;
  /** The card decided to wrap because the score does not fit it (D40b). */
  autoWrap?: boolean;
}): ScoreWindowDocument {
  if (input.inWindow) return 'wrapped';
  return input.wrapSystems === true || input.autoWrap === true ? 'wrapped' : 'as-given';
}

/**
 * THE SCALE THE WINDOW DRAWS AT — never below the reader's legibility floor, and
 * the wrapped document's own natural size when the surface named no scale. A
 * window that drew smaller than the card it came from would be the owner's
 * complaint in reverse.
 */
export function scoreWindowWrapScale(readerScale: unknown): number {
  const value = Number(readerScale);
  if (!Number.isFinite(value) || value <= 0) return WRAP_DEFAULT_SCALE;
  return Math.max(READER_MIN_SCALE, value);
}
