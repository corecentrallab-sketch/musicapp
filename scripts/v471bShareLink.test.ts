/**
 * v471bShareLink.test.ts — ITEM 0: EVERY SHARE CARD MUST POINT AT THE HOST WE
 * ACTUALLY SERVE (v47.1 Part B, defect D3; re-pointed to the branded domain in
 * v47.3).
 *
 * Measured live on 2026-10-30 — the state v47.1 Part B was written against:
 *   https://notesnap.app             → curl (35) OpenSSL sslv3 alert handshake
 *                                      failure (the domain was parked; no TLS)
 *   http://notesnap.app              → 200 (the registrar's parking page)
 *   https://site-notesnap.vercel.app → 200 (the product site we actually served)
 *
 * Measured live on 2026-11-03 — why the constant moved to the branded domain:
 *   https://notesnap.app             → 200, valid Let's Encrypt certificate
 *                                      (issued 2026-11-03, expires 2027-02-01)
 *   https://www.notesnap.app         → 308 → the apex
 *   https://notesnap.app/api/pieces  → 200
 *
 * The app stamped `https://notesnap.app` on every share card back when that host
 * did not open, so every card anyone shared was a dead link — and "share sends
 * >5%" is a Tier-1 KPI, so the dead destination poisoned the metric too. v47.1
 * Part B parked the constant on the vercel.app host; the domain is live now, so
 * v47.3 points every card at the branded address.
 *
 * WHAT THIS SUITE PROVES
 *   • the ONE constant (`SHARE_BASE_URL`) is the branded https host measured
 *     live on 2026-11-03 and is NOT the vercel.app host it was parked on — and
 *     the branding host is DERIVED from it, not a second literal;
 *   • the share builder really EMITS that constant (hosting, not just wiring —
 *     the v46 lesson): the text payload carries it, and the two surfaces that
 *     print the host read the derived constant;
 *   • a live source scan of `src/` finds EXACTLY ONE `https://notesnap.app`
 *     literal — the constant itself — and no second copy anywhere (comments are
 *     masked, so the explanatory note in shareCardShare.ts may name the host);
 *   • re-pointing stays a ONE-LINE change: the guard fails the moment a second
 *     literal appears, and fails if the constant is pointed back at a host we
 *     do not serve.
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

/** How many times `needle` occurs in `hay` (a second literal must be countable). */
function countOccurrences(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

// The hosts, assembled so this test file itself holds no literal URL.
const BRANDED_HOST = 'notesnap' + '.app';
const BRANDED_URL = 'https://' + BRANDED_HOST;
/** Where the constant was parked while the branded domain had no certificate. */
const PARKED_HOST = 'site-notesnap' + '.vercel.app';

// ─── 1. the constant ─────────────────────────────────────────────
function constantTests(): void {
  console.log('\nSHARE_BASE_URL is the branded host we actually serve');
  assert(/^https:\/\//.test(SHARE_BASE_URL), 'the share base URL is https');
  assertEq(
    SHARE_BASE_URL,
    BRANDED_URL,
    'the constant is the branded domain measured live (200 + valid cert) on 2026-11-03',
  );
  assert(
    SHARE_BASE_URL.indexOf(PARKED_HOST) < 0,
    'the constant is NOT the vercel.app host it was parked on while the domain had no TLS',
  );
  assertEq(SHARE_CARD_LINK, SHARE_BASE_URL, 'the text-fallback link IS the one constant');
  assertEq(
    SHARE_BASE_HOST,
    SHARE_BASE_URL.replace(/^https?:\/\//, ''),
    'the branding host is DERIVED from the constant, never a second literal',
  );
  assertEq(
    SHARE_BASE_HOST,
    BRANDED_HOST,
    'the branding text prints the branded host, so card and link describe one destination',
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
      'the text payload carries the working branded URL',
    );
    assert(
      text.message.indexOf(PARKED_HOST) < 0,
      'the text payload does NOT carry the old vercel.app host',
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
    shareCard.indexOf('>' + BRANDED_HOST + '<') < 0,
    'the ShareCard modal prints the DERIVED host, never a bare literal',
  );
}

// ─── 3. live scan: exactly one literal in src/ ──────────────────
function scanTests(): void {
  console.log('\nEXACTLY ONE `https://notesnap.app` literal exists in src/');
  const files = srcFiles();
  const paths = Object.keys(files);
  assert(paths.length >= 200, `the scan really walked src/ (${paths.length} files, floor 200)`);
  const offenders: string[] = [];
  const bareHost: string[] = [];
  let literalTotal = 0;
  for (const p of paths) {
    // Comments are masked: the explanatory note may NAME the host, but no
    // executable line may emit a second copy of it.
    const code = maskComments(files[p]);
    const n = countOccurrences(code, BRANDED_URL);
    if (n > 0) {
      offenders.push(`${p} (${n})`);
      literalTotal += n;
    }
    if (code.indexOf(BRANDED_HOST) >= 0) bareHost.push(p);
  }
  assertEq(
    offenders.join(', '),
    'src/services/shareCardShare.ts (1)',
    'the ONLY file holding the public URL is the module that owns the constant',
  );
  assertEq(literalTotal, 1, 'there is exactly ONE literal copy of the public URL in src/');
  assertEq(
    bareHost.join(', '),
    'src/services/shareCardShare.ts',
    'no other src file names the branded host outside a comment (every surface derives it)',
  );
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
  const broken = shareCard.replace('{SHARE_BASE_HOST}', '>' + BRANDED_HOST + '<');
  assert(broken !== shareCard, 'probe: a hardcoded branding literal was reconstructed');
  const brokenCode = maskComments(broken);
  assert(
    brokenCode.indexOf(BRANDED_HOST) >= 0,
    'probe: with the literal back, the scan reports the file (it is not vacuous)',
  );
  // …and the real file is clean.
  assert(
    maskComments(shareCard).indexOf(BRANDED_HOST) < 0,
    'the real ShareCard.tsx is clean again',
  );
  // A second literal URL anywhere is caught by the same rule.
  const fixture = "const LINK = '" + BRANDED_URL + "';";
  assertEq(
    countOccurrences(maskComments(fixture), BRANDED_URL),
    1,
    'probe: a fresh second literal WOULD be counted by the scan (so 2 would fail it)',
  );
  assert(
    maskComments('// ' + BRANDED_URL + ' is the public address').indexOf(BRANDED_URL) < 0,
    'a COMMENT naming the host is allowed (masked) — the guard is about emission',
  );
}

// ─── run ─────────────────────────────────────────────────────────
function main(): void {
  console.log('v47.1 Part B item 0 / v47.3 — every share card emits the branded URL that opens');
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
