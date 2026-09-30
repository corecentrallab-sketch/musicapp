/**
 * searchExternal.test.ts — the tier1 gate for the search-box external-results
 * extension (owner direction 10-01: the Find-a-Piece box must return our own
 * catalog results AND external licensed-retailer results, and never dead-end).
 *
 * Three layers, in the house order:
 *   1. UNIT — the pure decision and the two URL builders, including the
 *      zero-internal-match case that IS the feature ("Fields of Gold") and a
 *      query → SMD URL round trip that proves the affiliate id rides along;
 *   2. LIVE SCAN — the predicates in src/services/searchExternalContract.ts run
 *      against the REAL screen, component and builder on disk;
 *   3. MUTATION PROBES — put each defect back into the real source and prove the
 *      guard fails: the section removed, the section gated behind internal
 *      results (the dead-end regression), a hand-rolled retailer URL on the
 *      screen, the affiliate id dropped from the builder, the retired Musicnotes
 *      route/tag back in, the section auto-opening on mount, the zero-match hint
 *      deleted, and History quietly growing the same section.
 *
 * Run with: npm run test:tier1 (plain Node, no app runtime, no react-native).
 */
import {
  EXTERNAL_MUSICNOTES_CTA_LABEL,
  EXTERNAL_NO_MATCH_HINT,
  EXTERNAL_SECTION_TITLE,
  EXTERNAL_SUBTITLE_NO_INTERNAL,
  EXTERNAL_SUBTITLE_WITH_INTERNAL,
  MAX_EXTERNAL_QUERY_LENGTH,
  MUSICNOTES_SEARCH_PATH,
  SMD_AFFILIATE_ID,
  SMD_SEARCH_PATH,
  externalSearchSection,
  musicnotesSearchUrl,
  normalizeSearchQuery,
  sheetMusicDirectSearchUrl,
} from '../src/services/searchExternal';
import {
  EXTERNAL_SECTION_COMPONENT,
  SMD_AFFILIATE_SHAPE,
  externalSectionOpensOnTapOnly,
  externalUrlBuilderKeepsLiveShapes,
  historyScreenHasNoExternalSection,
  searchScreenRendersExternalSection,
  searchScreenUsesSharedUrlBuilder,
  zeroMatchStatePointsAtRetailers,
} from '../src/services/searchExternalContract';

declare const process: { exit(code: number): never; cwd(): string };
declare const require: (moduleName: string) => any;
let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (
      fs.existsSync(path.join(dir, 'app.json')) &&
      fs.existsSync(path.join(dir, 'src'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

const SCREEN = 'src/screens/FindPieceScreen.tsx';
const HISTORY = 'src/screens/HistoryScreen.tsx';
const BUILDER = 'src/services/searchExternal.ts';
const SECTION = 'src/components/SearchExternalSection.tsx';

// ─── 1. the pure decision ───────────────────────────────────────

function decisionTests(): void {
  // An empty (or whitespace-only) query has nothing to search for: no section.
  assertEq(externalSearchSection('').visible, false, 'empty query → no external section');
  assertEq(externalSearchSection('   ').visible, false, 'whitespace-only query → no section');
  assertEq(externalSearchSection(null).visible, false, 'null query → no section');
  assertEq(externalSearchSection(undefined).visible, false, 'undefined query → no section');
  assertEq(
    externalSearchSection('').smdUrl,
    undefined,
    'an empty query builds no SMD link at all',
  );

  // THE FEATURE: a song our library does not hold still resolves to a money path.
  const gold = externalSearchSection('Fields of Gold', 0);
  assertEq(gold.visible, true, 'NO-DEAD-END: a zero-internal-match query still renders the section');
  assertEq(gold.internalMatchCount, 0, 'the decision records the zero-match count honestly');
  assertEq(gold.query, 'Fields of Gold', 'the section echoes the user’s own query');
  assert(
    !!gold.smdUrl && gold.smdUrl.includes(`tid=${SMD_AFFILIATE_ID}`),
    'NO-DEAD-END: the zero-match section carries the SMD affiliate id',
  );
  assert(
    !!gold.smdUrl && gold.smdUrl.includes(`affiliateId=${SMD_AFFILIATE_ID}`),
    'the zero-match section carries affiliateId as well as tid',
  );
  assertEq(
    gold.showMusicnotes,
    true,
    'the secondary Musicnotes CTA renders when it differs from the primary',
  );
  assertEq(
    gold.subtitle,
    EXTERNAL_SUBTITLE_NO_INTERNAL,
    'a zero-match query uses the honest “not in our free library” subtitle',
  );

  // Visibility is a property of the QUERY alone — the internal result count can
  // never gate it (that gate is the regression this whole guard exists for).
  const counts = [0, 1, 3, 50];
  assert(
    counts.every((n) => externalSearchSection('Fields of Gold', n).visible === true),
    'visibility is independent of the internal match count (0, 1, 3, 50 all render)',
  );
  assertEq(
    externalSearchSection('Für Elise', 12).subtitle,
    EXTERNAL_SUBTITLE_WITH_INTERNAL,
    'a query the catalog DID match uses the “also available” subtitle',
  );
  assertEq(
    externalSearchSection('Für Elise', 12).internalMatchCount,
    12,
    'the match count is carried for the subtitle',
  );

  // Negative/junk counts degrade to the honest zero, never to a wrong claim.
  assertEq(
    externalSearchSection('Für Elise', -4).internalMatchCount,
    0,
    'a negative match count degrades to 0',
  );

  // Normalisation stays minimal: the user’s own words, nothing added.
  assertEq(normalizeSearchQuery('  Fields   of Gold  '), 'Fields of Gold', 'whitespace collapses and trims');
  assertEq(
    normalizeSearchQuery('(I Can’t Get No) Satisfaction'.replace('’', "'")),
    "(I Can't Get No) Satisfaction",
    'a real parenthesised title is NOT stripped (the user typed it)',
  );
  assertEq(
    normalizeSearchQuery('a'.repeat(MAX_EXTERNAL_QUERY_LENGTH + 40)).length,
    MAX_EXTERNAL_QUERY_LENGTH,
    'an over-long paste is capped at the searchable length',
  );
  assertEq(
    externalSearchSection('Beethoven').query,
    'Beethoven',
    'a composer-only query is a valid search (composer searches are first class)',
  );
}

/**
 * A dependency-free URL splitter (the tier1 gate compiles with `types: []`, so
 * there is no DOM `URL` typing to lean on). It decodes with `decodeURIComponent`,
 * which is exactly the round trip the test is about.
 */
function splitUrl(url: string): {
  origin: string;
  pathname: string;
  params: Record<string, string>;
} {
  const m = /^([a-z]+:\/\/[^/?#]+)([^?#]*)(?:\?([^#]*))?$/i.exec(url);
  if (!m) throw new Error('not a URL: ' + url);
  const params: Record<string, string> = {};
  for (const part of (m[3] ?? '').split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  }
  return { origin: m[1], pathname: m[2], params };
}

// ─── 2. the URL builders (round trip) ───────────────────────────

function urlTests(): void {
  const url = sheetMusicDirectSearchUrl('Fields of Gold');
  assert(!!url, 'the SMD builder returns a link for a real query');
  const shaped = (url as string).replace(/\s/g, '');
  assert(
    SMD_AFFILIATE_SHAPE.test(shaped),
    'ROUND TRIP: the built URL is the live /en-US/Search.aspx shape with tid + affiliateId (PR #118)',
  );

  const parsed = splitUrl(url as string);
  assertEq(parsed.origin, 'https://www.sheetmusicdirect.com', 'the SMD host is the retailer’s own site');
  assertEq(parsed.pathname, SMD_SEARCH_PATH, 'the SMD path is /en-US/Search.aspx');
  assertEq(
    parsed.params['query'],
    'Fields of Gold',
    'ROUND TRIP: the user’s query survives encoding and decoding',
  );
  assertEq(parsed.params['tid'], SMD_AFFILIATE_ID, 'ROUND TRIP: tid=67650 is present');
  assertEq(
    parsed.params['affiliateId'],
    SMD_AFFILIATE_ID,
    'ROUND TRIP: affiliateId=67650 is present',
  );

  // Awkward queries must still round trip exactly (spaces, umlauts, ampersands).
  for (const q of ['Für Elise', 'Bang a Gong (Get It On)', 'Simon & Garfunkel', 'C# minor']) {
    const qUrl = sheetMusicDirectSearchUrl(q) as string;
    assertEq(
      splitUrl(qUrl).params['query'],
      normalizeSearchQuery(q),
      `ROUND TRIP: “${q}” decodes back to the query the user typed`,
    );
  }

  // Title-only / typed-words-only: we never invent an extra token for the
  // retailer (the 09-23 zero-result bug: SMD scores ~0 for extra tokens).
  assertEq(
    splitUrl(sheetMusicDirectSearchUrl('Fields of Gold') as string).params['query'],
    'Fields of Gold',
    'the SMD query is exactly what the user typed — no artist appended',
  );

  // Secondary retailer: the LIVE Musicnotes shape only.
  const mn = musicnotesSearchUrl('Let It Be') as string;
  const mnParsed = splitUrl(mn);
  assertEq(mnParsed.params['w'], 'Let It Be', 'the Musicnotes link uses its own live `w` parameter');
  assertEq(mnParsed.origin, 'https://www.musicnotes.com', 'the Musicnotes link is on Musicnotes’ host');
  assertEq(mnParsed.pathname, MUSICNOTES_SEARCH_PATH, 'the Musicnotes path is /search');
  assert(!/\/search\/go/.test(mn), 'the retired Musicnotes sub-route is never emitted (fc19fe16)');
  assert(!/w=NoteSnap/.test(mn), 'the retired w=NoteSnap tag is never emitted');
  assertEq(
    sheetMusicDirectSearchUrl(''),
    undefined,
    'no query → no SMD link (a blank search is not a link)',
  );
  assertEq(musicnotesSearchUrl('   '), undefined, 'no query → no Musicnotes link');
}

// ─── 3. live scans on the real app source ───────────────────────

function liveScanTests(): void {
  const screen = readAppFile(SCREEN);
  const section = readAppFile(SECTION);
  const builder = readAppFile(BUILDER);
  const history = readAppFile(HISTORY);

  assertEq(
    searchScreenRendersExternalSection(screen),
    true,
    'FindPieceScreen renders the external section from the pure query-side decision',
  );
  assertEq(
    searchScreenUsesSharedUrlBuilder(screen),
    true,
    'FindPieceScreen builds no retailer URL itself — both links come from the shared builder',
  );
  assertEq(
    zeroMatchStatePointsAtRetailers(screen),
    true,
    'the screen’s zero-match state points at the retailers (no wall)',
  );
  assertEq(
    externalUrlBuilderKeepsLiveShapes(builder),
    true,
    'the one search-box URL builder keeps the live SMD + Musicnotes shapes (affiliate 67650)',
  );
  assertEq(
    externalSectionOpensOnTapOnly(section),
    true,
    'the section is tap-through only: no WebView of its own, no open-on-mount effect',
  );
  assertEq(
    historyScreenHasNoExternalSection(history),
    true,
    'HistoryScreen stays scoped to saved recognitions (no external section there)',
  );

  // The screen really does hand the section the live query (and the section
  // really does exist in the tree) — belt and braces on the wiring.
  assert(screen.includes(EXTERNAL_SECTION_COMPONENT), 'the section component is in FindPieceScreen');
  assert(
    /externalSearchSection\(\s*query\b/.test(screen),
    'the decision is built from the live `query` state',
  );
  assert(
    screen.includes('{EXTERNAL_NO_MATCH_HINT}'),
    'the no-match hint constant is used by the screen',
  );
  assert(
    section.includes('EXTERNAL_SECTION_TITLE'),
    'the section renders the “Official sheet music” heading from the shared copy',
  );
  assert(
    section.includes('EXTERNAL_MUSICNOTES_CTA_LABEL'),
    'the section renders the secondary Musicnotes CTA',
  );
  assert(
    section.includes('onOpen(smdUrl)'),
    'the primary card opens the SMD link through the caller',
  );
  assert(
    EXTERNAL_NO_MATCH_HINT.includes('licensed retailers'),
    'the zero-match hint names the licensed retailers (honest copy)',
  );
}

// ─── 4. mutation probes (each guard must fail on the defect) ────

function mutationProbes(): void {
  const screen = readAppFile(SCREEN);
  const section = readAppFile(SECTION);
  const builder = readAppFile(BUILDER);
  const history = readAppFile(HISTORY);

  // (a) the section is never wired / deleted outright.
  const noRender = screen.replace(/\n\s*<SearchExternalSection[\s\S]*?\/>/, '');
  assert(noRender !== screen, 'the delete-the-render mutation changed FindPieceScreen');
  assertEq(
    searchScreenRendersExternalSection(noRender),
    false,
    'MUTATION: removing the external section from the search screen FAILS the contract',
  );

  // (b) THE dead-end regression: the section gated behind internal results.
  const statusGated = screen.replace(
    '{external.visible ? (\n        <ScrollView',
    "{status === 'ready' ? (\n        <ScrollView",
  );
  assert(statusGated !== screen, 'the status-gate mutation changed FindPieceScreen');
  assertEq(
    searchScreenRendersExternalSection(statusGated),
    false,
    'MUTATION: gating the section on `status === ´ready´` FAILS (a zero-match query would dead-end)',
  );
  const subtlyGated = screen.replace(
    '{external.visible ? (\n        <ScrollView',
    "{status !== 'empty' && external.visible ? (\n        <ScrollView",
  );
  assert(subtlyGated !== screen, 'the subtle status-gate mutation changed FindPieceScreen');
  assertEq(
    searchScreenRendersExternalSection(subtlyGated),
    false,
    'MUTATION: even a `status !== ´empty´` guard FAILS (the no-match case must keep the money path)',
  );

  // (c) the section stops tracking the query.
  const staleQuery = screen.replace('externalSearchSection(query, pieces.length)', "externalSearchSection('Beethoven')");
  assert(staleQuery !== screen, 'the stale-query mutation changed FindPieceScreen');
  assertEq(
    searchScreenRendersExternalSection(staleQuery),
    false,
    'MUTATION: a section not built from the user’s query FAILS the contract',
  );

  // (d) a hand-rolled retailer URL on the screen (no affiliate id).
  const handRolled = screen.replace(
    '      {external.visible ? (',
    "      <Text>https://www.sheetmusicdirect.com/en-US/Search.aspx?query=x</Text>\n      {external.visible ? (",
  );
  assert(handRolled !== screen, 'the hand-rolled-URL mutation changed FindPieceScreen');
  assertEq(
    searchScreenUsesSharedUrlBuilder(handRolled),
    false,
    'MUTATION: a retailer URL written by hand on the screen FAILS the one-builder contract',
  );

  // (e) the affiliate id dropped from the builder (the money path goes unpaid).
  const noAffiliate = builder.replace(
    '&tid=${SMD_AFFILIATE_ID}&affiliateId=${SMD_AFFILIATE_ID}',
    '&tid=0&affiliateId=0',
  );
  assert(noAffiliate !== builder, 'the affiliate-strip mutation changed the builder');
  assertEq(
    externalUrlBuilderKeepsLiveShapes(noAffiliate),
    false,
    'MUTATION: dropping tid/affiliateId 67650 from the builder FAILS the contract',
  );

  // (f) the retired Musicnotes route and tag come back.
  const retiredRoute = builder.replace(
    "MUSICNOTES_SEARCH_PATH = '/search'",
    "MUSICNOTES_SEARCH_PATH = '/search/go'",
  );
  assert(retiredRoute !== builder, 'the retired-route mutation changed the builder');
  assertEq(
    externalUrlBuilderKeepsLiveShapes(retiredRoute),
    false,
    'MUTATION: the retired Musicnotes /search/go route FAILS the contract (fc19fe16)',
  );
  const retiredTag = builder.replace(
    "MUSICNOTES_SEARCH_QUERY_PARAM = 'w'",
    "MUSICNOTES_SEARCH_QUERY_PARAM = 'w=NoteSnap&w'",
  );
  assert(retiredTag !== builder, 'the retired-tag mutation changed the builder');
  assertEq(
    externalUrlBuilderKeepsLiveShapes(retiredTag),
    false,
    'MUTATION: reintroducing the w=NoteSnap tag FAILS the contract',
  );

  // (g) the section opens the retailer on its own (auto-redirect).
  const autoOpen = section.replace(
    'export const SearchExternalSection: React.FC<SearchExternalSectionProps> = ({',
    'const useAutoOpen = () => { useEffect(() => onOpen("https://www.sheetmusicdirect.com"), []); };\nexport const SearchExternalSection: React.FC<SearchExternalSectionProps> = ({',
  );
  assert(autoOpen !== section, 'the auto-open mutation changed the section component');
  assertEq(
    externalSectionOpensOnTapOnly(autoOpen),
    false,
    'MUTATION: an open-on-mount effect FAILS the tap-through (no auto-redirect) contract',
  );
  const ownWebView = section.replace(
    '      <Text style={styles.title}>{EXTERNAL_SECTION_TITLE}</Text>',
    '      <Text style={styles.title}>{EXTERNAL_SECTION_TITLE}</Text>\n      <WebView source={{ uri: section.smdUrl }} />',
  );
  assert(ownWebView !== section, 'the own-webview mutation changed the section component');
  assertEq(
    externalSectionOpensOnTapOnly(ownWebView),
    false,
    'MUTATION: the section rendering its own WebView FAILS (the shared shell owns the browser)',
  );
  const deadCard = section.replace('onPress={() => onOpen(smdUrl)}', 'onPress={() => {}}');
  assert(deadCard !== section, 'the dead-card mutation changed the section component');
  assertEq(
    externalSectionOpensOnTapOnly(deadCard),
    false,
    'MUTATION: a card that opens nothing FAILS the contract',
  );

  // (h) the zero-match state loses its pointer to the retailers.
  const wallAgain = screen.replace(
    '            <Text style={styles.emptyText}>{EXTERNAL_NO_MATCH_HINT}</Text>\n',
    '',
  );
  assert(wallAgain !== screen, 'the remove-the-hint mutation changed FindPieceScreen');
  assertEq(
    zeroMatchStatePointsAtRetailers(wallAgain),
    false,
    'MUTATION: deleting the zero-match retailer hint FAILS (the no-match state would be a wall)',
  );

  // (i) History grows the external section (the scope PR #141 protected).
  const historyScopeCreep = history.replace(
    'data={filteredItems}',
    'data={filteredItems}\n        ListFooterComponent={<SearchExternalSection section={external} onOpen={() => {}} />}',
  );
  assert(
    historyScopeCreep !== history,
    'the History-scope mutation changed HistoryScreen',
  );
  assertEq(
    historyScreenHasNoExternalSection(historyScopeCreep),
    false,
    'MUTATION: an external section inside HistoryScreen FAILS (History = saved recognitions only)',
  );
}

// ─── run ────────────────────────────────────────────────────────
function main(): void {
  console.log('\n=== search box: internal results + external licensed-retailer results ===');
  decisionTests();
  urlTests();
  liveScanTests();
  mutationProbes();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}
try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
