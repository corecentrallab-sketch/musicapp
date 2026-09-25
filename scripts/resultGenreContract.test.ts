/**
 * resultGenreContract.test.ts — the guard for the owner's "ZZ Top is not
 * classical" bug class.
 *
 * Owner repro (09-23, re-confirmed 09-24): the recognition result card labelled
 * a modern/AudD match as "classical". The label was never observed data — it was
 * three copies of the same fallback (`match.catalog ?? 'Classical'`,
 * `HISTORY_DEFAULT_GENRE = 'Classical'`, `d.genre ? … : "Classical"`), so ANY
 * match without a catalog number came out classical, and the modern flow's saved
 * recognition (song + artist, no genre) came out classical in History too.
 *
 * Two halves, like the rest of the repo's contract suites:
 *   1. LABEL tests — the pure rules in src/services/resultGenre.ts: a
 *      non-public-domain match is "Modern song", a public-domain match carries
 *      the catalog's own genre (else "Public domain"), a record with no genre is
 *      "Uncategorised". Never "Classical" for a modern result, in any casing.
 *   2. LIVE SCAN — every .ts/.tsx under src/ plus App.tsx is read off disk and
 *      scanned for a genre value or genre DEFAULT hardcoded as "Classical"
 *      (comments blanked, so documentation of the old bug cannot fail the gate;
 *      pre-fix fixtures prove the scan catches the real forms). Wiring tests then
 *      assert the surfaces actually resolve through the helper. Floors on the
 *      file count and on the specific files being present mean a broken or empty
 *      walk cannot pass vacuously.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  FALLBACK_MODERN_GENRE,
  PUBLIC_DOMAIN_GENRE,
  RESULT_GENRE_MODULE_PATH,
  UNCATEGORISED_GENRE,
  formatGenreLabelOffenders,
  isModernResult,
  resultGenreLabel,
  savedGenreLabel,
  scanSourcesForClassicalGenreDefaults,
} from '../src/services/resultGenre';

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
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}

/** A "Classical" claim in any casing — the label this bug class must never emit. */
function claimsClassical(label: string): boolean {
  return label.trim().toLowerCase() === 'classical';
}

// ─── 1. The label rules ─────────────────────────────────────────

function labelTests(): void {
  console.log('\nthe category a result may claim');

  // THE OWNER'S CASE: a licensed-fingerprint match (a modern, copyrighted song)
  // carries no catalog number and is not public domain.
  const zzTop = {
    piece_id: 'isrc:USWB10102597',
    title: 'Sharp Dressed Man',
    composer: 'ZZ Top',
    catalog: null,
    is_public_domain: false,
  };
  assertEq(
    resultGenreLabel(zzTop),
    FALLBACK_MODERN_GENRE,
    'a modern (non-public-domain) match is categorised "Modern song"',
  );
  assert(
    !claimsClassical(resultGenreLabel(zzTop)),
    'a modern match is NEVER labelled classical',
  );
  assertEq(FALLBACK_MODERN_GENRE, 'Modern song', 'the neutral modern category is stated plainly');

  // The same match with no explicit flag at all is still not public domain.
  assert(
    isModernResult({ catalog: null }),
    'a match without is_public_domain:true is treated as modern (never classical)',
  );
  assert(
    !claimsClassical(resultGenreLabel({ genre: null })),
    'an ambiguous match is not labelled classical either',
  );
  assertEq(isModernResult(undefined), false, 'no match at all is not "modern"');
  assertEq(isModernResult(null), false, 'a null match is not "modern"');

  // Public domain: the catalog's own genre when the payload has one.
  assertEq(
    resultGenreLabel({ is_public_domain: true, genre: 'Baroque' }),
    'Baroque',
    "a public-domain match shows the catalog's own genre",
  );
  assertEq(
    resultGenreLabel({ is_public_domain: true, genre: '  ' }),
    PUBLIC_DOMAIN_GENRE,
    'a blank catalog genre falls back to "Public domain", not an empty tag',
  );
  assertEq(
    resultGenreLabel({ is_public_domain: true, catalog: 'WoO 59' }),
    PUBLIC_DOMAIN_GENRE,
    'the catalog NUMBER is never used as the genre (the old card printed it there)',
  );

  // Saved records (History rows).
  assertEq(
    savedGenreLabel('Modern song'),
    FALLBACK_MODERN_GENRE,
    'a saved modern recognition keeps its category',
  );
  assertEq(
    savedGenreLabel(undefined),
    UNCATEGORISED_GENRE,
    'a record with no genre says so honestly',
  );
  assertEq(savedGenreLabel('   '), UNCATEGORISED_GENRE, 'whitespace is treated as missing');
  assert(
    !claimsClassical(savedGenreLabel(undefined)),
    'an unknown saved genre is never filled in as classical',
  );
}

// ─── 2. The scan: pre-fix fixtures ──────────────────────────────

/** Verbatim lines from master @ 96a9c6c — the pre-fix source. */
const PRE_FIX_LINES: string[] = [
  "    genre: match.catalog ?? 'Classical',",
  "    genre: 'Classical',",
  '      genre: d.genre ? String(d.genre) : "Classical",',
  "export const HISTORY_DEFAULT_GENRE = 'Classical';",
  "    genre: piece.genre ?? 'classical',",
];

/** Lines that merely MENTION classical music and must never be flagged. */
const FALSE_POSITIVE_LINES: string[] = [
  "// the old default was 'Classical' — see resultGenre.ts",
  "/* genre: match.catalog ?? 'Classical' */",
  "export type Genre = 'classical' | 'jazz-ragtime' | 'folk-traditional';",
  "        genres: genres.length === 0 ? ['classical'] : genres,",
  "                { id: 'classical' as Genre, emoji: '🎻', label: 'Classical' },",
  "  const label = 'Or browse the free classical library';",
  "  // recognition result (classical path)",
];

function scanTests(): void {
  console.log('\nthe scanner: a hardcoded/defaulted classical genre is caught');

  const found = scanSourcesForClassicalGenreDefaults(
    PRE_FIX_LINES.map((source, i) => ({ path: `fixture/pre-${i}.ts`, source })),
  );
  assertEq(
    found.length,
    PRE_FIX_LINES.length,
    'every pre-fix "Classical" genre default is flagged (5/5 verbatim lines)',
  );
  assert(
    found.some((o) => o.kind === 'classical-fallback'),
    'a `?? ' + "'Classical'" + '` fallback is reported as a fallback',
  );
  assert(
    found.some((o) => o.kind === 'classical-genre-value'),
    'a hardcoded genre value is reported as a value',
  );
  assert(
    formatGenreLabelOffenders(found).every((line) => line.includes('resultGenreLabel()')),
    'every report names the fix (resolve through resultGenreLabel())',
  );

  const notFlagged = scanSourcesForClassicalGenreDefaults(
    FALSE_POSITIVE_LINES.map((source, i) => ({ path: `fixture/ok-${i}.ts`, source })),
  );
  assertEq(
    notFlagged.length,
    0,
    'the onboarding genre picker, the Genre type, a comment and free-library copy are NOT flagged',
  );

  // The module that owns the strings may name them (and nothing else may).
  const allowed = scanSourcesForClassicalGenreDefaults(
    [{ path: RESULT_GENRE_MODULE_PATH, source: "export const X = 'Classical';" }],
  );
  assertEq(allowed.length, 0, 'the contract module may name the strings in its own patterns');

  const missingMatch = scanSourcesForClassicalGenreDefaults([
    { path: 'src/screens/Whatever.tsx', source: "  genre: match.catalog ?? 'Classical'," },
  ]);
  assertEq(missingMatch[0]?.path, 'src/screens/Whatever.tsx', 'the offender path is reported');
  assertEq(missingMatch[0]?.line, 1, 'the offender line number is reported');
}

// ─── 3. The real app source ─────────────────────────────────────

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

const RESULT_VIEW = 'src/components/RecognitionResultView.tsx';
const INTERSTITIAL = 'src/components/ModernSongInterstitial.tsx';
const MODERN_SCREEN = 'src/screens/ModernSearchScreen.tsx';
const HISTORY_PIECE = 'src/services/historyPiece.ts';
const HOME_SCREEN = 'src/screens/HomeScreen.tsx';

function liveScanTests(): void {
  console.log('\nlive scan of the app source');

  const files = appSources();
  assert(files.length >= 25, `scanned ${files.length} app source files (≥ 25)`);
  assert(
    files.some((f) => f.path === RESULT_GENRE_MODULE_PATH),
    `${RESULT_GENRE_MODULE_PATH} is part of the scan`,
  );
  assert(
    files.some((f) => f.path === RESULT_VIEW),
    `${RESULT_VIEW} is part of the scan`,
  );

  const offenders = scanSourcesForClassicalGenreDefaults(files);
  if (offenders.length > 0) {
    for (const line of formatGenreLabelOffenders(offenders)) console.error(`  ✗ ${line}`);
  }
  assertEq(
    offenders.length,
    0,
    'no app source file hardcodes or defaults a result genre to "Classical"',
  );
}

function wiringTests(): void {
  console.log('\nthe result surfaces resolve their category through the helper');

  const view = readAppFile(RESULT_VIEW);
  assert(view.length > 2000, 'the result card source was read');
  assert(
    view.includes('resultGenreLabel(topMatch)'),
    'the result card renders the resolved category (resultGenreLabel(topMatch))',
  );
  assert(
    view.includes('genre: resultGenreLabel(match)'),
    'the card→piece-page mapping carries the resolved category',
  );
  assert(
    !/genre:\s*match\.catalog/.test(view),
    'the catalog NUMBER is no longer used as the genre',
  );

  const interstitial = readAppFile(INTERSTITIAL);
  assert(
    interstitial.includes('{modernGenreLabel(match)}'),
    'the modern-song interstitial states the neutral category "Modern song"',
  );
  assert(
    !interstitial.includes("'Classical'"),
    'the interstitial never names "Classical" as a modern result category',
  );

  const modernScreen = readAppFile(MODERN_SCREEN);
  assert(
    modernScreen.includes('genre: modernGenreLabel(m)'),
    'a modern match is saved to History WITH its category (no classical default can apply)',
  );

  const historyPieceSrc = readAppFile(HISTORY_PIECE);
  assert(
    !/HISTORY_DEFAULT_GENRE\s*=\s*'Classical'/.test(historyPieceSrc),
    'the History fallback genre is no longer the literal "Classical"',
  );
  assert(
    historyPieceSrc.includes('UNCATEGORISED_GENRE'),
    'the History fallback comes from the genre module',
  );

  const home = readAppFile(HOME_SCREEN);
  assert(
    home.includes('genre: resultGenreLabel(topMatch)'),
    'Home saves a recognition with the resolved category',
  );
  assert(
    !home.includes('genre: topMatch.catalog'),
    'Home no longer stores the catalog number in the genre field',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== result genre: a modern match is never classical ===');
  labelTests();
  scanTests();
  liveScanTests();
  wiringTests();
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
