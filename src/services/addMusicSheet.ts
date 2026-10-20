/**
 * addMusicSheet.ts — DESIGNER SPEC §2, THE "+ ADD MUSIC" SHEET (v43 slice 1).
 *
 * THE SPEC (ux-design-v41/spec.md §2, frame `02-library-add-music-sheet.png`): the
 * Library grows ONE 44 dp filled circle in its header — 48 dp left of the cog, `+`
 * glyph in PILL_ON at 18 dp — and that one button opens a modal bottom sheet with
 * THREE equal-weight rows. It REPLACES every scattered add/import affordance: never
 * a second `+`, never a FAB over the tab bar. The app cannot know whether the user
 * holds paper, a file or a title, so the three rows are the same size and the same
 * style, and each one opens a flow the app ALREADY has:
 *
 *   1. Scan Live Score      → the camera/scan flow (ScanScore stack screen)
 *   2. Upload File          → the Library's existing DocumentPicker import
 *   3. Browse Online Library→ the existing catalog search (FindPieceScreen, browse state)
 *
 * DISMISSAL is three-way on purpose (spec: "All three exist"): the grabber swipe,
 * the scrim tap and the Cancel row. There is no close ✕.
 *
 * WHAT THIS MODULE OWNS
 *   • the verbatim copy of the sheet (spec text, no claim the app cannot back),
 *   • the geometry constants the spec prints in dp,
 *   • the ROLE MAPPING from the app's existing theme tokens (services/theme.ts) to
 *     the spec's role names (CARD, LINE, CARD_LINE, SUB, TXT, HUM, LISTEN, SOFTFILL,
 *     PAPER, PILL_ON, SHEET, LINE2) — so the surface introduces NO new colour, and
 *   • the SOURCE-SCAN CONTRACT: pure detectors that read the real screens
 *     (LibraryScreen, LibraryHeaderActions, AddMusicSheet, TabNavigator) and answer
 *     "is the spec built, and is it the ONE entry point?" TRUE/FALSE. Each bad
 *     detector returns TRUE on the pre-fix code, which is what makes the guard bite
 *     (scripts/uxr-v43-add-music.test.ts).
 *
 * PURE: no react, no react-native, no fs. Every function takes text or tokens.
 */
import { contrastRatio } from './inkContrast';
import { TAKE_STAFF_PAPER } from './takeStaffPalette';
import { countTag, styleValue } from './uxrV41Contract';
import { maskSourceComments } from './audioFocusContract';
import type { ThemeTokens } from './theme';

// ───────────────────────────── copy (spec §2, verbatim) ──────────────────────

/** The header button's accessibility label — and the sheet's own title. */
export const ADD_MUSIC_BUTTON_LABEL = 'Add music';
export const ADD_MUSIC_TITLE = 'Add music';
export const ADD_MUSIC_SUBTITLE = 'Three ways to bring music in';
export const ADD_MUSIC_CANCEL = 'Cancel';
/** The scrim, exactly as the spec prints it (a dim over BOTH themes). */
export const ADD_MUSIC_SCRIM = 'rgba(6, 8, 16, 0.51)';
/** How far the grabber must travel down before the sheet counts as dismissed. */
export const ADD_MUSIC_SWIPE_DISMISS_DP = 48;
/** A downward fling this fast dismisses even on a short drag. */
export const ADD_MUSIC_SWIPE_VELOCITY = 0.6;

/**
 * A `+` glyph on a filled HUM circle is a LARGE, bold mark (18 dp), so the WCAG AA
 * floor for large text / graphical objects applies to it — 3:1, not the 4.5:1 that
 * inkContrast's MIN_LEGIBLE_CONTRAST holds body text to.
 */
export const MIN_PILL_ON_CONTRAST = 3;

// ─────────────────────────── geometry (spec §2, in dp) ──────────────────────

export const ADD_MUSIC_SPEC = {
  /** The one header button: a 44 dp filled circle, 18 dp `+`. */
  addButtonDp: 44,
  addGlyphDp: 18,
  /** The gap that puts the + 48 dp left of the cog (44 dp circle + 4 dp). */
  addButtonGapDp: 4,
  /** The sheet: full width, top radius 28. */
  sheetRadius: 28,
  /** The grabber: 40 × 4, 12 dp from the sheet's top edge. */
  grabberWidthDp: 40,
  grabberHeightDp: 4,
  grabberTopDp: 12,
  /** Header: "Add music" 18 dp @+30 · subtitle 12 dp @+54. */
  titleSize: 18,
  titleTopDp: 30,
  subtitleSize: 12,
  subtitleTopDp: 54,
  /** Rows start at +102; each is 76 dp. */
  rowsTopDp: 102,
  rowHeightDp: 76,
  /** Row anatomy: 40 dp SOFTFILL tile (r12) at x20 · label 16 dp at x72. */
  tileDp: 40,
  tileRadius: 12,
  tileInsetDp: 20,
  labelInsetDp: 72,
  labelSize: 16,
  rowSubSize: 12,
  rowSubTopDp: 38,
  /** Trailing chevron centre x364 · hairlines x88→370. */
  chevronInsetDp: 364,
  chevronSize: 18,
  hairlineInsetDp: 88,
  /** Cancel: centred 15 dp bold HUM on a 48 dp target. */
  cancelSize: 15,
  cancelTargetDp: 48,
} as const;

// ──────────────────── the theme roles this surface may use ───────────────────

/**
 * THE SPEC'S ROLE NAMES — the only colours §2 is allowed to mention. `SHEET` and
 * `LINE2` are the two the spec adds for the sheet itself; both are roles, not
 * colours, and both resolve from the app's existing palette below.
 */
export type AddMusicRole =
  | 'CARD'
  | 'LINE'
  | 'CARD_LINE'
  | 'SUB'
  | 'TXT'
  | 'HUM'
  | 'LISTEN'
  | 'SOFTFILL'
  | 'PAPER'
  | 'PILL_ON'
  | 'SHEET'
  | 'LINE2';

export const ADD_MUSIC_ROLES: readonly AddMusicRole[] = [
  'CARD',
  'LINE',
  'CARD_LINE',
  'SUB',
  'TXT',
  'HUM',
  'LISTEN',
  'SOFTFILL',
  'PAPER',
  'PILL_ON',
  'SHEET',
  'LINE2',
];

export type AddMusicPalette = Record<AddMusicRole, string>;

/**
 * THE ROLE MAP: every role resolves to a colour the app ALREADY ships
 * (services/theme.ts), so the sheet introduces none of its own.
 *   CARD / SHEET → surface    LINE / CARD_LINE / LINE2 → border
 *   SUB → subtext             TXT → text               HUM → accent
 *   LISTEN → positive         SOFTFILL → chipBg        PAPER → paper white
 *   PILL_ON → the paper-white ink that reads on a filled HUM circle (the `+` glyph
 *   and nothing else) — the same white the take's staff is drawn on.
 */
export function addMusicPalette(tokens: ThemeTokens): AddMusicPalette {
  return {
    CARD: tokens.surface,
    LINE: tokens.border,
    CARD_LINE: tokens.border,
    SUB: tokens.subtext,
    TXT: tokens.text,
    HUM: tokens.accent,
    LISTEN: tokens.positive,
    SOFTFILL: tokens.chipBg,
    PAPER: TAKE_STAFF_PAPER,
    PILL_ON: TAKE_STAFF_PAPER,
    SHEET: tokens.surface,
    LINE2: tokens.border,
  };
}

/** The `+` on the filled circle, judged rather than assumed (≥ 3:1 on HUM). */
export function pillOnIsLegible(palette: AddMusicPalette): boolean {
  const ratio = contrastRatio(palette.PILL_ON, palette.HUM);
  return ratio !== null && ratio >= MIN_PILL_ON_CONTRAST;
}

/** True when every role resolves to a colour the app's palette already contains. */
export function paletteIsTokensOnly(tokens: ThemeTokens): boolean {
  const existing = Object.keys(tokens).map(
    (key) => (tokens as unknown as Record<string, string>)[key]
  );
  const palette = addMusicPalette(tokens);
  return ADD_MUSIC_ROLES.every((role) => existing.indexOf(palette[role]) >= 0);
}

// ──────────────────────────────── the three rows ─────────────────────────────

export type AddMusicRowId = 'scan' | 'upload' | 'browse';

export interface AddMusicRowSpec {
  id: AddMusicRowId;
  /** 16 dp bold label, verbatim from the spec. */
  label: string;
  /** 12 dp SUB subtitle — the spec's own copy (it says what the row takes). */
  subtitle: string;
  /** The glyph in the row's 40 dp tile. */
  icon: 'camera-outline' | 'document-text-outline' | 'search-outline';
  /** The EXISTING flow this row opens. Named so the wiring guard can check it. */
  flow: 'ScanScore' | 'document-picker-import' | 'FindPiece';
}

export const ADD_MUSIC_ROWS: readonly AddMusicRowSpec[] = [
  {
    id: 'scan',
    label: 'Scan Live Score',
    subtitle: 'Point the camera at printed music',
    icon: 'camera-outline',
    flow: 'ScanScore',
  },
  {
    id: 'upload',
    label: 'Upload File',
    subtitle: 'PDF · MusicXML · MIDI',
    icon: 'document-text-outline',
    flow: 'document-picker-import',
  },
  {
    id: 'browse',
    label: 'Browse Online Library',
    subtitle: 'Public-domain scores, free to play',
    icon: 'search-outline',
    flow: 'FindPiece',
  },
];

// ─────────────────────── retailer branding (forbidden here) ──────────────────

/**
 * THE SPEC: "No retailer branding on this surface." The sheet is about getting
 * music IN; a retailer name on it would turn a neutral entry point into an ad. Any
 * of these strings appearing in the sheet or its mount is the defect.
 */
export const ADD_MUSIC_RETAILER_WORDS: readonly string[] = [
  'sheet music direct',
  'musicnotes',
  'sheetmusicdirect',
  'smd',
  'affiliate',
  'official sheet music',
  '?tid=',
  '&tid=',
  'buy now',
];

/** TRUE when the sheet (or its mount) carries retailer branding — the defect. */
export function addMusicHasRetailerBranding(sheetSource: string, librarySource = ''): boolean {
  const text = `${maskSourceComments(sheetSource)}\n${maskSourceComments(librarySource)}`.toLowerCase();
  return ADD_MUSIC_RETAILER_WORDS.some((word) => text.indexOf(word) >= 0);
}

// ──────────────────────────── source-scan detectors ──────────────────────────

/** A window of `size` characters starting at `needle` ('' when absent). */
function windowAfter(source: string, needle: string, size = 900): string {
  const at = source.indexOf(needle);
  if (at < 0) return '';
  return source.slice(at, at + size);
}

/** TRUE when `styleName`'s block sets `prop` to exactly `value`. */
function styleIs(source: string, styleName: string, prop: string, value: number | string): boolean {
  return styleValue(source, styleName, prop) === String(value);
}

/**
 * THE HEADER BUTTON (spec: "One 44 dp filled HUM circle … `+` glyph PILL_ON 18 dp,
 * 48 dp left of the cog"). Exactly ONE add glyph in the Library header wiring, a
 * filled 44 dp circle in HUM, an 18 dp + in PILL_ON, and the Cloud Sync glyph that
 * already lived in this header still there (the item menu tells users to tap it).
 */
export function libraryHeaderHasOneAddButton(headerSource: string): boolean {
  const text = maskSourceComments(headerSource);
  if (text.length < 400) return false;
  // EXACTLY ONE add glyph. A second `+` anywhere in the header is the defect.
  if (countTag(text, 'name="add"') !== 1) return false;
  // The button's own JSX: the props sit around the style reference, so read a
  // window on BOTH sides of `styles.addButton` (onPress can precede the style).
  const buttonAt = text.indexOf('styles.addButton');
  if (buttonAt < 0) return false;
  const buttonWindow = text.slice(Math.max(0, buttonAt - 500), buttonAt + 700);
  if (buttonWindow.indexOf('onPress={onOpenAddMusic}') < 0) return false;
  if (buttonWindow.indexOf('accessibilityLabel={ADD_MUSIC_BUTTON_LABEL}') < 0) return false;
  if (buttonWindow.indexOf('backgroundColor: palette.HUM') < 0) return false;
  if (windowAfter(text, 'name="add"', 200).indexOf('color={palette.PILL_ON}') < 0) return false;
  if (windowAfter(text, 'name="add"', 200).indexOf('ADD_MUSIC_SPEC.addGlyphDp') < 0) return false;
  // Geometry, read out of the StyleSheet.
  if (!styleIs(text, 'addButton', 'width', ADD_MUSIC_SPEC.addButtonDp)) return false;
  if (!styleIs(text, 'addButton', 'height', ADD_MUSIC_SPEC.addButtonDp)) return false;
  if (!styleIs(text, 'addButton', 'borderRadius', ADD_MUSIC_SPEC.addButtonDp / 2)) return false;
  if (!styleIs(text, 'addButton', 'marginRight', ADD_MUSIC_SPEC.addButtonGapDp)) return false;
  if (windowAfter(text, 'styles.addButton', 200).indexOf('backgroundColor: palette.HUM') < 0) {
    return false;
  }
  // The cloud glyph that was already in this header is NOT lost to the new button.
  if (text.indexOf('CloudSync') < 0) return false;
  if (text.indexOf('cloud-upload') < 0) return false;
  // No FAB, and no ✕ close button on this surface.
  if (/fab|floatingAction/i.test(text)) return false;
  return true;
}

/**
 * THE PRE-FIX LIBRARY: the two scattered buttons it shipped with — an "Import file"
 * primary and a "Scan score" secondary in an `actionsRow` above the list. TRUE on
 * the pre-fix screen; the reason this fix exists.
 */
export function libraryHasScatteredAddAffordances(librarySource: string): boolean {
  const text = maskSourceComments(librarySource);
  if (text.indexOf('actionsRow') >= 0) return true;
  if (text.indexOf('actionButton') >= 0) return true;
  if (text.indexOf('Import file') >= 0) return true;
  if (text.indexOf('Scan score') >= 0) return true;
  if (/\bfab\b|floatingAction/i.test(text)) return true;
  return false;
}

/**
 * ONE ENTRY POINT: no scattered add/import affordance survives in the Library, the
 * tab bar carries no FAB, and the Library's header wiring defines the single `+`
 * (LibraryScreen owns `headerRight` itself so the button and the sheet share one
 * owner — a second wiring of `headerRight` in the navigator would be a second `+`).
 */
export function libraryHasOneAddEntryPoint(librarySource: string, headerSource: string): boolean {
  if (libraryHasScatteredAddAffordances(librarySource)) return false;
  if (!libraryHeaderHasOneAddButton(headerSource)) return false;
  const text = maskSourceComments(librarySource);
  if (text.indexOf('headerRight') < 0) return false;
  if (text.indexOf('<LibraryHeaderActions onOpenAddMusic={openAddMusic} />') < 0) return false;
  // The `+` is not duplicated on the list itself: the screen renders no add glyph.
  if (countTag(text, 'name="add"') !== 0) return false;
  return true;
}

/** The navigator no longer wires the Library header (one owner: the screen). */
export function tabNavigatorHasNoLibraryHeaderWiring(tabSource: string): boolean {
  const text = maskSourceComments(tabSource);
  if (text.indexOf('headerRight') >= 0) return false;
  if (text.indexOf('LibraryHeaderButton') >= 0) return false;
  return true;
}

/**
 * THE SHEET IS MOUNTED WITH EVERY ROW WIRED. Each of the three rows is handed the
 * named handler that opens a flow the app already has — not an inline no-op.
 */
export function addMusicSheetMountsEveryRow(librarySource: string): boolean {
  const text = maskSourceComments(librarySource);
  if (text.indexOf('<AddMusicSheet') < 0) return false;
  if (text.indexOf('visible={addMusicOpen}') < 0) return false;
  if (text.indexOf('onScanLiveScore={handleAddMusicScan}') < 0) return false;
  if (text.indexOf('onUploadFile={handleAddMusicUpload}') < 0) return false;
  if (text.indexOf('onBrowseOnlineLibrary={handleAddMusicBrowse}') < 0) return false;
  if (text.indexOf('onClose={closeAddMusic}') < 0) return false;
  return true;
}

/**
 * EACH ROW REACHES ITS REAL FLOW (the point of the sheet — three routes that exist,
 * not three buttons that promise):
 *   • Scan Live Score → `navigation.navigate('ScanScore')` (the camera/scan screen)
 *   • Upload File     → the Library's existing `handleImport` (DocumentPicker →
 *                       `importDocumentAsset`), the importer the scattered button used
 *   • Browse Online   → the existing catalog search, `FindPieceScreen` (the app's
 *                       one search surface, mounted in place like Home/ScanScore do)
 */
export function addMusicRowsReachTheirRealFlows(librarySource: string): boolean {
  const text = maskSourceComments(librarySource);
  const scan = windowAfter(text, 'const handleAddMusicScan', 500);
  if (scan.indexOf("navigation.navigate('ScanScore')") < 0) return false;
  const upload = windowAfter(text, 'const handleAddMusicUpload', 500);
  if (upload.indexOf('handleImport()') < 0) return false;
  const importer = windowAfter(text, 'const handleImport', 900);
  if (importer.indexOf('DocumentPicker.getDocumentAsync(') < 0) return false;
  if (importer.indexOf('importDocumentAsset(') < 0) return false;
  const browse = windowAfter(text, 'const handleAddMusicBrowse', 500);
  if (browse.indexOf('setShowLibrarySearch(true)') < 0) return false;
  const mount = text.indexOf('<FindPieceScreen');
  if (mount < 0) return false;
  if (text.slice(mount, mount + 300).indexOf('setShowLibrarySearch(false)') < 0) return false;
  return true;
}

/**
 * ALL THREE DISMISSALS EXIST (spec: grabber swipe, scrim tap, Cancel row — "no close
 * ✕"). Any one of them missing is a dismissal the user cannot find.
 */
export function addMusicSheetHasAllDismissals(sheetSource: string): boolean {
  const text = maskSourceComments(sheetSource);
  if (text.length < 800) return false;
  // 1. the grabber swipe
  if (text.indexOf('PanResponder.create(') < 0) return false;
  const release = windowAfter(text, 'onPanResponderRelease', 400);
  if (release.indexOf('onClose()') < 0) return false;
  if (release.indexOf('ADD_MUSIC_SWIPE_DISMISS_DP') < 0) return false;
  const grabber = windowAfter(text, 'styles.grabber', 200);
  if (grabber.indexOf('backgroundColor: palette.LINE2') < 0) return false;
  // 2. the scrim tap (it covers the header/search/list and blocks them)
  const scrim = windowAfter(text, 'styles.scrim', 300);
  if (scrim.length === 0 || scrim.indexOf('onPress={onClose}') < 0) return false;
  if (scrim.indexOf('ADD_MUSIC_SCRIM') < 0) return false;
  // 3. the Cancel row, always present, on a 48 dp target
  const cancel = windowAfter(text, 'styles.cancelRow', 400);
  if (cancel.indexOf('onPress={onClose}') < 0) return false;
  if (cancel.indexOf('{ADD_MUSIC_CANCEL}') < 0) return false;
  if (!styleIs(text, 'cancelRow', 'minHeight', ADD_MUSIC_SPEC.cancelTargetDp)) return false;
  // …and no ✕ anywhere on the sheet.
  if (/name="close"/.test(text)) return false;
  return true;
}

/**
 * THE SHEET IS BUILT TO THE SPEC'S NUMBERS: top radius 28, grabber 40 × 4, the three
 * 76 dp rows with a 40 dp r12 tile at x20, a 16 dp bold label at x72, a 12 dp SUB
 * subtitle, a trailing chevron, and the header type at 18 / 12 dp.
 */
export function addMusicSheetMatchesSpec(sheetSource: string): boolean {
  const text = maskSourceComments(sheetSource);
  const spec = ADD_MUSIC_SPEC;
  if (!styleIs(text, 'sheet', 'borderTopLeftRadius', spec.sheetRadius)) return false;
  if (!styleIs(text, 'sheet', 'borderTopRightRadius', spec.sheetRadius)) return false;
  if (!styleIs(text, 'grabber', 'width', spec.grabberWidthDp)) return false;
  if (!styleIs(text, 'grabber', 'height', spec.grabberHeightDp)) return false;
  if (!styleIs(text, 'row', 'minHeight', spec.rowHeightDp)) return false;
  if (!styleIs(text, 'rowTile', 'width', spec.tileDp)) return false;
  if (!styleIs(text, 'rowTile', 'height', spec.tileDp)) return false;
  if (!styleIs(text, 'rowTile', 'borderRadius', spec.tileRadius)) return false;
  if (!styleIs(text, 'row', 'paddingLeft', spec.tileInsetDp)) return false;
  if (!styleIs(text, 'rowBody', 'marginLeft', spec.labelInsetDp - spec.tileInsetDp - spec.tileDp)) {
    return false;
  }
  if (!styleIs(text, 'rowLabel', 'fontSize', spec.labelSize)) return false;
  if (!styleIs(text, 'rowSub', 'fontSize', spec.rowSubSize)) return false;
  if (!styleIs(text, 'sheetTitle', 'fontSize', spec.titleSize)) return false;
  if (!styleIs(text, 'sheetSubtitle', 'fontSize', spec.subtitleSize)) return false;
  if (!styleIs(text, 'cancelText', 'fontSize', spec.cancelSize)) return false;
  // The three rows are rendered from the ONE list (equal weight, no hand-built row).
  if (text.indexOf('ADD_MUSIC_ROWS.map(') < 0) return false;
  if (text.indexOf('{ADD_MUSIC_TITLE}') < 0) return false;
  if (text.indexOf('{ADD_MUSIC_SUBTITLE}') < 0) return false;
  return true;
}

/**
 * THEME TOKENS ONLY, NO NEW COLOURS: the sheet component carries no hex literal and
 * no inline `rgb()`/`rgba()` — every colour arrives through the role map — and it
 * reads the roles the spec names for this surface.
 */
export function addMusicSheetUsesThemeRolesOnly(sheetSource: string): boolean {
  const text = maskSourceComments(sheetSource);
  if (/#[0-9a-fA-F]{3,8}\b/.test(text)) return false;
  if (/rgba?\s*\(\s*[0-9]/.test(text)) return false;
  if (text.indexOf('addMusicPalette(') < 0) return false;
  const roles = ['SHEET', 'LINE2', 'LINE', 'SOFTFILL', 'HUM', 'SUB', 'TXT'];
  return roles.every((role) => text.indexOf(`palette.${role}`) >= 0);
}

/**
 * THE WHOLE CONTRACT in one predicate — the shape a reviewer can read: one `+` in
 * the header, one entry point in the Library, every row wired to a flow that exists,
 * three dismissals, the spec's geometry, theme roles only, no retailer branding.
 */
export function addMusicSurfaceContracts(opts: {
  librarySource: string;
  headerSource: string;
  sheetSource: string;
  tabSource: string;
}): {
  oneHeaderButton: boolean;
  oneEntryPoint: boolean;
  sheetMounted: boolean;
  rowsWired: boolean;
  dismissals: boolean;
  geometry: boolean;
  themeOnly: boolean;
  noBranding: boolean;
  tabClean: boolean;
} {
  return {
    oneHeaderButton: libraryHeaderHasOneAddButton(opts.headerSource),
    oneEntryPoint: libraryHasOneAddEntryPoint(opts.librarySource, opts.headerSource),
    sheetMounted: addMusicSheetMountsEveryRow(opts.librarySource),
    rowsWired: addMusicRowsReachTheirRealFlows(opts.librarySource),
    dismissals: addMusicSheetHasAllDismissals(opts.sheetSource),
    geometry: addMusicSheetMatchesSpec(opts.sheetSource),
    themeOnly: addMusicSheetUsesThemeRolesOnly(opts.sheetSource),
    noBranding: !addMusicHasRetailerBranding(opts.sheetSource, opts.librarySource),
    tabClean: tabNavigatorHasNoLibraryHeaderWiring(opts.tabSource),
  };
}
