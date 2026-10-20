/**
 * uxr-v43-add-music.test.ts — DESIGNER SPEC §2, THE "+ ADD MUSIC" SHEET (v43 slice 1).
 *
 * The spec's rule for the Library header is "one +, one meaning": ONE 44 dp filled
 * HUM circle in the header replaces every scattered add/import affordance, and it
 * opens a modal bottom sheet whose THREE equal-weight rows open flows the app
 * already has — the camera/scan screen, the Library's file import, and the catalog
 * search. No FAB, no second +, no retailer branding on the sheet, and all three
 * dismissals (grabber swipe, scrim tap, Cancel row) present, with no close ✕.
 *
 * EVERY guard here is a SOURCE SCAN of the real files, so it bites without a
 * recompile (that is how the mutation probes are run):
 *   src/screens/LibraryScreen.tsx      — the one entry point + the three wirings
 *   src/components/LibraryHeaderActions.tsx — the 44 dp + beside the cog
 *   src/components/AddMusicSheet.tsx   — the sheet, its geometry and dismissals
 *   src/navigation/TabNavigator.tsx    — must NOT wire a second Library header
 *   src/services/addMusicSheet.ts      — the constants' VALUES (swipe threshold = 48 dp)
 *
 * Sections 4 and 5 are the BITE PROOF: the pre-fix screen is reconstructed and
 * every detector is run against a mutation of the REAL source that restores the
 * defect it guards.
 */
import { maskSourceComments } from '../src/services/audioFocusContract';
import { contrastRatio } from '../src/services/inkContrast';
import { DARK_THEME, LIGHT_THEME, type ThemeTokens } from '../src/services/theme';
import { TAKE_STAFF_PAPER } from '../src/services/takeStaffPalette';
import { countTag, styleValue } from '../src/services/uxrV41Contract';
import {
  ADD_MUSIC_BUTTON_LABEL,
  ADD_MUSIC_CANCEL,
  ADD_MUSIC_RETAILER_WORDS,
  ADD_MUSIC_ROLES,
  ADD_MUSIC_ROWS,
  ADD_MUSIC_SCRIM,
  ADD_MUSIC_SPEC,
  ADD_MUSIC_SUBTITLE,
  ADD_MUSIC_SWIPE_DISMISS_DP,
  ADD_MUSIC_TITLE,
  MIN_PILL_ON_CONTRAST,
  addMusicHasRetailerBranding,
  addMusicPalette,
  addMusicRowsReachTheirRealFlows,
  addMusicSheetHasAllDismissals,
  addMusicSheetMatchesSpec,
  addMusicSheetMountsEveryRow,
  addMusicSheetUsesThemeRolesOnly,
  addMusicSurfaceContracts,
  addMusicSwipeThresholdIsPinned,
  libraryHasOneAddEntryPoint,
  libraryHasScatteredAddAffordances,
  libraryHeaderHasOneAddButton,
  paletteIsTokensOnly,
  pillOnIsLegible,
  tabNavigatorHasNoLibraryHeaderWiring,
} from '../src/services/addMusicSheet';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ FAILED: ${label}`);
  }
}
function assertEq(actual: unknown, expected: unknown, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, ok ? label : `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let at = 0; at < 6; at += 1) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

const ROOT = repoRoot();
function read(relative: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const library = read('src/screens/LibraryScreen.tsx');
const header = read('src/components/LibraryHeaderActions.tsx');
const sheet = read('src/components/AddMusicSheet.tsx');
const tab = read('src/navigation/TabNavigator.tsx');
/** The service that DECLARES the constants — read so the guard sees their values. */
const service = read('src/services/addMusicSheet.ts');

/** The colours the app ALREADY ships — the only hexes this surface may resolve to. */
const SHIPPED_HEXES: string[] = Object.keys(DARK_THEME)
  .map((key) => (DARK_THEME as unknown as Record<string, string>)[key])
  .concat(
    Object.keys(LIGHT_THEME).map(
      (key) => (LIGHT_THEME as unknown as Record<string, string>)[key]
    )
  )
  .map((value) => value.toLowerCase())
  .concat([TAKE_STAFF_PAPER.toLowerCase()]);

// ═════════════════════════ §2 · the copy and the model ═════════════════════════

console.log('\n§2 COPY — the sheet says what the spec says, and nothing it cannot back');

assertEq(ADD_MUSIC_TITLE, 'Add music', 'title is "Add music"');
assertEq(ADD_MUSIC_SUBTITLE, 'Three ways to bring music in', 'subtitle is the spec line');
assertEq(ADD_MUSIC_CANCEL, 'Cancel', 'the Cancel row is present');
assertEq(ADD_MUSIC_BUTTON_LABEL, 'Add music', 'the header button is labelled "Add music"');
assertEq(ADD_MUSIC_SCRIM, 'rgba(6, 8, 16, 0.51)', 'the scrim is the spec value (51% over both themes)');

assertEq(ADD_MUSIC_ROWS.length, 3, 'there are exactly THREE rows (equal weight)');
assertEq(
  ADD_MUSIC_ROWS.map((row) => row.id),
  ['scan', 'upload', 'browse'],
  'the rows are Scan Live Score, Upload File, Browse Online Library',
);
assertEq(
  ADD_MUSIC_ROWS.map((row) => row.label),
  ['Scan Live Score', 'Upload File', 'Browse Online Library'],
  'the three labels are the spec copy, verbatim',
);
assertEq(
  ADD_MUSIC_ROWS.map((row) => row.subtitle),
  ['Point the camera at printed music', 'PDF · MusicXML · MIDI', 'Public-domain scores, free to play'],
  'the three subtitles are the spec copy, verbatim',
);
assertEq(
  ADD_MUSIC_ROWS.map((row) => row.flow),
  ['ScanScore', 'document-picker-import', 'FindPiece'],
  'each row names the EXISTING flow it opens',
);
assert(
  ADD_MUSIC_ROWS.every((row) => row.icon.length > 0),
  'every row carries a glyph (camera · document · magnifier)',
);
assertEq(
  ADD_MUSIC_ROWS.map((row) => row.icon),
  ['camera-outline', 'document-text-outline', 'search-outline'],
  'the glyphs are camera, document, magnifier',
);

// The copy itself must never carry retailer branding (spec: none on this surface).
const copyText = [ADD_MUSIC_TITLE, ADD_MUSIC_SUBTITLE, ...ADD_MUSIC_ROWS.flatMap((row) => [row.label, row.subtitle])]
  .join(' ')
  .toLowerCase();
assert(
  ADD_MUSIC_RETAILER_WORDS.every((word) => copyText.indexOf(word) < 0),
  'no retailer word appears in the sheet copy',
);

// ═══════════════════════ §2 · theme roles, no new colours ══════════════════════

console.log('\n§2 THEME — every colour is a role the app already ships');

const PALETTES: [string, ThemeTokens][] = [
  ['dark', DARK_THEME],
  ['light', LIGHT_THEME],
];
for (const [mode, tokens] of PALETTES) {
  const palette = addMusicPalette(tokens);
  const values = ADD_MUSIC_ROLES.map((role) => palette[role]);
  assert(
    values.every((value) => SHIPPED_HEXES.indexOf(String(value).toLowerCase()) >= 0),
    `${mode}: all ${ADD_MUSIC_ROLES.length} roles resolve to a colour the app already ships`,
  );
  assertEq(paletteIsTokensOnly(tokens), true, `${mode}: the role map adds no new colour`);
  assertEq(pillOnIsLegible(palette), true, `${mode}: the + is legible on the filled circle`);
  const pill = contrastRatio(palette.PILL_ON, palette.HUM);
  assert(
    pill !== null && pill >= MIN_PILL_ON_CONTRAST,
    `${mode}: PILL_ON on HUM measures ${pill === null ? 'n/a' : pill.toFixed(2)}:1 (min ${MIN_PILL_ON_CONTRAST})`,
  );
  const text = contrastRatio(palette.TXT, palette.SHEET);
  assert(
    text !== null && text >= 4.5,
    `${mode}: TXT on SHEET measures ${text === null ? 'n/a' : text.toFixed(2)}:1 (min 4.5)`,
  );
  const sub = contrastRatio(palette.SUB, palette.SHEET);
  assert(
    sub !== null && sub >= 3,
    `${mode}: SUB on SHEET measures ${sub === null ? 'n/a' : sub.toFixed(2)}:1 (min 3, 12 dp)`,
  );
  const line = contrastRatio(palette.LINE2, palette.SHEET);
  assert(
    line !== null && line >= 1.05,
    `${mode}: the grabber (LINE2) is visible on SHEET at ${line === null ? 'n/a' : line.toFixed(2)}:1`,
  );
  assertEq(palette.SHEET, palette.CARD, `${mode}: the sheet is the app's CARD surface`);
  assertEq(palette.PILL_ON, TAKE_STAFF_PAPER, `${mode}: the + is drawn in the app's paper white`);
}

// ═══════════════════ §2 · the real screens (source-scan guards) ════════════════

console.log('\n§2 THE ONE + — the Library header, 44 dp, HUM, beside the cog');

assert(header.length > 800, `the header wiring was read (${header.length} chars)`);
assertEq(libraryHeaderHasOneAddButton(header), true, 'the header has exactly ONE + button, built to spec');
assertEq(countTag(maskSourceComments(header), 'name="add"'), 1, 'there is exactly one add glyph in the header');
assertEq(
  styleValue(header, 'addButton', 'width'),
  String(ADD_MUSIC_SPEC.addButtonDp),
  'the + is a 44 dp circle',
);
assertEq(styleValue(header, 'addButton', 'borderRadius'), '22', 'the + is a circle (r22 on 44 dp)');
assertEq(
  styleValue(header, 'addButton', 'marginRight'),
  String(ADD_MUSIC_SPEC.addButtonGapDp),
  'the + sits 4 dp from the cog — 48 dp left of it',
);
assert(
  maskSourceComments(header).indexOf('color={palette.PILL_ON}') >= 0,
  'the + glyph is drawn in PILL_ON',
);
assert(
  maskSourceComments(header).indexOf('backgroundColourUnused') < 0 &&
    maskSourceComments(header).indexOf('backgroundColor: palette.HUM') >= 0,
  'the + is a FILLED HUM circle',
);
// The Cloud Sync glyph that was already in this header is not lost to the new one.
assert(
  maskSourceComments(header).indexOf("navigate('CloudSync')") >= 0,
  'the Cloud Sync entry that already lived in this header survives',
);

console.log('\n§2 ONE ENTRY POINT — the scattered Import/Scan buttons are gone');

assertEq(library.length > 4000, true, `the Library source was read (${library.length} chars)`);
assertEq(
  libraryHasScatteredAddAffordances(library),
  false,
  'no actionsRow / "Import file" / "Scan score" / FAB remains in the Library',
);
assertEq(maskSourceComments(library).indexOf('Import file'), -1, 'the "Import file" button is gone');
assertEq(maskSourceComments(library).indexOf('Scan score'), -1, 'the "Scan score" button is gone');
assertEq(maskSourceComments(library).indexOf('actionsRow'), -1, 'the two-button row is gone from the style sheet');
assertEq(libraryHasOneAddEntryPoint(library, header), true, 'the Library has ONE add entry point, in its header');
assert(
  maskSourceComments(library).indexOf('<LibraryHeaderActions onOpenAddMusic={openAddMusic} />') >= 0,
  'the Library owns its header and hands the + its open handler',
);
assert(
  maskSourceComments(library).indexOf('headerRight') >= 0,
  'the Library wires headerRight itself',
);

assertEq(countTag(maskSourceComments(library), 'name="add"'), 0, 'the list itself renders no add glyph (no FAB)');

console.log('\n§2 THREE ROWS WIRED — each one opens a flow that already exists');

assertEq(sheet.length > 3000, true, `the sheet source was read (${sheet.length} chars)`);
assertEq(addMusicSheetMountsEveryRow(library), true, 'the sheet is mounted with all three rows wired');
assert(
  maskSourceComments(library).indexOf('onScanLiveScore={handleAddMusicScan}') >= 0,
  'row 1 is wired to the scan handler',
);
assert(
  maskSourceComments(library).indexOf('onUploadFile={handleAddMusicUpload}') >= 0,
  'row 2 is wired to the upload handler',
);
assert(
  maskSourceComments(library).indexOf('onBrowseOnlineLibrary={handleAddMusicBrowse}') >= 0,
  'row 3 is wired to the browse handler',
);
assertEq(addMusicRowsReachTheirRealFlows(library), true, 'the three rows reach the scan, import and search flows');
assert(
  maskSourceComments(library).indexOf("navigation.navigate('ScanScore')") >= 0,
  'row 1 reaches the EXISTING camera/scan screen',
);
assert(
  maskSourceComments(library).indexOf('DocumentPicker.getDocumentAsync(') >= 0 &&
    maskSourceComments(library).indexOf('importDocumentAsset(') >= 0,
  'row 2 reaches the EXISTING DocumentPicker import (the importer the old button used)',
);
assert(
  maskSourceComments(library).indexOf('<FindPieceScreen') >= 0,
  'row 3 reaches the EXISTING catalog search (FindPieceScreen, browse state)',
);
assert(
  maskSourceComments(sheet).indexOf('ADD_MUSIC_ROWS.map(') >= 0,
  'the rows are rendered from the ONE list (equal weight — none hand-built louder)',
);

console.log('\n§2 DISMISSALS — grabber swipe, scrim tap and Cancel all exist; no ✕');

assertEq(addMusicSheetHasAllDismissals(sheet), true, 'all three dismissals are present in the sheet');
assert(
  maskSourceComments(sheet).indexOf('PanResponder.create(') >= 0 &&
    maskSourceComments(sheet).indexOf('ADD_MUSIC_SWIPE_DISMISS_DP') >= 0,
  'the grabber swipe dismisses past a real threshold',
);
assert(
  maskSourceComments(sheet).indexOf('ADD_MUSIC_SCRIM') >= 0,
  'the scrim is the spec dim (and it is imported, never re-typed)',
);
assert(
  maskSourceComments(sheet).indexOf('{ADD_MUSIC_CANCEL}') >= 0,
  'the Cancel row is rendered unconditionally',
);
assert(
  maskSourceComments(sheet).indexOf('name="close"') < 0,
  'there is no close ✕ on the sheet',
);

console.log('\n§2 GEOMETRY — the spec numbers, read out of the sheet StyleSheet');

assertEq(addMusicSheetMatchesSpec(sheet), true, 'the sheet matches spec §2 geometry');
assertEq(styleValue(sheet, 'sheet', 'borderTopLeftRadius'), '28', 'the sheet has a 28 dp top radius');
assertEq(styleValue(sheet, 'grabber', 'width'), '40', 'the grabber is 40 dp wide');
assertEq(styleValue(sheet, 'grabber', 'height'), '4', 'the grabber is 4 dp tall');
assertEq(styleValue(sheet, 'row', 'minHeight'), '76', 'each row is 76 dp (well over the 48 dp target)');
assertEq(styleValue(sheet, 'rowTile', 'width'), '40', 'the row tile is 40 dp');
assertEq(styleValue(sheet, 'rowTile', 'borderRadius'), '12', 'the row tile is r12');
assertEq(styleValue(sheet, 'rowTile', 'backgroundColor') === null ? 'palette' : 'literal', 'palette', 'the tile fill is a role, not a literal');
assertEq(styleValue(sheet, 'row', 'paddingLeft'), '20', 'the tile starts at x20');
assertEq(styleValue(sheet, 'rowBody', 'marginLeft'), '12', 'the label column starts at x72 (20 + 40 + 12)');
assertEq(styleValue(sheet, 'rowLabel', 'fontSize'), '16', 'the row label is 16 dp');
assertEq(styleValue(sheet, 'rowSub', 'fontSize'), '12', 'the row subtitle is 12 dp');
assertEq(styleValue(sheet, 'sheetTitle', 'fontSize'), '18', 'the sheet title is 18 dp');
assertEq(styleValue(sheet, 'sheetSubtitle', 'fontSize'), '12', 'the sheet subtitle is 12 dp');
assertEq(styleValue(sheet, 'cancelRow', 'minHeight'), '48', 'the Cancel row is a 48 dp target');
assertEq(styleValue(sheet, 'cancelText', 'fontSize'), '15', 'the Cancel label is 15 dp');
assertEq(ADD_MUSIC_SWIPE_DISMISS_DP > 0, true, 'the swipe threshold is a real number');
// The threshold's VALUE is pinned, not just its name: identifier presence alone stayed
// green while 48 → 24 silently turned a decisive swipe into a nudge.
assertEq(ADD_MUSIC_SWIPE_DISMISS_DP, 48, 'the shipped swipe threshold is 48 dp');
assertEq(
  addMusicSwipeThresholdIsPinned(service),
  true,
  'the swipe threshold is pinned to its VALUE in the service source (48 dp)',
);

console.log('\n§2 NO NEW COLOURS, NO BRANDING — on the sheet itself');

assertEq(addMusicSheetUsesThemeRolesOnly(sheet), true, 'the sheet carries no hex and no inline rgb()');
assert(/palette\.SOFTFILL/.test(maskSourceComments(sheet)), 'the row tiles are SOFTFILL');
assert(/palette\.HUM/.test(maskSourceComments(sheet)), 'the tile glyph and Cancel are HUM');
assertEq(addMusicHasRetailerBranding(sheet, library), false, 'no retailer branding on this surface');

console.log('\n§2 ONE OWNER — the navigator no longer wires a Library header');

assertEq(tabNavigatorHasNoLibraryHeaderWiring(tab), true, 'TabNavigator wires no Library headerRight (no second +)');
assert(
  maskSourceComments(tab).indexOf('LibraryHeaderButton') < 0,
  'the old header button component is gone from the navigator',
);

const contracts = addMusicSurfaceContracts({
  librarySource: library,
  headerSource: header,
  sheetSource: sheet,
  tabSource: tab,
});
assertEq(
  contracts,
  {
    oneHeaderButton: true,
    oneEntryPoint: true,
    sheetMounted: true,
    rowsWired: true,
    dismissals: true,
    geometry: true,
    themeOnly: true,
    noBranding: true,
    tabClean: true,
  },
  'the whole §2 contract passes on the shipped sources',
);

// ══════════════════ §2 · BITE PROOF 1: the pre-fix Library ═════════════════════

console.log('\nBITE PROOF — the pre-fix Library IS detected (this is why the fix exists)');

/** The two scattered buttons, exactly as the pre-fix screen rendered them. */
const PRE_FIX_ACTIONS_ROW = `
      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [styles.actionButton, styles.actionButtonPrimary, pressed && styles.rowPressed]}
          onPress={handleImport}
          disabled={busy}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.actionButtonTextPrimary}>Import file</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionButton, styles.actionButtonSecondary, pressed && styles.rowPressed]}
          onPress={() => navigation.navigate('ScanScore')}
          disabled={busy}
        >
          <Ionicons name="camera" size={18} color={theme.accent} />
          <Text style={styles.actionButtonTextSecondary}>Scan score</Text>
        </Pressable>
      </View>
`;
const preFixLibrary = library.replace('<View style={styles.container}>', `<View style={styles.container}>${PRE_FIX_ACTIONS_ROW}`);
assert(preFixLibrary !== library, 'the pre-fix screen was reconstructed from the real source');
assertEq(libraryHasScatteredAddAffordances(preFixLibrary), true, 'the pre-fix screen IS flagged as scattered');
assertEq(
  libraryHasOneAddEntryPoint(preFixLibrary, header),
  false,
  'the pre-fix screen FAILS the one-entry-point contract',
);

// ══════════════════ §2 · BITE PROOF 2: mutations of the real files ═════════════

console.log('\nMUTATIONS — every guard fails when the defect it names is restored');

function bite(label: string, mutated: string, original: string, predicate: (source: string) => boolean): void {
  assert(mutated !== original, `the mutation "${label}" changed the real source`);
  assertEq(predicate(mutated), false, `MUTATION: ${label} FAILS its guard`);
}

// The Library: a dropped row, three dropped wirings, and the scattered buttons back.
bite(
  'row 1 (Scan Live Score) is unwired',
  library.replace('onScanLiveScore={handleAddMusicScan}', 'onScanLiveScore={() => undefined}'),
  library,
  addMusicSheetMountsEveryRow,
);
bite(
  'row 2 (Upload File) is unwired',
  library.replace('onUploadFile={handleAddMusicUpload}', 'onUploadFile={() => undefined}'),
  library,
  addMusicSheetMountsEveryRow,
);
bite(
  'row 3 (Browse Online Library) is unwired',
  library.replace('onBrowseOnlineLibrary={handleAddMusicBrowse}', 'onBrowseOnlineLibrary={() => undefined}'),
  library,
  addMusicSheetMountsEveryRow,
);
bite(
  'the scan row stops reaching the camera/scan screen',
  library.replace("navigation.navigate('ScanScore')", 'undefined'),
  library,
  addMusicRowsReachTheirRealFlows,
);
bite(
  'the upload row stops running the existing import',
  library.replace('    handleImport();', ''),
  library,
  addMusicRowsReachTheirRealFlows,
);
bite(
  'the browse row stops opening the catalog search',
  library.replace('<FindPieceScreen', '<View'),
  library,
  addMusicRowsReachTheirRealFlows,
);
bite(
  'a scattered Import/Scan button returns',
  preFixLibrary,
  library,
  (source) => libraryHasOneAddEntryPoint(source, header),
);

// The header: a second +, or the + removed altogether.
bite(
  'a SECOND + is added to the header',
  header.replace(
    '<View style={styles.headerActions}>',
    '<View style={styles.headerActions}><Ionicons name="add" size={18} color="red" />',
  ),
  header,
  libraryHeaderHasOneAddButton,
);
bite(
  'the + button is dropped from the header',
  header.replace('name="add"', 'name="add-circle"'),
  header,
  libraryHeaderHasOneAddButton,
);
bite(
  'the Cloud Sync entry is dropped from the header',
  header.replace("navigate('CloudSync')", "navigate('Metronome')"),
  header,
  libraryHeaderHasOneAddButton,
);

// The sheet: each dismissal removed in turn, then the spec broken three ways.
/** Replace the Nth (1-based, from the end) occurrence of `needle`. */
function replaceLast(source: string, needle: string, replacement: string): string {
  const at = source.lastIndexOf(needle);
  if (at < 0) return source;
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}
/** Replace the FIRST occurrence of `needle`. */
function replaceFirst(source: string, needle: string, replacement: string): string {
  const at = source.indexOf(needle);
  if (at < 0) return source;
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

bite(
  'the Cancel row stops dismissing',
  replaceLast(sheet, 'onPress={onClose}', 'onPress={() => undefined}'),
  sheet,
  addMusicSheetHasAllDismissals,
);
bite(
  'the scrim stops dismissing',
  replaceFirst(sheet, 'onPress={onClose}', 'onPress={() => undefined}'),
  sheet,
  addMusicSheetHasAllDismissals,
);
bite(
  'the grabber swipe is removed',
  sheet.replace('PanResponder.create(', '({}) as never || (('),
  sheet,
  addMusicSheetHasAllDismissals,
);
bite(
  'the swipe threshold is removed',
  replaceLast(sheet, 'ADD_MUSIC_SWIPE_DISMISS_DP', '0'),
  sheet,
  addMusicSheetHasAllDismissals,
);

// The SERVICE: the threshold's VALUE, not just its name. Identifier-presence guards stay
// green on all three of these — this is the gap the value pin closes.
const SWIPE_DECL = 'export const ADD_MUSIC_SWIPE_DISMISS_DP = 48;';
bite(
  'the swipe threshold silently drops from 48 dp to 24 dp',
  service.replace(SWIPE_DECL, 'export const ADD_MUSIC_SWIPE_DISMISS_DP = 24;'),
  service,
  addMusicSwipeThresholdIsPinned,
);
bite(
  'the swipe threshold is raised to 96 dp',
  service.replace(SWIPE_DECL, 'export const ADD_MUSIC_SWIPE_DISMISS_DP = 96;'),
  service,
  addMusicSwipeThresholdIsPinned,
);
bite(
  'the swipe threshold stops being a literal number',
  service.replace(SWIPE_DECL, 'export const ADD_MUSIC_SWIPE_DISMISS_DP = 24 * 2;'),
  service,
  addMusicSwipeThresholdIsPinned,
);
bite(
  'a retailer name appears on the sheet',
  sheet.replace('{ADD_MUSIC_CANCEL}', '{ADD_MUSIC_CANCEL}{"Musicnotes"}'),
  sheet,
  (source) => !addMusicHasRetailerBranding(source),
);
bite(
  'a hard-coded colour replaces a theme role',
  sheet.replace('backgroundColor: palette.SHEET', "backgroundColor: '#1a1a2e'"),
  sheet,
  addMusicSheetUsesThemeRolesOnly,
);
bite(
  'a row is shrunk below the spec height',
  sheet.replace('minHeight: 76', 'minHeight: 56'),
  sheet,
  addMusicSheetMatchesSpec,
);
bite(
  'the tile loses its r12 radius',
  sheet.replace('borderRadius: 12', 'borderRadius: 8'),
  sheet,
  addMusicSheetMatchesSpec,
);

// The navigator: a second header for the Library tab.
bite(
  'the navigator wires a Library header again',
  tab.replace(
    "          title: 'Library',",
    "          title: 'Library',\n          headerRight: () => null,",
  ),
  tab,
  tabNavigatorHasNoLibraryHeaderWiring,
);

// ═══════════════════════════════ SUMMARY ════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
