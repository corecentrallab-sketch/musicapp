/**
 * modernInterstitialSurface.ts — which surface the modern-song interstitial shows.
 *
 * Why this module exists (owner-reproduced on device, 09-22): on a recognized
 * modern song, tapping "🛒 Get the Official Sheet Music" set `retailerUrl`, and
 * that flipped ModernSongInterstitial into a branch that returned a PLAIN
 * `<View>` holding the retailer `<WebView>` — not a `<Modal>`. Consequences:
 *
 *   1. the recognized-song `<Modal>` unmounted, so the screen underneath (the
 *      caller — ModernSearchScreen's "Find any song" card) became visible again:
 *      the owner saw "the app immediately closes the page and takes me back to
 *      the Find-any-song card";
 *   2. the WebView had no native overlay of its own, and no `onRequestClose`, so
 *      hardware BACK could not return the user to the interstitial — it reached
 *      the caller instead;
 *   3. the modalBackContract scanner never saw it, because a plain `<View>` is
 *      invisible to a modal scanner (that is how the defect shipped).
 *
 * The fix is structural (the retailer page now lives in its own full-screen
 * `<Modal>`), but the *decision* of which surface is on screen is pure logic, so
 * it lives here — free of react / react-native imports — and the tier1 gate can
 * assert it without an emulator. The component's render chain mirrors this
 * function exactly, one branch per surface.
 *
 * Owner's hard UX rule (08-24): we never auto-redirect to the retailer. The
 * retailer opens inside our own app shell, and BACK / "← Back to NoteSnap"
 * returns to the recognized-song interstitial — position preserved, never out to
 * the caller's card.
 */
import type { ModernMatch } from '../types';

/** Which of the interstitial's surfaces is on screen right now. */
export type InterstitialSurface =
  /** The whole component renders nothing (its `visible` prop is false). */
  | 'hidden'
  /** "Listening for a song..." spinner. */
  | 'loading'
  /** The honest error card with Cancel / Try Again. */
  | 'error'
  /** The in-app retailer page (its OWN full-screen Modal). */
  | 'retailer'
  /** The recognized-song interstitial (song identity + buy button + levers). */
  | 'recognized'
  /** "No modern song found" — the honest no-match card. */
  | 'no-match';

/** The interstitial's props plus the local retailer-URL state it owns. */
export interface InterstitialViewState {
  visible: boolean;
  loading: boolean;
  error: string | null;
  match: ModernMatch | null;
  /** true only when the server returned a real identified song. */
  recognized: boolean;
  /** The retailer page the user opened from the interstitial, or null. */
  retailerUrl: string | null;
}

/**
 * The one place the render order is decided. Order matters and matches the
 * component: hidden → loading → error → retailer → recognized → no-match.
 *
 * `retailerUrl` only ever outranks the interstitial when we actually have a
 * recognized match to go back to, so a stray URL can never strand the user on a
 * page with nothing behind it.
 */
export function interstitialSurface(
  state: InterstitialViewState,
): InterstitialSurface {
  if (!state.visible) return 'hidden';
  if (state.loading) return 'loading';
  if (state.error) return 'error';
  if (state.match && state.recognized) {
    return state.retailerUrl ? 'retailer' : 'recognized';
  }
  return 'no-match';
}

/**
 * What hardware BACK (and "← Back to NoteSnap") does to the state: it drops the
 * retailer page and leaves the user on the recognized-song interstitial. Pure and
 * non-mutating, so the component and the test agree on the semantics.
 */
export function closeRetailer<S extends InterstitialViewState>(state: S): S {
  return { ...state, retailerUrl: null };
}
