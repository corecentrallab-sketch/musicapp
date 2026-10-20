/**
 * ocrPrefill.ts — THE OCR TEXT IS A PROPOSAL, NEVER A QUERY (v42 fix D).
 *
 * THE OWNER'S COMPLAINT (v41 device pass, 10-20): a photographed Bohemian
 * Rhapsody score was read on device and the search box filled with
 * "a-thy,Be-cause I'm Freddie Mercury" — and the app searched it immediately,
 * landed on "No Match", and left the user holding a result for words they never
 * typed and could not see themselves agreeing to.
 *
 * THE DEFECT. FindPieceScreen seeds `query` from `initialQuery` and its debounced
 * search effect runs on `[query, reloadToken]` — so a caller that handed in the
 * recogniser's words got an AUTOMATIC query on the first frame. The words were
 * visible in the field, but the search had already happened: an invisible
 * auto-query is exactly the "the app decided for me" class the owner keeps
 * hitting, and the garbage read made it worse.
 *
 * THE RULE, as data. A prefilled (read-from-a-photo) query starts PENDING: the
 * words are in the field, an honest line says where they came from, and NOTHING
 * searches until the user acts — edit the text, then tap the search control (or
 * the keyboard's own search key). Once the user has acted, the screen is the
 * ordinary type-ahead search it has always been.
 *
 * PURE: no react, no react-native, no fs. Compiled by tsconfig.tier1.json and
 * asserted by scripts/uxr-v42-fixes.test.ts.
 */

/** What the field holds before the user has acted on a prefilled read. */
export interface OcrPrefillState {
  /** The words in the search box (the recogniser's own output, never a guess). */
  query: string;
  /** True while the words are a PROPOSAL — no search may run in this state. */
  pending: boolean;
}

/** The line above the results while the read words are still a proposal. */
export const OCR_PREFILL_NOTE =
  'These words were read from your photo — not typed by you. Check them, edit if they are wrong, then search.';

/** The one control that turns the proposal into a search. */
export const OCR_PREFILL_SEARCH_CTA = 'Search these words';

/** What the results area says instead of "No match" while nothing has been searched. */
export const OCR_PREFILL_WAITING_LINE =
  'Nothing searched yet — the words above are what the app read from the photo.';

/** The empty field's own line, so a blank read is not a silent blank box. */
export const OCR_PREFILL_EMPTY_NOTE =
  'The app read no usable words on that photo. Type a title or composer to search.';

/**
 * THE STATE A CALLER'S PREFILL STARTS IN. A blank/absent/non-string prefill is
 * NOT a proposal (there is nothing to agree to) — the screen opens as it always
 * did, with an empty field the user types into.
 */
export function initialOcrPrefillState(initialQuery?: unknown): OcrPrefillState {
  const text = typeof initialQuery === 'string' ? initialQuery.trim() : '';
  return { query: text, pending: text.length > 0 };
}

/**
 * MAY THE DEBOUNCED SEARCH RUN? The one gate the screen's effect consults. A
 * pending proposal never searches, whatever else the state says.
 */
export function maySearchOcrPrefill(state: OcrPrefillState): boolean {
  return state.pending !== true;
}

/**
 * THE USER'S ACTION: they read the words and asked for the search. The proposal
 * becomes an ordinary query — and if the text is blank there is nothing to
 * search, so the screen stays in its honest empty state rather than firing a
 * request for the empty string.
 */
export function confirmOcrPrefill(state: OcrPrefillState): OcrPrefillState {
  return { query: state.query, pending: false };
}

/** The note to show above the results for a state (null when there is none). */
export function ocrPrefillNote(state: OcrPrefillState): string | null {
  if (state.pending !== true) return null;
  return state.query.length > 0 ? OCR_PREFILL_NOTE : OCR_PREFILL_EMPTY_NOTE;
}

/** Whether the confirm control should be offered (there must be words to search). */
export function canConfirmOcrPrefill(state: OcrPrefillState): boolean {
  return state.pending === true && state.query.trim().length > 0;
}
