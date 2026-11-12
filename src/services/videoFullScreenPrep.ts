/**
 * videoFullScreenPrep.ts — WHAT THE FULL-SCREEN WINDOW SAYS WHILE IT WAITS (vc55, F2).
 *
 * THE OWNER, vc54 handset pass (2026-11-11): *"it is very slow and confusing as
 * there is a very substantial lag until full screen is available… 15–20 seconds
 * lag or more depending on the size of the video and audio capture. Maybe an
 * indicator to let the user know that the video is being processed as full screen
 * won't open until the video is fully processed."*
 *
 * WHAT WAS WRONG. The in-app window mounted a second `expo-av` player over the
 * same local file and drew a BLACK RECTANGLE until that player reported its first
 * frame. On a large take that is many seconds of a frozen-looking screen with a
 * Play button that did nothing and no word about why.
 *
 * THE RULE THIS FILE PINS (pure — no react, no expo, no device):
 *   • the window is PREPARING from the moment it opens until the player reports a
 *     loaded file or a first frame;
 *   • while it is preparing the surface shows a spinner and a sentence, and the
 *     Play control is disabled rather than tappable-but-dead;
 *   • the copy NEVER claims a duration it cannot measure. The app cannot know how
 *     long a decode will take on a given handset, so it says "preparing" and
 *     nothing about seconds or remaining time.
 *
 * PURE: this module holds the state machine and the copy, so the tier1 gate can
 * pin both without an emulator.
 */

/** The line over the window while the player is coming up. */
export const FULL_SCREEN_PREPARING_LINE = 'Preparing the full-screen video…';

/** Why the window is not playing yet, said without a made-up number. */
export const FULL_SCREEN_PREPARING_HINT =
  'A long take takes longer to open here. The video starts as soon as it is ready — nothing has been lost.';

/** The Play control's own label while the window is not ready. */
export const FULL_SCREEN_PREPARING_CTA = 'Preparing…';

/** Every state the window's preparing indicator can be in. */
export type FullScreenPrepState = 'idle' | 'preparing' | 'ready' | 'failed';

/** The events the window reports to the state machine. */
export type FullScreenPrepEvent = 'opened' | 'ready' | 'failed' | 'closed';

/**
 * The state a window opens in. A window with no file has nothing to prepare (it
 * shows the honest missing line instead), so it opens `idle` and never claims to
 * be working on something that does not exist.
 */
export function fullScreenPrepOnOpen(uri: string | null | undefined): FullScreenPrepState {
  return typeof uri === 'string' && uri.length > 0 ? 'preparing' : 'idle';
}

/**
 * The state after an event. `ready` and `failed` are terminal for one opening;
 * only a fresh `opened` starts a new wait, so a late event from a closed window
 * cannot resurrect a spinner over the page.
 */
export function fullScreenPrepOnEvent(
  state: FullScreenPrepState,
  event: FullScreenPrepEvent,
): FullScreenPrepState {
  switch (event) {
    case 'opened':
      return state === 'idle' ? 'idle' : 'preparing';
    case 'ready':
      return state === 'preparing' ? 'ready' : state;
    case 'failed':
      return state === 'preparing' ? 'failed' : state;
    case 'closed':
      return 'idle';
    default:
      return state;
  }
}

/** Whether the window is still coming up (spinner + disabled Play). */
export function fullScreenIsPreparing(state: FullScreenPrepState): boolean {
  return state === 'preparing';
}

/**
 * Whether the window's own Play control may be pressed. A window that is still
 * preparing, or that has no file, refuses the press — a control that looks live
 * and does nothing is the defect this whole file exists to stop.
 */
export function fullScreenCanPlay(state: FullScreenPrepState): boolean {
  return state === 'ready';
}

/**
 * TRUE when a string claims a specific wait — "5 seconds", "20s left", "about a
 * minute". Used by the gate to prove the preparing copy makes no promise the app
 * cannot keep: it cannot measure a decode on someone else's handset.
 */
export function claimsAWaitDuration(text: string): boolean {
  const value = String(text ?? '');
  if (/\d+\s*(s|sec|secs|second|seconds)\b/i.test(value)) return true;
  if (/\d+\s*(m|min|mins|minute|minutes)\b/i.test(value)) return true;
  if (/\b\d+\s*%/i.test(value)) return true;
  return /(remaining|left to go|about \d)/i.test(value);
}
