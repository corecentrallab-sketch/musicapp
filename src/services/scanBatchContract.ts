/**
 * scanBatchContract.ts — THE v45 SLICE 4 SCAN BATCH, PINNED AS TEXT (owner
 * decisions 2026-10-26).
 *
 * WHAT THIS SLICE CHANGED, and therefore what has to stay true:
 *
 *   1. THE PHOTO IS CLASSIFIED (`services/scanClassify`): a cover or a page of
 *      music, with the read's own quality + confidence, and the scanner's photo
 *      kind now COMES FROM that verdict instead of from the page index alone.
 *   2. A GOOD COVER READ LOOKS ITSELF UP — and ONLY a good cover read that names
 *      a piece we hold. The gate lives in one expression in `scanClassify`, and
 *      `scanAutoSearchFiresOnlyOnGoodCoverCandidates` reads that expression.
 *   3. THE LOOKUP IS NEVER SILENT AND NEVER A REDIRECT: the one search surface
 *      opens with the words printed and a "Not now" that cancels it, and no scan
 *      surface can build a retailer URL of its own.
 *   4. THE RESOLVE PAGE HAS ONE FIELD AND ONE CTA. The read's words and the user's
 *      own title share the same editable field (v45 slice 4), and the "Search
 *      these words" control still prints the words it will search (v44 #59).
 *   5. THE FRAMING GUIDE IS PURE VISUALS. The overlay tells the user where to put
 *      the title; it claims no sensor crop and nothing is "aligned".
 *
 * Every function takes SOURCE TEXT (or the pure plan itself), so the tier1 suite
 * runs them against the real files with no emulator — and each one is mutated in
 * scripts/scanBatch.test.ts to prove it bites.
 */

/** The files this slice owns. */
export const SCAN_BATCH_SCREEN_PATH = 'src/screens/ScanScoreScreen.tsx';
export const SCAN_BATCH_SECTION_PATH = 'src/components/ScanFindSection.tsx';
export const SCAN_BATCH_FIND_PATH = 'src/screens/FindPieceScreen.tsx';
export const SCAN_BATCH_CLASSIFY_PATH = 'src/services/scanClassify.ts';

/** Strip block and line comments, so prose about a rule cannot satisfy it. */
export function maskComments(source: string): string {
  if (typeof source !== 'string') return '';
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/**
 * 1. THE HONEST GATE. `scanClassify` decides auto-fire in ONE expression
 * (`const fireGoodCover = …`), and every clause of the owner's rule must be in it:
 * a cover verdict, quality 'good', at least one candidate, and a real query. A
 * single `||` would let one of them stand in for another, so any alternation —
 * and any clause going missing — fails this guard.
 */
export function scanAutoSearchFiresOnlyOnGoodCoverCandidates(classifySource: string): boolean {
  const src = maskComments(classifySource);
  if (src.length < 2000) return false;
  const match = /const\s+fireGoodCover\s*=\s*([\s\S]*?);/.exec(src);
  if (match === null) return false;
  const condition = match[1] ?? '';
  if (condition.trim().length === 0) return false;
  // Every clause must HOLD — an alternative would let debris through.
  if (condition.indexOf('||') >= 0) return false;
  const clauses = [
    "verdict === 'cover'",
    "quality === 'good'",
    'candidates.length > 0',
    'best !== null',
  ];
  for (const clause of clauses) {
    if (condition.indexOf(clause) < 0) return false;
  }
  return true;
}

/**
 * 2. A PAGE OF MUSIC IS NEVER LOOKED UP. The classifier's notation branch returns
 * a hold plan (fire false) BEFORE the gate is ever reached, so the verdict cannot
 * fall through to a lookup.
 */
export function scorePageNeverFiresAResearch(classifySource: string): boolean {
  const src = maskComments(classifySource);
  const start = src.indexOf("if (verdict === 'score-page')");
  if (start < 0) return false;
  // The branch runs from its `if` to the honest GATE's own declaration — nothing
  // in between may promise a lookup.
  const gateAt = src.indexOf('const fireGoodCover', start);
  const body = src.slice(start, gateAt > start ? gateAt : start + 700);
  if (body.indexOf('autoSearch: holdPlan(') < 0) return false;
  if (body.indexOf('fire: true') >= 0) return false;
  return true;
}

/**
 * 3. THE SCANNER NEVER REDIRECTS AND NEVER BUILDS A LINK. Its only way to the
 * money path is a QUERY handed to the app's own search surface; a retailer is
 * reached by the user's own tap there (owner 08-24). This is checked on the RAW
 * source, so even a URL in a comment trips it.
 */
export function scannerRoutesToInAppSearchOnly(screenSource: string): boolean {
  if (typeof screenSource !== 'string' || screenSource.length < 4000) return false;
  if (/https?:\/\//.test(screenSource)) return false;
  if (screenSource.indexOf('Linking.openURL') >= 0) return false;
  if (/sheetmusicdirect|musicnotes|sheetmusicplus/i.test(screenSource)) return false;
  if (screenSource.indexOf('/search/go') >= 0) return false;
  if (/\bw=/.test(screenSource)) return false;
  // …and a fired lookup opens THE ONE SEARCH with the plan's own query.
  return (
    screenSource.indexOf('initialQuery={autoSearch.query}') >= 0 &&
    screenSource.indexOf('<FindPieceScreen') >= 0
  );
}

/**
 * 4. THE LOOKUP IS EXPLAINED AND CANCELLABLE — on BOTH ends. The scanner hands the
 * plan's headline + dismiss label to the search surface with a dismiss handler,
 * and that surface RENDERS them; an auto-search that cannot be seen and undone is
 * exactly the "the app decided for me" class the owner keeps rejecting.
 */
export function autoSearchIsExplainedAndCancellable(
  screenSource: string,
  findSource: string,
): boolean {
  const screen = maskComments(screenSource);
  const find = maskComments(findSource);
  if (screen.length < 4000 || find.length < 4000) return false;
  // the host hands over the words, the headline and the way out
  if (screen.indexOf('autoSearchNotice={autoSearch}') < 0) return false;
  if (screen.indexOf('onDismissAutoSearch=') < 0) return false;
  // the surface prints the headline and the dismiss control…
  if (find.indexOf('{autoSearchNotice.headline}') < 0) return false;
  if (find.indexOf('onPress={onDismissAutoSearch}') < 0) return false;
  if (find.indexOf('{autoSearchNotice.dismissLabel}') < 0) return false;
  // …and an auto-search is the ONE thing allowed to skip the v42 proposal step:
  // a read starts pending UNLESS the notice is present (v45 honest gate).
  if (find.indexOf('autoSearchNotice ? false : initialOcrPrefillState(') < 0) return false;
  // the v42 gate itself must still be there for everybody else.
  return find.indexOf('if (prefillPending) {') >= 0;
}

/**
 * 5. ONE FIELD, ONE CTA (v45 slice 4, owner). The read's words and the user's own
 * title are the SAME editable field now — a second `TextInput` on this page is the
 * duplicate box the owner asked to merge away. The one CTA keeps printing the
 * words it will search (v44 #59), and its label still switches between "Search
 * these words" and the typed-title wording, from the same field.
 */
export function scanSearchIsSingleField(sectionSource: string): boolean {
  const src = maskComments(sectionSource);
  if (src.length < 3000) return false;
  const inputs = (src.match(/<TextInput/g) ?? []).length;
  if (inputs !== 1) return false;
  // the ONE CTA, with both labels (the read's words / the user's own title)
  if (src.indexOf('SCAN_FIND_SEARCH_WORDS_CTA') < 0) return false;
  if (src.indexOf('SCAN_FIND_TYPED_SEARCH_CTA') < 0) return false;
  // …printing the words it will actually search (v44 #59 — never an empty control)
  if (src.indexOf('styles.searchWordsBold') < 0) return false;
  // …and the field really is editable and really is what gets searched.
  if (src.indexOf('onChangeText={setText}') < 0) return false;
  return src.indexOf('onSearch(typedTitle)') >= 0;
}

/**
 * 6. THE FRAMING GUIDE IS VISUALS ONLY. The overlay tells the user to fit the
 * title; it does not claim to crop, align or auto-detect anything, and it makes no
 * claim about reading the notes. (Comments are masked: the rule may be discussed.)
 */
export const SCAN_FRAMING_BANNED_CLAIMS: readonly string[] = [
  'auto-crop',
  'auto crop',
  'auto-align',
  'auto align',
  'aligned',
  'crops the page',
  'we crop',
  'auto-detect',
  'auto detect',
  'we detect',
  'scans the notes',
  'reads the notes',
];

export function framingGuideIsVisualOnly(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  return sources.every((source) => {
    const src = maskComments(source).toLowerCase();
    return SCAN_FRAMING_BANNED_CLAIMS.every((claim) => src.indexOf(claim) < 0);
  });
}

/**
 * 7. THE SCANNER'S PHOTO KIND COMES FROM THE CLASSIFIER. Before a read happens it
 * still falls back to the page-index rule (first photo = cover door, later pages =
 * page door), but once a photo has been classified the verdict decides.
 */
export function scanPhotoKindComesFromTheVerdict(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.indexOf('const photoDoor = scanPhotoKindFor(') < 0) return false;
  if (src.indexOf('photoKind={photoDoor}') < 0) return false;
  // the classifier's verdict is what the screen holds per scan…
  if (src.indexOf('setScanClassification(') < 0) return false;
  // …and it is the classifier's OWN classification object that is passed on.
  return src.indexOf('onClassified={handleClassified}') >= 0;
}
