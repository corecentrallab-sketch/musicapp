/**
 * historyDeadEnd.test.ts — the source-scan gate for the History dead-end sprint
 * (owner 10-01: five messages, one coherent fix).
 *
 * Three behaviours the owner reported dead, all of them WIRING (so no logic test
 * can see them):
 *
 *   1. a saved modern-song row had no route to the sheet music it offered — the
 *      retailer links were dropped at save time, so tapping the row landed on
 *      "🎼 Sheet music coming soon";
 *   2. the piece page's sheet-music card was text, not an action, and the coach
 *      card said "reference melody coming soon" with no way to hear the melody;
 *   3. History's search box searched the whole catalog instead of the user's own
 *      saved recognitions.
 *
 * The predicates live in src/services/historyDeadEndContract.ts; this suite pins
 * them against synthetic pre-fix/post-fix sources, runs them on the REAL screens
 * off disk, and then runs a MUTATION PROBE per guard (put the defect back into
 * the real source and prove the guard fails) — the house pattern from
 * midiExportContract / scoreAudioSource.
 *
 * Run with: npm run test:tier1 (plain Node, no app runtime, no react-native).
 */
import {
  COACH_MELODY_CALL,
  COACH_NOTICE_CONSTANT,
  HISTORY_FILTER_CALL,
  PRIMARY_PURCHASE_CALL,
  PURCHASE_SHELL_OPENER,
  PURCHASE_URLS_FIELD,
  SHEET_CARD_CALL,
  coachCardHasNoPurchaseAction,
  coachCardNeverPromisesMelody,
  historySearchIsLocal,
  modernSaveCarriesPurchaseUrls,
  publicDomainSaveOmitsPurchaseUrls,
  pieceDetailOpensPurchaseCard,
} from '../src/services/historyDeadEndContract';
import {
  findBrowserContractViolations,
  findWebViewFlagViolations,
  missingWebViewFlags,
  REQUIRED_WEBVIEW_FLAGS,
  webViewTags,
} from '../src/services/inAppBrowserContract';
import { findModalsMissingBackHandler } from '../src/services/modalBackContract';

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

// ─── 1. the save sites ──────────────────────────────────────────

/**
 * The PRE-FIX modern save, verbatim in shape from origin/master
 * (HomeScreen.tsx:564 / ModernSearchScreen.tsx:236): identity + genre only. The
 * retailer links the match arrived with were dropped here — the root cause of the
 * owner's dead History row.
 */
const PRE_FIX_MODERN_SAVE = `
  await saveRecognition({
    id: m.isrc || m.song,
    title: m.song,
    composer: m.artist,
    savedAt: new Date().toISOString(),
    genre: modernGenreLabel(m),
  });
`;

/** The POST-FIX modern save: the same call, now carrying the licensed links. */
const POST_FIX_MODERN_SAVE = `
  await saveRecognition({
    id: m.isrc || m.song,
    title: m.song,
    composer: m.artist,
    savedAt: new Date().toISOString(),
    genre: modernGenreLabel(m),
    purchaseUrls: modernPurchaseUrls(m),
  });
`;

/** A public-domain save (the hum / PD cross-check shape). */
const PD_SAVE = `
  await saveRecognition({
    id: pd.id,
    title: pd.title,
    composer: pd.composer,
    savedAt: new Date().toISOString(),
    genre: pd.genre ?? PUBLIC_DOMAIN_GENRE,
  });
`;

function saveSiteUnitTests(): void {
  console.log('\nthe save sites: modern saves carry the links, PD saves do not');

  assertEq(
    modernSaveCarriesPurchaseUrls(PRE_FIX_MODERN_SAVE),
    false,
    'the pre-fix modern save (identity + genre only) FAILS the contract — this is the owner-reported dead end',
  );
  assertEq(
    modernSaveCarriesPurchaseUrls(POST_FIX_MODERN_SAVE),
    true,
    'the post-fix modern save carries purchaseUrls from modernPurchaseUrls()',
  );
  assertEq(
    modernSaveCarriesPurchaseUrls(PD_SAVE),
    false,
    'a file with no modern save at all does not pass the modern-save contract',
  );

  // A save that sets the field to a hand-built map instead of the backend's URLs
  // is not the same thing: the map must come from the match.
  assertEq(
    modernSaveCarriesPurchaseUrls(
      POST_FIX_MODERN_SAVE.replace(
        'modernPurchaseUrls(m)',
        "{ sheetmusicdirect: 'https://example.com/x' }",
      ),
    ),
    false,
    'a hand-built purchaseUrls map FAILS — the links must be the ones the match arrived with',
  );

  // Comments must never satisfy a guard (maskComments).
  assertEq(
    modernSaveCarriesPurchaseUrls(
      `// purchaseUrls: modernPurchaseUrls(m)\n${PRE_FIX_MODERN_SAVE}`,
    ),
    false,
    'a commented-out purchaseUrls line does not satisfy the contract',
  );

  assertEq(
    publicDomainSaveOmitsPurchaseUrls(PD_SAVE),
    true,
    'a public-domain save carries no purchase map (we host that score)',
  );
  assertEq(
    publicDomainSaveOmitsPurchaseUrls(
      PD_SAVE.replace(
        /genre: pd\.genre \?\? PUBLIC_DOMAIN_GENRE,/,
        'genre: pd.genre ?? PUBLIC_DOMAIN_GENRE,\n    purchaseUrls: modernPurchaseUrls(m),',
      ),
    ),
    false,
    'a PD save that carries a purchase map FAILS (a fabricated licensed link for a free score)',
  );
}

// ─── 2. the piece page + the coach card ─────────────────────────

/**
 * The POST-FIX wiring of the piece page's actions block, in the shape the real
 * PieceDetailScreen uses (the card is the else-arm of the sheet decision, and its
 * press hands the card's own url to the one shell opener).
 */
const PIECE_PAGE_WIRING = `
  const purchaseUrl = primaryPurchaseUrl(piece.purchaseUrls) ?? null;
  const sheetCard = modernSheetCard(piece);
  const sheetCardUrl = sheetCard?.url ?? null;
  return (
    <View>
      {piece.sheetMusicUrl ? (
        <TouchableOpacity onPress={handleViewSheetMusic}>…</TouchableOpacity>
      ) : sheetCard ? (
        <TouchableOpacity onPress={() => openInAppPurchase(sheetCardUrl)}>
          …
        </TouchableOpacity>
      ) : (
        <View>🎼 Sheet music coming soon</View>
      )}
      <CoachPracticeCard purchaseUrl={purchaseUrl} />
    </View>
  );
`;

const COACH_WIRING = `
  const melody = coachMelodyCard({ hasReference: coach.hasReference, purchaseUrl });
  if (melody.kind === 'hidden') return null;
  return (
    <View>
      {melody.kind === 'notice' ? (
        <Text>{COACH_NO_MELODY_NOTICE}</Text>
      ) : (
        <TouchableOpacity onPress={coach.start}>Record a take</TouchableOpacity>
      )}
    </View>
  );
`;

function surfaceUnitTests(): void {
  console.log('\nthe piece page and the coach card route to the purchase');

  assertEq(
    pieceDetailOpensPurchaseCard(PIECE_PAGE_WIRING),
    true,
    'the post-fix piece page renders the sheet-music card and its press opens it',
  );
  assertEq(
    pieceDetailOpensPurchaseCard(
      PIECE_PAGE_WIRING.replace('const sheetCard = modernSheetCard(piece);', ''),
    ),
    false,
    'without the pure card builder the page FAILS (the header/url are no longer the tested ones)',
  );
  assertEq(
    pieceDetailOpensPurchaseCard(
      PIECE_PAGE_WIRING.replace(
        PRIMARY_PURCHASE_CALL,
        'piece.purchaseUrls',
      ),
    ),
    false,
    'resolving the links without primaryPurchaseUrl FAILS (the retailer key order is not pinned)',
  );
  assertEq(
    pieceDetailOpensPurchaseCard(
      PIECE_PAGE_WIRING.replace(
        'onPress={() => openInAppPurchase(sheetCardUrl)}',
        'onPress={() => {}}',
      ),
    ),
    false,
    'an unpressed card FAILS — text where the owner required automatic purchase',
  );
  assertEq(
    pieceDetailOpensPurchaseCard(
      PIECE_PAGE_WIRING.replace(') : sheetCard ? (', ') : false ? ('),
    ),
    false,
    'a card that is never the sheet decision’s else-arm FAILS',
  );
  assertEq(
    pieceDetailOpensPurchaseCard(
      PIECE_PAGE_WIRING.replace(
        '<CoachPracticeCard',
        '<CoachPracticeCard onOpenPurchase={openInAppPurchase}',
      ),
    ),
    false,
    'a page that hands the coach card a SECOND opener FAILS (two purchase actions on one page)',
  );

  console.log('\nthe coach card: no purchase action, no promise');

  assertEq(
    coachCardHasNoPurchaseAction(COACH_WIRING),
    true,
    'the coach card mirrors the pure melody decision and holds no way to open a retailer',
  );
  assertEq(
    coachCardHasNoPurchaseAction(
      COACH_WIRING.replace(
        '<Text>{COACH_NO_MELODY_NOTICE}</Text>',
        '<TouchableOpacity onPress={() => openInAppPurchase(purchaseUrl)}><Text>Open</Text></TouchableOpacity>',
      ),
    ),
    false,
    'a coach card that opens the retailer again FAILS — the owner’s duplicate CTA box',
  );
  assertEq(
    coachCardHasNoPurchaseAction(
      COACH_WIRING.replace(
        'const melody = coachMelodyCard({',
        'onOpenPurchase?: (url: string) => void;\nconst melody = coachMelodyCard({',
      ),
    ),
    false,
    'a coach card that takes a purchase callback FAILS',
  );
  assertEq(
    coachCardHasNoPurchaseAction(COACH_WIRING.split('coachMelodyCard(').join('coachX(')),
    false,
    'a coach card that stops mirroring the pure decision FAILS',
  );

  assertEq(
    coachCardNeverPromisesMelody(COACH_WIRING),
    true,
    'the modern-song state renders the ONE honest notice and no promise',
  );
  assertEq(
    coachCardNeverPromisesMelody(
      COACH_WIRING.replace(
        'COACH_NO_MELODY_NOTICE',
        'noReference.headline',
      ),
    ),
    false,
    'rendering the old promise copy FAILS (the owner’s "coming soon" dead end)',
  );
  assertEq(
    coachCardNeverPromisesMelody(
      COACH_WIRING.replace(
        'COACH_NO_MELODY_NOTICE',
        "'Reference melody coming soon.'",
      ),
    ),
    false,
    'any inline "coming soon" promise FAILS',
  );
  assertEq(
    coachCardNeverPromisesMelody(
      COACH_WIRING.replace(
        "{melody.kind === 'notice'",
        "{false",
      ),
    ),
    false,
    'a card with no modern-song state at all FAILS (a modern song would render nothing)',
  );
  assertEq(
    coachCardNeverPromisesMelody(
      COACH_WIRING.replace('COACH_NO_MELODY_NOTICE', "'Here is the melody.'"),
    ),
    false,
    'the notice must come from the shared honest constant',
  );
}

// ─── 3. the History search scope ────────────────────────────────

const HISTORY_SEARCH_POST_FIX = `
  const [query, setQuery] = useState('');
  const filteredItems = useMemo(() => filterSavedPieces(items, query), [items, query]);
  return (
    <FlatList
      data={filteredItems}
      ListHeaderComponent={
        <TextInput value={query} onChangeText={setQuery} placeholder="Search saved by title or composer" />
      }
      ListEmptyComponent={<Text>No saved recognitions match</Text>}
    />
  );
`;

/** The PRE-FIX header button that opened the global catalog search. */
const HISTORY_SEARCH_PRE_FIX = `
  const [showFindPiece, setShowFindPiece] = useState(false);
  if (showFindPiece) return <FindPieceScreen onClose={() => setShowFindPiece(false)} />;
  return (
    <FlatList
      data={items}
      ListHeaderComponent={
        <TouchableOpacity onPress={() => setShowFindPiece(true)}>
          <Text>Find a piece — search the catalog</Text>
        </TouchableOpacity>
      }
    />
  );
`;

function historySearchUnitTests(): void {
  console.log('\nHistory search: the saved recognitions, never the catalog');

  assertEq(
    historySearchIsLocal(HISTORY_SEARCH_POST_FIX),
    true,
    'the post-fix History search filters the saved list in memory',
  );
  assertEq(
    historySearchIsLocal(HISTORY_SEARCH_PRE_FIX),
    false,
    'the pre-fix catalog search FAILS (it opened FindPieceScreen)',
  );
  assertEq(
    historySearchIsLocal(
      HISTORY_SEARCH_POST_FIX.replace(
        'filterSavedPieces(items, query)',
        'filterSavedPieces(catalog, query)',
      ),
    ),
    false,
    'filtering anything but the SAVED list FAILS',
  );
  assertEq(
    historySearchIsLocal(
      HISTORY_SEARCH_POST_FIX.replace('data={filteredItems}', 'data={items}'),
    ),
    false,
    'a query that never reaches the rendered list FAILS (the box would do nothing)',
  );
  assertEq(
    historySearchIsLocal(
      HISTORY_SEARCH_POST_FIX.replace(
        'onChangeText={setQuery}',
        'onSubmitEditing={() => searchPieces(query)}',
      ),
    ),
    false,
    'a box that submits to a catalog search FAILS',
  );
}

// ─── 4. live scan: the real screens ─────────────────────────────

function liveScanTests(): void {
  console.log('\nlive scan: the real save sites');

  const home = readAppFile('src/screens/HomeScreen.tsx');
  const modern = readAppFile('src/screens/ModernSearchScreen.tsx');
  const hum = readAppFile('src/screens/HumSearchScreen.tsx');
  assert(home.length > 3000, `read HomeScreen.tsx (${home.length} chars)`);
  assert(modern.length > 3000, `read ModernSearchScreen.tsx (${modern.length} chars)`);
  assert(hum.length > 3000, `read HumSearchScreen.tsx (${hum.length} chars)`);

  assertEq(
    modernSaveCarriesPurchaseUrls(home),
    true,
    'HomeScreen’s modern save carries the retailer links (the row can still buy)',
  );
  assertEq(
    modernSaveCarriesPurchaseUrls(modern),
    true,
    'ModernSearchScreen’s modern save carries the retailer links',
  );
  assertEq(
    publicDomainSaveOmitsPurchaseUrls(home),
    true,
    'HomeScreen’s public-domain and hum saves carry no purchase map',
  );
  assertEq(
    publicDomainSaveOmitsPurchaseUrls(modern),
    true,
    'ModernSearchScreen’s PD cross-check save carries no purchase map',
  );
  assertEq(
    publicDomainSaveOmitsPurchaseUrls(hum),
    true,
    'HumSearchScreen’s hum save carries no purchase map',
  );

  console.log('\nlive scan: the piece page, the coach card and the sheet card');

  const pieceDetail = readAppFile('src/screens/PieceDetailScreen.tsx');
  const coach = readAppFile('src/components/CoachPracticeCard.tsx');
  const history = readAppFile('src/screens/HistoryScreen.tsx');
  assert(pieceDetail.length > 3000, `read PieceDetailScreen.tsx (${pieceDetail.length} chars)`);
  assert(coach.length > 3000, `read CoachPracticeCard.tsx (${coach.length} chars)`);
  assert(history.length > 3000, `read HistoryScreen.tsx (${history.length} chars)`);

  assertEq(
    pieceDetailOpensPurchaseCard(pieceDetail),
    true,
    'the real piece page renders the sheet-music card and its press opens the retailer',
  );
  assert(
    pieceDetail.indexOf(SHEET_CARD_CALL) >= 0,
    `the card model comes from ${SHEET_CARD_CALL}`,
  );
  assert(
    pieceDetail.indexOf(PRIMARY_PURCHASE_CALL) >= 0,
    `the piece’s links resolve through ${PRIMARY_PURCHASE_CALL}`,
  );
  // The coach card gets the SAME resolved link, so it can tell a modern song
  // apart — but NO opener and no purchase action of its own (v31: one CTA/page).
  assert(
    /purchaseUrl=\{[A-Za-z]+\}/.test(pieceDetail),
    'the piece page passes the resolved purchase URL to the coach card',
  );
  assert(
    !/onOpenPurchase/.test(pieceDetail),
    'the piece page hands the coach card NO opener — the sheet-music card is the page’s ONE purchase action',
  );

  assertEq(
    coachCardHasNoPurchaseAction(coach),
    true,
    'the real coach card holds no purchase action at all (the owner’s duplicate CTA box is gone)',
  );
  assert(
    coach.indexOf(COACH_MELODY_CALL) >= 0,
    'the coach card mirrors the pure melody decision',
  );
  assert(
    !/onOpenPurchase/.test(coach) && coach.indexOf(PURCHASE_SHELL_OPENER) < 0,
    'nothing in the coach card can open the retailer',
  );
  assertEq(
    coachCardNeverPromisesMelody(coach),
    true,
    'the real coach card offers no melody it cannot produce: hidden when there is none, one honest line for a modern song',
  );
  assert(
    !coach.includes('noReference.headline'),
    'the old "Reference melody coming soon" render is gone from the card',
  );
  assert(
    coach.indexOf(COACH_NOTICE_CONSTANT) >= 0,
    `the modern-song state renders ${COACH_NOTICE_CONSTANT}`,
  );

  console.log('\nlive scan: the piece page’s browser shell (modal + runtime flags)');

  const shell = readAppFile('src/components/PurchaseWebView.tsx');
  assert(shell.length > 1000, `read PurchaseWebView.tsx (${shell.length} chars)`);
  const shellFiles = [
    { path: 'src/components/PurchaseWebView.tsx', source: shell },
    { path: 'src/screens/PieceDetailScreen.tsx', source: pieceDetail },
    { path: 'src/components/CoachPracticeCard.tsx', source: coach },
  ];
  const modalViolations = findModalsMissingBackHandler(shellFiles);
  for (const v of modalViolations) console.error(`  ✗ ${v.path}:${v.line} ${v.tag}`);
  assertEq(
    modalViolations.length,
    0,
    'every modal in this surface is BACK-closable (onRequestClose)',
  );
  const browserViolations = findBrowserContractViolations(shellFiles);
  for (const v of browserViolations) console.error(`  ✗ ${v.message}`);
  assertEq(
    browserViolations.length,
    0,
    'the retailer page renders in its OWN full-screen Modal (never a bare View/body)',
  );
  const flagViolations = findWebViewFlagViolations(shellFiles);
  for (const v of flagViolations) console.error(`  ✗ ${v.message}`);
  assertEq(
    flagViolations.length,
    0,
    'the shell WebView carries javaScriptEnabled + domStorageEnabled (Sheet Music Direct is a JS app)',
  );
  assertEq(
    webViewTags(shell).length >= 1,
    true,
    'the shell really renders a WebView (the flag scan has something to check)',
  );
  assert(
    shell.indexOf('← Back to NoteSnap') >= 0,
    'the shell header returns the user to NoteSnap (one BACK rule per piece page)',
  );

  console.log('\nlive scan: History’s search box is local');

  assertEq(
    historySearchIsLocal(history),
    true,
    'the real History search filters the SAVED recognitions in memory',
  );
  assert(
    history.indexOf(HISTORY_FILTER_CALL) >= 0,
    `History filters through ${HISTORY_FILTER_CALL}`,
  );
  assert(
    history.indexOf('Search saved by title or composer') >= 0,
    'the box says what it searches ("Search saved by title or composer")',
  );
  assert(
    history.indexOf('No saved recognitions match') >= 0,
    'a query with no match gets its own honest empty state',
  );
  assert(
    !/(?:^|\n)\s*import[^\n]*FindPieceScreen|(?:^|\n)\s*<FindPieceScreen/.test(history),
    'the global catalog search is no longer imported or rendered by History',
  );
}

// ─── 5. mutation probes on the REAL source ──────────────────────

function mutationProbes(): void {
  console.log('\nmutation probes: put each defect back into the real source');

  const home = readAppFile('src/screens/HomeScreen.tsx');
  const modern = readAppFile('src/screens/ModernSearchScreen.tsx');
  const pieceDetail = readAppFile('src/screens/PieceDetailScreen.tsx');
  const coach = readAppFile('src/components/CoachPracticeCard.tsx');
  const history = readAppFile('src/screens/HistoryScreen.tsx');
  const shell = readAppFile('src/components/PurchaseWebView.tsx');

  // (c) the modern save drops the links again — in ONE screen.
  const homeDropped = home.replace(
    '            purchaseUrls: modernPurchaseUrls(m),\n',
    '',
  );
  assert(homeDropped !== home, 'the dropped-links mutation changed HomeScreen');
  assertEq(
    modernSaveCarriesPurchaseUrls(homeDropped),
    false,
    'MUTATION: dropping purchaseUrls from Home’s modern save FAILS the contract',
  );
  assertEq(
    modernSaveCarriesPurchaseUrls(modern),
    true,
    'the other screen still passes (the guard is per-save-site, not global)',
  );

  const modernDropped = modern.replace('            purchaseUrls: modernPurchaseUrls(m),\n', '');
  assert(modernDropped !== modern, 'the dropped-links mutation changed ModernSearchScreen');
  assertEq(
    modernSaveCarriesPurchaseUrls(modernDropped),
    false,
    'MUTATION: dropping purchaseUrls from ModernSearchScreen’s modern save FAILS',
  );

  // A PD save acquiring a map (a fabricated licensed link for a free score).
  const pdWithLink = home.replace(
    /genre: pd\.genre \?\? PUBLIC_DOMAIN_GENRE,/,
    'genre: pd.genre ?? PUBLIC_DOMAIN_GENRE,\n              purchaseUrls: modernPurchaseUrls(m),',
  );
  assert(pdWithLink !== home, 'the PD-with-link mutation changed HomeScreen');
  assertEq(
    publicDomainSaveOmitsPurchaseUrls(pdWithLink),
    false,
    'MUTATION: a public-domain save carrying a purchase map FAILS the contract',
  );

  // (d) the sheet-music card and the coach card.
  const cardDetached = pieceDetail.replace(SHEET_CARD_CALL, 'null');
  assert(cardDetached !== pieceDetail, 'the card mutation changed PieceDetailScreen');
  assertEq(
    pieceDetailOpensPurchaseCard(cardDetached),
    false,
    'MUTATION: a piece page without the sheet-music card FAILS the contract',
  );

  const cardDead = pieceDetail.replace(
    'onPress={() => openInAppPurchase(sheetCardUrl)}',
    'onPress={() => {}}',
  );
  assert(cardDead !== pieceDetail, 'the dead-card mutation changed PieceDetailScreen');
  assertEq(
    pieceDetailOpensPurchaseCard(cardDead),
    false,
    'MUTATION: a card that no longer opens the retailer FAILS the contract',
  );

  const keyNamed = pieceDetail.replace(
    PRIMARY_PURCHASE_CALL,
    'piece.purchaseUrls?.sheetmusicdirect',
  );
  assert(keyNamed !== pieceDetail, 'the key-naming mutation changed PieceDetailScreen');
  assertEq(
    pieceDetailOpensPurchaseCard(keyNamed),
    false,
    'MUTATION: resolving the map by naming a retailer key FAILS the contract',
  );

  const coachDead = pieceDetail.replace(
    '        purchaseUrl={purchaseUrl}\n',
    '        purchaseUrl={purchaseUrl}\n        onOpenPurchase={openInAppPurchase}\n',
  );
  assert(
    coachDead !== pieceDetail,
    'the second-opener mutation changed PieceDetailScreen',
  );
  assertEq(
    pieceDetailOpensPurchaseCard(coachDead),
    false,
    'MUTATION: handing the coach card a second retailer opener FAILS (one CTA per page)',
  );

  // (d, v31) the duplicate buy button comes BACK inside the coach card.
  const coachButtonBack = coach.replace(
    '          {COACH_NO_MELODY_NOTICE}\n',
    '          <TouchableOpacity onPress={() => openInAppPurchase(purchaseUrl)}>\n' +
      '            <Text>{COACH_NO_MELODY_NOTICE}</Text>\n' +
      '          </TouchableOpacity>\n',
  );
  assert(coachButtonBack !== coach, 'the duplicate-button mutation changed CoachPracticeCard');
  assertEq(
    coachCardHasNoPurchaseAction(coachButtonBack),
    false,
    'MUTATION: a buy button back in the coach card FAILS (the owner’s duplicate CTA box)',
  );
  assertEq(
    coachCardHasNoPurchaseAction(coach),
    true,
    'the untouched card still passes (the probe changed the source it targeted)',
  );

  // (d, v31) the promise comes back — the old "coming soon" render.
  const promiseBack = coach.replace('{COACH_NO_MELODY_NOTICE}', '{noReference.headline}');
  assert(promiseBack !== coach, 'the promise mutation changed CoachPracticeCard');
  assertEq(
    coachCardNeverPromisesMelody(promiseBack),
    false,
    'MUTATION: rendering the old no-melody promise copy FAILS',
  );

  // (d, v31) the hidden state stops short-circuiting: a PD piece with no melody
  // is promised something again.
  const hiddenGone = coach.replace(
    "  if (melody.kind === 'hidden') return null;",
    "  if (melody.kind === 'hidden') { /* nothing */ }",
  );
  assert(hiddenGone !== coach, 'the hidden-branch mutation changed CoachPracticeCard');
  assertEq(
    coachCardNeverPromisesMelody(hiddenGone),
    false,
    'MUTATION: a card that no longer hides for a melody-less PD piece FAILS',
  );

  // (d, flags) the money-path WebView flags gone again.
  const flagMissing = shell.replace('\n          domStorageEnabled', '');
  assert(flagMissing !== shell, 'the flag mutation changed PurchaseWebView');
  assertEq(
    findWebViewFlagViolations([
      { path: 'src/components/PurchaseWebView.tsx', source: flagMissing },
    ]).length >= 1,
    true,
    'MUTATION: dropping domStorageEnabled FAILS the WebView-flag contract',
  );
  assertEq(
    missingWebViewFlags(webViewTags(flagMissing)[0]?.tag ?? '').includes(
      'domStorageEnabled',
    ),
    true,
    'the missing flag is named in the violation (domStorageEnabled)',
  );

  const backGone = shell.replace(
    '      onRequestClose={onClose}\n',
    '',
  );
  assert(backGone !== shell, 'the back-handler mutation changed PurchaseWebView');
  assertEq(
    findModalsMissingBackHandler([
      { path: 'src/components/PurchaseWebView.tsx', source: backGone },
    ]).length,
    1,
    'MUTATION: a shell modal with no onRequestClose FAILS (BACK cannot return)',
  );

  assertEq(
    REQUIRED_WEBVIEW_FLAGS.length,
    2,
    'the contract still requires exactly javaScriptEnabled + domStorageEnabled',
  );
  assertEq(
    findBrowserContractViolations([
      { path: 'src/components/PurchaseWebView.tsx', source: shell },
    ]).length,
    0,
    'the shell’s own returned tree is the Modal (no bare-View WebView anywhere)',
  );

  // (e) History reopens the global catalog search.
  const globalAgain = history
    .replace('data={filteredItems}', 'data={items}')
    .replace('onChangeText={setQuery}', 'onChangeText={() => setShowFindPiece(true)}');
  assert(globalAgain !== history, 'the global-search mutation changed HistoryScreen');
  assertEq(
    historySearchIsLocal(globalAgain),
    false,
    'MUTATION: a History search that no longer filters the saved list FAILS',
  );
  const findPieceBack = history.replace(
    '        contentContainerStyle={styles.listContent}',
    '        contentContainerStyle={styles.listContent}\n        ListFooterComponent={<FindPieceScreen onClose={() => {}} />}',
  );
  assert(findPieceBack !== history, 'the FindPiece mutation changed HistoryScreen');
  assertEq(
    historySearchIsLocal(findPieceBack),
    false,
    'MUTATION: re-opening FindPieceScreen from History FAILS (History search = saved recognitions)',
  );
  assertEq(
    PURCHASE_URLS_FIELD,
    'purchaseUrls',
    'the field the save sites must carry is named purchaseUrls',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== history dead ends (saved row → sheet music, melody, search) ===');
  saveSiteUnitTests();
  surfaceUnitTests();
  historySearchUnitTests();
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
