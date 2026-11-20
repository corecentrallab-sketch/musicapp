/**
 * scoreReaderViewport.ts — THE PURE HALF OF D37 (owner 11-17: *"I am unable to
 * read the score as the print is so compressed. There needs to be a full screen
 * option… This really needs a fix."*).
 *
 * THREE FACTS ABOUT A FULL-SCREEN READER THAT LIVE IN NUMBERS, NOT IN LAYOUT:
 *
 *   1. PINCH-TO-ZOOM. A reader draws four bars to a system, so the drawing is
 *      WIDER than a phone and the owner has to be able to enlarge what he is
 *      looking at. The document already declares `user-scalable=yes` up to
 *      `maximum-scale`, but an Android WebView only honours a pinch when its
 *      built-in zoom is switched on — and the on-screen +/− widget it turns on
 *      with it is not wanted. `readerZoomProps` is that pair, as data, so the
 *      gate can assert it instead of trusting a prop list in a component.
 *
 *   2. LANDSCAPE IS A DIFFERENT DOCUMENT, NOT THE SAME ONE RE-SIZED. The viewer
 *      document is keyed on the ABC (so a transposed copy repaints — v33 §F5b).
 *      A rotation changes nothing in that key, so the WebView kept a document
 *      laid out for the OLD width: the score was drawn for the window it was
 *      built in and the sideways pan landed on paper. `readerViewportKey` puts
 *      the window's own size into the key, so turning the phone rebuilds the
 *      document for the size it is now in.
 *
 *   3. THE CARD IS UNTOUCHED. Both rules are reader-only: a card keeps the
 *      document it has always had, and neither function may ever leak a value
 *      into the card's path (see `scripts/d37FullScreenScore.test.ts`).
 *
 * PURE: no react, no react-native, no expo.
 */

/** The zoom ceiling the reader document declares (`maximum-scale`). */
export const READER_MAX_ZOOM = 3;

/**
 * THE WEBVIEW SWITCHES THAT MAKE A PINCH A ZOOM (Android).
 *
 * `setBuiltInZoomControls` is what tells the Chromium WebView to honour a pinch
 * at all; `setDisplayZoomControls: false` then hides the floating +/− widget,
 * because the gesture is the control — the owner asked to read the score, not to
 * find a zoom button. An empty object for a non-reader: the card's WebView keeps
 * exactly the props it had, so no card can start zooming under a page that
 * scrolls.
 */
export function readerZoomProps(isReader: boolean): {
  setBuiltInZoomControls?: boolean;
  setDisplayZoomControls?: boolean;
} {
  return isReader ? { setBuiltInZoomControls: true, setDisplayZoomControls: false } : {};
}

/**
 * THE VIEWPORT PART OF A READER'S WEBVIEW KEY — `''` when there is nothing
 * truthful to say (a headless render, a 0-height window mid-rotation), so a junk
 * dimension can never churn the key on every frame.
 *
 * Two different sizes must always produce two different keys: that is the whole
 * point (a rotation is a new document).
 */
export function readerViewportKey(width: unknown, height: unknown): string {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '';
  return `-vp${w}x${h}`;
}
