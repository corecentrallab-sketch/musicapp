/**
 * v38UiWiring.test.ts — LIVE-SOURCE GUARDS for the PRACTICE-VIDEO feature
 * (owner GO 10-10, all five decisions; backlog a49fbe2d; design brief §5).
 *
 * The walk reads the REAL files — the screen, the overlay lane, the send sheet,
 * the store, the device seam, the four pure modules, HistoryScreen, EditorScreen,
 * App.tsx, the types, app.json and the two gate lists — and every guard must be
 * TRUE on that real text AND be shown to BITE: the same guards are run against a
 * mutated copy of the same text and must go FALSE (skill
 * `musicapp-guard-mutation-probes`). The three most safety-critical ones
 * (own-take-only mapping, the measured offset, the honest copy plane) are also
 * applied ON DISK, with the failing guard line captured and the restore verified
 * by md5 — log: /home/team/shared/v38-video-mutation-probes.txt.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  PRACTICE_VIDEO_APP_CONFIG_PATH,
  PRACTICE_VIDEO_APP_PATH,
  PRACTICE_VIDEO_CONTRACT_PATH,
  PRACTICE_VIDEO_EDITOR_ENTRY_PATH,
  PRACTICE_VIDEO_HISTORY_PATH,
  PRACTICE_VIDEO_LANE_PATH,
  PRACTICE_VIDEO_LAYOUT_PATH,
  PRACTICE_VIDEO_REF_PATH,
  PRACTICE_VIDEO_SCREEN_PATH,
  PRACTICE_VIDEO_SEND_DEVICE_PATH,
  PRACTICE_VIDEO_SEND_MODEL_PATH,
  PRACTICE_VIDEO_SEND_SHEET_PATH,
  PRACTICE_VIDEO_STORE_PATH,
  PRACTICE_VIDEO_SYNC_PATH,
  PRACTICE_VIDEO_TYPES_PATH,
  tier1ListsTheVideoFeature,
  videoCopyAvoidsBannedClaims,
  videoCoreStaysPure,
  videoDeletionKeepsTheTake,
  videoEntryPointsExist,
  videoFeatureIsFreeAndUnpaywalled,
  videoIsPersistedBeforeAnyRowReferencesIt,
  videoNudgeIsBoundedAndNeverRewritesTakeTimes,
  videoOffsetIsMeasuredNotAssumed,
  videoOpensTheOneEditor,
  videoOverlayReadsTheCorrectedTake,
  videoRecordingIsBounded,
  videoRecordsBothCapturesOnOneScreen,
  videoSendSurfaceRendersThePair,
  videoSharesThroughTheSystemSheetOnly,
  videoUserFacingSources,
  videoUsesTheOneDecodeSeam,
} from '../src/services/v38UiContract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}
/** Every .ts/.tsx under src/, plus App.tsx — for the whole-repo scans. */
function walkSources(): { path: string; source: string }[] {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const files: { path: string; source: string }[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir))) {
      const rel = `${dir}/${entry}`;
      const full = path.join(root, rel);
      if (fs.statSync(full).isDirectory()) visit(rel);
      else if (/\.tsx?$/.test(entry)) files.push({ path: rel, source: fs.readFileSync(full, 'utf8') });
    }
  };
  visit('src');
  files.push({ path: 'App.tsx', source: readAppFile('App.tsx') });
  return files;
}

const SCREEN = readAppFile(PRACTICE_VIDEO_SCREEN_PATH);
const LANE = readAppFile(PRACTICE_VIDEO_LANE_PATH);
const SHEET = readAppFile(PRACTICE_VIDEO_SEND_SHEET_PATH);
const STORE = readAppFile(PRACTICE_VIDEO_STORE_PATH);
const DEVICE = readAppFile(PRACTICE_VIDEO_SEND_DEVICE_PATH);
const SYNC = readAppFile(PRACTICE_VIDEO_SYNC_PATH);
const REF = readAppFile(PRACTICE_VIDEO_REF_PATH);
const LAYOUT = readAppFile(PRACTICE_VIDEO_LAYOUT_PATH);
const SEND_MODEL = readAppFile(PRACTICE_VIDEO_SEND_MODEL_PATH);
const CONTRACT = readAppFile(PRACTICE_VIDEO_CONTRACT_PATH);
const HISTORY = readAppFile(PRACTICE_VIDEO_HISTORY_PATH);
const EDITOR_ENTRY = readAppFile(PRACTICE_VIDEO_EDITOR_ENTRY_PATH);
const APP = readAppFile(PRACTICE_VIDEO_APP_PATH);
const TYPES = readAppFile(PRACTICE_VIDEO_TYPES_PATH);
const APP_CONFIG = readAppFile(PRACTICE_VIDEO_APP_CONFIG_PATH);
const tsconfigSource = readAppFile('tsconfig.tier1.json');
const packageSource = readAppFile('package.json');
/**
 * The user-facing sources as RECORDS, so the copy sweep can be told which file a
 * violation came from — that is what keeps the contract module (whose ban-list is
 * a set of regex literals in its own body) out of its own sweep.
 */
const userFacingFiles = [
  { path: PRACTICE_VIDEO_REF_PATH, source: REF },
  { path: PRACTICE_VIDEO_SYNC_PATH, source: SYNC },
  { path: PRACTICE_VIDEO_LAYOUT_PATH, source: LAYOUT },
  { path: PRACTICE_VIDEO_SEND_MODEL_PATH, source: SEND_MODEL },
  { path: PRACTICE_VIDEO_SCREEN_PATH, source: SCREEN },
  { path: PRACTICE_VIDEO_LANE_PATH, source: LANE },
  { path: PRACTICE_VIDEO_SEND_SHEET_PATH, source: SHEET },
  { path: PRACTICE_VIDEO_SEND_DEVICE_PATH, source: DEVICE },
  { path: PRACTICE_VIDEO_STORE_PATH, source: STORE },
];
const copySources = videoUserFacingSources(userFacingFiles);
/** The same set with ONE source mutated — the shape the probes need. */
function userFacingWith(path: string, source: string): string[] {
  return videoUserFacingSources(
    userFacingFiles.map((file) => (file.path === path ? { path, source } : file)),
  );
}

console.log('\nv38 practice video — the live-source walk (floors first)');
assert(SCREEN.length > 25000, `read ${PRACTICE_VIDEO_SCREEN_PATH} (${SCREEN.length} chars)`);
assert(SHEET.length > 4000, `read ${PRACTICE_VIDEO_SEND_SHEET_PATH} (${SHEET.length} chars)`);
assert(LANE.length > 4000, `read ${PRACTICE_VIDEO_LANE_PATH} (${LANE.length} chars)`);
assert(STORE.length > 5000, `read ${PRACTICE_VIDEO_STORE_PATH} (${STORE.length} chars)`);
assert(DEVICE.length > 5000, `read ${PRACTICE_VIDEO_SEND_DEVICE_PATH} (${DEVICE.length} chars)`);
assert(SYNC.length > 8000, `read ${PRACTICE_VIDEO_SYNC_PATH} (${SYNC.length} chars)`);
assert(REF.length > 8000, `read ${PRACTICE_VIDEO_REF_PATH} (${REF.length} chars)`);
assert(LAYOUT.length > 6000, `read ${PRACTICE_VIDEO_LAYOUT_PATH} (${LAYOUT.length} chars)`);
assert(SEND_MODEL.length > 6000, `read ${PRACTICE_VIDEO_SEND_MODEL_PATH} (${SEND_MODEL.length} chars)`);
assert(HISTORY.length > 30000, `read ${PRACTICE_VIDEO_HISTORY_PATH} (${HISTORY.length} chars)`);
assert(EDITOR_ENTRY.length > 2000, `read ${PRACTICE_VIDEO_EDITOR_ENTRY_PATH} (${EDITOR_ENTRY.length} chars)`);
assert(APP.length > 8000, `read ${PRACTICE_VIDEO_APP_PATH} (${APP.length} chars)`);
const walked = walkSources();
assert(walked.length > 140, `walked ${walked.length} source files`);
assertEq(copySources.length, 9, 'the copy sweep covers all nine user-facing sources');
assertEq(
  videoUserFacingSources([{ path: PRACTICE_VIDEO_CONTRACT_PATH, source: CONTRACT }]).length,
  0,
  'the guard module is kept out of its own copy sweep (its ban words are its own regex literals)',
);

// ── GUARD 1 — the pure core stays pure ────────────────────────────────────────
console.log('\nv38 video guard 1 — the pure core imports nothing native');
assertEq(videoCoreStaysPure(SYNC), true, 'videoTakeSync.ts is pure');
assertEq(videoCoreStaysPure(REF), true, 'practiceVideoRef.ts is pure');
assertEq(videoCoreStaysPure(LAYOUT), true, 'videoOverlayLayout.ts is pure');
assertEq(videoCoreStaysPure(SEND_MODEL), true, 'videoSendTo.ts is pure');
assertEq(videoCoreStaysPure(CONTRACT), true, 'v38UiContract.ts is pure');

// ── GUARD 2 — DECISION 1: both captures start on one screen ───────────────────
console.log('\nv38 video guard 2 — the video and the take are captured together');
assertEq(
  videoRecordsBothCapturesOnOneScreen(SCREEN),
  true,
  'the camera records video with sound while the app’s own recorder runs beside it',
);

// ── GUARD 3 — DECISION 1: the offset is measured ──────────────────────────────
console.log('\nv38 video guard 3 — the sync offset is MEASURED, never assumed');
assertEq(videoOffsetIsMeasuredNotAssumed(SCREEN), true, 'both start stamps feed captureSyncOffsetMs, and a literal zero is absent');

// ── GUARD 4 — DECISION 3: the recording is bounded ───────────────────────────
console.log('\nv38 video guard 4 — three minutes, enforced in the call');
assertEq(videoRecordingIsBounded(SCREEN), true, 'maxDuration and maxFileSize ride recordAsync, and the cap is on screen');

// ── GUARD 5 — the video leaves the camera cache before a row names it ────────
console.log('\nv38 video guard 5 — persisted before any row references it');
assertEq(videoIsPersistedBeforeAnyRowReferencesIt(SCREEN, STORE), true, 'the store copies into documents/, and the screen writes the row after');
assert(STORE.indexOf('FileSystem.documentDirectory') >= 0, 'the store names the documents directory');
assert(STORE.indexOf('cacheDirectory') < 0, 'and never the cache');

// ── GUARD 6 — the take travels the ONE decode seam ───────────────────────────
console.log('\nv38 video guard 6 — the ONE decode seam, exactly once');
assertEq(videoUsesTheOneDecodeSeam(SCREEN), true, 'the screen decodes through deriveCaptureTakeFromRecording and reads no frame itself');

// ── GUARD 7 — DECISION 1: the existing editor, as a third host ───────────────
console.log('\nv38 video guard 7 — ONE editor, the app’s existing one');
assertEq(videoOpensTheOneEditor(SCREEN), true, 'the only *Editor JSX on the screen is TakeCorrectionEditor, handed the take and the row');

// ── GUARD 8 — DECISION 5: the system share sheet is the only way out ─────────
console.log('\nv38 video guard 8 — nothing but the system share sheet');
assertEq(videoSharesThroughTheSystemSheetOnly(DEVICE), true, 'expo-sharing for the file, React Native Share for the text, and no socket');
const shareImporters = walked.filter((file) =>
  /from\s+['"]expo-sharing['"]|require\(\s*['"]expo-sharing['"]\s*\)/.test(file.source),
);
const FEATURE_FILES = [
  PRACTICE_VIDEO_SCREEN_PATH,
  PRACTICE_VIDEO_LANE_PATH,
  PRACTICE_VIDEO_SEND_SHEET_PATH,
  PRACTICE_VIDEO_STORE_PATH,
  PRACTICE_VIDEO_SEND_DEVICE_PATH,
  PRACTICE_VIDEO_SYNC_PATH,
  PRACTICE_VIDEO_REF_PATH,
  PRACTICE_VIDEO_LAYOUT_PATH,
  PRACTICE_VIDEO_SEND_MODEL_PATH,
];
const featureShareImporters = shareImporters
  .map((file) => file.path)
  .filter((path) => FEATURE_FILES.indexOf(path) >= 0);
assertEq(
  featureShareImporters.join(','),
  PRACTICE_VIDEO_SEND_DEVICE_PATH,
  `inside the feature, expo-sharing is imported by the device seam alone (${featureShareImporters.join(', ') || 'none'})`,
);

// ── GUARD 9 — the export surface renders the pair ────────────────────────────
console.log('\nv38 video guard 9 — the export surface is built from the model');
assertEq(videoSendSurfaceRendersThePair(SHEET), true, 'the sheet uses the model’s actions and renders every outcome');

// ── GUARD 10 — DECISION 4: the overlay is the CORRECTED TAKE, never a frame ──
console.log('\nv38 video guard 10 — the overlay draws the take, not the picture');
assertEq(videoOverlayReadsTheCorrectedTake(SCREEN, LANE), true, 'noteCuesForVideo feeds the lane, which reads no camera and no detector');
const cameraImporters = walked
  .filter((file) => /from\s+['"]expo-camera['"]|require\(\s*['"]expo-camera['"]\s*\)/.test(file.source))
  .map((file) => file.path)
  .filter((path) => FEATURE_FILES.indexOf(path) >= 0);
assertEq(
  cameraImporters.join(','),
  PRACTICE_VIDEO_SCREEN_PATH,
  `inside the feature, only the record screen opens the camera (${cameraImporters.join(', ') || 'none'})`,
);

// ── GUARD 11 — the nudge is bounded and never re-times a note ────────────────
console.log('\nv38 video guard 11 — bounded nudge, take untouched');
assertEq(videoNudgeIsBoundedAndNeverRewritesTakeTimes(SYNC, SCREEN), true, 'the offset is clamped to its band and no note time is ever assigned');

// ── GUARD 12 — DECISION 5: deleting the video keeps the take ─────────────────
console.log('\nv38 video guard 12 — deleting the video keeps the take');
assertEq(videoDeletionKeepsTheTake(HISTORY, STORE), true, 'the row’s delete clears the video reference only — never the take');

// ── GUARD 13 — the honest-copy plane ─────────────────────────────────────────
console.log('\nv38 video guard 13 — no banned claims');
assertEq(videoCopyAvoidsBannedClaims(copySources), true, 'no source claims transcription, live notes, real time, a studio or AI');

// ── GUARD 14 — free through launch, no paywall token ─────────────────────────
console.log('\nv38 video guard 14 — free, and no paywall in the path');
assertEq(videoFeatureIsFreeAndUnpaywalled(copySources), true, 'nothing in the feature consults a Pro or subscription state');

// ── GUARD 15 — the feature is actually GATED ─────────────────────────────────
console.log('\nv38 video guard 15 — every new module and suite is in BOTH lists');
assertEq(tier1ListsTheVideoFeature(tsconfigSource, packageSource), true, 'the modules are in tsconfig.tier1.json and both suites are in test:tier1');

// ── GUARD 16 — the three tap paths ───────────────────────────────────────────
console.log('\nv38 video guard 16 — the feature is reachable, and the OS copy tells the truth');
assertEq(
  videoEntryPointsExist({ editor: EDITOR_ENTRY, app: APP, types: TYPES, appConfig: APP_CONFIG }),
  true,
  'Practice Tools opens it, the root stack registers it, the row type carries it, and iOS is told the app films with sound',
);

// ── the guards are not vacuous ───────────────────────────────────────────────
console.log('\nv38 video — the guards are not vacuous (empty input)');
assertEq(videoCoreStaysPure(''), false, 'an empty module is not pure-by-omission');
assertEq(videoRecordsBothCapturesOnOneScreen(''), false, 'an empty screen captures nothing');
assertEq(videoOffsetIsMeasuredNotAssumed(''), false, 'an empty screen measures nothing');
assertEq(videoRecordingIsBounded(''), false, 'an empty screen is unbounded');
assertEq(videoIsPersistedBeforeAnyRowReferencesIt('', ''), false, 'an empty pair persists nothing');
assertEq(videoUsesTheOneDecodeSeam(''), false, 'an empty screen decodes nothing');
assertEq(videoOpensTheOneEditor(''), false, 'an empty screen opens no editor');
assertEq(videoSharesThroughTheSystemSheetOnly(''), false, 'an empty seam shares nothing');
assertEq(videoSendSurfaceRendersThePair(''), false, 'an empty sheet renders nothing');
assertEq(videoOverlayReadsTheCorrectedTake('', ''), false, 'an empty pair draws nothing');
assertEq(videoNudgeIsBoundedAndNeverRewritesTakeTimes('', ''), false, 'an empty pair bounds nothing');
assertEq(videoDeletionKeepsTheTake('', ''), false, 'an empty pair deletes nothing');
assertEq(videoCopyAvoidsBannedClaims([]), false, 'no sources pass the copy sweep');
assertEq(videoCopyAvoidsBannedClaims(['a', 'b']), false, 'a stub copy set passes nothing');
assertEq(videoFeatureIsFreeAndUnpaywalled([]), false, 'an empty set is not free-by-omission');
assertEq(tier1ListsTheVideoFeature('', ''), false, 'empty lists do not gate the feature');
assertEq(
  videoEntryPointsExist({ editor: '', app: '', types: '', appConfig: '' }),
  false,
  'empty entry points mean no way in',
);
assertEq(videoUserFacingSources([]).length, 0, 'no sources means nothing to sweep (the floors above catch it)');

// ══════════════════════════════════════════════════════════════════════════════
// MUTATIONS — every guard must go FALSE on a mutated copy of the REAL text
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nv38 video — MUTATION PROBES (each guard must bite)');

function probe(name: string, mutated: string, original: string, guard: () => boolean): void {
  assert(mutated !== original, `${name}: the mutation really changed the source`);
  assertEq(guard(), false, `MUTATION FAILS THE GUARD — ${name}`);
}

// 1 — a "pure" module grows a native import.
const impureSync = SYNC.replace(
  "import type { MidiNoteEvent, SavedCaptureTake } from './midiExport';",
  "import { Platform } from 'react-native';\nimport type { MidiNoteEvent, SavedCaptureTake } from './midiExport';",
);
probe('guard 1: videoTakeSync.ts imports react-native', impureSync, SYNC, () => videoCoreStaysPure(impureSync));

// 2a — the camera stops recording video (it would scan instead). EVERY occurrence:
// the component's doc-comment mentions `mode="video"` too, so a first-only replace
// would rewrite the comment and leave the real prop in place — the mutation has to
// remove the PROPERTY, not a sentence about it.
const pictureMode = SCREEN.split('mode="video"').join('mode="picture"');
probe('guard 2: the camera is in picture mode, not video', pictureMode, SCREEN, () =>
  videoRecordsBothCapturesOnOneScreen(pictureMode),
);
// 2b — the recorder's failure readers vanish (a silent start, the PR #115 class).
// BOTH call sites (the pair start and the separate-take retry): leaving one behind
// means the screen still inspects a start failure and the guard should stay true.
const noStartReader = SCREEN.split('recorder.takeStartFailure()').join('null');
probe('guard 2: the audio start failure is never read', noStartReader, SCREEN, () =>
  videoRecordsBothCapturesOnOneScreen(noStartReader),
);
// 2c — the camera is muted (a SILENT video: decision 2's exact prohibition).
const muted = SCREEN.replace('mute={false}', 'mute');
probe('guard 2: the camera records a silent video', muted, SCREEN, () =>
  videoRecordsBothCapturesOnOneScreen(muted),
);

// 3a — the offset becomes an assumed zero, not a measurement.
const assumedZero = SCREEN.replace(
  'videoStartMs: videoStartMsRef.current',
  'videoStartMs: 0',
);
probe('guard 3: the video stamp is replaced by a literal zero', assumedZero, SCREEN, () =>
  videoOffsetIsMeasuredNotAssumed(assumedZero),
);
// 3b — the applied offset is hard-coded to zero (the silent-zero lie).
const zeroApplied = SCREEN.replace('audioOffsetMs: measuredOffsetMs', 'audioOffsetMs: 0');
probe('guard 3: the ref stores a hard-coded zero offset', zeroApplied, SCREEN, () =>
  videoOffsetIsMeasuredNotAssumed(zeroApplied),
);
// 3c — DECISION 2's fallback loses its own route and becomes a silent zero.
const noSeparateRoute = SCREEN.replace('separateTakeOffset()', '0');
probe('guard 3: the one-mic fallback loses its own offset route', noSeparateRoute, SCREEN, () =>
  videoOffsetIsMeasuredNotAssumed(noSeparateRoute),
);

// 4a — the time cap is dropped from the camera call.
const uncapped = SCREEN.replace('maxDuration: PRACTICE_VIDEO_MAX_SECONDS', 'maxDuration: undefined');
probe('guard 4: recordAsync loses its time cap', uncapped, SCREEN, () => videoRecordingIsBounded(uncapped));
// 4b — the size bound is dropped.
const unboundedSize = SCREEN.replace('maxFileSize: PRACTICE_VIDEO_MAX_FILE_BYTES', 'maxFileSize: undefined');
probe('guard 4: recordAsync loses its size bound', unboundedSize, SCREEN, () =>
  videoRecordingIsBounded(unboundedSize),
);

// 5a — the store starts writing into the evictable cache.
const cacheStore = STORE.replace('FileSystem.documentDirectory', 'FileSystem.cacheDirectory');
probe('guard 5: the store copies into the camera cache', cacheStore, STORE, () =>
  videoIsPersistedBeforeAnyRowReferencesIt(SCREEN, cacheStore),
);
// 5b — the row is written before the video is persisted (a row pointing at a dead file).
const rowFirst = SCREEN.replace('persistPracticeVideo(', 'persistPracticeVideoLater(');
probe('guard 5: nothing is persisted before the row is written', rowFirst, SCREEN, () =>
  videoIsPersistedBeforeAnyRowReferencesIt(rowFirst, STORE),
);

// 6a — a second decode of the same audio.
const secondDecode = SCREEN.replace(
  'const derived = await deriveCaptureTakeFromRecording({ uri: audioCacheUri, capturedAt });',
  'const derived = await deriveCaptureTakeFromRecording({ uri: audioCacheUri, capturedAt });\n        const again = await deriveCaptureTakeFromRecording({ uri: audioCacheUri, capturedAt });',
);
probe('guard 6: the take is decoded twice', secondDecode, SCREEN, () => videoUsesTheOneDecodeSeam(secondDecode));
// 6b — the screen grows its own network route.
const networkedScreen = SCREEN.replace(
  'const cameraRef = useRef<CameraView>(null);',
  "const cameraRef = useRef<CameraView>(null);\nasync function postTake() {\n  await fetch('/api/practice-video');\n}",
);
probe('guard 6: the screen grows its own network call', networkedScreen, SCREEN, () =>
  videoUsesTheOneDecodeSeam(networkedScreen),
);

// 7a — a second (home-grown) editor appears.
const secondEditor = SCREEN.replace('<TakeCorrectionEditor', '<TakeQuickEditor');
probe('guard 7: a second editor component appears', secondEditor, SCREEN, () => videoOpensTheOneEditor(secondEditor));
// 7b — the editor is handed no row (it could not save).
const noRow = SCREEN.replace('rowId={row?.rowId ?? null}', 'rowId={null}');
probe('guard 7: the editor is handed no row', noRow, SCREEN, () => videoOpensTheOneEditor(noRow));

// 8a — the seam grows a socket (and so would the user's data path).
const networkedSeam = DEVICE.replace(
  "import * as Sharing from 'expo-sharing';",
  "import * as Sharing from 'expo-sharing';\nasync function upload(uri: string) {\n  await fetch('http' + 's://notesnap.app/upload', { method: 'POST', body: uri });\n}",
);
probe('guard 8: the device seam uploads the video', networkedSeam, DEVICE, () =>
  videoSharesThroughTheSystemSheetOnly(networkedSeam),
);
// 8b — a second MIDI encoder appears in the seam.
const secondMidi = DEVICE.replace(
  "import * as Sharing from 'expo-sharing';",
  "import * as Sharing from 'expo-sharing';\nimport { exportCaptureMidiFromTake } from './captureMidiExport';",
);
probe('guard 8: the seam re-implements the MIDI export', secondMidi, DEVICE, () =>
  videoSharesThroughTheSystemSheetOnly(secondMidi),
);

// 9a — the sheet swallows its outcome (a dead button).
const silentOutcome = SHEET.replace('{line ? <Text style={styles.line}>{line}</Text> : null}', '');
probe('guard 9: the sheet stops rendering the outcome', silentOutcome, SHEET, () =>
  videoSendSurfaceRendersThePair(silentOutcome),
);
// 9b — the sheet drops the pair line (the video's honest boundary).
const noPairLine = SHEET.replace('{VIDEO_SEND_PAIR_LINE}', "{''}");
probe('guard 9: the pair line is dropped from the sheet', noPairLine, SHEET, () =>
  videoSendSurfaceRendersThePair(noPairLine),
);

// 10a — the overlay stops being drawn by the pure layout.
const ownLayout = LANE.replace('overlayLayout(', 'layoutSomehow(');
probe('guard 10: the lane stops using the pure layout', ownLayout, LANE, () =>
  videoOverlayReadsTheCorrectedTake(SCREEN, ownLayout),
);
// 10b — the overlay is fed an empty cue list instead of the corrected take.
const emptyCues = SCREEN.replace('cues={cueSet.cues}', 'cues={[]}');
probe('guard 10: the overlay is fed no cues at all', emptyCues, SCREEN, () =>
  videoOverlayReadsTheCorrectedTake(emptyCues, LANE),
);
// 10c — the lane grows a camera (a viewer that could record is not a viewer).
const cameraLane = LANE.replace(
  "import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';",
  "import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';\nimport { CameraView } from 'expo-camera';",
);
probe('guard 10: the overlay lane imports the camera', cameraLane, LANE, () =>
  videoOverlayReadsTheCorrectedTake(SCREEN, cameraLane),
);

// 11a — the nudge starts re-timing the take itself.
const reTimes = SCREEN.replace(
  'const take = row?.take ?? null;',
  'const take = row?.take ?? null;\n  if (take && take.notes[0]) take.notes[0].startSec = 0;',
);
probe('guard 11: the sync path rewrites a note’s start time', reTimes, SCREEN, () =>
  videoNudgeIsBoundedAndNeverRewritesTakeTimes(SYNC, reTimes),
);
// 11b — the clamp is dropped from the nudge.
const unclamped = SYNC.replace('return Math.min(limit, Math.max(-limit, next));', 'return next;');
probe('guard 11: the nudge loses its clamp', unclamped, SYNC, () =>
  videoNudgeIsBoundedAndNeverRewritesTakeTimes(unclamped, SCREEN),
);

// 12a — the delete takes the TAKE with it (the pair is no longer independent).
const deleteWholeRow = HISTORY.replace('deletePracticeVideo(item.id, item.practiceVideo ?? null)', 'removeRecognition(item.id)');
probe('guard 12: the delete removes the whole row', deleteWholeRow, HISTORY, () =>
  videoDeletionKeepsTheTake(deleteWholeRow, STORE),
);
// 12b — the store’s delete forgets the file and keeps the reference alive.
const orphanStore = STORE.replace('await FileSystem.deleteAsync(uri, { idempotent: true });', '');
probe('guard 12: the store stops deleting the video file', orphanStore, STORE, () =>
  videoDeletionKeepsTheTake(HISTORY, orphanStore),
);

// 13 — a banned claim appears on the new surface.
const bannedClaim = REF.replace('Filmed on your device', 'Transcribed in real time, studio quality');
probe('guard 13: the copy claims transcription, real time and a studio', bannedClaim, REF, () =>
  videoCopyAvoidsBannedClaims(userFacingWith(PRACTICE_VIDEO_REF_PATH, bannedClaim)),
);

// 14 — a paywall token appears in the video path.
const paywalled = SCREEN.replace(
  'const recorder = useAudioRecorder();',
  'const isPro = false;\n  const recorder = useAudioRecorder();',
);
probe('guard 14: the screen grows a Pro gate', paywalled, SCREEN, () =>
  videoFeatureIsFreeAndUnpaywalled(userFacingWith(PRACTICE_VIDEO_SCREEN_PATH, paywalled)),
);

// 15a — the wiring suite leaves the test:tier1 chain.
const unlistedSuite = packageSource.replace(' && node /tmp/tier1-test/scripts/v38UiWiring.test.js', '');
probe('guard 15: the wiring suite leaves the test:tier1 list', unlistedSuite, packageSource, () =>
  tier1ListsTheVideoFeature(tsconfigSource, unlistedSuite),
);
// 15b — a module leaves the compile list.
const unlistedModule = tsconfigSource.replace('    "src/services/practiceVideoRef.ts",\n', '');
probe('guard 15: the ref model leaves tsconfig.tier1.json', unlistedModule, tsconfigSource, () =>
  tier1ListsTheVideoFeature(unlistedModule, packageSource),
);

// 16a — Practice Tools loses the door.
const noCard = EDITOR_ENTRY.replace("navigation.navigate('PracticeVideo')", "navigation.navigate('Editor')");
probe('guard 16: the Practice Tools card opens something else', noCard, EDITOR_ENTRY, () =>
  videoEntryPointsExist({ editor: noCard, app: APP, types: TYPES, appConfig: APP_CONFIG }),
);
// 16b — the route is unregistered.
const noRoute = APP.replace('name="PracticeVideo"', 'name="PracticeVideoGone"');
probe('guard 16: the root stack no longer registers the screen', noRoute, APP, () =>
  videoEntryPointsExist({ editor: EDITOR_ENTRY, app: noRoute, types: TYPES, appConfig: APP_CONFIG }),
);
// 16c — the row block leaves the saved-row type.
const noBlock = TYPES.replace('practiceVideo?: PracticeVideoRef | null', 'practiceVideo?: unknown');
probe('guard 16: the row type loses the video block', noBlock, TYPES, () =>
  videoEntryPointsExist({ editor: EDITOR_ENTRY, app: APP, types: noBlock, appConfig: APP_CONFIG }),
);
// 16d — the iOS usage strings forget that the app films with sound.
const oldCopy = APP_CONFIG.replace('and to film your own practice with sound.', '');
probe('guard 16: the iOS camera string stops mentioning filming', oldCopy, APP_CONFIG, () =>
  videoEntryPointsExist({ editor: EDITOR_ENTRY, app: APP, types: TYPES, appConfig: oldCopy }),
);

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
