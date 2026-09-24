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
  | 'mount-without-back-callback';

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

/** Every violation of the full BACK contract, ready to fail a gate. */
export function findBackExitViolations(
  files: readonly SourceFile[],
): BackGuardViolation[] {
  return [
    ...findUnguardedFullScreenFlows(files),
    ...findFlowMountsMissingBackCallback(files),
  ];
}

/** One-line report per violation, ready to print in a test failure. */
export function formatBackExitViolations(
  violations: readonly BackGuardViolation[],
): string[] {
  return violations.map((v) => `BACK contract (${v.kind}): ${v.message}`);
}
