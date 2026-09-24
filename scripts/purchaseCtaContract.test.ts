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
  formatRetailerCtaOffenders,
  isApprovedPurchaseUrlKey,
  modernBackupRetailerUrl,
  modernPrimaryRetailerUrl,
  primaryPurchaseUrl,
  recognitionPurchaseUrl,
  scanSourcesForHardwiredRetailerKey,
} from '../src/services/purchaseCta';
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
    /setRetailerUrl\(\s*match\.musicnotesUrl[!)]/.test(recognized),
    'the secondary button is wired to the backend-returned match.musicnotesUrl',
  );
  assert(
    /match\.musicnotesUrl\s*\?/.test(recognized),
    'the secondary button is rendered only when the backend supplied a URL (no dead button)',
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

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== purchase CTA: the primary retailer carries the money path ===');
  resolutionTests();
  scanTests();
  wiringTests();
  liveScanTests();
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
