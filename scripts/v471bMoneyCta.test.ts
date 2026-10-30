/**
 * v471bMoneyCta.test.ts — ITEMS 1 + 2 + 3 (v47.1 Part B).
 *
 * ITEM 1 — ONE full-width primary money CTA on a page with no hosted score, and
 *          NOTHING laid out on the same row (the #199 / v46 red-bar class: a
 *          primary CTA sharing `styles.actions` collapses to its padding).
 * ITEM 2 — the metadata-only rows' honest path: a retailer SEARCH pre-filled
 *          with THAT ROW's own composer + title, carrying affiliate id 67650 on
 *          every route (the v47 Part A D0 class: a query that silently drops the
 *          affiliate id pays nobody).
 * ITEM 3 — the disclosure line is RENDERED on every surface that renders an
 *          affiliate CTA — enumerated, not sampled, and the enumeration cannot
 *          silently miss a new surface.
 *
 * Every layout/hosting predicate is run against the REAL files, and each one is
 * shown to FAIL on a mutated copy (the pre-fix shape) so a green result cannot
 * be vacuous. Plain Node, no react-native, no network. `npm run test:tier1`.
 */
import {
  AFFILIATE_CTA_EXEMPTIONS,
  AFFILIATE_CTA_SURFACES,
  AFFILIATE_DISCLOSURE,
  MONEY_CTA_BLOCK_STYLE,
  MONEY_CTA_EDITIONS_LABEL,
  MONEY_CTA_OFFICIAL_LABEL,
  MONEY_CTA_COMPONENT_FILE,
  PIECE_SCREEN_FILE,
  affiliateSurfacePaths,
  affiliateSurfaceRendersDisclosure,
  affiliateSurfaceScan,
  editionsQuery,
  moneyCtaBlockHasNoRowSibling,
  moneyCtaBlockIsFullWidth,
  moneyCtaIsHostedOnUnscoredPiecePath,
  moneyCtaIsOutsideTheActionRow,
  moneyCtaUrlKeepsTheAffiliateId,
  publishedEditionsUrl,
  resolveUnscoredMoneyCta,
} from '../src/services/v471bMoneyCta';
import { maskComments } from '../src/services/modalBackContract';

let passes = 0;
let failures = 0;

declare const require: ((id: string) => any) & {
  resolve(id: string, options?: { paths?: string[] }): string;
};
declare const process: { cwd(): string; exit(code: number): never };

function assert(ok: boolean, label: string): void {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ FAILED: ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (!ok) {
    console.log(`    expected ${String(expected)}, got ${String(actual)}`);
  }
  assert(ok, label);
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('repo root not found from ' + process.cwd());
}

function readSrc(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

function srcFiles(): Record<string, string> {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        out[path.relative(root, full).replace(/\\/g, '/')] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(path.join(root, 'src'));
  return out;
}

/** Two REAL catalog shapes: a classical work and a family (folk) row. */
const CLASSICAL_ROW = { composer: 'Bach', title: 'Prelude in C major, BWV 846' };
const FAMILY_ROW = { composer: 'Traditional', title: 'Greensleeves' };

// ─── 1. the pre-fill is THAT ROW's own words ─────────────────────
function prefillTests(): void {
  console.log('\nthe retailer query is built from the row itself');
  assertEq(
    editionsQuery(CLASSICAL_ROW.composer, CLASSICAL_ROW.title),
    'Bach Prelude in C major, BWV 846',
    'a classical row searches its own composer + title',
  );
  assertEq(
    editionsQuery(FAMILY_ROW.composer, FAMILY_ROW.title),
    'Traditional Greensleeves',
    'a family row searches its own composer + title',
  );
  assertEq(editionsQuery('Unknown', 'Greensleeves'), 'Greensleeves', 'an unknown composer is dropped, the title is kept');
  assertEq(editionsQuery('', 'Greensleeves'), 'Greensleeves', 'an empty composer degrades to the title alone');
  assertEq(
    editionsQuery('Bach', 'Bach — Prelude in C'),
    'Bach — Prelude in C',
    'a composer already inside the title is not doubled',
  );
  assertEq(editionsQuery('Bach', ''), '', 'a row with no title has no query at all');
  assertEq(editionsQuery(null, null), '', 'nulls produce no query (never a generic placeholder)');

  const classicalUrl = publishedEditionsUrl(CLASSICAL_ROW.composer, CLASSICAL_ROW.title) as string;
  const familyUrl = publishedEditionsUrl(FAMILY_ROW.composer, FAMILY_ROW.title) as string;
  assert(!!classicalUrl && !!familyUrl, 'both real rows resolve to a retailer URL');
  assertEq(
    classicalUrl,
    'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=' +
      encodeURIComponent('Bach Prelude in C major, BWV 846') +
      '&tid=67650&affiliateId=67650',
    'the classical row URL is the SMD search shape with BOTH affiliate params',
  );
  assertEq(
    familyUrl,
    'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=' +
      encodeURIComponent('Traditional Greensleeves') +
      '&tid=67650&affiliateId=67650',
    'the family row URL is the SMD search shape with BOTH affiliate params',
  );
  assertEq(publishedEditionsUrl('', ''), undefined, 'no title → no URL (never a generic search)');
}

// ─── 2. the affiliate id survives every route (the D0 class) ─────
function affiliateTests(): void {
  console.log('\nthe affiliate id survives URL construction on every route');
  const rows = [
    CLASSICAL_ROW,
    FAMILY_ROW,
    { composer: 'Chopin', title: 'Nocturne in E-flat major, Op. 9 No. 2' },
    { composer: '', title: 'Amazing Grace' },
  ];
  for (const row of rows) {
    const url = publishedEditionsUrl(row.composer, row.title) as string;
    assert(!!url, `a URL was built for "${row.title}"`);
    assert(moneyCtaUrlKeepsTheAffiliateId(url), `"${row.title}" keeps tid=67650 + affiliateId=67650`);
    assert(
      url.indexOf('query=' + encodeURIComponent(editionsQuery(row.composer, row.title))) >= 0,
      `"${row.title}" searches its OWN words, not a shared generic query`,
    );
  }
  // The defect class, by shape.
  assert(
    !moneyCtaUrlKeepsTheAffiliateId('https://www.sheetmusicdirect.com/en-US/Search.aspx?query=bach'),
    'probe: a URL that dropped tid is refused (the D0 defect)',
  );
  assert(
    !moneyCtaUrlKeepsTheAffiliateId('https://www.sheetmusicdirect.com/genre/ragtime'),
    'probe: a canonical page is refused by shape (that is what loses the id)',
  );
  assert(
    !moneyCtaUrlKeepsTheAffiliateId(undefined),
    'an absent URL is refused',
  );
}

// ─── 3. the decision ────────────────────────────────────────────
function decisionTests(): void {
  console.log('\nwhat the unscored page offers');
  const official = resolveUnscoredMoneyCta({
    title: 'Blinding Lights',
    composer: 'The Weeknd',
    purchaseUrl: 'https://www.sheetmusicdirect.com/en-US/Product.aspx?ID=1&tid=67650&affiliateId=67650',
  });
  assertEq(official.kind, 'official', 'a row with its own licensed page → the official CTA');
  assertEq(official.label, MONEY_CTA_OFFICIAL_LABEL, '…labelled "Get Official Sheet Music"');

  const editions = resolveUnscoredMoneyCta({ title: 'Greensleeves', composer: 'Traditional' });
  assertEq(editions.kind, 'published-editions', 'a metadata-only row → the published-editions search');
  assertEq(editions.label, MONEY_CTA_EDITIONS_LABEL, '…labelled "Search Official Published Editions"');
  assertEq(editions.query, 'Traditional Greensleeves', '…pre-filled with the row own words');
  assert(
    moneyCtaUrlKeepsTheAffiliateId(editions.url),
    '…and the URL it opens still carries the affiliate id',
  );

  const none = resolveUnscoredMoneyCta({ title: '', composer: '' });
  assertEq(none.kind, 'none', 'a row with nothing to search renders NO money block');
  const notAUrl = resolveUnscoredMoneyCta({ title: 'Greensleeves', composer: '', purchaseUrl: 'soon' });
  assertEq(notAUrl.kind, 'published-editions', 'a non-URL purchase value is ignored, not rendered');
}

// ─── 4. the layout (the #199 class) ─────────────────────────────
function layoutTests(): void {
  console.log('\nONE full-width primary CTA, nothing on its row');
  const component = readSrc(MONEY_CTA_COMPONENT_FILE);
  assert(component.length > 1500, 'the component source was really read');
  assert(moneyCtaBlockIsFullWidth(component), 'the money block is full width (stretch, column, no flex)');
  assert(moneyCtaBlockHasNoRowSibling(component), 'the block holds exactly ONE pressable, and the disclosure');
  assert(
    component.indexOf('{AFFILIATE_DISCLOSURE}') >= 0,
    'the disclosure is RENDERED under the button, from the shared constant',
  );

  // Probes: the defect shapes must fail.
  const rowBlock = component.replace(
    "    alignSelf: 'stretch',\n    marginHorizontal: 20,",
    "    flexDirection: 'row',\n    flex: 1,\n    marginHorizontal: 20,",
  );
  assert(rowBlock !== component, 'probe: the row/flex shape was reconstructed');
  assert(!moneyCtaBlockIsFullWidth(rowBlock), 'probe: a row/flex block fails the full-width rule');

  const squeezed = component.replace(
    "    alignSelf: 'stretch',\n    backgroundColor: '#e94560',",
    "    flex: 1,\n    backgroundColor: '#e94560',",
  );
  assert(!moneyCtaBlockIsFullWidth(squeezed), 'probe: a `flex: 1` button fails the full-width rule');

  const withSibling = component.replace(
    '      <Text style={styles.moneyCtaDisclosure}>{AFFILIATE_DISCLOSURE}</Text>',
    '      <Text style={styles.moneyCtaDisclosure}>{AFFILIATE_DISCLOSURE}</Text>\n' +
      '      <TouchableOpacity accessibilityRole="button" onPress={() => onOpen(url)}>\n' +
      '        <Text>Share</Text>\n' +
      '      </TouchableOpacity>',
  );
  assert(withSibling !== component, 'probe: a second control was added to the block');
  assert(
    !moneyCtaBlockHasNoRowSibling(withSibling),
    'probe: a sibling control in the block fails the one-pressable rule',
  );
}

// ─── 5. hosting on the unscored-piece path (v46 lesson) ─────────
function hostingTests(): void {
  console.log('\nthe block is HOSTED, not merely defined');
  const screen = readSrc(PIECE_SCREEN_FILE);
  assert(screen.length > 5000, 'the piece screen source was really read');
  assert(
    moneyCtaIsHostedOnUnscoredPiecePath(screen),
    'the piece screen renders it inside the honest no-score state, wired to openInAppPurchase',
  );
  assert(
    moneyCtaIsOutsideTheActionRow(screen),
    'the money CTA is NOT a child of the two-CTA action row',
  );

  // Probes.
  const unhosted = screen.replace('<OfficialEditionsCta', '<SomethingElse');
  assert(
    !moneyCtaIsHostedOnUnscoredPiecePath(unhosted),
    'probe: removing the host fails the hosting rule (defined-but-unrendered)',
  );
  const unwired = screen.replace('onOpen={openInAppPurchase}', 'onOpen={() => undefined}');
  assert(
    !moneyCtaIsHostedOnUnscoredPiecePath(unwired),
    'probe: an unwired tap fails the hosting rule (a lever with no destination)',
  );
  const rowAt = screen.indexOf('style={styles.actions}');
  const ctaAt = screen.indexOf('<OfficialEditionsCta');
  assert(rowAt >= 0 && ctaAt > rowAt, 'the money CTA really renders after the action row');
  assert(
    !moneyCtaIsOutsideTheActionRow('<View style={styles.actions}><OfficialEditionsCta /></View>'),
    'probe: a money CTA INSIDE the action row is refused (the #199 defect)',
  );
  assert(MONEY_CTA_BLOCK_STYLE === 'moneyCtaBlock', 'the pinned block style key is unchanged');
}

// ─── 6. the disclosure on every affiliate surface ───────────────
function disclosureTests(): void {
  console.log('\nthe disclosure is on EVERY surface that shows an affiliate CTA');
  assert(AFFILIATE_DISCLOSURE.length > 40, 'the disclosure is a real sentence');
  assert(
    AFFILIATE_DISCLOSURE.indexOf('commission') >= 0 &&
      AFFILIATE_DISCLOSURE.indexOf('no extra cost') >= 0 &&
      AFFILIATE_DISCLOSURE.indexOf('in-app browser') >= 0,
    'it says the three true things: commission, no extra cost, opens in-app',
  );
  assert(
    !/urgent|only \d+ left|recommended by|hurry/i.test(AFFILIATE_DISCLOSURE),
    'no urgency, no scarcity, no "recommended by" implication',
  );

  const files = srcFiles();
  const paths = Object.keys(files);
  assert(paths.length >= 200, `the surface scan really walked src/ (${paths.length} files)`);
  const audit = affiliateSurfaceScan(files);
  assertEq(audit.checked, affiliateSurfacePaths().length, 'every enumerated surface was actually checked');
  assert(audit.checked >= 10, `the enumeration covers the app (${audit.checked} surfaces, floor 10)`);
  assertEq(audit.missing.join(', '), '', 'no affiliate surface is missing the disclosure');
  assertEq(audit.undiscovered.join(', '), '', 'no NEW affiliate surface escaped the enumeration');
  assert(
    Object.keys(AFFILIATE_CTA_EXEMPTIONS).length >= 1,
    'the exemption list is explicit (and documented), not empty by accident',
  );

  // Probes.
  const surface = 'src/components/SearchExternalSection.tsx';
  const stripped = files[surface].replace('{AFFILIATE_DISCLOSURE}', 'NoteSnap');
  const probe = affiliateSurfaceScan({ ...files, [surface]: stripped });
  assert(
    probe.missing.indexOf(surface) >= 0,
    'probe: a surface with the disclosure removed is reported missing',
  );
  const stranger = 'src/components/BrandNewRetailerCard.tsx';
  const strangerScan = affiliateSurfaceScan({
    ...files,
    [stranger]: "const u = sheetMusicDirectSearchUrl('x');\n<TouchableOpacity onPress={open} />",
  });
  assert(
    strangerScan.undiscovered.indexOf(stranger) >= 0,
    'probe: a NEW affiliate surface with no disclosure is caught by the enumeration',
  );
  assert(
    affiliateSurfaceRendersDisclosure('const x = 1;', { mode: 'direct' }) === false,
    'probe: a tiny/empty source cannot satisfy the check',
  );
  assert(
    affiliateSurfaceScan({
      ...files,
      'src/components/CoachPracticeCard.tsx': 'purchaseUrl',
    }).undiscovered.indexOf('src/components/CoachPracticeCard.tsx') < 0,
    'the documented exemption (signal-only card) is honoured',
  );
  // The four direct surfaces this build touched are all in the enumeration.
  for (const path of [
    'src/components/OfficialEditionsCta.tsx',
    'src/components/SearchExternalSection.tsx',
    'src/components/RecognitionResultView.tsx',
    'src/components/ModernSongInterstitial.tsx',
    'src/components/FamilyScreen.tsx',
    'src/screens/PieceDetailScreen.tsx',
    'src/screens/HistoryScreen.tsx',
  ]) {
    assert(AFFILIATE_CTA_SURFACES[path] !== undefined, `${path} is an enumerated affiliate surface`);
  }
  // …and each of them really renders the line.
  for (const path of Object.keys(AFFILIATE_CTA_SURFACES)) {
    const entry = AFFILIATE_CTA_SURFACES[path];
    if (entry.mode !== 'direct') continue;
    assert(
      maskComments(files[path]).indexOf('{AFFILIATE_DISCLOSURE}') >= 0,
      `${path} renders the disclosure`,
    );
  }
}

/**
 * PARSE GUARD — the class no other assertion in this repo could see.
 *
 * WHY IT EXISTS: the first cut of this feature put the purchase button and the
 * disclosure side by side inside one ternary branch, with no enclosing element.
 * Metro/Babel refuse to bundle that ("Adjacent JSX elements must be wrapped in
 * an enclosing tag"), so the whole app was unbuildable — and every gate we had
 * was still green: `tsc -p tsconfig.tier1.json` does not include `src/screens/`
 * or `src/components/`, and the source-scan suites read these files as TEXT and
 * never parse them. A file that does not compile as JSX passes both.
 *
 * WHAT IT DOES: parses the touched components with the repo's OWN TypeScript in
 * TSX mode and demands zero parse diagnostics, then proves the modern purchase
 * branch is ONE root element and that the disclosure lives inside it. This is a
 * real parse — not a regex — so a fragment-less file cannot slip through it.
 * (`npm run test:tier1` also runs the full babel pre-flight in CI evidence; this
 * is the in-gate version of the same rule for the files this feature touched.)
 */
const PARSE_GUARD_FILES = [
  'src/components/RecognitionResultView.tsx',
  'src/components/FamilyScreen.tsx',
  'src/components/SearchExternalSection.tsx',
  'src/components/ModernSongInterstitial.tsx',
  'src/components/OfficialEditionsCta.tsx',
  'src/components/ShareCard.tsx',
  'src/screens/PieceDetailScreen.tsx',
  'src/screens/HistoryScreen.tsx',
];

/** The repo's own TypeScript, resolved from the repo root (the gate runs tsc). */
function typescriptModule(): any {
  return require(require.resolve('typescript', { paths: [repoRoot()] }));
}

/** Parse one TSX source file; return its parse diagnostics as readable lines. */
function tsxParseDiagnostics(ts: any, rel: string): string[] {
  const path = require('path');
  const file = path.join(repoRoot(), rel);
  const sf = ts.createSourceFile(
    file,
    readSrc(rel),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diags: any[] = sf.parseDiagnostics ?? [];
  return diags.map(
    (d: any) => `${rel}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
  );
}

/** Depth-first search for the conditional whose test is exactly `condText`. */
function findConditional(ts: any, node: any, condText: string): any | null {
  if (
    ts.isConditionalExpression(node) &&
    node.condition.getText().trim() === condText
  ) {
    return node;
  }
  let found: any = null;
  ts.forEachChild(node, (child: any) => {
    if (!found) found = findConditional(ts, child, condText);
  });
  return found;
}

function parseGuardTests(): void {
  console.log('\n── PARSE GUARD: the touched surfaces must PARSE (not just scan)');
  const ts = typescriptModule();
  for (const rel of PARSE_GUARD_FILES) {
    const diags = tsxParseDiagnostics(ts, rel);
    assert(
      diags.length === 0,
      `${rel} parses as TSX` + (diags.length ? ` — ${diags[0]}` : ''),
    );
  }
  // The exact defect: the modern branch must return ONE root element, and the
  // disclosure must ride inside that branch (never hoisted, never in the else).
  const path = require('path');
  const rel = 'src/components/RecognitionResultView.tsx';
  const sf = ts.createSourceFile(
    path.join(repoRoot(), rel),
    readSrc(rel),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const branch = findConditional(ts, sf, 'hasPurchaseUrl');
  assert(branch !== null, 'the modern purchase branch is still a hasPurchaseUrl ternary');
  if (branch) {
    const whenTrue = branch.whenTrue;
    const whenFalse = branch.whenFalse;
    // `? ( <X/> )` parses as ParenthesizedExpression → the JSX node inside it.
    let root = whenTrue;
    while (ts.isParenthesizedExpression(root)) root = root.expression;
    assert(
      ts.isJsxFragment(root) || ts.isJsxElement(root),
      'the purchase branch returns ONE root JSX element',
    );
    const trueText = whenTrue.getText();
    assert(
      trueText.indexOf('AFFILIATE_DISCLOSURE') >= 0,
      'the disclosure renders INSIDE the purchase branch',
    );
    assert(
      whenFalse.getText().indexOf('AFFILIATE_DISCLOSURE') < 0,
      'the disclosure is NOT in the no-link branch',
    );
    assert(
      trueText.indexOf('purchaseBtn') >= 0,
      'the purchase button is still in that branch',
    );
  }
}

// ─── run ────────────────────────────────────────────────────────
function main(): void {
  console.log('v47.1 Part B items 1-3 — the money CTA, its pre-fill, its disclosure');
  prefillTests();
  affiliateTests();
  decisionTests();
  layoutTests();
  hostingTests();
  disclosureTests();
  parseGuardTests();
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
