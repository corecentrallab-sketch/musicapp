/**
 * uxr2ScanViewportContract.ts — LIVE-SOURCE GUARDS FOR THE SCAN SCREEN'S
 * EDGE-TO-EDGE RELAYOUT (UX Round 2 Step 1, owner green-lit 2026-10-18, item C).
 *
 * THE DEFECT. The owner opened Scan Score and the camera was a letterboxed sliver:
 * a full-width opaque footer panel, a thumbnail strip and a control row in a
 * column, with the panel allowed to grow — so the preview and the Undo/Done row
 * were pushed off the bottom edge, and the helper text sat over the picture. The
 * v40 attempt bounded the panel; the owner reported it STILL obscured the camera
 * and the controls, and green-lit a full redesign.
 *
 * THE PROPERTY THESE GUARDS PIN (the owner's three sentences):
 *   1. the preview fills the window — no letterbox, no opaque header/footer shell;
 *   2. the heavy bottom container is REPLACED by a semi-transparent floating pill
 *      carrying the shutter, the flash toggle, Undo and Done — and nothing else;
 *   3. no overlay sits on top of those controls: the pill is the LAST thing in the
 *      bottom stack, it is not inside a scroller, and every other floating layer
 *      (status chip, filmstrip, detail panel, error banner) is rendered ABOVE it;
 * and, because a relayout must not change behaviour:
 *   4. the capture flow, its enablement rules, the honest copy and the
 *      cover-scan-words → find-a-piece money path are byte-for-byte the ones the
 *      v39/v40 guards already pin.
 *
 * HOW IT READS. Comments are masked first (a commented-out layout is not a layout),
 * every guard has a length floor so an empty read fails instead of passing
 * vacuously, and each guard is shown to BITE against a mutated copy of the real
 * screen in `scripts/uxr2-scan-viewport.test.ts` — a guard that cannot go false is
 * worse than no guard, because it hides the bug on the owner's phone.
 *
 * PURE LOGIC: imports nothing native, so it compiles under tsconfig.tier1.json.
 */
import { maskComments } from './modalBackContract';
import { SCAN_TIP_SCRIM } from './scanViewport';
import { scanFindCopyClaimsNoNoteReading } from './v39FixContract';

// ───────────────────────────── the files this owns ───────────────────────────

export const UXR2_SCAN_SCREEN_PATH = 'src/screens/ScanScoreScreen.tsx';
export const UXR2_PURE_MODEL_PATH = 'src/services/scanViewport.ts';
export const UXR2_CONTRACT_PATH = 'src/services/uxr2ScanViewportContract.ts';
export const UXR2_SUITE_PATH = 'scripts/uxr2-scan-viewport.test.ts';
export const UXR2_TIER1_CONFIG_PATH = 'tsconfig.tier1.json';
export const UXR2_PACKAGE_PATH = 'package.json';

/** The modules and suites the gate must compile and run (this batch's additions). */
export const UXR2_TIER1_MODULES: readonly string[] = [
  UXR2_PURE_MODEL_PATH,
  UXR2_CONTRACT_PATH,
  UXR2_SUITE_PATH,
];
export const UXR2_TIER1_SUITES: readonly string[] = [UXR2_SUITE_PATH];

/**
 * Mount tokens are built by split/join so this contract file never contains a
 * JSX-shaped mount as contiguous text — the backExit live scan reads every file
 * under src/ and would flag the literal itself (the same rule services/v39FixContract
 * documents).
 */
export const UXR2_SCAN_SECTION_MOUNT = ['<ScanFind', 'Section pageUri={lastPageUri}'].join('');
export const UXR2_FIND_PIECE_MOUNT = ['<FindPiece', 'Screen initialQuery={findQuery}'].join('');

/** The pill's own style name — the one place the controls live. */
export const UXR2_PILL_STYLE = 'controlPill';
/** The floating bottom layer's style name (transparent, bottom-anchored). */
export const UXR2_DOCK_STYLE = 'dock';
/** The floating top layer's style name. */
export const UXR2_TOP_STYLE = 'topFloat';
/** v43 item C5b — the permanent framing tip over the viewfinder. */
export const UXR2_FRAMING_HINT_STYLE = 'framingHintWrap';
/** The expandable detail panel's style name. */
export const UXR2_SHEET_STYLE = 'findSheet';

// ─────────────────────────────── small readers ───────────────────────────────

function countOf(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = source.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = source.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * The body of the style object called `name`, braces balanced from its opening
 * brace. Returns '' when the style is absent, so a deleted style fails its guard
 * instead of silently passing.
 */
export function styleBlock(source: string, name: string): string {
  const masked = maskComments(source ?? '');
  const at = masked.indexOf(`${name}: {`);
  if (at < 0) return '';
  const open = masked.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return masked.slice(open, i + 1);
    }
  }
  return '';
}

/** Every style name in the file whose body positions itself absolutely. */
export function absoluteStyleNames(source: string): string[] {
  const masked = maskComments(source ?? '');
  const names: string[] = [];
  const pattern = /\n\s{2}([A-Za-z][A-Za-z0-9]*):\s*\{/g;
  let match = pattern.exec(masked);
  while (match) {
    const block = styleBlock(masked, match[1]);
    if (block.indexOf("position: 'absolute'") >= 0) names.push(match[1]);
    match = pattern.exec(masked);
  }
  return names.sort();
}

/** The render slice that starts at the pill and runs to the end of the file. */
export function pillSlice(source: string): string {
  const masked = maskComments(source ?? '');
  const at = masked.indexOf(`style={styles.${UXR2_PILL_STYLE}}`);
  return at < 0 ? '' : masked.slice(at);
}

// ─────────────────────── 1. the camera owns the window ───────────────────────

/**
 * GUARD V1 — THE PREVIEW FILLS THE WINDOW.
 *
 * Three ways "edge to edge" fails without a single error: the camera keeps a
 * non-zero floor plus `flex: 1` in a column (a letterbox whenever anything else is
 * on screen), the navigator's own opaque header stays above it (the window is then
 * header-height short), or the camera is inset from the edges. The preview must be
 * pinned to all four edges, must carry no height of its own, and the route's header
 * must be switched off BY THIS SCREEN (so App.tsx's registration stays untouched).
 */
export function scanCameraFillsTheScreen(source: string): boolean {
  const src = maskComments(source ?? '');
  if (src.length < 4000) return false;
  const camera = styleBlock(src, 'camera');
  if (camera.length < 20) return false;
  if (camera.indexOf('...StyleSheet.absoluteFillObject') < 0) return false;
  // A pinned preview has no height of its own to fight the window.
  if (camera.indexOf('minHeight') >= 0) return false;
  if (camera.indexOf('height:') >= 0) return false;
  // Exactly one full-bleed layer exists: nothing else is stretched to the window.
  if (countOf(src, 'absoluteFillObject') !== 1) return false;
  const container = styleBlock(src, 'container');
  if (container.indexOf('flex: 1') < 0) return false;
  // …and the navigator's header is hidden by the screen itself.
  if (src.indexOf('setOptions({ headerShown: false })') < 0) return false;
  if (src.indexOf('useLayoutEffect(') < 0) return false;
  // The preview really is the element at those four edges, with the flash setting.
  // (The search is anchored on whitespace after the tag name: `useRef<CameraView>`
  // up in the body is a type argument, not the mounted element.)
  const tagAt = src.search(/<CameraView\s/);
  if (tagAt < 0) return false;
  const tag = src.slice(tagAt);
  const tagEnd = tag.indexOf('/>');
  if (tagEnd < 0) return false;
  const opening = tag.slice(0, tagEnd);
  if (opening.indexOf('style={styles.camera}') < 0) return false;
  return opening.indexOf('flash={flash}') >= 0;
}

// ────────────── 2. the pill carries the controls, and nothing else ───────────

/**
 * GUARD V2 — THE SHUTTER, THE FLASH TOGGLE, UNDO AND DONE LIVE IN ONE FLOATING
 * PILL, AND NOWHERE ELSE.
 *
 * The pill is asserted as a SHAPE, not as a name: its radius comes from the pure
 * model's constant, its fill is the translucent token, it lays out in a row and it
 * is never stretched full width. Each of the four controls must appear EXACTLY ONCE
 * in the whole screen and all four must sit after the pill opens — so a control
 * rendered outside the pill (or duplicated above it) fails here rather than on a
 * phone.
 */
export function scanPillHostsTheControls(source: string): boolean {
  const src = maskComments(source ?? '');
  if (src.length < 4000) return false;
  const pill = styleBlock(src, UXR2_PILL_STYLE);
  if (pill.length < 60) return false;
  if (pill.indexOf('borderRadius: SCAN_PILL_RADIUS') < 0) return false;
  if (pill.indexOf('backgroundColor: SCAN_SURFACE_TRANSLUCENT') < 0) return false;
  if (pill.indexOf("flexDirection: 'row'") < 0) return false;
  // A pill floats at its own width; a full-width strip is the heavy bar again.
  if (pill.indexOf("width: '100%'") >= 0) return false;
  if (pill.indexOf('maxWidth') < 0) return false;

  const slice = pillSlice(src);
  if (slice.length < 500) return false;
  const controls: readonly string[] = [
    'onPress={() => void capturePage()}',
    'onPress={() => void removeLast()}',
    'onPress={() => void finish()}',
    'onPress={() => setFlash(nextScanFlashMode(flash))}',
  ];
  for (const control of controls) {
    if (slice.indexOf(control) < 0) return false;
    if (countOf(src, control) !== 1) return false;
  }
  // The pill holds exactly four tappable controls — no fifth, nothing appended.
  if (countOf(slice, '<Pressable') !== 4) return false;
  // The flash toggle shows the mode it is IN, from the pure model's own labels.
  if (slice.indexOf('scanFlashIcon(flash)') < 0) return false;
  if (slice.indexOf('scanFlashShortLabel(flash)') < 0) return false;
  if (src.indexOf('SCAN_SHUTTER_SIZE') < 0) return false;
  return true;
}

// ─────────────── 3. no opaque container behind the controls ─────────────────

/**
 * GUARD V3 — NO OPAQUE CONTAINER SPANS THE FULL WIDTH BEHIND THE CONTROLS.
 *
 * The old screen's heavy names must be gone (`footerScroll`, `controls`, `footer`,
 * `strip*`), the two floating layers must be absolutely placed and — this is the
 * point — must carry NO fill of their own: the only colour on this screen's bottom
 * edge is the pill's translucent one. The set of absolutely-positioned styles is
 * asserted exactly, so a new full-width layer cannot be slipped in behind the pill
 * without failing here.
 */
export function scanHasNoOpaqueFullWidthBar(source: string): boolean {
  const src = maskComments(source ?? '');
  if (src.length < 4000) return false;
  // The old full-width pieces must be gone, by their own names. (Each token is a
  // whole style name with its opening brace, so the new `filmstrip` block — which
  // merely ENDS in the word "strip" — cannot be mistaken for the retired strip.)
  const gone: readonly string[] = [
    'footerScroll',
    'styles.controls',
    'footer: {',
    'controls: {',
    'stripHint: {',
  ];
  for (const token of gone) {
    if (src.indexOf(token) >= 0) return false;
  }
  if (styleBlock(src, 'footer').length > 0) return false;
  if (styleBlock(src, 'controls').length > 0) return false;
  if (styleBlock(src, 'stripHint').length > 0) return false;
  const dock = styleBlock(src, UXR2_DOCK_STYLE);
  const top = styleBlock(src, UXR2_TOP_STYLE);
  if (dock.length < 40 || top.length < 40) return false;
  if (dock.indexOf('backgroundColor:') >= 0) return false;
  if (top.indexOf('backgroundColor:') >= 0) return false;
  if (dock.indexOf('bottom: 0') < 0) return false;
  // v43 item C5b — the framing tip is a THIRD absolute layer, and it is allowed
  // only as a translucent, tap-transparent, INSET panel: no full-bleed edge, no
  // fill on the wrapper itself, its fill on the panel must be rgba (translucent),
  // and the wrapper must swallow no taps. A full-width opaque bar here is exactly
  // what this guard exists to forbid, so the allowance is pinned, not widened.
  if (absoluteStyleNames(src).join(',') !== [UXR2_DOCK_STYLE, UXR2_FRAMING_HINT_STYLE, UXR2_TOP_STYLE].sort().join(',')) return false;
  if (countOf(src, "position: 'absolute'") !== 3) return false;
  const hint = styleBlock(src, UXR2_FRAMING_HINT_STYLE);
  if (hint.length < 30) return false;
  if (hint.indexOf('left: 0') >= 0 || hint.indexOf('right: 0') >= 0) return false;
  if (hint.indexOf('backgroundColor:') >= 0) return false;
  // THE FILL IS TRANSLUCENT, NEVER OPAQUE — and since v44 #58 it may arrive from
  // either of two places, so both are pinned:
  //   • the old form: an rgba literal inside the panel's own style block;
  //   • the shipped form: NO literal at all (a themed StyleSheet repaint is what
  //     turned this box black-on-black), with the screen painting the model's
  //     translucent `SCAN_TIP_SCRIM` inline.
  // An OPAQUE fill is refused either way: that is what the owner called a box
  // sitting over the capture.
  const panel = styleBlock(src, 'framingHintPanel');
  const panelFill = /backgroundColor\s*:\s*([^,\n]+)/.exec(panel);
  if (panelFill) {
    if (!/^['"]rgba\(/.test(panelFill[1]!.trim())) return false;
  } else {
    if (countOf(src, 'backgroundColor: SCAN_TIP_SCRIM') < 1) return false;
    if (!/^rgba\(/.test(SCAN_TIP_SCRIM)) return false;
  }
  if (countOf(src, 'pointerEvents="none"') < 1) return false;
  // Both floating layers let taps through to the preview around their content.
  if (countOf(src, 'pointerEvents="box-none"') < 2) return false;
  return true;
}

// ─────────────── 4. nothing sits on top of the controls ─────────────────────

/**
 * GUARD V4 — NOTHING COVERS THE SHUTTER.
 *
 * The bottom stack is bottom-anchored and stacked in render order, so the LAST
 * child is the bottom-most layer. The pill must come after the error banner, the
 * filmstrip and the detail panel, it must not live inside a ScrollView (a scroller
 * can shift it under the gesture bar), its own container must be centred rather
 * than stretched, and the detail panel must be a BOUNDED, scrollable sheet so it
 * cannot grow over the controls again — the exact v40 failure.
 */
export function scanNothingCoversTheControls(source: string): boolean {
  const src = maskComments(source ?? '');
  if (src.length < 4000) return false;
  const dock = styleBlock(src, UXR2_DOCK_STYLE);
  if (dock.indexOf("alignItems: 'center'") < 0) return false;
  if (dock.indexOf("flexDirection: 'row'") >= 0) return false;

  const pillAt = src.indexOf(`style={styles.${UXR2_PILL_STYLE}}`);
  const sheetAt = src.indexOf(`styles.${UXR2_SHEET_STYLE}`);
  const stripAt = src.indexOf('styles.filmstrip');
  const errorAt = src.indexOf('styles.errorFloat');
  if (pillAt < 0 || sheetAt < 0 || stripAt < 0 || errorAt < 0) return false;
  if (!(errorAt < stripAt && stripAt < sheetAt && sheetAt < pillAt)) return false;
  if (src.lastIndexOf('</ScrollView>') > pillAt) return false;

  // The detail panel is capped by the pure model, from the window's own height.
  if (src.indexOf('scanFindSheetMaxHeight(windowHeight)') < 0) return false;
  if (sheetAt > pillAt) return false;
  // …and the pill is the last thing rendered in the screen body.
  const tail = src.slice(pillAt);
  if (tail.indexOf('<ScrollView') >= 0) return false;
  return tail.indexOf('<CameraView') < 0;
}

// ───────────────── 5/6/7. the flow, its rules and its copy ─────────────────

/**
 * GUARD V5 — THE CAPTURE FLOW IS THE SAME FLOW.
 *
 * Every call site the v39/v40 guards already pin is pinned again here, against the
 * RELAID-OUT screen: the shutter writes the page into the library as it is taken,
 * an unfinished scan is picked back up, Undo removes the last page, Done closes the
 * session before leaving, the page photo reaches the shared reader, its confirmed
 * words open the ONE find-a-piece surface, and no URL or network call exists on this
 * screen. A layout change that drops any of these is a broken feature, not a style.
 */
export function scanKeepsTheCaptureFlow(source: string): boolean {
  const src = maskComments(source ?? '');
  if (src.length < 4000) return false;
  const flow: readonly string[] = [
    'onPress={() => void capturePage()}',
    'takePictureAsync({ quality: 0.85 })',
    'startScanSession(photo.uri, scanSessionTitle(',
    'appendScanSessionPage(sessionId, photo.uri)',
    'removeScanSessionPage(sessionId)',
    'getOpenScanSession()',
    'endScanSession(sessionId)',
    'saved.pageUris',
    'navigation.goBack()',
    UXR2_SCAN_SECTION_MOUNT,
    'onSearch={setFindQuery}',
    UXR2_FIND_PIECE_MOUNT,
    'onClose={() => setFindQuery(null)}',
    'if (findQuery !== null)',
  ];
  for (const token of flow) {
    if (src.indexOf(token) < 0) return false;
  }
  if (src.indexOf('createScannedScore(') >= 0) return false;
  if (src.indexOf('fetch(') >= 0) return false;
  if (/https?:\/\//.test(src)) return false;
  if (src.indexOf('sheetMusicDirectSearchUrl') >= 0) return false;
  // Done still closes the session before the route pops (the v39 ordering rule).
  return src.indexOf('endScanSession(') < src.indexOf('navigation.goBack()');
}

/**
 * GUARD V6 — EVERY CONTROL'S ENABLED STATE COMES FROM THE PURE MODEL.
 *
 * The pre-redesign screen disabled Undo and Done with zero pages and the shutter
 * while a capture was in flight. Those rules now live in `scanViewport`, and the
 * screen may only read them: four `disabled={!controls.…}` expressions and no
 * hardcoded boolean anywhere in the pill, so a control that used to be inert can
 * never become live (or the reverse) as a side effect of moving it.
 */
export function scanKeepsTheControlRules(source: string): boolean {
  const src = maskComments(source ?? '');
  if (src.length < 4000) return false;
  if (src.indexOf('scanControlState({') < 0) return false;
  const slice = pillSlice(src);
  if (slice.length < 500) return false;
  for (const flag of ['undo', 'flash', 'shoot', 'finish']) {
    if (slice.indexOf(`disabled={!controls.${flag}}`) < 0) return false;
  }
  if (countOf(slice, 'disabled={!controls.') !== 4) return false;
  if (slice.indexOf('disabled={false}') >= 0 || slice.indexOf('disabled={true}') >= 0) return false;
  // The old, still-true guard about an empty scan is untouched.
  return src.indexOf("Alert.alert('No pages', 'Capture at least one page first.')") >= 0;
}

/**
 * GUARD V7 — THE HONEST COPY SURVIVES THE DECLUTTER, AND CLAIMS NOTHING NEW.
 *
 * The owner called the helper text dense, so it moved behind one tap — it did NOT
 * disappear: the "saved as you go" line and the resumed-scan line are still
 * rendered, inside the detail panel. And because this is a relayout of a scan
 * surface, the flow still claims no note reading and no edition (the shared banned
 * claim sweep services/v39FixContract owns), still builds no retailer URL, and adds
 * no new promise.
 */
export function scanKeepsTheHonestCopy(source: string): boolean {
  const src = maskComments(source ?? '');
  if (src.length < 4000) return false;
  const sheetAt = src.indexOf(`styles.${UXR2_SHEET_STYLE}`);
  const pillAt = src.indexOf(`style={styles.${UXR2_PILL_STYLE}}`);
  if (sheetAt < 0 || pillAt < 0 || sheetAt > pillAt) return false;
  const panel = src.slice(sheetAt, pillAt);
  if (panel.indexOf('{SCAN_SAVED_AS_YOU_GO_LINE}') < 0) return false;
  if (panel.indexOf('scanSessionResumedLine(pages.length)') < 0) return false;
  if (src.indexOf('scanPageCountLabel(pages.length)') < 0) return false;
  // No second, denser copy of the durability line anywhere else on the screen.
  if (countOf(src, '{SCAN_SAVED_AS_YOU_GO_LINE}') !== 1) return false;
  if (src.indexOf('No pages captured yet') >= 0) return false;
  return scanFindCopyClaimsNoNoteReading([source]);
}

/**
 * GUARD V8 — THE PANEL OPENS CLOSED, AND THE STRIP ONLY EXISTS WITH PAGES.
 *
 * "Declutter" made concrete: the detail panel's open state comes from the pure
 * `scanFindPanel` rule and defaults to collapsed (nothing dense over the preview),
 * the collapsed face is the shared "find this music" chip, and the filmstrip is
 * rendered only once a page exists, so an empty screen is preview plus pill.
 */
export function scanDeclutterStaysCollapsedByDefault(source: string): boolean {
  const src = maskComments(source ?? '');
  if (src.length < 4000) return false;
  if (src.indexOf('const [findOpen, setFindOpen] = useState(false)') < 0) return false;
  if (src.indexOf('scanFindPanel(findOpen)') < 0) return false;
  if (src.indexOf('setFindOpen(true)') < 0 || src.indexOf('setFindOpen(false)') < 0) return false;
  if (src.indexOf('styles.findChip') < 0) return false;
  if (countOf(src, 'pages.length > 0') < 2) return false;
  if (src.indexOf('styles.filmstrip') < 0) return false;
  // The filmstrip is a bounded, rounded, translucent row — not the old opaque strip.
  const strip = styleBlock(src, 'filmstrip');
  if (strip.indexOf('height: SCAN_FILMSTRIP_HEIGHT') < 0) return false;
  if (strip.indexOf('backgroundColor: SCAN_CHIP_TRANSLUCENT') < 0) return false;
  return strip.indexOf('borderRadius') >= 0;
}

// ─────────────────── 9. the floating layers clear the system UI ───────────────

/**
 * GUARD V9 — THE CONTROLS CLEAR THE STATUS BAR AND THE GESTURE BAR (pure).
 *
 * Android's navigation bar is drawn OVER the app, so a control placed at the bottom
 * edge is a control the system steals taps from. The dock's offset is derived from
 * the measured inset with a floor for devices that report none, the top chip does
 * the same for the status bar, and the flash toggle / enablement rules behave as
 * the capture flow has always behaved. Pure, over the model's real functions.
 */
export function scanOverlaysClearSystemBars(value: {
  top: (inset: unknown) => number;
  bottom: (inset: unknown) => number;
  state: (input: { capturing?: unknown; pageCount?: unknown }) => {
    shoot: boolean;
    undo: boolean;
    finish: boolean;
    flash: boolean;
  };
  flashCycle: (mode: unknown) => string;
}): boolean {
  if (
    typeof value?.top !== 'function' ||
    typeof value?.bottom !== 'function' ||
    typeof value?.state !== 'function' ||
    typeof value?.flashCycle !== 'function'
  ) {
    return false;
  }
  if (value.bottom(0) < 18) return false;
  if (value.bottom(48) <= 48) return false;
  if (value.bottom(20) > value.bottom(40)) return false;
  if (value.bottom(-5) < 18) return false;
  if (value.top(0) < 8) return false;
  if (value.top(24) <= 24) return false;
  if (value.top(24) !== 32) return false;
  const capturing = value.state({ capturing: true, pageCount: 3 });
  if (capturing.shoot !== false || capturing.undo !== true || capturing.finish !== true) return false;
  if (capturing.flash !== false) return false;
  const empty = value.state({ capturing: false, pageCount: 0 });
  if (empty.shoot !== true || empty.undo !== false || empty.finish !== false) return false;
  if (empty.flash !== true) return false;
  if (value.state({ capturing: false, pageCount: Number.NaN }).undo !== false) return false;
  if (value.flashCycle('off') !== 'auto') return false;
  if (value.flashCycle('auto') !== 'on') return false;
  if (value.flashCycle('on') !== 'off') return false;
  return value.flashCycle('nonsense') === 'off';
}

// ────────────────────── 10. the gate knows about all of it ───────────────────

/** Every new module and this suite must be in BOTH explicit gate lists. */
export function scanTier1ListsTheViewportWork(
  tsconfigSource: string,
  packageSource: string,
): boolean {
  if (typeof tsconfigSource !== 'string' || typeof packageSource !== 'string') return false;
  if (tsconfigSource.length < 2000 || packageSource.length < 500) return false;
  for (const module of UXR2_TIER1_MODULES) {
    if (tsconfigSource.indexOf(`"${module}"`) < 0) return false;
  }
  for (const suite of UXR2_TIER1_SUITES) {
    const compiled = suite.replace(/\.ts$/, '.js');
    if (packageSource.indexOf(`/tmp/tier1-test/${compiled}`) < 0) return false;
  }
  return true;
}

/** The screen's user-facing sources, for the copy sweeps. */
export function scanViewportSources(input: { screen: string; model: string }): string[] {
  return [input?.screen ?? '', input?.model ?? ''];
}

/** How many of those sources are non-empty (a floor for the sweeps). */
export function scanViewportSourceCount(sources: readonly string[]): number {
  if (!Array.isArray(sources)) return 0;
  return sources.filter((source) => typeof source === 'string' && source.length > 200).length;
}
