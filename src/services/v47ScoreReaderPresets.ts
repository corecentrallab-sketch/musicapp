/**
 * v47ScoreReaderPresets.ts — THE PAGE-TURN PRESETS MUST BE **HOSTED** BY THE
 * SCORE READER, NOT MERELY WIRED IN THE PDF READER. (v47 audit defect D1.)
 *
 * ── WHY A NEW GUARD, AND WHY THE EXISTING ONE CANNOT DO THIS JOB ────────────
 * `v39UiContract.pageTurnerViewersShareThePresets(pdfSource, scannedSource,
 * hookSource)` takes exactly three inputs and reads exactly three files:
 * `screens/PdfViewerScreen.tsx`, `screens/ScannedViewerScreen.tsx` and
 * `hooks/usePageTurnSpeed.ts`. **`components/ScoreViewer.tsx` is never one of its
 * inputs** — no file in `src/services/*.ts` reads the score viewer for the preset
 * prop. So the shipped v39 guard stayed green through the entire period in which
 * the score reader — the surface the owner actually reads music on, and the
 * surface Settings' own copy points at ("Per piece — set it in the score
 * reader", settingsSpec `AUTO_SCROLL_HONEST_SUB`) — rendered
 * `<AutoScrollControl>` WITHOUT `speedProfiles`. `AutoScrollControl` renders the
 * preset row only when `speedProfiles` is supplied, so the row never appeared.
 *
 * That is the v46 lesson in its purest form: a guard can prove the FEATURE is
 * wired and still miss that its HOST forgot the prop. `v46DiscoverHosting.ts`
 * was written for exactly this bug class; this is the same shape for the presets.
 *
 * ── WHAT THIS GUARD ASSERTS ─────────────────────────────────────────────────
 * On `src/components/ScoreViewer.tsx` itself (comment-masked, so prose can never
 * satisfy it):
 *   1. `itemId?: string | null` is declared in `ScoreViewerProps` — the per-piece
 *      memory needs an identity to key on, and the viewer had none;
 *   2. the component DESTRUCTURES `itemId` (a declared-but-unread prop is the
 *      "wiring, not hosting" trap again);
 *   3. `usePageTurnSpeed` is imported from `../hooks/usePageTurnSpeed`;
 *   4. `const speedProfiles = usePageTurnSpeed(itemId ?? null, autoScroll)` — the
 *      SAME call shape as `PdfViewerScreen`, so the two readers share one
 *      implementation and one store;
 *   5. `speedProfiles={speedProfiles}` is passed to the `AutoScrollControl`
 *      element (which must still receive `autoScroll` and still be rendered).
 * On the HOSTS (`screens/PieceDetailScreen.tsx`, `screens/HomeScreen.tsx`,
 * `components/RecognitionResultView.tsx`):
 *   6. the `<ScoreViewer …>` element passes `itemId={…}` with a REAL identity
 *      expression (`piece.id`, `dailyChallenge.id`, `selectedMatch?.piece_id ??
 *      topMatch.piece_id`) — never a literal `null`/`undefined`/`''`, which would
 *      type-check and silently give every piece the same (no) memory.
 *
 * NOTHING NEW IS INVENTED: the presets, the per-piece map codec, the AsyncStorage
 * key, the debounced write-back and the chip row are the shipped v39 feature. No
 * paywall (plan 10-08: utilities free through launch), manual-only default, and
 * the per-piece memory behaves exactly as it does in the PDF reader.
 *
 * PURE: strings in, booleans out. `scripts/v47ScoreReaderPresets.test.ts` feeds
 * each predicate MUTATED copies of the real sources (prop removed / hook call
 * dropped / `speedProfiles` removed / host id removed) to prove every one bites.
 */

/** The viewer that was missing its host wiring. */
export const SCORE_VIEWER_FILE = 'src/components/ScoreViewer.tsx';

/** The three hosts that already hold a piece identity (v47 wiring map §4.4). */
export const PIECE_PAGE_FILE = 'src/screens/PieceDetailScreen.tsx';
export const HOME_FILE = 'src/screens/HomeScreen.tsx';
export const RESULT_CARD_FILE = 'src/components/RecognitionResultView.tsx';

/** The identity each host is expected to hand over (the audit's map). */
export const EXPECTED_HOST_ITEM_ID: Readonly<Record<string, string>> = {
  [PIECE_PAGE_FILE]: 'piece.id',
  [HOME_FILE]: 'dailyChallenge.id',
  [RESULT_CARD_FILE]: 'selectedMatch?.piece_id ?? topMatch.piece_id',
};

/** The hook import the viewer must carry (same module the PDF reader uses). */
export const HOOK_IMPORT_SPECIFIER = '../hooks/usePageTurnSpeed';

/**
 * Blank out comments WITHOUT changing the string's length — a guard must never
 * be satisfied by prose (the file above literally discusses the strings it
 * checks) and must never fail on it either.
 */
function maskComments(source: string): string {
  const src = typeof source === 'string' ? source : '';
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

/** Index of `<Tag` as a real JSX tag (not `<TagFoo`, not a closing tag). */
function openingTagAt(src: string, tag: string): number {
  const re = new RegExp('<' + tag + '(?=[\\s/>])');
  const m = re.exec(src);
  return m === null ? -1 : m.index;
}

/** Index of the `>` that closes the opening tag, brace- and quote-aware. */
function openingTagEnd(src: string, start: number): number {
  let brace = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') brace++;
    else if (ch === '}') brace--;
    else if (ch === '>' && brace === 0) return i;
  }
  return -1;
}

/**
 * The source of one JSX element: from `<Tag` to the end of its opening tag when
 * self-closing, or to its matching `</Tag>` (depth-counted) when it has children.
 */
export function elementSource(source: string, tag: string): string | null {
  const src = maskComments(source);
  const start = openingTagAt(src, tag);
  if (start < 0) return null;
  const openEnd = openingTagEnd(src, start);
  if (openEnd < 0) return null;
  if (src[openEnd - 1] === '/') return src.slice(start, openEnd + 1);
  let depth = 1;
  let i = openEnd + 1;
  const openRe = new RegExp('<' + tag + '(?=[\\s/>])', 'g');
  const closeTag = '</' + tag + '>';
  while (i < src.length) {
    openRe.lastIndex = i;
    const nextOpen = openRe.exec(src);
    const nextClose = src.indexOf(closeTag, i);
    if (nextClose < 0) return null;
    if (nextOpen !== null && nextOpen.index < nextClose) {
      const tagEnd = openingTagEnd(src, nextOpen.index);
      if (tagEnd < 0) return null;
      if (src[tagEnd - 1] !== '/') depth++;
      i = tagEnd + 1;
      continue;
    }
    depth--;
    if (depth === 0) return src.slice(start, nextClose + closeTag.length);
    i = nextClose + closeTag.length;
  }
  return null;
}

/**
 * PREDICATE 1 — the viewer's props carry a piece identity.
 * `itemId?: string | null` in `ScoreViewerProps`.
 */
export function scoreViewerDeclaresTheIdProp(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 5000) return false;
  const propsAt = src.indexOf('interface ScoreViewerProps');
  if (propsAt < 0) return false;
  const propsEnd = src.indexOf('\n}', propsAt);
  if (propsEnd < 0) return false;
  const props = src.slice(propsAt, propsEnd);
  return /itemId\?:\s*string\s*\|\s*null\s*;/.test(props);
}

/**
 * PREDICATE 2 — the component actually READS the prop (declared but unused is
 * the same "wiring, not hosting" trap this guard exists for).
 */
export function scoreViewerDestructuresTheId(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 5000) return false;
  const marker = 'React.FC<ScoreViewerProps> = ({';
  const at = src.indexOf(marker);
  if (at < 0) return false;
  const end = src.indexOf('}) =>', at);
  if (end < 0) return false;
  const params = src.slice(at + marker.length, end);
  return /(^|[\s,{])itemId\b/m.test(params);
}

/** PREDICATE 3 — the preset hook is imported from the shared module. */
export function scoreViewerImportsThePresetHook(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 5000) return false;
  return new RegExp("from\\s+'" + HOOK_IMPORT_SPECIFIER.replace(/[/.]/g, '\\$&') + "'").test(src);
}

/**
 * PREDICATE 4 — the hook is called with THIS viewer's piece identity, in the
 * exact shape the PDF reader uses (`usePageTurnSpeed(itemId, autoScroll)`), with
 * `?? null` so an id-less viewer never keys the store on `undefined`.
 */
export function scoreViewerCallsThePresetHookWithTheId(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 5000) return false;
  return /const\s+speedProfiles\s*=\s*usePageTurnSpeed\(\s*itemId\s*\?\?\s*null\s*,\s*autoScroll\s*\)/.test(
    src,
  );
}

/**
 * PREDICATE 5 — `speedProfiles` reaches the `AutoScrollControl` ELEMENT (the
 * thing that decides whether the preset row renders at all), and the control
 * still receives `autoScroll` — i.e. the presets were added to the shipped
 * control, not swapped in for it.
 */
export function scoreViewerPassesProfilesToTheControl(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 5000) return false;
  const control = elementSource(src, 'AutoScrollControl');
  if (control === null) return false;
  if (control.indexOf('autoScroll={autoScroll}') < 0) return false;
  return control.indexOf('speedProfiles={speedProfiles}') >= 0;
}

/**
 * THE WHOLE VIEWER: every one of the above. This is the assertion that would
 * have failed on every build between v39 and v47.
 */
export function scoreReaderHostsThePresets(source: string): boolean {
  if (!scoreViewerDeclaresTheIdProp(source)) return false;
  if (!scoreViewerDestructuresTheId(source)) return false;
  if (!scoreViewerImportsThePresetHook(source)) return false;
  if (!scoreViewerCallsThePresetHookWithTheId(source)) return false;
  if (!scoreViewerPassesProfilesToTheControl(source)) return false;
  return true;
}

/**
 * PREDICATE 6 — THE HOSTING HALF (the v46 lesson: assert the host, not just the
 * component). The `<ScoreViewer …>` element in a host passes `itemId={…}` whose
 * expression is a REAL piece identity — a property access, never a literal.
 */
export function hostPassesThePieceIdToTheScoreViewer(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 3000) return false;
  const element = elementSource(src, 'ScoreViewer');
  if (element === null) return false;
  const m = /itemId=\{([^}]*)\}/.exec(element);
  if (m === null) return false;
  const expr = m[1].trim();
  if (expr === '') return false;
  // A literal id is not an identity: it would give every piece the same memory.
  if (/^(null|undefined|''|""|`\s*`)$/.test(expr)) return false;
  // It must read a piece identity off a real object.
  return /\.id\b|\.piece_id\b/.test(expr);
}

/** Does this host pass EXACTLY the identity the wiring map expects? */
export function hostPassesTheExpectedId(source: string, expectedExpression: string): boolean {
  if (!hostPassesThePieceIdToTheScoreViewer(source)) return false;
  const src = maskComments(source);
  const element = elementSource(src, 'ScoreViewer');
  if (element === null) return false;
  return element.indexOf(`itemId={${expectedExpression}}`) >= 0;
}
