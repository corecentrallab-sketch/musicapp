/**
 * purchaseCtaContract.test.ts — the app's money path: WHICH retailer a purchase
 * CTA opens, and the source guard that keeps it that way.
 *
 * Defect (link audit 09-23): the backend's purchase-URL map holds the
 * owner-approved retailers in priority order — `sheetmusicdirect` (Sheet Music
 * Direct, affiliate ID 67650, PRIMARY) then `musicnotes` (BACKUP) — and the
 * website fix (backend PR #120) made the map emit the primary. The APP still read
 * the backup by name:
 *
 *     topMatch.purchase_url?.musicnotes ?? phase.response.purchase_url!.musicnotes
 *
 * so every in-app "Get Official Sheet Music" tap went to the backup retailer (and
 * its smaller commission) no matter what the backend sent. Same defect class the
 * site's demo CTA had. The fix is `primaryPurchaseUrl()` — the first APPROVED key
 * present — and this suite guards it from both ends:
 *
 *   1. BEHAVIOUR — resolution order, fallbacks, and the honest "nothing to open"
 *      case, plus the modern-song route's primary (`retailerUrl`) and secondary
 *      (`musicnotesUrl`) CTA URLs;
 *   2. STRUCTURE — a live source scan of the app: no file may dereference a
 *      retailer key or hardcode a retailer hostname, the "Try Musicnotes"
 *      secondary CTA must exist AND be wired to the backend's `musicnotesUrl`
 *      (the "CTA never wired" class), and the modern interstitial must keep ONE
 *      browser surface (so BACK still has one rule).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  APPROVED_PURCHASE_URL_KEYS,
  BACKUP_PURCHASE_URL_KEY,
  PRIMARY_PURCHASE_URL_KEY,
  PURCHASE_CTA_MODULE_PATH,
  RETAILER_HOSTNAME_PATTERN,
  RETAILER_KEY_DEREF_PATTERN,
  findExternalUrlOpens,
  formatExternalUrlOpens,
  formatRetailerCtaOffenders,
  isApprovedPurchaseUrlKey,
  modernBackupRetailerUrl,
  modernPrimaryRetailerUrl,
  modernSecondaryRetailerUrl,
  noPurchaseActionLeavesTheApp,
  primaryPurchaseUrl,
  purchaseActionIsInShell,
  purchaseActionSites,
  purchaseShellMounts,
  purchaseShellUrlState,
  recognitionPurchaseUrl,
  scanSourcesForHardwiredRetailerKey,
  uniquePurchaseActionPerSurface,
} from '../src/services/purchaseCta';
import {
  findBrowserContractViolations,
  findWebViewFlagViolations,
} from '../src/services/inAppBrowserContract';
import type { ModernMatch } from '../src/types';

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

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

// ─── 1. Behaviour: which retailer a CTA opens ───────────────────

const SMD = 'https://www.sheetmusicdirect.com/en-US/Search.aspx?query=test&tid=67650';
const MN = 'https://www.musicnotes.com/search/go?q=test&w=NoteSnap';

/** A map in the shape the backend emits. */
const mapOf = (entries: Record<string, string | undefined>) => entries;

function resolutionTests(): void {
  console.log('\nretailer registry (mirrors the backend)');

  assertEq(
    PRIMARY_PURCHASE_URL_KEY,
    'sheetmusicdirect',
    'the primary key is the backend\'s primary key (Sheet Music Direct, ID 67650)',
  );
  assertEq(
    BACKUP_PURCHASE_URL_KEY,
    'musicnotes',
    'the backup key is the backend\'s backup key (Musicnotes)',
  );
  assertEq(
    APPROVED_PURCHASE_URL_KEYS.join(','),
    'sheetmusicdirect,musicnotes',
    'approved keys are in priority order, primary first',
  );
  assert(isApprovedPurchaseUrlKey('sheetmusicdirect'), 'the primary is approved');
  assert(isApprovedPurchaseUrlKey('musicnotes'), 'the backup is approved');
  assert(
    !isApprovedPurchaseUrlKey('sheetmusicplus'),
    'Sheet Music Plus (owner-dropped) is not approved',
  );
  assert(!isApprovedPurchaseUrlKey('jwpepper'), 'JW Pepper (no affiliate ID) is not approved');

  console.log('\nresolution order');

  assertEq(
    primaryPurchaseUrl(mapOf({ [PRIMARY_PURCHASE_URL_KEY]: SMD, [BACKUP_PURCHASE_URL_KEY]: MN })),
    SMD,
    'THE fix: with both present the PRIMARY wins (the bug was the backup winning)',
  );
  assertEq(
    primaryPurchaseUrl(mapOf({ [BACKUP_PURCHASE_URL_KEY]: MN })),
    MN,
    'the backup is used only when the primary is absent',
  );
  assertEq(
    primaryPurchaseUrl(mapOf({ [PRIMARY_PURCHASE_URL_KEY]: '   ' })),
    undefined,
    'an empty primary does not count as present (falls through, no blank page)',
  );
  assertEq(
    primaryPurchaseUrl(mapOf({ [BACKUP_PURCHASE_URL_KEY]: MN, sheetmusicplus: 'https://x.test' })),
    MN,
    'an unapproved key can never be opened, even alongside an approved one',
  );
  assertEq(
    primaryPurchaseUrl(mapOf({ sheetmusicplus: 'https://x.test', jwpepper: 'https://y.test' })),
    undefined,
    'an all-unapproved map opens nothing (honest "not linked yet")',
  );
  assertEq(primaryPurchaseUrl(null), undefined, 'a null map resolves to nothing');
  assertEq(primaryPurchaseUrl(undefined), undefined, 'an absent map resolves to nothing');
  assertEq(primaryPurchaseUrl(mapOf({})), undefined, 'an empty map resolves to nothing');
  assertEq(
    primaryPurchaseUrl(mapOf({ [PRIMARY_PURCHASE_URL_KEY]: ` ${SMD} ` })),
    SMD,
    'a padded URL is trimmed before it is opened',
  );

  console.log('\nrecognition result (classical path)');

  assertEq(
    recognitionPurchaseUrl(mapOf({ [PRIMARY_PURCHASE_URL_KEY]: SMD }), mapOf({ [BACKUP_PURCHASE_URL_KEY]: MN })),
    SMD,
    'the top match\'s own map is used first',
  );
  assertEq(
    recognitionPurchaseUrl(null, mapOf({ [PRIMARY_PURCHASE_URL_KEY]: SMD })),
    SMD,
    'the response-level map is the fallback when the match carries none',
  );
  assertEq(
    recognitionPurchaseUrl(mapOf({}), mapOf({ [PRIMARY_PURCHASE_URL_KEY]: SMD })),
    SMD,
    'an empty match map falls back too',
  );
  assertEq(
    recognitionPurchaseUrl(mapOf({ [BACKUP_PURCHASE_URL_KEY]: MN }), mapOf({ [PRIMARY_PURCHASE_URL_KEY]: SMD })),
    MN,
    'the match map outranks the response map (the closer map wins)',
  );
  assertEq(
    recognitionPurchaseUrl(null, null),
    undefined,
    'nothing anywhere means no CTA is rendered',
  );

  console.log('\nmodern-song path (the backend supplies both URLs)');

  const modern: ModernMatch = {
    song: 'Test Song',
    artist: 'Test Artist',
    matchConfidence: 1,
    source: 'audd',
    retailerUrl: SMD,
    musicnotesUrl: MN,
  };
  assertEq(modernPrimaryRetailerUrl(modern), SMD, 'the primary CTA opens the backend\'s retailerUrl');
  assertEq(
    modernBackupRetailerUrl(modern),
    MN,
    'the secondary CTA opens the backend\'s musicnotesUrl',
  );
  assertEq(
    modernSecondaryRetailerUrl(modern),
    MN,
    'the secondary CTA opens the backend’s musicnotesUrl when it is a different page',
  );
  assertEq(
    modernSecondaryRetailerUrl({ ...modern, musicnotesUrl: SMD }),
    undefined,
    'the DEDUPE (bundle C, owner 10-02): an identical backup URL yields NO second CTA — one tap to one page',
  );
  assertEq(
    modernSecondaryRetailerUrl({ ...modern, musicnotesUrl: ` ${SMD} ` }),
    undefined,
    'the dedupe survives padding (a padded duplicate is still a duplicate)',
  );
  assertEq(
    modernSecondaryRetailerUrl({ ...modern, retailerUrl: undefined }),
    MN,
    'with no primary at all the backup IS the one link (the honest single-action case)',
  );
  assertEq(
    modernSecondaryRetailerUrl({ ...modern, musicnotesUrl: undefined }),
    undefined,
    'no backup URL, no secondary action',
  );
  assertEq(
    modernPrimaryRetailerUrl({ ...modern, retailerUrl: undefined }),
    undefined,
    'a match with no primary link yields no primary CTA (never a fabricated URL)',
  );
  assertEq(
    modernBackupRetailerUrl({ ...modern, musicnotesUrl: '  ' }),
    undefined,
    'a blank secondary link is treated as absent',
  );
  assertEq(modernPrimaryRetailerUrl(null), undefined, 'no match, no CTA');
}

// ─── 2. The source scan (the guard) ─────────────────────────────

function scanTests(): void {
  console.log('\ndetecting a hardwired retailer in source');

  assert(
    RETAILER_KEY_DEREF_PATTERN.test('topMatch.purchase_url?.musicnotes'),
    'the shipped defect (`purchase_url?.musicnotes`) is detected',
  );
  assert(
    RETAILER_KEY_DEREF_PATTERN.test("phase.response.purchase_url['sheetmusicdirect']"),
    'a bracket dereference is detected',
  );
  assert(
    !RETAILER_KEY_DEREF_PATTERN.test('match.musicnotesUrl'),
    'the backend field `musicnotesUrl` is NOT a key dereference (not flagged)',
  );
  assert(
    RETAILER_HOSTNAME_PATTERN.test(
      "musicnotes: 'https://www.musicnotes.com/sheetmusic/mtd.asp?ppn=MN0217881'",
    ),
    'a hardcoded retailer URL is detected',
  );
  assert(
    !RETAILER_HOSTNAME_PATTERN.test("const url = 'https://notesnap.app';"),
    'our own share link is not a retailer URL',
  );

  const offenders = scanSourcesForHardwiredRetailerKey([
    {
      path: 'src/Defect.tsx',
      source: [
        'const url =',
        '  topMatch.purchase_url?.musicnotes ??',
        '  phase.response.purchase_url!.musicnotes;',
      ].join('\n'),
    },
  ]);
  assertEq(offenders.length, 2, 'both hardwired lines are flagged');
  assertEq(offenders[0].line, 2, 'the offender names its line');
  assertEq(offenders[0].retailer, 'musicnotes', 'the offender names the retailer');
  assertEq(offenders[0].kind, 'hardwired-key', 'the offender names the defect kind');
  assert(
    formatRetailerCtaOffenders(offenders)[0].includes('primaryPurchaseUrl'),
    'the report says how to fix it',
  );

  const fixed = scanSourcesForHardwiredRetailerKey([
    {
      path: 'src/Fixed.tsx',
      source:
        'const purchaseUrl = recognitionPurchaseUrl(\n  topMatch.purchase_url,\n  phase.response.purchase_url,\n);',
    },
  ]);
  assertEq(fixed.length, 0, 'resolving through the helper is clean');

  const hostname = scanSourcesForHardwiredRetailerKey([
    {
      path: 'src/MockDemo.tsx',
      source: "purchase_url: { musicnotes: 'https://www.musicnotes.com/x', sheetmusicplus: 'https://www.sheetmusicplus.com/y' },",
    },
  ]);
  assertEq(hostname.length, 1, 'a hardcoded retailer URL string is flagged once per line');
  assertEq(hostname[0].kind, 'hardcoded-hostname', 'the kind distinguishes it from a key deref');

  const documented = scanSourcesForHardwiredRetailerKey([
    {
      path: 'src/Doc.tsx',
      source: [
        '// the app used to read purchase_url.musicnotes — see the header',
        '/* legacy: purchase_url["sheetmusicdirect"] */',
        'const ok = primaryPurchaseUrl(urls);',
      ].join('\n'),
    },
  ]);
  assertEq(
    documented.length,
    0,
    'a comment that documents the old bug is not a violation (comments are masked)',
  );

  const allowed = scanSourcesForHardwiredRetailerKey(
    [{ path: PURCHASE_CTA_MODULE_PATH, source: 'RETAILER_HOSTNAME_PATTERN musicnotes.com' }],
    [PURCHASE_CTA_MODULE_PATH],
  );
  assertEq(allowed.length, 0, 'the contract module may name the retailers in its own patterns');
}

// ─── 3. The real component / caller wiring ──────────────────────

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

/** Every .ts/.tsx under src/ plus App.tsx — the app's own source. */
function appSources(): { path: string; source: string }[] {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const files: { path: string; source: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir) as string[]) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
        files.push({
          path: path.relative(root, full),
          source: fs.readFileSync(full, 'utf8') as string,
        });
      }
    }
  };
  walk(path.join(root, 'src'));
  files.push({ path: 'App.tsx', source: readAppFile('App.tsx') });
  return files;
}

const COMPONENT = 'src/components/ModernSongInterstitial.tsx';
const RESULT_VIEW = 'src/components/RecognitionResultView.tsx';

function wiringTests(): void {
  console.log('\n"Try Musicnotes" secondary CTA (the CTA-never-wired class)');

  const source = readAppFile(COMPONENT);
  // The recognized-song interstitial is the branch that renders the buy button.
  const branchStart = source.indexOf("surface === 'recognized'");
  const branchEnd = source.indexOf('// ── No modern match', branchStart);
  assert(
    branchStart >= 0 && branchEnd > branchStart,
    'the recognized-song branch is delimited (the buy surface is locatable)',
  );
  const recognized =
    branchStart >= 0 && branchEnd > branchStart ? source.slice(branchStart, branchEnd) : '';

  assert(
    recognized.includes('Try Musicnotes'),
    'the recognized-song interstitial renders a "Try Musicnotes" button',
  );
  assert(
    /setRetailerUrl\(\s*secondaryRetailer[)]/.test(recognized),
    'the secondary button opens the DEDUPED secondary (bundle C), not the raw field',
  );
  assert(
    /modernSecondaryRetailerUrl\(/.test(recognized),
    'the dedupe lives in the money-path module: a second button may never open the primary’s own page',
  );
  assert(
    /secondaryRetailer\s*\?/.test(recognized),
    'the secondary button renders only when the resolver returns a URL (no dead button)',
  );
  assertEq(
    (recognized.match(/match\.musicnotesUrl/g) ?? []).length,
    0,
    'the interstitial never reaches for the raw backup field itself (one source of truth for the dedupe)',
  );
  assert(
    !/isn't linked yet — check back soon|noLinkCard/.test(recognized),
    'the static "check back soon" box is gone: no licensed link → an honest line + the card’s real next steps',
  );
  assert(
    /setRetailerUrl\(\s*match\.retailerUrl[!)]/.test(recognized),
    'the primary (Sheet Music Direct) button is unchanged and still opens retailerUrl',
  );
  // One shell, one BACK rule: both CTAs set the SAME retailer-URL state, so the
  // single WebView Modal + handleRetailerBack cover the secondary path too.
  assertEq(
    (recognized.match(/setRetailerUrl\(/g) ?? []).length,
    2,
    'both retailer CTAs route through the ONE retailer-URL state (no second WebView)',
  );
  assertEq(
    (source.match(/<WebView/g) ?? []).length,
    1,
    'the component still has exactly ONE WebView (BACK keeps one rule)',
  );
  assert(
    /handleRetailerBack/.test(source) && /closeRetailer\(/.test(source),
    'the shared back handler (hardware BACK + "← Back to NoteSnap") is intact',
  );

  console.log('\nthe classical CTA resolves through the contract');

  const resultView = readAppFile(RESULT_VIEW);
  assert(
    /recognitionPurchaseUrl\(/.test(resultView),
    'the recognition result resolves its CTA through recognitionPurchaseUrl()',
  );
  assertEq(
    (resultView.match(/purchase_url\s*\??\.\s*(musicnotes|sheetmusicdirect|sheetmusicplus)/g) ?? []).length,
    0,
    'it no longer names a retailer key itself',
  );
  assert(
    /Get Official Sheet Music/.test(resultView),
    'the purchase CTA is still on the result surface',
  );
}

// ─── 4. The whole app ───────────────────────────────────────────

function liveScanTests(): void {
  console.log('\nlive scan of the app source');

  const files = appSources();
  assert(files.length >= 25, `scanned ${files.length} app source files (≥ 25)`);
  assert(
    files.some((f) => f.path === PURCHASE_CTA_MODULE_PATH),
    `${PURCHASE_CTA_MODULE_PATH} is part of the scan`,
  );

  const offenders = scanSourcesForHardwiredRetailerKey(files);
  if (offenders.length > 0) {
    for (const line of formatRetailerCtaOffenders(offenders)) console.error(`  ✗ ${line}`);
  }
  assertEq(
    offenders.length,
    0,
    'no app source file names a retailer directly: every CTA resolves through primaryPurchaseUrl()',
  );
}

// ─── 5. Bundle C: every purchase tap opens the in-app shell ─────
//
// The D5 defect (audit 10-01): the recognition result's purchase tap called
// `Linking.openURL(url)` — the ONLY purchase route in the app that handed the user
// to the system browser and left NoteSnap entirely. This section pins the
// semantics of the three predicates that make that impossible; section 6 runs them
// on the REAL tree.

/** A purchase surface in the shape the fix produces: one tap → the shell's state. */
const IN_SHELL_SURFACE = `
function Card() {
  const [purchaseWebUrl, setPurchaseWebUrl] = React.useState<string | null>(null);
  return (
    <View>
      <TouchableOpacity onPress={() => { if (url) setPurchaseWebUrl(url); }}>
        <Text>🛒 Get the Official Sheet Music</Text>
      </TouchableOpacity>
      {purchaseWebUrl && (
        <PurchaseWebView url={purchaseWebUrl} title={t} onClose={() => setPurchaseWebUrl(null)} />
      )}
    </View>
  );
}
`;

/** The same surface with the deduped secondary retailer line. */
const DEDUPED_SECONDARY_SURFACE = `
function Card() {
  const [purchaseWebUrl, setPurchaseWebUrl] = React.useState<string | null>(null);
  const secondary = modernSecondaryRetailerUrl(match);
  return (
    <View>
      <TouchableOpacity onPress={() => setPurchaseWebUrl(primary)}>
        <Text>🛒 Get the Official Sheet Music</Text>
      </TouchableOpacity>
      {secondary ? (
        <TouchableOpacity onPress={() => setPurchaseWebUrl(secondary)}>
          <Text>🎼 Try Musicnotes</Text>
        </TouchableOpacity>
      ) : null}
      {purchaseWebUrl && (
        <PurchaseWebView url={purchaseWebUrl} title={t} onClose={() => setPurchaseWebUrl(null)} />
      )}
    </View>
  );
}
`;

function shellContractTests(): void {
  console.log('\nexternal opens: openSettings is allowed, a real openURL is not');

  assertEq(
    findExternalUrlOpens([
      { path: 'src/x.tsx', source: 'Linking.openURL(url).catch(() => {});' },
    ]).length,
    1,
    'the shipped D5 handler is flagged',
  );
  assertEq(
    findExternalUrlOpens([
      { path: 'src/hooks/useAudioRecorder.ts', source: 'Linking.openSettings().catch(() => {});' },
    ]).length,
    0,
    'the microphone-permission openSettings() call is allowed by name (useAudioRecorder.ts:312)',
  );
  assertEq(
    findExternalUrlOpens([
      { path: 'src/screens/ScanScoreScreen.tsx', source: 'onPress={() => Linking.openSettings()}' },
    ]).length,
    0,
    'the scan screen’s openSettings() tap is allowed too (ScanScoreScreen.tsx:106)',
  );
  assertEq(
    findExternalUrlOpens([
      { path: 'src/x.tsx', source: 'Linking.openURL(openSettings()).catch(() => {});' },
    ]).length,
    0,
    'an openURL whose argument is openSettings() opens the settings app, not a retailer',
  );
  assertEq(
    findExternalUrlOpens([
      {
        path: 'src/Doc.tsx',
        source: '// the old handler called `Linking.openURL(url)` — see the header',
      },
    ]).length,
    0,
    'a comment that documents the old defect is not an offender (comments are masked)',
  );
  assert(
    formatExternalUrlOpens(
      findExternalUrlOpens([{ path: 'src/x.tsx', source: 'Linking.openURL(url);' }]),
    )[0].includes('PurchaseWebView'),
    'the failure report names the shell to mount instead',
  );

  console.log('\nthe tap must open the shell (purchaseActionIsInShell)');

  assertEq(purchaseShellMounts(IN_SHELL_SURFACE), 1, 'one shell per surface');
  assertEq(
    purchaseShellUrlState(IN_SHELL_SURFACE)?.setter,
    'setPurchaseWebUrl',
    'the shell is fed the surface’s own state variable',
  );
  assertEq(purchaseActionSites(IN_SHELL_SURFACE).length, 1, 'one purchase action');
  assertEq(
    purchaseActionIsInShell(IN_SHELL_SURFACE),
    true,
    'a purchase tap that sets the shell’s URL state is in-shell',
  );
  assertEq(
    purchaseActionIsInShell(
      IN_SHELL_SURFACE.replace('setPurchaseWebUrl(url)', 'Linking.openURL(url)'),
    ),
    false,
    'the D5 defect (the tap opens the system browser) FAILS',
  );
  assertEq(
    purchaseActionIsInShell(
      IN_SHELL_SURFACE.replace(
        /      \{purchaseWebUrl && \([\s\S]*?\n      \)\}/,
        '',
      ),
    ),
    false,
    'a surface that never mounts the shell FAILS (the tap has nowhere to land)',
  );

  console.log('\none purchase action per surface (uniquePurchaseActionPerSurface)');

  assertEq(
    uniquePurchaseActionPerSurface(IN_SHELL_SURFACE),
    true,
    'a single-action surface is unique',
  );
  assertEq(
    uniquePurchaseActionPerSurface(DEDUPED_SECONDARY_SURFACE),
    true,
    'a deduped + gated secondary line is still ONE purchase action per page',
  );
  assertEq(
    uniquePurchaseActionPerSurface(
      DEDUPED_SECONDARY_SURFACE.replace(
        'modernSecondaryRetailerUrl(match)',
        'match.musicnotesUrl',
      ),
    ),
    false,
    'a secondary wired to the RAW backup field (undeduped) FAILS — it can duplicate the primary',
  );
  assertEq(
    uniquePurchaseActionPerSurface(
      DEDUPED_SECONDARY_SURFACE.replace('{secondary ? (', '{true ? ('),
    ),
    false,
    'an UNGATED secondary FAILS (a dead button the moment the resolver returns undefined)',
  );
  assertEq(
    uniquePurchaseActionPerSurface(
      DEDUPED_SECONDARY_SURFACE.replace(
        '    </View>',
        '      <TouchableOpacity onPress={() => setPurchaseWebUrl(other)}><Text>Buy</Text></TouchableOpacity>\n    </View>',
      ),
    ),
    false,
    'a THIRD purchase action FAILS (the owner’s duplicate-CTA class)',
  );
}

// ─── 6. The real tree: no purchase path leaves the app ──────────

const PURCHASE_SURFACES: [string, string][] = [
  ['src/components/RecognitionResultView.tsx', 'the recognition result card (C1 / D5)'],
  ['src/screens/HistoryScreen.tsx', 'History’s saved modern row (C3 / D7)'],
  ['src/screens/PieceDetailScreen.tsx', 'the piece page (the v31 reference implementation)'],
  ['src/components/ModernSongInterstitial.tsx', 'the modern-song interstitial'],
];

const SHELL_PATH = 'src/components/PurchaseWebView.tsx';

function liveShellScanTests(): void {
  console.log('\nlive scan: no purchase path in the app leaves NoteSnap');

  const files = appSources();
  const offenders = findExternalUrlOpens(files);
  for (const line of formatExternalUrlOpens(offenders)) console.error(`  ✗ ${line}`);
  assertEq(
    offenders.length,
    0,
    'every Linking.openURL left in the app is the allowed openSettings() form (the D5 handler is gone)',
  );
  assertEq(
    noPurchaseActionLeavesTheApp(files),
    true,
    'noPurchaseActionLeavesTheApp() passes over the real tree',
  );

  console.log('\nlive scan: each purchase surface opens the one shared shell');

  for (const [path, label] of PURCHASE_SURFACES) {
    const source = readAppFile(path);
    assertEq(purchaseActionIsInShell(source), true, `${label}: its purchase tap opens the in-app shell`);
    assertEq(
      uniquePurchaseActionPerSurface(source),
      true,
      `${label}: exactly one purchase action (a secondary only on a different URL)`,
    );
  }

  console.log('\nlive scan: the shell mounts are Modal-rooted with the WebView flags');

  const shell = readAppFile(SHELL_PATH);
  const shellFiles = [
    { path: SHELL_PATH, source: shell },
    ...PURCHASE_SURFACES.map(([path]) => ({ path, source: readAppFile(path) })),
  ];
  const browserViolations = findBrowserContractViolations(shellFiles);
  for (const v of browserViolations) console.error(`  ✗ ${v.message}`);
  assertEq(
    browserViolations.length,
    0,
    'every new shell mount renders the retailer in its OWN full-screen Modal (never a bare View)',
  );
  const flagViolations = findWebViewFlagViolations(shellFiles);
  for (const v of flagViolations) console.error(`  ✗ ${v.message}`);
  assertEq(
    flagViolations.length,
    0,
    'the shell WebView keeps javaScriptEnabled + domStorageEnabled (Sheet Music Direct is a JS app)',
  );

  console.log('\nmutation probes: put each bundle-C defect back');

  const resultView = readAppFile(PURCHASE_SURFACES[0][0]);
  // (C1/D5) the purchase tap goes back to the system browser.
  const linkingBack = resultView.replace(
    'setPurchaseWebUrl(purchaseUrl)',
    'Linking.openURL(purchaseUrl)',
  );
  assert(linkingBack !== resultView, 'the D5 mutation changed RecognitionResultView');
  assertEq(
    purchaseActionIsInShell(linkingBack),
    false,
    'MUTATION: restoring Linking.openURL in the result card FAILS purchaseActionIsInShell',
  );
  assertEq(
    noPurchaseActionLeavesTheApp(
      files.map((f) =>
        f.path === PURCHASE_SURFACES[0][0] ? { path: f.path, source: linkingBack } : f,
      ),
    ),
    false,
    'MUTATION: restoring Linking.openURL in the result card FAILS noPurchaseActionLeavesTheApp over the tree',
  );
  assertEq(
    purchaseActionIsInShell(resultView),
    true,
    'the untouched result card still passes (the probe changed the source it targeted)',
  );

  // (C2/v31) a SECOND purchase action on the piece page.
  const pieceDetail = readAppFile(PURCHASE_SURFACES[2][0]);
  const secondCta = pieceDetail.replace(
    '      <PurchaseWebView',
    '      <TouchableOpacity onPress={() => openInAppPurchase(sheetCardUrl)}>\n' +
      '        <Text>🛒 Buy again</Text>\n' +
      '      </TouchableOpacity>\n' +
      '      <PurchaseWebView',
  );
  assert(secondCta !== pieceDetail, 'the second-CTA mutation changed PieceDetailScreen');
  assertEq(
    uniquePurchaseActionPerSurface(secondCta),
    false,
    'MUTATION: a second purchase action on the piece page FAILS uniquePurchaseActionPerSurface',
  );
  assertEq(
    uniquePurchaseActionPerSurface(pieceDetail),
    true,
    'the untouched piece page still passes (the probe changed the source it targeted)',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== purchase CTA: the primary retailer carries the money path ===');
  resolutionTests();
  scanTests();
  wiringTests();
  liveScanTests();
  shellContractTests();
  liveShellScanTests();
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
