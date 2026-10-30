/**
 * v471bShareLink.test.ts — ITEM 0: NO SHARE CARD MAY POINT AT A HOST WE DO NOT
 * SERVE (v47.1 Part B, defect D3, launch blocking).
 *
 * Measured live on 2026-10-30:
 *   https://notesnap.app             → curl (35) OpenSSL sslv3 alert handshake
 *                                      failure (the domain is parked; no TLS)
 *   http://notesnap.app              → 200 (the registrar's parking page)
 *   https://site-notesnap.vercel.app → 200 (the product site we actually serve)
 *
 * The app stamped `https://notesnap.app` on every share card, so every card
 * anyone shared was a link that does not open — and "share sends >5%" is a
 * Tier-1 KPI, so the dead destination poisoned the metric too.
 *
 * WHAT THIS SUITE PROVES
 *   • the ONE constant (`SHARE_BASE_URL`) is a working https URL and is NOT the
 *     parked host — and the branding host is DERIVED from it, not a second
 *     literal;
 *   • the share builder really EMITS that constant (hosting, not just wiring —
 *     the v46 lesson): the text payload carries it, and the two surfaces that
 *     print the host read the derived constant;
 *   • a live source scan of `src/` finds NO `https://notesnap.app` literal in
 *     code anywhere (comments are masked, so the explanatory note in
 *     shareCardShare.ts is allowed to name the dead host);
 *   • re-pointing at notesnap.app later stays a ONE-LINE change: the guard fails
 *     the moment a second literal appears.
 *
 * Plain Node, no react-native, no network. Run with: `npm run test:tier1`.
 */
import {
  SHARE_BASE_HOST,
  SHARE_BASE_URL,
  SHARE_CARD_LINK,
  buildShareCardPayload,
} from '../src/services/shareCardShare';
import { maskComments } from '../src/services/modalBackContract';

let passes = 0;
let failures = 0;

declare const require: (id: string) => any;
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

/** The repo root — the dir that holds app.json and src/. */
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

/** Every .ts/.tsx file under src/, as rel-path → source. */
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

/** The parked host, assembled so this test file itself holds no literal URL. */
const PARKED_HOST = 'notesnap' + '.app';

// ─── 1. the constant ─────────────────────────────────────────────
function constantTests(): void {
  console.log('\nSHARE_BASE_URL is a host we actually serve');
  assert(/^https:\/\//.test(SHARE_BASE_URL), 'the share base URL is https');
  assert(
    SHARE_BASE_URL.indexOf(PARKED_HOST) < 0,
    'the share base URL is NOT the parked host (its TLS handshake fails)',
  );
  assertEq(SHARE_CARD_LINK, SHARE_BASE_URL, 'the text-fallback link IS the one constant');
  assertEq(
    SHARE_BASE_HOST,
    SHARE_BASE_URL.replace(/^https?:\/\//, ''),
    'the branding host is DERIVED from the constant, never a second literal',
  );
  assert(
    SHARE_BASE_HOST.indexOf(PARKED_HOST) < 0,
    'the branding text does not claim a branded domain we are not serving',
  );
  assertEq(
    SHARE_BASE_URL,
    'https://site-notesnap.vercel.app',
    'the constant is the live product site measured 200 on 2026-10-30',
  );
}

// ─── 2. the builder emits it (hosting, not wiring) ───────────────
function emitTests(): void {
  console.log('\nthe share builders EMIT the constant');
  const text = buildShareCardPayload({
    shareText: 'I just played Bach',
    imageUri: null,
    imageSharingAvailable: false,
  });
  assertEq(text.mode, 'text', 'no image → the text fallback');
  if (text.mode === 'text') {
    assert(
      text.message.indexOf(SHARE_BASE_URL) >= 0,
      'the text payload carries the working URL',
    );
    assert(
      text.message.indexOf(PARKED_HOST) < 0,
      'the text payload does NOT carry the parked host',
    );
  }
  const image = buildShareCardPayload({
    shareText: 'I just played Bach',
    imageUri: 'file:///card.png',
    imageSharingAvailable: true,
  });
  assertEq(image.mode, 'image', 'an image URI + platform support → the PNG travels');

  // The two surfaces that print a host must read the DERIVED constant.
  const pieceScreen = maskComments(readSrc('src/screens/PieceDetailScreen.tsx'));
  assert(
    pieceScreen.indexOf('${SHARE_BASE_URL}') >= 0,
    'the piece page share sentence interpolates SHARE_BASE_URL',
  );
  assert(
    pieceScreen.indexOf('{SHARE_BASE_HOST}') >= 0,
    'the piece page share-card preview prints SHARE_BASE_HOST',
  );
  const shareCard = maskComments(readSrc('src/components/ShareCard.tsx'));
  assert(
    shareCard.indexOf('{SHARE_BASE_HOST}') >= 0,
    'the ShareCard modal prints SHARE_BASE_HOST',
  );
  assert(
    shareCard.indexOf('>' + PARKED_HOST + '<') < 0,
    'the ShareCard modal no longer prints the parked host as branding',
  );
}

// ─── 3. live scan: no literal survives in src/ ──────────────────
function scanTests(): void {
  console.log('\nno `https://notesnap.app` literal survives in src/');
  const files = srcFiles();
  const paths = Object.keys(files);
  assert(paths.length >= 200, `the scan really walked src/ (${paths.length} files, floor 200)`);
  const offenders: string[] = [];
  const bareHost: string[] = [];
  for (const p of paths) {
    // Comments are masked: the explanatory note may NAME the dead host, but no
    // executable line may emit it.
    const code = maskComments(files[p]);
    if (code.indexOf('https://' + PARKED_HOST) >= 0) offenders.push(p);
    if (code.indexOf(PARKED_HOST) >= 0) bareHost.push(p);
  }
  assertEq(offenders.join(', '), '', 'no src file emits an https URL on the parked host');
  assertEq(bareHost.join(', '), '', 'no src file names the parked host outside a comment');
  // Floor: the guard must have seen the module that owns the constant.
  assert(
    files['src/services/shareCardShare.ts'] !== undefined,
    'the scan saw the module that owns the constant',
  );
}

// ─── 4. mutation probes (in-memory) ──────────────────────────────
function mutationProbes(): void {
  console.log('\nmutation probes — the guard bites on the defect');
  const shareCard = readSrc('src/components/ShareCard.tsx');
  const broken = shareCard.replace('{SHARE_BASE_HOST}', '>' + PARKED_HOST + '<');
  assert(broken !== shareCard, 'probe: the pre-fix branding text was reconstructed');
  const brokenCode = maskComments(broken);
  assert(
    brokenCode.indexOf(PARKED_HOST) >= 0,
    'probe: with the literal back, the scan reports the file (it is not vacuous)',
  );
  // …and the real file is clean.
  assert(
    maskComments(shareCard).indexOf(PARKED_HOST) < 0,
    'the real ShareCard.tsx is clean again',
  );
  // A second literal URL anywhere is caught by the same rule.
  const fixture = "const LINK = 'https://" + PARKED_HOST + "';";
  assert(
    maskComments(fixture).indexOf('https://' + PARKED_HOST) >= 0,
    'probe: a fresh second literal would fail the scan',
  );
  assert(
    maskComments('// https://' + PARKED_HOST + ' is parked').indexOf('https://' + PARKED_HOST) < 0,
    'a COMMENT naming the dead host is allowed (masked) — the guard is about emission',
  );
}

// ─── run ─────────────────────────────────────────────────────────
function main(): void {
  console.log('v47.1 Part B item 0 — every share card emits a URL that opens');
  constantTests();
  emitTests();
  scanTests();
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
