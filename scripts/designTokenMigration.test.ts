/**
 * designTokenMigration.test.ts — THE DESIGN-SYSTEM v1 MIGRATION GATE.
 *
 * WHAT THIS PINS. The owner's design system (`/home/team/shared/design-system-v1.md`)
 * has ONE token source, `src/theme/tokens.ts`. Batch 1 migrated five screens (Home,
 * Library, Piece detail, History, Find-a-piece); batch 2, slice 1 migrated seven more
 * (Editor, Scanned viewer, Onboarding, PDF viewer, Practice week, Achievements,
 * Tuner); batch 2, slice 2 migrated five more (Hum search, Metronome, Transposed
 * score reader, Cloud sync, Modern search); batch 2, slice 3 migrated the last
 * four (Notation editor, Practice video, Scan score, Settings), which takes the
 * sweep to ALL 21 screens. This suite is the proof that each migration is real
 * and that it changed NOTHING ELSE:
 *
 *   1. NO RAW HEX in those files — every colour is a `colors.*` role. The
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
 *   5. CRIMSON IS NEVER A TEXT-LABELLED FILL — the one rule the spec says must not
 *      drift. Each screen's crimson fills are pinned by count (the onboarding
 *      progress dot, the two progress bars: graphics, no label on them), and every
 *      text-labelled primary button is pinned to a `brand.anchor` fill with a
 *      white-on-it label. A crimson pill with a small white label fails here.
 *      R4-3 lives here: the practice-video result screen's "Watch with notes" was
 *      crimson under a 15 pt white label (3.83:1), and it is pinned by name below.
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

/** Batch 1 (five screens) + batch 2 slice 1 (seven) + slice 2 (five) + slice 3 (four).
 *  ALL 21 screens are on the tokens as of slice 3. */
const MIGRATED_SCREENS: readonly string[] = [
  'src/screens/HomeScreen.tsx',
  'src/screens/LibraryScreen.tsx',
  'src/screens/PieceDetailScreen.tsx',
  'src/screens/HistoryScreen.tsx',
  'src/screens/FindPieceScreen.tsx',
  'src/screens/EditorScreen.tsx',
  'src/screens/ScannedViewerScreen.tsx',
  'src/screens/OnboardingScreen.tsx',
  'src/screens/PdfViewerScreen.tsx',
  'src/screens/PracticeWeekScreen.tsx',
  'src/screens/AchievementsScreen.tsx',
  'src/screens/TunerScreen.tsx',
  'src/screens/HumSearchScreen.tsx',
  'src/screens/MetronomeScreen.tsx',
  'src/screens/TransposedScoreReaderScreen.tsx',
  'src/screens/CloudSyncScreen.tsx',
  'src/screens/ModernSearchScreen.tsx',
  /* Batch 2, slice 3 — the last four. The sweep is complete: 21 of 21. */
  'src/screens/NotationEditorScreen.tsx',
  'src/screens/PracticeVideoScreen.tsx',
  'src/screens/ScanScoreScreen.tsx',
  'src/screens/SettingsScreen.tsx',
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
  'src/screens/EditorScreen.tsx': [],
  'src/screens/ScannedViewerScreen.tsx': [],
  'src/screens/OnboardingScreen.tsx': [],
  'src/screens/PdfViewerScreen.tsx': [],
  'src/screens/PracticeWeekScreen.tsx': [],
  'src/screens/AchievementsScreen.tsx': [],
  'src/screens/TunerScreen.tsx': [],
  /* Batch 2, slice 2. Four of the five carry no retailer string at all, which is
     pinned: a styling pass may not ADD a money surface either. Modern search is
     the one that touches the funnel — it saves the licensed links a modern match
     arrived with onto the History row — so its builder call and its import are
     frozen byte-for-byte. */
  'src/screens/HumSearchScreen.tsx': [],
  'src/screens/MetronomeScreen.tsx': [],
  'src/screens/TransposedScoreReaderScreen.tsx': [],
  'src/screens/CloudSyncScreen.tsx': [],
  'src/screens/ModernSearchScreen.tsx': [
    "import { modernPurchaseUrls } from '../services/purchaseCta';",
    'purchaseUrls: modernPurchaseUrls(m),',
  ],
  /* Batch 2, slice 3. None of the last four touches the money path — no retailer
     builder, no CTR event, no disclosure, no URL. That is pinned as EMPTY, so a
     styling pass cannot add a money surface to any of them either. */
  'src/screens/NotationEditorScreen.tsx': [],
  'src/screens/PracticeVideoScreen.tsx': [],
  'src/screens/ScanScoreScreen.tsx': [],
  'src/screens/SettingsScreen.tsx': [],
};

/** How many `http(s)://` occurrences each file carries. Pinned, not sampled. */
const HTTP_COUNT: Record<string, number> = {
  'src/screens/HomeScreen.tsx': 1,
  'src/screens/LibraryScreen.tsx': 0,
  'src/screens/PieceDetailScreen.tsx': 0,
  'src/screens/HistoryScreen.tsx': 0,
  'src/screens/FindPieceScreen.tsx': 0,
  'src/screens/EditorScreen.tsx': 0,
  'src/screens/ScannedViewerScreen.tsx': 0,
  'src/screens/OnboardingScreen.tsx': 0,
  'src/screens/PdfViewerScreen.tsx': 0,
  'src/screens/PracticeWeekScreen.tsx': 0,
  'src/screens/AchievementsScreen.tsx': 0,
  'src/screens/TunerScreen.tsx': 0,
  'src/screens/HumSearchScreen.tsx': 0,
  'src/screens/MetronomeScreen.tsx': 0,
  'src/screens/TransposedScoreReaderScreen.tsx': 0,
  'src/screens/CloudSyncScreen.tsx': 0,
  'src/screens/ModernSearchScreen.tsx': 0,
  'src/screens/NotationEditorScreen.tsx': 0,
  'src/screens/PracticeVideoScreen.tsx': 0,
  'src/screens/ScanScoreScreen.tsx': 0,
  'src/screens/SettingsScreen.tsx': 0,
};

/**
 * How many styles in the file FILL with crimson (`accent.primary`). Pinned so a
 * crimson fill cannot appear on a surface that carries a small white label: the
 * three counted here are a progress dot and two progress bars — graphics with no
 * text on them. Everything text-labelled fills with `brand.anchor` (8.05:1).
 * The record cue is the ONE crimson fill batch 2 slice 2 keeps, and nothing is
 * written on it but a 44 pt glyph.
 */
const CRIMSON_FILL_COUNT: Record<string, number> = {
  'src/screens/EditorScreen.tsx': 0,
  'src/screens/ScannedViewerScreen.tsx': 0,
  'src/screens/OnboardingScreen.tsx': 1, // dotActive (the progress dot)
  'src/screens/PdfViewerScreen.tsx': 0,
  'src/screens/PracticeWeekScreen.tsx': 1, // progressFill
  'src/screens/AchievementsScreen.tsx': 1, // barFill
  'src/screens/TunerScreen.tsx': 0,
  'src/screens/HumSearchScreen.tsx': 0,
  'src/screens/MetronomeScreen.tsx': 0,
  'src/screens/TransposedScoreReaderScreen.tsx': 0,
  'src/screens/CloudSyncScreen.tsx': 0,
  'src/screens/ModernSearchScreen.tsx': 1, // micBtn (the record cue, no label on it)
  /* Batch 2, slice 3. The notation editor, the practice video and Settings are
     ZERO: every crimson pill on them carried a small white label and is now on
     brand.anchor (R4-3 among them). Scan score keeps exactly one — `shutterBusy`,
     the shutter's busy ring, which has no text on it. */
  'src/screens/NotationEditorScreen.tsx': 0,
  'src/screens/PracticeVideoScreen.tsx': 0,
  'src/screens/ScanScoreScreen.tsx': 1, // shutterBusy (the shutter ring, no label)
  'src/screens/SettingsScreen.tsx': 0,
};

/**
 * The batch-2 text-labelled primary buttons, frozen: a `brand.anchor` fill and a
 * white-on-it label (`bg.surface` is the app's white). This is the rule the spec
 * says must not drift, so it is pinned as bytes rather than as a colour count.
 */
const BRAND_PILL_BYTES: Record<string, readonly string[]> = {
  'src/screens/OnboardingScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/PdfViewerScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/PracticeWeekScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/TunerScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  /* Batch 2, slice 2 — every text-labelled button on these five screens fills
     with brand.anchor and carries a white label. Four of them used to be crimson
     pills with a small white label (3.83:1), the exact combination the spec bans. */
  'src/screens/HumSearchScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/MetronomeScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/TransposedScoreReaderScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/CloudSyncScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/ModernSearchScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  /* Batch 2, slice 3 — and R4-3. The practice video's shared primary pill used to
     be crimson with a 15 pt white label (3.83:1); it is brand.anchor now, so the
     result screen's "Watch with notes" CTA clears 8.05:1. The other three screens'
     primary buttons (notation save, scan score's done + permission, Settings' two
     toggles/upgrade) follow the same rule. */
  'src/screens/NotationEditorScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/PracticeVideoScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/ScanScoreScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
  'src/screens/SettingsScreen.tsx': [
    'backgroundColor: colors.brand.anchor,',
    'color: colors.bg.surface,',
  ],
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

/** How many styles FILL with crimson (`backgroundColor: colors.accent.primary`). */
function crimsonFillCount(source: string): number {
  const text = withoutComments(source);
  return (text.match(/backgroundColor:\s*colors\.accent\.primary,/g) || []).length;
}

/** The brand-pill strings this file is MISSING (empty = the rule is intact). */
function missingBrandPillBytes(source: string, file: string): string[] {
  const expected = BRAND_PILL_BYTES[file] || [];
  return expected.filter((needle) => source.indexOf(needle) < 0);
}

/**
 * R4-3 — THE FILL OF THE PILL THE "Watch with notes" CTA IS DRAWN IN.
 *
 * The Round-4 audit's one colour defect: on the practice-video result screen the
 * CTA rendered in `primaryBtn`, which was `#e94560` under a 15 pt white label —
 * 3.83:1, the exact combination the design system bans. It is `brand.anchor` now
 * (8.05:1). Pinned by the style BLOCK, not by a colour count, so the guard names
 * the surface the owner pressed rather than "somewhere on the screen".
 */
function watchWithNotesFill(source: string): string | null {
  const m = source.match(/primaryBtn: \{\s*\n\s*backgroundColor: (colors\.[\w.]+),/);
  return m ? m[1] : null;
}

/** The colour of the label drawn ON that pill. */
function watchWithNotesLabel(source: string): string | null {
  const m = source.match(/primaryBtnText: \{ color: (colors\.[\w.]+),/);
  return m ? m[1] : null;
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

console.log('\n[designTokenMigration] the migrated screens draw from src/theme/tokens.ts');

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

console.log('\n[designTokenMigration] crimson is never under a small white label');
for (const file of MIGRATED_SCREENS) {
  const name = file.replace('src/screens/', '');
  const source = sources[file];
  const expected = CRIMSON_FILL_COUNT[file];
  if (expected === undefined) continue;
  assertEq(
    crimsonFillCount(source),
    expected,
    `${name} has exactly ${expected} crimson fill(s) — no crimson pill carries a label`,
  );
  assertEq(
    missingBrandPillBytes(source, file),
    [],
    `${name} keeps its text-labelled primary button on brand.anchor with a white label`,
  );
}

console.log('\n[designTokenMigration] R4-3: "Watch with notes" clears AA');
const practiceVideoSrc = sources['src/screens/PracticeVideoScreen.tsx'];
assert(
  practiceVideoSrc.indexOf('<Text style={styles.primaryBtnText}>{PRACTICE_VIDEO_DONE_CTA}</Text>') >= 0,
  'the "Watch with notes" CTA still renders in the shared primary pill',
);
assertEq(
  watchWithNotesFill(practiceVideoSrc),
  'colors.brand.anchor',
  'the "Watch with notes" pill fills with brand.anchor (8.05:1), not crimson (3.83:1)',
);
assertEq(
  watchWithNotesLabel(practiceVideoSrc),
  'colors.bg.surface',
  'the label on the "Watch with notes" pill is the app white',
);

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

// ── batch 2, slice 1: the seven screens converted after batch 1 ─────────────
const tunerSrc = sources['src/screens/TunerScreen.tsx'];
const onboardingSrc = sources['src/screens/OnboardingScreen.tsx'];
const achievementsSrc = sources['src/screens/AchievementsScreen.tsx'];
const practiceWeekSrc = sources['src/screens/PracticeWeekScreen.tsx'];

const tunerHexBack = tunerSrc.replace('backgroundColor: colors.bg.canvas,', "backgroundColor: '#1a1a2e',");
const onboardingRadiusBack = onboardingSrc.replace('borderRadius: radius.pill,', 'borderRadius: 14,');
const achievementsSpaceBack = achievementsSrc.replace(
  'marginBottom: spacing.s16,',
  'marginBottom: 16,',
);
const tunerCrimsonPill = tunerSrc.replace(
  'backgroundColor: colors.brand.anchor,',
  'backgroundColor: colors.accent.primary,',
);
const practiceWeekLabelGreyed = practiceWeekSrc.replace(
  'color: colors.bg.surface,',
  'color: colors.text.primary,',
);

// ── batch 2, slice 2: the five screens converted after slice 1 ──────────────
/** Replace EVERY occurrence (a style string can appear more than once). */
function replaceAll(text: string, from: string, to: string): string {
  return text.split(from).join(to);
}

const humSrc = sources['src/screens/HumSearchScreen.tsx'];
const metronomeSrc = sources['src/screens/MetronomeScreen.tsx'];
const readerSrc = sources['src/screens/TransposedScoreReaderScreen.tsx'];
const cloudSyncSrc = sources['src/screens/CloudSyncScreen.tsx'];
const modernSrc = sources['src/screens/ModernSearchScreen.tsx'];

const humHexBack = humSrc.replace('backgroundColor: colors.bg.canvas,', "backgroundColor: '#12122b',");
const metronomeRadiusBack = metronomeSrc.replace('borderRadius: radius.circle,', 'borderRadius: 60,');
const readerSpaceBack = readerSrc.replace('paddingHorizontal: spacing.s16,', 'paddingHorizontal: 16,');
/** The metronome's Start pill and the modern flow's "Open Settings" put back to
 *  crimson: the fill count rises by one, which is what fails. */
const metronomeCrimsonPill = metronomeSrc.replace(
  'backgroundColor: colors.brand.anchor,',
  'backgroundColor: colors.accent.primary,',
);
const cloudSyncLabelGreyed = replaceAll(
  cloudSyncSrc,
  'color: colors.bg.surface,',
  'color: colors.text.primary,',
);
const modernFunnelDropped = modernSrc.replace(
  'purchaseUrls: modernPurchaseUrls(m),',
  'purchaseUrls: null,',
);

// ── batch 2, slice 3: the last four screens ────────────────────────────────
const notationSrc = sources['src/screens/NotationEditorScreen.tsx'];
const scanSrc = sources['src/screens/ScanScoreScreen.tsx'];
const settingsSrc = sources['src/screens/SettingsScreen.tsx'];

const notationHexBack = notationSrc.replace('backgroundColor: colors.bg.canvas,', "backgroundColor: '#1a1a2e',");
const settingsRadiusBack = settingsSrc.replace('borderRadius: radius.pill,', 'borderRadius: 999,');
const scanSpaceBack = scanSrc.replace('paddingHorizontal: spacing.s12,', 'paddingHorizontal: 12,');
/** The four screens carry no retailer string at all; a styling pass may not add one. */
const notationUrlSmuggled = notationSrc.replace(
  'const baseStyles',
  "const EXTRA = 'https://example.com/x';\nconst baseStyles",
);

// ── R4-3: crimson put back under the "Watch with notes" pill ───────────────
const watchPillCrimson = practiceVideoSrc.replace(
  '  primaryBtn: {\n    backgroundColor: colors.brand.anchor,',
  '  primaryBtn: {\n    backgroundColor: colors.accent.primary,',
);
const watchLabelGreyed = practiceVideoSrc.replace(
  'primaryBtnText: { color: colors.bg.surface,',
  'primaryBtnText: { color: colors.text.primary,',
);

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
  {
    label: 'batch 2: a raw hex put back into the tuner',
    caught: tunerHexBack !== tunerSrc && hexLiterals(tunerHexBack).length === 1,
  },
  {
    label: 'batch 2: a numeric radius put back into onboarding',
    caught:
      onboardingRadiusBack !== onboardingSrc && radiusLiterals(onboardingRadiusBack).length === 1,
  },
  {
    label: 'batch 2: an on-scale spacing literal put back into achievements',
    caught:
      achievementsSpaceBack !== achievementsSrc &&
      onScaleSpacingLiterals(achievementsSpaceBack).length === 1,
  },
  {
    label: 'batch 2: crimson put back under the tuner listen pill',
    caught: tunerCrimsonPill !== tunerSrc && crimsonFillCount(tunerCrimsonPill) === 1,
  },
  {
    label: 'batch 2: the white label dropped from a brand pill',
    caught:
      practiceWeekLabelGreyed !== practiceWeekSrc &&
      missingBrandPillBytes(practiceWeekLabelGreyed, 'src/screens/PracticeWeekScreen.tsx').length === 1,
  },
  {
    label: 'slice 2: a raw hex put back into the hum search screen',
    caught: humHexBack !== humSrc && hexLiterals(humHexBack).length === 1,
  },
  {
    label: 'slice 2: a numeric radius put back into the metronome',
    caught:
      metronomeRadiusBack !== metronomeSrc && radiusLiterals(metronomeRadiusBack).length === 1,
  },
  {
    label: 'slice 2: an on-scale spacing literal put back into the score reader',
    caught: readerSpaceBack !== readerSrc && onScaleSpacingLiterals(readerSpaceBack).length === 1,
  },
  {
    label: 'slice 2: crimson put back under the metronome Start pill',
    caught: metronomeCrimsonPill !== metronomeSrc && crimsonFillCount(metronomeCrimsonPill) === 1,
  },
  {
    label: 'slice 2: the white label dropped from the cloud sync import pill',
    caught:
      cloudSyncLabelGreyed !== cloudSyncSrc &&
      missingBrandPillBytes(cloudSyncLabelGreyed, 'src/screens/CloudSyncScreen.tsx').length === 1,
  },
  {
    label: 'slice 2: the modern flow stopped saving the licensed links',
    caught:
      modernFunnelDropped !== modernSrc &&
      missingAffiliateBytes(modernFunnelDropped, 'src/screens/ModernSearchScreen.tsx').length === 1,
  },
  {
    label: 'slice 3: a raw hex put back into the notation editor',
    caught: notationHexBack !== notationSrc && hexLiterals(notationHexBack).length === 1,
  },
  {
    label: 'slice 3: a numeric radius put back into Settings',
    caught:
      settingsRadiusBack !== settingsSrc && radiusLiterals(settingsRadiusBack).length === 1,
  },
  {
    label: 'slice 3: an on-scale spacing literal put back into the scan score',
    caught: scanSpaceBack !== scanSrc && onScaleSpacingLiterals(scanSpaceBack).length === 1,
  },
  {
    label: 'slice 3: a URL smuggled into the notation editor (its money pin is EMPTY)',
    caught:
      notationUrlSmuggled !== notationSrc &&
      extraHttpOccurrences(notationUrlSmuggled, 'src/screens/NotationEditorScreen.tsx') === 1,
  },
  {
    label: 'R4-3: crimson put back under the "Watch with notes" pill',
    caught:
      watchPillCrimson !== practiceVideoSrc &&
      watchWithNotesFill(watchPillCrimson) === 'colors.accent.primary' &&
      crimsonFillCount(watchPillCrimson) === 1,
  },
  {
    label: 'R4-3: the white label dropped from the "Watch with notes" pill',
    caught:
      watchLabelGreyed !== practiceVideoSrc &&
      watchWithNotesLabel(watchLabelGreyed) === 'colors.text.primary' &&
      watchWithNotesLabel(practiceVideoSrc) === 'colors.bg.surface',
  },
];

for (const probe of probes) assert(probe.caught, `MUTATION: ${probe.label} is CAUGHT`);

// ─── SUMMARY ────────────────────────────────────────────────────────────────

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
