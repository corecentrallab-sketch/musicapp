/**
 * searchSubmitContract.ts — the source-scan contracts for the v49 search-key fix
 * (owner report 11-03: "Find a Piece does not work on home page and second page…
 * Dead on both").
 *
 * WHY A SOURCE SCAN. The bug was not in any logic a unit test can reach: the
 * screen computed the right query, held the right state and rendered the right
 * results — and then bound the keyboard's Search key to `undefined` for every
 * typed query. `onSubmitEditing={prefillPending ? handleSubmitPrefill : undefined}`
 * is valid TypeScript, passes every type check, and ships a key that does nothing.
 * There is no emulator on this box and the tier1 gate runs under plain Node, so
 * the only way to make that shape impossible to reintroduce is to read the app's
 * own source and refuse it.
 *
 * The four theses, each a text predicate over the REAL files:
 *   A. the search field's `onSubmitEditing` is ALWAYS a handler — a bare
 *      identifier that is defined in the same file, never a conditional and never
 *      `undefined` (the shipped defect);
 *   B. that handler SEARCHES NOW: it confirms the OCR proposal, bumps the reload
 *      token and raises the bypass flag the debounce reads — so a submit is a real
 *      request even when the words did not change;
 *   C. the zero-match branch CANNOT render without the retailer route: the
 *      licensed CTA, the tap-only opener and the query-side visibility gate all
 *      live inside the `status === 'empty'` branch, so the dead-end state cannot
 *      come back (plan 09-28: never a dead end);
 *   D. the v42 fix-D OCR gate SURVIVES: a read from a photo is still never
 *      auto-searched — the gate stays in front of the debounce and
 *      `ocrPrefillAutoSearches()` still says the screen does not do it. The fix for
 *      A must never be bought by letting the automatic path search a proposal.
 *
 * Pure: no react / react-native / fs imports (the test reads the files), so
 * tsconfig.tier1.json compiles and runs it under plain Node.
 */
import { maskComments } from './modalBackContract';
import { ocrPrefillAutoSearches } from './uxrV42Contract';

/** The screen the owner's report is about — BOTH doors mount this one file. */
export const SEARCH_SUBMIT_SCREEN_PATH = 'src/screens/FindPieceScreen.tsx';
/** The one prop that wires the keyboard's Search / Enter key. */
export const SUBMIT_PROP = 'onSubmitEditing';
/** The OCR-prefill gate (v42 fix D) that must keep blocking AUTOMATIC searches. */
export const PREFILL_GATE = 'if (prefillPending)';
/** The zero-match branch in the results scroller. */
export const EMPTY_BRANCH_ANCHOR = "status === 'empty'";
/** The one tap-only writer of `retailerUrl` — the money path's only door. */
export const RETAILER_OPEN_HANDLER = 'handleOpenRetailer';
/**
 * The zero-match CTA's own gate. It is pinned because the CTA must render exactly
 * when the pure decision says a URL exists — a `false` here (or a gate that stops
 * reading the decision) is the dead-end state coming back with the same pixels.
 */
export const EMPTY_RETAILER_CTA_GATE = 'noMatch.showRetailer && noMatch.retailerUrl ?';

/** The bypass flag the submit handler raises and the debounced effect reads. */
export const IMMEDIATE_SEARCH_FLAG = 'searchImmediatelyRef';

/** One-line hint printed with any failure of the predicates below. */
export const SEARCH_SUBMIT_FIX_HINT =
  'the Find-a-Piece search field must always bind onSubmitEditing to a real handler (never undefined, never ' +
  'conditional), that handler must run the search immediately and confirm an OCR prefill, the zero-match branch ' +
  'must carry the licensed-retailer route built by services/searchExternal.ts, and the v42 fix-D gate must keep ' +
  'automatic searches off a photo read.';

/**
 * The source text of the JSX expression that starts at the `?` following `anchor`,
 * assuming the house shape `anchor ? ( … ) : …`.
 *
 * Returns '' when the anchor is absent, when there is no `?`, or when the branch
 * body is not wrapped in parentheses — the form every branch on this screen uses,
 * and the form a scan can delimit without parsing JSX.
 */
export function jsxBranchBody(masked: string, anchor: string): string {
  const at = masked.indexOf(anchor);
  if (at < 0) return '';
  const question = masked.indexOf('?', at);
  if (question < 0) return '';
  let i = question + 1;
  while (i < masked.length && /\s/.test(masked[i])) i++;
  if (masked[i] !== '(') return '';
  let depth = 0;
  const start = i;
  for (; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return masked.slice(start, i + 1);
    }
  }
  return '';
}

/**
 * The source text INSIDE the braces of a JSX prop (`onSubmitEditing={X}` → `X`).
 * Returns null when the prop is absent or its braces do not balance.
 */
export function propExpression(masked: string, prop: string): string | null {
  const at = masked.indexOf(`${prop}={`);
  if (at < 0) return null;
  const open = masked.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return masked.slice(open + 1, i).trim();
    }
  }
  return null;
}

/**
 * The identifier bound to a JSX prop, when the binding is a BARE identifier
 * (`onSubmitEditing={handleSubmitSearch}`). Returns null for anything else —
 * a ternary, an arrow, `undefined`, a call — because anything else is either the
 * shipped defect or a handler that cannot be reasoned about from the source.
 */
export function propIdentifier(masked: string, prop: string): string | null {
  const expression = propExpression(masked, prop);
  if (expression === null) return null;
  return /^[A-Za-z_$][\w$]*$/.test(expression) ? expression : null;
}

/** True when `name` is defined in this file (a const or a function declaration). */
export function definesHandler(masked: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*const\\s+${escaped}\\s*=`),
    new RegExp(`(?:^|\\n)\\s*function\\s+${escaped}\\s*\\(`),
    new RegExp(`(?:^|\\n)\\s*const\\s+${escaped}\\s*:\\s*[^=]+=`),
  ];
  return patterns.some((re) => re.test(masked));
}

/**
 * THESIS A — the search key always runs a handler.
 *
 * All of these must hold on `FindPieceScreen.tsx`:
 *   • `onSubmitEditing` appears (exactly once: one field, one submit path);
 *   • its binding is never `undefined` and never conditional (`?`, `&&`, `||`) —
 *     "which mode am I in" may never decide whether the key works;
 *   • a bare identifier binding must be defined in this file.
 */
export function submitKeyAlwaysRunsAHandler(source: string): boolean {
  const masked = maskComments(source);
  const occurrences = masked.split(`${SUBMIT_PROP}=`).length - 1;
  if (occurrences !== 1) return false;
  const expression = propExpression(masked, SUBMIT_PROP);
  if (expression === null || expression === '') return false;
  // THE SHIPPED DEFECT: a key bound to nothing for one of its two modes.
  if (/undefined/.test(expression)) return false;
  if (/[?]|&&|\|\|/.test(expression)) return false;
  const name = propIdentifier(masked, SUBMIT_PROP);
  if (name) return definesHandler(masked, name);
  // Anything else (an inline arrow, say) is accepted only if it actually calls
  // something — `onSubmitEditing={() => {}}` is the same no-op in a new costume.
  return /=>/.test(expression) && /[A-Za-z_$][\w$]*\s*\(/.test(expression);
}

/**
 * THESIS B — an explicit submit is a real, immediate request.
 *
 * The handler the key runs must:
 *   • clear the OCR gate (`setPrefillPending(false)`) — the user's own submit is
 *     the agreement v42 fix D requires;
 *   • bump the reload token, so a submit on unchanged words re-runs the search
 *     instead of silently doing nothing;
 *   • raise the bypass flag, and the debounced effect must READ that flag while
 *     still using the debounce constant — i.e. the wait is skipped on purpose, not
 *     deleted for everyone.
 */
export function submitHandlerSearchesImmediately(source: string): boolean {
  const masked = maskComments(source);
  const name = propIdentifier(masked, SUBMIT_PROP);
  if (!name) return false;
  // The handler's own body, delimited by the house `}, [deps]);` tail.
  const defAt = masked.indexOf(`const ${name} = useCallback(`);
  if (defAt < 0) return false;
  const end = masked.indexOf('\n  }, [', defAt);
  if (end < 0) return false;
  const body = masked.slice(defAt, end);
  if (body.indexOf('setPrefillPending(false)') < 0) return false;
  if (body.indexOf('setReloadToken(') < 0) return false;
  if (body.indexOf(`${IMMEDIATE_SEARCH_FLAG}.current = true`) < 0) return false;
  // …and the effect must honour it while keeping the debounce for typing.
  if (masked.split(IMMEDIATE_SEARCH_FLAG).length - 1 < 2) return false;
  if (masked.indexOf('CATALOG_SEARCH_DEBOUNCE_MS') < 0) return false;
  return true;
}

/**
 * THESIS C — the zero-match branch carries the retailer route.
 *
 * The `status === 'empty'` branch must, INSIDE it:
 *   • render the licensed CTA from the pure decision (`noMatch.retailerUrl`), so
 *     the link is the shared builder's and carries the user's own words;
 *   • open it through the one tap-only opener (`handleOpenRetailer`) — never an
 *     auto-redirect;
 *   • keep the query-side visibility gate (`external.visible`), so the route is
 *     present exactly when there is something to search for;
 *   • keep the honest no-match line (`NO_MATCH_MESSAGE`), so the money path never
 *     replaces the truth about our own library.
 */
export function emptyStateCarriesTheRetailerRoute(source: string): boolean {
  const masked = maskComments(source);
  const body = jsxBranchBody(masked, EMPTY_BRANCH_ANCHOR);
  if (body === '') return false;
  // The CTA is GATED ON THE DECISION that proved a URL exists: a `false` gate, or
  // a gate that stopped reading `noMatch`, renders the same pixels with no route.
  if (body.indexOf(EMPTY_RETAILER_CTA_GATE) < 0) return false;
  if (body.indexOf('noMatch.retailerUrl') < 0) return false;
  if (body.indexOf(RETAILER_OPEN_HANDLER) < 0) return false;
  if (body.indexOf('external.visible') < 0) return false;
  if (body.indexOf('NO_MATCH_MESSAGE') < 0) return false;
  // A CTA wired to `undefined` is the shipped defect wearing a different hat.
  return body.indexOf('undefined') < 0;
}

/**
 * THESIS D — the v42 fix-D OCR gate survives the fix.
 *
 * A read from a photo is a PROPOSAL: it must not be searched until the user acts.
 * The gate must still sit in front of the debounce, and the tested v42 predicate
 * must still report that this screen does not auto-search a read.
 */
export function prefillGateSurvivesSubmitFix(source: string): boolean {
  const masked = maskComments(source);
  const gateAt = masked.indexOf(PREFILL_GATE);
  if (gateAt < 0) return false;
  const debounceAt = masked.indexOf('setTimeout(');
  if (debounceAt >= 0 && gateAt > debounceAt) return false;
  return ocrPrefillAutoSearches(source) === false;
}
