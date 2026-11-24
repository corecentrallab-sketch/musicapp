/**
 * scoreWindowContext — "AM I INSIDE THE FULL-SCREEN SCORE WINDOW?" (vc66, F1/F2/F3).
 *
 * WHY A CONTEXT AND NOT A PROP. The window (`components/FullScreenScore`) is
 * presentation only: every surface hands it the SAME element it already draws, and
 * that element is a `components/AbcScoreView` whose props were chosen for the card
 * it came from — a fixed four-bar reader drawing, measured once and never
 * re-measured for the box it lands in. The window cannot rewrite those props (they
 * are already baked into the element), so it tells the renderer where it is
 * instead, and the renderer lays the score out for the window it is really in
 * (`services/scoreWindow.scoreWindowDocument`).
 *
 * A separate module on purpose: `AbcScoreView` needs the context and
 * `FullScreenScore` provides it, so holding the context in either of them would
 * make the two components import each other.
 *
 * DEFAULT FALSE — outside the window every renderer keeps the document its own
 * surface asked for, byte for byte (D27, D40b).
 */
import { createContext, useContext } from 'react';

/** True while a renderer is being drawn inside the full-screen score window. */
export const ScoreWindowContext = createContext(false);

/** The window's own answer, for a renderer deciding how to lay a score out. */
export function useFullScreenScoreWindow(): boolean {
  return useContext(ScoreWindowContext);
}
