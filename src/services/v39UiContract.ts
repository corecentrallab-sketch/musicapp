/**
 * v39UiContract.ts — LIVE-SOURCE GUARDS for the v39 batch's two owner-approved
 * features:
 *
 *   • the TUNER (owner APPROVED 10-10, backlog 2bbbbc8f)
 *   • the PAGE-TURNER SPEED PRESETS + per-piece memory (backlog 7f64272f)
 *
 * The guards read the REAL files (the disk walk lives in scripts/tuner.test.ts and
 * scripts/pageTurnSpeed.test.ts) and return a verdict on their text. Every one of
 * them must be TRUE on the real text AND be shown to BITE against a mutated copy
 * (skill `musicapp-guard-mutation-probes`). Comments are masked first with the
 * existing `maskComments` (services/modalBackContract.ts), so a commented-out fix
 * can never satisfy a guard, and every guard has a length floor so an empty or
 * truncated read fails instead of passing vacuously.
 *
 * PURE LOGIC: imports nothing native, so it compiles under tsconfig.tier1.json.
 */
import { maskComments } from './modalBackContract';
import {
  PAGE_TURN_BEATS_PER_PAGE_MAX,
  PAGE_TURN_BEATS_PER_PAGE_MIN,
  PAGE_TURN_BPM_MAX,
  PAGE_TURN_BPM_MIN,
  DEFAULT_PAGE_TURN_PROFILE,
} from './pageTurnPresets';
import { TUNER_DECODER_HTML, tunerDecoderPageIsSelfContained } from './tunerDecoder';
// v42 fix C re-pointed the page-turner preset guard below: the scanned surface
// lost a control that could never work there, and the PDF reader kept it.
import {
  pdfViewerKeepsAutoScroll,
  scannedViewerExplainsNoAutoScroll,
  scannedViewerHasDeadControls,
} from './uxrV42Contract';

// ───────────────────────────── the paths the walk reads ─────────────────────

export const V39_TUNER_SCREEN_PATH = 'src/screens/TunerScreen.tsx';
export const V39_TUNER_METER_PATH = 'src/components/TunerMeter.tsx';
export const V39_TUNER_SERVICE_PATH = 'src/services/tuner.ts';
export const V39_TUNER_DECODER_PATH = 'src/services/tunerDecoder.ts';
export const V39_EDITOR_ENTRY_PATH = 'src/screens/EditorScreen.tsx';
export const V39_APP_PATH = 'App.tsx';
export const V39_TYPES_PATH = 'src/types/index.ts';
export const V39_PDF_VIEWER_PATH = 'src/screens/PdfViewerScreen.tsx';
export const V39_SCANNED_VIEWER_PATH = 'src/screens/ScannedViewerScreen.tsx';
export const V39_PAGE_TURN_PRESETS_PATH = 'src/services/pageTurnPresets.ts';
export const V39_PAGE_TURN_STORE_PATH = 'src/services/pageTurnSpeedStore.ts';
export const V39_PAGE_TURN_HOOK_PATH = 'src/hooks/usePageTurnSpeed.ts';
export const V39_AUTOSCROLL_CONTROL_PATH = 'src/components/AutoScrollControl.tsx';
export const V39_AUTOSCROLL_HOOK_PATH = 'src/hooks/useAutoScroll.ts';
export const V39_CONTRACT_PATH = 'src/services/v39UiContract.ts';
export const V39_TIER1_CONFIG_PATH = 'tsconfig.tier1.json';
export const V39_PACKAGE_PATH = 'package.json';

/** The pure modules the gate must compile and the suites it must run. */
export const V39_TIER1_MODULES: readonly string[] = [
  'src/services/tuner.ts',
  'src/services/tunerDecoder.ts',
  'src/services/pageTurnPresets.ts',
  'src/services/v39UiContract.ts',
  'scripts/tuner.test.ts',
  'scripts/pageTurnSpeed.test.ts',
];

export const V39_TIER1_SUITES: readonly string[] = [
  'scripts/tuner.test.js',
  'scripts/pageTurnSpeed.test.js',
];

/**
 * The claims neither feature may make. The same list v38 applies to the practice
 * video, plus the words a tuner is most tempted by: the tuner reads ONE note at a
 * time from the sound after the fact, and calls nothing "accurate to a cent".
 */
export const V39_BANNED_CLAIMS: readonly string[] = [
  'transcription',
  'transcribed',
  'transcribe',
  'live notes',
  'real-time',
  'real time',
  'studio',
  'AI',
  'coming soon',
  'guarantee',
  'always accurate',
];

/** Tokens that would put a Pro/paywall gate in front of a free feature. */
export const V39_PAYWALL_TOKENS: readonly string[] = [
  'paywall',
  'isPro',
  'proTier',
  'proFeature',
  'subscription',
  'freeTrial',
];

/** Tokens that would mean something in the path can reach the internet. */
export const V39_NETWORK_TOKENS: readonly string[] = [
  'fetch(',
  'XMLHttpRequest',
  'sendBeacon',
  'http://',
  'https://',
];

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

/** The slice of `source` from `start` to the first `end` after it (or the tail). */
function sliceBlock(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  if (from < 0) return '';
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to < 0 ? source.length : to + end.length);
}

/** True when the source imports nothing native (the tier-1 rule). */
export function v39ModuleStaysPure(source: string): boolean {
  if (typeof source !== 'string' || source.length < 800) return false;
  const src = maskComments(source);
  if (/\bimport\b[^;]*?\bfrom\s+['"]react(-native)?['"]/.test(src)) return false;
  if (/\bimport\b[^;]*?\bfrom\s+['"]expo[-a-z]*['"]/.test(src)) return false;
  if (/\bimport\s+['"]react(-native)?['"]|\bimport\s+['"]expo[-a-z]*['"]/.test(src)) return false;
  if (/\bimport\b[^;]*?\bfrom\s+['"]@react-native[\w/-]*['"]/.test(src)) return false;
  if (/\bimport\b[^;]*?\bfrom\s+['"]fs['"]|\bimport\b[^;]*?\bfrom\s+['"]node:fs['"]/.test(src)) {
    return false;
  }
  if (/require\(\s*['"](react|react-native|expo[-a-z]*|fs|node:fs)['"]\s*\)/.test(src)) return false;
  return true;
}

/** True when no source in the list carries a banned claim. */
export function v39CopyAvoidsBannedClaims(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 200) return false;
    for (const claim of V39_BANNED_CLAIMS) {
      const escaped = claim.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(src)) return false;
    }
  }
  return true;
}

/** True when nothing in the list can reach the network. */
export function v39HasNoNetwork(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 200) return false;
    for (const token of V39_NETWORK_TOKENS) {
      if (src.indexOf(token) >= 0) return false;
    }
  }
  return true;
}

/** True when nothing in the list consults a Pro/subscription/paywall state. */
export function v39IsFreeAndUnpaywalled(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 200) return false;
    for (const token of V39_PAYWALL_TOKENS) {
      if (new RegExp(`\\b${token}\\b`, 'i').test(src)) return false;
    }
  }
  return true;
}

/** Every new module and suite must be in BOTH explicit gate lists. */
export function tier1ListsTheV39Features(
  tsconfigSource: string,
  packageSource: string,
): boolean {
  if (typeof tsconfigSource !== 'string' || typeof packageSource !== 'string') return false;
  if (tsconfigSource.length < 2000 || packageSource.length < 500) return false;
  for (const module of V39_TIER1_MODULES) {
    if (tsconfigSource.indexOf(`"${module}"`) < 0) return false;
  }
  for (const suite of V39_TIER1_SUITES) {
    if (packageSource.indexOf(`/tmp/tier1-test/${suite}`) < 0) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TUNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GUARD T1 — the tuner reads through the engine the app already has.
 *
 * Four facts that together mean "no second pitch engine was written": the screen
 * reads its note through the pure seam (`tunerReadingFromTake`), turns the take
 * into samples with the app's EXISTING decoder (`decodePcm16Base64`), records with
 * the app's EXISTING recorder hook (`useAudioRecorder`), and never calls the raw
 * detector itself (so a second engine cannot grow beside the seam).
 */
export function tunerReadsThroughTheExistingEngine(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 4000) return false;
  if (src.indexOf('tunerReadingFromTake(') < 0) return false;
  if (src.indexOf('decodePcm16Base64(') < 0) return false;
  if (src.indexOf('useAudioRecorder(') < 0) return false;
  if (src.indexOf('detectPitchFrames(') >= 0) return false;
  return true;
}

/**
 * GUARD T2 — the note reader stays ON THE DEVICE.
 *
 * The screen must hand the decoder an inline page constant (never a URL), and the
 * REAL page constant must be self-contained: it contains the decoder and the
 * bridge, and no URL, no fetch, no XMLHttpRequest, no importScripts.
 */
export function tunerKeepsTheDecoderOnDevice(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 4000) return false;
  if (src.indexOf('source={{ html: TUNER_DECODER_HTML }}') < 0) return false;
  if (!/from\s+'\.\.\/services\/tunerDecoder'/.test(src)) return false;
  // A URL source would make the tuner depend on the network.
  if (src.indexOf('source={{ uri') >= 0) return false;
  return tunerDecoderPageIsSelfContained(TUNER_DECODER_HTML);
}

/**
 * GUARD T3 — no dead ends on the tuner's own path.
 *
 * The PR #115 bug class (a start that failed silently) and its stop twin: both
 * failure readers must be inspected, and the two ways a take can fail to produce a
 * note (the decoder says no / the decoder never answers) must each have a string
 * on screen. A silent failure or a spinner that never resolves is a dead end.
 */
export function tunerHasNoDeadEnd(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 4000) return false;
  if (src.indexOf('takeStartFailure()') < 0) return false;
  if (src.indexOf('takeStopFailure()') < 0) return false;
  if (src.indexOf('TUNER_DECODE_FAIL_LINE') < 0) return false;
  if (src.indexOf('TUNER_DECODE_TIMEOUT_LINE') < 0) return false;
  if (src.indexOf('TUNER_DECODER_NOT_READY_LINE') < 0) return false;
  // The take is bounded (never an open microphone), and the repeat loop can be
  // switched off and is cancelled on unmount.
  if (src.indexOf('TUNER_TAKE_MS') < 0) return false;
  if (countOf(src, 'clearTimeout(') < 3) return false;
  // The one control that matters is a wired, labelled button.
  if (src.indexOf('onPress={startTake}') < 0) return false;
  if (src.indexOf('accessibilityLabel={listenLabel}') < 0) return false;
  return true;
}

/**
 * GUARD T4 — the tuner is REACHABLE: Practice Tools opens it, the root stack
 * registers it, and the route exists in the param list.
 */
export function tunerEntryPointsExist(sources: {
  editor: string;
  app: string;
  types: string;
}): boolean {
  const editor = maskComments(sources?.editor ?? '');
  const app = maskComments(sources?.app ?? '');
  const types = maskComments(sources?.types ?? '');
  if (editor.length < 2000 || app.length < 2000 || types.length < 2000) return false;
  if (editor.indexOf("navigation.navigate('Tuner')") < 0) return false;
  if (editor.indexOf('TUNER_CARD_TITLE') < 0) return false;
  if (editor.indexOf('TUNER_CARD_SUBTITLE') < 0) return false;
  if (app.indexOf("from './src/screens/TunerScreen'") < 0) return false;
  if (app.indexOf('name="Tuner"') < 0) return false;
  if (app.indexOf('component={TunerScreen}') < 0) return false;
  if (types.indexOf('Tuner: undefined;') < 0) return false;
  return true;
}

/**
 * GUARD T5 — the tuner's own surface is honest: one note at a time, read on the
 * device, free. The screens' copy is swept for banned claims and paywall tokens by
 * the shared helpers above; this one asserts the specific sentences exist, because
 * a tuner that hides where the audio goes would be the dishonest version.
 */
export function tunerSaysWhatItDoes(screenSource: string, serviceSource: string): boolean {
  const screen = maskComments(screenSource);
  const service = maskComments(serviceSource);
  if (screen.length < 4000 || service.length < 3000) return false;
  if (screen.indexOf('TUNER_HEADLINE') < 0) return false;
  if (screen.indexOf('TUNER_DEVICE_LINE') < 0) return false;
  if (screen.indexOf('TUNER_FREE_LINE') < 0) return false;
  if (service.indexOf('TUNER_DEVICE_LINE') < 0) return false;
  if (service.indexOf('TUNER_INSTRUMENT_LINE') < 0) return false;
  if (service.indexOf('TUNER_SILENT_LINE') < 0) return false;
  if (service.indexOf('TUNER_UNCLEAR_LINE') < 0) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PAGE-TURNER SPEED PRESETS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GUARD P1 — THE PDF READER GETS THE PRESETS, AND THE SCANNED SURFACE NO LONGER
 * OFFERS A CONTROL THAT CANNOT WORK THERE. RE-POINTED by v42 fix C (owner, v41
 * device pass 10-20: "the Play button does nothing and the BPM Autoscroll control
 * does not work off the scanned score").
 *
 * The PDF viewer and the scanned viewer are separate screens with separate
 * navigation params. The PDF viewer must key the memory on its own `itemId` and
 * the hook must be the one that reads and writes the stored profile.
 *
 * The scanned surface is a PHOTO. There is no OMR and no score following, so BPM
 * auto-scroll there could only turn pages on a timer blind to the music — it read
 * as broken because it WAS broken. v42 removed it from that surface (not
 * disabled: a greyed-out control is still a promise) and the surface now says why
 * (`SCANNED_NO_AUTOSCROLL_LINE`). This is a per-surface decision, not the
 * feature's removal, so the PDF half is asserted positively — if it ever goes
 * false, fix C deleted the feature instead of moving it.
 */
export function pageTurnerViewersShareThePresets(
  pdfSource: string,
  scannedSource: string,
  hookSource: string,
): boolean {
  const pdf = maskComments(pdfSource);
  const scanned = maskComments(scannedSource);
  const hook = maskComments(hookSource);
  if (pdf.length < 4000 || scanned.length < 4000 || hook.length < 1500) return false;
  if (!pdfViewerKeepsAutoScroll(pdfSource)) return false;
  if (!/from\s+'\.\.\/hooks\/usePageTurnSpeed'/.test(pdf)) return false;
  if (pdf.indexOf('usePageTurnSpeed(itemId, autoScroll)') < 0) return false;
  if (pdf.indexOf('speedProfiles={speedProfiles}') < 0) return false;
  // The scanned surface must carry NONE of it, and must say why.
  if (scannedViewerHasDeadControls(scannedSource)) return false;
  if (!scannedViewerExplainsNoAutoScroll(scannedSource)) return false;
  if (hook.indexOf('readPageTurnSpeedMap(') < 0) return false;
  if (hook.indexOf('writePageTurnSpeedMap(') < 0) return false;
  if (hook.indexOf('pageTurnSpeedForPiece(map, itemId') < 0) return false;
  if (hook.indexOf('withPageTurnSpeedForPiece(map, itemId') < 0) return false;
  return true;
}

/**
 * GUARD P2 — ONE TAP CHANGES THE WHOLE TURN RATE.
 *
 * The owner's ask is a speed, not a tempo: a preset tap must move BOTH numbers
 * that decide `secondsPerPage`. The engine's `applySpeedProfile` sets the BPM ref
 * and the beats-per-page ref and then snaps the schedule ONCE (a snap after each
 * setter would schedule the next turn twice), and the control calls it with the
 * preset's id.
 */
export function pageTurnerPresetTapChangesBothNumbers(
  presetServiceSource: string,
  hookSource: string,
  controlSource: string,
): boolean {
  const presets = maskComments(presetServiceSource);
  const hook = maskComments(hookSource);
  const control = maskComments(controlSource);
  if (presets.length < 3000 || hook.length < 1500 || control.length < 2500) return false;
  if (presets.indexOf('PAGE_TURN_PRESETS') < 0) return false;
  if (presets.indexOf('beatsPerPage') < 0 || presets.indexOf('bpm') < 0) return false;

  // The engine applies both numbers, then snaps once.
  const apply = sliceBlock(hook, 'const applySpeedProfile', '[snapNextTurn]');
  if (!apply) return false;
  if (apply.indexOf('bpmRef.current = nextBpm') < 0) return false;
  if (apply.indexOf('beatsPerPageRef.current = nextBeatsPerPage') < 0) return false;
  const firstSnap = apply.indexOf('snapNextTurn();');
  if (firstSnap < 0) return false;
  if (firstSnap < apply.indexOf('beatsPerPageRef.current = nextBeatsPerPage')) return false;
  if (countOf(apply, 'snapNextTurn();') !== 1) return false;

  // The control renders every preset and hands the id back.
  if (control.indexOf('speedProfiles.presets.map') < 0) return false;
  if (control.indexOf('speedProfiles.onSelectPreset(preset.id)') < 0) return false;
  if (control.indexOf('activePresetId === preset.id') < 0) return false;
  return true;
}

/**
 * GUARD P3 — the fine-grained steppers are STILL THERE.
 *
 * The presets are an addition, not a replacement: BPM and beats-per-page steppers,
 * their own bounds, and the live status line must all survive, or the feature
 * would have removed the control the owner already had.
 */
export function pageTurnerKeepsTheSteppers(controlSource: string): boolean {
  const src = maskComments(controlSource);
  if (src.length < 2500) return false;
  if (src.indexOf('stepBpm(-1)') < 0 || src.indexOf('stepBpm(1)') < 0) return false;
  if (src.indexOf('stepBeatsPerPage(-1)') < 0 || src.indexOf('stepBeatsPerPage(1)') < 0) return false;
  if (src.indexOf('label="BPM"') < 0) return false;
  if (src.indexOf('label="beats/page"') < 0) return false;
  if (src.indexOf('bpm <= 30') < 0 || src.indexOf('bpm >= 200') < 0) return false;
  if (src.indexOf('beatsPerPage <= 1') < 0 || src.indexOf('beatsPerPage >= 16') < 0) return false;
  if (src.indexOf('statusLabel(status, bpm, beatsPerPage, secondsPerPage)') < 0) return false;
  return true;
}

/**
 * GUARD P4 — the speed is remembered PER PIECE, on the device only.
 *
 * The pure module must own the key and the map codec; the device adapter is the
 * only module that touches AsyncStorage (the tier-1 split), and it must never
 * reach the network (nothing in this feature may leave the device).
 */
export function pageTurnerRemembersPerPiece(storeSource: string, presetServiceSource: string): boolean {
  const store = maskComments(storeSource);
  const presets = maskComments(presetServiceSource);
  if (store.length < 800 || presets.length < 3000) return false;
  if (store.indexOf("from '@react-native-async-storage/async-storage'") < 0) return false;
  if (store.indexOf('PAGE_TURN_SPEED_KEY') < 0) return false;
  if (store.indexOf('decodePageTurnSpeedMap') < 0) return false;
  if (store.indexOf('encodePageTurnSpeedMap') < 0) return false;
  if (presets.indexOf("PAGE_TURN_SPEED_KEY = 'notesnap:pageturner:speed:v1'") < 0) return false;
  // The pure module must NOT be the one talking to storage.
  if (/AsyncStorage/.test(presets)) return false;
  return true;
}

/**
 * GUARD P5 — the pure module's bounds are the ENGINE's bounds.
 *
 * pageTurnPresets.ts mirrors the stepper bounds so a pure module can validate a
 * stored profile without importing a React hook. A drift between the two would
 * silently clamp a remembered speed to a number the steppers cannot display, so
 * the real hook text is checked against the pure constants on every gate run.
 */
export function pageTurnerBoundsMatchTheHook(
  presetServiceSource: string,
  hookSource: string,
): boolean {
  const presets = maskComments(presetServiceSource);
  const hook = maskComments(hookSource);
  if (presets.length < 3000 || hook.length < 2000) return false;
  const expect: ReadonlyArray<[string, string, number]> = [
    ['PAGE_TURN_BPM_MIN', 'AUTO_SCROLL_BPM_MIN', PAGE_TURN_BPM_MIN],
    ['PAGE_TURN_BPM_MAX', 'AUTO_SCROLL_BPM_MAX', PAGE_TURN_BPM_MAX],
    [
      'PAGE_TURN_BEATS_PER_PAGE_MIN',
      'AUTO_SCROLL_BEATS_PER_PAGE_MIN',
      PAGE_TURN_BEATS_PER_PAGE_MIN,
    ],
    [
      'PAGE_TURN_BEATS_PER_PAGE_MAX',
      'AUTO_SCROLL_BEATS_PER_PAGE_MAX',
      PAGE_TURN_BEATS_PER_PAGE_MAX,
    ],
  ];
  for (const [pureName, hookName, value] of expect) {
    if (!new RegExp(`${pureName}\\s*=\\s*${value}\\b`).test(presets)) return false;
    if (!new RegExp(`${hookName}\\s*=\\s*${value}\\b`).test(hook)) return false;
  }
  // And the preset table's middle rung is the engine's own default, so a user who
  // never taps a preset keeps exactly the behaviour they had.
  if (!new RegExp(`DEFAULT_PAGE_TURN_PROFILE[^}]*bpm:\\s*${DEFAULT_PAGE_TURN_PROFILE.bpm}\\b`, 's').test(presets)) {
    return false;
  }
  if (!new RegExp(`DEFAULT_PAGE_TURN_PROFILE[^}]*beatsPerPage:\\s*${DEFAULT_PAGE_TURN_PROFILE.beatsPerPage}\\b`, 's').test(presets)) {
    return false;
  }
  if (!new RegExp(`AUTO_SCROLL_DEFAULT_BPM\\s*=\\s*${DEFAULT_PAGE_TURN_PROFILE.bpm}\\b`).test(hook)) {
    return false;
  }
  if (
    !new RegExp(
      `AUTO_SCROLL_DEFAULT_BEATS_PER_PAGE\\s*=\\s*${DEFAULT_PAGE_TURN_PROFILE.beatsPerPage}\\b`,
    ).test(hook)
  ) {
    return false;
  }
  return true;
}
