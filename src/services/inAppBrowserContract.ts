/**
 * inAppBrowserContract.ts — every in-app browser surface must live in its own Modal.
 *
 * Why this exists (owner-reproduced on device, 09-22): the modern-song → affiliate
 * money path renders a retailer page in an in-app `<WebView>`. That WebView was
 * returned from a PLAIN `<View>` branch:
 *
 *   if (match && recognized && retailerUrl) {
 *     return <View style={styles.webviewContainer}> … <WebView …/> </View>;
 *   }
 *
 * Because it was not a Modal, the recognized-song `<Modal>` unmounted underneath
 * it — the caller's card became visible again (the owner: "the app immediately
 * closes the page and takes me back to the Find-any-song card") — and BACK had no
 * `onRequestClose` to return the user to the interstitial.
 *
 * The modalBackContract scanner could not see this: it only scans `<Modal>` tags,
 * and a plain `<View>` has none. This module scans the other direction: it finds
 * every returned tree that renders a `<WebView>` and requires that tree's ROOT
 * element to be a `<Modal>` carrying `onRequestClose`. That is the class-level
 * guard: the house rule "an in-app browser opens inside our own app shell as a
 * full-screen Modal that BACK can close" is enforced on the render tree, where
 * the detail that matters is the modal wrapper — not on the URL or the button.
 *
 * One deliberate exemption: the app's own INLINE app-rendered WebViews — markup
 * this app generates itself and embeds inside one of its own layouts — are not
 * browser surfaces at all. See `INLINE_APP_RENDERED_WEBVIEWS` below, which is the
 * single source of truth: every scanner that enforces this rule consults that
 * list, so the rule and its exemptions cannot drift apart.
 *
 * Pure by design — no react / react-native / fs imports — so the tier1 gate can
 * compile and run it with node_modules absent (see tsconfig.tier1.json). The disk
 * walk lives in the test script; this file only reasons about source text.
 */
import {
  lineAt,
  maskComments,
  readModalTag,
  type SourceFile,
} from './modalBackContract';

/** One `return …;` statement's returned expression, in masked source text. */
export interface ReturnBlock {
  /** Offset of the `return` keyword. */
  start: number;
  /** Offset just past the returned expression (after its `;`). */
  end: number;
  /** The returned expression, comments blanked out. */
  text: string;
}

/** A returned tree that renders a `<WebView>` — an in-app browser surface. */
export interface BrowserSurface {
  path: string;
  /** 1-based line of the `return` that renders it. */
  line: number;
  /** Root JSX element of the returned tree ('Modal', 'View', …), or null. */
  rootTag: string | null;
  /** The root element's opening tag (whitespace-collapsed), or null. */
  rootTagSource: string | null;
}

export type BrowserViolationReason = 'not-in-modal' | 'no-back-handler';

/** A browser surface that breaks the contract. */
export interface BrowserContractViolation extends BrowserSurface {
  reason: BrowserViolationReason;
  /** One-line human explanation, ready to print in a test failure. */
  message: string;
}

const WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * True when the `'` at `index` is prose, not a string delimiter. JSX text is
 * unquoted, so "Can't play it?" and "isn't linked yet" put bare apostrophes in
 * the middle of a returned tree. Treating those as quote openers swallows the
 * rest of the tree — and a scanner that loses a block reports a clean file, which
 * is the one failure mode this module must not have. A real `'…'` string starts
 * after an operator, bracket or comma, never between two letters.
 */
function isProseApostrophe(source: string, index: number): boolean {
  const prev = index > 0 ? source[index - 1] : '';
  const next = index + 1 < source.length ? source[index + 1] : '';
  return WORD_CHAR.test(prev) && WORD_CHAR.test(next);
}

/**
 * Index of the delimiter matching the opener at `openIndex` (`(`, `{` or `[`),
 * or -1 if it is never closed. Quotes and backslash escapes are respected so a
 * `)` or `}` inside a string cannot end the expression early, and prose
 * apostrophes are not mistaken for quotes.
 */
export function matchDelimiter(source: string, openIndex: number): number {
  const open = source[openIndex];
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : null;
  if (close === null) return -1;
  let depth = 0;
  let quote = '';
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === '`' || (c === "'" && !isProseApostrophe(source, i))) {
      quote = c;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every `return …;` in one file, as returned-expression text. Handles both the
 * parenthesized form (`return ( <Modal …> … </Modal> );`) that React components
 * use and the bare form (`return <View />;`).
 *
 * Known limit, on purpose: this looks for the `return` keyword, so a JSX tree
 * an arrow function returns implicitly (`() => (<WebView … />)`) is only seen
 * through the enclosing `return`. Every surface in the app today is reached
 * through a `return`, and the author of a new one gets the modalBackContract
 * reminder as well; erring toward "may miss" here would be the wrong trade —
 * over-reporting is cheap, a silent pass is not.
 */
export function returnBlocks(source: string): ReturnBlock[] {
  const masked = maskComments(source);
  const blocks: ReturnBlock[] = [];
  const pattern = /\breturn\b/g;
  let match = pattern.exec(masked);
  while (match) {
    const start = match.index;
    let i = start + 'return'.length;
    while (i < masked.length && /\s/.test(masked[i])) i++;
    let end: number;
    if (masked[i] === '(') {
      const close = matchDelimiter(masked, i);
      // A never-closed expression is not expected in valid source, but if it
      // happens, keep the block (bounded by its statement) rather than dropping
      // it — a scanner that silently loses a block passes the very file it exists
      // to check.
      end = close < 0 ? statementEnd(masked, i) : close + 1;
    } else {
      // Bare `return <tree>;` — end at the statement's semicolon.
      end = statementEnd(masked, i);
    }
    while (end < masked.length && /[\s;]/.test(masked[end])) end++;
    blocks.push({ start, end, text: masked.slice(i, end) });
    pattern.lastIndex = end;
    match = pattern.exec(masked);
  }
  return blocks;
}

/** End of the statement that starts at/after `from`: just past its `;`. */
function statementEnd(source: string, from: number): number {
  const semi = source.indexOf(';', from);
  return semi < 0 ? source.length : semi + 1;
}

/**
 * The root JSX element of a returned expression: the first `<Name` in it, with
 * its full opening tag. Fragments (`<>`), closers (`</`) and expressions (`{` …)
 * do not match, which is what makes "the root is a Modal" checkable.
 */
export function jsxRootTag(
  blockText: string,
): { name: string; tag: string; start: number } | null {
  const match = /<([A-Za-z][A-Za-z0-9_.]*)/.exec(blockText);
  if (!match) return null;
  const tag = readModalTag(blockText, match.index);
  if (tag === null) return null;
  return { name: match[1], tag, start: match.index };
}

/**
 * The source of a JSX prop's value: `prop={expr}` returns `expr`, `prop="x"`
 * returns `"x"`, and a missing prop returns null. Used to read a Modal's
 * `onRequestClose` handler as text (e.g. `() => setRetailerUrl(null)`).
 */
export function propSource(tagSource: string, name: string): string | null {
  const braced = new RegExp(name + '\\s*=\\s*\\{').exec(tagSource);
  if (braced) {
    const open = braced.index + braced[0].length - 1;
    const close = matchDelimiter(tagSource, open);
    if (close < 0) return null;
    return tagSource.slice(open + 1, close).trim();
  }
  const plain = new RegExp(name + '\\s*=\\s*([^\\s>]+)').exec(tagSource);
  return plain ? plain[1] : null;
}

/**
 * The app's own INLINE app-rendered WebViews, exempt by source path.
 *
 * `AbcScoreView` is the notation editor's sheet-music preview: it is handed an
 * abcjs HTML document this app generates itself (`source={{ html }}`) and renders
 * it embedded INSIDE the editor's own layout. Nobody navigates anywhere in it and
 * there is no remote page to return from, so the two things this contract exists
 * to protect — "the screen behind a browser must not reappear" and "BACK must
 * return the user to where they were" — do not apply. A Modal wrapper would only
 * hide the preview behind a BACK press in the middle of editing.
 *
 * Keep this list to app-rendered `source={{ html }}` previews. A page the user
 * NAVIGATES to (a retailer, an external link, anything the backend supplies a URL
 * for) is a browser surface and belongs in a BACK-closable Modal — always.
 */
export const INLINE_APP_RENDERED_WEBVIEWS: readonly string[] = [
  'src/components/AbcScoreView.tsx',
];

/** True when `path` is one of the app's own inline (non-navigable) WebView renderers. */
export function isInlineAppRenderedWebview(path: string): boolean {
  return INLINE_APP_RENDERED_WEBVIEWS.includes(path);
}

/**
 * Every returned tree in `files` that renders a `<WebView>`, minus the app's own
 * inline previews (`INLINE_APP_RENDERED_WEBVIEWS`). Excluded here so that every
 * caller — the violation finder below and the suites' own per-surface scanners —
 * inherits the one exemption list instead of re-deciding what a browser is.
 */
export function browserSurfaces(files: readonly SourceFile[]): BrowserSurface[] {
  const surfaces: BrowserSurface[] = [];
  for (const file of files) {
    if (isInlineAppRenderedWebview(file.path)) continue;
    for (const block of returnBlocks(file.source)) {
      if (!block.text.includes('<WebView')) continue;
      const root = jsxRootTag(block.text);
      surfaces.push({
        path: file.path,
        line: lineAt(file.source, block.start),
        rootTag: root ? root.name : null,
        rootTagSource: root ? root.tag.replace(/\s+/g, ' ').trim() : null,
      });
    }
  }
  return surfaces;
}

/**
 * Every in-app browser surface that is NOT a BACK-closable Modal. An empty result
 * means the contract holds: each `<WebView>` sits in a full-screen Modal whose
 * `onRequestClose` returns the user to where they were.
 */
export function findBrowserContractViolations(
  files: readonly SourceFile[],
): BrowserContractViolation[] {
  const violations: BrowserContractViolation[] = [];
  for (const surface of browserSurfaces(files)) {
    const where = `${surface.path}:${surface.line}`;
    if (surface.rootTag !== 'Modal') {
      violations.push({
        ...surface,
        reason: 'not-in-modal',
        message:
          `${where} — an in-app browser is rendered outside a Modal ` +
          `(root element: ${surface.rootTag ?? 'unknown'}). The screen behind it ` +
          'reappears and BACK cannot return the user to the app.',
      });
      continue;
    }
    const handler = surface.rootTagSource
      ? propSource(surface.rootTagSource, 'onRequestClose')
      : null;
    if (handler === null) {
      violations.push({
        ...surface,
        reason: 'no-back-handler',
        message:
          `${where} — this browser Modal has no onRequestClose, so hardware BACK ` +
          'cannot close it and return the user to where they were.',
      });
    }
  }
  return violations;
}

/** One-line report per violation, ready to print in a test failure. */
export function formatBrowserViolations(
  violations: readonly BrowserContractViolation[],
): string[] {
  return violations.map((v) => `  ✗ ${v.message}`);
}
