/**
 * searchSubmit.ts — WHAT THE SEARCH KEY DOES (v49 fix, owner report 11-03).
 *
 * THE DEFECT THIS EXISTS FOR. The owner typed "heroes by David Bowie" into
 * "Find a Piece" and pressed the keyboard's Search key: nothing happened, on both
 * the front page and Discover. Both doors mount `screens/FindPieceScreen.tsx`, and
 * its field was wired
 *
 *     onSubmitEditing={prefillPending ? handleSubmitPrefill : undefined}
 *
 * so for every normally TYPED query (`prefillPending === false`, i.e. every query
 * a human typed rather than the OCR flow reading) the search key was bound to
 * `undefined`. The key did literally nothing. A submit that is a silent no-op is
 * the worst kind of defect: the user has done everything right and the app
 * answers with nothing at all.
 *
 * THE RULE, in one place, pure and tested: a submit is ALWAYS an action.
 *   • non-empty query → search NOW (no waiting for the 300 ms debounce), drop the
 *     keyboard, and re-run even when the words did not change (the user pressing
 *     Search on an already-searched query is asking for it again — the answer
 *     must never be "I already did that, silently");
 *   • empty query     → there is nothing to search, so SAY SO (the visible notice
 *     below) and put the cursor back in the field. Still a state change, never a
 *     no-op;
 *   • a query the app itself READ off a photo (`prefillPending`) → the user's own
 *     submit is the explicit agreement v42 fix D requires, so the plan reports
 *     `confirmsPrefill` and the screen clears the gate. The AUTOMATIC path stays
 *     gated: nothing in this module makes a read search itself.
 *
 * Pure: no react / react-native / expo imports, so tsconfig.tier1.json compiles
 * and runs it under plain Node.
 */
import { normalizeSearchQuery } from './searchExternal';

/** The visible line an EMPTY submit leaves behind (never a silent no-op). */
export const SEARCH_SUBMIT_EMPTY_NOTICE =
  'Type a title or composer first — then press search.';

/** What a submit resolved to. */
export type SearchSubmitKind = 'search' | 'empty';

export interface SearchSubmitPlan {
  /** `search` = run it now; `empty` = nothing to search, show the notice. */
  kind: SearchSubmitKind;
  /** The normalised words the search will actually use (one normaliser app-wide). */
  query: string;
  /**
   * TRUE when the words being submitted are the app's own OCR read and this
   * submit is the user agreeing to them (v42 fix D). The screen clears
   * `prefillPending` on this — and only on this.
   */
  confirmsPrefill: boolean;
  /** TRUE when the request must bypass the type-ahead debounce. */
  immediate: boolean;
  /** The visible notice to render for an empty submit, else null. */
  notice: string | null;
}

/**
 * The ONE decision behind the search key, the prefill card's "Search these words"
 * control, and (later) any other explicit submit. Total: every input produces a
 * plan, and no plan is "do nothing".
 */
export function planSearchSubmit(input: {
  query: unknown;
  prefillPending?: boolean;
}): SearchSubmitPlan {
  const query = normalizeSearchQuery(input ? input.query : '');
  const pending = !!(input && input.prefillPending === true);
  if (query === '') {
    return {
      kind: 'empty',
      query,
      confirmsPrefill: false,
      immediate: false,
      notice: SEARCH_SUBMIT_EMPTY_NOTICE,
    };
  }
  return {
    kind: 'search',
    query,
    confirmsPrefill: pending,
    immediate: true,
    notice: null,
  };
}
