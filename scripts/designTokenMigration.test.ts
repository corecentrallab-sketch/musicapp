/**
 * designTokenMigration.test.ts — THE DESIGN-SYSTEM v1 MIGRATION GATE (batch 1).
 *
 * WHAT THIS PINS. The owner's design system (`/home/team/shared/design-system-v1.md`)
 * has ONE token source, `src/theme/tokens.ts`. Five screens were migrated to it:
 * Home, Library, Piece detail, History and Find-a-piece. This suite is the proof
 * that the migration is real and that it changed NOTHING ELSE:
 *
 *   1. NO RAW HEX in those five files — every colour is a `colors.*` role. The
 *      scan runs on the source with its comments blanked, so a doc comment that
 *      quotes an old hex (`the navy #16213e card`) is not a violation while a
 *      real style literal is. (`PR #115` is not a colour either.)
 *   2. NO NUMERIC RADIUS — every `borderRadius` is a `radius.*` token (pill 9999,
 *      circle '50%', card 16, modal 24). Four shapes, no fifth.
 *   3. NO ON-SCALE SPACING LITERAL — a 4/8-scale value (4, 8, 12, 16, 24, 32, 40,
 *      48) must be a `spacing.*` token. An OFF-scale value (3, 6, 10, 14, 18, 20,
 *      22 …) is deliberately allowed to stay a literal: rounding it would
 *      restructure the layout, and layout geometry is a later batch with its own
 *      device pass.
 *   4. EVERY AFFILIATE STRING IS BYTE-IDENTICAL — the retailer CTA's builder call,
 *      both CTR events, the disclosure and its import are compared against the
 *      exact bytes they had before the migration, and the count of `http(s)://`
 *      occurrences per file is pinned, so a URL cannot be edited, added or dropped
 *      by a "styling" change. THE MONEY PATH IS NOT A STYLE.
 *
 * Each check is shown to FAIL on a mutated copy of the real file (the pre-migration
 * shape), so a green run cannot be vacuous — the standing defect class here is
 * "a gate can be green and still blind".
 *
 * Plain Node, no react-native, no network. Runs in `npm run test:tier1`.
 */

declare const require: ((id: string) => any) & {
  resolve(id: string, options?: { paths?: string[] }): string;
};
declare const process: { cwd(): string; exit(code: number): never };

let passes = 0;
let failures = 0;

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
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.log(`    expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  assert(ok, label);
}

// ─── the migrated set ───────────────────────────────────────────────────────

/** The five screens this batch migrates. The other 16 are LATER batches. */
const MIGRATED_SCREENS: readonly string[] = [
  'src/screens/HomeScreen.tsx',
  'src/screens/LibraryScreen.tsx',
  'src/screens/PieceDetailScreen.tsx',
  'src/screens/HistoryScreen.tsx',
  'src/screens/FindPieceScreen.tsx',
];

/**
 * The affiliate strings, frozen at their pre-migration bytes. An empty list means
 * "this screen carries none", which is asserted too: a surface that quietly GAINS
 * a retailer string is as much a change as one that loses it.
 */
const AFFILIATE_BYTES: Record<string, readonly string[]> = {
  'src/screens/HomeScreen.tsx': [
    // The one hosted score URL on the screen (a Mutopia public-domain PDF).
    "'https://www.mutopiaproject.org/ftp/BachJS/BWV846/bwv-846-prelude/bwv-846-prelude-a4.pdf'",
  ],
  'src/screens/LibraryScreen.tsx': [],
  'src/screens/PieceDetailScreen.tsx': [
    "import { AFFILIATE_DISCLOSURE } from '../services/v471bMoneyCta';",
    '<Text style={styles.sheetCardDisclosure}>{AFFILIATE_DISCLOSURE}</Text>',
  ],
  'src/screens/HistoryScreen.tsx': [
    "import { AFFILIATE_DISCLOSURE } from '../services/v471bMoneyCta';",
    '<Text style={styles.sheetDisclosure}>{AFFILIATE_DISCLOSURE}</Text>',
  ],
  'src/screens/FindPieceScreen.tsx': [
    "import { AFFILIATE_DISCLOSURE } from '../services/v471bMoneyCta';",
    "import { trackAffiliateCta, type AffiliateCtaSurface } from '../services/affiliateCtaEvents';",
    'const url = sheetMusicDirectSearchUrl(query);',
    "trackAffiliateCta('find_piece', 'viewed');",
    "trackAffiliateCta('find_piece', 'clicked');",
    '<Text style={styles.noMatchDisclosure}>{AFFILIATE_DISCLOSURE}</Text>',
    '<SearchExternalSection section={external} onOpen={handleOpenRetailer} surface={entrySurface} />',
  ],
};

/** How many `http(s)://` occurrences each file carries. Pinned, not sampled. */
const HTTP_COUNT: Record<string, number> = {
  'src/screens/HomeScreen.tsx': 1,
  'src/screens/LibraryScreen.tsx': 0,
  'src/screens/PieceDetailScreen.tsx': 0,
  'src/screens/HistoryScreen.tsx': 0,
  'src/screens/FindPieceScreen.tsx': 0,
};

const SPACING_STEPS: readonly number[] = [4, 8, 12, 16, 24, 32, 40, 48];

// ─── the checks (pure, so a mutation can be run through them) ───────────────

const HEX = /#[0-9A-Fa-f]{3,8}\b/g;
const RADIUS_PROP = /border(TopLeft|TopRight|BottomLeft|BottomRight)?Radius:\s*([^,\n}]+)/g;
const SPACE_PROP =
  /(?:^|[\s{])(padding|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap):\s*([0-9]+)\s*,/g;
const HTTP = /https?:\/\//g;

/**
 * The source with every comment character blanked to a space — quote-aware, and
 * LENGTH-PRESERVING, so a reported offset still points at the real line of the
 * file on disk. (A naive `//` strip would eat the `https://` inside a string.)
 */
function withoutComments(source: string): string {
  const out = source.split('');
  let quote = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) quote = '';
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < source.length) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

function lineOf(source: string, at: number): number {
  let line = 1;
  for (let i = 0; i < at && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

function scan(text: string, pattern: RegExp, test: (m: RegExpExecArray) => string | null): string[] {
  const found: string[] = [];
  pattern.lastIndex = 0;
  let m = pattern.exec(text);
  while (m) {
    const verdict = test(m);
    if (verdict !== null) found.push(verdict);
    m = pattern.exec(text);
  }
  pattern.lastIndex = 0;
  return found;
}

/** Every raw hex colour in the file, as `line: value`. Comments do not count. */
function hexLiterals(source: string): string[] {
  const text = withoutComments(source);
  return scan(text, HEX, (m) => `${lineOf(text, m.index)}: ${m[0]}`);
}

/** Every radius written as a bare number instead of a `radius.*` token. */
function radiusLiterals(source: string): string[] {
  const text = withoutComments(source);
  return scan(text, RADIUS_PROP, (m) => {
    const value = m[2].trim();
    return value.startsWith('radius.') ? null : `${lineOf(text, m.index)}: ${value}`;
  });
}

/** Every ON-SCALE spacing value left as a literal (an off-scale one is allowed). */
function onScaleSpacingLiterals(source: string): string[] {
  const text = withoutComments(source);
  return scan(text, SPACE_PROP, (m) =>
    SPACING_STEPS.indexOf(Number(m[2])) >= 0 ? `${lineOf(text, m.index)}: ${m[1]}: ${m[2]}` : null,
  );
}

/** The affiliate strings this file is MISSING (empty = byte-identical). */
function missingAffiliateBytes(source: string, file: string): string[] {
  const expected = AFFILIATE_BYTES[file] || [];
  return expected.filter((needle) => source.indexOf(needle) < 0);
}

/** How many URLs this file carries BEYOND the frozen count (0 = unchanged). */
function extraHttpOccurrences(source: string, file: string): number {
  const text = withoutComments(source);
  const matches = text.match(HTTP) || [];
  return matches.length - (HTTP_COUNT[file] || 0);
}

function importsTheTokens(source: string): boolean {
  return /import \{[^}]*\} from '\.\.\/theme\/tokens';/.test(source);
}

// ─── the real files ─────────────────────────────────────────────────────────

function repoRoot(): string {
  const path = require('path');
  const here = process.cwd();
  return path.basename(here) === 'musicapp-update' ? here : path.resolve(here, '..');
}

function readRepoFile(file: string): string {
  const fs = require('fs');
  const path = require('path');
  return String(fs.readFileSync(path.join(repoRoot(), file), 'utf8'));
}

console.log('\n[designTokenMigration] the five migrated screens draw from src/theme/tokens.ts');

const sources: Record<string, string> = {};
for (const file of MIGRATED_SCREENS) {
  sources[file] = readRepoFile(file);
  const name = file.replace('src/screens/', '');
  const source = sources[file];
  assert(source.length > 5000, `${name} was read (${source.length} chars)`);
  assertEq(hexLiterals(source), [], `${name} carries no raw hex colour`);
  assertEq(radiusLiterals(source), [], `${name} carries no numeric radius (radius.* only)`);
  assertEq(onScaleSpacingLiterals(source), [], `${name} carries no on-scale spacing literal`);
  assertEq(missingAffiliateBytes(source, file), [], `${name} keeps every affiliate string byte-identical`);
  assertEq(extraHttpOccurrences(source, file), 0, `${name} gained no URL`);
  assert(importsTheTokens(source), `${name} imports the token source`);
}

console.log('\n[designTokenMigration] the token source is the only colour authority');
const tokensSrc = readRepoFile('src/theme/tokens.ts');
for (const role of [
  "canvas: '#F7F5F0'",
  "surface: '#FFFFFF'",
  "surfaceTinted: '#EFECE4'",
  "primary: '#1A1E29'",
  "secondary: '#4E576B'",
  "anchor: '#3A4E85'",
  "primary: '#E94560'",
  "subtle: '#D9D4C7'",
  "control: '#6F7A92'",
  'pill: 9999',
  "circle: '50%'",
  'card: 16',
  'modal: 24',
]) {
  assert(tokensSrc.indexOf(role) >= 0, `tokens.ts still carries ${role}`);
}

// ─── MUTATION PROBES — each one must be CAUGHT ──────────────────────────────

console.log('\n[designTokenMigration] MUTATION PROBES (a green run must not be blind)');

const home = sources['src/screens/HomeScreen.tsx'];
const findPiece = sources['src/screens/FindPieceScreen.tsx'];
const pieceDetail = sources['src/screens/PieceDetailScreen.tsx'];
const historySrc = sources['src/screens/HistoryScreen.tsx'];

const hexBackInStyle = home.replace('backgroundColor: colors.bg.canvas,', "backgroundColor: '#1a1a2e',");
const hexBackInline = pieceDetail.replace(
  'leverBtnText: { color: colors.text.secondary,',
  "leverBtnText: { color: '#4ecdc4',",
);
const radiusBack = home.replace('borderRadius: radius.card,', 'borderRadius: 18,');
const spaceBack = home.replace('marginHorizontal: spacing.s16,', 'marginHorizontal: 16,');
const spaceOffScale = home.replace('marginHorizontal: spacing.s16,', 'marginHorizontal: 20,');
const hexInComment = historySrc.replace(
  'const baseStyles = StyleSheet.create({',
  '// the old navy #1a1a2e card\nconst baseStyles = StyleSheet.create({',
);
const urlEdited = home.replace('bwv-846-prelude-a4.pdf', 'bwv-846-prelude-a4.PDF');
const ctrDropped = findPiece.replace("trackAffiliateCta('find_piece', 'clicked');", '');
const builderSwapped = findPiece.replace(
  'const url = sheetMusicDirectSearchUrl(query);',
  'const url = musicnotesSearchUrl(query);',
);
const disclosureDropped = pieceDetail.replace(
  '<Text style={styles.sheetCardDisclosure}>{AFFILIATE_DISCLOSURE}</Text>',
  '',
);
const urlSmuggled = home.replace('const baseStyles', "const EXTRA = 'https://example.com/x';\nconst baseStyles");
const importDropped = home.replace("import { colors, radius, spacing } from '../theme/tokens';\n", '');

const probes: Array<{ label: string; caught: boolean }> = [
  { label: 'a raw hex put back into a style block', caught: hexLiterals(hexBackInStyle).length === 1 },
  { label: 'a raw hex put back into a one-line style', caught: hexLiterals(hexBackInline).length === 1 },
  { label: 'a numeric radius put back', caught: radiusLiterals(radiusBack).length === 1 },
  {
    label: 'an on-scale spacing value put back as a literal',
    caught: spaceBack !== home && onScaleSpacingLiterals(spaceBack).length === 1,
  },
  { label: 'an OFF-scale spacing value is NOT a violation', caught: onScaleSpacingLiterals(spaceOffScale).length === 0 },
  { label: 'a doc comment quoting an old hex is NOT a violation', caught: hexLiterals(hexInComment).length === 0 },
  {
    label: 'an edited affiliate URL',
    caught: missingAffiliateBytes(urlEdited, 'src/screens/HomeScreen.tsx').length === 1,
  },
  {
    label: 'a dropped affiliate CTR event',
    caught: missingAffiliateBytes(ctrDropped, 'src/screens/FindPieceScreen.tsx').length === 1,
  },
  {
    label: 'a swapped retailer query builder',
    caught: missingAffiliateBytes(builderSwapped, 'src/screens/FindPieceScreen.tsx').length === 1,
  },
  {
    label: 'a dropped affiliate disclosure line',
    caught: missingAffiliateBytes(disclosureDropped, 'src/screens/PieceDetailScreen.tsx').length === 1,
  },
  {
    label: 'a second URL smuggled into a screen',
    caught: extraHttpOccurrences(urlSmuggled, 'src/screens/HomeScreen.tsx') === 1,
  },
  { label: 'the token import removed', caught: importsTheTokens(importDropped) === false },
];

for (const probe of probes) assert(probe.caught, `MUTATION: ${probe.label} is CAUGHT`);

// ─── SUMMARY ────────────────────────────────────────────────────────────────

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
