/**
 * v47.1 PART A · ITEM 2 — SETTINGS TEXT FIT, THE WHOLE CLASS.
 *
 * THE DEFECT (owner report 10-30): the NoteSnap Pro box at the top of Settings
 * "looks jammed in" — a 16 dp/700 title and a 12 dp sub inside a row pinned at
 * `height: 62`. The §3 spec rows had the same pattern (`height: 52`) plus
 * `specRowCopy: { flex: 1, paddingRight: 100 }`: a HARD 100 dp reserved for a
 * trailing value, and a `numberOfLines={1}` title. Fixed height + hard pad +
 * single-line title is a layout that only fits at the default font scale on a wide
 * phone; raise the OS font size, or use 320 dp, and the text CLIPS.
 *
 * WHAT THIS SUITE PROVES (source text of the REAL screen, so it bites without a
 * recompile):
 *   1. no text row carries a fixed `height` — each has a `minHeight` floor plus
 *      vertical padding, so it grows;
 *   2. the copy block flexes (`flex: 1`, `minWidth: 0`) and reserves nothing
 *      (`paddingRight` gone), while the trailing pill/value is measured;
 *   3. titles and subs WRAP (no `numberOfLines` on those elements);
 *   4. the OS font scale is honoured (no `allowFontScaling={false}`, no
 *      `maxFontSizeMultiplier` cap);
 *   5. the applied floors still equal SETTINGS_SPEC's numbers;
 *   6. mutation probes: each guard fails when the defect is restored in memory,
 *      and passes again on the real text.
 *
 * Plain Node, no react-native, no network. Run with `npm run test:tier1`.
 */
import { SETTINGS_SPEC } from '../src/services/settingsSpec';
import {
  HARD_RIGHT_PAD_DP,
  MIN_TAP_TARGET_DP,
  TEXT_ROW_STYLES,
  noRowReservesAHardRightPad,
  proRowLaysOutWithoutHardPad,
  rowCopyFlexesWithoutHardPad,
  rowTitlesWrap,
  settingsFitContractHolds,
  settingsFloorsMatchTheSpec,
  settingsHonoursFontScale,
  textRowCarriesNoFixedHeight,
  textRowsCarryNoFixedHeight,
} from '../src/services/v471SettingsFit';

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
    console.log(`  ✗ ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (!ok) {
    console.log(`     expected ${String(expected)}, got ${String(actual)}`);
  }
  assert(ok, label);
}

// ─── helpers ────────────────────────────────────────────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
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

const SETTINGS_PATH = 'src/screens/SettingsScreen.tsx';
const SETTINGS = readAppFile(SETTINGS_PATH);

/** The pre-fix style blocks, verbatim from master b75e4f4 — the fixture. */
const PRE_FIX_PRO_ROW = `  proRow: {
    height: 62,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 12,
  },`;
const PRE_FIX_SPEC_ROW = `  specRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 10,
  },`;
const PRE_FIX_ROW_COPY = `  specRowCopy: { flex: 1, paddingRight: 100 },`;
const PRE_FIX_TITLE_ELEMENT = `        <Text style={[styles.specRowTitle, { color: palette.TXT }]} numberOfLines={1}>
          {title}
        </Text>`;

/** A whole miniature sheet: the pre-fix blocks, so a guard can be shown to bite. */
const PRE_FIX_SHEET = `const baseStyles = StyleSheet.create({\n${PRE_FIX_PRO_ROW}\n${PRE_FIX_SPEC_ROW}\n${PRE_FIX_ROW_COPY}\n});\n${PRE_FIX_TITLE_ELEMENT}`;

// ─── 1. the rules ─────────────────────────────────────────────

function ruleTests(): void {
  console.log('\n1. THE RULES — the numbers the fix is built from');
  assertEq(TEXT_ROW_STYLES.length, 2, 'two text rows on this screen are covered (proRow, specRow)');
  assertEq(TEXT_ROW_STYLES.indexOf('proRow') >= 0, true, 'the Pro row is covered');
  assertEq(TEXT_ROW_STYLES.indexOf('specRow') >= 0, true, 'the §3 spec rows are covered');
  assertEq(MIN_TAP_TARGET_DP, 44, 'the floor may never drop below a 44 dp tap target');
  assertEq(HARD_RIGHT_PAD_DP, 40, 'a right pad at or above 40 dp counts as a reservation');
  assertEq(SETTINGS_SPEC.proMinHeight, 62, 'the Pro row floor is still the spec’s 62 dp');
  assertEq(SETTINGS_SPEC.rowMinHeight, 52, 'the row floor is still the spec’s 52 dp');
  assertEq(SETTINGS_SPEC.proPadY, 12, 'the Pro row carries 12 dp vertical padding');
  assertEq(SETTINGS_SPEC.rowPadY, 10, 'the row carries 10 dp vertical padding');
  assertEq(SETTINGS_SPEC.rowValueGap, 12, 'the value gap is 12 dp — not a 100 dp reservation');
}

// ─── 2. the real screen ──────────────────────────────────────

function realScreenTests(): void {
  console.log(`\n2. THE REAL SCREEN — ${SETTINGS_PATH}`);
  assert(SETTINGS.length > 30000, `read the screen (${SETTINGS.length} chars)`);
  assertEq(textRowsCarryNoFixedHeight(SETTINGS), true, 'no text row carries a fixed height');
  for (const style of TEXT_ROW_STYLES) {
    assertEq(
      textRowCarriesNoFixedHeight(SETTINGS, style),
      true,
      `${style}: minHeight floor + vertical padding, no height`,
    );
  }
  assertEq(rowCopyFlexesWithoutHardPad(SETTINGS), true, 'specRowCopy flexes and reserves no right pad');
  assertEq(proRowLaysOutWithoutHardPad(SETTINGS), true, 'the Pro row flexes its copy and measures its pill');
  assertEq(noRowReservesAHardRightPad(SETTINGS), true, 'no row style reserves a hard right pad');
  assertEq(rowTitlesWrap(SETTINGS), true, 'row titles and subs wrap (no numberOfLines={1})');
  assertEq(settingsHonoursFontScale(SETTINGS), true, 'the OS font scale is honoured');
  assertEq(settingsFloorsMatchTheSpec(SETTINGS), true, 'the applied floors equal SETTINGS_SPEC');
  assertEq(settingsFitContractHolds(SETTINGS), true, 'the whole fit contract holds on the real screen');
}

// ─── 3. the pre-fix fixture must FAIL ────────────────────────

function fixtureTests(): void {
  console.log('\n3. THE PRE-FIX FIXTURE — the defect is what the guards reject');
  assertEq(
    textRowCarriesNoFixedHeight(PRE_FIX_SHEET, 'proRow'),
    false,
    'the pre-fix Pro row (height: 62) FAILS the no-fixed-height rule',
  );
  assertEq(
    textRowCarriesNoFixedHeight(PRE_FIX_SHEET, 'specRow'),
    false,
    'the pre-fix spec row (height: 52) FAILS the no-fixed-height rule',
  );
  assertEq(
    rowCopyFlexesWithoutHardPad(PRE_FIX_SHEET),
    false,
    'the pre-fix specRowCopy (paddingRight: 100) FAILS the flex rule',
  );
  assertEq(
    rowTitlesWrap(PRE_FIX_SHEET),
    false,
    'the pre-fix single-line title FAILS the wrap rule',
  );
  assertEq(
    settingsFitContractHolds(PRE_FIX_SHEET),
    false,
    'the whole contract rejects the pre-fix sheet',
  );
}

// ─── 4. mutation probes (in memory) ──────────────────────────

function probe(name: string, mutated: string, original: string, guard: (text: string) => boolean): void {
  assertEq(mutated !== original, true, `PROBE setup: "${name}" really changed the source`);
  assertEq(guard(mutated), false, `PROBE: ${name} → FAILS`);
  assertEq(guard(original), true, `PROBE: ${name} → the restored source passes again`);
}

function mutationProbes(): void {
  console.log('\n4. MUTATION PROBES — restore each half of the defect, require the guard to fail');

  probe(
    'the Pro row goes back to a fixed height: 62',
    SETTINGS.replace('  proRow: {\n    minHeight: 62,', '  proRow: {\n    height: 62,'),
    SETTINGS,
    textRowsCarryNoFixedHeight,
  );
  probe(
    'the spec row goes back to a fixed height: 52',
    SETTINGS.replace('  specRow: {\n    minHeight: 52,', '  specRow: {\n    height: 52,'),
    SETTINGS,
    textRowsCarryNoFixedHeight,
  );
  probe(
    'the copy block reserves a hard right pad again',
    SETTINGS.replace(
      'specRowCopy: { flex: 1, minWidth: 0 },',
      'specRowCopy: { flex: 1, paddingRight: 100 },',
    ),
    SETTINGS,
    rowCopyFlexesWithoutHardPad,
  );
  probe(
    'the copy block stops flexing',
    SETTINGS.replace(
      'specRowCopy: { flex: 1, minWidth: 0 },',
      'specRowCopy: { minWidth: 0 },',
    ),
    SETTINGS,
    rowCopyFlexesWithoutHardPad,
  );
  probe(
    'the row loses its vertical padding (the floor becomes a squeeze)',
    SETTINGS.replace('    paddingRight: 10,\n    paddingVertical: 10,', '    paddingRight: 10,'),
    SETTINGS,
    textRowsCarryNoFixedHeight,
  );
  probe(
    'the row title is clamped to one line again',
    SETTINGS.replace(
      '        <Text style={[styles.specRowTitle, { color: palette.TXT }]}>',
      '        <Text style={[styles.specRowTitle, { color: palette.TXT }]} numberOfLines={1}>',
    ),
    SETTINGS,
    rowTitlesWrap,
  );
  probe(
    'the sub is clamped to one line again',
    SETTINGS.replace(
      '          <Text style={[styles.specRowSub, { color: palette.SUB }]}>',
      '          <Text style={[styles.specRowSub, { color: palette.SUB }]} numberOfLines={1}>',
    ),
    SETTINGS,
    rowTitlesWrap,
  );
  probe(
    'the screen stops honouring the OS font scale',
    SETTINGS.replace(
      '<ScrollView\n      style={[styles.container',
      '<ScrollView maxFontSizeMultiplier={1}\n      style={[styles.container',
    ),
    SETTINGS,
    settingsHonoursFontScale,
  );
  probe(
    'the Pro pill stops being measured (flexShrink goes)',
    SETTINGS.replace(
      '    paddingVertical: 8,\n    flexShrink: 0,\n    marginLeft: 8,',
      '    paddingVertical: 8,\n    marginLeft: 8,',
    ),
    SETTINGS,
    proRowLaysOutWithoutHardPad,
  );
  probe(
    'the Pro row loses its floor (a minHeight below the tap target)',
    SETTINGS.replace('  proRow: {\n    minHeight: 62,', '  proRow: {\n    minHeight: 30,'),
    SETTINGS,
    textRowsCarryNoFixedHeight,
  );

  // The real screen still passes after every probe.
  assertEq(settingsFitContractHolds(SETTINGS), true, 'the real screen still passes after every probe');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('v47.1 Part A — Settings rows grow with the text (no fixed heights, no hard pads)');
  ruleTests();
  realScreenTests();
  fixtureTests();
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
