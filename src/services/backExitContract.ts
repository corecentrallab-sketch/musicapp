/**
 * backExitContract.ts — the Android hardware-BACK contract for the app's
 * IN-PLACE full-screen flows (the class v22's modal contract could not see).
 *
 * Owner-reproduced on device (09-23): "Streak day → featured piece → sheet music
 * page → BACK → the app exits" — confirmed on the sheet-music-from-streak path.
 *
 * The app has three kinds of full-screen surface, and BACK has to be wired for
 * each of them differently:
 *
 *   1. ROUTES (PdfViewer, ScannedViewer, ScanScore, CloudSync, Metronome) —
 *      React Navigation pops them itself. Nothing to guard.
 *   2. MODALS (ScoreViewer, ShareCard, RecognitionResultView, the modern
 *      interstitial, the retailer page) — guarded by `onRequestClose`
 *      (src/services/modalBackContract.ts, the v22 fix).
 *   3. IN-PLACE FLOWS (this module's class) — screens that are neither routes nor
 *      modals: they replace their host TAB's whole body
 *      (`if (showDetail) return <PieceDetailScreen onBack={…} />`). The route
 *      never changes, so a BACK press that nothing consumes reaches React
 *      Navigation on its last route ("Tabs"), which has nothing to pop and
 *      finishes the activity. The app exits.
 *
 * `useHardwareBack` (src/hooks/useHardwareBack.ts) is the fix; THIS module is the
 * guard over it, in the team's source-contract style: it reads the app's own
 * source text and reports flows that BACK cannot leave. Pure by design — no
 * react / react-native / fs imports — so the tier1 gate compiles and runs it with
 * node_modules absent (see tsconfig.tier1.json). The disk walk lives in the test
 * script (`scripts/backExitContract.test.ts`).
 *
 * Two failure classes are covered, both of which shipped silently:
 *   • a full-screen flow that registers NO hardware-back handler (the owner's
 *     exit-the-app bug), and
 *   • a HOST that mounts a flow without its back callback — a dead "← Back"
 *     button on a screen that can then only be left by exiting the app.
 */
import {
  findModalsMissingBackHandler,
  lineAt,
  maskComments,
  modalTags,
  readModalTag,
  type SourceFile,
} from './modalBackContract';

export type { SourceFile };

// ─── The declared flows ─────────────────────────────────────────

/**
 * How a surface can be left with the hardware BACK key.
 *   • `hook`  — an in-place flow: it must call `useHardwareBack(…)`.
 *   • `modal` — a modal-based surface: every <Modal> it renders must carry
 *               `onRequestClose` (the v22 contract, asserted here too so the
 *               "full-screen flows" class is guarded end to end).
 */
export type FlowBackGuard = 'hook' | 'modal';

export interface FullScreenFlow {
  /** Repo-relative path. */
  path: string;
  /** Human label used in failure messages. */
  name: string;
  guard: FlowBackGuard;
  /** Why this surface is in the contract (kept next to the entry on purpose). */
  why: string;
}

/**
 * Every surface the owner can reach that fills the screen without being a route.
 * Adding a new in-place flow? Add it here — that is the whole point of the list:
 * the next member does not have to rediscover the class of bug.
 */
export const FULL_SCREEN_FLOWS: readonly FullScreenFlow[] = [
  {
    path: 'src/screens/PieceDetailScreen.tsx',
    name: 'piece detail',
    guard: 'hook',
    why: 'Rendered in place by Home, History, Find-a-Piece and the hum flow; reached from the streak/featured cards, so BACK here must return to the previous screen.',
  },
  {
    path: 'src/screens/HumSearchScreen.tsx',
    name: 'hum / whistle / sing search',
    guard: 'hook',
    why: 'Tier-1 hum-to-search is its own full-screen flow with a recorder — BACK must leave it, never the app.',
  },
  {
    path: 'src/screens/FindPieceScreen.tsx',
    name: 'find a piece',
    guard: 'hook',
    why: 'Catalog search opened from Home and History as a full-screen flow.',
  },
  {
    path: 'src/screens/PracticeWeekScreen.tsx',
    name: 'practice week',
    guard: 'hook',
    why: 'Home\u2019s "This Week" surface, rendered in place.',
  },
  {
    path: 'src/screens/ModernSearchScreen.tsx',
    name: 'modern song search ("Find any song")',
    guard: 'hook',
    why: 'The modern-song front door — in place, with its own recorder, and the host of the retailer interstitial.',
  },
  {
    path: 'src/screens/AchievementsScreen.tsx',
    name: 'medals & achievements',
    guard: 'hook',
    why: 'Home\u2019s quiet medals entry (owner-approved 08-25) renders this in place, and it hosts the achievement share card — BACK must leave the screen, and while the card is up it must close the card first.',
  },
  {
    path: 'src/components/ScoreViewer.tsx',
    name: 'sheet-music view',
    guard: 'modal',
    why: 'The sheet music page itself (from the streak/featured flows and everywhere else). It is a Modal, so BACK is onRequestClose — re-asserted here so one contract owns the whole full-screen class.',
  },
];

/**
 * Components that a host must mount WITH a back callback. A mount that forgets
 * it renders a screen whose only exit (the "← Back" button) is dead, and — with
 * no `onBack` to call — nothing the hardware BACK hook can do either.
 */
export interface FlowMount {
  component: string;
  backProp: 'onBack' | 'onClose';
}

export const FLOW_MOUNTS: readonly FlowMount[] = [
  { component: 'PieceDetailScreen', backProp: 'onBack' },
  { component: 'ScoreViewer', backProp: 'onClose' },
  { component: 'HumSearchScreen', backProp: 'onClose' },
  { component: 'FindPieceScreen', backProp: 'onClose' },
  { component: 'PracticeWeekScreen', backProp: 'onClose' },
  { component: 'ModernSearchScreen', backProp: 'onClose' },
  { component: 'AchievementsScreen', backProp: 'onClose' },
];

// ─── Detectors ──────────────────────────────────────────────────

/** The shared hook, called from a flow. */
export const HARDWARE_BACK_HOOK_PATTERN = /\buseHardwareBack\s*\(/;

/** A hand-rolled BackHandler subscription (equivalent, and also accepted).
 *  Quote-free on purpose: a regex literal containing a quote character defeats
 *  modalBackContract's comment masker for THIS file, which would expose the
 *  tag names in the documentation above to that scanner. */
export const BACK_HANDLER_SUBSCRIPTION_PATTERN =
  /BackHandler\s*\.\s*addEventListener\s*\(\s*[^)]{0,2}hardwareBackPress/;

/** True when `source` registers an Android hardware-back handler at all. */
export function registersHardwareBackHandler(source: string): boolean {
  const masked = maskComments(source);
  return (
    HARDWARE_BACK_HOOK_PATTERN.test(masked) ||
    BACK_HANDLER_SUBSCRIPTION_PATTERN.test(masked)
  );
}

/** How many files in the scan register a hardware-back handler (a sanity floor). */
export function countHardwareBackHandlers(files: readonly SourceFile[]): number {
  let total = 0;
  for (const file of files) {
    if (registersHardwareBackHandler(file.source)) total++;
  }
  return total;
}

/**
 * This module's own path. The mount scanner must not report the detector itself
 * (the same rule modalBackContract states for its own regex text): this file
 * names the flow components in its patterns and in its documentation, and a
 * regex literal containing quote characters defeats the comment masker, so a
 * documented mount inside a comment here would otherwise be scanned as real.
 */
export const BACK_CONTRACT_MODULE_PATH = 'src/services/backExitContract.ts';

export type BackGuardViolationKind =
  | 'missing-file'
  | 'no-hardware-back-handler'
  | 'modal-cannot-close-by-back'
  | 'mount-without-back-callback'
  | 'blank-return-body-replaced'
  | 'mount-cannot-clear-open-state'
  | 'split-dismissal-authority'
  | 'predictive-back-opt-out-missing'
  | 'predictive-back-opt-out-reverted';

export interface BackGuardViolation {
  path: string;
  /** 1-based line, when the violation is tied to a line of source. */
  line?: number;
  kind: BackGuardViolationKind;
  message: string;
}

function flowViolation(
  flow: FullScreenFlow,
  kind: BackGuardViolationKind,
  message: string,
  line?: number,
): BackGuardViolation {
  return { path: flow.path, line, kind, message };
}

/**
 * Every declared full-screen flow that the hardware BACK button cannot leave.
 * An empty result means the contract holds.
 */
export function findUnguardedFullScreenFlows(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  const violations: BackGuardViolation[] = [];
  for (const flow of FULL_SCREEN_FLOWS) {
    const file = files.find((f) => f.path === flow.path);
    if (!file) {
      violations.push(
        flowViolation(
          flow,
          'missing-file',
          `${flow.path} (${flow.name}) is in the BACK contract but was not found in the scan`,
        ),
      );
      continue;
    }

    if (flow.guard === 'hook') {
      if (!registersHardwareBackHandler(file.source)) {
        violations.push(
          flowViolation(
            flow,
            'no-hardware-back-handler',
            `${flow.path} (${flow.name}) renders full screen in place but never calls useHardwareBack() — BACK exits the app (${flow.why})`,
          ),
        );
      }
      continue;
    }

    // Modal-based surface: every modal it renders must be BACK-closable.
    for (const modal of findModalsMissingBackHandler([file])) {
      violations.push(
        flowViolation(
          flow,
          'modal-cannot-close-by-back',
          `${flow.path}:${modal.line} (${flow.name}) — BACK cannot close this modal: ${modal.tag}`,
          modal.line,
        ),
      );
    }
  }
  return violations;
}

/** One mount of a contract component: `<PieceDetailScreen …>`. */
export interface FlowMountSite {
  path: string;
  line: number;
  component: string;
  /** The opening tag, whitespace-collapsed, for the failure message. */
  tag: string;
  /** Offset of the `<` in the scanned source (return-position analysis needs it). */
  start: number;
}

/** Every `<Component …>` opening tag of `component` in one file. */
export function flowMountSites(source: string, component: string): FlowMountSite[] {
  const masked = maskComments(source);
  const found: FlowMountSite[] = [];
  // The lookahead keeps this honest: `<PieceDetailScreenProps>` (a type, not a
  // mount) and this module's own pattern text are not mounts.
  const pattern = new RegExp(`<${component}(?=[\\s/>])`, 'g');
  let match = pattern.exec(masked);
  while (match) {
    const tag = readModalTag(masked, match.index);
    if (tag !== null) {
      found.push({
        path: '',
        line: lineAt(masked, match.index),
        component,
        tag: tag.replace(/\s+/g, ' ').trim(),
        start: match.index,
      });
    }
    match = pattern.exec(masked);
  }
  return found;
}

/**
 * Every host that mounts a contract component WITHOUT its back callback — the
 * "host forgot to pass the prop" class, which leaves a full-screen flow with no
 * exit at all (the hardware-back hook has no `onBack` to call).
 */
export function findFlowMountsMissingBackCallback(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  const violations: BackGuardViolation[] = [];
  for (const file of files) {
    if (file.path === BACK_CONTRACT_MODULE_PATH) continue;
    for (const mount of FLOW_MOUNTS) {
      const backProp = new RegExp(`\\b${mount.backProp}\\s*=`);
      for (const site of flowMountSites(file.source, mount.component)) {
        if (backProp.test(site.tag)) continue;
        violations.push({
          path: file.path,
          line: site.line,
          kind: 'mount-without-back-callback',
          message: `${file.path}:${site.line} mounts <${mount.component}> without ${mount.backProp} — a full-screen flow with no way back: ${site.tag}`,
        });
      }
    }
  }
  return violations;
}

// ─── The blank-return contract (owner-reported blank Home page, v22 → v24) ─────
//
// Owner-reproduced on RC v24 (09-24), and on v22 and v23 before it: open the
// sheet music from anywhere (the streak flow, a piece page, Home, a recognition
// result), then LEAVE it — BACK or the viewer's own close — and the screen that
// comes back is a blank WHITE page: the Home tab's body renders empty while the
// tab bar stays alive (tapping History or Library recovers the app). BACK on the
// blank page then exits the app.
//
// The mechanism is the empty-body path v22 documented and never removed:
//
//   1. The sheet-music viewer is a MODAL-ONLY surface: its whole rendering is one
//      Modal whose dialog is a separate Android window. It can be dismissed
//      natively — by the platform, without JS ever hearing about it — while the
//      host's `showScoreViewer` flag stays true. v22 removed the first way to get
//      there (no onRequestClose). Android 16 + targetSdk 36 restored it by
//      another door: with predictive back the platform no longer dispatches
//      KEYCODE_BACK or calls onBackPressed, and RN 0.76 raises onRequestClose
//      ONLY from a key listener on the dialog window — so the platform dismisses
//      the dialog and JS keeps `visible` true. (see
//      plugins/withAndroidBackCompat.js, which opts the app out, and the
//      predictive-back detectors below, which keep that opt-out in place.)
//   2. Because every host REPLACED ITS ENTIRE BODY with the viewer
//      (`if (showScoreViewer) return <viewer/>`), a viewer flag left true with no
//      dialog on screen left the host rendering nothing at all: an empty body
//      under the tab header — the blank white page. The host's own background
//      never painted, which is why the page is white, not the app's dark navy.
//
// So this module guards the STRUCTURAL half (the half that makes the class
// impossible, whatever the back key does): a modal-only surface may never BE a
// host's body — it is an overlay inside a body that is always mounted — and the
// flag that mounts it must be cleared by the close it is handed.
//
// Three failure classes, all build-failing:
//   • a host that RETURNS a modal-only surface (body replacement — the blank
//     return itself),
//   • a mount whose close callback cannot clear the host's open state (the flag
//     stays true after the viewer is dismissed),
//   • a modal-only surface whose BACK path and on-screen close path are not the
//     same handler (two dismissal authorities can drift apart: one clears, one
//     does not).

/**
 * A modal-only surface: a component whose entire rendering is a Modal, so any
 * host that returns it in place of its own body renders an empty screen whenever
 * its dialog is not presenting.
 */
export interface ModalOnlySurface {
  /** Component name as mounted in JSX. */
  component: string;
  /** Repo-relative path, so the scan can read the surface's own source. */
  path: string;
  /** Why it is in the contract (kept next to the entry on purpose). */
  why: string;
}

export const MODAL_ONLY_SURFACES: readonly ModalOnlySurface[] = [
  {
    component: 'ScoreViewer',
    path: 'src/components/ScoreViewer.tsx',
    why: 'the sheet-music viewer (owner-reported blank white page, v22 → v24): its dialog can be dismissed natively while the host flag stays true',
  },
  {
    component: 'ShareCard',
    path: 'src/components/ShareCard.tsx',
    why: 'the share card (the same modal-only shape, and the second surface v22 had to patch for the back key)',
  },
];

/** The prop a modal-only surface's mount must carry to be closable at all. */
export const MODAL_ONLY_CLOSE_PROP = 'onClose';

/**
 * True when the JSX element starting at `start` is what the surrounding code
 * RETURNS — `return <X/>`, `return (<X/>)`, `=> <X/>`. That is the empty-body
 * path: the element stands in place of the caller's own body.
 */
export function isReturnedElement(source: string, start: number): boolean {
  let i = start - 1;
  const skipSpace = (): void => {
    while (i >= 0 && /\s/.test(source[i])) i--;
  };
  skipSpace();
  if (source[i] === '(') {
    i--;
    skipSpace();
  }
  if (i >= 1 && source[i] === '>' && source[i - 1] === '=') return true;
  const end = i + 1;
  let j = end - 1;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(source[j])) j--;
  return source.slice(j + 1, end) === 'return';
}

/** The text inside the braces that open at `open` (brace- and string-aware). */
export function readBraced(source: string, open: number): string | null {
  let depth = 0;
  let quote = '';
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** The `{…}` value of `prop` inside a JSX opening tag (whitespace preserved). */
export function readPropExpression(tag: string, prop: string): string | null {
  const pattern = new RegExp(`\\b${prop}\\s*=\\s*\\{`);
  const match = pattern.exec(tag);
  if (!match) return null;
  return readBraced(tag, match.index + match[0].length - 1);
}

/** Every `prop={…}` expression in a source file, in order. */
export function propExpressions(source: string, prop: string): string[] {
  const masked = maskComments(source);
  const found: string[] = [];
  const pattern = new RegExp(`\\b${prop}\\s*=\\s*\\{`, 'g');
  let match = pattern.exec(masked);
  while (match) {
    const expr = readBraced(masked, match.index + match[0].length - 1);
    if (expr !== null) found.push(expr);
    match = pattern.exec(masked);
  }
  return found;
}

/**
 * `setSomething(false)` / `(null)` / `(undefined)` — the shapes that provably
 * clear an open flag. A never-cleared flag is the other shapes (`() => {}`,
 * `setFlag(true)`, an unrelated handler).
 */
export const STATE_CLEARING_PATTERN =
  /set[A-Za-z0-9_$]*\s*\(\s*(?:false|null|undefined)\s*\)/;

/** A bare handler identifier (`handleCloseScoreViewer`), not an expression. */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The declaration text of a local handler, bounded to its own body. */
export function localDefinition(source: string, identifier: string): string | null {
  const masked = maskComments(source);
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+${identifier}\\s*=`);
  const match = pattern.exec(masked);
  if (!match) return null;
  const rest = masked.slice(match.index);
  // Bound the window at the next block-level declaration so a later handler
  // cannot make this one look like it clears state.
  const next = rest.slice(1).search(/\n[ \t]{0,2}(?:const|let|var)\s/);
  const end = next >= 0 ? next + 1 : Math.min(rest.length, 4000);
  return rest.slice(0, end);
}

/**
 * True when closing through `expression` provably clears the state that mounted
 * the surface — either directly (`() => setShowScoreViewer(false)`) or through a
 * local handler that does (one level of indirection; a prop handed down from a
 * parent is out of this file's scope and is accepted).
 */
export function clearsOpenState(source: string, expression: string): boolean {
  if (STATE_CLEARING_PATTERN.test(expression)) return true;
  const trimmed = expression.trim();
  if (!IDENTIFIER_PATTERN.test(trimmed)) return false;
  const definition = localDefinition(source, trimmed);
  if (definition === null) return true;
  if (STATE_CLEARING_PATTERN.test(definition)) return true;
  const call = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*\)/.exec(definition);
  if (call) {
    const inner = localDefinition(source, call[1]);
    if (inner !== null && STATE_CLEARING_PATTERN.test(inner)) return true;
  }
  return false;
}

/**
 * Every mount of a modal-only surface that REPLACES its host's body — the blank
 * return that shipped three times. An empty result means every host keeps a body
 * of its own and renders the viewer over it.
 */
export function findBodyReplacingModalMounts(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  const violations: BackGuardViolation[] = [];
  for (const file of files) {
    for (const surface of MODAL_ONLY_SURFACES) {
      for (const site of flowMountSites(file.source, surface.component)) {
        if (!isReturnedElement(file.source, site.start)) continue;
        violations.push({
          path: file.path,
          line: site.line,
          kind: 'blank-return-body-replaced',
          message: `${file.path}:${site.line} RETURNS ${surface.component} in place of its own body — when that dialog is dismissed without JS clearing the flag, the host renders an empty screen (the blank white page). Render it as an overlay inside an always-mounted body: ${site.tag}`,
        });
      }
    }
  }
  return violations;
}

/**
 * Every mount of a modal-only surface whose close callback cannot clear the open
 * state that mounted it (a flag left true after a dismissal is the empty body).
 */
export function findViewerMountsThatCannotClearOpenState(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  const violations: BackGuardViolation[] = [];
  for (const file of files) {
    for (const surface of MODAL_ONLY_SURFACES) {
      for (const site of flowMountSites(file.source, surface.component)) {
        const expression = readPropExpression(site.tag, MODAL_ONLY_CLOSE_PROP);
        // A missing callback is the other contract's violation, not this one.
        if (expression === null) continue;
        if (clearsOpenState(file.source, expression)) continue;
        violations.push({
          path: file.path,
          line: site.line,
          kind: 'mount-cannot-clear-open-state',
          message: `${file.path}:${site.line} closes ${surface.component} with an expression that cannot clear the state which mounts it (no setSomething(false) directly or in the local handler it names) — a dismissed viewer would leave the host's flag true: ${site.tag}`,
        });
      }
    }
  }
  return violations;
}

/**
 * Every modal-only surface whose BACK dismissal and on-screen close are not the
 * same handler: two authorities drift, one clears the host state and the other
 * does not, and the blank body comes back.
 */
export function findSplitDismissalAuthority(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const violations: BackGuardViolation[] = [];
  for (const surface of MODAL_ONLY_SURFACES) {
    const file = files.find((f) => f.path === surface.path);
    if (!file) continue;
    const onScreenCloses = propExpressions(file.source, 'onPress').map(normalize);
    for (const { tag, start } of modalTags(file.source)) {
      const back = readPropExpression(tag, 'onRequestClose');
      // A modal with no handler at all belongs to modalBackContract's rule.
      if (back === null) continue;
      if (onScreenCloses.includes(normalize(back))) continue;
      violations.push({
        path: file.path,
        line: lineAt(file.source, start),
        kind: 'split-dismissal-authority',
        message: `${file.path}:${lineAt(file.source, start)} dismisses ${surface.component} through a different handler on BACK than on screen — one authority must clear the host state for both, otherwise a BACK dismissal leaves the flag true: ${tag.replace(/\s+/g, ' ').trim()}`,
      });
    }
  }
  return violations;
}

/** Every blank-return violation: the empty-body class in one call. */
export function findBlankReturnViolations(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  return [
    ...findBodyReplacingModalMounts(files),
    ...findViewerMountsThatCannotClearOpenState(files),
    ...findSplitDismissalAuthority(files),
  ];
}

// ─── The Android 16 predictive-back opt-out (the BACK path into the state) ─────
//
// Android's documented behaviour change for apps targeting API 36: predictive
// back is on by default and "onBackPressed is not called and
// KeyEvent.KEYCODE_BACK is not dispatched anymore" (developer.android.com,
// "Behavior changes: apps targeting Android 16"). React Native 0.76 raises both
// onRequestClose and the JS hardwareBackPress event from those dead paths, so
// without the documented opt-out EVERY JS back handler in this app is dead on an
// Android 16 device — the modal dismissal above included. The opt-out lives in
// plugins/withAndroidBackCompat.js, referenced from app.json; these detectors keep
// it there and keep it false.

export const APP_CONFIG_PATH = 'app.json';
export const PREDICTIVE_BACK_ATTRIBUTE = 'enableOnBackInvokedCallback';

/** The plugin module names app.json references (strings, or [name, options]). */
export function appPluginNames(appConfigSource: string): string[] {
  try {
    const parsed = JSON.parse(appConfigSource) as {
      expo?: { plugins?: unknown[] };
    };
    const plugins = parsed.expo?.plugins;
    if (!Array.isArray(plugins)) return [];
    const names: string[] = [];
    for (const entry of plugins) {
      if (typeof entry === 'string') names.push(entry);
      else if (Array.isArray(entry) && typeof entry[0] === 'string') {
        names.push(entry[0]);
      }
    }
    return names;
  } catch {
    return [];
  }
}

/** Candidate scan paths for a plugin reference like "./plugins/withAndroidBackCompat". */
export function pluginScanCandidates(name: string): string[] {
  const clean = name.replace(/^\.\//, '').replace(/^\.\.\//, '');
  return [clean, `${clean}.js`, `${clean}/index.js`];
}

/**
 * Every problem with the Android 16 predictive-back opt-out: a scan that cannot
 * find a plugin setting the attribute to false (BACK is dead on Android 16), or a
 * plugin that has been flipped back to true.
 */
export function findPredictiveBackOptOutViolations(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  const violations: BackGuardViolation[] = [];
  const appConfig = files.find((f) => f.path === APP_CONFIG_PATH);
  if (!appConfig) {
    return [
      {
        path: APP_CONFIG_PATH,
        kind: 'predictive-back-opt-out-missing',
        message: `${APP_CONFIG_PATH} was not in the scan — the predictive-back opt-out cannot be verified (include app.json in the scanned files)`,
      },
    ];
  }

  const attributeLiteral = new RegExp(`['"]android:${PREDICTIVE_BACK_ATTRIBUTE}['"]`);
  const falseLiteral = /['"]false['"]/;
  const reverted = new RegExp(
    `${PREDICTIVE_BACK_ATTRIBUTE}[\\s\\S]{0,240}['"]true['"]`,
  );

  let optOutFound = false;
  for (const name of appPluginNames(appConfig.source)) {
    if (!name.startsWith('.')) continue;
    const plugin = pluginScanCandidates(name)
      .map((candidate) => files.find((f) => f.path === candidate))
      .find((f) => f !== undefined);
    if (!plugin) continue;
    const masked = maskComments(plugin.source);
    if (reverted.test(masked)) {
      violations.push({
        path: plugin.path,
        kind: 'predictive-back-opt-out-reverted',
        message: `${plugin.path} sets android:${PREDICTIVE_BACK_ATTRIBUTE} back to true — on Android 16 that kills every JS back handler in this app (modal onRequestClose and hardwareBackPress), which is the blank-page path this contract exists to prevent`,
      });
      continue;
    }
    if (attributeLiteral.test(masked) && falseLiteral.test(masked)) optOutFound = true;
  }

  if (!optOutFound) {
    violations.push({
      path: APP_CONFIG_PATH,
      kind: 'predictive-back-opt-out-missing',
      message: `no plugin referenced from ${APP_CONFIG_PATH} sets android:${PREDICTIVE_BACK_ATTRIBUTE} to false — on an Android 16 device (this app targets SDK 36) the platform stops dispatching KEYCODE_BACK, so no modal onRequestClose and no hardwareBackPress handler ever fires and a sheet-viewer dismissal leaves the viewer flag true`,
    });
  }
  return violations;
}

/** Every violation of the full BACK contract, ready to fail a gate. */
export function findBackExitViolations(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  return [
    ...findUnguardedFullScreenFlows(files),
    ...findFlowMountsMissingBackCallback(files),
    ...findBlankReturnViolations(files),
    ...findPredictiveBackOptOutViolations(files),
  ];
}

/** One-line report per violation, ready to print in a test failure. */
export function formatBackExitViolations(
  violations: readonly BackGuardViolation[],
): string[] {
  return violations.map((v) => `BACK contract (${v.kind}): ${v.message}`);
}
